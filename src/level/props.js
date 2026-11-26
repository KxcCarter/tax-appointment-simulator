import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { theme } from '../theme.js';
import { seeded } from '../util/random.js';

/*
  The waiting room's furniture and things, built in detail (realistic look): rounded edges, real shapes
  (a tubular chrome chair frame, a lathe-turned water bottle, keycaps), and the theme's realistic surfaces
  (theme.surface: roughness, reflections, wood grain, fabric...). Each builder fills a group whose origin,
  size and facing are the same as the simple version's, so physics shapes, seats, hands and anchors still fit.
*/

const S = (name, opts) => theme.surface(name, opts);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ helpers

/** A box with rounded edges (r: the radius). */
export function rbox(w, h, d, r, material, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999), material);
  m.position.set(x, y, z);
  parent?.add(m);
  return m;
}
export function cylinder(rt, rb, h, material, x = 0, y = 0, z = 0, parent = null, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  parent?.add(m);
  return m;
}
/** Turned on a lathe: points [radius, height], bottom to top. */
function lathe(points, material, seg = 32) {
  return new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg), material);
}
/** A bent tube along straight runs with rounded corners (radius bend) through `points`. */
function bentTube(points, radius, material, { bend = 0.04, closed = false } = {}) {
  const path = new THREE.CurvePath();
  // (a closed loop starts and ends halfway along its last side, so every point is a rounded corner)
  const mid = closed ? points[points.length - 1].clone().lerp(points[0], 0.5) : null;
  const pts = closed ? [mid, ...points, mid] : points;
  let from = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const inDir = b.clone().sub(a).normalize(), outDir = c.clone().sub(b).normalize();
    const r = Math.min(bend, b.distanceTo(a) / 2, c.distanceTo(b) / 2);
    const p1 = b.clone().addScaledVector(inDir, -r), p2 = b.clone().addScaledVector(outDir, r);
    path.add(new THREE.LineCurve3(from, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    from = p2;
  }
  path.add(new THREE.LineCurve3(from, pts[pts.length - 1].clone()));
  const geo = new THREE.TubeGeometry(path, Math.max(16, points.length * 14), radius, 10, false);
  return new THREE.Mesh(geo, material);
}
const straightTube = (a, b, radius, material) => bentTube([a, b], radius, material);
/** A box whose back face (-z) is scaled down by `taper` (a CRT's body, a wedge). */
function taperBox(w, h, d, taper, material, lift = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * taper); p.setY(i, p.getY(i) * taper + lift); }
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}
/** A long narrow leaf: tapering to a point, arching over by `arch` (m) along its length. */
function leafGeometry(width, length, arch, twist = 0) {
  const g = new THREE.PlaneGeometry(width, length, 2, 10);
  g.translate(0, length / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / length;
    const w = Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - 0.3 * t); // (narrow at the base, widest a third of the way, a point at the tip)
    p.setX(i, p.getX(i) * w);
    p.setZ(i, arch * t * t + Math.abs(p.getX(i)) * 0.25 + p.getX(i) * twist * t); // (arched, and folded along the midrib)
  }
  g.computeVertexNormals();
  return g;
}
const add = (parent, mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

// ------------------------------------------------------------------ the computer

/**
 * A mid-80s office PC: the desktop unit (two floppy drives, a power light) with the monitor on it.
 * Group: screen faces +z. Returns the screen mesh (a gently curved plane, 0.34 x 0.26, showing `screenMaterial`).
 */
export function buildComputer(g, screenMaterial) {
  // Desktop unit
  rbox(0.46, 0.1, 0.4, 0.008, S('crtPlastic'), 0, 0.05, -0.04, g);
  rbox(0.46, 0.006, 0.4, 0.002, S('crtPlasticDark'), 0, 0.1, -0.04, g); // (the lid's seam)
  for (const x of [-0.11, 0.06]) { // two 5¼" drives
    rbox(0.15, 0.04, 0.01, 0.003, S('crtPlasticDark'), x, 0.05, 0.161, g);
    rbox(0.12, 0.005, 0.012, 0.002, S('plasticBlack'), x, 0.055, 0.163, g);
    rbox(0.022, 0.01, 0.012, 0.003, S('plasticBlack'), x + 0.055, 0.035, 0.163, g);
  }
  rbox(0.02, 0.012, 0.012, 0.003, S('crtPlasticDark'), 0.19, 0.03, 0.161, g); // power switch
  cylinder(0.003, 0.003, 0.006, S('ledGreen'), 0.19, 0.06, 0.163, g, 8).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) rbox(0.004, 0.06, 0.006, S('plasticBlack'), -0.2 + i * 0.008, 0.05, 0.158, g); // vent
  // Monitor: a swivel foot, the housing, the bezel and the curved screen behind glass
  cylinder(0.11, 0.12, 0.018, S('crtPlasticDark'), 0, 0.109, 0, g, 32);
  const mon = new THREE.Group();
  mon.position.set(0, 0.118, 0);
  g.add(mon);
  rbox(0.44, 0.37, 0.12, 0.022, S('crtPlastic'), 0, 0.19, 0.12, mon);
  const body = taperBox(0.4, 0.33, 0.34, 0.66, S('crtPlastic'), 0.015);
  add(mon, body, 0, 0.19, -0.1);
  rbox(0.27, 0.2, 0.06, 0.02, S('crtPlasticDark'), 0, 0.21, -0.28, mon); // the neck at the back
  for (let i = 0; i < 7; i++) rbox(0.2, 0.004, 0.012, 0.002, S('plasticBlack'), 0, 0.33 - i * 0.004, -0.05 - i * 0.03, mon).rotation.x = -0.18; // vents on top
  // Bezel: a frame round the screen, sloping in
  const bezel = S('bezel');
  const bw = 0.38, bh = 0.3, fz = 0.19; // (in front of the housing's face, at 0.18)
  rbox(bw, 0.035, 0.012, 0.004, bezel, 0, 0.19 + bh / 2 - 0.0175, fz, mon);
  rbox(bw, 0.05, 0.012, 0.004, bezel, 0, 0.19 - bh / 2 + 0.025, fz, mon);
  for (const s of [-1, 1]) rbox(0.03, bh, 0.012, 0.004, bezel, s * (bw / 2 - 0.015), 0.19, fz, mon);
  // Screen: curved (a bulge of 8 mm), with the picture; a dark surround; glass in front
  const geo = new THREE.PlaneGeometry(0.34, 0.26, 16, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / 0.17, y = p.getY(i) / 0.13; p.setZ(i, 0.008 * (1 - 0.5 * (x * x + y * y))); }
  geo.computeVertexNormals();
  const screen = new THREE.Mesh(geo, screenMaterial);
  screen.position.set(0, 0.2, 0.183);
  mon.add(screen);
  const glass = new THREE.Mesh(geo.clone(), S('crtGlass'));
  glass.position.set(0, 0.2, 0.186);
  glass.scale.set(1.04, 1.06, 1.3);
  glass.raycast = () => {};
  mon.add(glass);
  rbox(0.35, 0.27, 0.004, 0.0015, S('plasticBlack'), 0, 0.2, 0.181, mon);
  // Controls under the screen: two knobs, a power button and its light, a badge
  for (const x of [0.09, 0.12]) cylinder(0.008, 0.008, 0.01, S('crtPlasticDark'), x, 0.058, 0.19, mon, 12).rotation.x = Math.PI / 2;
  rbox(0.018, 0.012, 0.01, 0.003, S('crtPlasticDark'), 0.16, 0.058, 0.19, mon);
  cylinder(0.0025, 0.0025, 0.004, S('ledGreen'), 0.145, 0.058, 0.193, mon, 8).rotation.x = Math.PI / 2;
  rbox(0.05, 0.012, 0.004, 0.002, S('steel'), -0.13, 0.058, 0.188, mon);
  // A cable out of the back, down behind the desk
  add(g, bentTube([V(0.05, 0.25, -0.33), V(0.06, 0.2, -0.42), V(0.08, 0.02, -0.45), V(0.15, -0.02, -0.48)], 0.005, S('cable')));
  // (screen's world position moves up with the desktop unit; the receptionist looks at it, wherever it is)
  return screen;
}

