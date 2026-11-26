import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { theme } from '../theme.js';
import { characterModel, prepareModel } from '../characters/realBody.js';

/*
  The player's realistic fists and kicking leg (realistic look): a MakeHuman model of the player
  (tools/makehuman/recipes/player.json), of which only the forearms and hands (in his suit's sleeves) and
  the right calf and shoe are drawn. The model is built with its fists clenched (recipe "fists"); every frame each forearm is
  placed so its fist sits where combat.js's simple fist would be (that one is kept, hidden, as the anchor),
  and the calf where its simple leg would be. So punches, the guard, blocks and kicks move them unchanged.
*/

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const KICK_SHIN = 0.55; // where the ankle sits along the kick anchor (combat.js's leg: its shin is 0.55 long)

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

/** A rotation taking frame (a1, a2) to frame (b1, b2): each pair two perpendicular unit vectors. */
function frameTo(a1, a2, b1, b2) {
  const A = new THREE.Matrix4().makeBasis(a1, a2, new THREE.Vector3().crossVectors(a1, a2));
  const B = new THREE.Matrix4().makeBasis(b1, b2, new THREE.Vector3().crossVectors(b1, b2));
  return new THREE.Quaternion().setFromRotationMatrix(B.multiply(A.transpose()));
}

export class RealArms {
  /** The player's arms, if the realistic look is on and his model loaded; else null. */
  static create(camera) {
    const gltf = characterModel('player');
    return gltf ? new RealArms(camera, gltf) : null;
  }

