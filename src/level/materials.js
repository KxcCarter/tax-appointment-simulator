import * as THREE from 'three';
import { config } from '../config.js';

// 1980s/90s tax-office palette
export const PALETTE = {
  wallBeige: 0xd8c9a3,
  wallTrim: 0x8a9a5b,      // avocado
  mint: 0x9fd8b5,
  avocado: 0x6b7a3a,
  carpet: 0x5c4230,
  ceiling: 0xe8e2cf,
  woodVeneer: 0x9a6a3c,
  woodDark: 0x6e4a2a,
  crtBeige: 0xcfc4a4,
  chairSeat: 0x7f9466,     // avocado vinyl
  chairFrame: 0x3b3b38,
  metalGrey: 0x8d8f8a,
  doorWood: 0x7b5634,
  plantGreen: 0x3e6b34,
  terracotta: 0xa45a3a,
  waterBlue: 0x8fc4e0,
  dispenserRed: 0xb5332b,
  black: 0x1b1a18,
  white: 0xf4f1e8,
};

let toonGradient = null;
function getToonGradient() {
  if (toonGradient) return toonGradient;
  const data = new Uint8Array([90, 170, 255]);
  toonGradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}

const cache = new Map();

/** Flat-coloured material respecting config.render.materialStyle. Cached by colour + options. */
export function mat(color, opts = {}) {
  const key = `${color}|${opts.map?.uuid ?? ''}|${opts.emissive ?? ''}|${opts.transparent ?? ''}|${opts.opacity ?? ''}`;
  if (cache.has(key)) return cache.get(key);
  const params = { color, ...opts };
  const m = config.render.materialStyle === 'toon'
    ? new THREE.MeshToonMaterial({ ...params, gradientMap: getToonGradient() })
    : new THREE.MeshLambertMaterial(params);
  cache.set(key, m);
  return m;
}

/** Unlit material (screens, signs, light panels). */
export function basic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

/** Build a CanvasTexture by drawing into a 2D context. */
export function canvasTexture(w, h, draw, { nearest = false, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (nearest) tex.magFilter = THREE.NearestFilter; // opt-in for deliberately blocky textures
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// Deterministic pseudo-random so the room looks the same every load
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}
