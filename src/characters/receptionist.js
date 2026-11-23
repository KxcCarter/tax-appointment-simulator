import * as THREE from 'three';
import { config } from '../config.js';
import { characterPalettes } from '../theme.js';
import { buildRig, solveTwoBone, aimJoint } from './rig.js';

/*
  The receptionist. Sits behind the desk playing solitaire.
  States: 'solitaire' (clicking, eyes on the CRT) and 'look' (turned to the player, silent).
  The director drives her with play('lookAtPlayer') / play('resumeSolitaire').
  She clicks the mouse on her own schedule (config.timings.receptionistClicks),
  and keeps doing so no matter what happens around her.
*/

const T = config.timings.receptionistClicks;
const rand = (a, b) => a + Math.random() * (b - a);

export class Receptionist {
  constructor(scene, anchors, sfx) {
    this.sfx = sfx;
    const c = characterPalettes.receptionist;
    this.rig = buildRig({
      scale: config.characters.receptionist.scale,
      skin: c.skin, hair: c.hair, hairStyle: 'bun', shirt: c.blouse, jacket: c.cardigan,
      trousers: c.skirt, shoes: c.shoes, glasses: c.glasses,
    });
    const seat = anchors.receptionistSeat; // office chair group, faces +z
    const root = this.rig.root;
    root.position.copy(seat.position);
    root.quaternion.copy(seat.quaternion);
    scene.add(root);
    this.root = root;

    // Seat her: pelvis rests on the seat surface
    const seatTop = anchors.receptionistSeatTop;
    const pelvis = this.rig.joints.pelvis;
    root.updateMatrixWorld(true);
    const pelvisWorldY = pelvis.getWorldPosition(new THREE.Vector3()).y;
    root.position.y += seatTop + this.rig.seatOffset - pelvisWorldY;

    this.mouse = anchors.mouse;
    this.keyboard = anchors.keyboard;
    this.screen = anchors.crtScreen;

    this.state = 'solitaire';
    this.lookTarget = new THREE.Vector3();
    this.clickTimer = rand(...T.gap);
    this.pendingDouble = 0;
    this.press = 0;            // 0..1 hand dip for a click
    this.time = 0;
    this.mouseRest = this.mouse.position.clone();
  }

  /** Called by the director's 'anim' action. */
  play(name) {
    if (name === 'lookAtPlayer') this.state = 'look';
    else if (name === 'resumeSolitaire') this.state = 'solitaire';
  }

  /** Where her voice comes from. */
  voicePosition() {
    return this.rig.joints.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0));
  }

  _click() {
    this.press = 1;
    this.sfx.mouseClick(this.mouse.getWorldPosition(new THREE.Vector3()));
  }

  update(dt, cameraPos) {
    this.time += dt;
    const j = this.rig.joints;
    const L = this.rig.lengths;

    // --- clicking schedule (only while playing) ---
    if (this.state === 'solitaire') {
      if (this.pendingDouble > 0) {
        this.pendingDouble -= dt;
        if (this.pendingDouble <= 0) this._click();
      }
      this.clickTimer -= dt;
      if (this.clickTimer <= 0) {
        this._click();
        if (Math.random() < T.doubleClickChance) this.pendingDouble = T.doubleClickGap;
        this.clickTimer = Math.random() < T.longPauseChance ? rand(...T.longPause) : rand(...T.gap);
        // Nudge the mouse a little, as one does between moves
        this.mouse.position.x = this.mouseRest.x + rand(-0.025, 0.025);
        this.mouse.position.z = this.mouseRest.z + rand(-0.02, 0.02);
      }
    }
    this.press = Math.max(0, this.press - dt * 12);

    // --- body: lean towards the desk, breathe ---
    const breathe = Math.sin(this.time * 1.6) * 0.01;
    j.spine.rotation.set(0.12 + breathe, 0, 0);

    // --- legs: feet flat on the floor in front of the chair ---
    this.root.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const pole = fwd.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize();
    for (const [hip, knee] of [[j.lHip, j.lKnee], [j.rHip, j.rKnee]]) {
      const hipPos = hip.getWorldPosition(new THREE.Vector3());
      const foot = hipPos.clone().addScaledVector(fwd, 0.4);
      foot.y = 0;
      solveTwoBone(hip, knee, foot, L.upperLeg, L.lowerLeg, pole);
    }

    // --- right hand on the mouse, left hand resting on the keyboard ---
    j.spine.updateMatrixWorld(true);
    const handOnMouse = this.mouse.getWorldPosition(new THREE.Vector3());
    handOnMouse.y += 0.05 - this.press * 0.012;
    solveTwoBone(j.rShoulder, j.rElbow, handOnMouse, L.upperArm, L.lowerArm,
      new THREE.Vector3(-0.6, -0.4, -1).applyQuaternion(this.root.quaternion));
    const kb = this.keyboard.getWorldPosition(new THREE.Vector3());
    const handOnKeys = kb.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion), 0.12);
    handOnKeys.y += 0.05;
    solveTwoBone(j.lShoulder, j.lElbow, handOnKeys, L.upperArm, L.lowerArm,
      new THREE.Vector3(0.6, -0.4, -1).applyQuaternion(this.root.quaternion));

    // --- head: the screen, or the player ---
    const turn = 1 - Math.exp(-config.characters.receptionist.headTurnSpeed * dt);
    if (this.state === 'look' && cameraPos) {
      aimJoint(j.neck, cameraPos, { maxYaw: 1.1, maxPitch: 0.5, alpha: turn });
    } else {
      const s = this.screen.getWorldPosition(new THREE.Vector3());
      s.x += Math.sin(this.time * 0.37) * 0.04; // eyes wander over the tableau
      aimJoint(j.neck, s, { maxYaw: 1.1, maxPitch: 0.5, alpha: turn });
    }
  }
}
