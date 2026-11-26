import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';
import { Damage } from './damage.js';

/*
  Damage you can see, on a realistic body (realBody.js): the same marks as damage.js (bruises, black
  eyes, cuts that bleed, a nosebleed, a split lip, holes torn in clothes), in the same order and amounts
  (config.damage), but painted into the model's own textures. A skinned model can't have shapes stuck on
  it, and paint moves with every pose and the ragdoll for free.

  Where things are: the face's landmarks (eyes, nose, mouth) are found once from the model's mesh in its
  rest pose; a blow to the body is found on the posed mesh, nearest to where it landed on the (invisible)
  primitive body. Each spot's texture coordinates come from the vertices round it, as does which way is
  "down" in the texture, so blood runs down the face.

  Hats and glasses: knocked off as before (damage.js); the model's own hat or glasses vanish, and the
  figure's flies across the room in their place.
*/

const D = () => config.damage;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// A palette name, or a raw colour from characterPalettes (a number), as a canvas colour
const css = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : theme.css(c));

// What each part of a model is, from its material name (tools/makehuman/build_human.py names them)
const kindOf = (name) => {
  if (/\.body$/.test(name)) return 'skin';
  if (/low-poly|high-poly|eyebrow|eyelash|moustache/.test(name) || name.startsWith('hair.')) return 'face';
  if (/glasses/.test(name)) return 'glasses';
  if (/fedora|cap|hat/.test(name)) return 'hat';
  if (/shoe|flats|booties|boots/.test(name)) return 'shoes';
  return 'cloth';
};
// Body regions by bone (the game_engine skeleton, plus the wobble bones)
const regionOfBone = (b) => {
  if (/head|neck|jiggle_chin/.test(b)) return 'head';
  if (/spine|clavicle|jiggle_belly|jiggle_breast/.test(b)) return 'torso';
  if (/arm|hand|thumb|index|middle|ring|pinky/.test(b)) return 'arm';
  return 'leg'; // pelvis, thighs, calves, feet
};

export class RealDamage extends Damage {
  constructor({ realBody, rig, look, physics, scene }) {
    super({ rig, look, physics, scene });
    this.body = realBody;
    this.layers = [];   // paintable meshes: { mesh, kind, pos (rest, model space), uv, region, side, front }
    this.painted = [];  // { mat, original map } (heal() puts them back)
    this.hidden = [];   // the model's hat/glasses meshes, once knocked off
    this.bleeds = [];   // blood running: { layer, from, dir, len, width, t, dur, drawn }
    realBody.model.traverse((o) => {
      if (!o.isSkinnedMesh || !o.material?.map) return;
      const kind = kindOf(o.material.name);
      if (kind !== 'skin' && kind !== 'cloth') return;
      this.layers.push(this._layer(o, kind));
    });
    this.skin = this.layers.find((l) => l.kind === 'skin');
    this.cloth = this.layers.filter((l) => l.kind === 'cloth');
    if (this.skin) this._findFace();
  }

  // ---------------------------------------------------------------- the marks

  _headMark(kind, side) {
    const F = this.face;
    if (!F) return;
    if (kind === 'blackEye') {
      const s = this.used.has('blackEye:' + side) ? -side : side;
      if (this.used.has('blackEye:' + s)) return this._headMark('bruise', side);
      this.used.add('blackEye:' + s);
      const eye = F.eyes[s];
      // A dark ring round the eye (on the skin above and below it, not in the socket), and a purple lid
      for (const [dx, dy, r, colour, a] of [[0, -0.014, 0.02, 'blackEye', 0.95], [0.012 * s, -0.008, 0.014, 'blackEye', 0.9], [0, 0.009, 0.016, 'bruise', 0.85], [0, 0.016, 0.014, 'blackEye', 0.7]]) {
        const at = this._skinAt(eye.x + dx, eye.y + dy);
        if (at) this._blob(this.skin, at, r, colour, a, { sy: 0.75, jag: 0.15 });
      }
    } else if (kind === 'cut') {
      const spots = [[1.0, 0.03], [1.25, -0.03], [0.5, 0.06]]; // the brow, the cheekbone, the forehead
      const [kx, dy] = pick(spots);
      const at = this._skinAt(F.eyes[side].x * kx, F.eyes[side].y + dy);
      if (!at) return;
      this._slash(this.skin, at, 0.016);
      this._bleed(this.skin, at, 0.006, rand(0.05, 0.09));
    } else if (kind === 'noseBleed') {
      if (this.used.has('nose')) return this._headMark('cut', side);
      this.used.add('nose');
      for (const s of [1, -1]) {
        if (s === -side && Math.random() < 0.5) continue; // one nostril, or both
        const at = this._skinAt(s * 0.008, F.nose.y - 0.014);
        if (at) this._bleed(this.skin, at, 0.006, rand(0.045, 0.065));
      }
    } else if (kind === 'lip') {
      if (this.used.has('lip')) return this._headMark('bruise', side);
      this.used.add('lip');
      const at = this._skinAt(side * 0.02, F.mouthY);
      if (!at) return;
      this._blob(this.skin, at, 0.006, 'cut', 0.9, { jag: 0.3 });
      this._bleed(this.skin, at, 0.004, 0.03);
    } else {
      const spots = [[1.35, -0.04], [1.0, null], [1.6, 0.02]]; // the cheek, the jaw, the temple
      const [kx, dy] = pick(spots);
      const y = dy === null ? F.nose.y - 0.07 : F.eyes[side].y + dy;
      const at = this._skinAt(F.eyes[side].x * kx, y);
      if (at) this._blob(this.skin, at, rand(0.022, 0.032), Math.random() < 0.3 ? 'bruiseOld' : 'bruise', 0.9, { sy: 0.8 });
    }
  }

