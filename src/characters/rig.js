import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';

/*
  Parametric primitive humanoid. Every NPC and the receptionist is one of these.

  Hierarchy (each joint is a Group pivot; the visible part hangs off it):
    root (feet-level origin, faces +z)
      pelvis
        spine ─ torso
          neck ─ head (+ hair, hat, glasses)
          lShoulder ─ upper arm ─ lElbow ─ lower arm ─ hand
          rShoulder ─ ...
        lHip ─ upper leg ─ lKnee ─ lower leg ─ foot
        rHip ─ ...

  Limbs hang along local -y from their joint, so a zero rotation = standing at attention.
  Character's right is -x (it faces +z).

  Built from SEPARATE parts on purpose: animation, hit detection and ragdolls (M4) use them.
*/

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export function buildRig(look = {}) {
  const P = config.characters.proportions;
  const s = look.scale ?? 1;
  const col = {
    skin: look.skin, hair: look.hair, shirt: look.shirt, jacket: look.jacket ?? look.shirt,
    trousers: look.trousers, shoes: look.shoes,
  };
  const m = (c) => theme.material(c);

  const root = new THREE.Group();
  root.name = 'rig';
  const inner = new THREE.Group(); // scale lives here so root stays unscaled for placement
  inner.scale.setScalar(s);
  root.add(inner);

  const part = (parent, w, h, d, color, y, name) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color));
    mesh.position.y = y;
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };
  const joint = (parent, x, y, z, name) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.name = name;
    parent.add(g);
    return g;
  };

  const hipHeight = P.upperLeg.len + P.lowerLeg.len + P.foot.h;
  const pelvis = joint(inner, 0, hipHeight + P.pelvis.h / 2, 0, 'pelvis');
  const parts = {};
  parts.pelvis = part(pelvis, P.pelvis.w, P.pelvis.h, P.pelvis.d, col.trousers, 0, 'pelvisMesh');

  const spine = joint(pelvis, 0, P.pelvis.h / 2, 0, 'spine');
  parts.torso = part(spine, P.torso.w, P.torso.h, P.torso.d, col.jacket, P.torso.h / 2, 'torsoMesh');

  const neck = joint(spine, 0, P.torso.h, 0, 'neck');
  part(neck, 0.1, P.neck, 0.1, col.skin, P.neck / 2, 'neckMesh');
  const headPivot = joint(neck, 0, P.neck, 0, 'head');
  parts.head = part(headPivot, P.head.w, P.head.h, P.head.d, col.skin, P.head.h / 2, 'headMesh');
  // Nose: one small box, so you can tell where they're looking
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.05), m(col.skin));
  nose.position.set(0, P.head.h * 0.42, P.head.d / 2 + 0.02);
  headPivot.add(nose);
  // Eyes
  for (const ex of [-0.065, 0.065]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.01), theme.material('black'));
    eye.position.set(ex, P.head.h * 0.58, P.head.d / 2 + 0.003);
    headPivot.add(eye);
  }
  addHead(headPivot, look, P, m);

  const armY = P.torso.h - P.upperArm.thick / 2;
  const armX = P.torso.w / 2 + P.upperArm.thick / 2 - P.shoulderInset;
  const limb = (parent, x, y, upper, lower, upperColor, lowerColor, side, kind) => {
    const a = joint(parent, x, y, 0, side + (kind === 'arm' ? 'Shoulder' : 'Hip'));
    part(a, upper.thick, upper.len, upper.thick, upperColor, -upper.len / 2, side + 'Upper' + kind);
    const b = joint(a, 0, -upper.len, 0, side + (kind === 'arm' ? 'Elbow' : 'Knee'));
    part(b, lower.thick, lower.len, lower.thick, lowerColor, -lower.len / 2, side + 'Lower' + kind);
    let end;
    if (kind === 'arm') {
      end = new THREE.Mesh(new THREE.SphereGeometry(P.hand, 8, 6), m(col.skin));
      end.position.y = -lower.len - P.hand * 0.6;
    } else {
      end = new THREE.Mesh(new THREE.BoxGeometry(P.foot.w, P.foot.h, P.foot.l), m(col.shoes));
      end.position.set(0, -lower.len - P.foot.h / 2, P.foot.l * 0.25);
    }
    b.add(end);
    return { upper: a, lower: b, end };
  };
  const lArm = limb(spine, armX, armY, P.upperArm, P.lowerArm, col.jacket, col.shirt === col.jacket ? col.skin : col.jacket, 'l', 'arm');
  const rArm = limb(spine, -armX, armY, P.upperArm, P.lowerArm, col.jacket, col.shirt === col.jacket ? col.skin : col.jacket, 'r', 'arm');
  const lLeg = limb(pelvis, P.hipSpacing, -P.pelvis.h / 2, P.upperLeg, P.lowerLeg, col.trousers, col.trousers, 'l', 'leg');
  const rLeg = limb(pelvis, -P.hipSpacing, -P.pelvis.h / 2, P.upperLeg, P.lowerLeg, col.trousers, col.trousers, 'r', 'leg');

  // Shirt front / tie detail on the torso
  if (look.shirt !== undefined && look.jacket !== undefined && look.shirt !== look.jacket) {
    const bib = new THREE.Mesh(new THREE.BoxGeometry(P.torso.w * 0.32, P.torso.h * 0.55, 0.01), m(look.shirt));
    bib.position.set(0, P.torso.h * 0.72, P.torso.d / 2 + 0.004);
    spine.add(bib);
  }
  if (look.tie !== undefined) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.05, P.torso.h * 0.5, 0.012), m(look.tie));
    tie.position.set(0, P.torso.h * 0.68, P.torso.d / 2 + 0.01);
    spine.add(tie);
  }

  const joints = {
    pelvis, spine, neck, head: headPivot,
    lShoulder: lArm.upper, lElbow: lArm.lower, rShoulder: rArm.upper, rElbow: rArm.lower,
    lHip: lLeg.upper, lKnee: lLeg.lower, rHip: rLeg.upper, rKnee: rLeg.lower,
  };

  root.traverse((o) => { if (o.isMesh) o.userData.rigRoot = root; });

  return {
    root,
    inner,
    joints,
    parts,
    scale: s,
    hipHeight: hipHeight * s,
    seatOffset: (P.pelvis.h / 2) * s,     // pelvis centre above a seat surface
    lengths: {
      upperArm: P.upperArm.len * s,
      lowerArm: P.lowerArm.len * s + P.hand * 0.6 * s,
      upperLeg: P.upperLeg.len * s,
      lowerLeg: P.lowerLeg.len * s + P.foot.h * s,
    },
    /** Reset every joint to the standing rest pose. */
    resetPose() {
      for (const j of Object.values(joints)) j.quaternion.identity();
    },
  };
}

