/*
  Scene director: steps through the beat list in src/data/waitingRoomBeats.js.
  It owns no story content; it only knows how to run beats and actions.

  Beat fields:
    id, trigger: { type: 'interact', target },
    onOpen:        actions run each time the choices open
    autoOpen:      true = choices open by themselves as soon as this beat becomes current
                   (no E press needed; E still reopens them if the player steps away)
    options:       [{ text, advance?, goto?, actions?, silent?, response?: [actions] }]
                     text      string, or (state) => string for live values (e.g. the clock)
                     showIf    (state) => bool; hide the option when false
                     advance   run beat.onAdvance, then move to beat.next
                     goto      run option.actions, then move to that beat id (null = end;
                               may be this same beat, to ask again). May be (state) => id.
                     response  neither: run these actions and stay (counts as being ignored)
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
    if       { test: (state) => bool, then: [actions], else: [actions] }   checked when reached
    face     { who, expression }      a preset from config.characters.expressions

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
    this.openChoices(beat);
    return true;
  }

  /** Show the beat's choices (or nothing, if it's gated and has no lockedOptions). */
  openChoices(beat) {
    const locked = this.time < this.lockedUntil;
    const source = locked ? beat.lockedOptions ?? [] : beat.options;
    // Resolve live text now, so what's shown is what gets said
    const options = source
      .filter((o) => !o.showIf || o.showIf(this.state))
      .map((o) => ({ ...o, text: typeof o.text === 'function' ? o.text(this.state) : o.text }));

    if (!options.length) return; // nothing appears. She keeps clicking.

    // If a line is still on screen, keep it above the choices
    const ty = this.typing;
    const context = ty && ty.speaker !== this.data.speakers.player?.name ? { speaker: ty.speaker, text: ty.text } : null;

    this.choosing = true;
    this.player.block('dialogue', true);
    this.runActions(beat.onOpen ?? []);
    this.ui.showChoices(options, {
      context,
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
        this.moveTo(beat.next ?? null, beat.nextUnlockAfter);
      } else if ('goto' in option && !wasLocked) {
        await this.runActions(option.actions ?? []);
        const target = typeof option.goto === 'function' ? option.goto(this.state) : option.goto;
        this.moveTo(target, option.unlockAfter ?? 0);
      } else {
        this.state.timesIgnored++;
        await this.runActions(option.response ?? []);
      }
    } finally {
      this.busy = false;
    }
    const next = this.current;
    if (next?.autoOpen && this.gateRemaining === 0 && !this.choosing) this.openChoices(next);
  }

  moveTo(id, unlockAfter) {
    this.currentId = id;
    this.lockedUntil = this.time + pick(unlockAfter);
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
      case 'face':
        this.actors[a.who]?.setExpression?.(a.expression);
        return;
      case 'if':
        return this.runActions(a.test(this.state) ? a.then ?? [] : a.else ?? []);
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
      actor?.setTalking?.(true);
    });
    actor?.setTalking?.(false);
    this.wait(T.holdBase + T.holdPerChar * text.length).then(() => {
      if (this.lineToken !== token) return; // a newer line took over
      this.typing = null;
      if (!this.choosing) this.ui.hideDialogue();
    });
    await this.wait(T.reactionDelay);
  }
}