/** An 80s keyboard: a sloped base, sculpted keycaps in the main block, function keys and a number pad.
 *  Group: the side nearest the typist is +z; 0.46 x 0.17 overall. */
export function buildKeyboard(g) {
  const base = taperBox(0.46, 0.028, 0.17, 1, S('crtPlastic'));
  // (a wedge: higher at the back)
  const bp = base.geometry.attributes.position;
  for (let i = 0; i < bp.count; i++) if (bp.getZ(i) < 0 && bp.getY(i) > 0) bp.setY(i, bp.getY(i) + 0.008);
  base.geometry.computeVertexNormals();
  g.add(base);
  const cap = new RoundedBoxGeometry(0.0165, 0.01, 0.0165, 2, 0.003);
  const keys = [], dark = [];
  const row = (z, y, x0, n, step = 0.019, darkSet = null) => { for (let k = 0; k < n; k++) (darkSet?.(k) ? dark : keys).push([x0 + k * step, y, z]); };
  const yAt = (z) => 0.019 - z * 0.05; // (the keys follow the slope)
  row(-0.066, yAt(-0.066), -0.205, 4, 0.019, () => true); row(-0.066, yAt(-0.066), -0.122, 4, 0.019, () => true); row(-0.066, yAt(-0.066), -0.039, 4, 0.019, () => true); // F1-F12
  for (let r = 0; r < 4; r++) { const z = -0.04 + r * 0.02; row(z, yAt(z), -0.205 + r * 0.005, 13, 0.019, (k) => k === 0 && r > 0); }
  for (let r = 0; r < 5; r++) { const z = -0.04 + r * 0.02; row(z, yAt(z), 0.135, 4, 0.019, () => r === 0); } // number pad
  for (const [x, z] of [[0.09, 0.0], [0.09, 0.02], [0.071, 0.02], [0.109, 0.02]]) dark.push([x, yAt(z), z + 0.02]); // arrows
  const inst = (list, material) => {
    const m = new THREE.InstancedMesh(cap, material, list.length);
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0, 0));
    list.forEach(([x, y, z], i) => m.setMatrixAt(i, mx.compose(V(x, y, z), q, V(1, 1, 1))));
    g.add(m);
  };
  inst(keys, S('keycap'));
  inst(dark, S('keycapDark'));
  rbox(0.11, 0.01, 0.0165, 0.003, S('keycap'), -0.1, yAt(0.06) + 0.0, 0.06, g); // space bar
  for (const x of [-0.19, -0.03]) rbox(0.028, 0.01, 0.0165, 0.003, S('keycapDark'), x, yAt(0.06), 0.06, g); // Ctrl, Alt
  rbox(0.034, 0.01, 0.0165, 0.003, S('keycapDark'), 0.05, yAt(0.0), 0.0, g); // Enter
  for (let i = 0; i < 3; i++) cylinder(0.002, 0.002, 0.003, S(i === 1 ? 'ledGreen' : 'crtPlasticDark'), 0.15 + i * 0.016, 0.026, -0.072, g, 8).rotation.x = Math.PI / 2;
  // Coiled cable out of the back
  add(g, bentTube([V(0, 0.01, -0.085), V(0.01, 0.005, -0.15), V(0.05, 0.0, -0.22)], 0.003, S('cable')));
}