function addHead(headPivot, look, P, m) {
  const H = P.head;
  if (look.hairStyle !== 'bald') {
    const top = new THREE.Mesh(new THREE.BoxGeometry(H.w + 0.02, 0.07, H.d + 0.02), m(look.hair));
    top.position.y = H.h + 0.02;
    headPivot.add(top);
    const back = new THREE.Mesh(new THREE.BoxGeometry(H.w + 0.02, H.h * 0.6, 0.05), m(look.hair));
    back.position.set(0, H.h * 0.68, -H.d / 2 - 0.01);
    headPivot.add(back);
  }
  if (look.hairStyle === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), m(look.hair));
    bun.position.set(0, H.h + 0.1, -0.04);
    headPivot.add(bun);
  }
  if (look.glasses !== undefined) {
    const frame = m(look.glasses);
    for (const ex of [-0.065, 0.065]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.055, 0.012), frame);
      lens.position.set(ex, H.h * 0.58, H.d / 2 + 0.012);
      headPivot.add(lens);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.014), m(look.skin));
      glass.position.copy(lens.position);
      headPivot.add(glass);
    }
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.016), theme.material('black'));
    eyeL.position.set(-0.065, H.h * 0.58, H.d / 2 + 0.013);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.065;
    headPivot.add(eyeL, eyeR);
  }
  if (look.hat === 'fedora' || look.hat === 'cap') {
    const hatMat = m(look.hatColor);
    if (look.hat === 'fedora') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 12), hatMat);
      brim.position.y = H.h + 0.04;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.14, 12), hatMat);
      crown.position.y = H.h + 0.11;
      headPivot.add(brim, crown);
    } else {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(H.w + 0.04, 0.09, H.d + 0.04), hatMat);
      crown.position.y = H.h + 0.05;
      const peak = new THREE.Mesh(new THREE.BoxGeometry(H.w, 0.02, 0.14), hatMat);
      peak.position.set(0, H.h + 0.01, H.d / 2 + 0.07);
      headPivot.add(crown, peak);
    }
  }
}

// ---------------------------------------------------------------------------
// Two-bone IK. Points a limb (upper joint + lower joint, both hanging along -y)
// so its end reaches `targetWorld`, bending towards `poleWorldDir`.
// ---------------------------------------------------------------------------
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _upperDir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _pole = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function solveTwoBone(upperJoint, lowerJoint, targetWorld, l1, l2, poleWorldDir) {
  const parent = upperJoint.parent;
  parent.updateWorldMatrix(true, false);
  // Target and pole in the parent's space, relative to the upper joint.
  // Lengths are given in world units; parent space may be scaled.
  const parentScale = new THREE.Vector3().setFromMatrixScale(parent.matrixWorld).x;
  _t.copy(targetWorld);
  parent.worldToLocal(_t).sub(upperJoint.position).multiplyScalar(parentScale);
  _m.extractRotation(parent.matrixWorld).invert();
  _pole.copy(poleWorldDir).applyMatrix4(_m).normalize();

  const maxReach = (l1 + l2) * 0.999;
  const d = THREE.MathUtils.clamp(_t.length(), Math.abs(l1 - l2) + 1e-3, maxReach);
  _dir.copy(_t).normalize();

  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const b = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));

  _n.crossVectors(_dir, _pole);
  if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
  _n.normalize();
  _upperDir.copy(_dir).applyAxisAngle(_n, a);

  // Upper joint: rotate rest direction (-y) onto the upper-arm direction
  upperJoint.quaternion.setFromUnitVectors(DOWN, _upperDir);
  // Lower joint: bend about n, expressed in the upper joint's frame
  _qi.copy(upperJoint.quaternion).invert();
  const nLocal = _n.clone().applyQuaternion(_qi);
  lowerJoint.quaternion.setFromAxisAngle(nLocal, -(Math.PI - b));
}

/** Smoothly turn a joint (e.g. the head) to look at a world point, with yaw/pitch limits. */
export function aimJoint(jointObj, targetWorld, { maxYaw = 1.2, maxPitch = 0.6, alpha = 1 } = {}) {
  const parent = jointObj.parent;
  parent.updateWorldMatrix(true, false);
  const local = parent.worldToLocal(targetWorld.clone()).sub(jointObj.position);
  const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -maxYaw, maxYaw);
  const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -maxPitch, maxPitch);
  _q.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  jointObj.quaternion.slerp(_q, alpha);
}

export { UP };