  _body(region, side, hit, knock) {
    this.bodyHits++;
    const spot = (hit && this._regionOf(hit.object) === region ? this._nearHit(region, hit.point) : null) ?? this._somewhere(region, side);
    if (!spot) return;
    const { layer, pos } = spot;
    if (layer.kind === 'cloth') {
      // A ragged hole in their clothes, showing the shirt (under a jacket) or the skin underneath
      const look = this.look, top = look.jacket ?? look.shirt;
      const underShirt = region !== 'leg' && look.shirt !== undefined && look.shirt !== top;
      const r = rand(...D().tearSize) * (0.8 + 0.2 * Math.min(2, knock));
      this._tear(layer, pos, r, underShirt ? css(look.shirt) : this._skinColour());
    } else {
      this._blob(layer, pos, rand(0.025, 0.04), 'bruise', 0.9, { sy: 0.8 });
    }
  }

  /** Every frame: blood keeps running down from cuts and the nose. */
  update(dt) {
    if (!this.bleeds.length) return;
    for (const b of this.bleeds) {
      b.t = Math.min(b.dur, b.t + dt);
      const k = 1 - (1 - b.t / b.dur) ** 2; // fast, then slowing
      const reach = b.len * (0.08 + 0.92 * k);
      if (reach - b.drawn < b.len * 0.02 && b.t < b.dur) continue;
      const ctx = this._canvas(b.layer).ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = theme.css('blood');
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = b.width * (1 - 0.5 * (b.drawn / b.len)); // (thinner as it runs)
      ctx.beginPath();
      const at = (d) => [b.from[0] + b.dir[0] * d + Math.sin(d * b.wobble) * b.width * 0.35, b.from[1] + b.dir[1] * d];
      ctx.moveTo(...at(b.drawn));
      for (let d = b.drawn + b.width * 0.5; d < reach; d += b.width * 0.5) ctx.lineTo(...at(d));
      ctx.lineTo(...at(reach)); // (always to the end: a step shorter than a stride is still drawn)
      ctx.stroke();
      if (b.t >= b.dur) { ctx.beginPath(); ctx.fillStyle = theme.css('blood'); ctx.arc(...at(reach), b.width * 0.7, 0, Math.PI * 2); ctx.fill(); } // a drop at the end
      ctx.restore();
      b.drawn = reach;
      this._canvas(b.layer).tex.needsUpdate = true;
    }
    this.bleeds = this.bleeds.filter((b) => b.t < b.dur);
  }

  /** Everything back as it was (config.damage.healOnRetry). Hats and glasses stay where they fell. */
  heal() {
    super.heal();
    for (const p of this.painted) p.mat.map = p.map;
    for (const l of this.layers) l.canvas = null;
    this.painted = [];
    this.bleeds = [];
  }

  /** Knocked off: the model's own hat or glasses vanish; the figure's flies off in their place. */
  _knockOff(group, dir, density) {
    const want = group.name === 'glasses' ? 'glasses' : 'hat';
    this.body.model.traverse((o) => {
      if (o.isMesh && kindOf(o.material?.name ?? '') === want && o.visible) { o.visible = false; this.hidden.push(o); }
    });
    group.traverse((o) => { if (o.isMesh) { o.visible = true; o.userData.hitbox = false; } });
    super._knockOff(group, dir, density);
  }

