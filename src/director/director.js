/*
  Scene director: steps through the beat list in src/data/waitingRoomBeats.ts
  (field and action types: src/director/types.ts).
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
    say      { who, text }            typewriter line with voice blips (or its recording, if there is one:
                                      src/audio/voice/<who>/); text may be (state) => string
    anim     { who, name, duration?, untilDone? } actors[who].play(name); waits `duration`, or until it's done
    notice   { text, seconds? }       a short message on screen (not spoken)
    wait     { seconds }              (number or [min, max])
    setPhase { phase }
    set      { key, value }           write to the global state (value may be (state) => value)
    sound    { name, who? }           sfx[name](actor position)
    emit     { event }                tell the game something happened (hooks.onEvent)
    if       { test: (state) => bool, then: [actions], else: [actions] }   checked when reached
    face     { who, expression }      a preset from config.characters.expressions
    goto     { beat }                 jump the beat list (null = the exchange is over)

  Sequences: data.sequences[name] is a list of actions the game can start with
  director.play(name) (e.g. the call when the wait is over). It waits until no
  dialogue is open or playing, then runs.

  All waiting runs on game time, so pausing freezes the scene.
*/

const pick = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v ?? 0);

export class Director {
  constructor({ data, state, ui, sfx, actors, player, config, onEvent, isBlocked, name = 'scene' }) {
    this.name = name; // shown by the debug beat readout
    // isBlocked(): true while another conversation owns the dialogue box (one at a time)
    this.isBlocked = isBlocked ?? (() => false);
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
    // Options picked in the current beat that didn't move the story on: not offered again (see choose)
    this.used = new Set();
    this.variants = new Map(); // say action -> { said, last }: which variation comes next
  }

  /**
   * A beat where no option moves the story on is waiting for the player to do something in the world
   * (take a number, try to sign the sheet...): its options stay, so there's always something to say.
   */
  static waitsForPlayer(beat) {
    return !(beat.options ?? []).some((o) => o.advance || 'goto' in o);
  }

  get current() {
    return this.beats.get(this.currentId) ?? null;
  }

  /** A line is playing or choices are open. */
  get active() {
    return this.busy || this.choosing;
  }

  /** Someone's mid-line (still typing out, or their recording still playing). */
  get talking() {
    const t = this.typing;
    return !!t && (!t.finished || this.time < t.until);
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
    this._timedBeat();
    // typewriter
    const ty = this.typing;
    if (ty) {
      // A recorded line types out over the length of its recording (and has no blips)
      const cps = ty.cps ?? this.config.timings.dialogue.charsPerSecond;
      const shown = Math.min(ty.text.length, Math.floor((this.time - ty.start) * cps));
      if (ty.voice) ty.voice.setPosition(ty.position?.());
      if (shown !== ty.shown) {
        for (let i = ty.shown; i < shown; i++) {
          const ch = ty.text[i];
          if (!ty.voice && /[A-Za-z0-9]/.test(ch) && i % 2 === 0) this.sfx.blip(ty.pitch, ty.position?.());
        }
        ty.shown = shown;
        this.ui.showLine(ty.speaker, ty.text.slice(0, shown));
      }
      if (shown >= ty.text.length && this.time >= ty.until && !ty.finished) {
        ty.finished = true;
        ty.resolve();
      }
    }
  }

  wait(seconds) {
    return new Promise((resolve) => this.timers.push({ at: this.time + pick(seconds), resolve }));
  }

  /** Does pressing E on `target` open the current beat's choices? (trigger.target: one name, or a list) */
  targets(target) {
    const beat = this.current;
    return !!beat && beat.trigger?.type === 'interact' && [].concat(beat.trigger.target).includes(target);
  }

  /** The player pressed E on something. Returns true if the director handled it. */
  interact(target) {
    const beat = this.current;
    const isTarget = this.targets(target);
    // After the last beat, the target stays "handled" (nothing happens) rather than falling through
    if (!isTarget) return this.data.targets?.includes(target) ?? false;
    if (this.busy || this.choosing || this.isBlocked()) {
      // Mid-sentence in a beat that goes on by itself (her phone call): she cuts him off once she's said it
      if (beat.during && this.time < this.lockedUntil && beat.lockedResponse?.length) this.pendingInterrupt = true;
      return true;
    }
    this.openChoices(beat);
    return true;
  }

