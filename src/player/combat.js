import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';
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
  constructor({ camera, player, sfx, targets, onHit, physics, scene }) {
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

    // Right click (or F) kicks
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    const tryKick = () => {
      if (!this.enabled || !this.player.canAct || this.player.seat) return;
      if (this.kick || this.swing || this.punch || this.cooldown > 0) return;
      this.kick = { t: 0, hitDone: false };
    };
    document.addEventListener('mousedown', (e) => { if (e.button === 2) tryKick(); });
    document.addEventListener('keydown', (e) => { if (e.code === 'KeyF' && !e.repeat) tryKick(); });

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled || !this.player.canAct || this.player.seat) return;
      if (this.punch || this.swing || this.kick || this.cooldown > 0) return;
      if (this.held) {
        this.swing = { t: 0, hitDone: false };
      } else {
        // Chain: quick punches build a combo; every few, a harder hook
        const now = performance.now() / 1000;
        this.combo = now - (this.lastPunch ?? -9) < C().combo.window ? (this.combo ?? 0) + 1 : 1;
        this.lastPunch = now;
        const hook = this.combo % C().combo.every === 0;
        this.punch = { t: 0, side: this.nextSide, hitDone: false, hook };
        this.nextSide = -this.nextSide;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ' && this.held && this.player.canAct) this.drop(true);
    });
  }

  /** Can the player pick something up right now? */
  get canPickUp() {
    return this.enabled && !this.player.seat && !this.swing;
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

    const jab = { 1: 0, [-1]: 0 };
    if (this.punch) {
      const p = this.punch;
      p.t += dt;
      const u = p.t / C().punchTime;
      jab[p.side] = Math.sin(Math.min(1, u) * Math.PI);
      if (!p.hitDone && u >= C().punchHitAt) {
        p.hitDone = true;
        const K = C().combo;
        this._resolveHit(p.hook
          ? { reach: C().punchReach, damage: C().punchDamage * K.damage, knock: K.knock, sound: 'kick' }
          : { reach: C().punchReach, damage: C().punchDamage, knock: 1, sound: 'punch' });
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
    }

    if (this.held) this._updateHeld(dt);
    this._updateKick(dt);
    this._updateThrown(dt);
  }

  /** Kick: the leg swings up from below into view, foot first, and back down. */
  _updateKick(dt) {
    const K = C().kick;
    if (!this.kick) { this.leg.visible = false; return; }
    const k = this.kick;
    k.t += dt;
    const u = Math.min(1, k.t / K.time);
    const out = Math.sin(u * Math.PI); // 0 -> 1 -> 0
    this.leg.visible = true;
    this.leg.position.set(0.08, -1.05 + 0.6 * out, -0.25 - 0.45 * out);
    this.leg.rotation.set(-0.3 - 1.25 * out, 0, 0);
    if (!k.hitDone && u >= K.hitAt) {
      k.hitDone = true;
      this._resolveHit({ reach: K.reach, damage: K.damage, knock: K.knock, sound: 'kick' }, -0.25);
    }
    if (u >= 1) { this.kick = null; this.cooldown = K.cooldown; }
  }

  /** Swing animation for the held weapon: wind up, strike through the crosshair, recover. */
  _updateHeld(dt) {
    const h = this.held, def = h.def, o = h.object;
    const rot = new THREE.Quaternion();
    let push = 0;
    if (this.swing) {
      const s = this.swing;
      s.t += dt;
      const u = s.t / def.swingTime;
      const ease = (x) => x * x * (3 - 2 * x);
      // Profile: 0 -> wind up (-1) -> strike through (+1.2) -> back to 0
      const k = u < 0.35 ? -ease(u / 0.35) : u < 0.55 ? -1 + 2.2 * ease((u - 0.35) / 0.2) : 1.2 * (1 - ease((u - 0.55) / 0.45));
      if (def.style === 'thrust') push = k;
      else rot.setFromEuler(new THREE.Euler(-0.9 * k, 0.5 * k, 0.6 * k));
      if (!s.hitDone && u >= 0.5) { s.hitDone = true; this._resolveHit(def); }
      if (u >= 1) { this.swing = null; this.cooldown = 0.08; }
    }
    // Rotate about the hand, or jab along the weapon's direction
    const at = v3(def.at);
    o.position.copy(h.basePos).sub(at).applyQuaternion(rot).add(at)
      .addScaledVector(v3(def.out).normalize(), 0.35 * push);
    o.quaternion.copy(rot).multiply(h.baseQuat);
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
        if (t.hit.has(target)) continue;
        const chest = target.rig.joints.spine.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0));
        if (chest.distanceTo(at) < WP().throwHitRadius) {
          t.hit.add(target);
          target.takeHit(new THREE.Vector3(v.x, 0, v.z), { damage: t.def.damage * WP().throwDamage, knock: t.def.knock });
          this.sfx.hit(t.def.sound, chest);
          this.onHit(target);
        }
      }
    }
    this.thrown = this.thrown.filter((t) => t.t < 2);
  }

  /** Does a blow (fist or weapon) connect with someone under the crosshair? */
  _resolveHit({ reach, damage, knock, sound }, aimY = 0) {
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
    if (!hit) { this.sfx.whoosh(); return; }
    const target = list.find((t) => t.rig.root === hit.object.userData.rigRoot);
    if (!target) return;
    target.takeHit(dir, { damage, knock });
    this.sfx.hit(sound, hit.point);
    this.player.shake = Math.max(this.player.shake, 0.25 + 0.1 * knock);
    this.onHit(target);
  }
}

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
