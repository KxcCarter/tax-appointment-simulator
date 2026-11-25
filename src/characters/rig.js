import * as THREE from 'three';
import { config } from '../config.js';
import { theme, characterPalettes } from '../theme.js';
import { partGeometry, faceZ, roundGlasses, isFigure, isNatural, torsoFront, headShell } from './partShapes.js';
import { Face } from './face.js';

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
  const style = look.style ?? theme.look.characterStyle;
  // Shared proportions <- style tweaks <- this character's own build (look.proportions)
  const P = { ...config.characters.proportions, ...(config.characters.styleProportions?.[style] ?? {}), ...(look.proportions ?? {}) };
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

  const part = (parent, kind, w, h, d, color, y, name) => {
    const mesh = new THREE.Mesh(partGeometry(style, kind, w, h, d), m(color));
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
  // 'natural' + a curvy build (P.curvy): an hourglass torso and pelvis
  const curvy = isNatural(style) && P.curvy ? 'Curvy' : '';
  parts.pelvis = part(pelvis, 'pelvis' + curvy, P.pelvis.w, P.pelvis.h, P.pelvis.d, col.trousers, 0, 'pelvisMesh');

  const spine = joint(pelvis, 0, P.pelvis.h / 2, 0, 'spine');
  const natural = isNatural(style);
  // 'natural': the waist reaches down into the pelvis, so bending at the spine shows no gap
  const tuck = natural ? 0.05 : 0;
  parts.torso = part(spine, 'torso' + curvy, P.torso.w, P.torso.h + tuck, P.torso.d, col.jacket, (P.torso.h - tuck) / 2, 'torsoMesh');
  if (natural && !look.legUpper) {
    // A belt at the waistband, with a buckle (trousers only)
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.032, 32), theme.material('beltLeather'));
    belt.scale.set(P.pelvis.w * 0.96, 1, P.pelvis.d * 0.98);
    belt.position.y = P.pelvis.h / 2 - 0.022;
    pelvis.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.01), theme.material('beltBuckle'));
    buckle.position.set(0, P.pelvis.h / 2 - 0.022, P.pelvis.d * 0.49);
    pelvis.add(buckle);
  }
  const wobbly = []; // parts that wobble (P.jiggle)
  if (P.belly) {
    // A rounded belly on the lower front of the torso
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), m(col.jacket));
    belly.scale.set(P.belly.w, P.belly.h, P.belly.d * 2);
    belly.position.set(0, P.belly.y, P.torso.d / 2 - P.belly.d * 0.35);
    belly.name = 'bellyMesh';
    spine.add(belly);
    wobbly.push({ mesh: belly, part: 'belly' });
  }
  if (P.bust) {
    for (const side of [1, -1]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(P.bust.r, 20, 14), m(col.jacket));
      // 'natural': softer, set lower into the chest
      // (P.bust.depth: how far it stands out from the chest, 0..1; leave it out for the softer default)
      const soft = isNatural(style), depth = P.bust.depth ?? (soft ? 0.62 : 0.85);
      b.scale.set(soft ? 1.1 : 1, soft ? 0.9 : 0.92, depth);
      b.position.set(side * P.bust.spacing * (soft ? 1.05 : 1), P.bust.y - (soft ? 0.015 : 0), P.torso.d / 2 - P.bust.r + P.bust.forward * (soft && P.bust.depth == null ? 0.55 : 1));
      spine.add(b);
    }
  }
  if (P.chest) {
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), m(col.jacket));
    chest.scale.set(P.chest.w, P.chest.h, P.chest.d * 2);
    chest.position.set(0, P.chest.y, P.torso.d / 2 - P.chest.d * 0.45);
    spine.add(chest);
    wobbly.push({ mesh: chest, part: 'chest' });
  }

  const neck = joint(spine, 0, P.torso.h, 0, 'neck');
  part(neck, 'neck', 0.1, P.neck + 0.04, 0.1, col.skin, P.neck / 2, 'neckMesh');
  const headPivot = joint(neck, 0, P.neck, 0, 'head');
  parts.head = part(headPivot, 'head', P.head.w, P.head.h, P.head.d, col.skin, P.head.h / 2, 'headMesh');
  const face = addFace(headPivot, look, P.head, style, m);
  if (P.jowls) {
    // A double chin under the jaw
    const jowls = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), m(col.skin));
    jowls.scale.set(P.jowls.w, P.jowls.h, P.jowls.d);
    jowls.position.set(0, P.jowls.h * 0.15, P.head.d * 0.18);
    headPivot.add(jowls);
    wobbly.push({ mesh: jowls, part: 'jowls' });
  }
  addHair(headPivot, look, P.head, style, m);
  if (look.headset !== undefined) {
    // Headphones round the neck (look.headset): the band behind the neck, the ear cups resting on the collarbones
    const r = Math.max(0.1, P.jowls ? P.jowls.w * 0.48 : 0.08);
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 28, Math.PI), m(look.headset));
    band.rotation.x = -Math.PI / 2;
    band.position.y = 0.02;
    neck.add(band);
    for (const side of [1, -1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 18), m(look.headset));
      cup.rotation.set(0, 0.5 * side, Math.PI / 2 + 0.35 * side);
      cup.position.set(side * r, 0.0, 0.03);
      neck.add(cup);
      if (look.headsetCushion !== undefined) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 18), m(look.headsetCushion));
        pad.position.y = -0.022 * side;
        cup.add(pad);
      }
    }
  }

  const armY = P.torso.h - P.upperArm.thick / 2;
  const armX = P.torso.w / 2 + P.upperArm.thick / 2 - P.shoulderInset;
  // 'natural': trousers hang straight (stockings, look.legLower, show the calf)
  const legCut = natural && look.legLower === undefined ? 'Trousers' : '';
  const limb = (parent, x, y, upper, lower, upperColor, lowerColor, side, kind) => {
    const a = joint(parent, x, y, 0, side + (kind === 'arm' ? 'Shoulder' : 'Hip'));
    // 'natural': the thigh reaches up into the hips, so there's no dip where the leg starts
    const reach = natural && kind === 'leg' ? upper.thick * 0.45 : 0;
    part(a, 'upper' + (kind === 'arm' ? 'Arm' : 'Leg' + legCut), upper.thick, upper.len + reach, upper.thick, upperColor, -(upper.len - reach) / 2, side + 'Upper' + kind);
    if (natural && kind === 'arm') {
      // A rounded shoulder (deltoid) joining the arm to the torso
      // (flattened, and reaching in over the top of the torso: a slope, not a shoulder pad)
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), m(upperColor));
      cap.scale.set(upper.thick * 1.45, upper.thick * 0.78, upper.thick * 1.02);
      cap.position.set((side === 'l' ? -1 : 1) * upper.thick * 0.42, upper.thick * 0.02, 0);
      a.add(cap);
    }
    const b = joint(a, 0, -upper.len, 0, side + (kind === 'arm' ? 'Elbow' : 'Knee'));
    part(b, 'lower' + (kind === 'arm' ? 'Arm' : 'Leg' + legCut), lower.thick, lower.len, lower.thick, lowerColor, -lower.len / 2, side + 'Lower' + kind);
    let end;
    if (kind === 'arm') {
      if (P.mitten) {
        end = new THREE.Mesh(partGeometry(style, 'hand', P.mitten.w, P.mitten.h, P.mitten.d), m(col.skin));
        end.position.y = -lower.len - P.mitten.h * 0.45;
        if (natural && side === 'r') end.scale.x = -1; // mirrored: the palm faces the body, the thumb is in front
      } else {
        end = new THREE.Mesh(new THREE.SphereGeometry(P.hand, 12, 10), m(col.skin));
        end.position.y = -lower.len - P.hand * 0.6;
      }
    } else {
      end = new THREE.Mesh(partGeometry(style, 'foot', P.foot.w, P.foot.h, P.foot.l), m(col.shoes));
      end.position.set(0, -lower.len - P.foot.h / 2, P.foot.l * 0.25);
      if (natural && look.heels) {
        // High heels (look.heels): the shoe tips toe-down onto a thin heel
        end.scale.set(0.9, 0.85, 0.92);
        end.rotation.x = 0.32;
        end.position.y += 0.02;
        const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.075, 10), m(col.shoes));
        heel.position.set(0, -lower.len - P.foot.h - 0.005, P.foot.l * 0.25 - P.foot.l * 0.38);
        b.add(heel);
      }
    }
    b.add(end);
    return { upper: a, lower: b, end };
  };
  const lowerArmColor = col.shirt === col.jacket ? col.skin : col.jacket;
  const sleeve = look.shortSleeves ? col.skin : lowerArmColor;
  const lArm = limb(spine, armX, armY, P.upperArm, P.lowerArm, col.jacket, sleeve, 'l', 'arm');
  const rArm = limb(spine, -armX, armY, P.upperArm, P.lowerArm, col.jacket, sleeve, 'r', 'arm');
  // Wristwatch on the left wrist, face on the back of the wrist (outward, +x)
  let watch = null;
  if (look.watch) {
    watch = new THREE.Group();
    watch.position.set(0, -P.lowerArm.len * 0.86, 0);
    lArm.lower.add(watch);
    const wrist = (P.lowerArm.thick / 2) * (natural ? 0.68 : 1); // 'natural' forearms narrow to the wrist
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(wrist + 0.005, wrist + 0.005, 0.02, 16), theme.material('watchStrap'));
    watch.add(strap);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 16), theme.material('watchFace'));
    dial.rotation.z = Math.PI / 2;
    dial.position.x = wrist + 0.007;
    watch.add(dial);
  }
  // Legs: trousers by default; a skirt + stockings look via legUpper / legLower
  const legUp = look.legUpper ?? col.trousers, legLow = look.legLower ?? col.trousers;
  const lLeg = limb(pelvis, P.hipSpacing, -P.pelvis.h / 2, P.upperLeg, P.lowerLeg, legUp, legLow, 'l', 'leg');
  const rLeg = limb(pelvis, -P.hipSpacing, -P.pelvis.h / 2, P.upperLeg, P.lowerLeg, legUp, legLow, 'r', 'leg');

  // Shirt front / tie on the chest. On the round 'soft' torso the front is curved, so sit them a bit proud.
  const chestZ = P.torso.d / 2 + (style === 'soft' ? 0.012 : 0.004);
  // 'natural': the shirt front and tie follow the chest (patches of the torso's own surface)
  const front = (y0, y1, halfAngle, grow, color, vee = 0) => {
    const H = P.torso.h + tuck, cy = (P.torso.h - tuck) / 2;
    // (two-sided: at the top edge you look in under the patch, which would show its shadow)
    const mesh = new THREE.Mesh(torsoFront(P.torso.w, H, P.torso.d, { y0: (y0 - cy) / H, y1: (y1 - cy) / H, halfAngle, grow, vee }, 'torso' + curvy), m(color, { side: THREE.DoubleSide }));
    mesh.position.y = cy;
    spine.add(mesh);
    return mesh;
  };
  const shirtFront = look.shirt !== undefined && look.jacket !== undefined && look.shirt !== look.jacket;
  // (under a jacket: a V-shaped opening, narrowing to a point)
  if (natural && look.neckline === 'plunge') {
    // A plunging V neckline (look.neckline): skin from the collarbones down between the bust
    front(P.torso.h * 0.45, P.torso.h * 0.95, 0.5, 1.012, look.skin, 0.89);
  } else if (natural && shirtFront) front(P.torso.h * 0.42, P.torso.h * 0.93, 0.42, 1.014, look.shirt, 0.92);
  if (natural && look.tie !== undefined) front(P.torso.h * 0.36, P.torso.h * 0.92, 0.11, 1.03, look.tie);
  if (!natural && shirtFront) {
    const bib = new THREE.Mesh(partGeometry(style, 'trim', P.torso.w * 0.32, P.torso.h * 0.55, 0.012), m(look.shirt));
    bib.position.set(0, P.torso.h * 0.68, chestZ - (style === 'soft' ? 0.02 : 0));
    spine.add(bib);
  }
  if (!natural && look.tie !== undefined) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.05, P.torso.h * 0.5, 0.012), m(look.tie));
    tie.position.set(0, P.torso.h * 0.66, chestZ + 0.006);
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
    face,      // Face (expressions, gaze, talking) for the 'figure' style; null otherwise
    watch,     // wristwatch group (left wrist) or null
    style,
    scale: s,
    proportions: P,   // the merged build (ragdoll.js sizes its colliders from it)
    hands: { l: lArm.end, r: rArm.end }, // the hand meshes (for things held in them)
    /** Soft parts (belly, chest, jowls) wobble behind the body (P.jiggle; call after posing). */
    jiggle: P.jiggle && wobbly.length ? makeJiggle(root, wobbly, P.jiggle) : () => {},
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

