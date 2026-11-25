import * as THREE from 'three';
import { config } from '../config.js';
import { solveTwoBone, aimJoint } from './rig.js';

/*
  Getting up, walking about and sitting back down, for any seated character.
  Used by waiting-room NPCs (the radio) and the receptionist (the coffee run).

  A walk is a list of steps, run in order:
    { type: 'rise' }                          stand up from the chair (startT: begin part-way)
    { type: 'walk', to, glare? }              walk to a floor point; to = Vector3 or 'front' (in front of the chair)
    { type: 'face', yaw } / { type: 'turn', yaw }  turn on the spot; yaw = radians or 'chair'
    { type: 'reach', target(), onReach() }    bend and reach with the right hand; onReach at contact
    { type: 'away', seconds, onAway(), onBack() }  out of sight (e.g. through a door) for a while
    { type: 'sit' }                           sit back down
    { type: 'getUp' }                         up off the floor (after a knockdown), from a crouch
    { type: 'leap', to, face?, height, duration, flip? }  a ninja leap to `to` (Vector3 or () => Vector3), facing
                                              face() (else the way they jump); crouch, fly (legs tucked),
                                              land in a crouch. flip: 1 = a front flip, -1 = a backflip
    { type: 'approach', target(), distance, timeout? }   walk up to a moving target (the player)
    { type: 'attack', kind, target(), onHit(kind) }      an attack (config.npc.attacks); onHit at impact
  Any step may carry `leg: 'there' | 'back'` so callers can redirect a walk in progress.

  The host provides:
    rig, sfx, face?, seatRoot (Vector3), seatQuat (Quaternion), chairYaw,
    w(x, y, z) chair-local -> world, frontOffset (how far in front of the chair to stand),
    seatedFoot(side) / seatedHand(side) -> world points for the seated pose (side +1 = their left),
    expression(walker) -> preset name (optional)
    gait (optional): { bob, waddle, steps } a heavier walk: bob = x the usual up-and-down, waddle = side-to-side
      roll (radians), steps = footsteps every stride (a stomp at this anger; negative = softer)
    hipWidth / shoulderWidth (optional): feet and hands further apart (x)
*/

const W = () => config.npc.walk;
const lerp3 = (a, b, k) => a.clone().lerp(b, k);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/*
  Fighting stances, in body space (x = their left, y = height above the floor, z = towards the
  target), for loop progress u (0..1): they bounce lightly from foot to foot. Besides hands:
    lFoot / rFoot  where the feet go (y = lifted)        drop   knees bent (m lower)
    turn           the hips turned side-on (radians)     shift  the weight forward/back (m)
    lean           the upper body forward (+) / back (-)
    hop            both feet off the floor (m): a ninja's bounce (config.brawl.ninja.hop)
*/
const TAU = Math.PI * 2;
export const STANCES = {
  // Side-on, left foot forward, knees bent; the lead hand open and forward, the rear hand guarding the chin
  karate: (u) => {
    const w = Math.sin(u * TAU);
    return {
      hop: config.brawl.ninja.hop * Math.abs(w),
      lFoot: V(0.13, Math.max(0, -w) * 0.035, 0.24), rFoot: V(-0.15, Math.max(0, w) * 0.035, -0.2),
      drop: 0.09 + 0.025 * Math.abs(w), turn: 0.5, shift: 0.045 * w, lean: 0.06,
      l: V(0.16, 1.34 - 0.02 * Math.abs(w), 0.5), r: V(-0.14, 1.22 - 0.02 * Math.abs(w), 0.2),
    };
  },
  // Old-fashioned bare-knuckle boxing: upright, leaning back a little, fists out in front, rolling in small circles
  boxing: (u) => {
    const w = Math.sin(u * TAU), c = Math.cos(u * TAU);
    return {
      hop: config.brawl.ninja.hop * 0.7 * Math.abs(w),
      lFoot: V(0.11, Math.max(0, -w) * 0.03, 0.17), rFoot: V(-0.12, Math.max(0, w) * 0.03, -0.12),
      drop: 0.03 + 0.02 * Math.abs(w), turn: 0.3, shift: 0.035 * w, lean: -0.1,
      l: V(0.15, 1.2 + 0.06 * w, 0.52 + 0.06 * c), r: V(-0.11, 1.3 - 0.06 * w, 0.3 - 0.06 * c),
    };
  },
};