/** A one-button 80s mouse with its cable towards the computer (+z). */
export function buildMouse(g) {
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), S('crtPlastic'));
  body.scale.set(0.031, 0.022, 0.05);
  body.position.y = -0.015;
  g.add(body);
  rbox(0.04, 0.003, 0.002, 0.001, S('crtPlasticDark'), 0, 0.004, 0.018, g); // (the button's edge)
  add(g, bentTube([V(0, -0.008, 0.05), V(0, -0.012, 0.09), V(0.03, -0.014, 0.16), V(0.02, -0.014, 0.3)], 0.0022, S('cable')));
}

// ------------------------------------------------------------------ chairs

/** A waiting-room chair: tubular chrome sled frame, padded vinyl seat and back. Faces +z; the seat top is at 0.485. */
export function buildWaitingChair(g) {
  const vinyl = S('vinyl'), chrome = S('chrome');
  rbox(0.5, 0.085, 0.48, 0.035, vinyl, 0, 0.443, 0.0, g);           // seat cushion
  rbox(0.46, 0.02, 0.44, 0.006, S('plasticBlack'), 0, 0.395, 0, g); // its shell
  const back = rbox(0.48, 0.42, 0.075, 0.035, vinyl, 0, 0.79, -0.235, g);
  back.rotation.x = -0.08;
  rbox(0.44, 0.38, 0.02, 0.006, S('plasticBlack'), 0, 0.79, -0.28, g).rotation.x = -0.08;
  for (const x of [-0.235, 0.235]) {
    // Each side: one bent tube (floor runner, front leg, seat rail, rear leg) and an upright for the back
    add(g, bentTube([V(x, 0.012, 0.22), V(x, 0.39, 0.2), V(x, 0.39, -0.19), V(x, 0.012, -0.22)], 0.011, chrome, { closed: true, bend: 0.05 }));
    add(g, bentTube([V(x, 0.39, -0.2), V(x, 0.62, -0.27), V(x * 0.94, 0.98, -0.3)], 0.01, chrome, { bend: 0.06 }));
    for (const z of [0.2, -0.2]) cylinder(0.014, 0.014, 0.01, S('rubber'), x, 0.006, z, g, 12); // glides
  }
  add(g, straightTube(V(-0.235, 0.39, 0.12), V(0.235, 0.39, 0.12), 0.009, chrome));
  add(g, straightTube(V(-0.235, 0.39, -0.12), V(0.235, 0.39, -0.12), 0.009, chrome));
  add(g, straightTube(V(-0.22, 0.6, -0.268), V(0.22, 0.6, -0.268), 0.009, chrome));
}

