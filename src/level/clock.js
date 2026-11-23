import * as THREE from 'three';
import { theme } from '../theme.js';

/**
 * Wall-mounted analog clock. Local +z faces out of the wall.
 * update(clockTime) takes seconds since midnight; the second hand jumps once per second.
 */
export function createClock({ radius = 0.32 } = {}) {
  const group = new THREE.Group();
  group.name = 'clock';

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, 0.06, 32),
    theme.material('black')
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.z = 0.03;
  group.add(rim);

  const faceTex = theme.canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = theme.css('clockFace');
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const major = i % 5 === 0;
      g.strokeStyle = theme.css('clockInk');
      g.lineWidth = major ? 7 : 2;
      const r0 = major ? 96 : 108;
      g.beginPath();
      g.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
      g.lineTo(Math.sin(a) * 120, -Math.cos(a) * 120);
      g.stroke();
    }
    g.fillStyle = theme.css('clockInk');
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      g.fillText(String(n), Math.sin(a) * 76, -Math.cos(a) * 76);
    }
    g.font = '11px monospace';
    g.fillText('STANDARD OFFICE', 0, 36);
  });

  const face = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), theme.textured(faceTex));
  face.position.z = 0.061;
  group.add(face);

  const hand = (len, width, color, z) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, len, 0.006), theme.unlit(color));
    m.position.y = len / 2 - len * 0.12;
    pivot.add(m);
    pivot.position.z = z;
    group.add(pivot);
    return pivot;
  };
  const hourHand = hand(radius * 0.55, 0.028, 'clockInk', 0.066);
  const minuteHand = hand(radius * 0.82, 0.018, 'clockInk', 0.072);
  const secondHand = hand(radius * 0.9, 0.014, 'clockSecondHand', 0.078);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), theme.unlit('clockSecondHand'));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.082;
  group.add(cap);

  function update(clockTime) {
    const t = ((clockTime % 43200) + 43200) % 43200;
    const sec = Math.floor(t % 60);
    const min = (t / 60) % 60;
    const hr = (t / 3600) % 12;
    // Clockwise when viewed from the front: negative rotation about +z
    secondHand.rotation.z = -(sec / 60) * Math.PI * 2;
    minuteHand.rotation.z = -(min / 60) * Math.PI * 2;
    hourHand.rotation.z = -(hr / 12) * Math.PI * 2;
  }

  return { group, update };
}
