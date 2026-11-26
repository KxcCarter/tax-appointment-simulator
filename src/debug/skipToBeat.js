/*
  Debug: ?beat=<beat id> starts the game at that beat of the receptionist's storyline.

  It doesn't just jump there: the world has to match (the ticket, the clock, her coffee, the newcomer, 848
  being called...). So the game plays itself at high speed, muted, picking at each menu the option that
  leads closest to the target beat, and hands control back when that beat comes up. With an auto-opening
  beat, its choices are waiting for the player.

  The route is worked out from the beat data (src/data/waitingRoomBeats.ts): `advance` → next, `goto`
  (a beat, or a function: the beat ids written in it count as possible destinations), and `goto`
  actions. When a choice depends on the clock (on time / early / late), the clock is set to whichever
  reading leads closest. Things the player does in the world are in WORLD below.
*/

const IDS = /['"`]([a-z][a-z0-9_]*)['"`]/g;

/** Every beat a function's source mentions (a `goto: (state) => (...)` may lead to any of them). */
function mentioned(fn, ids) {
  return [...String(fn).matchAll(IDS)].map((m) => m[1]).filter((id) => ids.has(id));
}

/** Beats an action list can send the story to. */
function gotosIn(actions, ids, out = []) {
  for (const a of actions ?? []) {
    if (a.do === 'goto' && a.beat) out.push(a.beat);
    if (a.do === 'if') { gotosIn(a.then, ids, out); gotosIn(a.else, ids, out); }
  }
  return out;
}

/** Where an option can lead, sooner or later (static: a `goto` function counts every beat it names). */
function optionEdges(beat, o, ids) {
  const out = [];
  if (o.advance && beat.next) out.push(beat.next);
  if ('goto' in o) {
    if (typeof o.goto === 'function') out.push(...mentioned(o.goto, ids));
    else if (o.goto) out.push(o.goto);
  }
  out.push(...gotosIn(o.actions, ids), ...gotosIn(o.response, ids));
  return out;
}

/** Where each option of a beat can lead (static, for the route). */
function edges(beat, ids, sequences) {
  const out = new Set();
  for (const o of [...(beat.options ?? []), ...(beat.lockedOptions ?? [])]) optionEdges(beat, o, ids).forEach((id) => out.add(id));
  gotosIn(beat.onAdvance, ids).forEach((id) => out.add(id));
  for (const w of WORLD) if (w.from === beat.id) gotosIn(sequences?.[w.sequence], ids).forEach((id) => out.add(id));
  return out;
}

/*
  What the player does in the world to move the story on (not a dialogue choice):
  - from: the beat it's done in; sequence: the scene sequence it runs (its gotos are the route);
  - when: whether it can be done now.
*/
const WORLD = [
  { from: 'checkin_offered', sequence: 'signSheet', when: (s) => s.clipboardOffered && !s.needsPen },
];

/** Clock readings tried when a choice depends on the time: early, on time, late (state.clockTime: 12-hour face). */
const clockTries = (config) => {
  const appt = (config.appointment.hour % 12) * 3600 + config.appointment.minute * 60;
  return [appt - 3 * 60, appt + 20, appt + (config.appointment.onTimeMinutes + 2) * 60];
};

export function createBeatSkipper({ target, level, state, player, ui, sfx, config }) {
  const director = level.director;
  const data = director.data;
  const ids = new Set(data.beats.map((b) => b.id));
  if (!ids.has(target)) {
    ui.toast(`?beat: there's no beat called "${target}".`, 5);
    return null;
  }

  // Distance (in steps) from every beat to the target: a breadth-first search backwards
  const into = new Map([...ids].map((id) => [id, []]));
  for (const b of data.beats) for (const to of edges(b, ids, data.sequences)) into.get(to)?.push(b.id);
  const dist = new Map([[target, 0]]);
  for (let queue = [target]; queue.length;) {
    const id = queue.shift();
    for (const from of into.get(id)) if (!dist.has(from)) { dist.set(from, dist.get(id) + 1); queue.push(from); }
  }
  const far = (id) => (id == null ? Infinity : dist.get(id) ?? Infinity);
  if (far(director.currentId) === Infinity) {
    ui.toast(`?beat: can't find a way from "${director.currentId}" to "${target}".`, 5);
    return null;
  }

  /**
   * Where picking this option would go, with the clock at `clock`: a dry run of its actions on a copy of
   * the state (only `set`, `if` and `goto` count), since a `goto` function may read what they set.
   */
  const destination = (beat, o, clock) => {
    if (o.advance) return beat.next ?? null;
    const s = Object.create(state);
    s.clockTime = clock;
    let jump;
    const run = (list) => {
      for (const a of list ?? []) {
        if (a.do === 'set') s[a.key] = typeof a.value === 'function' ? a.value(s) : a.value;
        else if (a.do === 'if') run(a.test(s) ? a.then : a.else);
        else if (a.do === 'goto') jump = a.beat;
      }
    };
    if ('goto' in o) {
      run(o.actions);
      return typeof o.goto === 'function' ? o.goto(s) : o.goto;
    }
    run(o.response);
    return jump === undefined ? beat.id : jump;
  };

  let time = 0, poke = 0, done = false;
  const volume = config.audio.master;

  const skipper = {
    target,
    get active() { return !done; },
    label: () => `⏩ skipping to ${target}…`,
    finish(message) {
      if (done) return;
      done = true;
      director.autoPick = null;
      level.setSkipping(false);
      player.block('skip', false);
      if (sfx.master) sfx.master.gain.value = volume;
      ui.setSkipping(null);
      ui.toast(message, 3);
    },
    update(dt) {
      if (done) return;
      time += dt;
      if (sfx.master) sfx.master.gain.value = 0; // muted (audio may start mid-skip, on the first click)
      if (director.currentId === target) return skipper.finish(`Skipped to ${target}.`);
      if (director.currentId == null || time > config.debug.skipGiveUpAfter) {
        return skipper.finish(`?beat: couldn't get to "${target}" (stopped at "${director.currentId}").`);
      }
      // She said "take a number": take one (what a player would do)
      if (state.toldToTakeNumber && state.ticketNumber == null) level.takeTicket();
      if (time < poke || director.active || director.typing || director.isBlocked()) return;
      poke = time + 1;
      const beat = director.current;
      const world = WORLD.find((w) => w.from === beat.id && w.when(state));
      if (world) director.runNow(world.sequence);
      else if (beat.trigger?.type === 'interact') director.interact([].concat(beat.trigger.target)[0]);
    },
  };

  /** The director asks which option to pick: the one that leads closest to the target. */
  director.autoPick = (beat, options) => {
    if (beat.id === target) return null; // there: the player chooses
    let pick = -1, d = far(beat.id), clock = state.clockTime;
    // Depends on the clock (early / on time / late)? Try the clock as it is, then a few other readings.
    for (const t of [state.clockTime, ...clockTries(config)]) {
      options.forEach((o, i) => {
        const to = far(destination(beat, o, t));
        if (to < d) { pick = i; d = to; clock = t; }
      });
    }
    // Nothing gets closer right now, but an option can later (e.g. her second "No." calls 848, the first
    // doesn't): take the long way round, by whichever of those goes least far off
    if (pick === -1) {
      let off = Infinity;
      options.forEach((o, i) => {
        if (!optionEdges(beat, o.src ?? o, ids).some((id) => far(id) < far(beat.id))) return;
        const to = far(destination(beat, o, state.clockTime));
        if (pick === -1 || to < off) { pick = i; off = to; }
      });
    }
    state.clockTime = clock;
    return pick; // -1: nothing leads closer here yet (a gate, or something in the world first)
  };

  level.setSkipping(true);
  player.block('skip', true);
  ui.setSkipping(skipper.label());
  return skipper;
}