/** The receptionist's office chair: five-star base on casters, gas lift, fabric seat and back. Faces +z; seat top 0.5. */
export function buildOfficeChair(g) {
  const black = S('plasticBlack');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = rbox(0.3, 0.03, 0.045, 0.012, black, 0, 0.07, 0);
    leg.geometry.translate(0.15, 0, 0);
    leg.rotation.set(0, a, 0.06);
    g.add(leg);
    const c = new THREE.Group();
    c.position.set(Math.cos(a) * 0.29, 0.03, -Math.sin(a) * 0.29);
    c.rotation.y = a;
    g.add(c);
    cylinder(0.025, 0.025, 0.02, S('rubber'), 0, 0, 0.012, c, 16).rotation.z = Math.PI / 2;
    cylinder(0.025, 0.025, 0.02, S('rubber'), 0, 0, -0.012, c, 16).rotation.z = Math.PI / 2;
    rbox(0.02, 0.03, 0.03, 0.006, black, 0, 0.025, 0, c);
  }
  cylinder(0.05, 0.06, 0.05, black, 0, 0.09, 0, g, 24);
  cylinder(0.022, 0.022, 0.22, S('chrome'), 0, 0.22, 0, g, 20);
  cylinder(0.035, 0.035, 0.1, black, 0, 0.17, 0, g, 20);
  rbox(0.2, 0.05, 0.22, 0.01, black, 0, 0.39, 0, g); // mechanism
  rbox(0.48, 0.085, 0.46, 0.04, S('officeFabric'), 0, 0.457, 0, g);
  rbox(0.46, 0.02, 0.44, 0.006, black, 0, 0.41, 0, g);
  // The back on a bar from under the seat
  add(g, bentTube([V(0, 0.4, -0.1), V(0, 0.4, -0.27), V(0, 0.68, -0.3)], 0.016, black, { bend: 0.06 }));
  const back = rbox(0.44, 0.46, 0.08, 0.04, S('officeFabric'), 0, 0.84, -0.25, g);
  back.rotation.x = -0.06;
  rbox(0.42, 0.44, 0.02, 0.008, black, 0, 0.84, -0.293, g).rotation.x = -0.06;
}

// ------------------------------------------------------------------ the water cooler