  /** Show the beat's choices (or nothing, if it's gated and has no lockedOptions). */
  openChoices(beat) {
    const locked = this.time < this.lockedUntil;
    const all = locked ? beat.lockedOptions ?? [] : beat.options;
    // Already-said lines that got nowhere are gone (unless the beat is waiting for the player to act)
    const keepAll = Director.waitsForPlayer(beat);
    let source = all.filter((o) => keepAll || !this.used.has(o));
    if (!source.length) source = all;
    // Resolve live text now, so what's shown is what gets said
    const options = source
      .filter((o) => !o.showIf || o.showIf(this.state))
      .map((o) => ({ ...o, src: o, text: typeof o.text === 'function' ? o.text(this.state) : o.text }));

    if (!options.length) {
      // Gated with nothing to say: she may still brush the player off (beat.lockedResponse)
      if (locked && beat.lockedResponse?.length && !this.busy) {
        this.busy = true;
        this.runActions(beat.lockedResponse).finally(() => { this.busy = false; });
        return true;
      }
      // Not gated and still nothing: every option is hidden (showIf) or used, and the player can't move on
      if (!locked && !Director.waitsForPlayer(beat) && !this.warnedEmpty?.has(beat.id)) {
        (this.warnedEmpty ??= new Set()).add(beat.id);
        console.warn(`Director: beat "${beat.id}" has no options to show (all hidden by showIf or used): the story can't move on.`);
      }
      return; // nothing appears. She keeps clicking.
    }

    // Debug (?beat=...): something else picks (src/debug/skipToBeat.js). -1 = nothing yet, null = show the menu
    if (this.autoPick) {
      const i = this.autoPick(beat, options);
      if (i === -1) return true;
      if (i != null) {
        this.choose(beat, options[i], locked);
        return true;
      }
    }

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
        // Walking away mid-conversation: start over next time (data.resetOnLeave)
        if (this.data.resetOnLeave) {
          this.moveTo(this.data.start, 0);
          this.runActions(this.data.onLeave ?? []);
        }
      },
    });
    return true;
  }

  async choose(beat, option, wasLocked) {
    this.busy = true;
    // How aggressive that was (Option.aggression; 0 polite .. 3 hostile), before anything is said, so what follows
    // can react to it: state.lastAggression (this line), state.temper (all of them so far)
    const aggression = option.aggression ?? option.src?.aggression ?? 0;
    this.state.lastAggression = aggression;
    this.state.temper = (this.state.temper ?? 0) + aggression;
    try {
      if (!option.silent) await this.say('player', option.text);
      if (option.advance && !wasLocked) {
        await this.runActions(option.actions ?? []); // (the option's own steps first, then the beat's)
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
    // Picked, and the story didn't move on (still this beat): don't offer it again on this visit
    if (!option.advance && !option.repeatable && this.currentId === beat.id && option.src) this.used.add(option.src);
    const next = this.current;
    // A pending sequence (e.g. the call) takes priority over the next auto-opened choices
    if (next?.autoOpen && this.gateRemaining === 0 && !this.choosing && !this.pendingSequence) this.openChoices(next);
  }

  /** Which of a `say` action's variations to say this time (a.vary: 'order' | 'random' | 'any' | 'cycle'). */
  variant(a) {
    const lines = a.text, n = lines.length;
    const v = this.variants.get(a) ?? { said: 0, last: -1 };
    this.variants.set(a, v);
    let k;
    if (a.vary === 'any') k = Math.floor(Math.random() * n); // truly random: repeats allowed
    else if (a.vary === 'cycle') k = v.said % n;
    else if (a.vary !== 'random' && v.said < n) k = v.said;
    else { do k = Math.floor(Math.random() * n); while (n > 1 && k === v.last); }
    v.said++;
    v.last = k;
    return lines[k];
  }

  /** Run a named sequence's actions right now, without waiting for the dialogue to be free. */
  runNow(name) {
    return this.runActions(this.data.sequences?.[name] ?? []);
  }

  /** Run a named sequence from the data once the director is free. */
  async play(name) {
    const list = this.data.sequences?.[name];
    if (!list) return console.warn('Director: no sequence', name);
    this.pendingSequence = name;
    while (this.busy || this.choosing || this.isBlocked()) await this.wait(0.2);
    this.busy = true;
    try {
      await this.runActions(list);
    } finally {
      this.busy = false;
      this.pendingSequence = null;
    }
  }

  moveTo(id, unlockAfter) {
    if (id !== this.currentId) this.used.clear(); // a new beat (or coming back to one): every option again
    if (id !== this.currentId || this.beatSince == null) { this.beatSince = this.time; this.duringAt = null; this.timedOut = false; this.pendingInterrupt = false; }
    this.currentId = id;
    this.lockedUntil = this.time + pick(unlockAfter);
  }

  /**
   * A beat that goes on by itself (e.g. her phone call): `during` runs every `every` seconds while nobody is talking
   * or choosing (her side of the conversation); `timeout` runs once the beat has been current for `after`
   * seconds, then moves to its `goto` (the call ends). Interrupting her meanwhile is the beat's lockedResponse.
   */
  _timedBeat() {
    const beat = this.current;
    if (!beat || (!beat.during && !beat.timeout) || this.busy || this.choosing || this.talking) return;
    const since = this.time - (this.beatSince ?? this.time);
    if (this.pendingInterrupt) { // (he spoke while she was talking)
      this.pendingInterrupt = false;
      if (this.time < this.lockedUntil && beat.lockedResponse?.length) {
        this.busy = true;
        this.runActions(beat.lockedResponse).finally(() => { this.busy = false; });
        return;
      }
    }
    if (beat.timeout && !this.timedOut && since >= beat.timeout.after) {
      this.timedOut = true;
      this.busy = true;
      this.runActions(beat.timeout.actions ?? []).finally(() => {
        this.busy = false;
        this.moveTo(beat.timeout.goto ?? null, beat.timeout.unlockAfter ?? 0);
        const next = this.current;
        if (next?.autoOpen && this.gateRemaining === 0 && !this.choosing && !this.pendingSequence) this.openChoices(next);
      });
      return;
    }
    if (beat.during) {
      this.duringAt ??= this.time + pick(beat.during.first ?? beat.during.every);
      if (this.time >= this.duringAt) {
        this.duringAt = this.time + pick(beat.during.every);
        this.busy = true;
        this.runActions(beat.during.actions ?? []).finally(() => { this.busy = false; });
      }
    }
  }

  async runActions(list) {
    for (const a of list) await this.runAction(a);
  }

  async runAction(a) {
    switch (a.do) {
      case 'say': {
        // A list of lines: one of them each time (variations; see types.ts)
        const text = Array.isArray(a.text) ? this.variant(a) : a.text;
        // text may be (state) => string for live values, e.g. the time on the clock
        return this.say(a.who, typeof text === 'function' ? text(this.state) : text);
      }
      case 'anim': {
        const done = this.actors[a.who]?.play(a.name);
        if (a.untilDone && done?.then) await done; // e.g. a walk that takes as long as it takes
        else if (a.duration) await this.wait(a.duration);
        return;
      }
      case 'notice':
        this.ui.toast(a.text, a.seconds ?? 3);
        return;
      case 'wait':
        return this.wait(a.seconds);
      case 'setPhase':
        this.state.phase = a.phase;
        this.onEvent('phase', a.phase);
        return;
      case 'set':
        // value may be (state) => value, e.g. to count something up
        this.state[a.key] = typeof a.value === 'function' ? a.value(this.state) : a.value;
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
      case 'goto':
        this.moveTo(a.beat, 0);
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
    this.typing?.voice?.stop(); // (a line cut off by this one)
    // Its recording, if there is one (src/audio/voice/<who>/; config.audio.voices)
    const length = this.sfx.voiceLength?.(who, text) ?? 0;
    const voice = length ? this.sfx.voiceLine(who, text, actor?.voicePosition() ?? null) : null;
    await new Promise((resolve) => {
      this.typing = {
        speaker: sp.name, text, pitch: sp.pitch, start: this.time, shown: 0, finished: false, resolve,
        position: actor ? () => actor.voicePosition() : null,
        voice, until: voice ? this.time + length : 0,
        cps: voice ? Math.max(text.length / (length * 0.85), 1) : null,
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
