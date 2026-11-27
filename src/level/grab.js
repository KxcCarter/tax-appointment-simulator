import * as THREE from 'three';
import { RAPIER } from '../physics.js';
import { config } from '../config.js';
import { impact } from '../player/combat.js';

/*
  Grab and shove (owner's request; config.combat.grab). G grabs whoever's in front of the player (hands empty):
  they're held at arm's length, squirming, their own attacks stopped. Left click (hold to wind up) shoves them
  away; G again just lets go; after `hold` seconds they break free and shove him back.

  Shoved, they fly backwards along the floor until they slow down or hit something:
  - a wall, the counter, a cabinet, the table: a slam (damage by speed; things standing nearby jump and fall);
  - a glass shelf: it breaks, and they carry on through (cut);
  - anything loose (a chair, a mug): knocked flying, and they carry on;
  - someone else: they both go down like skittles (or at least stagger).
  A slam that finishes them puts them down into a ragdoll, against whatever they hit.
*/

const _v = new THREE.Vector3();

export function createGrab({ camera, player, physics, sfx, glass, npcs, combat, onHit }) {
  const G = () => config.combat.grab;
  let held = null;       // { npc, t, squirm }
  const flying = [];     // { npc, vel, t, hit: Set }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG' || e.repeat || !document.pointerLockElement) return;
    if (held) release();
    else tryGrab();
  });

  const flatForward = () => { camera.getWorldDirection(_v); _v.y = 0; return _v.normalize().clone(); };

  /** Whoever's standing in front of him, within reach, nearest the crosshair. */
  function inFront() {
    const fwd = flatForward(), me = camera.position;
    let best = null, bestScore = Infinity;
    for (const n of npcs()) {
      if (n.down || n.forced || !n.walker.active || !n.walker.pos) continue;
      const to = n.walker.pos.clone().sub(me).setY(0), d = to.length();
      if (d > G().reach + 0.3 || d < 0.05) continue;
      const cos = to.divideScalar(d).dot(fwd);
      if (cos < 0.8) continue;
      const score = d * (2 - cos);
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  function tryGrab() {
    if (!combat.enabled || combat.held || combat.grabbing || player.seat || !player.canAct) return;
    if (combat.punch || combat.swing || combat.kick || combat.charging) return;
    const n = inFront();
    if (!n) { sfx.whoosh(); return; }
    combat.tire(config.combat.stamina.cost.grab);
    held = { npc: n, t: 0, squirm: 0 };
    n.forced = { pos: n.walker.pos.clone(), yaw: n.walker.yaw, expression: 'surprised' };
    combat.grabbing = { onShove: (charge, mult) => shove(charge, mult) };
    sfx.hit('shove', n.walker.pos.clone().setY(1.2));
    // A gasp (the women), a grunt (the men)
    if (config.audio.vocals.female.includes(n.id)) sfx.vocal('gasp_female', n.voicePosition());
    else n.grunt(0);
    n.react.hit(flatForward(), null, { damage: 15, knock: 1 });
  }

  /** Let go (G again, or they broke free, or something else came up). */
  function release() {
    if (!held) return;
    const n = held.npc;
    held = null;
    combat.grabbing = null;
    if (!n.down) { n.forced = null; n.walker.stun = Math.max(n.walker.stun ?? 0, 0.3); }
  }

  /** Left click while holding someone: away they go, harder the more it was wound up. */
  function shove(charge, mult) {
    if (!held) return;
    const n = held.npc, dir = flatForward();
    held = null;
    combat.grabbing = null;
    const [a, b] = G().speed;
    const speed = (a + (b - a) * charge) * (mult.slow > 1 ? 0.7 : 1); // (exhausted: a feeble shove)
    flying.push({ npc: n, vel: dir.clone().multiplyScalar(speed), t: 0, hit: new Set() });
    n.forced.expression = 'surprised';
    n.react.hit(dir, null, { damage: 25 + 25 * charge, knock: 1.5 });
    sfx.hit(charge > 0.5 ? 'kick' : 'shove', n.walker.pos.clone().setY(1.2));
    player.shake = Math.max(player.shake, 0.15 + 0.2 * charge);
  }

  /** Things near a slam jump: a mug on the cabinet, the stapler on the table. */
  function rattle(point, dir) {
    const S = G().slam;
    for (const e of physics.synced) {
      const t = e.body.translation();
      const d = Math.hypot(t.x - point.x, t.y - point.y, t.z - point.z);
      if (d > S.rattle || e.object3d.userData.held || e.body.mass() > 40) continue;
      const k = 1 - d / S.rattle;
      e.body.wakeUp();
      const v = e.body.linvel();
      e.body.setLinvel({ x: v.x + dir.x * 1.2 * k + (Math.random() - 0.5) * k, y: v.y + (1.2 + Math.random() * 1.5) * k, z: v.z + dir.z * 1.2 * k + (Math.random() - 0.5) * k }, true);
      e.body.setAngvel({ x: (Math.random() - 0.5) * 8 * k, y: (Math.random() - 0.5) * 8 * k, z: (Math.random() - 0.5) * 8 * k }, true);
    }
  }

  /** Into a wall or the furniture. */
  function slam(f, point) {
    const S = G().slam, n = f.npc, speed = f.vel.length(), dir = f.vel.clone().normalize();
    const damage = S.damage * THREE.MathUtils.clamp(speed / S.refSpeed, 0.4, 1.6);
    n.forced = null; // (back in the walker's hands: the hit staggers them, or the ragdoll takes over)
    n.takeHit(dir, { damage, knock: S.knock, hit: { point }, source: 'slam' });
    sfx.bodyThud(point, Math.min(1, speed / 8));
    if (!sfx.wallSlam(point, Math.min(1, speed / 8))) sfx.propHit(point, Math.min(1, speed / 7), 'thud', 40);
    rattle(point, dir);
    player.shake = Math.max(player.shake, 0.2);
    impact(damage, n.down);
    onHit(n);
    if (!n.down) n.walker.stun = Math.max(n.walker.stun ?? 0, config.combat.heavyStun);
  }

  function updateFlying(dt) {
    const S = G().slam, world = physics.world;
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], n = f.npc;
      f.t += dt;
      if (n.down || !n.forced) { flying.splice(i, 1); continue; }
      const speed = f.vel.length();
      if (speed < 1.2 || f.t > G().flyTime) {
        n.forced = null;
        n.walker.stun = Math.max(n.walker.stun ?? 0, 0.5);
        flying.splice(i, 1);
        continue;
      }
      if (![f.vel.x, f.vel.z, n.forced.pos.x, n.forced.pos.z].every(Number.isFinite)) { n.forced = null; flying.splice(i, 1); continue; }
      const dir = f.vel.clone().divideScalar(speed), step = speed * dt, pos = n.forced.pos;
      const sc = n.rig.scale ?? 1;
      let slammed = false;
      // Into a glass shelf: every sheet from the knees up breaks, and they stop against its frame
      const ahead = pos.clone().addScaledVector(dir, step + 0.22);
      const crash = glass.crashInto(ahead, 0.05, 0.3 * sc, 1.9 * sc, f.vel);
      if (crash.shelf) {
        const point = ahead.clone().setY(1.1 * sc);
        if (crash.broken) {
          n.takeHit(dir, { damage: S.glassDamage, knock: 1, hit: { point }, source: 'slam' });
          if (n.down) { impact(S.glassDamage, true); onHit(n); flying.splice(i, 1); continue; }
        }
        slam(f, point);
        flying.splice(i, 1);
        continue;
      }
      // What's in the way, at chest and hip height (not people: their hitboxes are kinematic)
      for (const h of [1.1 * sc, 0.55 * sc]) {
        const from = { x: pos.x, y: h, z: pos.z };
        const hit = world.castRay(new RAPIER.Ray(from, { x: dir.x, y: 0, z: dir.z }), step + 0.28, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
        if (!hit) continue;
        const c = hit.collider, point = new THREE.Vector3(from.x + dir.x * hit.timeOfImpact, h, from.z + dir.z * hit.timeOfImpact);
        if (glass.shatterCollider(c, f.vel, point)) {
          // Through the glass shelf
          n.takeHit(dir, { damage: S.glassDamage, knock: 1, hit: { point }, source: 'slam' });
          impact(S.glassDamage, n.down);
          onHit(n);
          f.vel.multiplyScalar(0.7);
          if (n.down) { slammed = true; break; }
          continue;
        }
        const body = c.parent();
        if (body && body.isDynamic() && body.mass() < 60) {
          // Something loose: knocked flying, and on they go
          if (!f.hit.has(body.handle)) {
            f.hit.add(body.handle);
            body.wakeUp();
            const v = f.vel.clone().multiplyScalar(S.propPush * Math.min(1, 15 / Math.max(1, body.mass())));
            body.setLinvel({ x: v.x, y: 1 + Math.random(), z: v.z }, true);
            body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }, true);
            sfx.propHit(point, 0.7, body.mass() < 3 ? 'thud' : 'metal', body.mass());
            f.vel.multiplyScalar(0.85);
          }
          continue;
        }
        slam(f, point);
        slammed = true;
        break;
      }
      if (slammed) { flying.splice(i, 1); continue; }
      // Someone in the way: skittles
      for (const o of npcs()) {
        if (o === n || o.down || f.hit.has(o) || !o.walker.pos) continue;
        if (Math.hypot(o.walker.pos.x - pos.x, o.walker.pos.z - pos.z) > 0.6) continue;
        f.hit.add(o);
        o.takeHit(dir, { damage: S.bowlDamage, knock: 1.8, source: 'slam' });
        n.takeHit(dir.clone().negate(), { damage: S.bowlDamage * 0.5, knock: 1, source: 'slam' });
        sfx.bodyThud(o.walker.pos.clone().setY(1), 0.8);
        impact(S.bowlDamage, o.down);
        onHit(o);
        f.vel.multiplyScalar(0.5);
      }
      if (n.down) { flying.splice(i, 1); continue; }
      pos.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(Math.exp(-G().friction * dt));
    }
  }

  return {
    get holding() { return held?.npc ?? null; },
    get flying() { return flying.length; },
    tryGrab, // (the G key; exposed for tests)
    release,
    update(dt) {
      if (held) {
        const n = held.npc;
        if (!n.forced) { held = null; combat.grabbing = null; } // (taken out of his hands: back in their seat...)
        else if (n.down || !combat.enabled || player.seat) { release(); }
        else {
          held.t += dt;
          // At arm's length in front of him, facing him
          const fwd = flatForward(), me = camera.position;
          const p = new THREE.Vector3(me.x + fwd.x * G().holdAt, 0, me.z + fwd.z * G().holdAt);
          n.forced.pos.copy(p);
          n.forced.yaw = Math.atan2(me.x - p.x, me.z - p.z);
          if ((held.squirm -= dt) <= 0) { held.squirm = G().squirmEvery; n.react.squirm(1); }
          // Held too long: they break free and shove him off
          if (held.t > G().hold) {
            release();
            player.knock(fwd.clone().negate(), G().breakFreeKnock, 0.6);
            sfx.hit('shove', camera.position);
          }
        }
      }
      if (flying.length) updateFlying(dt);
    },
  };
}