/*
  Attack poses, in body space (as above). Each returns hand/foot targets and a lean for local progress
  u (0..1) through the attack, starting from and returning to R (the stance's hands; GUARD without one).
  Wind up until 0.45, strike until 0.6, recover after.
*/
const GUARD = { l: V(0.2, 1.05, 0.15), r: V(-0.2, 1.05, 0.15) };
const phase3 = (u, rest, wind, strike) =>
  u < 0.45 ? lerp3(rest, wind, smooth(u / 0.45))
    : u < 0.6 ? lerp3(wind, strike, smooth((u - 0.45) / 0.15))
      : lerp3(strike, rest, smooth((u - 0.6) / 0.4));
const leanOf = (u, wind, strike) => (u < 0.45 ? wind * smooth(u / 0.45) : u < 0.6 ? wind + (strike - wind) * smooth((u - 0.45) / 0.15) : strike * (1 - smooth((u - 0.6) / 0.4)));
const ATTACK_POSES = {
  // Held poses (the 'hold' step): fists up, or one fist pumping in the air (u loops 0..1)
  guard: () => ({ l: GUARD.l, r: GUARD.r, lean: 0 }),
  cheer: (u) => ({ l: GUARD.l, r: V(-0.2, 1.62 + 0.14 * Math.sin(u * Math.PI * 2), 0.12), lean: -0.04 }),
  slap: (u, R = GUARD) => ({ l: R.l, r: phase3(u, R.r, V(-0.45, 1.35, -0.05), V(0.25, 1.4, 0.5)), lean: leanOf(u, -0.05, 0.15) }),
  shove: (u, R = GUARD) => ({
    l: phase3(u, R.l, V(0.14, 1.1, 0.05), V(0.16, 1.25, 0.62)),
    r: phase3(u, R.r, V(-0.14, 1.1, 0.05), V(-0.16, 1.25, 0.62)),
    lean: leanOf(u, -0.1, 0.3),
  }),
  punch: (u, R = GUARD) => ({ l: R.l, r: phase3(u, R.r, V(-0.22, 1.25, -0.15), V(-0.05, 1.45, 0.72)), lean: leanOf(u, -0.05, 0.2) }),
  kick: (u, R = GUARD) => ({
    l: V(0.32, 1.1, 0.0), r: V(-0.32, 1.1, 0.0),
    rFoot: phase3(u, R.rFoot ?? V(-0.1, 0, 0), V(-0.1, 0.25, -0.25), V(-0.1, 0.75, 0.72)),
    lean: leanOf(u, -0.05, -0.3),
  }),
  // Karate: the knife hand raised high beside the head, brought down on the neck
  chop: (u, R = GUARD) => ({ l: R.l, r: phase3(u, R.r, V(-0.28, 1.85, -0.02), V(-0.02, 1.3, 0.62)), lean: leanOf(u, -0.08, 0.25) }),
  // Karate: the back leg swings round in an arc, the hips turning through
  roundhouse: (u, R = GUARD) => ({
    l: V(0.3, 1.2, 0.12), r: V(-0.25, 1.05, -0.05),
    rFoot: u < 0.45 ? lerp3(R.rFoot ?? V(-0.1, 0, 0), V(-0.45, 0.55, -0.1), smooth(u / 0.45))
      : u < 0.6 ? lerp3(V(-0.45, 0.55, -0.1), V(0.05, 1.0, 0.68), smooth((u - 0.45) / 0.15))
        : lerp3(V(0.05, 1.0, 0.68), R.rFoot ?? V(-0.1, 0, 0), smooth((u - 0.6) / 0.4)),
    turn: (R.turn ?? 0) + leanOf(u, 0.5, -0.6),
    lean: leanOf(u, -0.1, -0.35),
  }),
  // Boxing: the lead hand, straight out and straight back
  jab: (u, R = GUARD) => ({ l: phase3(u, R.l, V(0.1, 1.22, 0.32), V(0.06, 1.42, 0.78)), r: R.r, lean: leanOf(u, 0, 0.12) }),
  // The receptionist's phone: hand to her hip pocket, then held up in front of her face, filming
  pocket: () => ({ l: V(0.22, 0.95, 0.12), r: V(-0.34, 0.92, 0.02), lean: 0.04 }),
  film: (u) => ({ l: V(0.07, 1.5, 0.55), r: V(-0.07, 1.52 + 0.01 * Math.sin(u * Math.PI * 2), 0.56), lean: -0.03 }),
  radio: (u, R = GUARD) => ({
    l: phase3(u, V(0.12, 1.0, 0.3), V(0.12, 1.9, -0.05), V(0.12, 1.1, 0.62)),
    r: phase3(u, V(-0.12, 1.0, 0.3), V(-0.12, 1.9, -0.05), V(-0.12, 1.1, 0.62)),
    lean: leanOf(u, -0.15, 0.35),
  }),
};
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const UP = new THREE.Vector3(0, 1, 0);

