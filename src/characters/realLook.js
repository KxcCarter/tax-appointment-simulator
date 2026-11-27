import * as THREE from 'three';
import { theme } from '../theme.js';
import { config } from '../config.js';

/*
  The realistic models, looking better (owner's request): materials and secondary motion.

  shadeModel(model): skin, hair, eyes and clothes get better materials (theme.look.realistic.shading):
  - skin: light bleeds a little round the edges (a cheap subsurface scattering: "wrap" lighting tinted red), a soft
    sheen and some specular, instead of flat matte;
  - hair, eyebrows, lashes: smooth anti-aliased edges (alpha to coverage) instead of hard cut-outs, and a sheen;
  - eyes: a wet clearcoat highlight;
  - clothes: a soft fabric sheen; shoes a little shine.

  Sway (config.characters.sway): long hair and dress hems lag behind and swing as the body moves, on springs
  driven by how the head (hair) and hips (hems) speed up and slow down. Done in the vertex shader: each vertex
  has a weight (how free it is: the ends of long hair, the hem), the spring's offset is added after skinning.
*/

const PHYS = { STANDARD: '', PHYSICAL: '' };

/** A standard material as a physical one (same maps and settings, same shader hooks). */
function toPhysical(m) {
  if (m.isMeshPhysicalMaterial) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.defines = { ...PHYS };
  p.onBeforeCompile = m.onBeforeCompile;
  p.customProgramCacheKey = m.customProgramCacheKey;
  return p;
}

/** Chain a shader hook after whatever a material already has (tints, the tie, sway). */
function addHook(mat, key, fn) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => { prev?.call(mat, shader, renderer); fn(shader); };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|' + key;
  mat.needsUpdate = true;
}

// The skin's scattering: the wrapped part of the light (past where it would stop) comes back reddish
const SCATTER_FROM = 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );';
function skinScatter(mat, S) {
  if (!THREE.ShaderChunk.lights_physical_pars_fragment.includes(SCATTER_FROM)) return; // (a three.js that's changed: skip)
  const tint = new THREE.Color(S.scatterColor);
  addHook(mat, 'skin', (shader) => {
    shader.uniforms.skinScatter = { value: new THREE.Vector3(tint.r, tint.g, tint.b).multiplyScalar(S.scatter) };
    shader.uniforms.skinWrap = { value: S.wrap };
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(SCATTER_FROM, `${SCATTER_FROM}
	float skinWrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + skinWrap ) / ( 1.0 + skinWrap ) );
	reflectedLight.directDiffuse += max( skinWrapNL - dotNL, 0.0 ) * directLight.color * skinScatter * BRDF_Lambert( material.diffuseContribution );`);
    shader.fragmentShader = 'uniform vec3 skinScatter;\nuniform float skinWrap;\n' + shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  });
}

/** Better materials for a model's skin, hair, eyes and clothes (theme.look.realistic.shading). */
export function shadeModel(model) {
  const S = theme.look.realistic?.shading;
  if (!S?.enabled || new URLSearchParams(location.search).has('shading', '0')) return; // (?shading=0: the old look, to compare)
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const name = o.material.name ?? '';
    const kind = /\.body$/.test(name) ? 'skin'
      : /low-poly|high-poly/.test(name) ? 'eyes'
      : /^hair\.|eyebrow|eyelash/i.test(name) ? 'hair'
      : /shoe|booti|flats|boot/i.test(name) ? 'shoes'
      : /glass/i.test(name) ? null
      : o.material.map ? 'cloth' : null;
    if (!kind || !o.material.isMeshStandardMaterial) return;
    const m = toPhysical(o.material);
    const K = S[kind];
    if (kind === 'skin') {
      m.roughness = K.roughness;
      m.specularIntensity = K.specular;
      m.sheen = K.sheen; m.sheenColor.set(K.sheenColor); m.sheenRoughness = K.sheenRoughness;
      skinScatter(m, K);
    } else if (kind === 'eyes') {
      m.roughness = K.roughness;
      m.clearcoat = K.clearcoat; m.clearcoatRoughness = K.clearcoatRoughness;
    } else if (kind === 'hair') {
      m.roughness = K.roughness;
      m.specularIntensity = K.specular;
      m.side = THREE.DoubleSide;
      if (K.smoothEdges) { m.alphaToCoverage = true; m.alphaTest = K.alphaTest; }
    } else if (kind === 'shoes') {
      m.roughness = K.roughness;
    } else {
      m.sheen = K.sheen; m.sheenColor.set(K.sheenColor); m.sheenRoughness = K.sheenRoughness;
    }
    m.needsUpdate = true;
    o.material = m;
  });
}