  constructor(camera, gltf) {
    this.camera = camera;
    const model = SkeletonUtils.clone(gltf.scene);
    this.model = model;
    prepareModel(model, theme.look.realistic.tint?.player);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.noShadow = true; } }); // (a body-less pair of arms shouldn't cast one)
    camera.add(model);
    model.updateMatrixWorld(true);
    const bone = (n) => model.getObjectByName(n);

    // Only these parts are drawn: each mesh's triangles split by the bone that moves them most
    const partOf = (b) => (/(lowerarm|hand|thumb|index|middle|ring|pinky).*_l$/.test(b) ? 1 : /(lowerarm|hand|thumb|index|middle|ring|pinky).*_r$/.test(b) ? -1 : /^(calf_r|foot_r|ball_r)/.test(b) ? 'leg' : null);
    this.parts = { 1: [], [-1]: [], leg: [] };
    const meshes = [];
    model.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    for (const m of meshes) {
      const show = m.visible;
      m.visible = false;
      if (!show) continue; // (the hidden arm skin)
      const g = m.geometry, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, bones = m.skeleton.bones;
      const part = new Array(g.attributes.position.count);
      for (let i = 0; i < part.length; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
        part[i] = partOf(bones[best]?.name ?? '');
      }
      const tris = { 1: [], [-1]: [], leg: [] };
      const idx = g.index;
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        const p = part[a];
        if (p !== null && p === part[b] && p === part[c]) tris[p].push(a, b, c);
      }
      for (const key of [1, -1, 'leg']) {
        if (!tris[key].length) continue;
        const geo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) geo.setAttribute(name, attr);
        geo.setIndex(tris[key]);
        const sm = new THREE.SkinnedMesh(geo, m.material);
        sm.bind(m.skeleton, m.bindMatrix);
        sm.frustumCulled = false;
        sm.raycast = () => {};
        sm.visible = false;
        sm.userData.noShadow = true;
        m.parent.add(sm);
        this.parts[key].push(sm);
      }
    }

    // Each fist: where its middle is, and which way the forearm and the knuckles run
    this.arms = {};
    for (const [side, s] of [[1, 'l'], [-1, 'r']]) {
      const hand = bone('hand_' + s), lower = bone('lowerarm_' + s);
      if (!hand || !lower) continue;
      const wp = (b) => b.getWorldPosition(new THREE.Vector3());
      const handDir = wp(bone('middle_01_' + s)).sub(wp(hand)).normalize();
      // Across the knuckles, little finger to index finger (the thumb's side), and the palm: square to both
      const thumbDir = wp(bone('index_01_' + s)).sub(wp(bone('pinky_01_' + s))).projectOnPlane(handDir).normalize();
      const palm = new THREE.Vector3().crossVectors(handDir, thumbDir).normalize();
      if (wp(bone('thumb_03_' + s)).sub(wp(hand)).dot(palm) < 0) palm.negate(); // (the thumb's tip is on the palm's side)
      // (the fingers are clenched in the model itself: recipe "fists", tools/makehuman/build_human.py)
      // Where the fist's middle is, and which way the forearm and thumb point, in the forearm's own space
      lower.updateWorldMatrix(true, true);
      const toLower = lower.matrixWorld.clone().invert();
      const knuckles = FINGERS.map((f) => wp(bone(`${f}_02_${s}`))).reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(4);
      const centre = knuckles.lerp(wp(hand), 0.35).applyMatrix4(toLower);
      const lq = lower.getWorldQuaternion(new THREE.Quaternion()).invert();
      const along = wp(hand).sub(wp(lower)).normalize().applyQuaternion(lq);
      const thumb = thumbDir.clone().applyQuaternion(lq).projectOnPlane(along).normalize();
      // The knuckles (for blood): each one's bone, and the back of the hand in that bone's space
      const knuckles2 = ['index', 'middle', 'ring'].map((f) => bone(`${f}_01_${s}`)).filter(Boolean)
        .map((b) => ({ bone: b, back: palm.clone().negate().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert()) }));
      this.arms[side] = { lower, centre, along, thumb, knuckles: knuckles2 };
    }

    // The kicking leg: the calf, in its own space, with the foot pointing forward (the model's +z)
    const calf = bone('calf_r'), foot = bone('foot_r');
    if (calf && foot) {
      calf.updateWorldMatrix(true, true);
      const cq = calf.getWorldQuaternion(new THREE.Quaternion()).invert();
      const down = foot.getWorldPosition(new THREE.Vector3()).sub(calf.getWorldPosition(new THREE.Vector3()));
      const ankle = foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(calf.matrixWorld.clone().invert());
      const along = down.normalize().applyQuaternion(cq);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(cq).projectOnPlane(along).normalize();
      this.leg = { calf, ankle, along, fwd };
    }
  }

  /**
   * Place them for this frame: each forearm so its fist is at that fist anchor (combat.js), the calf so its
   * ankle is at the leg anchor. Shown when their anchors are.
   */
  update(fists, legAnchor) {
    this.model.updateMatrixWorld(true);
    for (const side of [1, -1]) {
      const A = this.arms[side], anchor = fists[side];
      const show = !!A && anchor.visible;
      for (const p of this.parts[side]) p.visible = show;
      if (!show) continue;
      // In the anchor's space: the forearm points forward (-z, towards the fist), the thumb towards the middle
      // of the view and a little up (a fist held palm-down and turned in)
      const q = frameTo(A.along, A.thumb, new THREE.Vector3(0, 0, -1), new THREE.Vector3(side * 0.8, 0.6, 0).normalize());
      const p = A.centre.clone().applyQuaternion(q).negate();
      this._place(A.lower, anchor, q, p);
    }
    const L = this.leg;
    const showLeg = !!L && legAnchor.visible;
    for (const p of this.parts.leg) p.visible = showLeg;
    if (showLeg) {
      // A front kick: the knee near the anchor, the shin along its +y (which the kick swings forward), the shoe at
      // the far end with its toes up (+z, which the kick turns upward), the sole towards whoever's kicked
      const q = frameTo(L.along, L.fwd, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
      this._place(L.calf, legAnchor, q, new THREE.Vector3(0, KICK_SHIN, 0).sub(L.ankle.clone().applyQuaternion(q)));
    }
  }

  /**
   * Set a bone so that, in `anchor`'s space (without its scale), it sits at p turned by q. It's done by moving
   * its parent (the upper arm, the thigh), the bone keeping its rest place on it: the sleeve and trouser round
   * the elbow and knee are partly moved by the parent too, and stretch if it's left behind.
   */
  _place(b, anchor, q, p) {
    anchor.updateWorldMatrix(true, false);
    const wpos = anchor.getWorldPosition(new THREE.Vector3()), wq = anchor.getWorldQuaternion(new THREE.Quaternion());
    _m.compose(wpos, wq, _v.set(1, 1, 1)).multiply(_m2.compose(p, q, _v.set(1, 1, 1))); // the bone's world matrix
    const up = b.parent;
    b.userData.restLocal ??= new THREE.Matrix4().compose(b.position, b.quaternion, b.scale);
    _m.multiply(_m2.copy(b.userData.restLocal).invert()); // -> the parent's world matrix
    up.parent.updateWorldMatrix(true, false);
    _m.premultiply(_m2.copy(up.parent.matrixWorld).invert());
    _m.decompose(up.position, up.quaternion, _v);
    up.updateWorldMatrix(false, true);
  }

  /** The knuckles bloodied (enough punches landed: config.damage.knuckles). */
  bloodyKnuckles() {
    for (const side of [1, -1]) {
      const A = this.arms[side];
      if (!A) continue;
      for (const { bone, back } of A.knuckles) {
        // A small flat smear on the punching surface: the back of the first finger bone, halfway along it
        const scuff = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 6), theme.material('knuckleBlood'));
        scuff.scale.set(1, 0.3, 1);
        scuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), back); // (flat against the skin)
        const next = bone.children.find((c) => c.isBone);
        scuff.position.copy(next ? next.position.clone().multiplyScalar(0.5) : new THREE.Vector3()).addScaledVector(back, 0.0065);
        bone.add(scuff);
      }
    }
  }
}
