import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { theme } from '../theme.js';
import { config } from '../config.js';
import { addExtras, paintTie } from './realExtras.js';

/*
  Realistic bodies (branch experiment): a rigged glTF person that copies the pose of a primitive
  rig (rig.js) every frame.

  The primitive rig keeps doing everything it did before (sitting, walking, IK, fighting,
  ragdolls). Its meshes are hidden but stay as invisible hitboxes for punches and [E]. The model
  hangs under rig.root; each frame, each of its main bones turns by however much the matching rig
  joint has turned since the rest pose:

      bone = (joint now) * (joint at rest)^-1 * (bone at rest)

  At setup the model's limbs are first bent to point the same way as the rig's limbs at rest
  (arms straight down instead of the model's A-pose), so "rest" means the same pose for both.
  Models come from theme.look.realistic.models (one file per character id).
*/

const loaded = new Map(); // url -> gltf

/** Load every model the theme names (call once, before the level is built). */
export async function loadCharacterModels() {
  const R = theme.look.realistic;
  if (!R?.enabled) return;
  const loader = new GLTFLoader();
  const urls = [...new Set(Object.values(R.models))];
  await Promise.all(urls.map(async (url) => {
    try {
      loaded.set(url, await loader.loadAsync(url));
    } catch (e) {
      console.warn('Character model failed to load:', url, e);
    }
  }));
}

/** A loaded model by character id (theme.look.realistic.models), or undefined. */
export function characterModel(id) {
  return loaded.get(theme.look.realistic?.models?.[id]);
}

/** The realistic body for a character id, or null (style off, or no model for them). look: their figure's look
 *  (characterPalettes), for the things the model gets added (realExtras.js) and its tie's colour. */
export function realBodyFor(id, rig, look) {
  const R = theme.look.realistic;
  if (!R?.enabled) return null;
  const gltf = loaded.get(R.models[id]);
  return gltf ? new RealBody(rig, gltf, R.tint?.[id], R.jiggleGain ?? 1, look) : null;
}

// The model's wobble bones (tools/makehuman: recipe "jiggle") -> which part's amount they use in
// config.characters.jiggle.parts (the first one that's set)
const JIGGLE_BONES = {
  jiggle_belly: ['belly'],
  jiggle_breast_l: ['bust', 'chest'],
  jiggle_breast_r: ['bust', 'chest'],
  jiggle_chin: ['jowls'],
};

// Hand shapes: how far each finger joint curls (radians: knuckle, middle, tip); 'fingers' is the default for the
// four fingers. Used by _applyHands (rig.handShape).
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
// (from the model's rest pose, whose fingers are already a little bent: STRAIGHT straightens them)
const CURLED = [1.45, 1.45, 0.9], STRAIGHT = [-0.2, -0.25, -0.2], THUMB_IN = [0.2, 0.5, 0.4];
const HAND_SHAPES = {
  relaxed: { fingers: [0.1, 0.15, 0.1], thumb: [0, 0.05, 0.05] },
  fist: { fingers: CURLED, thumb: THUMB_IN },
  point: { fingers: CURLED, index: STRAIGHT, thumb: THUMB_IN },
  two: { fingers: CURLED, index: STRAIGHT, middle: STRAIGHT, thumb: THUMB_IN },
  grip: { fingers: [0.6, 0.75, 0.45], thumb: [0.15, 0.25, 0.2] },   // holding something flat (a magazine, an arm)
  rest: { fingers: [0.2, 0.3, 0.2], thumb: [0, 0.1, 0.05] },        // lying on the lap
  cup: { fingers: [0.35, 0.45, 0.3], thumb: [0.1, 0.15, 0.1] },     // cupped, holding something up (the sitter's "these?")
};
const MAX_WRIST = 1.5, MAX_ROLL = 2.0; // (radians: how far a wrist bends and a forearm rolls to aim a hand)

// Rig joint -> model bone, parents before children
const MAP = [
  ['pelvis', 'Hips'], ['spine', 'Spine02'], ['neck', 'neck'], ['head', 'Head'],
  ['lShoulder', 'LeftArm'], ['lElbow', 'LeftForeArm'], ['rShoulder', 'RightArm'], ['rElbow', 'RightForeArm'],
  ['lHip', 'LeftUpLeg'], ['lKnee', 'LeftLeg'], ['rHip', 'RightUpLeg'], ['rKnee', 'RightLeg'],
];

// Other skeletons' names for the same bones (MakeHuman/MPFB 'game_engine' rig, Unreal-style)
const ALIASES = {
  Hips: ['pelvis'], Spine02: ['spine_01'], neck: ['neck_01'], Head: ['head'],
  LeftArm: ['upperarm_l'], LeftForeArm: ['lowerarm_l'], LeftHand: ['hand_l'],
  RightArm: ['upperarm_r'], RightForeArm: ['lowerarm_r'], RightHand: ['hand_r'],
  LeftUpLeg: ['thigh_l'], LeftLeg: ['calf_l'], LeftFoot: ['foot_l'],
  RightUpLeg: ['thigh_r'], RightLeg: ['calf_r'], RightFoot: ['foot_r'],
};
const findBone = (model, name) => model.getObjectByName(name) ?? (ALIASES[name] ?? []).map((n) => model.getObjectByName(n)).find(Boolean);

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

