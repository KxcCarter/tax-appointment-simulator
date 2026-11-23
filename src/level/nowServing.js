import * as THREE from 'three';
import { theme } from '../theme.js';

/**
 * Wall-mounted "NOW SERVING" LED display. Local +z faces out of the wall.
 * setNumber(n) redraws the digits.
 */
export function createNowServing(initial) {
  const group = new THREE.Group();
  group.name = 'nowServing';

  const W = 0.9, H = 0.42;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.08), theme.material('black'));
  housing.position.z = 0.04;
  group.add(housing);

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  const tex = theme.prepareTexture(new THREE.CanvasTexture(canvas));

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.06), theme.textured(tex));
  screen.position.z = 0.081;
  group.add(screen);

  function setNumber(n) {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = theme.css('ledBackground');
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = theme.css('ledLabel');
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('NOW SERVING', w / 2, 6);
    // Unlit LED segments: ghosted 888 behind the number
    ctx.font = 'bold 54px monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.css('ledGhost');
    ctx.fillText('888', w / 2, 80);
    ctx.fillStyle = theme.css('ledRed');
    ctx.fillText(String(n).padStart(3, ' '), w / 2, 80);
    tex.needsUpdate = true;
  }
  setNumber(initial);

  return { group, setNumber };
}