export class Walker {
  constructor(host) {
    this.host = host;
    this.steps = null;
  }

  get active() {
    return !!this.steps;
  }

  get current() {
    return this.steps?.[this.i] ?? null;
  }

  /** Start (or, if already up, replace) the step list. Resolves when they're seated again. */
  start(steps, { speedMul = 1, anger = 0, onDone, startPos, startYaw, refill = null } = {}) {
    const h = this.host;
    if (!this.steps) {
      const front = h.w(0, 0, h.frontOffset ?? 0.34);
      front.y = 0;
      this.front = front;
      this.pos = startPos ? startPos.clone().setY(0) : front.clone(); // e.g. arriving from outside
      this.yaw = startYaw ?? h.chairYaw;
      this.phase = 0;
      this.moving = 0;
      this.lastStep = 0;
    }
    this.steps = steps;
    this.i = 0;
    this.t = steps[0]?.startT ?? 0;
    this.speedMul = speedMul;
    this.anger = anger;
    this.onDone = onDone;
    this.refill = refill;
    this.blocked = false;
    for (const s of steps) s.started = false;
  }

  _next() {
    this.i++;
    this.t = this.steps[this.i]?.startT ?? 0;
    if (this.i >= this.steps.length) {
      // An endless routine (the brawl) hands over its next steps instead of sitting down
      const more = this.refill?.();
      if (more?.length) {
        this.steps = more;
        this.i = 0;
        this.t = 0;
        for (const st of more) st.started = false;
        return;
      }
      this._finish();
    }
  }

