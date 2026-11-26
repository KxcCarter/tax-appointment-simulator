import * as THREE from 'three';
import { theme } from '../theme.js';
import { meshLayer, findFace, triangles, paintable, cssColour } from './realPaint.js';

/*
  Things a realistic model (realBody.js) gets that MakeHuman's free assets don't have, from the character's
  look (characterPalettes.cast): a wristwatch (look.watch), headphones round the neck (look.headset), stubble
  (look.stubble), hairs on a built moustache, and glasses that can be knocked crooked (a rigid copy hung on the
  head bone). Called once while the model is in its rest pose, at the origin (world = the character's space:
  +z their front, +x their left, +y up).
*/

const _v = new THREE.Vector3();

export function addExtras(body, look = {}) {
  const model = body.model;
  model.updateMatrixWorld(true);
  const skinned = [];
  model.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); skinned.push(o); } });
  const out = {};
  if (look.watch) out.watch = addWatch(model, skinned);
  if (look.headset !== undefined) out.headphones = addHeadphones(model, skinned, look);
  const skinMesh = skinned.find((o) => /\.body$/.test(o.material?.name ?? '') && o.material.map && !/armskin/.test(o.name)); // (not the arm skin: same material)
  if (look.stubble !== undefined && skinMesh) paintStubble(model, skinMesh, look.stubble);
  model.traverse((o) => { if (o.isMesh && /moustache/.test(o.material?.name ?? '')) moustacheHairs(o); });
  out.glasses = rigidGlasses(model, skinned);
  return out;
}

// ------------------------------------------------------------------ measuring the posed model

/** Every vertex (world, as posed now) whose strongest bone passes `boneTest`, from the given meshes. */
function pointsOf(meshes, boneTest) {
  const pts = [];
  for (const m of meshes) {
    const g = m.geometry, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, bones = m.skeleton.bones;
    for (let i = 0; i < g.attributes.position.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
      const name = bones[best]?.name ?? '';
      if (!boneTest(name)) continue;
      m.getVertexPosition(i, _v).applyMatrix4(m.matrixWorld);
      pts.push({ p: _v.clone(), mesh: m, bone: name });
    }
  }
  return pts;
}
const isWear = (m) => !/\.body$|low-poly|high-poly|eyebrow|eyelash|moustache|armskin/.test(m.material?.name + ' ' + m.name) && !m.material?.name?.startsWith('hair.');
const isSkin = (m) => /\.body$/.test(m.material?.name ?? '');

// ------------------------------------------------------------------ the watch

/** A strap round the left wrist, just past the cuff, the face on the back of the wrist (like the figure's). */
function addWatch(model, skinned) {
  const lower = model.getObjectByName('lowerarm_l'), hand = model.getObjectByName('hand_l');
  if (!lower || !hand) return null;
  const elbow = lower.getWorldPosition(new THREE.Vector3()), wrist = hand.getWorldPosition(new THREE.Vector3());
  const axis = wrist.clone().sub(elbow), L = axis.length();
  axis.normalize();
  const along = (p) => p.clone().sub(elbow).dot(axis);
  // The wrist itself (skin moved by the forearm), just before the hand; a little over the cuff if it reaches that far
  // Just past the end of the sleeve's cuff (its furthest point towards the hand), on the skin that shows there
  let cuff = L - 0.05;
  for (const { p } of pointsOf(skinned.filter(isWear), (b) => /lowerarm.*_l|hand_l/.test(b))) { const x = along(p); if (x < L + 0.05) cuff = Math.max(cuff, x); }
  const t = cuff + 0.006, at = cuff - 0.014; // (sized from the bare wrist at t; worn a little higher, against the cuff's
  // edge: posed, the skin past the cuff is already the hand)
  const arm = pointsOf(skinned.filter((m) => isSkin(m) && !/armskin/.test(m.name)), (b) => /lowerarm.*_l|hand_l/.test(b));
  // The wrist's cross-section there: the back of the wrist faces out (their left, +x), the other way round it
  const out = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
  const side = new THREE.Vector3().crossVectors(axis, out);
  const slab = arm.filter(({ p }) => Math.abs(along(p) - t) < 0.01);
  if (slab.length < 6) return null;
  const centre = new THREE.Vector3();
  for (const { p } of slab) centre.add(p);
  centre.divideScalar(slab.length);
  const onAxis = elbow.clone().addScaledVector(axis, t);
  centre.sub(onAxis).projectOnPlane(axis).add(onAxis); // (the middle of the cross-section, at t)
  // Its size: the 90th percentile either way (a stray vertex doesn't make it loose)
  const q = (vals) => vals.sort((a, b) => a - b)[Math.floor(vals.length * 0.9)];
  let ro = q(slab.map(({ p }) => Math.abs(p.clone().sub(centre).dot(out)))), rs = q(slab.map(({ p }) => Math.abs(p.clone().sub(centre).dot(side))));
  ro += 0.004; rs += 0.004;
  const group = new THREE.Group();
  group.name = 'watch';
  group.matrix.makeBasis(out, axis, side).setPosition(centre.clone().addScaledVector(axis, at - t));
  group.matrix.decompose(group.position, group.quaternion, group.scale);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.016, 28, 1, true), theme.material('watchStrap', { side: THREE.DoubleSide }));
  strap.scale.set(ro, 1, rs);
  group.add(strap);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.006, 20), theme.material('watchFace'));
  dial.rotation.z = Math.PI / 2; // (its flat face looks out, along x)
  dial.position.x = ro + 0.002;
  group.add(dial);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.001, 20), theme.material('white'));
  glass.rotation.z = Math.PI / 2;
  glass.position.x = ro + 0.0052;
  group.add(glass);
  noHits(group);
  lower.attach(group);
  return group;
}

