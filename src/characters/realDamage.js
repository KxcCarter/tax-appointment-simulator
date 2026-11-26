import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';
import { Damage } from './damage.js';
import { meshLayer, findFace, triangles } from './realPaint.js';

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

export class RealDamage extends Damage {
  constructor({ realBody, rig, look, physics, scene }) {
    super({ rig, look, physics, scene });
    this.body = realBody;
    this.layers = [];   // paintable meshes: { mesh, kind, pos (rest, model space), uv, region, side, front }
    this.painted = [];  // { mat, original map } (heal() puts them back)
    this.hidden = [];   // the model's hat/glasses meshes, once knocked off
    this.bleeds = [];   // blood running: { layer, from, dir, len, width, t, dur, drawn }
    this.armSkin = null; // the arms under the sleeves (tools/makehuman: kept from the build, hidden till a sleeve goes)
    this.sleeves = [];   // { mesh, geometry (as built) } of clothes with a sleeve ripped off
    realBody.model.traverse((o) => {
      if (o.isSkinnedMesh && /armskin/.test(o.name)) { this.armSkin = o; return; }
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

  /** As the figure's, and the model's glasses go crooked too (the first blow to the head that has them). */
  _head(side, knock, dir) {
    const prim = this.rig.joints.head.getObjectByName('glasses');
    const was = prim?.userData.crooked;
    super._head(side, knock, dir);
    const G = this.body.extras?.glasses;
    if (G && prim?.userData.crooked && !was && G.mesh.visible) {
      G.pivot.quaternion.setFromAxisAngle(G.axis, side * (0.18 + Math.random() * 0.12));
      G.pivot.position.copy(G.rest).addScaledVector(G.down, 0.007);
    }
  }

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
    // An arm (or every few body blows): the sleeve comes off
    if ((region === 'arm' || (region === 'torso' && this.bodyHits % D().sleeveEvery === 0)) && this._ripSleeve(side)) return;
    const spot = (hit && this._regionOf(hit.object) === region ? this._nearHit(region, hit.point) : null) ?? this._somewhere(region, side);
    if (!spot) return;
    const { layer, pos } = spot;
    if (layer.kind === 'cloth') {
      // A ragged hole in their clothes, showing the skin underneath (owner: always skin, even under a jacket)
      const r = rand(...D().tearSize) * (0.8 + 0.2 * Math.min(2, knock));
      this._tear(layer, pos, r, this._skinColour());
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
    for (const s of this.sleeves) s.mesh.geometry = s.geometry;
    for (const l of this.layers) l.gone = null;
    this.sleeves = [];
    if (this.armSkin) { this.armSkin.visible = false; if (this.armSkin.userData.material) this.armSkin.material = this.armSkin.userData.material; }
    const G = this.body.extras?.glasses;
    if (G) { G.pivot.position.copy(G.rest); G.pivot.quaternion.identity(); }
    for (const p of this.painted) p.mat.map = p.map;
    for (const l of this.layers) l.canvas = null;
    for (const l of this.overlays ?? []) { l.overlay.ctx.clearRect(0, 0, l.overlay.c.width, l.overlay.c.height); l.overlay.tex.needsUpdate = true; }
    this.painted = [];
    this.bleeds = [];
  }

  /**
   * The sleeve on that side comes off: the clothes' triangles on that upper and lower arm go, and the arm under
   * them shows (the build keeps it: armskin), bare, or in their shirt's colour under a jacket (as the figure's).
   */
  _ripSleeve(side) {
    const key = 'sleeve:' + side;
    if (this.used.has(key) || !this.armSkin) return false;
    const onArm = (l, i) => /upperarm|lowerarm/.test(l.bone[i]) && Math.sign(l.pos[i * 3]) === side;
    let ripped = false;
    for (const l of this.cloth) {
      const geo = l.mesh.geometry, keep = [];
      let dropped = 0;
      for (const t of triangles(geo)) {
        if (t.every((i) => onArm(l, i))) { dropped++; l.gone ??= new Uint8Array(l.n); for (const i of t) l.gone[i] = 1; } else keep.push(...t);
      }
      if (!dropped) continue;
      if (!this.sleeves.some((s) => s.mesh === l.mesh)) this.sleeves.push({ mesh: l.mesh, geometry: geo });
      const g = geo.clone();
      g.setIndex(keep);
      l.mesh.geometry = g;
      ripped = true;
    }
    if (!ripped) return false;
    this.used.add(key);
    // The arm underneath: this side's share of it (and any side already showing)
    const A = this.armSkin;
    A.userData.base ??= A.geometry;
    A.userData.sides ??= new Set();
    A.userData.sides.add(side);
    const P = A.geometry.attributes.position, bind = A.bindMatrix, v = new THREE.Vector3(), keep = [];
    for (const t of triangles(A.userData.base)) {
      const x = t.reduce((s, i) => s + v.fromBufferAttribute(P, i).applyMatrix4(bind).x, 0);
      if (A.userData.sides.has(Math.sign(x) || 1)) keep.push(...t);
    }
    const g = A.userData.base.clone();
    g.setIndex(keep);
    A.geometry = g;
    A.visible = true; // (bare skin: owner)
    return true;
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

  /** A paintable mesh (realPaint.js). */
  _layer(mesh, kind) { return meshLayer(mesh, kind); }

  /** The eyes, the nose and the mouth, in the rest pose. */
  _findFace() { this.face = findFace(this.body.model, this.skin) ?? undefined; }

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
        if (layer.region[i] !== region || layer.gone?.[i]) continue;
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
        if (layer.region[i] !== region || layer.front[i] < 0.5 || layer.gone?.[i]) continue;
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

  /**
   * A piece of clothing's damage layer (made on the first tear): a transparent canvas the size of its texture,
   * mixed over the cloth in its shader after the tint (theme.look.realistic.tint), so what's painted on it (skin
   * through a tear) keeps its own colour instead of being tinted along with the fabric.
   */
  _overlay(layer) {
    if (layer.overlay) return layer.overlay;
    const mat = layer.mesh.material, img = mat.map.image;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = mat.map.flipY; tex.colorSpace = THREE.SRGBColorSpace; tex.channel = mat.map.channel;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
    mat.onBeforeCompile = (shader, renderer) => {
      prev?.call(mat, shader, renderer);
      shader.uniforms.damageMap = { value: tex };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform sampler2D damageMap;\nvoid main() {')
        .replace('#include <color_fragment>', `#include <color_fragment>
  #ifdef USE_MAP
  { vec4 dmg = texture2D( damageMap, vMapUv ); diffuseColor.rgb = mix( diffuseColor.rgb, dmg.rgb, dmg.a ); }
  #endif`);
    };
    mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|damage';
    mat.needsUpdate = true;
    layer.overlay = { c, ctx, tex };
    (this.overlays ??= []).push(layer);
    return layer.overlay;
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
    // (drawn on the cloth's damage layer, over its tint: a tinted texture would tint the skin too)
    const f = this._uvFrame(layer, p), { ctx, tex } = this._overlay(layer);
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
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = theme.css('blackEye');
    ctx.lineWidth = Math.max(2, R * 0.22);
    ctx.lineJoin = 'round';
    path(); ctx.stroke();
    // What's underneath
    ctx.globalAlpha = 1;
    ctx.fillStyle = underCss;
    path(); ctx.fill();
    // ...in a little shadow, with loose threads across it
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme.css('blackEye');
    ctx.scale(0.85, 0.85); path(); ctx.filter = `blur(${Math.max(1, R * 0.2)}px)`; ctx.fill();
    ctx.filter = 'none';
    ctx.globalAlpha = 0.5;
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
    // Forearm (and upper arm) skin: on the body, and on the arm skin kept under the sleeves (same texture), so
    // someone in long sleeves still has some to sample
    const L = this.skin, uvs = [];
    for (let i = 0; i < L.n; i += 3) if (L.bone[i].startsWith('lowerarm')) uvs.push([L.uv.getX(i), L.uv.getY(i)]);
    if (this.armSkin) {
      const A = this.armSkin.geometry.attributes, bones = this.armSkin.skeleton.bones;
      for (let i = 0; i < A.position.count; i += 3) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = A.skinWeight.getComponent(i, k); if (w > bw) { bw = w; best = A.skinIndex.getComponent(i, k); } }
        if (/arm/.test(bones[best]?.name ?? '')) uvs.push([A.uv.getX(i), A.uv.getY(i)]);
      }
    }
    if (uvs.length < 5) return (this._skinCss = css(this.look.skin));
    const { c, ctx } = this._canvas(L);
    const px = uvs.map(([u, v]) => ctx.getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data);
    const mid = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
    // (and as the skin's material colour tints it, if it does)
    const t = L.mesh.material.color, lin = (x) => new THREE.Color().setRGB(x[0] / 255, x[1] / 255, x[2] / 255, THREE.SRGBColorSpace);
    const col = lin([mid(0), mid(1), mid(2)]).multiply(t);
    return (this._skinCss = '#' + col.getHexString());
  }
}
