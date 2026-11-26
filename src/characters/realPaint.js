import * as THREE from 'three';

/*
  Helpers for painting onto a realistic model's textures (realDamage.js, realExtras.js): where each vertex is
  in the rest pose, which bone moves it, the face's landmarks, and a texture made paintable.
*/

// Body regions by bone (the game_engine skeleton, plus the wobble bones)
export const regionOfBone = (b) => {
  if (/head|neck|jiggle_chin/.test(b)) return 'head';
  if (/spine|clavicle|jiggle_belly|jiggle_breast/.test(b)) return 'torso';
  if (/arm|hand|thumb|index|middle|ring|pinky/.test(b)) return 'arm';
  return 'leg'; // pelvis, thighs, calves, feet
};

/** A paintable mesh: its rest-pose positions (model space: +z their front, +x their left), texture
 *  coordinates, each vertex's facing, bone and region. */
export function meshLayer(mesh, kind) {
  const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  const n = P.count, pos = new Float32Array(n * 3), front = new Float32Array(n);
  const bind = mesh.bindMatrix, nm = new THREE.Matrix3().getNormalMatrix(bind);
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(bind);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    if (N) front[i] = nv.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().z;
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

/** The eyes, the nose tip and the mouth's height, in the rest pose (model space), or null. */
export function findFace(model, skin) {
  let eyesMesh = null;
  model.traverse((o) => { if (o.isMesh && /low-poly|high-poly/.test(o.material?.name ?? '')) eyesMesh = o; });
  const eyes = { 1: new THREE.Vector3(), [-1]: new THREE.Vector3() }, count = { 1: 0, [-1]: 0 };
  if (eyesMesh) {
    const P = eyesMesh.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(eyesMesh.bindMatrix);
      const s = v.x >= 0 ? 1 : -1;
      eyes[s].add(v); count[s]++;
    }
  }
  if (!count[1] || !count[-1]) return null;
  eyes[1].divideScalar(count[1]); eyes[-1].divideScalar(count[-1]);
  const y = (eyes[1].y + eyes[-1].y) / 2;
  // The nose tip: the frontmost skin on the middle line, below the eyes
  let nose = null;
  for (let i = 0; i < skin.n; i++) {
    const x = skin.pos[i * 3], vy = skin.pos[i * 3 + 1], z = skin.pos[i * 3 + 2];
    if (Math.abs(x) < 0.008 && vy < y - 0.01 && vy > y - 0.08 && (!nose || z > nose.z)) nose = new THREE.Vector3(x, vy, z);
  }
  return nose ? { eyes, nose, mouthY: nose.y - 0.034 } : null;
}

/** The triangles (vertex index triples) of a mesh. */
export function triangles(geometry) {
  const idx = geometry.index, out = [];
  if (idx) for (let t = 0; t < idx.count; t += 3) out.push([idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]);
  else for (let t = 0; t < geometry.attributes.position.count; t += 3) out.push([t, t + 1, t + 2]);
  return out;
}

/** A material's texture swapped for a canvas copy that can be painted on: { c, ctx, tex, original }. */
export function paintable(mat) {
  const orig = mat.map, img = orig.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = orig.flipY; tex.colorSpace = orig.colorSpace;
  tex.wrapS = orig.wrapS; tex.wrapT = orig.wrapT; tex.anisotropy = orig.anisotropy;
  tex.magFilter = orig.magFilter; tex.minFilter = orig.minFilter; tex.channel = orig.channel;
  mat.map = tex;
  return { c, ctx, tex, original: orig };
}

/** A colour (number or anything THREE.Color takes) as a canvas colour. */
export const cssColour = (c) => '#' + new THREE.Color(c).getHexString();