  _finish() {
    const h = this.host, root = h.rig.root;
    root.position.copy(h.seatRoot);
    root.quaternion.copy(h.seatQuat);
    root.visible = true;
    this.steps = null;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  /** Pushed aside (the brawl keeps people out of each other): mid-leap, the whole leap shifts with them. */
  nudge(dx, dz) {
    if (!this.pos) return;
    this.pos.x += dx; this.pos.z += dz;
    const S = this.current;
    if (S?.type === 'leap' && S.from) {
      S.from.x += dx; S.from.z += dz;
      S.dest.x += dx; S.dest.z += dz;
    }
  }

  /** Advance and pose. Call every frame while active (instead of the host's own pose). */
  update(dt, camera) {
    const h = this.host, rig = h.rig, j = rig.joints, L = rig.lengths, root = rig.root;
    const S = this.current;
    if (!S) return;
    const first = !S.started;
    S.started = true;
    this.t += dt * this.speedMul;
    const cfg = W();
    let sit = 0, bend = 0.06, reach = 0, look = null, expressionOverride = null, pose = null;
    let air = 0, flip = 0, tuck = 0; // a leap: height off the floor, flip angle, legs tucked (0..1)
    // Flinching from a hit: freeze in place for a moment, leaning back
    if (this.stun > 0) {
      this.stun -= dt;
      bend = -0.25 * Math.min(1, this.stun / 0.2);
      expressionOverride = 'surprised';
    }

    const turnTowards = (goal) => {
      let d = goal - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.sign(d) * Math.min(Math.abs(d), cfg.turnSpeed * this.speedMul * dt);
      return Math.abs(d) < 0.04;
    };
    const walkTowards = (target, ignorePlayer = false) => {
      const to = target.clone().sub(this.pos); to.y = 0;
      const dist = to.length();
      if (dist < 0.03) { this.moving = Math.max(0, this.moving - dt * 4); return true; }
      turnTowards(Math.atan2(to.x, to.z));
      // Someone in the way? Stop and wait for them to move (and look at them).
      const ahead = this.pos.clone().addScaledVector(to.clone().normalize(), 0.35);
      const cam = camera.position;
      this.blocked = !ignorePlayer && Math.hypot(cam.x - ahead.x, cam.z - ahead.z) < cfg.personalSpace;
      if (this.blocked) {
        this.moving = Math.max(0, this.moving - dt * 4);
        expressionOverride = 'unimpressed';
        look = cam.clone();
        return false;
      }
      const step = Math.min(dist, cfg.speed * this.speedMul * dt);
      this.pos.addScaledVector(to.normalize(), step);
      this.phase += (step / cfg.stride) * Math.PI;
      this.moving = Math.min(1, this.moving + dt * 4);
      return false;
    };
    const yawOf = (y) => (y === 'chair' ? h.chairYaw : y);
    // Stuck (walking, but getting no closer: someone in the way)? Step aside first (a short walk to one
    // side, to the right the first time, then the other way), then carry on with this step.
    const watchStuck = (goal) => {
      // (waiting for the player to get out of the way is on purpose, except in a fight: then they go round him)
      if (this.blocked && !this.refill) { S.stuckT = 0; return false; }
      const d = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
      if (S.best === undefined || d < S.best - 0.04) { S.best = d; S.stuckT = 0; return false; }
      S.stuckT = (S.stuckT ?? 0) + dt;
      if (S.stuckT < cfg.stuckAfter || d < 0.3) return false;
      S.stuckT = 0; S.best = undefined;
      // Nearly there, but someone's standing on the spot: close enough
      if (d < cfg.closeEnough) { this.moving = 0; this._next(); return true; }
      this.detourSide = -(this.detourSide ?? 1); // right (-1 x left) first, then alternate
      const to = new THREE.Vector3(goal.x - this.pos.x, 0, goal.z - this.pos.z).normalize();
      const side = new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(this.detourSide); // left of the way (x side)
      const at = this.pos.clone().addScaledVector(side, cfg.detour).addScaledVector(to, cfg.detour * 0.4).setY(0);
      this.steps.splice(this.i, 0, { type: 'walk', to: at, pushThrough: true, detour: true });
      this.t = 0;
      return true;
    };

    switch (S.type) {
      case 'rise':
        sit = 1 - smooth(this.t / cfg.riseTime);
        bend = 0.06 + Math.sin(Math.min(1, this.t / cfg.riseTime) * Math.PI) * 0.4;
        if (this.t >= cfg.riseTime) this._next();
        break;
      case 'walk':
        if (S.glare) look = camera.position.clone();
        // pushThrough: don't wait for the player to get out of the way
        if (walkTowards(S.to === 'front' ? this.front : S.to, S.pushThrough)) this._next();
        else if (!S.detour) watchStuck(S.to === 'front' ? this.front : S.to);
        else if (this.t / this.speedMul > 1.5) this._next(); // (a detour that can't be walked either: give up on it)
        break;
      case 'face':
      case 'turn':
        if (turnTowards(yawOf(S.yaw))) this._next();
        break;
      case 'reach': {
        const u = this.t / cfg.reachTime;
        bend = 0.06 + Math.sin(Math.min(1, u) * Math.PI) * 0.45;
        reach = Math.sin(Math.min(1, u) * Math.PI);
        look = S.target();
        if (!S.reached && u >= 0.5) { S.reached = true; S.onReach?.(); }
        if (u >= 1) this._next();
        break;
      }
      case 'away':
        if (first) { root.visible = false; S.onAway?.(); }
        // `seconds` is real waiting time, not sped up by anger
        if (this.t / this.speedMul >= S.seconds) { root.visible = true; S.onBack?.(); this._next(); }
        break;
      case 'approach': {
        // Walk up to the target (or to the spot S.at(), e.g. a flank), then turn to face the target
        const tgt = S.target();
        look = tgt.clone();
        S.elapsed = (S.elapsed ?? 0) + dt;
        const flat = (S.at ? S.at() : tgt).clone().setY(0);
        const dist = Math.hypot(flat.x - this.pos.x, flat.z - this.pos.z);
        if (dist <= (S.at ? 0.12 : S.distance) || S.elapsed > (S.timeout ?? 20)) {
          this.moving = Math.max(0, this.moving - dt * 4);
          if (turnTowards(Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z))) this._next();
        } else if (this.stun <= 0 || !this.stun) {
          if (!walkTowards(flat, true)) watchStuck(flat);
        }
        break;
      }
      case 'attack': {
        const A = config.npc.attacks;
        const def = A[S.kind];
        const realT = this.t / this.speedMul; // attacks play at their own pace
        const u = Math.min(1, realT / def.duration);
        const tgt = S.target();
        look = tgt.clone();
        turnTowards(Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z));
        this.moving = Math.max(0, this.moving - dt * 4);
        // A combo is several attacks back to back
        const seq = def.sequence ?? [S.kind];
        const k = Math.min(seq.length - 1, Math.floor(u * seq.length));
        const sub = u * seq.length - k;
        // From their fighting stance (in the brawl), feet planted where the stance has them
        const stance = h.isFighting?.() ? STANCES[h.stance?.() ?? 'karate'](0) : null;
        pose = { ...(stance ?? {}), ...ATTACK_POSES[A[seq[k]]?.pose ?? seq[k]](Math.min(1, sub), stance ?? undefined) };
        S.done ??= 0;
        if (S.done <= k && sub >= 0.55) { S.done = k + 1; S.onHit?.(seq[k]); }
        if (u >= 1) this._next();
        break;
      }
      case 'hold': {
        // Stand still facing the target for a while (hanging back, shouting, winding up)
        this.moving = Math.max(0, this.moving - dt * 4);
        if (S.target) {
          const tgt = S.target();
          look = tgt.clone();
          turnTowards(Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z));
        }
        // 'stance': their fighting stance (config.brawl.stances), bouncing from foot to foot
        if (S.pose === 'stance') pose = STANCES[h.stance?.() ?? 'karate'](((this.t / this.speedMul) * config.brawl.bounceRate + (this.bouncePhase ??= Math.random())) % 1);
        else if (S.pose) pose = ATTACK_POSES[S.pose](S.poseAt ?? ((this.t / this.speedMul) * 1.6) % 1);
        if (S.expression) expressionOverride ??= S.expression;
        if (this.t / this.speedMul >= S.seconds || S.until?.()) this._next();
        break;
      }
      case 'leap': {
        // Crouch (0..0.18), fly (..0.85), land in a crouch. At its own pace, not sped up.
        if (first) {
          S.from = this.pos.clone();
          S.dest = (typeof S.to === 'function' ? S.to() : S.to).clone().setY(0);
          // Never further than config.brawl.ninja.maxLeap (it falls short)
          const d = S.dest.clone().sub(S.from).setY(0), max = config.brawl.ninja.maxLeap;
          if (d.length() > max) S.dest.copy(S.from).addScaledVector(d.setLength(max), 1).setY(0);
          h.sfx.whoosh?.(this.pos.clone().setY(1));
        }
        const u = Math.min(1, this.t / this.speedMul / S.duration);
        const k = u < 0.18 ? 0 : u > 0.85 ? 1 : (u - 0.18) / 0.67;
        this.pos.lerpVectors(S.from, S.dest, smooth(k));
        this.moving = 0;
        const faceAt = S.face?.() ?? S.dest.clone().add(S.dest.clone().sub(S.from));
        turnTowards(Math.atan2(faceAt.x - this.pos.x, faceAt.z - this.pos.z));
        if (S.face) look = S.face();
        air = 4 * S.height * k * (1 - k);
        flip = (S.flip ?? 0) * TAU * smooth(k);
        tuck = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
        const crouch = u < 0.18 ? Math.sin((u / 0.18) * Math.PI * 0.5) : u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) : 0;
        const st = h.isFighting?.() ? STANCES[h.stance?.() ?? 'karate'](0) : null;
        pose = { ...(st ?? {}), hop: 0, drop: 0.2 * crouch, lean: 0.25 * crouch + 0.2 * tuck };
        if (k >= 1 && !S.landed) { S.landed = true; h.sfx.stomp?.(this.pos, 1.5); }
        if (u >= 1) this._next();
        break;
      }
      case 'getUp': {
        // Up off the floor: from a deep crouch, hands on her knees, to standing (a shake of the head)
        const k = smooth(Math.min(1, this.t / cfg.getUpTime));
        pose = {
          drop: 0.75 * (1 - k), lean: 0.9 * (1 - k),
          l: V(0.2, 0.55 + 0.5 * k, 0.25), r: V(-0.2, 0.55 + 0.5 * k, 0.25),
        };
        look = this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) + Math.sin(this.t * 9) * 0.3 * (1 - k), 1.2 - (1 - k), Math.cos(this.yaw)));
        expressionOverride = k < 0.6 ? 'surprised' : 'furious';
        if (this.t >= cfg.getUpTime) this._next();
        break;
      }
      case 'sit':
        sit = smooth(this.t / cfg.sitTime);
        bend = 0.06 + Math.sin(Math.min(1, this.t / cfg.sitTime) * Math.PI) * 0.4;
        if (this.t >= cfg.sitTime) { this._finish(); return; }
        break;
    }
    if (!this.steps) return;

    // Stomping once they're angry (positional); a heavy walker's every step is heard
    const G = h.gait ?? {};
    if ((this.anger > 0 || G.steps != null) && this.moving > 0.5 && Math.floor(this.phase / Math.PI) !== this.lastStep) {
      this.lastStep = Math.floor(this.phase / Math.PI);
      h.sfx.stomp(this.pos, Math.max(this.anger, G.steps ?? 0));
    }

    // --- body: between the seat and standing ---
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const bob = -Math.abs(Math.sin(this.phase)) * 0.02 * (G.bob ?? 1) * this.moving;
    const hop = (pose?.hop ?? 0) * rig.scale;
    const standRoot = this.pos.clone().setY(-0.03 + bob - (pose?.drop ?? 0) * rig.scale + hop + air);
    if (pose?.shift) standRoot.addScaledVector(fwd, pose.shift * rig.scale);
    // A stance turns the hips side-on (the chest turns back halfway, towards the target)
    const standQuat = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw + (pose?.turn ?? 0));
    if (flip) {
      // Somersault round the hips (+ = forwards, head first)
      const fq = new THREE.Quaternion().setFromAxisAngle(left, flip);
      const pivot = standRoot.clone().add(new THREE.Vector3(0, 0.9 * rig.scale, 0));
      standRoot.sub(pivot).applyQuaternion(fq).add(pivot);
      standQuat.premultiply(fq);
    }
    root.position.lerpVectors(standRoot, h.seatRoot, sit);
    // Waddle: rolling onto each foot in turn
    if (G.waddle) standQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.cos(this.phase) * G.waddle * this.moving));
    root.quaternion.copy(standQuat).slerp(h.seatQuat, sit);
    j.spine.rotation.set(bend + (pose?.lean ?? 0), -(pose?.turn ?? 0) * 0.5, 0);
    root.updateMatrixWorld(true);
    const bodyPoint = (p) => this.pos.clone().addScaledVector(left, p.x).addScaledVector(fwd, p.z).setY(p.y * rig.scale);

    // --- feet ---
    const stride = 0.13 * this.moving;
    for (const side of [1, -1]) {
      const ph = this.phase + (side === 1 ? 0 : Math.PI);
      const foot = this.pos.clone()
        .addScaledVector(left, side * 0.1 * rig.scale * (h.hipWidth ?? 1))
        .addScaledVector(fwd, Math.sin(ph) * stride);
      foot.y = Math.max(0, Math.cos(ph)) * 0.06 * this.moving;
      foot.lerp(h.seatedFoot(side), sit);
      const planted = side === 1 ? pose?.lFoot : pose?.rFoot;
      if (planted) foot.copy(bodyPoint(planted));
      foot.y += hop;
      // In the air: knees up, feet tucked under (they turn with the body in a flip)
      if (tuck > 0) foot.lerp(root.localToWorld(new THREE.Vector3(side * 0.12, 0.42 * rig.scale, 0.18 * rig.scale)), tuck);
      const [hip, knee] = side === 1 ? [j.lHip, j.lKnee] : [j.rHip, j.rKnee];
      solveTwoBone(hip, knee, foot, L.upperLeg, L.lowerLeg, fwd.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize());
    }

    // --- arms: swinging at the sides; the right hand reaches ---
    j.spine.updateMatrixWorld(true);
    const shoulderY = root.position.y + 0.8 * rig.scale;
    for (const side of [1, -1]) {
      const swing = Math.sin(this.phase + (side === 1 ? Math.PI : 0)) * 0.12 * this.moving;
      const hand = this.pos.clone().addScaledVector(left, side * 0.24 * (h.shoulderWidth ?? 1)).addScaledVector(fwd, 0.05 + swing);
      hand.y = shoulderY - 0.05;
      hand.lerp(h.seatedHand(side), sit);
      if (side === -1 && reach > 0) hand.lerp(S.target(), reach);
      const carried = h.carryHand?.(side, this);
      if (carried) hand.copy(carried);
      if (pose?.l) hand.copy(bodyPoint(side === 1 ? pose.l : pose.r)).add(new THREE.Vector3(0, hop + air, 0));
      if (tuck > 0) hand.lerp(root.localToWorld(new THREE.Vector3(side * 0.2, 0.85 * rig.scale, 0.3 * rig.scale)), tuck);
      (this.hands ??= {})[side] = hand.clone();
      const [sh, el] = side === 1 ? [j.lShoulder, j.lElbow] : [j.rShoulder, j.rElbow];
      const pole = left.clone().multiplyScalar(side * 0.6).addScaledVector(fwd, -1).add(new THREE.Vector3(0, -0.4, 0)).normalize();
      solveTwoBone(sh, el, hand, L.upperArm, L.lowerArm, pole);
    }

    // --- head and face ---
    const lookAt = look ?? this.pos.clone().addScaledVector(fwd, 3).setY(1.2);
    aimJoint(j.neck, lookAt, { maxYaw: 1.1, maxPitch: 0.6, alpha: 1 - Math.exp(-config.npc.headTurnSpeed * dt) });
    if (h.face) {
      h.face.setExpression(expressionOverride ?? h.expression?.(this) ?? 'bored');
      h.face.lookAt(lookAt);
      h.face.update(dt);
    }
  }
}