// ------------------------------------------------------------------ headphones

/** Headphones hanging round the neck: the band behind it, the cups resting at the front, on the collarbones. */
function addHeadphones(model, skinned, look) {
  const neckBone = model.getObjectByName('neck_01') ?? model.getObjectByName('neck');
  if (!neckBone) return null;
  const pts = pointsOf(skinned.filter(isSkin), (b) => /neck/.test(b)).map((x) => x.p);
  if (pts.length < 20) return null;
  // The neck's width from its middle (its bottom spreads into the shoulders); they hang at its bottom
  const ys = pts.map((p) => p.y).sort((a, b) => a - b);
  const yLow = ys[Math.floor(ys.length * 0.2)], yMid = [ys[Math.floor(ys.length * 0.4)], ys[Math.floor(ys.length * 0.65)]];
  const box = new THREE.Box3().setFromPoints(pts.filter((p) => p.y >= yMid[0] && p.y <= yMid[1]));
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.z) / 2 + 0.03;
  const group = new THREE.Group();
  group.name = 'headphones';
  group.position.set(c.x, yLow + 0.005, c.z - 0.01);
  const m = (col) => theme.material(col);
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 8, 32, Math.PI), m(look.headset));
  band.rotation.x = -Math.PI / 2 - 0.35; // behind the neck, its back raised a little (it rests on the neck's back)
  group.add(band);
  for (const side of [1, -1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.032, 20), m(look.headset));
    cup.rotation.set(0, 0.6 * side, Math.PI / 2 + 0.45 * side); // (lying on the collarbone, the cushion facing up and in)
    cup.position.set(side * r * 0.85, -0.015, r * 0.45); // (at the front of the neck, either side)
    group.add(cup);
    if (look.headsetCushion !== undefined) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.012, 20), m(look.headsetCushion));
      pad.position.y = -0.021 * side;
      cup.add(pad);
    }
  }
  noHits(group);
  neckBone.attach(group);
  return group;
}

// ------------------------------------------------------------------ stubble

/**
 * Stubble painted into the skin texture: the upper lip, the chin, the jaw and the cheeks below the cheekbones,
 * down under the jaw (not the lips), fading out at the edges. colour: its colour (multiplied over the skin).
 */
