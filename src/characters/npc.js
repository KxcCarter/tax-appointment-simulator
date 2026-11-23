import * as THREE from 'three';
import { config } from '../config.js';
import { theme, characterPalettes } from '../theme.js';
import { RAPIER } from '../physics.js';
import { buildRig, solveTwoBone, aimJoint } from './rig.js';
import { Walker } from './walker.js';
import { Ragdoll } from './ragdoll.js';

/*
  A waiting-room NPC. For now (Milestone 3) only the seated states:
    Seated -> IdleFidget (personality) -> reactions (ticket glance, crowded, called)
  Milestone 4 adds Indignant -> Approach -> ... -> KnockedDown.

  Pose is procedural every frame: a resting seated pose, overridden by the current
  personality action and reactions, solved with two-bone IK. Targets are written in the
  CHAIR's local frame (origin on the floor at the chair centre, +z = where they face,
  +x = their left) and smoothed, so transitions ease in and out.

  Personalities: cougher | watchChecker | reader | jiggler | sitter
*/

const N = config.npc;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (x) => x * x * (3 - 2 * x);
const SEAT_TOP = 0.485; // chair seat surface (waitingRoom.js)

export class Npc {
  constructor({ scene, physics, def, chair, sfx, clockPos, receptionistHead }) {
    this.id = def.id;
    this.def = def;
    this.sfx = sfx;
    this.physics = physics;
    this.chair = chair;
    this.clockPos = clockPos;
    this.receptionistHead = receptionistHead;
    this.personality = def.personality;

    const look = characterPalettes.cast[def.look];
    this.rig = buildRig({ ...look, proportions: config.characters.builds?.[def.id] });
    this.face = this.rig.face;
    this.restExpression = def.expression ?? 'bored';
    this.face?.setExpression(this.restExpression, 100);
    scene.add(this.rig.root);

    // Claim and lock the chair: nobody shoves it out from under them (unlocked in the brawl)
    chair.occupant = def.id;
    const body = chair.object.userData.body;
    body?.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    this._seat();
    this.walker = new Walker(this._walkerHost());

    // Smoothed pose targets (chair-local)
    this.t = {
      lHand: new THREE.Vector3(), rHand: new THREE.Vector3(),
      look: new THREE.Vector3(0, 1.0, 3), lean: 0, twist: 0, bend: 0.05,
    };
    this._restTargets(this.t);

    this.time = Math.random() * 10;
    this.action = null;                        // current personality action { name, t, dur, ... }
    this.nextAction = rand(2, 6);
    this.nextClock = rand(...N.clockGlance.every);
    this.reaction = null;                      // { name, t, dur }
    this.called = false;
    this.crowdSide = 0;                        // -1/+1 when the player sits next to them
    this.lastWatchSecond = -1;

    if (def.props?.includes('magazine')) this._makeMagazine(scene);
    if (def.props?.includes('briefcase')) this._makeBriefcase(scene, physics);
  }

  // ------------------------------------------------------------------ setup

  _seat() {
    const root = this.rig.root, c = this.chair.object;
    root.position.copy(c.localToWorld(new THREE.Vector3(0, 0, -0.03)));
    root.quaternion.copy(c.quaternion);
    root.updateMatrixWorld(true);
    const pelvisY = this.rig.joints.pelvis.getWorldPosition(new THREE.Vector3()).y;
    root.position.y += SEAT_TOP + this.rig.seatOffset - pelvisY;
    this.seatRoot = root.position.clone();
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(c.quaternion);
    this.chairYaw = Math.atan2(f.x, f.z);
  }

  /** Chair-local point -> world. */
  w(x, y, z) {
    return this.chair.object.localToWorld(new THREE.Vector3(x, y, z));
  }

  /** World point -> chair-local. */
  local(v) {
    return this.chair.object.worldToLocal(v.clone());
  }

  _restTargets(t) {
    t.lHand.set(0.13, 0.6, 0.24);  // hands resting on the thighs
    t.rHand.set(-0.13, 0.6, 0.24);
    t.look.set(0, 0.9, 3);         // the middle distance, slightly down
    t.lean = 0; t.twist = 0; t.bend = 0.05;
  }

