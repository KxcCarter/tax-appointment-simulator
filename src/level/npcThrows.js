import * as THREE from 'three';
import { config } from '../config.js';

/*
  The waiting people throwing things at the player (the brawl; owner's request). Someone hanging back
  fetches something nearby (config.brawl.throwing.kinds: never the bat or the rest of the back room),
  walks out to a few metres from him, and throws it, overhead, two-handed. In flight it hurts the player
  if it reaches him (blocking works), or, with friendlyFire, whoever else it flies into.

  The brawl (brawl.js) plans the round; this module finds things, hands them over and flies them.
*/

const T = () => config.brawl.throwing;
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * @param items        () => [{ object, kind }]  everything registered as a weapon (scene children with bodies)
 * @param npcs         () => Npc[]
 * @param weaponDef    (kind) => config.weapons entry (with defaults)
 * @param onPlayerHit  (def, dir) => void  it reached the player
 * @param onFriendlyFire (victim, thrower) => void  it hit one of the others instead
 */
export function createNpcThrows({ camera, sfx, items, npcs, weaponDef, onPlayerHit, onFriendlyFire }) {
  let flying = []; // { item, body, def, thrower, t, hit: Set }
  const stats = { thrown: 0, hitPlayer: 0, hitOthers: 0 }; // (for tests and tuning)

  const free = (item) => {
    const o = item.object;
    if (!o.userData.body || o.userData.held || !o.parent) return false;
    const r = item.reservedBy;
    if (r && !r.down && r.brawling) return false; // someone's on their way to it
    return true;
  };

  const handle = (npc, item) => ({
    group: item.object,
    item,
    // Knocked down (or put back in their seat) holding it: it falls where it is
    drop() {
      const o = item.object, b = o.userData.body;
      o.userData.held = false;
      item.reservedBy = null;
      if (b) {
        b.setTranslation(o.position, true);
        b.setRotation(o.quaternion, true);
        b.setEnabled(true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.wakeUp();
      }
    },
  });

  return {
    stats,
    /** The nearest free thing they could throw (inside the room, in front of the counter), or null. */
    find(npc) {
      const at = npc.walker.pos ?? npc.rig.root.position, bd = config.brawl.bounds;
      let best = null, bestD = T().search;
      for (const item of items()) {
        if (!T().kinds.includes(item.kind) || !free(item)) continue;
        const p = item.object.position;
        if (p.x < bd.minX - 0.5 || p.x > bd.maxX + 0.5 || p.z < bd.minZ - 0.5 || p.z > bd.maxZ + 0.5) continue;
        if (Math.hypot(p.x - camera.position.x, p.z - camera.position.z) < T().keepAway) continue;
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        if (d < bestD) { best = item; bestD = d; }
      }
      if (best) best.reservedBy = npc;
      return best;
    },

    /** Picked up (reach step). False if it's gone (the player has it, or it's someone else's). */
    take(npc, item) {
      if (item.object.userData.held || (item.reservedBy && item.reservedBy !== npc)) return false;
      item.object.userData.held = true; // (out of the physics sync; the player can't take it from their hands)
      item.object.userData.body?.setEnabled(false);
      item.reservedBy = npc;
      npc.carrying = handle(npc, item);
      return true;
    },

    /** The moment of release in the throw: at `target`, with a little aim error, in an arc. */
    release(npc, target) {
      const h = npc.carrying;
      if (!h?.item) return; // (lost it on the way)
      npc.carrying = null;
      const item = h.item, o = item.object, body = o.userData.body;
      o.userData.held = false;
      item.reservedBy = null;
      const p = o.position.clone();
      const S = T().spread;
      const aim = target.clone().add(new THREE.Vector3(rand(-S, S), rand(-0.3, 0.1) - 0.2, rand(-S, S)));
      const flat = Math.hypot(aim.x - p.x, aim.z - p.z);
      const t = Math.max(0.25, flat / T().speed);
      const g = config.physics.gravity;
      body.setTranslation(p, true);
      body.setRotation(o.quaternion, true);
      body.setEnabled(true);
      body.setLinvel({ x: (aim.x - p.x) / t, y: (aim.y - p.y) / t - 0.5 * g * t, z: (aim.z - p.z) / t }, true);
      body.setAngvel({ x: rand(-7, 7), y: rand(-7, 7), z: rand(-7, 7) }, true);
      body.wakeUp();
      sfx.whoosh(p);
      stats.thrown++;
      flying.push({ item, body, def: weaponDef(item.kind), thrower: npc, t: 0, hit: new Set() });
    },

    /** Things in flight: do they hit anyone? */
    update(dt) {
      if (!flying.length) return;
      const R = T().hitRadius;
      const cam = camera.position;
      for (const f of flying) {
        f.t += dt;
        if (f.item.object.userData.held) { f.t = 99; continue; } // caught (picked up)
        const v = f.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) < 3) continue;
        const tp = f.body.translation(), at = new THREE.Vector3(tp.x, tp.y, tp.z);
        const dir = new THREE.Vector3(v.x, 0, v.z);
        const damage = f.def.damage * T().damageShare, knock = f.def.knock * T().knockShare;
        // The player: anywhere from the head down to the chest
        const y = THREE.MathUtils.clamp(at.y, cam.y - 0.9, cam.y);
        if (!f.hit.has('player') && Math.hypot(at.x - cam.x, at.y - y, at.z - cam.z) < R) {
          f.hit.add('player');
          stats.hitPlayer++;
          onPlayerHit({ damage, knock, shake: 0.8, sound: f.def.sound ?? 'punch' }, dir);
          f.t = 99;
          continue;
        }
        if (!T().friendlyFire) continue;
        for (const n of npcs()) {
          if (n === f.thrower || n.down || f.hit.has(n)) continue;
          const chest = n.rig.joints.spine.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0));
          if (chest.distanceTo(at) < T().friendlyRadius) {
            f.hit.add(n);
            stats.hitOthers++;
            n.takeHit(dir, { damage, knock, source: 'thrown' });
            sfx.hit(f.def.sound ?? 'punch', chest);
            onFriendlyFire?.(n, f.thrower);
          }
        }
      }
      flying = flying.filter((f) => f.t < 2.5);
    },

    /** The failure loop: nothing in the air, nothing reserved. */
    clear() {
      flying = [];
      for (const item of items()) item.reservedBy = null;
    },
  };
}