/** Rotation whose y axis is `dir` (along the bone) and x axis is `bend` (the bend axis). */
function frameQuat(dir, bend) {
  const x = bend.clone().addScaledVector(dir, -bend.dot(dir)).normalize();
  const z = new THREE.Vector3().crossVectors(x, dir);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, dir, z));
}

/**
 * A tint { recolor: colour, below, ref }: only the texture's dark, greyish parts (a suit's fabric) take the
 * new colour, keeping their light and shade; bright parts (the shirt) and colourful ones (a patterned tie)
 * stay as they are. below: how dark (0..1, linear) a texel must be to change; ref: the fabric's typical
 * darkness, which comes out as exactly `recolor`.
 */
function recolor(mat, { recolor: colour, below = 0.2, ref = 0.05, maxSat = 0.35 }) {
  const c = new THREE.Color(colour);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.recolorTo = { value: new THREE.Vector3(c.r, c.g, c.b) };
    shader.uniforms.recolorParams = { value: new THREE.Vector3(below, ref, maxSat) };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 recolorTo;\nuniform vec3 recolorParams;\nvoid main() {')
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float lum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float hi = max( max( sampledDiffuseColor.r, sampledDiffuseColor.g ), sampledDiffuseColor.b );
  float lo = min( min( sampledDiffuseColor.r, sampledDiffuseColor.g ), sampledDiffuseColor.b );
  float sat = hi > 0.0 ? ( hi - lo ) / hi : 0.0;
  float k = ( 1.0 - smoothstep( recolorParams.x * 0.7, recolorParams.x * 1.3, lum ) )
          * ( 1.0 - smoothstep( recolorParams.z * 0.7, recolorParams.z * 1.3, sat ) );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, recolorTo * ( lum / recolorParams.y ), k );
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  mat.customProgramCacheKey = () => 'recolor';
  mat.needsUpdate = true;
}

/**
 * A model's meshes made ready to draw: shadows, no hit tests (the invisible primitive parts take hits), the arm
 * skin under sleeves hidden, the theme's tints (tint: a colour, or { 'part of a material or mesh name': ... }),
 * matte clothes, and solid or cut-out materials instead of MakeHuman's see-through ones.
 */
export function prepareModel(model, tint, look = {}) {
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      o.raycast = () => {}; // hits go to the invisible primitive parts
      if (/armskin/.test(o.name)) o.visible = false; // the arms under the sleeves (shown when one's ripped off: realDamage.js)
      // tint: a colour for the whole model, or { 'part of a material or mesh name': colour }
      // A tint can be [colour, gain]: gain > 1 brightens a dark texture (multiplying can only darken)
      if (tint !== undefined) {
        const c = typeof tint === 'object' && !Array.isArray(tint) ? Object.entries(tint).find(([k]) => o.material.name.includes(k) || o.name.includes(k))?.[1] : tint;
        if (c?.recolor !== undefined || c?.tie) {
          o.material = o.material.clone();
          if (c.recolor !== undefined) recolor(o.material, c);
          // { tie: [u0, v0, u1, v1] }: the tie printed in the suit's texture repainted in their tie's colour
          if (c.tie && look.tie !== undefined) paintTie(o.material, c.tie, look.tie);
        } else if (c?.dark !== undefined) {
          // { color, dark }: sunglasses: see-through parts of the texture (the lenses) at least `dark` opaque
          o.material = o.material.clone();
          o.material.color.set(c.color ?? 0x202020);
          const dark = c.dark;
          o.material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `diffuseColor.a = max( diffuseColor.a, ${dark.toFixed(3)} );\n#include <alphatest_fragment>`);
          };
          o.material.customProgramCacheKey = () => 'sunglasses' + dark;
        } else if (c !== undefined) {
          const [colour, gain = 1] = Array.isArray(c) ? c : [c];
          o.material = o.material.clone();
          o.material.color.set(colour).multiplyScalar(gain);
        }
      }
      // Matte, not plastic: exported clothes come out glossy
      if (o.material.isMeshStandardMaterial) {
        o.material.metalness = 0;
        o.material.roughness = Math.max(o.material.roughness, 0.8);
      }
      // MakeHuman exports mark everything as see-through (BLEND), which sorts badly (eye sockets
      // show through the face). Skin and eyes are solid; hair, brows, lashes and clothes are cut-outs
      // (a garment's texture can have cut edges, e.g. the shift dress's neckline).
      const mat = o.material;
      if (mat && mat.transparent && !/glass/i.test(mat.name)) { // glasses stay see-through
        const cutout = !/\.body$|low-poly|high-poly|eye/i.test(mat.name) || /eyebrow|eyelash/i.test(mat.name);
        mat.transparent = false;
        mat.depthWrite = true;
        mat.alphaTest = cutout ? 0.5 : 0;
        if (!cutout) mat.alphaMap = null;
        mat.needsUpdate = true;
      }
    }
  });
}