/** Eyes, nose and glasses, placed on the front surface of whatever head shape the style uses. */
function addFace(headPivot, look, H, style, m) {
  const cy = H.h / 2;                  // head centre height within the head pivot
  const front = (x, y) => faceZ(style, H, x, y - cy);
  if (isFigure(style)) return addExpressiveFace(headPivot, look, H, front, m, style);
  const eyeY = H.h * 0.58, eyeX = 0.065;
  const round = style !== 'blocky';

  const nose = new THREE.Mesh(partGeometry(style, 'nose', 0.05, 0.07, 0.05), m(look.skin));
  nose.position.set(0, H.h * 0.42, front(0, H.h * 0.42) + 0.015);
  headPivot.add(nose);

  for (const ex of [-eyeX, eyeX]) {
    const eye = round
      ? new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), theme.material('black'))
      : new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.01), theme.material('black'));
    if (round) eye.scale.set(1, 1, 0.5);
    eye.position.set(ex, eyeY, front(ex, eyeY) + 0.003);
    headPivot.add(eye);
  }

  if (look.glasses === undefined) return null;
  const frame = m(look.glasses);
  if (roundGlasses(style)) {
    for (const ex of [-eyeX, eyeX]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 20), frame);
      ring.position.set(ex, eyeY, front(ex, eyeY) + 0.012);
      headPivot.add(ring);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6), frame);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, eyeY + 0.01, front(0, eyeY) + 0.014);
    headPivot.add(bridge);
  } else {
    for (const ex of [-eyeX, eyeX]) {
      const z = front(ex, eyeY);
      const lens = new THREE.Mesh(partGeometry(style, 'trim', 0.085, 0.055, 0.012), frame);
      lens.position.set(ex, eyeY, z + 0.008);
      headPivot.add(lens);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.014), m(look.skin));
      glass.position.set(ex, eyeY, z + 0.009);
      headPivot.add(glass);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.016), theme.material('black'));
      eye.position.set(ex, eyeY, z + 0.01);
      headPivot.add(eye);
    }
  }
}

