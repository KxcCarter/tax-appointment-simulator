import * as THREE from 'three';
import { config } from '../config.js';
import { RAPIER } from '../physics.js';

/*
  Ragdoll: turns a primitive rig (rig.js) into jointed Rapier bodies at the moment of knockdown.

  One dynamic body per joint group (pelvis, spine/torso, head, upper/lower arms, upper/lower legs).
  Each body's origin is its joint's pivot, so the rig's groups can simply follow their bodies.
  Shoulders, hips and the waist are ball joints; elbows, knees and the neck are hinges with limits,
  so limbs flop but don't bend backwards.

  Collision groups (so overlapping parts don't explode):
    core (pelvis, torso, head)  collides with the world, props, the player and other ragdolls' cores
    limbs                       collide with the world, props and the player only
*/

const R = () => config.ragdoll;

// Rapier interaction groups: (membership << 16) | filter
const BIT_CORE = 0x0002, BIT_LIMB = 0x0004;
export const GROUP_CORE = (BIT_CORE << 16) | (0xffff & ~BIT_LIMB);
export const GROUP_LIMB = (BIT_LIMB << 16) | (0xffff & ~(BIT_CORE | BIT_LIMB));
/** For the player's character controller: everything except ragdoll limbs. */
export const GROUP_NOT_LIMBS = (0xffff << 16) | (0xffff & ~BIT_LIMB);

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Ragdoll {
  /**
   * @param physics  the level's Physics wrapper
   * @param rig      buildRig() result, in its current (animated) pose
   */
  constructor(physics, rig) {
    this.world = physics.world;
    this.rig = rig;
    const j = rig.joints, P = rig.proportions, s = rig.scale;
    rig.root.updateMatrixWorld(true);

    const handLen = P.mitten ? P.mitten.h * 0.9 : P.hand * 1.2;
    const limb = (len, thick, extra = 0) => {
      const total = (len + extra) * s;
      const r = (thick / 2) * s;
      return { type: 'capsule', halfHeight: Math.max(0.01, total / 2 - r), radius: r, offset: [0, -total / 2, 0] };
    };
    // name: [group, parent body name, collider, kind, joint options]
    const spec = [
      ['pelvis', j.pelvis, null, { type: 'box', half: [P.pelvis.w / 2, P.pelvis.h / 2, P.pelvis.d / 2], offset: [0, 0, 0] }, 'core'],
      ['spine', j.spine, 'pelvis', { type: 'box', half: [P.torso.w * 0.45, P.torso.h / 2, P.torso.d / 2], offset: [0, P.torso.h / 2, 0] }, 'core',
        { type: 'ball' }],
      ['head', j.head, 'spine', { type: 'ball', radius: Math.min(P.head.w, P.head.h) / 2, offset: [0, P.head.h / 2, 0] }, 'core',
        { type: 'hinge', fallbackAxis: [1, 0, 0], limits: R().neckLimits, forceFallback: true }],
      ['lShoulder', j.lShoulder, 'spine', limb(P.upperArm.len, P.upperArm.thick), 'limb', { type: 'ball' }],
      ['rShoulder', j.rShoulder, 'spine', limb(P.upperArm.len, P.upperArm.thick), 'limb', { type: 'ball' }],
      ['lElbow', j.lElbow, 'lShoulder', limb(P.lowerArm.len, P.lowerArm.thick, handLen), 'limb',
        { type: 'hinge', fallbackAxis: [1, 0, 0], limits: R().elbowLimits }],
      ['rElbow', j.rElbow, 'rShoulder', limb(P.lowerArm.len, P.lowerArm.thick, handLen), 'limb',
        { type: 'hinge', fallbackAxis: [1, 0, 0], limits: R().elbowLimits }],
      ['lHip', j.lHip, 'pelvis', limb(P.upperLeg.len, P.upperLeg.thick), 'limb', { type: 'ball' }],
      ['rHip', j.rHip, 'pelvis', limb(P.upperLeg.len, P.upperLeg.thick), 'limb', { type: 'ball' }],
      ['lKnee', j.lKnee, 'lHip', limb(P.lowerLeg.len, P.lowerLeg.thick, P.foot.h), 'limb',
        { type: 'hinge', fallbackAxis: [-1, 0, 0], limits: R().kneeLimits }],
      ['rKnee', j.rKnee, 'rHip', limb(P.lowerLeg.len, P.lowerLeg.thick, P.foot.h), 'limb',
        { type: 'hinge', fallbackAxis: [-1, 0, 0], limits: R().kneeLimits }],
    ];

    this.parts = [];
    this.byName = {};
    for (const [name, group, parentName, col, kind, jointOpts] of spec) {
      group.matrixWorld.decompose(_p, _q, _s);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(_p.x, _p.y, _p.z)
          .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
          .setLinearDamping(R().linearDamping)
          .setAngularDamping(R().angularDamping)
          .setCanSleep(true),
      );
      let cd;
      if (col.type === 'box') cd = RAPIER.ColliderDesc.cuboid(col.half[0] * s, col.half[1] * s, col.half[2] * s);
      else if (col.type === 'ball') cd = RAPIER.ColliderDesc.ball(col.radius * s);
      else cd = RAPIER.ColliderDesc.capsule(col.halfHeight, col.radius);
      const off = col.type === 'capsule' ? col.offset : col.offset.map((v) => v * s);
      cd.setTranslation(off[0], off[1], off[2])
        .setDensity(R().density)
        .setFriction(R().friction)
        .setRestitution(R().restitution)
        .setCollisionGroups(kind === 'core' ? GROUP_CORE : GROUP_LIMB);
      const collider = this.world.createCollider(cd, body);
      const part = { name, group, body, collider, lastSpeed: 0, restPos: group.position.clone(), restQuat: group.quaternion.clone() };
      this.parts.push(part);
      this.byName[name] = part;
      if (parentName) this._joint(this.byName[parentName], part, jointOpts);
    }
  }

  _joint(parent, child, opts) {
    const pb = parent.body, cb = child.body;
    // Anchor: the child's pivot, in the parent body's local space
    const pivot = child.group.getWorldPosition(new THREE.Vector3());
    const pq = rot(pb), cq = rot(cb);
    const pt = vec(pb.translation());
    const a1 = pivot.clone().sub(pt).applyQuaternion(pq.clone().invert());
    let data;
    if (opts.type === 'ball') {
      data = RAPIER.JointData.spherical(a1, { x: 0, y: 0, z: 0 });
    } else {
      // Hinge about the axis the joint is currently bent around (rig IK bends about one axis);
      // straight limbs use the fallback axis, chosen so the limb bends the natural way.
      const local = child.group.quaternion;
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(local.w, -1, 1));
      let axisLocal; // in the parent joint's frame (= the child's frame, rotating about it)
      if (angle > 0.05 && !opts.forceFallback) {
        axisLocal = new THREE.Vector3(local.x, local.y, local.z).normalize();
        // Keep the convention "bending = negative angle about the axis": flip if needed
        const fb = new THREE.Vector3(...opts.fallbackAxis);
        if (axisLocal.dot(fb) < 0) axisLocal.negate();
      } else {
        axisLocal = new THREE.Vector3(...opts.fallbackAxis);
      }
      // The neck isn't directly under spine (it hangs from the neck group): express in body frames
      const worldAxis = axisLocal.clone().applyQuaternion(child.group.parent.getWorldQuaternion(new THREE.Quaternion()));
      const ax1 = worldAxis.clone().applyQuaternion(pq.clone().invert());
      const ax2 = worldAxis.clone().applyQuaternion(cq.clone().invert());
      data = RAPIER.JointData.revoluteWithAxes(a1, { x: 0, y: 0, z: 0 }, ax1, ax2);
      data.limitsEnabled = true;
      data.limits = opts.limits;
    }
    const joint = this.world.createImpulseJoint(data, pb, cb, true);
    joint.setContactsEnabled(false);
  }

  /** Throw it: the hit's impulse at the struck part (default: the torso), plus a share to everything. */
  push(dir, strength, partName = 'spine') {
    const d = dir.clone().setY(0).normalize();
    d.y = R().liftRatio;
    d.normalize();
    for (const p of this.parts) {
      const share = p.name === partName ? 1 : R().impulseShare;
      const m = p.body.mass();
      p.body.applyImpulse({ x: d.x * strength * share * m, y: d.y * strength * share * m, z: d.z * strength * share * m }, true);
    }
    // A bit of spin so nobody falls like a plank
    const spine = this.byName.spine.body;
    spine.applyTorqueImpulse({ x: (Math.random() - 0.5) * R().spin, y: (Math.random() - 0.5) * R().spin, z: (Math.random() - 0.5) * R().spin }, true);
  }

  /** Give every part the same velocity (e.g. what the character was walking at). */
  setVelocity(v) {
    for (const p of this.parts) p.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
  }

  /** Is anything still moving? */
  get sleeping() {
    return this.parts.every((p) => p.body.isSleeping());
  }

  /** Move the rig's joint groups onto their bodies (parents first). */
  sync() {
    const s = this.rig.scale;
    _s.setScalar(s);
    for (const p of this.parts) {
      const t = p.body.translation(), r = p.body.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, _s);
      const parent = p.group.parent;
      _inv.copy(parent.matrixWorld).invert();
      _m.premultiply(_inv);
      _m.decompose(p.group.position, p.group.quaternion, _p);
      p.group.updateMatrixWorld(true);
    }
  }

  /**
   * Thuds: a part that suddenly stops (hit the floor, a chair, a wall) makes a sound.
   * onThud(position, strength 0..1). Call once per frame.
   */
  checkImpacts(onThud) {
    let best = null;
    for (const p of this.parts) {
      const v = p.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const drop = p.lastSpeed - speed;
      p.lastSpeed = speed;
      if (drop > R().thudSpeedDrop && (!best || drop > best.drop)) best = { p, drop };
    }
    if (best && this.time - (this.lastThud ?? -1) > R().thudGap) {
      this.lastThud = this.time;
      onThud(vec(best.p.body.translation()), Math.min(1, best.drop / R().thudLoudAt));
    }
  }

  update(dt, onThud) {
    this.time = (this.time ?? 0) + dt;
    this.sync();
    this.checkImpacts(onThud);
  }

  /** World position of the torso (for sound, the camera, etc.). */
  position() {
    return vec(this.byName.spine.body.translation());
  }

  /** Remove the bodies and put the rig's joint groups back where they were. */
  dispose() {
    for (const p of this.parts) {
      this.world.removeRigidBody(p.body);
      p.group.position.copy(p.restPos);
      p.group.quaternion.copy(p.restQuat);
    }
    this.parts = [];
  }
}

const vec = (t) => new THREE.Vector3(t.x, t.y, t.z);
const rot = (b) => { const r = b.rotation(); return new THREE.Quaternion(r.x, r.y, r.z, r.w); };