export class RealBody {
  constructor(rig, gltf, tint, jiggleGain = 1, look = {}) {
    this.rig = rig;
    this.jiggleGain = jiggleGain;
    const root = rig.root;
    // Hide the primitive body, but keep it for hit tests
    root.traverse((o) => { if (o.isMesh) { o.visible = false; o.userData.hitbox = true; } });

    const model = SkeletonUtils.clone(gltf.scene);
    this.model = model;
    prepareModel(model, tint, look);
    this.bones = {};
    for (const [, name] of MAP) this.bones[name] = findBone(model, name);
    if (MAP.some(([, n]) => !this.bones[n])) { console.warn('RealBody: missing bones'); return; }

    // --- set up at rest: rig in its rest pose, at the origin ---
    const saved = { pos: root.position.clone(), quat: root.quaternion.clone(), joints: {} };
    for (const [k, j] of Object.entries(rig.joints)) saved.joints[k] = j.quaternion.clone();
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    rig.resetPose();
    root.add(model);
    root.updateMatrixWorld(true);

    // Same height as the rig (top of the head)
    const P = rig.proportions, s = rig.scale, j = rig.joints;
    const rigTop = j.head.getWorldPosition(new THREE.Vector3()).y + P.head.h * s;
    const top = model.getObjectByName('head_end');
    const modelTop = top ? top.getWorldPosition(new THREE.Vector3()).y : new THREE.Box3().setFromObject(model).max.y;
    model.scale.setScalar(rigTop / Math.max(0.5, modelTop));
    model.updateMatrixWorld(true);

    // Point the model's limbs the way the rig's point at rest (e.g. arms down, not an A-pose)
    const down = (joint, len) => joint.localToWorld(new THREE.Vector3(0, -len / s, 0));
    const aim = [
      ['LeftArm', 'LeftForeArm', j.lShoulder, () => j.lElbow.getWorldPosition(new THREE.Vector3())],
      ['LeftForeArm', 'LeftHand', j.lElbow, () => down(j.lElbow, P.lowerArm.len * s)],
      ['RightArm', 'RightForeArm', j.rShoulder, () => j.rElbow.getWorldPosition(new THREE.Vector3())],
      ['RightForeArm', 'RightHand', j.rElbow, () => down(j.rElbow, P.lowerArm.len * s)],
      ['LeftUpLeg', 'LeftLeg', j.lHip, () => j.lKnee.getWorldPosition(new THREE.Vector3())],
      ['LeftLeg', 'LeftFoot', j.lKnee, () => down(j.lKnee, P.lowerLeg.len * s)],
      ['RightUpLeg', 'RightLeg', j.rHip, () => j.rKnee.getWorldPosition(new THREE.Vector3())],
      ['RightLeg', 'RightFoot', j.rKnee, () => down(j.rKnee, P.lowerLeg.len * s)],
    ];
    for (const [boneName, childName, joint, childPoint] of aim) {
      const bone = findBone(model, boneName), child = findBone(model, childName);
      if (!bone || !child) continue;
      const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      const to = childPoint().sub(joint.getWorldPosition(new THREE.Vector3())).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parentWorld.invert().multiply(turn.multiply(world)));
      bone.updateMatrixWorld(true);
    }

    // Rest orientations (root space = world space here, since root is at the origin).
    // Hips, spine, neck and head copy the rig's rotations; arms and legs are solved (below).
    this.rest = MAP.slice(0, 4).map(([jn, bn]) => ({
      joint: rig.joints[jn],
      bone: this.bones[bn],
      jointRestInv: rig.joints[jn].getWorldQuaternion(new THREE.Quaternion()).invert(),
      boneRest: this.bones[bn].getWorldQuaternion(new THREE.Quaternion()),
    }));
    const hips = this.bones.Hips.getWorldPosition(new THREE.Vector3());
    this.hipsOffset = hips.sub(j.pelvis.getWorldPosition(new THREE.Vector3())); // from the pelvis joint

