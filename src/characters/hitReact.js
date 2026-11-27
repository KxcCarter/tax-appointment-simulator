import * as THREE from 'three';
import { config } from '../config.js';

/*
  Hit reactions (owner: "partial-ragdoll hit reactions"): a blow throws the part it landed on, and the body
  springs back. A head shot snaps the head back (or round, from the side), a body blow folds them over, a low
  kick buckles a knee, and the arms flail. Each part is a damped spring per axis, layered on top of whatever
  pose they're in (seated, walking, fighting, held in a grab), so it works for the cartoon and the realistic
  figures alike (the realistic body copies the rig's pose). Tuning: config.combat.react.

  Every frame: undo() before the pose is worked out (so poses that ease from where they were don't drift),
  apply() after it.
*/

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _inv = new THREE.Quaternion();
const AXES = ['x', 'y', 'z'];

export class HitReact {
  constructor(rig) {
    this.rig = rig;
    const j = rig.joints;
    // Each channel: a joint and a spring per axis (offset, speed)
    this.parts = {
      head: { joint: j.head },
      spine: { joint: j.spine },
      lHip: { joint: j.lHip }, rHip: { joint: j.rHip },
      lKnee: { joint: j.lKnee }, rKnee: { joint: j.rKnee },
      lShoulder: { joint: j.lShoulder }, rShoulder: { joint: j.rShoulder },
    };
    for (const p of Object.values(this.parts)) {
      p.v = { x: 0, y: 0, z: 0 };
      p.w = { x: 0, y: 0, z: 0 };
      p.applied = new THREE.Quaternion();
    }
    this.active = false;
  }

  /** Kick a part's spring (radians a second, per axis). */
  _kick(name, x = 0, y = 0, z = 0) {
    const p = this.parts[name];
    if (!p?.joint) return;
    p.w.x += x; p.w.y += y; p.w.z += z;
    this.active = true;
  }

  /**
   * A blow: `dir` (world, the way it travelled), `point` (world, where it landed, or null), how hard
   * (damage, knock). Works out the part from the height it landed at.
   */
  hit(dir, point, { damage = 25, knock = 1 } = {}) {
    const R = config.combat.react;
    if (!R.enabled) return;
    const j = this.rig.joints, root = this.rig.root;
    // The blow in their own space (+z their front, +x their left)
    root.getWorldQuaternion(_q);
    const d = dir.clone().setY(0).applyQuaternion(_inv.copy(_q).invert());
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    d.normalize();
    const s = Math.min(R.maxStrength, Math.sqrt(Math.max(0.3, damage / 25)) * (0.6 + 0.4 * knock));
    const headY = j.head.getWorldPosition(new THREE.Vector3()).y;
    const hipY = j.pelvis.getWorldPosition(new THREE.Vector3()).y;
    const y = point?.y ?? headY;
    const region = y > headY - R.headBand ? 'head' : y < hipY + R.legBand ? 'leg' : 'body';
    const H = R.head, B = R.body, L = R.leg;
    if (region === 'head') {
      // Snapped back along the blow (a blow into the face: back; from the side: tipped over and turned)
      this._kick('head', d.z * H.pitch * s, d.x * H.turn * s, -d.x * H.roll * s);
      this._kick('spine', d.z * B.pitch * 0.4 * s, d.x * B.twist * 0.3 * s, -d.x * B.lean * 0.3 * s);
    } else if (region === 'body') {
      // Folded over (a body blow doubles them up), turned and tipped by a blow from the side
      this._kick('spine', B.fold * s, d.x * B.twist * s, -d.x * B.lean * s);
      this._kick('head', -H.pitch * 0.35 * s, 0, 0); // (the head comes forward as they fold: whiplash)
    } else {
      // A knee buckles: the one on the side it came from, or either
      const side = Math.abs(d.x) > 0.3 ? (d.x > 0 ? 'r' : 'l') : Math.random() < 0.5 ? 'l' : 'r';
      this._kick(side + 'Hip', -L.hip * s, 0, 0);
      this._kick(side + 'Knee', L.knee * s, 0, 0);
      this._kick('spine', B.fold * 0.5 * s, 0, (side === 'l' ? 1 : -1) * B.lean * 0.5 * s);
    }
    // Arms fly up and out
    const a = R.arms * s;
    this._kick('lShoulder', -a * (0.3 + Math.random() * 0.4), 0, a * (0.6 + Math.random() * 0.4));
    this._kick('rShoulder', -a * (0.3 + Math.random() * 0.4), 0, -a * (0.6 + Math.random() * 0.4));
    // Heavy blows rock the whole body back along the blow
    if (knock >= 1.5) this._kick('spine', d.z * B.pitch * (knock - 1) * s, 0, 0);
  }

  /** Squirming (held in a grab): small kicks here and there. */
  squirm(amount = 1) {
    const r = () => (Math.random() - 0.5) * 2 * amount;
    this._kick('spine', r() * 0.8, r() * 1.4, r() * 0.8);
    this._kick('head', r() * 1.5, r() * 2, r() * 1);
    this._kick('lShoulder', r() * 2, 0, Math.abs(r()) * 2);
    this._kick('rShoulder', r() * 2, 0, -Math.abs(r()) * 2);
  }

  /** Take last frame's offsets back off (call before the pose is worked out). */
  undo() {
    if (!this.active) return;
    for (const p of Object.values(this.parts)) if (p.joint) p.joint.quaternion.multiply(_inv.copy(p.applied).invert());
  }

  /** Spring along and put the offsets on (call after the pose). */
  apply(dt) {
    if (!this.active) return;
    const R = config.combat.react;
    let any = false;
    for (const [name, p] of Object.entries(this.parts)) {
      if (!p.joint) continue;
      const S = R.springs[name.replace(/^[lr](?=[A-Z])/, '').toLowerCase()] ?? R.springs.body;
      // A damped spring: back to 0, overshooting a little (the flop). In small steps, so it behaves the same
      // at any frame rate
      const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
      for (const a of AXES) {
        for (let k = 0; k < n; k++) {
          p.w[a] += (-S.stiffness * p.v[a] - S.damping * p.w[a]) * h;
          p.v[a] = THREE.MathUtils.clamp(p.v[a] + p.w[a] * h, -S.max, S.max);
        }
        if (Math.abs(p.v[a]) > 1e-4 || Math.abs(p.w[a]) > 1e-3) any = true;
      }
      p.applied.setFromEuler(_e.set(p.v.x, p.v.y, p.v.z));
      p.joint.quaternion.multiply(p.applied);
    }
    if (!any) {
      // Settled: take them off and stop
      this.undo();
      for (const p of Object.values(this.parts)) { p.applied.identity(); for (const a of AXES) { p.v[a] = 0; p.w[a] = 0; } }
      this.active = false;
    }
  }

  /** Knocked down: the ragdoll takes over from the pose as it is (offsets and all); forget the springs. */
  forget() {
    for (const p of Object.values(this.parts)) { p.applied.identity(); for (const a of AXES) { p.v[a] = 0; p.w[a] = 0; } }
    this.active = false;
  }

  /** Put back in their seat: take the offsets off and forget it all. */
  clear() {
    this.undo();
    for (const p of Object.values(this.parts)) { p.applied.identity(); for (const a of AXES) { p.v[a] = 0; p.w[a] = 0; } }
    this.active = false;
  }
}
