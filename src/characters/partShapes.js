import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
    'natural'  the middle ground: the figure's face on a more lifelike body. A head with a real jaw,
               sloping shoulders, chest and waist flowing into the hips, muscle-shaped limbs (shoulder,
               forearm, calf; narrow wrists and ankles) with smooth elbows and knees, hands with
               fingers and a thumb, shoes with a heel and toe (extras in rig.js: shoulder caps, belt)
*/

export const CHARACTER_STYLES = ['blocky', 'rounded', 'capsule', 'soft', 'figure', 'sculpted', 'natural'];

/** Styles with the expressive face, ears and fitted hair. */
export const isFigure = (style) => style === 'figure' || style === 'sculpted' || style === 'natural';
/** Styles built from organic lathe shapes. */
const isSculpted = (style) => style === 'sculpted' || style === 'natural';
export const isNatural = (style) => style === 'natural';

// Lathe profiles: [height fraction (-0.5 bottom .. 0.5 top), radius fraction of the half-width]
const PROFILES = {
  head: [[-0.5, 0], [-0.49, 0.28], [-0.45, 0.5], [-0.36, 0.68], [-0.22, 0.84], [-0.05, 0.95], [0.12, 1.0],
    [0.28, 0.97], [0.4, 0.85], [0.47, 0.62], [0.5, 0.3], [0.505, 0]],
  torso: [[-0.5, 0], [-0.5, 0.82], [-0.4, 0.87], [-0.18, 0.8], [0.08, 0.9], [0.28, 0.99], [0.4, 0.96],
    [0.47, 0.8], [0.5, 0.45], [0.5, 0]],
  pelvis: [[-0.5, 0], [-0.5, 0.62], [-0.32, 0.9], [-0.05, 1.0], [0.3, 0.97], [0.5, 0.86], [0.5, 0]],
};
const TAPER = { upperArm: 0.8, lowerArm: 0.72, upperLeg: 0.72, lowerLeg: 0.66 };

// 'natural': its own head, torso and pelvis profiles (same format as PROFILES)
const NATURAL = {
  // Between the figure's rounded box and the sculpted egg: a fuller jaw and chin
  head: [[-0.5, 0], [-0.49, 0.36], [-0.45, 0.6], [-0.36, 0.76], [-0.22, 0.88], [-0.05, 0.96], [0.12, 1.0],
    [0.28, 0.98], [0.4, 0.88], [0.47, 0.67], [0.5, 0.33], [0.505, 0]],
};
/*
  'natural' torso and pelvis: separate width (x) and depth (z) profiles, so they can taper and curve
  front to back, plus bulges: [height fraction, amount] on the front (chest) or back (shoulder blades,
  seat) only. Same format as PROFILES; radius fractions of the half-width / half-depth.
*/
const NATURAL_BODY = {
  torso: {
    // Waist (bottom, tucked into the pelvis) -> ribs -> broad at the armpits -> sloping shoulders -> neck
    width: [[-0.5, 0.76], [-0.34, 0.74], [-0.1, 0.83], [0.15, 0.94], [0.34, 1.0], [0.42, 0.99], [0.47, 0.9],
      [0.5, 0.6], [0.515, 0.3]],
    depth: [[-0.5, 0.8], [-0.3, 0.8], [-0.05, 0.86], [0.18, 0.95], [0.33, 0.97], [0.43, 0.9], [0.49, 0.7],
      [0.515, 0.42]],
    front: [[-0.5, 0], [-0.1, 0.03], [0.2, 0.16], [0.32, 0.15], [0.45, 0.04], [0.515, 0]],  // chest
    back: [[-0.5, -0.06], [-0.25, -0.08], [0.05, 0], [0.3, 0.09], [0.45, 0.04], [0.515, 0]], // small of the back, shoulder blades
  },
  pelvis: {
    // Crotch -> hips -> waistband (as wide as the waist above it)
    width: [[-0.5, 0.5], [-0.44, 0.8], [-0.3, 0.93], [-0.08, 0.98], [0.2, 0.94], [0.5, 0.88]],
    depth: [[-0.5, 0.45], [-0.44, 0.75], [-0.3, 0.88], [-0.05, 0.92], [0.25, 0.9], [0.5, 0.88]],
    front: [[-0.5, 0], [0.5, 0]],
    back: [[-0.5, 0.05], [-0.3, 0.2], [-0.05, 0.18], [0.25, 0.05], [0.5, 0]],               // the seat
  },
};

