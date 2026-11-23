/*
  Scene director: steps through the beat list in src/data/waitingRoomBeats.js.
  It owns no story content; it only knows how to run beats and actions.

  Beat fields:
    id, trigger: { type: 'interact', target },
    onOpen:        actions run each time the choices open
    options:       [{ text, advance?, silent?, response?: [actions] }]
    lockedOptions: options offered while the next attempt is still gated ([] = nothing appears)
    onAdvance:     actions run when an advancing option is picked
    next:          id of the next beat (null = done)
    nextUnlockAfter: seconds, or [min, max], before `next` accepts an attempt

  Actions ({ do: ... }):
    say      { who, text }            typewriter line with voice blips
    anim     { who, name, duration? } actors[who].play(name); waits `duration` if given
    wait     { seconds }              (number or [min, max])
    setPhase { phase }
    set      { key, value }           write to the global state
    sound    { name, who? }           sfx[name](actor position)
    emit     { event }                tell the game something happened (hooks.onEvent)

  All waiting runs on game time, so pausing freezes the scene.
*/

const pick = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v ?? 0);

export class Director {
  constructor({ data, state, ui, sfx, actors, player, config, onEvent }) {
    this.data = data;
    this.state = state;
    this.ui = ui;
    this.sfx = sfx;
    this.actors = actors;
    this.player = player;
    this.config = config;
    this.onEvent = onEvent ?? (() => {});
    this.beats = new Map(data.beats.map((b) => [b.id, b]));
    this.currentId = data.start;
    this.lockedUntil = 0;
    this.busy = false;     // a response is playing out
    this.choosing = false; // choice menu is open
    this.time = 0;
    this.timers = [];
    this.typing = null;
  }

  get current() {
    return this.beats.get(this.currentId) ?? null;
  }

  /** Seconds until the next attempt unlocks (0 = open). */
  get gateRemaining() {
    return Math.max(0, this.lockedUntil - this.time);
  }

  update(dt) {
    this.time += dt;
    // timers
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.resolve();
    // typewriter
    const ty = this.typing;
    if (ty) {
      const cps = this.config.timings.dialogue.charsPerSecond;
      const shown = Math.min(ty.text.length, Math.floor((this.time - ty.start) * cps));
      if (shown !== ty.shown) {
        for (let i = ty.shown; i < shown; i++) {
          const ch = ty.text[i];
          if (/[A-Za-z0-9]/.test(ch) && i % 2 === 0) this.sfx.blip(ty.pitch, ty.position?.());
        }
        ty.shown = shown;
        this.ui.showLine(ty.speaker, ty.text.slice(0, shown));
      }
      if (shown >= ty.text.length && !ty.finished) {
        ty.finished = true;
        ty.resolve();
      }
    }
  }

  wait(seconds) {
    return new Promise((resolve) => this.timers.push({ at: this.time + pick(seconds), resolve }));
  }

  /** The player pressed E on something. Returns true if the director handled it. */
  interact(target) {
    const beat = this.current;
    const isTarget = beat && beat.trigger?.type === 'interact' && beat.trigger.target === target;
    // After the last beat, the target stays "handled" (nothing happens) rather than falling through
    if (!isTarget) return this.data.targets?.includes(target) ?? false;
    if (this.busy || this.choosing) return true;

    const locked = this.time < this.lockedUntil;
    const options = locked ? beat.lockedOptions ?? [] : beat.options;
    if (!options.length) return true; // nothing appears. She keeps clicking.

    this.choosing = true;
    this.player.block('dialogue', true);
    this.runActions(beat.onOpen ?? []);
    this.ui.showChoices(options, {
      canInput: () => !this.state.paused,
      onPick: (i) => {
        this.choosing = false;
        this.player.block('dialogue', false);
        this.choose(beat, options[i], locked);
      },
      onCancel: () => {
        this.choosing = false;
        this.player.block('dialogue', false);
      },
    });
    return true;
  }

  async choose(beat, option, wasLocked) {
    this.busy = true;
    try {
      if (!option.silent) await this.say('player', option.text);
      if (option.advance && !wasLocked) {
        await this.runActions(beat.onAdvance ?? []);
        this.currentId = beat.next ?? null;
        this.lockedUntil = this.time + pick(beat.nextUnlockAfter);
      } else {
        this.state.timesIgnored++;
        await this.runActions(option.response ?? []);
      }
    } finally {
      this.busy = false;
    }
  }

  async runActions(list) {
    for (const a of list) await this.runAction(a);
  }

  async runAction(a) {
    switch (a.do) {
      case 'say':
        return this.say(a.who, a.text);
      case 'anim':
        this.actors[a.who]?.play(a.name);
        if (a.duration) await this.wait(a.duration);
        return;
      case 'wait':
        return this.wait(a.seconds);
      case 'setPhase':
        this.state.phase = a.phase;
        this.onEvent('phase', a.phase);
        return;
      case 'set':
        this.state[a.key] = a.value;
        this.onEvent('set', a.key);
        return;
      case 'sound': {
        const pos = a.who ? this.actors[a.who]?.voicePosition?.() : null;
        this.sfx[a.name]?.(pos);
        return;
      }
      case 'emit':
        this.onEvent(a.event);
        return;
      default:
        console.warn('Director: unknown action', a);
    }
  }

  /**
   * Typewriter a line. Resolves `reactionDelay` after the last character, so the
   * next action (her glance, her reply) can start while the line is still on screen.
   * The box clears itself after the hold time unless something replaced it.
   */
  async say(who, text) {
    const sp = this.data.speakers[who] ?? { name: who.toUpperCase(), pitch: 250 };
    const actor = sp.actor ? this.actors[sp.actor] : null;
    const T = this.config.timings.dialogue;
    const token = {};
    this.lineToken = token;
    await new Promise((resolve) => {
      this.typing = {
        speaker: sp.name, text, pitch: sp.pitch, start: this.time, shown: 0, finished: false, resolve,
        position: actor ? () => actor.voicePosition() : null,
      };
      this.ui.showLine(sp.name, '');
    });
    this.wait(T.holdBase + T.holdPerChar * text.length).then(() => {
      if (this.lineToken !== token) return; // a newer line took over
      this.typing = null;
      if (!this.choosing) this.ui.hideDialogue();
    });
    await this.wait(T.reactionDelay);
  }
}