    // Arms and legs: each model solves its own two-bone IK towards the point the rig's hand/ankle
    // is at (so hands land on the keyboard, the lap, the radio knob with the model's own arm
    // lengths). Each bone's twist comes from the bend plane, measured against a fixed rest frame,
    // so forearms never wind up and hands follow them like real wrists.
    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    const limb = (kind, U, L, E, jU, jL, lowerLen) => {
      const bu = findBone(model, U), bl = findBone(model, L), be = findBone(model, E);
      if (!bu || !bl || !be) return null;
      const pu = wp(bu), pl = wp(bl), pe = wp(be);
      const dU0 = pl.clone().sub(pu).normalize(), dL0 = pe.clone().sub(pl).normalize();
      // Bend axis at rest: elbows bend forwards (axis -x), knees backwards (axis +x)
      const n0 = new THREE.Vector3(kind === 'arm' ? -1 : 1, 0, 0);
      return {
        kind, U: bu, L: bl, jU, jL,
        end: () => jL.localToWorld(new THREE.Vector3(0, -lowerLen / s, 0)),
        lenU: pu.distanceTo(pl), lenL: pl.distanceTo(pe),
        restU: bu.getWorldQuaternion(new THREE.Quaternion()), restL: bl.getWorldQuaternion(new THREE.Quaternion()),
        frameU0: frameQuat(dU0, n0).invert(), frameL0: frameQuat(dL0, n0).invert(),
      };
    };
    this.limbs = [
      limb('arm', 'LeftArm', 'LeftForeArm', 'LeftHand', j.lShoulder, j.lElbow, P.lowerArm.len * s),
      limb('arm', 'RightArm', 'RightForeArm', 'RightHand', j.rShoulder, j.rElbow, P.lowerArm.len * s),
      limb('leg', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', j.lHip, j.lKnee, P.lowerLeg.len * s),
      limb('leg', 'RightUpLeg', 'RightLeg', 'RightFoot', j.rHip, j.rKnee, P.lowerLeg.len * s),
    ].filter(Boolean);
    this._measureTorso(model);
    this._measureThighs(model, root);
    this._setupHands(model);
    this.extras = addExtras(this, look); // (watch, headphones, stubble, moustache hairs, glasses that can go crooked)

    // Back to where the character was
    root.position.copy(saved.pos);
    root.quaternion.copy(saved.quat);
    for (const [k, jt] of Object.entries(rig.joints)) jt.quaternion.copy(saved.joints[k]);
    root.updateMatrixWorld(true);
    // Meshes with ARKit-style face shapes (MakeHuman face units): expressions come back
    this.faceMeshes = [];
    model.traverse((o) => { if (o.isMesh && o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) this.faceMeshes.push(o); });
    // Wobble bones: whatever the model was built with (the figure needn't have soft parts of its own)
    this.wobble = [];
    for (const [name, parts] of Object.entries(JIGGLE_BONES)) {
      const bone = model.getObjectByName(name);
      if (bone) this.wobble.push({ parts, bone, rest: bone.position.clone(), scale: bone.scale.clone() });
    }
    this.ok = true;
    this.update();
  }