/** The cooler's cabinet (static): 0.34 x 0.95 x 0.34, its base on the floor at the group's origin, front +z. */
export function buildCoolerCabinet(g) {
  const body = S('coolerBody');
  rbox(0.34, 0.9, 0.34, 0.025, body, 0, 0.47, 0, g);
  rbox(0.32, 0.05, 0.32, 0.012, S('plasticBlack'), 0, 0.025, 0, g); // plinth
  // The alcove you fill a cup in, recessed
  rbox(0.24, 0.3, 0.02, 0.01, S('crtPlasticDark'), 0, 0.68, 0.162, g);
  rbox(0.22, 0.012, 0.1, 0.004, S('coolerDrip'), 0, 0.555, 0.19, g); // drip tray
  for (let i = 0; i < 7; i++) rbox(0.004, 0.004, 0.09, 0.001, S('plasticBlack'), -0.09 + i * 0.03, 0.563, 0.19, g); // its grille
  // Two paddle taps
  for (const [x, s] of [[-0.06, 'tapBlue'], [0.06, 'tapRed']]) {
    rbox(0.045, 0.04, 0.04, 0.008, S('crtPlasticDark'), x, 0.79, 0.18, g);
    rbox(0.03, 0.045, 0.012, 0.005, S(s), x, 0.79, 0.205, g).rotation.x = -0.25;
    cylinder(0.007, 0.006, 0.03, S('crtPlasticDark'), x, 0.76, 0.19, g, 10);
  }
  rbox(0.1, 0.03, 0.004, 0.002, S('steel'), 0, 0.88, 0.171, g); // badge
  // Panel seams
  rbox(0.342, 0.004, 0.342, 0.002, S('crtPlasticDark'), 0, 0.4, 0, g);
  // The collar on top the bottle sits in
  cylinder(0.13, 0.15, 0.035, body, 0, 0.935, 0, g, 32);
  cylinder(0.06, 0.06, 0.01, S('plasticBlack'), 0, 0.955, 0, g, 24);
}

/** The 5-gallon bottle, upside down (neck at the bottom), part-full. Group origin as the simple version's. */
export function buildCoolerBottle(g) {
  const prof = [[0.0, 0.24], [0.08, 0.236], [0.118, 0.22], [0.133, 0.19], [0.135, 0.14], [0.128, 0.12], [0.135, 0.1], [0.135, 0.04], [0.128, 0.02],
    [0.135, 0.0], [0.135, -0.06], [0.128, -0.08], [0.135, -0.1], [0.133, -0.14], [0.118, -0.17], [0.07, -0.2], [0.035, -0.215], [0.033, -0.26]];
  const shell = lathe(prof.slice().reverse().map(([r, y]) => [r, y]), S('bottle'), 40);
  shell.renderOrder = 2;
  g.add(shell);
  const water = lathe(prof.slice().reverse().filter(([, y]) => y < 0.12).map(([r, y]) => [r * 0.94, y]).concat([[0, 0.115]]), S('water'), 40);
  water.renderOrder = 1;
  g.add(water);
  cylinder(0.036, 0.036, 0.03, S('tapBlue'), 0, -0.25, 0, g, 16); // the cap, down in the collar
}

/** Paper cups in a dispenser tube on the wall. Group at the tube's middle. */
export function buildCupDispenser(g) {
  cylinder(0.042, 0.042, 0.3, S('bottle'), 0, 0, 0, g, 24);
  for (let i = 0; i < 9; i++) cylinder(0.038, 0.028, 0.07, S('paperCup'), 0, -0.12 + i * 0.03, 0, g, 18);
  cylinder(0.046, 0.046, 0.02, S('crtPlasticDark'), 0, 0.15, 0, g, 24);
  rbox(0.03, 0.06, 0.02, 0.005, S('crtPlasticDark'), 0, 0.1, -0.045, g);
}

// ------------------------------------------------------------------ plants

/** A terracotta pot with a rim, and soil. Height h, top radius r (the group's origin at its middle). */
export function buildPot(g, r, h) {
  g.add(lathe([[r * 0.72, -h / 2], [r * 0.78, -h / 2 + 0.01], [r * 0.95, h / 2 - 0.06], [r * 1.02, h / 2 - 0.055], [r * 1.04, h / 2], [r * 0.92, h / 2], [r * 0.9, h / 2 - 0.03]], S('terracotta'), 32));
  cylinder(r * 0.9, r * 0.9, 0.01, S('soil'), 0, h / 2 - 0.025, 0, g, 28);
  cylinder(r * 0.72, r * 0.72, 0.004, S('terracotta'), 0, -h / 2 + 0.002, 0, g, 28);
}

/** Leaves: `count` long leaves arching out from a crown at y (a palm or spider plant). */
export function buildFronds(g, { y, count, length, width, arch, material, seed = 1, spread = 0.9, droop = 0 }) {
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    const L = length * (0.7 + 0.5 * rnd());
    const leaf = new THREE.Mesh(leafGeometry(width * (0.8 + 0.4 * rnd()), L, arch * (0.7 + 0.6 * rnd()) + droop, (rnd() - 0.5) * 0.4), material);
    const a = (i / count) * Math.PI * 2 + rnd() * 0.5;
    leaf.position.set(Math.cos(a) * 0.02, y, Math.sin(a) * 0.02);
    leaf.rotation.set(0, -a + Math.PI / 2, 0, 'YXZ');
    leaf.rotateX(spread * (0.4 + 0.6 * rnd()));
    g.add(leaf);
  }
}