  _makeMagazine(scene) {
    const g = new THREE.Group();
    const cover = theme.material('magazineBlue');
    const paper = theme.material('paperWhite');
    for (const side of [1, -1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.27), [paper, paper, paper, cover, paper, paper]);
      page.position.x = side * 0.1;
      page.rotation.z = side * -0.12; // slight V at the spine
      g.add(page);
    }
    // The page that turns: hinged on the spine, starts on her right (-x)
    this.pagePivot = new THREE.Group();
    const turning = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.265), paper);
    turning.position.set(-0.1, 0.006, 0);
    this.pagePivot.add(turning);
    g.add(this.pagePivot);
    scene.add(g);
    this.magazine = g;
  }

  _makeBriefcase(scene, physics) {
    // Standing on its end in the gap beside the chair (on their right), long side front-to-back
    const g = new THREE.Group();
    g.position.copy(this.w(-0.35, 0.165, 0));
    g.quaternion.copy(this.chair.object.quaternion);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.33, 0.42), theme.material('briefcase'));
    g.add(body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), theme.material('woodDark'));
    handle.position.y = 0.18;
    g.add(handle);
    for (const z of [-0.1, 0.1]) {
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.03, 0.03), theme.material('briefcaseLatch'));
      latch.position.set(0, 0.12, z);
      g.add(latch);
    }
    scene.add(g);
    physics.addDynamic(g, [{ type: 'box', half: { x: 0.05, y: 0.165, z: 0.21 } }], { density: 450 });
    this.briefcase = g;
  }

  // ------------------------------------------------------------------ events from the level

  /** Everyone looks over when the player takes a ticket. */
  glanceAtPlayer(duration = N.ticketGlance) {
    if (this.called) return;
    this.reaction = { name: 'glance', t: 0, dur: duration + rand(0, 0.4), delay: rand(0, 0.35) };
  }

  /** The player's number was called. Heads turn, one by one, and stay turned. */
  onCalled() {
    this.called = true;
    this.action = null;
    this.reaction = { name: 'called', t: 0, dur: Infinity, delay: rand(...N.calledLookDelay) };
  }

  /**
   * The player hit the sitter back. As far as everyone else is concerned she did nothing wrong:
   * heads snap round, a gasp, then they keep staring at him, appalled, for good.
   */
  onPlayerFoughtBack() {
    if (this.called || this.down || this.id === config.radio.who) return;
    this.appalled = true;
    this.action = null;
    this.reaction = { name: 'appalled', t: 0, dur: Infinity, delay: rand(...N.onlookers.lookDelay) };
  }

  /** side: +1 if the player sits on this NPC's left, -1 on the right, 0 = not crowded. */
  setCrowded(side) {
    this.crowdSide = side;
  }

  setExpression(name) {
    this.face?.setExpression(name);
  }

  /** Director hooks for small talk: 'attend' = turn to the player and stop fidgeting; 'resume' = carry on. */
  play(name) {
    if (name === 'attend') {
      this.attending = true;
      this.action = null;
      if (this.pagePivot) this.pagePivot.rotation.z = 0;
    } else if (name === 'resume') {
      this.attending = false;
      this.nextAction = rand(2, 5);
    }
  }

  setTalking(on) {
    this.face?.setTalking(on);
  }

  voicePosition() {
    return this.rig.joints.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0));
  }

  // ------------------------------------------------------------------ per frame

  update(dt, camera) {
    this.time += dt;
    if (this.down) return this._updateDown(dt);
    if (this.walker.active) {
      this.walker.update(dt, camera);
      if (this.carrying && this.walker.hands) {
        // The radio rides between her hands
        const mid = this.walker.hands[1].clone().add(this.walker.hands[-1]).multiplyScalar(0.5);
        this.carrying.group.position.copy(mid).add(new THREE.Vector3(0, -0.09, 0));
        if (this.carrying.orient) this.carrying.orient(this.carrying.group, this.walker.yaw);
        else this.carrying.group.rotation.set(0, this.walker.yaw + Math.PI, 0);
      }
      // Her magazine waits on the seat
      if (this.magazine) {
        this.magazine.position.copy(this.w(0, SEAT_TOP + 0.01, 0.02));
        this.magazine.quaternion.copy(this.chair.object.quaternion);
      }
      if (!this.walker.active) this.nextAction = rand(3, 6);
      return;
    }
    const desired = {
      lHand: new THREE.Vector3(), rHand: new THREE.Vector3(), look: new THREE.Vector3(),
      lean: 0, twist: 0, bend: 0.05,
    };
    this._restTargets(desired);
    let expression = this.restExpression;
    let eyesOn = null;         // world point the eyes look at (null = wherever the head points)
    let footLift = 0;          // jiggle

    // --- continuous traits ---
    if (this.personality === 'reader' && !this.called) {
      desired.lHand.set(0.19, 0.86, 0.3);
      desired.rHand.set(-0.19, 0.86, 0.3);
      desired.look.set(0, 0.86, 0.3);
      desired.bend = 0.12;
    }
    if (this.personality === 'jiggler') {
      if (!this.called) {
        desired.lHand.set(-0.08, 0.93, 0.16); // arms crossed
        desired.rHand.set(0.08, 0.9, 0.18);
      }
      footLift = Math.max(0, Math.sin(this.time * N.jiggle.rate * Math.PI * 2)) * N.jiggle.height;
    }

    // --- talking to the player: look at them, hands down, no fidgeting ---
    if (this.attending && !this.called) {
      desired.look.copy(this.local(camera.position));
      eyesOn = camera.position;
      expression = 'neutral';
      if (this.personality === 'reader') { // magazine held lower while she talks
        desired.lHand.set(0.19, 0.7, 0.28);
        desired.rHand.set(-0.19, 0.7, 0.28);
      }
    }

    // --- personality actions on timers ---
    if (!this.called && !this.attending && !this.appalled) {
      this.nextAction -= dt;
      if (!this.action && this.nextAction <= 0) this._startAction();
      if (this.action) expression = this._runAction(dt, desired) ?? expression;

      // Everyone glances at the clock now and then
      this.nextClock -= dt;
      if (this.nextClock <= 0 && !this.action) {
        this.reaction ??= { name: 'clock', t: 0, dur: N.clockGlance.duration, delay: 0 };
        this.nextClock = rand(...N.clockGlance.every);
      }
    }

    // --- reactions (override head and face) ---
    const r = this.reaction;
    if (r) {
      r.t += dt;
      if (r.t >= r.delay) {
        const cam = camera.position;
        if (r.name === 'glance' || r.name === 'called') {
          desired.look.copy(this.local(cam));
          eyesOn = cam;
          expression = r.name === 'called' ? 'annoyed' : 'unimpressed';
        } else if (r.name === 'appalled') {
          desired.look.copy(this.local(cam));
          eyesOn = cam;
          expression = r.t - r.delay < N.onlookers.surprisedFor ? 'surprised' : 'appalled';
        } else if (r.name === 'clock') {
          desired.look.copy(this.local(this.clockPos));
          eyesOn = this.clockPos;
        }
      }
      if (r.t >= r.delay + r.dur) this.reaction = null;
    }

    // --- crowded: lean away and give the player a look ---
    if (this.crowdSide && !this.called) {
      desired.lean = this.crowdSide * N.crowdLean;
      if (!this.appalled) expression = 'unimpressed';
      eyesOn ??= camera.position;
    }

    // --- eyes follow the player when close (head stays where it was) ---
    if (!eyesOn && camera.position.distanceTo(this.rig.root.position) < N.noticeDistance && this.personality !== 'reader') {
      eyesOn = camera.position;
    }

    this.face?.setExpression(expression);
    this._solve(dt, desired, eyesOn, footLift);
  }

  _startAction() {
    const p = this.personality;
    if (p === 'cougher') {
      const n = Math.round(rand(...N.cough.coughs));
      this.action = { name: 'cough', t: 0, dur: 0.35 + n * N.cough.gap + 0.4, coughs: n, done: 0 };
      this.nextAction = rand(...N.cough.every);
    } else if (p === 'watchChecker') {
      this.action = { name: 'watch', t: 0, dur: 0.5 + N.watch.lookAtWatch + N.watch.lookAtClock + 0.5, sighed: false };
      this.nextAction = rand(...N.watch.every);
    } else if (p === 'reader') {
      this.action = { name: 'page', t: 0, dur: N.pageTurn.duration, sounded: false };
      this.nextAction = rand(...N.pageTurn.every);
    } else if (p === 'jiggler') {
      this.action = { name: 'exhale', t: 0, dur: N.exhale.duration, sounded: false };
      this.nextAction = rand(...N.exhale.every);
    } else if (p === 'sitter') {
      this.action = { name: 'shift', t: 0, dur: N.shift.duration, sounded: false, dir: Math.random() < 0.5 ? -1 : 1 };
      this.nextAction = rand(...N.shift.every);
    } else {
      this.nextAction = 999;
    }
  }

  /** Advance the current action; write into `d`. Returns an expression override or undefined. */
  _runAction(dt, d) {
    const a = this.action;
    a.t += dt;
    const u = a.t / a.dur;
    let expr;
    if (a.name === 'cough') {
      // Hand to mouth, head dips with each cough
      const mouth = this.local(this.rig.joints.head.getWorldPosition(new THREE.Vector3()))
        .add(new THREE.Vector3(0, 0.03, 0.14));
      d.rHand.copy(mouth);
      const k = Math.min(1, a.t / 0.3);
      d.rHand.lerpVectors(new THREE.Vector3(-0.13, 0.6, 0.24), mouth, smooth(k));
      const ct = a.t - 0.35;
      if (ct >= a.done * N.cough.gap && a.done < a.coughs) {
        a.done++;
        this.sfx.cough(this.voicePosition());
      }
      const sinceCough = ct - (a.done - 1) * N.cough.gap;
      const jerk = a.done > 0 && sinceCough < 0.15 ? Math.sin((sinceCough / 0.15) * Math.PI) : 0;
      d.bend += 0.12 + jerk * 0.12;
      d.look.y -= 0.6;
      expr = { lids: 0.65, brows: { angle: -0.15 }, mouth: { open: 0.25 + jerk * 0.3, width: 0.7 } };
    } else if (a.name === 'watch') {
      const W = N.watch;
      const raise = smooth(Math.min(1, a.t / 0.5)) * (1 - smooth(Math.max(0, (a.t - (a.dur - 0.5)) / 0.5)));
      d.lHand.lerp(new THREE.Vector3(0.02, 0.98, 0.3), raise);
      if (a.t < 0.5 + W.lookAtWatch) {
        const watch = this.rig.watch ?? this.rig.joints.lElbow;
        d.look.copy(this.local(watch.getWorldPosition(new THREE.Vector3())));
        expr = { lids: 0.35, brows: { raise: -0.004 }, mouth: { smile: -0.2 } };
      } else {
        d.look.copy(this.local(this.clockPos));
        if (!a.sighed) { a.sighed = true; this.sfx.sigh(this.voicePosition()); }
        expr = { lids: 0.55, brows: { angle: 0.12 }, mouth: { smile: -0.25, open: 0.15 } };
      }
    } else if (a.name === 'page') {
      // Right hand sweeps across; the page flips over the spine
      const k = smooth(Math.min(1, u));
      if (this.pagePivot) this.pagePivot.rotation.z = -Math.PI * k;
      const arc = Math.sin(k * Math.PI);
      d.rHand.set(-0.19 + 0.36 * k, 0.86 + arc * 0.08, 0.3 + arc * 0.04);
      if (!a.sounded && u > 0.2) { a.sounded = true; this.sfx.pageTurn(this.w(0, 0.88, 0.3)); }
      if (u >= 1 && this.pagePivot) this.pagePivot.rotation.z = 0; // next page lies under it
    } else if (a.name === 'exhale') {
      // Head back, long exhale at the ceiling
      const k = Math.sin(Math.min(1, u) * Math.PI);
      d.look.set(0, 0.9 + 3 * k, 3 - 1.5 * k);
      if (!a.sounded && u > 0.15) { a.sounded = true; this.sfx.sigh(this.voicePosition()); }
      expr = { lids: 0.5 + 0.3 * k, brows: { angle: 0.15 }, mouth: { open: 0.2 * k, smile: -0.2 } };
    } else if (a.name === 'shift') {
      const k = Math.sin(Math.min(1, u) * Math.PI);
      d.twist = a.dir * 0.12 * k;
      d.lean = -a.dir * 0.06 * k;
      if (!a.sounded) { a.sounded = true; this.sfx.chairShift(this.chair.object.position); }
      if (u > 0.3 && u < 0.8) d.look.copy(this.local(this.receptionistHead()));
    }
    if (a.t >= a.dur) this.action = null;
    return expr;
  }

  // ------------------------------------------------------------------ errands (get up, walk, do something, sit back down)

  /** True while they're up and about. */
  get busyElsewhere() {
    return this.walker.active || !!this.down;
  }

  /**
   * Get up, walk to `standSpot`, face `faceYaw`, reach for `reachTarget()` (onReach at contact),
   * then walk back and sit down. Called again while already up, they turn round and go again,
   * faster and angrier (anger > 0).
   */
  startErrand({ standSpot, faceYaw, reachTarget, onReach, anger = 0 }) {
    const A = N.anger;
    const opts = { speedMul: Math.min(A.maxSpeed, 1 + anger * A.speedPerLevel), anger };
    const there = [
      { type: 'walk', to: standSpot, leg: 'there' },
      { type: 'face', yaw: faceYaw, leg: 'there' },
      { type: 'reach', target: reachTarget, onReach, leg: 'there' },
    ];
    const back = [
      { type: 'walk', to: 'front', glare: anger > 0, leg: 'back' },
      { type: 'turn', yaw: 'chair', leg: 'back' },
      { type: 'sit', leg: 'back' },
    ];
    const wk = this.walker;
    if (!wk.active) {
      this.attending = false;
      this.action = null;
      this.reaction = null;
      wk.start([{ type: 'rise' }, ...there, ...back], opts);
      return;
    }
    const cur = wk.current;
    if (cur.type === 'sit') {
      // Half sat down: back up from where she is
      const startT = (1 - Math.min(1, wk.t / N.walk.sitTime)) * N.walk.riseTime;
      wk.start([{ type: 'rise', startT }, ...there, ...back], opts);
    } else if (cur.leg === 'back') {
      wk.start([...there, ...back], opts);            // turn straight round
    } else if (cur.type === 'reach') {
      wk.start([there[2], ...back], opts);            // reach again
    } else {
      // Still on the way there: just hurry up
      wk.speedMul = opts.speedMul;
      wk.anger = anger;
      for (const st of wk.steps) {
        if (st.type === 'reach') st.onReach = onReach;
        if (st.leg === 'back' && st.type === 'walk') st.glare = anger > 0;
      }
    }
  }

  // ------------------------------------------------------------------ the radio war

  /**
   * Come for the player with an attack (config.npc.attacks), then deal with the radio.
   * kind 'radio': fetch the radio first, hit the player with it, put it back (playing), sit.
   */
  startViolence({ kind, target, onHit, radio, anger }) {
    const A = N.anger;
    // `violent` while she's out of her chair for this (the player's fists are up only then)
    this.violent = true;
    const opts = { speedMul: Math.min(A.maxSpeed, 1 + anger * A.speedPerLevel), anger, onDone: () => { this.violent = false; } };
    const V = N.violence;
    const approach = { type: 'approach', target, distance: V.approachDistance, timeout: 25 };
    const attack = { type: 'attack', kind, target, onHit };
    const toRadio = [
      { type: 'walk', to: radio.standSpot },
      { type: 'face', yaw: radio.faceYaw },
    ];
    const back = [
      { type: 'walk', to: 'front', glare: true, leg: 'back' },
      { type: 'turn', yaw: 'chair', leg: 'back' },
      { type: 'sit', leg: 'back' },
    ];
    let steps;
    if (kind === 'radio') {
      steps = [
        ...toRadio,
        { type: 'reach', target: radio.reachTarget, onReach: () => { radio.onReach(); this.carrying = radio; } },
        approach, attack,
        ...toRadio,
        { type: 'reach', target: radio.reachTarget, onReach: () => { this.carrying = null; radio.putBack(); } },
        ...back,
      ];
    } else {
      steps = [approach, attack, ...toRadio, { type: 'reach', target: radio.reachTarget, onReach: radio.onReach }, ...back];
    }
    const wk = this.walker;
    if (!wk.active) {
      this.attending = false; this.action = null; this.reaction = null;
      wk.start([{ type: 'rise' }, ...steps], opts);
    } else if (wk.current.type === 'sit') {
      const startT = (1 - Math.min(1, wk.t / N.walk.sitTime)) * N.walk.riseTime;
      wk.start([{ type: 'rise', startT }, ...steps], opts);
    } else {
      wk.start(steps, opts);
    }
  }

  // ------------------------------------------------------------------ the brawl

  /**
   * Join the brawl (src/level/brawl.js): run `first` steps, then whatever brawl.plan() hands
   * over, round after round, until knocked down.
   */
  startBrawl(first, brawl) {
    this.brawling = true;
    this.called = true; // no more fidgeting, small talk or reactions
    if (this.chair?.occupant === this.id) this.chair.occupant = null; // up for good: the chair's free (to throw)
    this.attending = false; this.action = null; this.reaction = null;
    const opts = { speedMul: config.brawl.speed, anger: 2, refill: () => brawl.plan(this) };
    const wk = this.walker;
    if (!wk.active) wk.start([{ type: 'rise' }, ...first], opts);
    else if (wk.current?.type === 'sit') {
      const startT = (1 - Math.min(1, wk.t / N.walk.sitTime)) * N.walk.riseTime;
      wk.start([{ type: 'rise', startT }, ...first], opts);
    } else wk.start(first, opts);
  }

  /**
   * The newcomer's move (placeholder until the argument scene is written): fetch the check-in
   * clipboard from the counter, walk up to the player and smash it over his head. onSmash fires
   * at the moment of impact; then he keeps fighting (brawl.plan()).
   */
  startClipboardSmash({ clipboard, target, onSmash, brawl }) {
    // If the player is holding the clipboard himself, the newcomer just punches him instead
    const fetch = clipboard.isHeld() ? [] : [
      { type: 'walk', to: clipboard.standSpot },
      { type: 'face', yaw: clipboard.faceYaw },
      { type: 'reach', target: clipboard.reachTarget, onReach: () => { if (!clipboard.isHeld()) { clipboard.take(); this.carrying = clipboard; } } },
    ];
    this.startBrawl([
      ...fetch,
      { type: 'approach', target, distance: N.violence.approachDistance, timeout: 15 },
      {
        type: 'attack', kind: fetch.length ? 'clipboard' : 'punch', target,
        onHit: (kind) => {
          if (this.carrying === clipboard) { this.carrying = null; clipboard.drop(target()); }
          onSmash(kind);
        },
      },
    ], brawl);
  }

  /**
   * Arrive from outside: walk in through `door` (outside -> inside), take a ticket from the
   * dispenser (onTicket at the moment of taking it), then walk to their chair and sit.
   */
  arrive({ door, dispenserSpot, dispenserTarget, onTicket }) {
    this.walker.start([
      { type: 'walk', to: door.inside },
      { type: 'walk', to: dispenserSpot },
      { type: 'face', yaw: Math.PI }, // facing the counter (north)
      { type: 'reach', target: dispenserTarget, onReach: onTicket },
      { type: 'walk', to: 'front' },
      { type: 'turn', yaw: 'chair' },
      { type: 'sit' },
    ], { startPos: door.outside, startYaw: Math.PI });
  }

  /** Hit by the player (fist, weapon or something thrown). Flinch; at 0 health, go down and stay down. */
  takeHit(dir, { damage = config.combat.punchDamage, knock = 1 } = {}) {
    if (this.down) return;
    this.health = (this.health ?? config.brawl.health) - damage;
    this.walker.stun = 0.35;
    this.flinch = 0.35;
    if (this.health <= 0) this._knockDown(dir, knock);
  }

  _knockDown(dir, knock = 1) {
    this.down = true;
    this.rig.root.visible = true;
    this.walker.steps = null; // abandon whatever they were doing
    if (this.carrying) { this.carrying.drop(this.rig.root.position.clone()); this.carrying = null; }
    if (this.chair?.occupant === this.id) this.chair.occupant = null;
    // Full physics ragdoll from the current pose, thrown along the blow
    this.ragdoll = new Ragdoll(this.physics, this.rig);
    this.ragdoll.push(dir, config.ragdoll.hitImpulse * knock);
    this.face?.setExpression({ lids: 1, brows: { angle: 0.2 }, mouth: { open: 0.35, width: 0.8 } }, 6);
  }

  _updateDown(dt) {
    this.ragdoll.update(dt, (pos, strength) => this.sfx.bodyThud(pos, strength));
    this.face?.update(dt);
  }

  /** The host interface the Walker needs (see walker.js). */
  _walkerHost() {
    const self = this;
    return {
      rig: this.rig, sfx: this.sfx, face: this.face,
      seatRoot: this.seatRoot, seatQuat: this.chair.object.quaternion.clone(), chairYaw: this.chairYaw,
      frontOffset: 0.34,
      w: (x, y, z) => self.w(x, y, z),
      seatedFoot: (side) => self.w(side * 0.11, 0, 0.44),
      seatedHand: (side) => self.w(side * 0.13, 0.6, 0.24),
      // Carrying the radio in front of her
      carryHand: (side, wk) => (self.carrying
        ? wk.pos.clone().addScaledVector(new THREE.Vector3(Math.cos(wk.yaw), 0, -Math.sin(wk.yaw)), side * 0.13)
          .addScaledVector(new THREE.Vector3(Math.sin(wk.yaw), 0, Math.cos(wk.yaw)), 0.32).setY(1.0 * self.rig.scale)
        : null),
      expression: (wk) => {
        if (self.brawling) return 'furious';
        if (self.called) return 'annoyed';
        const ladder = N.anger.expressions;
        return wk.anger > 0 ? ladder[Math.min(ladder.length - 1, wk.anger - 1)] : 'bored';
      },
    };
  }

  _solve(dt, d, eyesOn, footLift) {
    const t = this.t;
    const k = 1 - Math.exp(-8 * dt);
    t.lHand.lerp(d.lHand, k);
    t.rHand.lerp(d.rHand, k);
    t.look.lerp(d.look, 1 - Math.exp(-N.headTurnSpeed * dt));
    t.lean += (d.lean - t.lean) * k;
    t.twist += (d.twist - t.twist) * k;
    t.bend += (d.bend - t.bend) * k;

    const j = this.rig.joints, L = this.rig.lengths;
    const breathe = Math.sin(this.time * 1.5) * 0.008;
    this.flinch = Math.max(0, (this.flinch ?? 0) - dt);
    j.spine.rotation.set(t.bend + breathe - this.flinch * 0.8, t.twist, t.lean);
    this.rig.root.updateMatrixWorld(true);

    const q = this.chair.object.quaternion;
    const dir = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q).normalize();

    // Legs: feet flat on the floor in front of the chair
    solveTwoBone(j.lHip, j.lKnee, this.w(0.11, 0, 0.44), L.upperLeg, L.lowerLeg, dir(0, 0.3, 1));
    solveTwoBone(j.rHip, j.rKnee, this.w(-0.11, footLift, 0.44), L.upperLeg, L.lowerLeg, dir(0, 0.3, 1));

    // Arms
    j.spine.updateMatrixWorld(true);
    solveTwoBone(j.lShoulder, j.lElbow, this.w(t.lHand.x, t.lHand.y, t.lHand.z), L.upperArm, L.lowerArm, dir(0.6, -0.4, -1));
    solveTwoBone(j.rShoulder, j.rElbow, this.w(t.rHand.x, t.rHand.y, t.rHand.z), L.upperArm, L.lowerArm, dir(-0.6, -0.4, -1));

    // Head
    aimJoint(j.neck, this.w(t.look.x, t.look.y, t.look.z), { maxYaw: 1.3, maxPitch: 0.6, alpha: 1 });

    // Face
    if (this.face) {
      this.face.lookAt(eyesOn ?? this.w(t.look.x, t.look.y, t.look.z));
      this.face.update(dt);
    }

    // Props that follow the hands
    if (this.magazine) {
      // Held up while reading; lowered into the lap once she has something better to stare at
      this.magDown = THREE.MathUtils.lerp(this.magDown ?? 0, this.called || this.attending ? 1 : 0, k);
      const m = this.magDown;
      this.magazine.position.copy(this.w(0, THREE.MathUtils.lerp(0.86, 0.6, m), THREE.MathUtils.lerp(0.31, 0.2, m)));
      this.magazine.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.lerp(-0.95, -0.1, m), 0, 0)));
    }

    // Watch tick (very quiet, positional): only audible up close
    if (this.rig.watch) {
      const sec = Math.floor(this.time);
      if (sec !== this.lastWatchSecond) {
        this.lastWatchSecond = sec;
        this.sfx.watchTick(this.rig.watch.getWorldPosition(new THREE.Vector3()));
      }
    }
  }
}