// An hourglass figure (a build with curvy: true): a small waist flaring out to full hips and seat
NATURAL_BODY.torsoCurvy = {
  ...NATURAL_BODY.torso,
  width: [[-0.5, 0.62], [-0.36, 0.6], [-0.12, 0.72], [0.15, 0.9], [0.34, 1.0], [0.42, 0.99], [0.47, 0.9],
    [0.5, 0.6], [0.515, 0.3]],
  depth: [[-0.5, 0.74], [-0.3, 0.74], [-0.05, 0.84], [0.18, 0.97], [0.33, 0.98], [0.43, 0.9], [0.49, 0.7],
    [0.515, 0.42]],
  back: [[-0.5, -0.1], [-0.25, -0.1], [0.05, 0], [0.3, 0.06], [0.45, 0.03], [0.515, 0]],         // a deeper curve in the small of the back
};
NATURAL_BODY.pelvisCurvy = {
  width: [[-0.5, 0.78], [-0.4, 0.92], [-0.18, 0.98], [0.05, 0.92], [0.3, 0.72], [0.5, 0.52]],  // narrow at the waist, full at the hips
  depth: [[-0.5, 0.7], [-0.4, 0.86], [-0.2, 0.94], [0.05, 0.9], [0.3, 0.8], [0.5, 0.72]],
  front: [[-0.5, 0], [0.5, 0]],
  back: [[-0.5, 0.06], [-0.3, 0.17], [-0.05, 0.15], [0.25, 0.04], [0.5, 0]],                   // a rounder seat
};

/**
 * A body part with separate width/depth profiles and front/back bulges (NATURAL_BODY), size w x h x d.
 * slice: { y0, y1, halfAngle, grow, vee } makes just a patch of its surface (the front between heights y0..y1,
 * halfAngle radians either side of the middle), `grow` times further out: clothes that follow the body.
 * vee: 0..1, how far the patch narrows towards the bottom (a V-shaped opening, e.g. a blouse under a jacket).
 */
function sculptBody(spec, w, h, d, slice = null) {
  const ys = spec.width.map(([y]) => y);
  const from = slice ? slice.y0 : ys[0], to = slice ? slice.y1 : ys[ys.length - 1];
  const pts = slice ? [] : [new THREE.Vector2(1e-4, from)];
  for (let i = 0; i <= 24; i++) pts.push(new THREE.Vector2(slice?.grow ?? 1, from + ((to - from) * i) / 24));
  if (!slice) pts.push(new THREE.Vector2(1e-4, to));
  const g = slice
    ? new THREE.LatheGeometry(pts, 10, Math.PI - slice.halfAngle, 2 * slice.halfAngle)
    : new THREE.LatheGeometry(pts, 32);
  g.rotateY(Math.PI); // seam at the back (a slice: centred on the front)
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (slice?.vee) {
      // Narrow the patch towards its bottom: the angle from the middle shrinks with depth
      const t = Math.min(1, Math.max(0, (v.y - from) / (to - from))); // (clamped: rounding can overshoot, and (-x) ** 0.8 is NaN)
      const k = 1 - slice.vee * (1 - t) ** 0.8;
      const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, v.z) * k;
      v.x = Math.sin(a) * r; v.z = Math.cos(a) * r;
    }
    const rx = profileAt(spec.width, v.y), rz = profileAt(spec.depth, v.y);
    const bulge = v.z > 0 ? profileAt(spec.front, v.y) : profileAt(spec.back, v.y);
    const zf = v.z * rz * (1 + bulge * Math.abs(v.z)); // bulges strongest at the very front / back
    p.setXYZ(i, v.x * rx * 0.5 * w, v.y * h, zf * 0.5 * d);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Hair for the 'natural' head: a shell of the head's own shape, `grow` times bigger (upwards too, so the
 * crown is covered), between heights y0..y1 (fractions, -0.5 chin .. 0.5 crown) and `half` radians either
 * side of `center` (0 = front, PI = back). hang: below this height the hair falls straight down instead of
 * following the jaw (long hair; y0 can then go below the chin, -0.5).
 */
export function headShell(style, w, h, d, { y0, y1 = 0.505, center = 0, half = Math.PI, grow = 1.08, hang = null }) {
  return cached(`shell|${style}|${w}|${h}|${d}|${y0}|${y1}|${center}|${half}|${grow}|${hang}`, () => {
    const prof = profilesFor(style).head, pts = [];
    const hangR = hang == null ? 0 : profileAt(prof, hang);
    for (let i = 0; i <= 20; i++) {
      const y = y0 + ((y1 - y0) * i) / 20;
      // Falling hair: as wide as the head where it leaves it, a little narrower towards the ends
      const r = hang != null && y < hang ? hangR * (1 - 0.12 * Math.min(1, (hang - y) / 0.8)) : profileAt(prof, y);
      pts.push(new THREE.Vector2(Math.max(1e-4, r * 0.5 * grow), y));
    }
    const g = new THREE.LatheGeometry(pts, 32, center - half, 2 * half);
    g.scale(w, h * (1 + (grow - 1) * 0.8), d);
    g.computeVertexNormals();
    return g;
  });
}

/** A patch of the 'natural' torso's front surface (a shirt front, a tie): see sculptBody's slice. kind: 'torso' | 'torsoCurvy'. */
export function torsoFront(w, h, d, slice, kind = 'torso') {
  return cached(`torsoFront|${kind}|${w}|${h}|${d}|${JSON.stringify(slice)}`, () => sculptBody(NATURAL_BODY[kind], w, h, d, slice));
}
const profilesFor = (style) => (isNatural(style) ? NATURAL : PROFILES);