/**
 * Long hair and dress hems swinging (config.characters.sway). Set up once on a model in its rest pose; update(dt)
 * every frame after it's posed.
 */
export class Sway {
  constructor(model) {
    const W = config.characters.sway;
    this.groups = [];
    if (!W?.enabled || new URLSearchParams(location.search).has('sway', '0')) return; // (?sway=0: off, to compare)
    const bone = (n) => model.getObjectByName(n);
    model.traverse((o) => {
      if (!o.isSkinnedMesh || !o.material) return;
      const name = o.material.name ?? '';
      const hair = /^hair\./.test(name), dress = /dress|skirt/i.test(name);
      if (!hair && !dress) return;
      const P = o.geometry.attributes.position, bind = o.bindMatrix, v = new THREE.Vector3();
      const ys = new Float32Array(P.count);
      let top = -Infinity, bottom = Infinity;
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(bind); ys[i] = v.y; top = Math.max(top, v.y); bottom = Math.min(bottom, v.y); }
      const w = new Float32Array(P.count);
      let anchor, C;
      if (hair) {
        // Free below the crown; short hair (not much below it) hardly at all
        C = W.hair;
        const len = top - bottom;
        const amount = (C.also ?? []).some((k) => name.includes(k)) ? C.alsoAmount : THREE.MathUtils.clamp((len - C.shortBelow) / C.longOver, 0, 1);
        if (amount <= 0) return;
        for (let i = 0; i < P.count; i++) w[i] = amount * Math.pow(THREE.MathUtils.clamp((top - C.fixedTop - ys[i]) / C.fullBelow, 0, 1), 1.5);
        anchor = bone('head') ?? bone('Head');
      } else {
        // Free below the hips, most at the hem
        C = W.dress;
        const thigh = o.skeleton.bones.findIndex((b) => /^(thigh_l|LeftUpLeg)$/.test(b.name));
        const hipY = thigh >= 0 ? new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[thigh].clone().invert()).y : top - 0.3;
        for (let i = 0; i < P.count; i++) w[i] = Math.pow(THREE.MathUtils.clamp((hipY - ys[i]) / Math.max(0.05, hipY - bottom), 0, 1), 1.6);
        anchor = bone('pelvis') ?? bone('Hips');
      }
      if (!anchor) return;
      o.geometry.setAttribute('swayW', new THREE.BufferAttribute(w, 1));
      const u = { value: new THREE.Vector3() };
      addHook(o.material, 'sway', (shader) => {
        shader.uniforms.swayOffset = u;
        shader.vertexShader = 'attribute float swayW;\nuniform vec3 swayOffset;\n' + shader.vertexShader
          .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n\ttransformed += swayOffset * swayW;');
      });
      this.groups.push({ mesh: o, anchor, C, u, x: new THREE.Vector3(), xv: new THREE.Vector3(), p: null, v: new THREE.Vector3() });
    });
  }

  update(dt) {
    if (!this.groups.length || dt <= 0) return;
    dt = Math.min(dt, 1 / 20);
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (const g of this.groups) {
      const p = g.anchor.getWorldPosition(new THREE.Vector3());
      if (!g.p) { g.p = p; continue; }
      const v = p.clone().sub(g.p).divideScalar(dt), a = v.clone().sub(g.v).divideScalar(dt);
      g.p = p; g.v.copy(v);
      // Teleported (sat down, reset): don't fling it
      if (a.length() > 200) { g.x.set(0, 0, 0); g.xv.set(0, 0, 0); continue; }
      const C = g.C;
      for (let k = 0; k < n; k++) {
        // Left behind as the body speeds up (and swings past as it stops), springing back
        g.xv.addScaledVector(g.x, -C.stiffness * h).addScaledVector(g.xv, -C.damping * h).addScaledVector(a, -C.gain * h);
        g.x.addScaledVector(g.xv, h);
        if (g.x.length() > C.max) g.x.setLength(C.max);
      }
      // Into the mesh's own space (its rotation and scale)
      const m = g.mesh.matrixWorld, inv = new THREE.Matrix3().setFromMatrix4(m).invert();
      g.u.value.copy(g.x).applyMatrix3(inv);
    }
  }
}