/** 'figure' style: ears, a defined nose, and a Face with eyes, lids, brows and mouth. */
function addExpressiveFace(headPivot, look, H, front, m, style) {
  // Long hair on a 'natural' head covers the ears (and earrings)
  const earsHidden = isNatural(style) && look.hairStyle === 'long';
  for (const side of [1, -1]) {
    if (earsHidden) continue;
    const ear = new THREE.Mesh(partGeometry('figure', 'ear', 0.035, 0.07, 0.03), m(look.skin));
    ear.position.set(side * (H.w / 2 + 0.006), H.h * 0.5, -0.01);
    headPivot.add(ear);
    if (look.earrings !== undefined) {
      const ring = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), m(look.earrings));
      ring.position.set(side * (H.w / 2 + 0.012), H.h * 0.33, -0.005);
      headPivot.add(ring);
    }
  }
  const noseY = H.h * 0.42;
  const nose = new THREE.Mesh(partGeometry('figure', 'nose', 0.032, 0.066, 0.04), m(look.skin));
  nose.position.set(0, noseY, front(0, noseY) + 0.008);
  nose.rotation.x = -0.25; // tip forward, bridge back
  headPivot.add(nose);

  if (look.moustache) {
    const y = H.h * 0.31;
    const tache = new THREE.Mesh(partGeometry('figure', 'trim', 0.075, 0.018, 0.016), m(look.brows ?? look.hair));
    tache.position.set(0, y, front(0, y) + 0.006);
    headPivot.add(tache);
  }

  if (look.stubble !== undefined && isNatural(style)) {
    // Stubble along the jaw and chin, below the mouth (look.stubble: its colour)
    const beard = new THREE.Mesh(headShell(style, H.w, H.h, H.d, { y0: -0.5, y1: -0.22, center: 0, half: 1.75, grow: 1.025 }), m(look.stubble, { side: THREE.DoubleSide }));
    beard.position.y = H.h / 2;
    headPivot.add(beard);
  }

  const pal = characterPalettes;
  const face = new Face(headPivot, H, front, {
    skin: look.skin,
    eyes: look.eyes ?? pal.eyes[0],
    brows: look.brows ?? look.hair,
    lips: look.lips ?? look.skin,
    lashes: look.lashes,
  });

  if (look.glasses !== undefined) {
    // One group, pivoting on the bridge of the nose (a blow knocks them crooked, then off: damage.js)
    const frame = m(look.glasses);
    const glasses = new THREE.Group();
    glasses.name = 'glasses';
    glasses.position.set(0, face.eyeY + 0.008, front(0, face.eyeY) + 0.018);
    headPivot.add(glasses);
    const at = (mesh, x, y, z) => { mesh.position.set(x, y, z).sub(glasses.position); glasses.add(mesh); };
    for (const e of face.eyes) {
      const x = e.socket.position.x;
      at(new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.005, 8, 24), frame), x, face.eyeY, front(x, face.eyeY) + 0.016);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.046, 6), frame);
    bridge.rotation.z = Math.PI / 2;
    at(bridge, 0, face.eyeY + 0.008, front(0, face.eyeY) + 0.018);
  }
  return face;
}

