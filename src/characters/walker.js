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
  Any step may carry `leg: 'there' | 'back'` so callers can redirect a walk in progress.

  The host provides:
    rig, sfx, face?, seatRoot (Vector3), seatQuat (Quaternion), chairYaw,
    w(x, y, z) chair-local -> world, frontOffset (how far in front of the chair to stand),
    seatedFoot(side) / seatedHand(side) -> world points for the seated pose (side +1 = their left),
    expression(walker) -> preset name (optional)
*/

const W = () => config.npc.walk;
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
  start(steps, { speedMul = 1, anger = 0, onDone } = {}) {
    const h = this.host;
    if (!this.steps) {
      const front = h.w(0, 0, h.frontOffset ?? 0.34);
      front.y = 0;
      this.front = front;
      this.pos = front.clone();
      this.yaw = h.chairYaw;
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
    this.blocked = false;
    for (const s of steps) s.started = false;
  }

  _next() {
    this.i++;
    this.t = this.steps[this.i]?.startT ?? 0;
    if (this.i >= this.steps.length) this._finish();
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

  /** Advance and pose. Call every frame while active (instead of the host's own pose). */
  update(dt, camera) {
    const h = this.host, rig = h.rig, j = rig.joints, L = rig.lengths, root = rig.root;
    const S = this.current;
    if (!S) return;
    const first = !S.started;
    S.started = true;
    this.t += dt * this.speedMul;
    const cfg = W();
    let sit = 0, bend = 0.06, reach = 0, look = null, expressionOverride = null;

    const turnTowards = (goal) => {
      let d = goal - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.sign(d) * Math.min(Math.abs(d), cfg.turnSpeed * this.speedMul * dt);
      return Math.abs(d) < 0.04;
    };
    const walkTowards = (target) => {
      const to = target.clone().sub(this.pos); to.y = 0;
      const dist = to.length();
      if (dist < 0.03) { this.moving = Math.max(0, this.moving - dt * 4); return true; }
      turnTowards(Math.atan2(to.x, to.z));
      // Someone in the way? Stop and wait for them to move (and look at them).
      const ahead = this.pos.clone().addScaledVector(to.clone().normalize(), 0.35);
      const cam = camera.position;
      this.blocked = Math.hypot(cam.x - ahead.x, cam.z - ahead.z) < cfg.personalSpace;
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

    switch (S.type) {
      case 'rise':
        sit = 1 - smooth(this.t / cfg.riseTime);
        bend = 0.06 + Math.sin(Math.min(1, this.t / cfg.riseTime) * Math.PI) * 0.4;
        if (this.t >= cfg.riseTime) this._next();
        break;
      case 'walk':
        if (S.glare) look = camera.position.clone();
        if (walkTowards(S.to === 'front' ? this.front : S.to)) this._next();
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
      case 'sit':
        sit = smooth(this.t / cfg.sitTime);
        bend = 0.06 + Math.sin(Math.min(1, this.t / cfg.sitTime) * Math.PI) * 0.4;
        if (this.t >= cfg.sitTime) { this._finish(); return; }
        break;
    }
    if (!this.steps) return;

    // Stomping once they're angry (positional)
    if (this.anger > 0 && this.moving > 0.5 && Math.floor(this.phase / Math.PI) !== this.lastStep) {
      this.lastStep = Math.floor(this.phase / Math.PI);
      h.sfx.stomp(this.pos, this.anger);
    }

    // --- body: between the seat and standing ---
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const bob = -Math.abs(Math.sin(this.phase)) * 0.02 * this.moving;
    const standRoot = this.pos.clone().setY(-0.03 + bob);
    root.position.lerpVectors(standRoot, h.seatRoot, sit);
    const standQuat = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    root.quaternion.copy(standQuat).slerp(h.seatQuat, sit);
    j.spine.rotation.set(bend, 0, 0);
    root.updateMatrixWorld(true);

    // --- feet ---
    const stride = 0.13 * this.moving;
    for (const side of [1, -1]) {
      const ph = this.phase + (side === 1 ? 0 : Math.PI);
      const foot = this.pos.clone()
        .addScaledVector(left, side * 0.1 * rig.scale * (h.hipWidth ?? 1))
        .addScaledVector(fwd, Math.sin(ph) * stride);
      foot.y = Math.max(0, Math.cos(ph)) * 0.06 * this.moving;
      foot.lerp(h.seatedFoot(side), sit);
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