/** A tall leafy plant (a rubber plant): a few stems of different heights, broad glossy leaves all the way up. */
export function buildRubberPlant(g, { y0, height, seed = 3 }) {
  const rnd = seeded(seed);
  const stems = [[0, 0, 1], [0.05, 0.03, 0.75], [-0.04, 0.05, 0.55]];
  stems.forEach(([sx, sz, k], j) => {
    const h = height * k, lean = (j - 1) * 0.08;
    const stem = cylinder(0.009, 0.014, h, S('woodDark'), sx + lean * 0.5, y0 + h / 2, sz, g, 8);
    stem.rotation.z = -lean;
    const n = Math.round(14 * k);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1), a = i * 2.4 + j;
      const L = 0.2 + 0.08 * (1 - t) + rnd() * 0.04;
      const leaf = new THREE.Mesh(leafGeometry(0.1 + 0.03 * (1 - t), L, 0.06), S(rnd() < 0.35 ? 'leafDark' : 'leaf'));
      leaf.position.set(sx + lean * t, y0 + 0.12 + t * (h - 0.12), sz);
      leaf.rotation.set(0, a, 0, 'YXZ');
      leaf.rotateX(1.0 - t * 0.55 + rnd() * 0.25);
      g.add(leaf);
    }
  });
}

// ------------------------------------------------------------------ the desk phone

/** A push-button desk phone with the handset on its cradle and a coiled cord. Group: front +z, on the desk. */
export function buildDeskPhone(g) {
  const ph = S('phone');
  const body = taperBox(0.2, 0.06, 0.22, 0.8, ph, 0.012);
  body.position.y = 0.03;
  body.rotation.x = 0.12;
  g.add(body);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) rbox(0.018, 0.008, 0.016, 0.003, S('keycap'), -0.025 + c * 0.025, 0.063 - r * 0.005, 0.05 - r * 0.024, g);
  // Handset: two cups joined by a grip, lying across the top
  const hs = new THREE.Group();
  hs.position.set(0, 0.085, -0.04);
  g.add(hs);
  rbox(0.22, 0.03, 0.045, 0.014, ph, 0, 0, 0, hs);
  for (const x of [-0.09, 0.09]) rbox(0.06, 0.035, 0.06, 0.016, ph, x, -0.008, 0, hs);
  // Coiled cord from the handset's end down to the body
  const pts = [];
  for (let t = 0; t <= 1; t += 1 / 160) {
    const a = t * Math.PI * 2 * 14;
    pts.push(V(-0.12 - 0.02 * t + Math.cos(a) * 0.008, 0.07 - 0.06 * t + Math.sin(a) * 0.008, -0.04 + 0.08 * t + Math.sin(t * Math.PI) * 0.03));
  }
  add(g, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.0018, 6), S('cable')));
}

/** A coffee mug with a handle (origin at its middle, like the simple one's). */
export function buildMug(g) {
  g.add(lathe([[0.0, -0.05], [0.038, -0.05], [0.041, -0.045], [0.041, 0.05], [0.036, 0.05], [0.036, -0.04], [0.0, -0.04]], S('ceramic'), 32));
  cylinder(0.034, 0.034, 0.004, S('coffee'), 0, 0.03, 0, g, 24);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 20, Math.PI * 1.2), S('ceramic'));
  handle.position.set(0.04, 0.0, 0);
  handle.rotation.z = -Math.PI * 0.6;
  g.add(handle);
}

/** A filing cabinet's drawer front: recessed panel, a chrome pull and a card holder. Group at its centre, front +z. */
export function buildDrawer(g, w, h) {
  rbox(w - 0.02, h - 0.02, 0.02, 0.006, S('cabinetMetal'), 0, 0, 0, g);
  rbox(0.12, 0.02, 0.025, 0.008, S('chrome'), 0, -h * 0.12, 0.018, g);
  rbox(0.07, 0.035, 0.004, 0.002, S('chrome'), 0, h * 0.2, 0.012, g);
  rbox(0.06, 0.026, 0.002, 0.001, S('paper'), 0, h * 0.2, 0.0145, g);
}
