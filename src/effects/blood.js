import * as THREE from 'three';
import { RAPIER } from '../physics.js';
import { config } from '../config.js';
import { theme } from '../theme.js';

/*
  Blood spatter (owner's request): when a blow lands, droplets burst from where it landed, fly along the blow
  and fall, and each leaves a splat where it lands: the floor, a wall, the counter, a cabinet. Splats stay (up to
  config.blood.maxSplats; then the oldest go). Tuning: config.blood; colours and splat shapes: theme.blood().

  One per scene: initBlood({ scene, physics }) once, update(dt) every frame (the level does both), and anyone
  hit calls bloodSpray(point, dir, { damage, source }).
*/

let B = null; // { scene, physics, drops: InstancedMesh, live: [], splats: [], splatMats, dropGeo }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1), _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

export function initBlood({ scene, physics }) {
  const C = config.blood;
  const looks = theme.blood();
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), looks.drop, C.maxDrops);
  drops.count = 0;
  drops.frustumCulled = false;
  drops.castShadow = false;
  drops.userData.noShadow = true;
  drops.raycast = () => {};
  scene.add(drops);
  B = { scene, physics, drops, live: [], splats: [], splatMats: looks.splats, splatGeo: new THREE.PlaneGeometry(1, 1) };
}

/**
 * A blow landed at `point` (world), travelling along `dir`: a burst of droplets.
 * damage: how hard (more blood), source: 'fist' | 'kick' | 'weapon' | 'thrown' | 'knockdown'.
 */
export function bloodSpray(point, dir, { damage = 25, source = 'fist' } = {}) {
  const C = config.blood;
  if (!B || !C.enabled || !point) return;
  const n = Math.min(C.maxPerHit, Math.round((C.drops[source] ?? C.drops.fist) * Math.max(0.5, damage / 25)));
  const d = (dir ? _v.copy(dir) : _v.set(0, 0, 0)).setY(0);
  if (d.lengthSq() < 1e-6) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  d.normalize();
  for (let i = 0; i < n && B.live.length < C.maxDrops; i++) {
    // Mostly along the blow, fanned out and up; a few back towards whoever hit them
    const back = Math.random() < C.backShare ? -0.6 : 1;
    const speed = rand(...C.speed) * (source === 'weapon' || source === 'knockdown' ? 1.25 : 1);
    const v = new THREE.Vector3(d.x * back + rand(-C.spread, C.spread), rand(...C.lift), d.z * back + rand(-C.spread, C.spread))
      .normalize().multiplyScalar(speed);
    B.live.push({ p: new THREE.Vector3().copy(point).addScaledVector(v, 0.02), v, r: rand(...C.dropSize), t: 0 });
  }
}

/** Fly the droplets; splat the ones that hit something. */
export function updateBlood(dt) {
  if (!B || !B.live.length) { if (B) B.drops.count = 0; return; }
  const C = config.blood, world = B.physics.world;
  const step = new THREE.Vector3();
  let k = 0;
  for (let i = B.live.length - 1; i >= 0; i--) {
    const d = B.live[i];
    d.t += dt;
    d.v.y += C.gravity * dt;
    d.v.multiplyScalar(1 - C.drag * dt);
    step.copy(d.v).multiplyScalar(dt);
    const len = step.length();
    let landed = null;
    if (len > 1e-6) {
      // Only the room and its furniture (not people, not loose props): fixed colliders
      const ray = new RAPIER.Ray(d.p, { x: step.x / len, y: step.y / len, z: step.z / len });
      const hit = world.castRayAndGetNormal(ray, len, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      if (hit) landed = { p: d.p.clone().addScaledVector(step, hit.timeOfImpact / len), n: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
    }
    if (!landed && d.p.y + step.y <= 0.002) landed = { p: new THREE.Vector3(d.p.x + step.x, 0.002, d.p.z + step.z), n: _up.clone() };
    if (landed || d.t > C.life) {
      if (landed) splat(landed.p, landed.n, d.r);
      B.live.splice(i, 1);
      continue;
    }
    d.p.add(step);
  }
  // Draw: each a little sphere stretched along its flight
  for (const d of B.live) {
    const sp = d.v.length();
    _q.setFromUnitVectors(_z, sp > 1e-4 ? _s.copy(d.v).divideScalar(sp) : _z);
    _s.set(d.r, d.r, d.r * (1 + Math.min(3, sp * C.stretch)));
    _m.compose(d.p, _q, _s);
    B.drops.setMatrixAt(k++, _m);
  }
  B.drops.count = k;
  B.drops.instanceMatrix.needsUpdate = true;
}

function splat(p, n, r) {
  const C = config.blood;
  const m = new THREE.Mesh(B.splatGeo, B.splatMats[Math.floor(Math.random() * B.splatMats.length)]);
  const size = r * rand(...C.splatScale);
  m.scale.set(size, size, 1);
  // Facing out of the surface, turned at random, just off it (each a hair further, so they don't flicker)
  m.quaternion.setFromUnitVectors(_z, n);
  m.rotateZ(Math.random() * Math.PI * 2);
  m.position.copy(p).addScaledVector(n, 0.002 + (B.splats.length % 50) * 0.00004);
  m.raycast = () => {};
  m.renderOrder = 1;
  m.userData.noShadow = true;
  B.scene.add(m);
  B.splats.push(m);
  if (B.splats.length > C.maxSplats) B.scene.remove(B.splats.shift());
}
