import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/*
  Body-part geometry per character style (theme.look.characterStyle).
  Every style keeps the same parts, sizes and joints, so animation, IK and
  ragdolls don't care which one is used. Only the surface changes.

    'blocky'   plain boxes (the first draft)
    'rounded'  the same boxes with softened edges
    'capsule'  rounded-box torso and head, capsule limbs, round glasses
    'soft'     egg-shaped head, capsule body and limbs, rounded feet
    'figure'   like 'capsule' but less cartoonish: smaller head, ears, mitten hands,
               and an expressive face (eyeballs, lids, brows, mouth; see face.js)
*/

export const CHARACTER_STYLES = ['blocky', 'rounded', 'capsule', 'soft', 'figure'];

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const LIMBS = new Set(['upperArm', 'lowerArm', 'upperLeg', 'lowerLeg']);

/** How rounded a box-like part is, as a fraction of its smallest side. */
function roundness(style, kind) {
  if (style === 'rounded') return kind === 'head' ? 0.25 : 0.3;
  if (style === 'capsule') return kind === 'head' ? 0.4 : 0.35;
  if (style === 'figure') return kind === 'head' ? 0.34 : kind === 'hand' ? 0.45 : 0.35;
  return 0;
}

function roundedBox(w, h, d, frac) {
  const r = Math.min(w, h, d) * frac;
  return new RoundedBoxGeometry(w, h, d, 4, r);
}

function ellipsoid(w, h, d) {
  const g = new THREE.SphereGeometry(0.5, 24, 16);
  g.scale(w, h, d);
  return g;
}

/** A capsule of total length `len` along y, scaled to w x d in cross-section. */
function capsule(w, len, d) {
  const r = Math.min(w, d) / 2;
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 16);
  g.scale(w / (2 * r), 1, d / (2 * r));
  return g;
}

/**
 * Geometry for one body part, centred on the origin.
 * kind: pelvis | torso | neck | head | upperArm | lowerArm | upperLeg | lowerLeg | foot | nose
 *       | trim (small attached pieces: hair, glasses frames, hat, shirt front)
 */
export function partGeometry(style, kind, w, h, d) {
  const key = `${style}|${kind}|${w}|${h}|${d}`;
  return cached(key, () => {
    if (style === 'blocky') return new THREE.BoxGeometry(w, h, d);

    if (LIMBS.has(kind)) {
      // Limbs overlap their joints a little so elbows and knees look continuous
      return style === 'rounded' ? roundedBox(w, h, d, 0.3) : capsule(w, h + w * 0.35, d);
    }
    if (kind === 'trim') return roundedBox(w, h, d, 0.45);
    if (kind === 'ear') return ellipsoid(w, h, d);
    if (kind === 'neck') return new THREE.CylinderGeometry(w / 2, w / 2, h, 12);
    if (kind === 'nose') return style === 'rounded' ? roundedBox(w, h, d, 0.3) : ellipsoid(w, h, d);

    if (style === 'soft') {
      if (kind === 'head') return ellipsoid(w, h, d);
      if (kind === 'torso') return capsule(w, h, d);
      if (kind === 'pelvis') return ellipsoid(w, h * 1.5, d);
      if (kind === 'foot') return ellipsoid(w, h * 1.3, d);
    }
    return roundedBox(w, h, d, roundness(style, kind));
  });
}

/** z of the front of the head at (x, y) measured from the head's centre. Used to place eyes and glasses. */
export function faceZ(style, head, x, y) {
  const hw = head.w / 2, hh = head.h / 2, hd = head.d / 2;
  if (style === 'soft') {
    const k = 1 - (x / hw) ** 2 - (y / hh) ** 2;
    return hd * Math.sqrt(Math.max(0, k));
  }
  const r = Math.min(head.w, head.h, head.d) * roundness(style, 'head');
  if (r <= 0) return hd;
  // Rounded box: flat in the middle, curving within r of each edge
  const over = (v, half) => Math.max(0, Math.abs(v) - (half - r));
  const ox = over(x, hw), oy = over(y, hh);
  const inside = r * r - ox * ox - oy * oy;
  return hd - r + Math.sqrt(Math.max(0, inside));
}

/** Whether glasses on this style are round wire rings or flat frames. */
export function roundGlasses(style) {
  return style === 'capsule' || style === 'soft' || style === 'figure';
}
