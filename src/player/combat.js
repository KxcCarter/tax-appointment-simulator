import * as THREE from 'three';
import { config } from '../config.js';
import { state } from '../state.js';
import { theme } from '../theme.js';
import { RealArms } from './realArms.js';
import { partGeometry } from '../characters/partShapes.js';

/*
  The player's fists and improvised weapons.
  Hidden until `enabled` (the player can't bring themselves to fight back at first); then both
  fists come up and left-click jabs, alternating hands.
  Anything registered as a weapon (level code calls pickUp) replaces the fists: left click swings
  it, Q throws it. A hit lands on the first character within reach under the crosshair:
  target.takeHit(dir, { damage, knock }).
*/

const C = () => config.combat;
const WP = () => config.weapons;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const rand = (a, b) => a + Math.random() * (b - a);

/** How long the game freezes for a blow this hard (config.combat.hitStop; a weapon's own hitStop wins). */
export function hitStopFor(damage, own = null) {
  const H = C().hitStop;
  return own ?? Math.min(H.max, H.base + H.perDamage * damage);
}

/** A blow landed: freeze for a moment; knocked down, a moment of slow motion (config.combat.slowMo). */
export function impact(damage, knockedDown, own = null) {
  state.hitStop = Math.max(state.hitStop, hitStopFor(damage, own));
  if (knockedDown) slowMo(C().slowMo.time);
}