// 'natural' limbs: radius (fraction of the top radius) from the top (t = 0, at the joint) to the bottom (t = 1)
const MUSCLE = {
  upperArm: [[0, 1.0], [0.22, 0.98], [0.6, 0.86], [1, 0.76]],              // deltoid / biceps to elbow
  lowerArm: [[0, 0.93], [0.2, 1.0], [0.62, 0.78], [1, 0.6]],               // forearm to a narrow wrist
  upperLeg: [[0, 1.08], [0.18, 1.0], [0.45, 0.93], [0.8, 0.78], [1, 0.7]],  // full at the hip, thigh to knee
  lowerLeg: [[0, 0.84], [0.28, 1.0], [0.72, 0.66], [1, 0.54]],             // calf to a narrow ankle
  // In trousers: the cloth hangs straight from the thigh down over the shoe
  upperLegTrousers: [[0, 1.08], [0.18, 1.0], [0.6, 0.92], [1, 0.86]],
  lowerLegTrousers: [[0, 1.06], [0.4, 0.98], [1, 0.95]],
};

/** A limb with a muscle profile (MUSCLE) and rounded ends, length `len` along y, centred. */
function muscleLimb(w, len, d, profile) {
  const rTop = Math.min(w, d) / 2;
  const at = (t) => rTop * profileAt(profile.map(([t0, r]) => [t0 - 0.5, r]), t - 0.5);
  const r0 = at(0), r1 = at(1);
  const yTop = len / 2 - r0, yBot = -len / 2 + r1; // centres of the end caps
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(r1 * Math.cos(a), yBot + r1 * Math.sin(a))); }
  for (let i = 1; i < 12; i++) { const t = 1 - i / 12; pts.push(new THREE.Vector2(at(t), yBot + (yTop - yBot) * (1 - t))); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(r0 * Math.cos(a), yTop + r0 * Math.sin(a))); }
  pts[0].x = 1e-4; pts[pts.length - 1].x = 1e-4;
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateY(Math.PI); // seam at the back
  g.scale(w / (2 * rTop), 1, d / (2 * rTop));
  g.computeVertexNormals();
  return g;
}

/** A capsule from a to b (Vector3s) with radius r. */
function capsuleBetween(a, b, r) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * A hand hanging down from the wrist: palm, four fingers and a thumb. w = thickness (x: the palm faces
 * the body), h = wrist to fingertip, d = across the knuckles (z: the thumb is at the front, +z).
 */
function naturalHand(w, h, d) {
  const parts = [];
  const palmH = h * 0.52;
  const palm = new RoundedBoxGeometry(w, palmH, d, 3, Math.min(w, d) * 0.45);
  palm.translate(0, h / 2 - palmH / 2, 0);
  parts.push(palm);
  // Fingers: index (front) to little finger (back), the middle one longest, slightly curled towards the palm
  const fr = d * 0.11, top = h / 2 - palmH + fr;
  const lengths = [0.4, 0.45, 0.42, 0.34];
  lengths.forEach((f, i) => {
    const z = d * (0.33 - i * 0.22);
    const a = new THREE.Vector3(0, top, z);
    const b = new THREE.Vector3(-w * 0.12, top - h * f, z * 0.9);
    parts.push(capsuleBetween(a, b, fr * (i === 3 ? 0.85 : 1)));
  });
  // Thumb: from the base of the palm, out to the front and down
  parts.push(capsuleBetween(new THREE.Vector3(-w * 0.1, h / 2 - palmH * 0.45, d * 0.38), new THREE.Vector3(-w * 0.25, h / 2 - palmH * 1.05, d * 0.6), d * 0.13));
  const merged = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
  merged.computeVertexNormals();
  return merged;
}

/** A shoe: flat sole, a heel at the back, a lower, narrower toe at the front (+z). */
function naturalShoe(w, h, l) {
  const g = new THREE.SphereGeometry(0.5, 28, 16);
  g.scale(w, h * 2.2, l);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f = v.z / (l / 2); // -1 heel .. 1 toe
    if (v.y > 0) v.y *= 0.62 - 0.32 * Math.max(0, f); // the instep slopes down to the toe
    v.y = Math.max(v.y, -h * 0.5);                   // flat sole
    v.x *= 1 - 0.18 * Math.max(0, f) ** 2;           // narrower towards the toe
    if (f < -0.6) v.x *= 0.92;                       // a narrower heel
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

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

    if (isNatural(style)) {
      if (NATURAL_BODY[kind]) return sculptBody(NATURAL_BODY[kind], w, h, d);
      if (MUSCLE[kind]) return muscleLimb(w, h + w * 0.35, d, MUSCLE[kind]);
      if (kind === 'neck') return new THREE.CylinderGeometry(w * 0.6, w * 0.7, h, 20);
      if (kind === 'hand') return naturalHand(w, h, d);
      if (kind === 'foot') return naturalShoe(w, h, d);
    }
    if (isSculpted(style)) {
      if (LIMBS.has(kind)) return taperedCapsule(w, h + w * 0.35, d, TAPER[kind]);
      const prof = profilesFor(style);
      if (prof[kind]) return lathe(prof[kind], w, h, d);
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
    const R = profileAt(profilesFor(style).head, y / head.h) * 0.5; // radius as a fraction of w (and d)
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