  /** Copy the rig's current pose onto the model. Call after the rig has been posed this frame. */
  update() {
    if (!this.ok) return;
    if (this.faceMeshes.length && this.rig.face) this._applyFace(this.rig.face);
    const root = this.rig.root;
    root.updateMatrixWorld(true);
    const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const r of this.rest) {
      // joint now, in root space
      const jNow = _q.copy(rootInv).multiply(r.joint.getWorldQuaternion(_q2));
      const turn = jNow.multiply(r.jointRestInv); // since rest
      if (r.bone === this.bones.Hips) {
        // The hips also follow the pelvis joint's position
        const p = root.worldToLocal(r.joint.getWorldPosition(_v)).add(this.hipsOffset.clone().applyQuaternion(turn));
        r.bone.position.copy(r.bone.parent.worldToLocal(root.localToWorld(p)));
      }
      const desired = turn.multiply(r.boneRest); // root space
      const parentRoot = rootInv.clone().multiply(r.bone.parent.getWorldQuaternion(new THREE.Quaternion()));
      r.bone.quaternion.copy(parentRoot.invert().multiply(desired));
      r.bone.updateMatrixWorld(true);
    }
    for (const l of this.limbs) this._solveLimb(l, root, rootInv);
    if (this.hands) this._applyHands();
    if (this.wobble.length) this._applyWobble();
  }

  /**
   * Belly, breasts and double chin bounce on their own spring, with the same settings as her figure's
   * wobble (config.characters.jiggle: stiffness, damping, max, and each part's amount), x jiggleGain.
   * Unlike the figure's, it reacts to changes in speed, not to speed: walking steadily the belly doesn't
   * lean back, but every step, start, stop, sit-down and hit sets it bouncing.
   */
  _applyWobble() {
    const J = this.rig.proportions?.jiggle ?? config.characters.jiggle;
    const now = performance.now() / 1000;
    const dt = Math.min(1 / 30, Math.max(1e-3, now - (this._wobbleT ?? now - 1 / 60)));
    this._wobbleT = now;
    const anchor = new THREE.Vector3(), acc = new THREE.Vector3();
    for (const w of this.wobble) {
      const b = w.bone, amount = (w.parts.map((k) => J.parts?.[k]).find((a) => a != null) ?? 0) * this.jiggleGain;
      b.parent.updateMatrixWorld(true);
      anchor.copy(w.rest).applyMatrix4(b.parent.matrixWorld); // where it rests this frame
      if (!w.prev || w.prev.distanceToSquared(anchor) > 0.09) { // first frame, or a jump (seated, reset)
        w.prev = anchor.clone(); w.prevVel = new THREE.Vector3(); w.x = new THREE.Vector3(); w.v = new THREE.Vector3();
      }
      const vel = anchor.clone().sub(w.prev).divideScalar(dt);
      acc.copy(vel).sub(w.prevVel).divideScalar(dt).clampLength(0, 40); // (m/s², noise capped)
      w.prev.copy(anchor); w.prevVel.copy(vel);
      // x'' = -k x - a(anchor), damped
      w.v.addScaledVector(w.x, -J.stiffness * dt).addScaledVector(acc, -dt).multiplyScalar(Math.exp(-J.damping * dt));
      w.x.addScaledVector(w.v, dt);
      const lim = J.max * 0.5;
      if (w.x.length() > lim) w.x.setLength(lim);
      const off = w.x.clone().multiplyScalar(J.gain * amount);
      b.position.copy(b.parent.worldToLocal(anchor.add(off)));
      const sq = off.y * (J.squash ?? 0);
      b.scale.set(w.scale.x * (1 - sq * 0.5), w.scale.y * (1 + sq), w.scale.z * (1 - sq * 0.5));
      b.updateMatrixWorld(true);
    }
  }

  /**
   * The hands (at rest, set-up time): for each finger joint, the axis it curls about (in its own space), and the
   * hand's own "along the fingers" and "out of the palm" directions, so it can be shaped and aimed.
   */
  _setupHands(model) {
    this.hands = {};
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    for (const [side, s] of [[1, 'l'], [-1, 'r']]) {
      const b = (n) => model.getObjectByName(`${n}_${s}`);
      const hand = b('hand'), lower = b('lowerarm');
      if (!hand || !lower || !b('middle_01') || !b('index_01') || !b('pinky_01') || !b('thumb_03')) continue;
      model.updateMatrixWorld(true);
      const h = wp(hand);
      const along = wp(b('middle_01')).sub(h).normalize();
      const across = wp(b('index_01')).sub(wp(b('pinky_01'))).projectOnPlane(along).normalize();
      const palm = new THREE.Vector3().crossVectors(along, across).normalize();
      if (wp(b('thumb_03')).sub(h).dot(palm) < 0) palm.negate(); // (the palm is on the thumb tip's side)
      const joints = {}; // finger -> [{ bone, rest, axis }] (knuckle to tip)
      for (const f of [...FINGERS, 'thumb']) {
        const list = [1, 2, 3].map((k) => b(`${f}_0${k}`)).filter(Boolean);
        if (list.length < 2) continue;
        // One hinge per finger, from its straight rest direction (re-working it per joint goes wrong once curled)
        const d = wp(list[1]).sub(wp(list[0])).normalize();
        const axisW = new THREE.Vector3().crossVectors(d, palm).normalize(); // (a positive turn curls towards the palm)
        joints[f] = list.map((bone) => ({ bone, rest: bone.quaternion.clone(), axis: axisW.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()) }));
      }
      const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.hands[side] = {
        hand, lower, joints, handRest: hand.quaternion.clone(), // (the wrist's own angle, put back every frame)
        alongL: along.clone().applyQuaternion(hq), palmL: palm.clone().applyQuaternion(hq),
        curl: {}, aimAmt: 0, // (eased towards the shape asked for)
      };
    }
  }

  /**
   * Shape each hand (rig.handShape, set each frame by whatever's posing them: a pointing finger, two fingers, a
   * fist; otherwise relaxed, fingers a little curled), and turn a pointing hand so its fingers point at its aim:
   * the forearm rolls (as a real one does) so the palm faces down, and the wrist bends the rest of the way.
   */
  _applyHands() {
    const fresh = this.rig.handShapeT && performance.now() - this.rig.handShapeT < 150;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - (this._handT ?? now)));
    this._handT = now;
    const ease = 1 - Math.exp(-12 * dt);
    for (const side of [1, -1]) {
      const H = this.hands[side];
      if (!H) continue;
      H.hand.quaternion.copy(H.handRest); // (straight wrist unless something aims it this frame: no pose sticks)
      const want = fresh ? this.rig.handShape?.[side] : null;
      const shape = HAND_SHAPES[want?.shape ?? 'relaxed'] ?? HAND_SHAPES.relaxed;
      const amount = want?.amount ?? 1;
      for (const [f, js] of Object.entries(H.joints)) {
        const target = (shape[f] ?? shape.fingers).map((a, i) => a * amount + HAND_SHAPES.relaxed[f === 'thumb' ? 'thumb' : 'fingers'][i] * (1 - amount));
        const cur = (H.curl[f] ??= target.slice());
        js.forEach((J, i) => {
          cur[i] += (target[i] - cur[i]) * ease;
          J.bone.quaternion.copy(J.rest).multiply(_q.setFromAxisAngle(J.axis, cur[i]));
        });
      }
      // Aiming the hand
      H.aimAmt += ((want?.aim ? amount : 0) - H.aimAmt) * ease;
      if (want?.aim) { H.aimAt = want.aim.clone(); H.palmAt = want.palm?.clone() ?? null; }
      if (H.aimAmt > 0.01 && H.aimAt) this._aimHand(H, H.aimAt, H.aimAmt, H.palmAt);
      H.hand.updateMatrixWorld(true);
    }
  }

  /** palm: which way the palm should face (world; default: down). */
  _aimHand(H, aim, k, palm = null) {
    const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
    const setWorld = (bone, q) => { bone.quaternion.copy(wq(bone.parent).invert().multiply(q)); bone.updateMatrixWorld(true); };
    H.lower.updateMatrixWorld(true);
    const elbow = H.lower.getWorldPosition(new THREE.Vector3()), wrist = H.hand.getWorldPosition(new THREE.Vector3());
    const arm = wrist.clone().sub(elbow).normalize();
    // Where the fingers should point: at the aim, but the wrist bends no more than MAX_WRIST from the forearm
    let f = aim.clone().sub(wrist).normalize();
    const bend = arm.angleTo(f);
    if (bend > MAX_WRIST) f = arm.clone().applyAxisAngle(new THREE.Vector3().crossVectors(arm, f).normalize(), MAX_WRIST);
    // The palm faces down, or the way asked (or, pointing straight along that, towards the body's front)
    const down = palm ? palm.clone().normalize() : new THREE.Vector3(0, -1, 0);
    let p = down.clone().projectOnPlane(f);
    if (p.lengthSq() < 0.05) p = new THREE.Vector3(0, 0, -1).applyQuaternion(wq(this.rig.root)).projectOnPlane(f);
    p.normalize();
    // 1. The forearm rolls about itself so the palm comes round towards that (a real forearm turns, not the wrist)
    const palmNow = H.palmL.clone().applyQuaternion(wq(H.hand)).projectOnPlane(arm).normalize();
    const palmWant = p.clone().projectOnPlane(arm);
    if (palmWant.lengthSq() > 1e-4) {
      palmWant.normalize();
      let roll = Math.atan2(new THREE.Vector3().crossVectors(palmNow, palmWant).dot(arm), palmNow.dot(palmWant));
      roll = THREE.MathUtils.clamp(roll, -MAX_ROLL, MAX_ROLL) * k;
      setWorld(H.lower, new THREE.Quaternion().setFromAxisAngle(arm, roll).multiply(wq(H.lower)));
    }
    // 2. The wrist: fingers along f, palm towards p
    const x1 = H.alongL, y1 = H.palmL;
    const A = new THREE.Matrix4().makeBasis(x1, y1, new THREE.Vector3().crossVectors(x1, y1));
    const B = new THREE.Matrix4().makeBasis(f, p, new THREE.Vector3().crossVectors(f, p));
    const desired = new THREE.Quaternion().setFromRotationMatrix(B.multiply(A.transpose()));
    setWorld(H.hand, wq(H.hand).slerp(desired, k));
  }

  /** Two-bone IK for one arm/leg, in root space. */
  _solveLimb(l, root, rootInv) {
    const toRoot = (v) => root.worldToLocal(v);
    const S = toRoot(l.U.getWorldPosition(new THREE.Vector3()));
    let T = toRoot(l.end());
    const pole = toRoot(l.jL.getWorldPosition(new THREE.Vector3())).sub(S); // the rig's elbow/knee
    if (l.kind === 'arm') T = this._outOfThighs(this._outOfTorso(T, root), root);
    const toT = T.clone().sub(S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l.lenU - l.lenL) + 1e-3, (l.lenU + l.lenL) * 0.999);
    const dir = toT.normalize();
    let n = new THREE.Vector3().crossVectors(dir, pole);
    if (n.lengthSq() < 1e-8) n.set(l.kind === 'arm' ? 1 : -1, 0, 0);
    n.normalize();
    const a = Math.acos(THREE.MathUtils.clamp((l.lenU * l.lenU + d * d - l.lenL * l.lenL) / (2 * l.lenU * d), -1, 1));
    const dU = dir.clone().applyAxisAngle(n, a);
    const elbow = S.clone().addScaledVector(dU, l.lenU);
    const dL = S.clone().addScaledVector(dir, d).sub(elbow).normalize();
    const b = n.clone().negate(); // bend axis (same sense as the rest frame's)
    const set = (bone, frame0, rest, dNow) => {
      const desired = frameQuat(dNow, b).multiply(frame0).multiply(rest); // root space
      const parentRoot = rootInv.clone().multiply(bone.parent.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(parentRoot.invert().multiply(desired));
      bone.updateMatrixWorld(true);
    };
    set(l.U, l.frameU0, l.restU, dU);
    set(l.L, l.frameL0, l.restL, dL);
  }

  /**
   * Measure the model's torso (bind pose, arm and leg vertices left out) as a stack of ellipses,
   * in the space of its Spine02 bone, so hand targets inside the body can be pushed out to its surface.
   */
  _measureTorso(model) {
    let body = null;
    model.traverse((o) => { if (o.isSkinnedMesh && (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = o; });
    const spine = this.bones.Spine02;
    if (!body || !spine) return;
    const limbBone = /arm|hand|thumb|index|middle|ring|pinky|clavicle|shoulder|leg|thigh|calf|foot|ball|toe/i;
    const bones = body.skeleton.bones;
    const pos = body.geometry.attributes.position, si = body.geometry.attributes.skinIndex, sw = body.geometry.attributes.skinWeight;
    const inv = spine.matrixWorld.clone().invert(); // world (= root space at setup) -> spine space
    const pts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      if (limbBone.test(bones[best]?.name ?? '')) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld).applyMatrix4(inv);
      pts.push(v.clone());
    }
    if (pts.length < 50) return;
    // Spine space axes are the bone's own; find which axis is "up" (towards the head)
    const up = this.bones.Head.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).normalize();
    const ax = Math.abs(up.x) > Math.abs(up.y) ? (Math.abs(up.x) > Math.abs(up.z) ? 'x' : 'z') : (Math.abs(up.y) > Math.abs(up.z) ? 'y' : 'z');
    const others = ['x', 'y', 'z'].filter((k) => k !== ax);
    const ys = pts.map((p) => p[ax]);
    const lo = Math.min(...ys), hi = Math.max(...ys.filter((y) => y < Math.max(...ys) - 0.18)); // stop below the head
    const N = 12, h = (hi - lo) / N, bands = [];
    for (let i = 0; i < N; i++) bands.push({ min: [Infinity, Infinity], max: [-Infinity, -Infinity] });
    for (const p of pts) {
      const i = Math.floor((p[ax] - lo) / h);
      if (i < 0 || i >= N) continue;
      for (let k = 0; k < 2; k++) { bands[i].min[k] = Math.min(bands[i].min[k], p[others[k]]); bands[i].max[k] = Math.max(bands[i].max[k], p[others[k]]); }
    }
    this.torso = { ax, others, lo, h, bands, restSpine: spine.matrixWorld.clone() }; // root space at setup
  }

  /**
   * Each thigh's thickness along it (rest pose; skin and clothes): ten slices from hip to knee, each slice's
   * radius round the bone (the 90th percentile of its points, so a stray fold doesn't count). In root space.
   */
  _measureThighs(model, root) {
    this.thighs = [];
    const meshes = [];
    model.traverse((o) => { if (o.isSkinnedMesh && o.visible && !/hair|eye|low-poly|high-poly|lash|brow/i.test(o.material?.name ?? '')) meshes.push(o); });
    for (const [U, L] of [['LeftUpLeg', 'LeftLeg'], ['RightUpLeg', 'RightLeg']]) {
      const hip = findBone(model, U), knee = findBone(model, L);
      if (!hip || !knee) continue;
      const A = root.worldToLocal(hip.getWorldPosition(new THREE.Vector3())), B = root.worldToLocal(knee.getWorldPosition(new THREE.Vector3()));
      const AB = B.clone().sub(A), len2 = AB.lengthSq();
      const bins = Array.from({ length: 10 }, () => []);
      const v = new THREE.Vector3();
      for (const m of meshes) {
        m.skeleton.update();
        const g = m.geometry, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, bones = m.skeleton.bones;
        for (let i = 0; i < g.attributes.position.count; i++) {
          let best = 0, bw = -1;
          for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
          if (bones[best] !== hip) continue;
          root.worldToLocal(m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld));
          const t = v.clone().sub(A).dot(AB) / len2;
          if (t < 0 || t >= 1) continue;
          bins[Math.floor(t * 10)].push(v.clone().sub(A).addScaledVector(AB, -t).length());
        }
      }
      const radius = bins.map((b) => (b.length ? b.sort((x, y) => x - y)[Math.floor(b.length * 0.9)] : 0));
      for (let i = 0; i < 10; i++) if (!radius[i]) radius[i] = radius[i - 1] ?? 0.07;
      this.thighs.push({ hip, knee, radius });
    }
  }

  /** If a hand target is inside a thigh, move it out onto the leg (on top, when seated: hands rest on the lap). */
  _outOfThighs(T, root) {
    const margin = 0.03; // (the hand's own thickness under the wrist)
    const up = root.worldToLocal(root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0))).normalize();
    for (let pass = 0; pass < 2; pass++) {
      for (const th of this.thighs) {
        const A = root.worldToLocal(th.hip.getWorldPosition(new THREE.Vector3())), B = root.worldToLocal(th.knee.getWorldPosition(new THREE.Vector3()));
        const AB = B.clone().sub(A), axis = AB.clone().normalize();
        const t = T.clone().sub(A).dot(AB) / AB.lengthSq();
        if (t < 0 || t > 1) continue; // (past the hip or the knee)
        const C = A.clone().addScaledVector(AB, t);
        const R = th.radius[Math.min(9, Math.floor(t * 10))] + margin;
        const radial = T.clone().sub(C).projectOnPlane(axis);
        const d = radial.length();
        if (d >= R) continue;
        // Out the way it's nearest, but on top if the leg is lying flat (seated) and the hand isn't clearly beside it
        let dir = d > 1e-4 ? radial.clone().divideScalar(d) : new THREE.Vector3();
        const top = up.clone().projectOnPlane(axis);
        if (Math.abs(axis.dot(up)) < 0.7 && top.lengthSq() > 1e-4 && dir.dot(top.normalize()) < 0.6) dir.add(top.multiplyScalar(1.5));
        if (dir.lengthSq() < 1e-6) dir.copy(up);
        T = C.clone().addScaledVector(dir.normalize(), R);
      }
    }
    return T;
  }

  /** If a hand target is inside the torso, move it out to just outside the surface. */
  _outOfTorso(T, root) {
    const t = this.torso;
    if (!t) return T;
    const rootInvM = root.matrixWorld.clone().invert();
    const spineNow = rootInvM.multiply(this.bones.Spine02.matrixWorld); // root space
    const toSpine = spineNow.clone().invert();
    const p = T.clone().applyMatrix4(toSpine);
    const i = Math.floor((p[t.ax] - t.lo) / t.h);
    const band = t.bands[i];
    if (!band || band.min[0] === Infinity) return T;
    const margin = 0.035;
    const c0 = (band.min[0] + band.max[0]) / 2, c1 = (band.min[1] + band.max[1]) / 2;
    const r0 = (band.max[0] - band.min[0]) / 2 + margin, r1 = (band.max[1] - band.min[1]) / 2 + margin;
    const e0 = (p[t.others[0]] - c0) / r0, e1 = (p[t.others[1]] - c1) / r1;
    const r = Math.hypot(e0, e1);
    if (r >= 1) return T;
    const k = r < 1e-4 ? 0 : 1 / r;
    p[t.others[0]] = c0 + (r < 1e-4 ? r0 : e0 * k * r0);
    p[t.others[1]] = c1 + (r < 1e-4 ? 0 : e1 * k * r1);
    return p.applyMatrix4(spineNow);
  }

  /**
   * The primitive rig's Face (face.js) still runs, invisible: its blended expression, blinks,
   * talking and gaze are turned into ARKit face-shape weights on the model.
   */
  _applyFace(face) {
    const c = face.current;
    const w = {};
    const add = (k, v) => { w[k] = Math.min(1, Math.max(0, (w[k] ?? 0) + v)); };
    const both = (k, v) => { add(k + 'Left', v); add(k + 'Right', v); };
    // Lids (and blinks)
    const closed = Math.max(c.lids, Math.sin(face.blink * Math.PI));
    both('eyeBlink', closed * 0.95);
    if (c.lids < 0.05) both('eyeWide', 0.5);
    // Brows: raise (m), angle (+ worried / - frown), asym (lifts her left brow)
    if (c.brows.raise > 0) { add('browInnerUp', c.brows.raise / 0.012); both('browOuterUp', c.brows.raise / 0.012); }
    else both('browDown', -c.brows.raise / 0.011);
    if (c.brows.angle > 0) add('browInnerUp', c.brows.angle / 0.3);
    else both('browDown', -c.brows.angle / 0.6);
    if (c.brows.asym) add('browOuterUpLeft', c.brows.asym / 0.012);
    // Mouth: smile (+ up / - down), open, width, asym (a smirk on her left)
    if (c.mouth.smile > 0) both('mouthSmile', c.mouth.smile / 0.35);
    else both('mouthFrown', -c.mouth.smile / 0.5);
    if (c.mouth.asym) add('mouthSmileLeft', c.mouth.asym * 2.5);
    if (c.mouth.width < 1) add('mouthPucker', (1 - c.mouth.width) * 1.6);
    else both('mouthStretch', (c.mouth.width - 1) * 3);
    add('jawOpen', (c.mouth.open ?? 0) * 0.7 + (face.talkOpen ?? 0) * 0.45);
    // Gaze, from the head's point of view (+x is their left, +z forward)
    if (face.gazeTarget) {
      const local = this.rig.joints.head.worldToLocal(face.gazeTarget.clone());
      const yaw = Math.max(-1, Math.min(1, Math.atan2(local.x, local.z) / 0.5));
      const pitch = Math.max(-1, Math.min(1, Math.atan2(local.y - 0.12, Math.hypot(local.x, local.z)) / 0.35));
      if (yaw > 0) { add('eyeLookOutLeft', yaw); add('eyeLookInRight', yaw); } else { add('eyeLookInLeft', -yaw); add('eyeLookOutRight', -yaw); }
      if (pitch > 0) both('eyeLookUp', pitch); else both('eyeLookDown', -pitch);
    }
    for (const m of this.faceMeshes) {
      const dict = m.morphTargetDictionary, infl = m.morphTargetInfluences;
      for (const k in dict) infl[dict[k]] = w[k] ?? 0;
    }
  }
}