  // ---------------------------------------------------------------- finding places

  /** A paintable mesh: its rest-pose positions (model space), texture coordinates, and each vertex's region. */
  _layer(mesh, kind) {
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const n = P.count, pos = new Float32Array(n * 3), front = new Float32Array(n);
    const bind = mesh.bindMatrix, nm = new THREE.Matrix3().getNormalMatrix(bind);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(bind);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      if (N) front[i] = nv.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().z; // (+z = their front)
    }
    // The bone that moves each vertex most decides its region
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, bones = mesh.skeleton.bones;
    const region = new Array(n), bone = new Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
      bone[i] = bones[best]?.name ?? '';
      region[i] = regionOfBone(bone[i]);
    }
    return { mesh, kind, pos, front, uv: UV, region, bone, n };
  }

  /** The eyes, the nose and the mouth, in the rest pose. */
  _findFace() {
    let eyesMesh = null;
    this.body.model.traverse((o) => { if (o.isMesh && /low-poly|high-poly/.test(o.material?.name ?? '')) eyesMesh = o; });
    const eyes = { 1: new THREE.Vector3(), [-1]: new THREE.Vector3() }, count = { 1: 0, [-1]: 0 };
    if (eyesMesh) {
      const P = eyesMesh.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(eyesMesh.bindMatrix);
        const s = v.x >= 0 ? 1 : -1;
        eyes[s].add(v); count[s]++;
      }
    }
    if (!count[1] || !count[-1]) return;
    eyes[1].divideScalar(count[1]); eyes[-1].divideScalar(count[-1]);
    const y = (eyes[1].y + eyes[-1].y) / 2;
    // The nose tip: the frontmost skin on the middle line, below the eyes
    const L = this.skin;
    let nose = null;
    for (let i = 0; i < L.n; i++) {
      const x = L.pos[i * 3], vy = L.pos[i * 3 + 1], z = L.pos[i * 3 + 2];
      if (Math.abs(x) < 0.008 && vy < y - 0.01 && vy > y - 0.08 && (!nose || z > nose.z)) nose = new THREE.Vector3(x, vy, z);
    }
    if (!nose) return;
    this.face = { eyes, nose, mouthY: nose.y - 0.034 };
  }

  /** The front of the skin at (x, y) on the face (rest pose). */
  _skinAt(x, y) {
    const L = this.skin;
    let best = null, bz = -Infinity;
    for (const r of [0.006, 0.012, 0.02]) {
      for (let i = 0; i < L.n; i++) {
        const dx = L.pos[i * 3] - x, dy = L.pos[i * 3 + 1] - y;
        if (Math.abs(dx) < r && Math.abs(dy) < r && L.pos[i * 3 + 2] > bz && L.region[i] === 'head') { bz = L.pos[i * 3 + 2]; best = i; }
      }
      if (best !== null) break;
    }
    return best === null ? null : new THREE.Vector3(L.pos[best * 3], L.pos[best * 3 + 1], L.pos[best * 3 + 2]);
  }

  /** Where a blow landed (world, on the figure), found on the posed model: clothes over skin. */
  _nearHit(region, point) {
    const v = new THREE.Vector3();
    let best = null;
    for (const layer of [...this.cloth, this.skin].filter(Boolean)) {
      const m = layer.mesh;
      m.skeleton.update();
      let bi = -1, bd = Infinity;
      for (let i = 0; i < layer.n; i += 2) { // (every other vertex is plenty)
        if (layer.region[i] !== region) continue;
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
        const d = v.distanceToSquared(point);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi < 0) continue;
      const dist = Math.sqrt(bd);
      // Clothes win unless the skin is clearly nearer (it's what's on top)
      if (!best || (layer.kind === 'cloth' ? dist < best.dist + 0.03 : dist < best.dist - 0.03)) {
        best = { layer, dist, pos: new THREE.Vector3(layer.pos[bi * 3], layer.pos[bi * 3 + 1], layer.pos[bi * 3 + 2]) };
      }
    }
    return best && best.dist < 0.25 ? best : null;
  }

  /** Somewhere on the front of that part of them, on that side (clothes if it's covered). */
  _somewhere(region, side) {
    for (const layer of [...this.cloth, this.skin].filter(Boolean)) {
      const ok = [];
      for (let i = 0; i < layer.n; i++) {
        if (layer.region[i] !== region || layer.front[i] < 0.5) continue;
        if (region === 'leg' && !layer.bone[i].startsWith('thigh')) continue; // (the thigh, like the figures)
        if (region === 'arm' && !/upperarm|lowerarm/.test(layer.bone[i])) continue;
        if (region !== 'torso' && Math.sign(layer.pos[i * 3]) !== side) continue;
        // The torso: to one side of the middle (off a shirt front and tie), below the collar
        if (region === 'torso' && (layer.pos[i * 3] * side < 0.06 || !/spine|jiggle/.test(layer.bone[i]))) continue;
        ok.push(i);
      }
      if (ok.length > 30) { const i = pick(ok); return { layer, pos: new THREE.Vector3(layer.pos[i * 3], layer.pos[i * 3 + 1], layer.pos[i * 3 + 2]) }; }
    }
    return null;
  }

  /**
   * The texture round a point (rest pose): its pixel, how many pixels a metre is there, and which way
   * world-down runs in the texture. Measured on the triangles round the nearest vertex (they're all on
   * one piece of the texture, so seams, where the texture jumps, can't throw it off).
   */
  _uvFrame(layer, p) {
    const { pos, uv, n } = layer;
    let i0 = -1, d0 = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - p.x, dy = pos[i * 3 + 1] - p.y, dz = pos[i * 3 + 2] - p.z, d = dx * dx + dy * dy + dz * dz;
      if (d < d0) { d0 = d; i0 = i; }
    }
    const P = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const T = (i) => new THREE.Vector2(uv.getX(i), uv.getY(i));
    let worldArea = 0, uvArea = 0;
    const down = new THREE.Vector2(), g = new THREE.Vector3(0, -1, 0);
    for (const [a, b, c] of this._trianglesAt(layer, i0)) {
      const p0 = P(a), e1 = P(b).sub(p0), e2 = P(c).sub(p0);
      const t0 = T(a), f1 = T(b).sub(t0), f2 = T(c).sub(t0);
      const nrm = new THREE.Vector3().crossVectors(e1, e2), A = nrm.length() / 2;
      if (A < 1e-9) continue;
      worldArea += A;
      uvArea += Math.abs(f1.x * f2.y - f1.y * f2.x) / 2;
      // World-down along this triangle, as a mix of its two edges, carried over to the texture
      nrm.normalize();
      const gp = g.clone().addScaledVector(nrm, -g.dot(nrm));
      const a11 = e1.dot(e1), a12 = e1.dot(e2), a22 = e2.dot(e2), b1 = gp.dot(e1), b2 = gp.dot(e2);
      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-14) continue;
      const k1 = (b1 * a22 - b2 * a12) / det, k2 = (b2 * a11 - b1 * a12) / det;
      down.addScaledVector(f1, k1 * A).addScaledVector(f2, k2 * A);
    }
    const W = this._canvas(layer).c.width;
    const ppm = worldArea > 0 ? Math.sqrt(uvArea / worldArea) * W : 0.5 * W;
    if (down.lengthSq() < 1e-12) down.set(0, 1); else down.normalize();
    return { x: uv.getX(i0) * W, y: uv.getY(i0) * W, ppm, down: [down.x, down.y] };
  }

  /** The triangles (vertex index triples) that use vertex i. */
  _trianglesAt(layer, i) {
    if (!layer.tris) {
      const idx = layer.mesh.geometry.index;
      layer.tris = Array.from({ length: layer.n }, () => []);
      if (idx) for (let t = 0; t < idx.count; t += 3) {
        const tri = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        for (const v of tri) layer.tris[v].push(tri);
      }
    }
    return layer.tris[i];
  }

  // ---------------------------------------------------------------- painting

  /** The mesh's texture as a canvas we can paint on (made on the first mark). */
  _canvas(layer) {
    if (layer.canvas) return layer.canvas;
    const mat = layer.mesh.material, orig = mat.map, img = orig.image;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = orig.flipY; tex.colorSpace = orig.colorSpace;
    tex.wrapS = orig.wrapS; tex.wrapT = orig.wrapT; tex.anisotropy = orig.anisotropy;
    tex.magFilter = orig.magFilter; tex.minFilter = orig.minFilter; tex.channel = orig.channel;
    this.painted.push({ mat, map: orig });
    mat.map = tex;
    layer.canvas = { c, ctx, tex };
    return layer.canvas;
  }

  /** A soft, ragged blob (a bruise, a black eye), darkening what's there. */
  _blob(layer, p, r, colour, alpha, { sy = 1, jag = 0.3 } = {}) {
    const f = this._uvFrame(layer, p), { ctx, tex } = this._canvas(layer);
    const R = r * f.ppm, k = 14, roll = Math.random() * Math.PI;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.translate(f.x, f.y); ctx.rotate(roll); ctx.scale(1, sy);
    for (let layerN = 0; layerN < 3; layerN++) { // soft: three passes, smaller and stronger towards the middle
      const s = 1 - layerN * 0.28;
      ctx.globalAlpha = alpha * 0.45;
      ctx.fillStyle = theme.css(colour);
      ctx.beginPath();
      for (let i = 0; i <= k; i++) {
        const a = (i / k) * Math.PI * 2, rr = R * s * (1 - jag + Math.random() * jag * 2);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.filter = `blur(${Math.max(1, R * 0.18)}px)`;
      ctx.fill();
    }
    ctx.restore();
    tex.needsUpdate = true;
  }

  /** A short cut. */
  _slash(layer, p, len) {
    const f = this._uvFrame(layer, p), { ctx, tex } = this._canvas(layer);
    const L = len * f.ppm, a = Math.atan2(f.down[1], f.down[0]) + Math.PI / 2 + rand(-0.6, 0.6);
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(a);
    ctx.fillStyle = theme.css('cut');
    ctx.beginPath(); ctx.ellipse(0, 0, L / 2, Math.max(1.2, L * 0.12), 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    tex.needsUpdate = true;
  }

  /** Blood that runs down from p over a couple of seconds (update() draws it). */
  _bleed(layer, p, width, length) {
    const f = this._uvFrame(layer, p);
    this.bleeds.push({
      layer, from: [f.x, f.y], dir: f.down, len: length * f.ppm, width: Math.max(1.5, width * f.ppm),
      wobble: rand(0.05, 0.12), t: 0, dur: rand(...D().bleedTime), drawn: 0,
    });
  }

  /** A ragged hole torn in clothes: what's underneath, a frayed dark edge and a few loose threads. */
  _tear(layer, p, r, underCss) {
    const f = this._uvFrame(layer, p), { ctx, tex } = this._canvas(layer);
    const R = r * f.ppm, k = 18, roll = Math.random() * Math.PI, sx = rand(0.8, 1.3), sy = rand(0.6, 1);
    const pts = [];
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2, rr = R * (0.55 + Math.random() * 0.9);
      pts.push([Math.cos(a) * rr * sx, Math.sin(a) * rr * sy]);
    }
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(roll);
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    // The frayed edge: the cloth darkened just round the hole
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = theme.css('blackEye');
    ctx.lineWidth = Math.max(2, R * 0.22);
    ctx.lineJoin = 'round';
    path(); ctx.stroke();
    // What's underneath
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = underCss;
    path(); ctx.fill();
    // ...in a little shadow, with loose threads across it
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = theme.css('blackEye');
    ctx.scale(0.85, 0.85); path(); ctx.filter = `blur(${Math.max(1, R * 0.2)}px)`; ctx.fill();
    ctx.filter = 'none';
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = theme.css('blackEye');
    ctx.lineWidth = Math.max(1, R * 0.05);
    for (let i = 0; i < 4; i++) {
      const [x, y] = pick(pts);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x * 0.3 + rand(-R, R) * 0.2, y * 0.3, x * rand(-0.2, 0.4), y * rand(-0.2, 0.4)); ctx.stroke();
    }
    ctx.restore();
    tex.needsUpdate = true;
  }

  /** The model's skin colour: the middle of what's on the outside of the forearms (not a palm). */
  _skinColour() {
    if (this._skinCss) return this._skinCss;
    const L = this.skin, idx = [];
    for (let i = 0; i < L.n; i += 3) if (L.bone[i].startsWith('lowerarm')) idx.push(i);
    if (idx.length < 5) return (this._skinCss = css(this.look.skin));
    const { c, ctx } = this._canvas(L);
    const px = idx.map((i) => ctx.getImageData(Math.floor(L.uv.getX(i) * c.width), Math.floor(L.uv.getY(i) * c.height), 1, 1).data);
    const mid = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
    return (this._skinCss = `rgb(${mid(0)}, ${mid(1)}, ${mid(2)})`);
  }

}