function paintStubble(model, skinMesh, colour) {
  const L = meshLayer(skinMesh, 'skin'), F = findFace(model, L);
  if (!F) return;
  const ny = F.nose.y, nz = F.nose.z, my = F.mouthY;
  const ss = THREE.MathUtils.smoothstep;
  const weight = (i) => {
    if (L.region[i] !== 'head') return 0;
    const x = L.pos[i * 3], y = L.pos[i * 3 + 1], z = L.pos[i * 3 + 2], ax = Math.abs(x);
    const below = ax < 0.03 ? ss(-y, -(ny - 0.008), -(ny - 0.02)) : ss(-y, -(ny + 0.004), -(ny - 0.022)); // below the nose / the cheekbones
    const neck = ss(y, ny - 0.125, ny - 0.095);              // not far down the neck
    const front = ss(z, nz - 0.135, nz - 0.1);               // not behind the jaw's corner
    const lips = ax < 0.03 && Math.abs(y - my) < 0.011 ? 1 - ss(Math.abs(y - my), 0.006, 0.011) : 0;
    return below * neck * front * (1 - lips);
  };
  const w = new Float32Array(L.n);
  for (let i = 0; i < L.n; i++) w[i] = weight(i);
  // (its own copy of the material, shared with the arm skin, so a second model built from the same file starts clean)
  const orig = skinMesh.material, own = orig.clone();
  model.traverse((o) => { if (o.material === orig) o.material = own; });
  const { c, ctx, tex } = paintable(own);
  // The stubble itself: a speckle of short dark dots, tiled
  const tile = document.createElement('canvas');
  tile.width = tile.height = 64;
  const t = tile.getContext('2d');
  const col = new THREE.Color(colour);
  for (let k = 0; k < 650; k++) {
    t.fillStyle = `rgba(${Math.round(col.r * 255 * 0.55)}, ${Math.round(col.g * 255 * 0.5)}, ${Math.round(col.b * 255 * 0.45)}, ${0.25 + Math.random() * 0.45})`;
    t.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 1, 1 + (Math.random() < 0.3 ? 1 : 0));
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const W = c.width, H = c.height, uv = L.uv;
  for (const [a, b, d] of triangles(skinMesh.geometry)) {
    const k = (w[a] + w[b] + w[d]) / 3;
    if (k < 0.02) continue;
    ctx.globalAlpha = Math.min(1, k * 0.6);
    ctx.fillStyle = cssColour(col.clone().lerp(new THREE.Color(1, 1, 1), 0.35)); // a shadow of colour first...
    ctx.beginPath();
    ctx.moveTo(uv.getX(a) * W, uv.getY(a) * H); ctx.lineTo(uv.getX(b) * W, uv.getY(b) * H); ctx.lineTo(uv.getX(d) * W, uv.getY(d) * H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pattern;                                                     // ...then the dots
    ctx.fill();
  }
  ctx.restore();
  tex.needsUpdate = true;
}

// ------------------------------------------------------------------ the moustache's hairs

/** The built moustache (a solid shape) gets hairs: fine strands running down and out from the middle, with a
 *  ragged lower edge. Drawn in its shader, from its own shape. */
function moustacheHairs(mesh) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const mat = mesh.material.clone();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.mBox = { value: new THREE.Vector4(bb.min.y, bb.max.y, Math.max(1e-4, bb.max.x - bb.min.x) / 2, (bb.min.x + bb.max.x) / 2) };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vMPos;\nvoid main() {\n  vMPos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec4 mBox;
varying vec3 vMPos;
float mHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float x = (vMPos.x - mBox.w) / mBox.z;          // -1..1 across
    float v = (vMPos.y - mBox.x) / (mBox.y - mBox.x); // 0 bottom .. 1 top
    // strands: slanting down and outwards from the middle
    float across = vMPos.x * 2200.0 - sign(x) * (1.0 - v) * 9.0;
    float strand = floor(across);
    float h = mHash(strand);
    // the lower edge: each strand ends at its own length
    // a smooth outline (the shape was cut from the face's polygons, so its own edge is jagged): the top
    // curving down at the ends, the bottom edge ragged, strand by strand
    if (abs(x) > 0.94 || v > 0.97 - 0.45 * x * x || v < 0.06 + 0.2 * x * x + 0.16 * h) discard;
    float line = 1.0 - abs(fract(across) - 0.5) * 2.0;
    diffuseColor.rgb *= 0.8 + 0.45 * h * (0.7 + 0.3 * line);
  }`);
  };
  mat.customProgramCacheKey = () => 'moustache-hairs';
  mesh.material = mat;
}

// ------------------------------------------------------------------ glasses

/**
 * The model's glasses (skinned to the head) as a rigid copy hung on the head bone, round a pivot at the bridge,
 * so a blow can knock them crooked (realDamage.js). { pivot, axis (forward), down } in the head bone's space.
 */
function rigidGlasses(model, skinned) {
  const g = skinned.find((m) => /glasses/.test(m.material?.name ?? ''));
  const head = model.getObjectByName('head') ?? model.getObjectByName('Head');
  if (!g || !head) return null;
  const bi = g.skeleton.bones.indexOf(head);
  if (bi < 0) return null;
  const toHead = g.skeleton.boneInverses[bi].clone().multiply(g.bindMatrix); // bind space -> head bone space
  const geo = g.geometry.clone();
  geo.applyMatrix4(toHead);
  geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
  geo.computeBoundingBox();
  const bridge = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-bridge.x, -bridge.y, -bridge.z);
  const mesh = new THREE.Mesh(geo, g.material);
  mesh.name = g.name;
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  const pivot = new THREE.Group();
  pivot.name = 'glassesPivot';
  pivot.position.copy(bridge);
  pivot.add(mesh);
  head.add(pivot);
  g.visible = false;
  // Forward and down, in the head bone's space (now, at rest, world = the character's own space)
  const hq = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  return { pivot, rest: bridge.clone(), axis: new THREE.Vector3(0, 0, 1).applyQuaternion(hq), down: new THREE.Vector3(0, -1, 0).applyQuaternion(hq), mesh };
}

function noHits(group) {
  group.traverse((o) => { if (o.isMesh) { o.raycast = () => {}; o.castShadow = true; o.frustumCulled = false; } });
}

// ------------------------------------------------------------------ ties

/**
 * A tie printed in a suit's texture, painted over in another colour: the rectangle `uv` [u0, v0, u1, v1] of the
 * texture (the tie's own piece of it) filled with `colour`, with a fine diagonal stripe a shade darker.
 */
export function paintTie(mat, uv, colour) {
  if (!mat.map?.image) return;
  const { c, ctx, tex } = paintable(mat);
  const [u0, v0, u1, v1] = uv, x = u0 * c.width, y = v0 * c.height, w = (u1 - u0) * c.width, h = (v1 - v0) * c.height;
  const col = new THREE.Color(colour);
  ctx.save();
  ctx.fillStyle = cssColour(col);
  ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = cssColour(col.clone().multiplyScalar(0.72));
  ctx.lineWidth = Math.max(2, c.width / 300);
  const step = c.width / 70;
  for (let k = -h; k < w + h; k += step) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k - h, y + h); ctx.stroke(); }
  ctx.restore();
  tex.needsUpdate = true;
}
