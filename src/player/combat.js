import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';
import { partGeometry } from '../characters/partShapes.js';

/*
  The player's fists (first draft: punching only).
  Hidden until `enabled` (the player can't bring themselves to fight back at first);
  then both fists come up into view and left-click jabs, alternating hands.
  A punch hits the first character within reach under the crosshair: target.takeHit(dir).
  Milestone 4 adds kicks, weapons and damage.
*/

const C = () => config.combat;

export class Combat {
  /**
   * @param targets () => [{ rig: { root }, takeHit(dir) }]  characters that can be punched
   */
  constructor({ camera, player, sfx, targets }) {
    this.camera = camera;
    this.player = player;
    this.sfx = sfx;
    this.targets = targets;
    this.enabled = false;
    this.raise = 0;      // 0 = fists down out of view, 1 = up in guard
    this.punch = null;   // { t, side, hitDone }
    this.cooldown = 0;
    this.nextSide = -1;  // right hand first
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

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled || !this.player.canAct || this.player.seat) return;
      if (this.punch || this.cooldown > 0) return;
      this.punch = { t: 0, side: this.nextSide, hitDone: false };
      this.nextSide = -this.nextSide;
    });
  }

  update(dt) {
    this.raise += ((this.enabled && !this.player.seat ? 1 : 0) - this.raise) * (1 - Math.exp(-6 * dt));
    this.cooldown = Math.max(0, this.cooldown - dt);

    let jab = { 1: 0, [-1]: 0 };
    if (this.punch) {
      const p = this.punch;
      p.t += dt;
      const u = p.t / C().punchTime;
      jab[p.side] = Math.sin(Math.min(1, u) * Math.PI);
      if (!p.hitDone && u >= C().punchHitAt) { p.hitDone = true; this._resolveHit(); }
      if (u >= 1) { this.punch = null; this.cooldown = C().punchCooldown; }
    }

    // Guard: fists low in the corners; a jab drives one forward towards the crosshair
    for (const side of [1, -1]) {
      const g = this.fists[side];
      g.visible = this.raise > 0.02;
      const j = jab[side];
      const drop = (1 - this.raise) * 0.35;
      g.position.set(-side * (0.19 - 0.15 * j), -0.22 - drop + 0.1 * j, -0.4 - 0.3 * j);
      g.rotation.set(0.15 - 0.1 * j, side * 0.15 * (1 - j), 0);
    }
  }

  _resolveHit() {
    const cam = this.camera;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), cam);
    this.raycaster.far = C().punchReach;
    const list = this.targets();
    const roots = list.map((t) => t.rig.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    if (!hits.length) { this.sfx.whoosh(); return; }
    const root = hits[0].object.userData.rigRoot;
    const target = list.find((t) => t.rig.root === root);
    if (!target) return;
    target.takeHit(dir);
    this.sfx.hit('punch', hits[0].point);
    this.player.shake = Math.max(this.player.shake, 0.25);
  }
}
