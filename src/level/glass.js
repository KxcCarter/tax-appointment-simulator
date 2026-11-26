import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';

/*
  The glass shelves breaking (owner: "breakable glass shelves"). Each sheet of glass (anchors.glassPanels,
  built in waitingRoom.js) breaks when the player swings at it (combat.js's `breakables`), or when anything
  moving faster than config.physics.glass.breakSpeed reaches it: a thrown thing, a prop knocked flying, someone
  knocked down into it (their ragdoll). The sheet goes, shards fly, and what stood on it drops.
*/
export function createGlass({ scene, physics, sfx, panels, movers }) {
  const G = config.physics.glass;
  const live = new Set(panels);
  const shardMat = theme.surface('glassShard');
  const _l = new THREE.Vector3();

  function shatter(p, dir = null, point = null) {
    if (!live.has(p)) return;
    live.delete(p);
    physics.world.removeCollider(p.collider, true);
    p.mesh.visible = false;
    p.mesh.userData.glass = false;
    const at = point ?? p.center;
    sfx.glassBreak({ x: at.x, y: at.y, z: at.z }, 1);
    // Shards: thin flat pieces of the sheet, flung along the blow and falling
    for (let i = 0; i < G.shards; i++) {
      const sx = 0.04 + Math.random() * 0.09, sz = 0.03 + Math.random() * 0.08;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.006, sz), shardMat);
      m.castShadow = false;
      const off = new THREE.Vector3((Math.random() - 0.5) * p.half.x * 1.8, 0, (Math.random() - 0.5) * p.half.z * 1.8)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      m.position.copy(p.center).add(off);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      scene.add(m);
      const body = physics.addDynamic(m, [{ type: 'box', half: { x: sx / 2, y: 0.004, z: sz / 2 } }], { density: 2500, restitution: 0.2 });
      m.userData.impactSound = 'glass';
      body.userData = { shard: true }; // (shards don't break more glass)
      const s = G.shardSpeed * (0.4 + Math.random());
      const d = dir ? new THREE.Vector3(dir.x, 0, dir.z).normalize() : new THREE.Vector3();
      body.wakeUp();
      body.setLinvel({ x: d.x * s + (Math.random() - 0.5) * 1.5, y: Math.random() * 1.5, z: d.z * s + (Math.random() - 0.5) * 1.5 }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 }, true);
    }
    // What stood on it drops (bodies at rest are asleep: wake everything just above it)
    for (const e of physics.synced) {
      const t = e.body.translation();
      if (t.y < p.center.y || t.y > p.center.y + 0.45) continue;
      if (!inside(p, t, 0.05, 0.5)) continue;
      e.body.wakeUp();
    }
  }

  // Is a point within the sheet (plus a margin), in its own frame
  function inside(p, t, margin, up = 0.08) {
    _l.set(t.x - p.center.x, t.y - p.center.y, t.z - p.center.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -p.yaw);
    return Math.abs(_l.x) < p.half.x + margin && Math.abs(_l.z) < p.half.z + margin && _l.y > -p.half.y - 0.08 && _l.y < p.half.y + up;
  }

  for (const p of panels) p.mesh.userData.onBreak = (dir, point) => shatter(p, dir, point);

  return {
    /** The sheets still in one piece (what a swing can break). */
    meshes: () => [...live].map((p) => p.mesh),
    update() {
      if (!live.size) return;
      for (const body of movers()) {
        if (body.isSleeping() || body.userData?.shard) continue;
        const v = body.linvel(), speed = Math.hypot(v.x, v.y, v.z);
        if (speed < G.breakSpeed) continue;
        const t = body.translation();
        for (const p of live) if (inside(p, t, 0.15, 0.15)) { shatter(p, v, t); break; }
      }
    },
  };
}
