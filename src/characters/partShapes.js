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
    'sculpted' (mockup) the figure's face, on organic shapes: an egg-shaped head with a jaw,
               a torso with chest and waist, hips, tapering limbs
*/

export const CHARACTER_STYLES = ['blocky', 'rounded', 'capsule', 'soft', 'figure', 'sculpted'];

/** Styles with the expressive face, ears and fitted hair. */
export const isFigure = (style) => style === 'figure' || style === 'sculpted';
/** Styles built from organic lathe shapes. */
const isSculpted = (style) => style === 'sculpted';

// Lathe profiles: [height fraction (-0.5 bottom .. 0.5 top), radius fraction of the half-width]
const PROFILES = {
  head: [[-0.5, 0], [-0.49, 0.28], [-0.45, 0.5], [-0.36, 0.68], [-0.22, 0.84], [-0.05, 0.95], [0.12, 1.0],
    [0.28, 0.97], [0.4, 0.85], [0.47, 0.62], [0.5, 0.3], [0.505, 0]],
  torso: [[-0.5, 0], [-0.5, 0.82], [-0.4, 0.87], [-0.18, 0.8], [0.08, 0.9], [0.28, 0.99], [0.4, 0.96],
    [0.47, 0.8], [0.5, 0.45], [0.5, 0]],
  pelvis: [[-0.5, 0], [-0.5, 0.62], [-0.32, 0.9], [-0.05, 1.0], [0.3, 0.97], [0.5, 0.86], [0.5, 0]],
};
const TAPER = { upperArm: 0.8, lowerArm: 0.72, upperLeg: 0.72, lowerLeg: 0.66 };

/** Lathe a profile into a solid of size w x h x d (elliptical cross-sections). */
function lathe(profile, w, h, d) {
  const g = new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(Math.max(1e-4, r * 0.5), y)), 28);
  g.rotateY(Math.PI); // the lathe's seam goes at the back, not down the middle of the face
  g.scale(w, h, d);
  g.computeVertexNormals();
  return g;
}

/** Radius fraction of a profile at height fraction y (linear between points). */
function profileAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const [y0, r0] = profile[i - 1], [y1, r1] = profile[i];
    if (y <= y1) return y1 === y0 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

/** A capsule that narrows from the top (at the joint) to the bottom, length `len` along y. */
function taperedCapsule(w, len, d, taper) {
  const rT = Math.min(w, d) / 2, rB = rT * taper;
  const half = len / 2, pts = [];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(rB * Math.cos(a), -half + rB + rB * Math.sin(a))); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(rT * Math.cos(a), half - rT + rT * Math.sin(a))); }
  pts[0].x = 1e-4; pts[pts.length - 1].x = 1e-4;
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateY(Math.PI); // seam at the back
  g.scale(w / (2 * rT), 1, d / (2 * rT));
  g.computeVertexNormals();
  return g;
}

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

    if (isSculpted(style)) {
      if (LIMBS.has(kind)) return taperedCapsule(w, h + w * 0.35, d, TAPER[kind]);
      if (PROFILES[kind]) return lathe(PROFILES[kind], w, h, d);
      if (kind === 'neck') return new THREE.CylinderGeometry(w * 0.45, w * 0.52, h, 16);
      if (kind === 'hand' || kind === 'foot') return ellipsoid(w, kind === 'foot' ? h * 1.3 : h, d);
    }
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
  if (isSculpted(style)) {
    const R = profileAt(PROFILES.head, y / head.h) * 0.5; // radius as a fraction of w (and d)
    const k = 1 - (x / (head.w * Math.max(1e-4, R))) ** 2;
    return head.d * R * Math.sqrt(Math.max(0, k));
  }
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
  return style === 'capsule' || style === 'soft' || isFigure(style);
}
