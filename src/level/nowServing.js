import * as THREE from 'three';
import { mat, basic, PALETTE } from './materials.js';

/**
 * Wall-mounted "NOW SERVING" LED display. Local +z faces out of the wall.
 * setNumber(n) redraws the digits.
 */
export function createNowServing(initial) {
  const group = new THREE.Group();
  group.name = 'nowServing';

  const W = 0.9, H = 0.42;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.08), mat(PALETTE.black));
  housing.position.z = 0.04;
  group.add(housing);

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.06), basic(0xffffff, { map: tex }));
  screen.position.z = 0.081;
  group.add(screen);

  function setNumber(n) {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#140504';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8c9a3';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('NOW SERVING', w / 2, 6);
    // Unlit LED segments: ghosted 888 behind the number
    ctx.font = 'bold 54px monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#3a0e0a';
    ctx.fillText('888', w / 2, 80);
    ctx.fillStyle = '#ff3a22';
    ctx.fillText(String(n).padStart(3, ' '), w / 2, 80);
    tex.needsUpdate = true;
  }
  setNumber(initial);

  return { group, setNumber };
}