function addHair(headPivot, look, H, style, m) {
  const hairMat = m(look.hair);
  if (look.hairStyle !== 'bald') {
    if (isNatural(style)) {
      // Fitted shells of the head's own shape: a cap down to the hairline, the back, above the ears.
      // Two-sided, so hair is never see-through from below or from the inside of a long fall.
      const hairBoth = m(look.hair, { side: THREE.DoubleSide });
      const shell = (o) => {
        const mesh = new THREE.Mesh(headShell(style, H.w, H.h, H.d, o), hairBoth);
        mesh.position.y = H.h / 2;
        headPivot.add(mesh);
      };
      const hs = look.hairStyle ?? 'short';
      if (hs !== 'balding') shell({ y0: 0.3, grow: 1.1 });                            // top, hairline above the brows
      if (hs === 'long') {
        // Past the shoulders at the back, down past the chin at the sides, framing the face
        shell({ y0: -1.15, y1: 0.38, center: Math.PI, half: 1.0, grow: 1.12, hang: -0.1 });  // down her back
        shell({ y0: -0.6, y1: 0.36, center: Math.PI, half: 2.45, grow: 1.14, hang: -0.1 });  // over the ears, to the jaw
      } else if (hs === 'bob') {
        shell({ y0: -0.22, y1: 0.36, center: Math.PI, half: 1.95, grow: 1.12 });     // chin-length, framing the face
      } else {
        shell({ y0: -0.2, y1: 0.36, center: Math.PI, half: 1.3, grow: 1.08 });      // the back, down to the nape
        shell({ y0: 0.06, y1: 0.36, center: Math.PI, half: 2.05, grow: 1.07 });     // the sides, above the ears
      }
    } else if (isFigure(style)) {
      // Hair follows the head: rounded pieces sized just outside it (no clipping),
      // with a clean hairline above the brows and fuller at the back and sides.
      const piece = (w, h, d, x, y, z) => {
        const mesh = new THREE.Mesh(partGeometry(style, 'head', w, h, d), hairMat);
        mesh.position.set(x, y, z);
        headPivot.add(mesh);
      };
      const g = 0.016; // gap outside the head
      const hs = look.hairStyle === 'long' ? 'bob' : look.hairStyle ?? 'short'; // (long hair: 'natural' only)
      // 'balding': no top, just a horseshoe at the back and sides
      if (hs !== 'balding') piece(H.w + 2 * g, H.h * 0.24, H.d + 2 * g, 0, H.h * 0.93, 0);   // top, hairline at ~0.81
      if (hs === 'bob') {
        // Chin-length: back and sides come down past the ears, framing the face
        piece(H.w + 2 * g, H.h * 0.8, H.d * 0.5, 0, H.h * 0.5, -H.d * 0.26);
        for (const side of [1, -1]) {
          piece(0.026, H.h * 0.66, H.d * 0.66, side * (H.w / 2 + g * 0.7), H.h * 0.47, -H.d * 0.14);
        }
      } else {
        piece(H.w + 2 * g, H.h * 0.72, H.d * 0.45, 0, H.h * 0.62, -H.d * 0.29);              // back
        for (const side of [1, -1]) {
          piece(0.03, H.h * 0.42, H.d * 0.62, side * (H.w / 2 + g * 0.6), H.h * 0.7, -H.d * 0.17); // sides, above the ears
        }
      }
    } else if (style === 'soft') {
      // A cap over the top and back of the egg, tilted back to show the forehead
      const g = new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const cap = new THREE.Mesh(g, hairMat);
      cap.scale.set(H.w + 0.03, H.h + 0.03, H.d + 0.03);
      cap.position.y = H.h / 2;
      cap.rotation.x = -0.45;
      headPivot.add(cap);
    } else {
      const top = new THREE.Mesh(partGeometry(style, 'trim', H.w + 0.02, 0.07, H.d + 0.02), hairMat);
      top.position.y = H.h + 0.02;
      headPivot.add(top);
      const back = new THREE.Mesh(partGeometry(style, 'trim', H.w + 0.02, H.h * 0.6, 0.05), hairMat);
      back.position.set(0, H.h * 0.68, -H.d / 2 - 0.01);
      headPivot.add(back);
    }
  }
  if (look.hairStyle === 'ponytail' && isFigure(style)) {
    const tail = new THREE.Mesh(partGeometry('figure', 'upperArm', 0.07, H.h * 0.6, 0.07), hairMat);
    tail.position.set(0, H.h * 0.45, -H.d / 2 - 0.05);
    tail.rotation.x = 0.25;
    headPivot.add(tail);
    const tie = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), hairMat);
    tie.position.set(0, H.h * 0.74, -H.d / 2 - 0.02);
    headPivot.add(tie);
  }
  if (look.hairStyle === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), hairMat);
    bun.position.set(0, H.h + (style === 'soft' ? 0.06 : isNatural(style) ? 0.03 : 0.1), isNatural(style) ? -0.07 : -0.06);
    headPivot.add(bun);
  }
  if (look.hat === 'fedora' || look.hat === 'cap') {
    const hatMat = m(look.hatColor);
    // All of it in one group (a blow can knock it off: damage.js)
    const hat = new THREE.Group();
    hat.name = 'hat';
    headPivot.add(hat);
    headPivot = hat; // (below: parts go into the hat)
    const top = style === 'soft' ? H.h * 0.9 : H.h;
    const fig = isFigure(style);
    if (look.hat === 'fedora') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(fig ? 0.21 : 0.26, fig ? 0.21 : 0.26, 0.018, 28), hatMat);
      brim.position.y = top + (fig ? 0.02 : 0.04);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(fig ? 0.115 : 0.13, fig ? 0.15 : 0.16, 0.13, 28), hatMat);
      crown.position.y = top + (fig ? 0.09 : 0.11);
      headPivot.add(brim, crown);
      if (fig) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.151, 0.151, 0.025, 28), m(look.hatBand ?? look.hatColor));
        band.position.y = top + 0.042;
        headPivot.add(band);
      }
    } else if (isNatural(style)) {
      // A fitted cap: a shell over the top of the head, and a peak at the front
      const crown = new THREE.Mesh(headShell(style, H.w, H.h, H.d, { y0: 0.2, grow: 1.16 }), hatMat);
      crown.position.y = H.h / 2;
      const peak = new THREE.Mesh(partGeometry(style, 'trim', H.w * 0.78, 0.016, 0.11), hatMat);
      // (look.capBackwards: the peak at the back of the neck)
      const back = look.capBackwards ? -1 : 1;
      peak.position.set(0, H.h * (look.capBackwards ? 0.72 : 0.8), back * (H.d / 2 + 0.04));
      peak.rotation.x = -0.12 * back;
      headPivot.add(crown, peak);
    } else {
      const crown = new THREE.Mesh(partGeometry(style, 'trim', H.w + 0.04, 0.09, H.d + 0.04), hatMat);
      crown.position.y = top + 0.05;
      const peak = new THREE.Mesh(partGeometry(style, 'trim', H.w, 0.02, 0.14), hatMat);
      peak.position.set(0, top + 0.01, H.d / 2 + 0.07);
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

// ---------------------------------------------------------------------------
// Wobble: soft parts (belly, chest, jowls) hang back on a spring and catch up, so a heavy
// body bounces when it walks, sits down or gets hit. P.jiggle:
//   stiffness, damping   the spring (lower stiffness = slower, floppier bounce)
//   gain                 how much of the lag shows (x)
//   max                  the most a part moves (m)
//   squash               a part squashes and stretches with its bounce
//   parts                { belly: 1, chest: 0.6, jowls: 0.4 }: how much each part wobbles
// ---------------------------------------------------------------------------
function makeJiggle(root, soft, J) {
  const st = soft
    .filter((p) => (J.parts?.[p.part] ?? 0) > 0)
    .map((p) => ({ ...p, amount: J.parts[p.part], base: p.mesh.position.clone(), scale: p.mesh.scale.clone(), lag: null, vel: new THREE.Vector3() }));
  const anchor = new THREE.Vector3(), off = new THREE.Vector3(), local = new THREE.Vector3();
  return (dt) => {
    if (!dt) return;
    dt = Math.min(dt, 1 / 30);
    root.updateMatrixWorld(true);
    for (const p of st) {
      const parent = p.mesh.parent;
      anchor.copy(p.base).applyMatrix4(parent.matrixWorld); // where it would be without the wobble
      if (!p.lag || p.lag.distanceToSquared(anchor) > 0.09) { p.lag = anchor.clone(); p.vel.set(0, 0, 0); } // jumped (seated, reset)
      off.subVectors(anchor, p.lag);
      p.vel.addScaledVector(off, J.stiffness * dt).multiplyScalar(Math.exp(-J.damping * dt));
      p.lag.addScaledVector(p.vel, dt);
      // The lag, in the part's own frame, exaggerated
      local.copy(p.lag);
      parent.worldToLocal(local).sub(p.base).multiplyScalar(J.gain * p.amount);
      if (local.length() > J.max * p.amount) local.setLength(J.max * p.amount);
      p.mesh.position.copy(p.base).add(local);
      const sq = local.y * (J.squash ?? 0);
      p.mesh.scale.set(p.scale.x * (1 - sq * 0.5), p.scale.y * (1 + sq), p.scale.z * (1 - sq * 0.5));
    }
  };
}