/** Slow motion for `seconds` (real time). */
export function slowMo(seconds) {
  state.slowMo = Math.max(state.slowMo ?? 0, seconds);
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (x) => x * x * (3 - 2 * x);

/** The stats and held pose for a kind of weapon (config.weapons, over its defaults). */
export function weaponDef(kind) {
  return { ...WP().defaults, ...(WP()[kind] ?? {}) };
}

export class Combat {
  /**
   * @param targets () => [{ rig: { root }, takeHit(dir, hit) }]  characters that can be hit
   * @param onHit   (target) => void  after a blow lands (optional)
   * @param physics the level's Physics wrapper (for dropping/throwing things)
   * @param scene   where dropped things go back to
   */
  constructor({ camera, player, sfx, targets, onHit, physics, scene, breakables }) {
    this.breakables = breakables ?? (() => []); // meshes a swing can break (glass shelves): mesh.userData.onBreak(dir, point)
    this.onHit = onHit ?? (() => {});
    this.camera = camera;
    this.player = player;
    this.sfx = sfx;
    this.targets = targets;
    this.physics = physics;
    this.scene = scene;
    this.enabled = false;
    this.raise = 0;      // 0 = fists down out of view, 1 = up in guard
    this.punch = null;   // { t, side, hitDone }
    this.swing = null;   // { t, hitDone }  with a weapon
    this.cooldown = 0;
    this.nextSide = -1;  // right hand first
    this.held = null;    // { object, kind, def, basePos, baseQuat }
    this.thrown = [];    // things in flight: { object, body, def, t, hit:Set }
    this.raycaster = new THREE.Raycaster();
    this.stamina = C().stamina.max; // (config.combat.stamina)
    this.restT = 0;                 // seconds since he last did anything tiring
    this.charging = null;           // { t }: left button held, winding up (config.combat.charge)
    this.grabbing = null;           // set by grab.js while he's holding someone; onShove(charge) lets go

    // Viewmodel: two fists with a bit of sleeve, parented to the camera
    this.fists = {};
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      const fist = new THREE.Mesh(partGeometry('figure', 'hand', 0.085, 0.075, 0.1), theme.material('playerSkin'));
      g.add(fist);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 14), theme.material('playerSleeve'));
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.z = 0.19;
      g.add(sleeve);
      g.scale.setScalar(0.85);
      g.visible = false;
      camera.add(g);
      this.fists[side] = g;
    }

    // The kicking leg: trouser and shoe, out of sight below the view until a kick
    this.leg = new THREE.Group();
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 14), theme.material('playerTrousers'));
    shin.position.y = 0.28;
    this.leg.add(shin);
    const shoe = new THREE.Mesh(partGeometry('figure', 'foot', 0.11, 0.08, 0.27), theme.material('playerShoe'));
    shoe.position.set(0, 0.0, -0.07);
    this.leg.add(shoe);
    this.leg.visible = false;
    camera.add(this.leg);
    this.kick = null;      // { t, hitDone }
    // Realistic look: the player's own forearms, hands and leg follow these (which are then just anchors)
    this.realArms = RealArms.create(camera);
    if (this.realArms) for (const o of [this.fists[1], this.fists[-1], this.leg]) o.children.forEach((c) => { c.visible = false; });

    // F kicks; holding the right mouse button blocks (arms, or the weapon, raised in front)
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    const tryKick = () => {
      if (!this.enabled || !this.player.canAct || this.player.seat || this.blocking || this.grabbing) return;
      if (this.kick || this.swing || this.punch || this.charging || this.cooldown > 0) return;
      this.kick = { t: 0, hitDone: false, mult: this._spend(C().stamina.cost.kick, 0) };
    };
    document.addEventListener('keydown', (e) => { if (e.code === 'KeyF' && !e.repeat) tryKick(); });
    this.blocking = false;
    this.block = 0; // 0..1, how far the guard is up
    document.addEventListener('mousedown', (e) => { if (e.button === 2) this.blocking = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 2) this.blocking = false; });
    window.addEventListener('blur', () => { this.blocking = false; });

    // Left button: pressed, he winds up (config.combat.charge); let go, he hits (or shoves, holding someone)
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled || !this.player.canAct || this.player.seat) return;
      if (!document.pointerLockElement) return; // (a click that only captures the mouse isn't a punch)
      if (this.punch || this.swing || this.kick || this.charging || this.cooldown > 0 || this.block > 0.3) return;
      this.charging = { t: 0 };
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this._release(); });
    window.addEventListener('blur', () => { this.charging = null; });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ' && this.held && this.player.canAct) this.drop(true);
    });
  }

  /** How far wound up (0..1) after holding the button `t` s. */
  _chargeOf(t) {
    const H = C().charge;
    return t < H.tap ? 0 : Math.min(1, (t - H.tap) / Math.max(0.01, H.time - H.tap));
  }

  /**
   * Pay for an attack (config.combat.stamina): `cost`, plus more for a wind-up. Short of it, he's exhausted.
   * Returns the attack's multipliers: { damage, knock, slow, charge }.
   */
  _spend(cost, charge) {
    const S = C().stamina, H = C().charge;
    const tired = this.stamina < cost;
    this.stamina = Math.max(0, this.stamina - cost - charge * S.chargeCost);
    this.restT = 0;
    return {
      damage: lerp(1, H.damage, charge) * (tired ? S.tiredDamage : 1),
      knock: lerp(1, H.knock, charge),
      slow: tired ? S.tiredSlow : 1,
      charge,
    };
  }

  /** A blow blocked, or something else tiring (stamina). */
  tire(amount) {
    this.stamina = Math.max(0, this.stamina - amount);
    this.restT = 0;
  }

  /** Hit while winding up: it's lost. */
  interrupt() {
    this.charging = null;
  }

  /** The left button let go: the punch, swing or shove, wound up as far as it got. */
  _release() {
    const ch = this.charging;
    if (!ch) return;
    this.charging = null;
    if (!this.enabled || this.player.seat) return;
    const c = this._chargeOf(ch.t), cost = C().stamina.cost;
    if (this.grabbing) { const m = this._spend(cost.shove, c); this.grabbing.onShove(c, m); return; }
    if (this.held) {
      this.swing = { t: 0, hitDone: false, mult: this._spend(this.held.def.style === 'overhead' ? cost.overhead : cost.swing, c) };
      return;
    }
    // Chain: quick punches build a combo; every few, a harder hook (not wound-up ones)
    const now = performance.now() / 1000;
    this.combo = c === 0 && now - (this.lastPunch ?? -9) < C().combo.window ? (this.combo ?? 0) + 1 : 1;
    this.lastPunch = now;
    const hook = c === 0 && this.combo % C().combo.every === 0;
    this.punch = { t: 0, side: this.nextSide, hitDone: false, hook, mult: this._spend(cost.punch, c) };
    this.nextSide = -this.nextSide;
  }

  /** Can the player pick something up right now? */
  get canPickUp() {
    return this.enabled && !this.player.seat && !this.swing && !this.grabbing;
  }

  /** Take `object` in hand as a weapon of `kind` (config.weapons). Drops whatever was held. */
  pickUp(object, kind) {
    if (this.held) this.drop(false);
    const def = weaponDef(kind);
    const body = object.userData.body;
    if (body) body.setEnabled(false);
    object.userData.held = true;
    this.thrown = this.thrown.filter((t) => t.object !== object);
    // Held pose: the grip in the hand, pointing the business end along `out`
    const q = new THREE.Quaternion().setFromUnitVectors(v3(def.axis).normalize(), v3(def.out).normalize());
    const grip = def.grip ? v3(def.grip) : localCentre(object);
    const pos = v3(def.at).sub(grip.applyQuaternion(q));
    this.camera.add(object);
    object.position.copy(pos);
    object.quaternion.copy(q);
    object.traverse((o) => { if (o.isMesh) o.userData.heldMesh = true; });
    this.held = { object, kind, def, basePos: pos.clone(), baseQuat: q.clone() };
  }

  /** Let go of the held thing: drop it at your feet, or throw it (Q). */
  drop(throwIt) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    this.swing = null;
    const o = h.object;
    this.scene.attach(o); // keeps its world transform
    o.scale.set(1, 1, 1);
    o.userData.held = false;
    o.traverse((m) => { if (m.isMesh) m.userData.heldMesh = false; });
    let body = o.userData.body;
    if (!body) {
      // Wasn't a physics prop (keyboard, clipboard...): it becomes one now, sized from its shape
      const box = localBox(o);
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.01, 0.01, 0.01));
      const c = box.getCenter(new THREE.Vector3());
      body = this.physics.addDynamic(o, [{ type: 'box', half, offset: c }], { density: 500 });
    }
    body.setTranslation({ x: o.position.x, y: o.position.y, z: o.position.z }, true);
    body.setRotation({ x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w }, true);
    body.setEnabled(true);
    if (body.isFixed()) body.setBodyType(0, true); // e.g. a chair someone was sitting on: free it (0 = Dynamic)
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (throwIt) {
      const v = dir.multiplyScalar(WP().throwSpeed).add(new THREE.Vector3(0, WP().throwLift, 0));
      body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      body.setAngvel({ x: rand(-6, 6), y: rand(-6, 6), z: rand(-6, 6) }, true);
      this.thrown.push({ object: o, body, def: h.def, t: 0, hit: new Set() });
      this.sfx.whoosh();
    } else {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    body.wakeUp();
  }

  update(dt) {
    this.raise += ((this.enabled && !this.player.seat ? 1 : 0) - this.raise) * (1 - Math.exp(-6 * dt));
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.enabled && this.held) this.drop(false);
    if (!this.enabled) this.charging = null;
    if (this.charging) this.charging.t += dt;
    const wantBlock = this.blocking && this.enabled && !this.player.seat && !this.punch && !this.swing && !this.kick && !this.charging && !this.grabbing;
    this.block += ((wantBlock ? 1 : 0) - this.block) * (1 - Math.exp(-C().block.raiseSpeed * dt));
    // Stamina: holding the guard up uses it; it comes back once he lets up (config.combat.stamina)
    const S = C().stamina;
    if (this.block > 0.5) this.tire(S.cost.block * dt);
    const busy = this.punch || this.swing || this.kick || this.charging || this.grabbing || this.block > 0.5;
    this.restT = busy ? 0 : this.restT + dt;
    if (this.restT >= S.regenDelay) this.stamina = Math.min(S.max, this.stamina + S.regen * dt);
    const charge = this.charging ? this._chargeOf(this.charging.t) : 0;

    const jab = { 1: 0, [-1]: 0 };
    if (this.punch) {
      const p = this.punch;
      p.t += dt;
      const u = p.t / (C().punchTime * p.mult.slow);
      jab[p.side] = Math.sin(Math.min(1, u) * Math.PI);
      if (!p.hitDone && u >= C().punchHitAt) {
        p.hitDone = true;
        const K = C().combo, m = p.mult, heavy = p.hook || m.charge > 0.5;
        this._resolveHit({ reach: C().punchReach, damage: C().punchDamage * (p.hook ? K.damage : 1) * m.damage,
          knock: (p.hook ? K.knock : 1) * m.knock, sound: heavy ? 'punchHeavy' : 'punch', source: 'fist' });
      }
      if (u >= 1) { this.punch = null; this.cooldown = C().punchCooldown; }
    }

    // Guard: fists low in the corners; a jab drives one forward towards the crosshair.
    // With a weapon in hand the fists stay out of sight.
    for (const side of [1, -1]) {
      const g = this.fists[side];
      g.visible = this.raise > 0.02 && !this.held;
      const j = jab[side];
      const drop = (1 - this.raise) * 0.35;
      const hookArc = this.punch?.hook && this.punch.side === side ? Math.sin(j * Math.PI) * 0.12 : 0;
      g.position.set(-side * (0.19 - 0.15 * j + hookArc), -0.22 - drop + 0.1 * j, -0.4 - 0.3 * j);
      g.rotation.set(0.15 - 0.1 * j, side * 0.15 * (1 - j), 0);
      // Winding up: the punching fist drawn back and down, trembling when it's all the way
      if (charge > 0 && !this.held && !this.grabbing && side === this.nextSide) {
        const k = ease(charge), tr = charge >= 1 ? 0.004 : 0;
        g.position.add(new THREE.Vector3(-side * 0.05 * k + (Math.random() - 0.5) * tr, -0.06 * k + (Math.random() - 0.5) * tr, 0.14 * k));
        g.rotation.x -= 0.3 * k;
      }
      // Holding someone: both fists out in front, gripping (and drawn back, winding up a shove)
      if (this.grabbing) {
        const k = ease(charge);
        g.position.lerp(new THREE.Vector3(-side * 0.13, -0.17, -0.5 + 0.12 * k), 0.85);
        g.rotation.x += 0.5;
      }
      // Block: both fists come up in front of the face
      const b = this.block;
      if (b > 0) {
        g.position.lerp(new THREE.Vector3(-side * 0.09, -0.06, -0.3), b);
        g.rotation.x += 0.9 * b;
        g.rotation.z += side * 0.35 * b;
      }
    }

    if (this.held) this._updateHeld(dt);
    this._updateKick(dt);
    this._updateThrown(dt);
    this.realArms?.update(this.fists, this.leg);
  }

  /** Kick: the leg swings up from below into view, foot first, and back down. */
  _updateKick(dt) {
    const K = C().kick;
    if (!this.kick) { this.leg.visible = false; return; }
    const k = this.kick;
    k.t += dt;
    const u = Math.min(1, k.t / (K.time * k.mult.slow));
    const out = Math.sin(u * Math.PI); // 0 -> 1 -> 0
    this.leg.visible = true;
    this.leg.position.set(0.08, -1.05 + 0.6 * out, -0.25 - 0.45 * out);
    this.leg.rotation.set(-0.3 - 1.25 * out, 0, 0);
    if (!k.hitDone && u >= K.hitAt) {
      k.hitDone = true;
      this._resolveHit({ reach: K.reach, damage: K.damage * k.mult.damage, knock: K.knock * k.mult.knock, sound: 'kick', source: 'kick' }, -0.25);
    }
    if (u >= 1) { this.kick = null; this.cooldown = K.cooldown; }
  }

  /**
   * Weapon animation. 'swing': a wide horizontal arc, wound up to the right, through the crosshair,
   * following through to the left. 'overhead': raised high, smashed down. Blocking holds the
   * weapon up across the view.
   */
  _updateHeld(dt) {
    const h = this.held, def = h.def, o = h.object;
    const rot = new THREE.Quaternion();
    const shift = new THREE.Vector3();
    if (this.swing) {
      const s = this.swing;
      s.t += dt;
      const m = s.mult ?? { damage: 1, knock: 1, slow: 1, charge: 0 };
      const u = s.t / (def.swingTime * C().swingTimeMul * m.slow);
      // A weapon with a swing sound (the bat) is heard coming round, hit or miss
      if (def.swingSound && !s.swished && u >= 0.25) { s.swished = true; this.sfx.swing(def.swingSound); }
      // k: 0 -> -1 (wind up) -> +1 (follow through) -> 0
      const k = u < 0.3 ? -ease(u / 0.3) : u < 0.62 ? -1 + 2 * ease((u - 0.3) / 0.32) : 1 - ease((u - 0.62) / 0.38);
      if (def.style === 'overhead') {
        // Raised high, then brought down (kept in view)
        const kk = k < 0 ? k : k * 0.55;
        rot.setFromEuler(new THREE.Euler(-1.1 * kk, 0.15 * kk, 0));
        shift.set(-0.08 * Math.abs(kk), -0.12 * kk, -0.12 * Math.max(0, kk));
      } else if (def.style === 'thrust') {
        shift.copy(v3(def.out).normalize()).multiplyScalar(0.4 * k);
      } else {
        // Keyframes: rest -> wound up over the right shoulder -> flat across the crosshair (the hit)
        // -> followed through to the left -> rest
        const keys = SWING_KEYS;
        const at = u < 0.3 ? [keys.rest, keys.wind, ease(u / 0.3)]
          : u < 0.46 ? [keys.wind, keys.hit, ease((u - 0.3) / 0.16)]
          : u < 0.62 ? [keys.hit, keys.follow, ease((u - 0.46) / 0.16)]
          : [keys.follow, keys.rest, ease((u - 0.62) / 0.38)];
        rot.copy(at[0].q).slerp(at[1].q, at[2]);
        shift.copy(at[0].p).lerp(at[1].p, at[2]);
      }
      if (!s.hitDone && u >= 0.46) { s.hitDone = true; this._resolveHit({ ...def, damage: def.damage * m.damage, knock: def.knock * m.knock, source: 'weapon' }); }
      if (u >= 1) { this.swing = null; this.cooldown = 0.06; }
    } else if (this.charging) {
      // Winding up: drawn back over the shoulder (or raised high), trembling when it's all the way
      const c = ease(this._chargeOf(this.charging.t)) * 0.9, tr = c >= 0.9 ? (Math.random() - 0.5) * 0.02 : 0;
      if (def.style === 'overhead') {
        rot.setFromEuler(new THREE.Euler(1.1 * c + tr, -0.15 * c, 0));
        shift.set(-0.08 * c, 0.12 * c, 0);
      } else if (def.style !== 'thrust') {
        rot.copy(SWING_KEYS.rest.q).slerp(SWING_KEYS.wind.q, c);
        shift.copy(SWING_KEYS.rest.p).lerp(SWING_KEYS.wind.p, c).addScalar(tr);
      }
    }
    // Block: the weapon comes up across the view
    if (this.block > 0) {
      const bq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5 * this.block, -0.9 * this.block, 1.1 * this.block));
      rot.slerp(bq, this.block);
      shift.lerp(new THREE.Vector3(-0.2, 0.15, 0.05), this.block);
    }
    // Rotate about the hand
    const at = v3(def.at);
    o.position.copy(h.basePos).sub(at).applyQuaternion(rot).add(at).add(shift);
    o.quaternion.copy(rot).multiply(h.baseQuat);
  }

  /** A held weapon that wears out (breaksAfter) falls apart after enough hits. */
  _wear() {
    const h = this.held;
    if (!h?.def.breaksAfter) return;
    h.hits = (h.hits ?? 0) + 1;
    if (h.hits < h.def.breaksAfter) return;
    this.held = null;
    this.swing = null;
    h.object.parent?.remove(h.object);
    h.object.userData.held = false;
    h.object.userData.broken = true;
    this.onBreak?.(h.def.breakLine);
  }

  /** Thrown things hurt whoever they fly into (once each), while they're moving fast. */
  _updateThrown(dt) {
    if (!this.thrown.length) return;
    const list = this.targets();
    for (const t of this.thrown) {
      t.t += dt;
      const v = t.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 3) continue;
      const p = t.body.translation();
      const at = new THREE.Vector3(p.x, p.y, p.z);
      for (const target of list) {
        if (t.hit.has(target) || target.down) continue;
        const chest = target.rig.joints.spine.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0));
        if (chest.distanceTo(at) < WP().throwHitRadius) {
          t.hit.add(target);
          const damage = t.def.damage * WP().throwDamage;
          target.takeHit(new THREE.Vector3(v.x, 0, v.z), { damage, knock: t.def.knock, source: 'thrown' });
          this.sfx.hit(t.def.sound, chest);
          impact(damage, target.down);
          this.onHit(target);
        }
      }
    }
    this.thrown = this.thrown.filter((t) => t.t < 2);
  }

  /** Enough punches landed (config.damage.knuckles): the player's own knuckles are bloody. */
  _knuckles() {
    this.punchesLanded = (this.punchesLanded ?? 0) + 1;
    const n = config.damage.knuckles;
    if (!n || this.punchesLanded !== n) return;
    if (this.realArms) return this.realArms.bloodyKnuckles();
    for (const side of [1, -1]) {
      const fist = this.fists[side].children[0];
      for (const x of [-0.022, 0, 0.022]) {
        const scuff = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), theme.material('knuckleBlood'));
        scuff.scale.set(1.3, 0.8, 0.6);
        scuff.position.set(x + (Math.random() - 0.5) * 0.008, 0.024, -0.044);
        fist.add(scuff);
      }
    }
  }

  /** Does a blow (fist or weapon) connect with someone under the crosshair? */
  _resolveHit({ reach, damage, knock, sound, source, hitStop = null }, aimY = 0) {
    const cam = this.camera;
    const list = this.targets();
    const roots = list.map((t) => t.rig.root);
    this.raycaster.far = reach;
    // A few rays around the crosshair, so a swing doesn't need pixel-perfect aim
    let hit = null;
    for (const [x, y] of [[0, 0], [0.12, 0], [-0.12, 0], [0, -0.12]]) {
      this.raycaster.setFromCamera(new THREE.Vector2(x, y + aimY), cam);
      const hits = this.raycaster.intersectObjects(roots, true);
      if (hits.length && (!hit || hits[0].distance < hit.distance)) hit = hits[0];
    }
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    // Glass in the way (nearer than anyone it would hit): it breaks
    const glass = this.breakables();
    if (glass.length) {
      let gHit = null;
      for (const [x, y] of [[0, 0], [0.12, 0], [-0.12, 0], [0, -0.12]]) {
        this.raycaster.setFromCamera(new THREE.Vector2(x, y + aimY), cam);
        const h = this.raycaster.intersectObjects(glass, false)[0];
        if (h && (!gHit || h.distance < gHit.distance)) gHit = h;
      }
      if (gHit && (!hit || gHit.distance < hit.distance)) {
        gHit.object.userData.onBreak?.(dir, gHit.point);
        this.player.shake = Math.max(this.player.shake, 0.2);
        this._wear();
        return;
      }
    }
    if (!hit) { if (!(source === 'weapon' && this.held?.def.swingSound)) this.sfx.whoosh(); return; } // (the bat swished already)
    const target = list.find((t) => t.rig.root === hit.object.userData.rigRoot);
    if (!target) return;
    if (target.down) {
      // Already down: no damage, but the body flops
      target.ragdoll?.push(dir, WP().floorFlop * knock, 'spine');
      this.sfx.bodyThud(hit.point, 0.6);
      this._wear();
      return;
    }
    target.takeHit(dir, { damage, knock, hit, source });
    if (source === 'fist') this._knuckles();
    this._wear();
    this.sfx.hit(sound, hit.point);
    this.player.shake = Math.max(this.player.shake, 0.25 + 0.1 * knock);
    impact(damage, target.down, hitStop); // (the freeze, longer the harder; slow motion if that put them down)
    this.onHit(target);
  }
}

// Horizontal swing keyframes (camera space): rotation about the hand, and a shift of the hand
const key = (x, y, z, px, py, pz) => ({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)), p: new THREE.Vector3(px, py, pz) });
const SWING_KEYS = {
  rest: key(0, 0, 0, 0, 0, 0),
  wind: key(-0.1, -0.7, -0.6, 0.16, 0.04, 0.04),
  hit: key(-0.2, 0.1, 1.35, -0.06, 0.27, -0.16),
  follow: key(-0.6, 1.0, 1.1, -0.32, 0.0, -0.04),
};

/** The object's bounding box in its own space. */
function localBox(o) {
  const parent = o.parent;
  const saved = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
  const tmp = new THREE.Group();
  tmp.add(o);
  o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
  tmp.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  parent.add(o);
  o.position.copy(saved.p); o.quaternion.copy(saved.q); o.scale.copy(saved.s);
  o.updateMatrixWorld(true);
  return box;
}

function localCentre(o) {
  return localBox(o).getCenter(new THREE.Vector3());
}
