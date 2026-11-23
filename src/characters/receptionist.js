import * as THREE from 'three';
import { config } from '../config.js';
import { theme, characterPalettes } from '../theme.js';
import { buildRig, solveTwoBone, aimJoint } from './rig.js';
import { Walker } from './walker.js';

/*
  The receptionist. Sits behind the desk playing solitaire.
  States: 'solitaire' (clicking, eyes on the CRT), 'look' (turned to the player, silent),
  'clock' (a glance over her shoulder at the wall clock),
  'clipboard' (slides the check-in sheet onto the counter without looking up, then
  goes back to solitaire by herself), 'sip' (a sip of coffee, once she has some).
  'coffeeBreak' walks her through the EMPLOYEES ONLY door and back with a cup (returns a
  Promise that resolves when she's seated again).
  The director drives her with play('lookAtPlayer' | 'glanceAtClock' | 'resumeSolitaire' |
  'slideClipboard' | 'coffeeBreak' | 'sipCoffee').
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
      proportions: config.characters.receptionist.proportions,
      skin: c.skin, hair: c.hair, hairStyle: 'bun', shirt: c.blouse, jacket: c.cardigan,
      trousers: c.skirt, shoes: c.shoes, glasses: c.glasses, eyes: c.eyes, lips: c.lips,
    });
    this.face = this.rig.face; // null unless the character style has an expressive face
    this.baseExpression = 'bored';
    this.face?.setExpression(this.baseExpression, 100);
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
    this.clockPos = anchors.clock.getWorldPosition(new THREE.Vector3());
    this.clockTwist = 0; // upper-body turn for glancing at the clock behind her

    this.state = 'solitaire';
    this.lookTarget = new THREE.Vector3();
    this.clickTimer = rand(...T.gap);
    this.pendingDouble = 0;
    this.press = 0;            // 0..1 hand dip for a click
    this.time = 0;
    this.mouseRest = this.mouse.position.clone();

    this.clipboard = anchors.clipboard;
    this.clipPath = anchors.clipboardPath;
    this.clipT = 0;

    // --- getting up (coffee run) ---
    this.seat = seat;
    this.seatRoot = root.position.clone();
    this.seatQuat = root.quaternion.clone();
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(seat.quaternion);
    this.chairYaw = Math.atan2(f.x, f.z);
    this.door = anchors.employeeDoor;
    this.doorAngle = 0;
    const self = this;
    this.walker = new Walker({
      rig: this.rig, sfx, face: this.face,
      seatRoot: this.seatRoot, seatQuat: this.seatQuat, chairYaw: this.chairYaw,
      frontOffset: 0.12, hipWidth: 1.8, shoulderWidth: 1.4,
      w: (x, y, z) => seat.localToWorld(new THREE.Vector3(x, y, z)),
      seatedFoot: (side) => seat.localToWorld(new THREE.Vector3(side * 0.17, 0, 0.42)),
      seatedHand: (side) => (side === 1 ? self._keyboardHand() : self._mouseHand()),
      expression: () => (self.cup.visible ? 'neutral' : 'bored'),
    });

    // --- the coffee cup she comes back with ---
    this.cup = new THREE.Group();
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 16), theme.material('coffeeCup'));
    this.cup.add(mug);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.038, 16), theme.material('coffee'));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.045;
    this.cup.add(coffee);
    this.cup.visible = false;
    scene.add(this.cup);
    // Where it lives on the desk: left of the keyboard
    const kbLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(seat.quaternion);
    this.cupRest = anchors.keyboard.getWorldPosition(new THREE.Vector3()).addScaledVector(kbLeft, 0.34).setY(0.81);
    this.cupInHand = false;
    this.sipT = 0;
  }

  _mouseHand() {
    return this.mouse.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
  }

  _keyboardHand() {
    const kb = this.keyboard.getWorldPosition(new THREE.Vector3());
    return kb.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.seatQuat), 0.12).add(new THREE.Vector3(0, 0.05, 0));
  }

  /** World position of her left hand (for carrying the cup). */
  _leftHand() {
    const len = config.characters.receptionist.proportions?.lowerArm?.len ?? config.characters.proportions.lowerArm.len;
    return this.rig.joints.lElbow.localToWorld(new THREE.Vector3(0, -len - 0.06, 0.02));
  }

  /** Get up, go through the EMPLOYEES ONLY door, come back with coffee, sit down. */
  _coffeeBreak() {
    const D = this.door;
    const C = config.timings.reception;
    return new Promise((resolve) => {
      this.state = 'solitaire';
      this.walker.start([
        { type: 'rise' },
        { type: 'walk', to: D.behindDesk },
        { type: 'walk', to: D.front },
        { type: 'walk', to: D.threshold },
        { type: 'walk', to: D.inside },
        { type: 'away', seconds: C.coffeeAway, onBack: () => { this.cup.visible = true; this.cupInHand = true; } },
        { type: 'walk', to: D.threshold },
        { type: 'walk', to: D.front },
        { type: 'walk', to: D.behindDesk },
        { type: 'walk', to: 'front' },
        { type: 'turn', yaw: 'chair' },
        { type: 'sit' },
      ], { onDone: () => { this.cupInHand = false; resolve(); } });
    });
  }

  /** Called by the director's 'anim' action. */
  play(name) {
    if (name === 'lookAtPlayer') { this.state = 'look'; this.face?.setExpression('unimpressed'); }
    else if (name === 'glanceAtClock') { this.state = 'clock'; this.face?.setExpression('unimpressed'); }
    else if (name === 'resumeSolitaire') { this.state = 'solitaire'; this.face?.setExpression(this.baseExpression); }
    else if (name === 'coffeeBreak') return this._coffeeBreak();
    else if (name === 'sipCoffee') { this.state = 'sip'; this.sipT = 0; }
    else if (name === 'slideClipboard') {
      this.state = 'clipboard';
      this.clipT = 0;
      this.clipSounded = false;
      this.clipHandHold = null;
    }
  }

  /** Director hooks: expression presets (config.characters.expressions) and mouth movement. */
  setExpression(name) {
    this.face?.setExpression(name);
  }

  setTalking(on) {
    this.face?.setTalking(on);
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

    // The EMPLOYEES ONLY door opens as she comes near it, and swings shut behind her
    if (this.door) {
      const near = this.walker.active && this.walker.pos.distanceTo(this.door.threshold) < 1.1;
      const goal = near ? this.door.openAngle : 0;
      this.doorAngle += (goal - this.doorAngle) * (1 - Math.exp(-(near ? 6 : 2.5) * dt));
      this.door.pivot.rotation.y = this.doorAngle;
    }

    // Up and about: the walker does the whole pose
    if (this.walker.active) {
      this.walker.update(dt, { position: cameraPos });
      if (this.cupInHand) this.cup.position.copy(this._leftHand());
      return;
    }
    if (this.cup.visible && this.state !== 'sip') this.cup.position.copy(this.cupRest);

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

    // --- the check-in sheet: reach, lift onto the counter, shove, back to the keyboard ---
    let engage = 0, clipHand = null;
    if (this.state === 'clipboard') {
      this.clipT += dt;
      const u = Math.min(1, this.clipT / config.timings.reception.clipboardSlide);
      const P = this.clipPath;
      const smooth = (x) => x * x * (3 - 2 * x);
      const pos = new THREE.Vector3();
      if (u < 0.25) {
        pos.copy(P.start);
      } else if (u < 0.55) {
        const k = smooth((u - 0.25) / 0.3);
        pos.lerpVectors(P.start, P.lift, k);
        pos.y += Math.sin(k * Math.PI) * 0.06;
        this.clipboard.rotation.y = 0.15 * (1 - k);
      } else if (u < 0.7) {
        const k = 1 - Math.pow(1 - (u - 0.55) / 0.15, 3); // shoved: fast, then coasting
        pos.lerpVectors(P.lift, P.end, k);
        if (!this.clipSounded) { this.clipSounded = true; this.sfx.paperSlide(P.lift); }
      } else {
        pos.copy(P.end);
      }
      this.clipboard.position.copy(pos);
      // Her hand rides on the clip end until the shove, then lets go
      const onClip = pos.clone().add(new THREE.Vector3(0, 0.035, -0.12));
      if (u < 0.6) clipHand = onClip;
      else clipHand = this.clipHandHold ??= onClip;
      engage = u < 0.25 ? smooth(u / 0.25) : u < 0.7 ? 1 : 1 - smooth((u - 0.7) / 0.3);
      if (u >= 1) this.state = 'solitaire';
    }

    // --- body: lean towards the desk, breathe (and lean further to reach the counter) ---
    const breathe = Math.sin(this.time * 1.6) * 0.01;
    // The wall clock is behind her left shoulder: twist the upper body to see it
    const twistGoal = this.state === 'clock' ? config.characters.receptionist.clockGlanceTwist : 0;
    this.clockTwist += (twistGoal - this.clockTwist) * (1 - Math.exp(-6 * dt));
    j.spine.rotation.set(0.12 + breathe + 0.35 * engage, 0.3 * engage + this.clockTwist, 0);

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
    if (clipHand) handOnKeys.lerp(clipHand, engage);
    // A sip of coffee: left hand to the cup, cup to the mouth, back down, back to the keys
    let sipping = 0;
    if (this.state === 'sip') {
      this.sipT += dt;
      const u = Math.min(1, this.sipT / config.timings.reception.coffeeSip);
      const ease = (x) => x * x * (3 - 2 * x);
      const toCup = ease(Math.min(1, u / 0.2)) * (1 - ease(Math.max(0, (u - 0.85) / 0.15)));
      const lift = Math.sin(Math.min(1, Math.max(0, (u - 0.2) / 0.6)) * Math.PI);
      const mouth = this.voicePosition().add(new THREE.Vector3(0, -0.2, 0)).addScaledVector(fwd, 0.16);
      const cupPos = this.cupRest.clone().lerp(mouth, lift);
      handOnKeys.lerp(cupPos.clone().add(new THREE.Vector3(0, 0.01, 0)), toCup);
      this.cup.position.copy(cupPos);
      this.cup.rotation.x = -0.6 * lift; // tipped towards her
      sipping = lift;
      if (u >= 1) { this.state = 'solitaire'; this.cup.rotation.x = 0; }
    }
    solveTwoBone(j.lShoulder, j.lElbow, handOnKeys, L.upperArm, L.lowerArm,
      new THREE.Vector3(0.6, -0.4, -1).applyQuaternion(this.root.quaternion));

    // --- head: the screen, or the player ---
    const turn = 1 - Math.exp(-config.characters.receptionist.headTurnSpeed * dt);
    if (this.state === 'look' && cameraPos) {
      aimJoint(j.neck, cameraPos, { maxYaw: 1.1, maxPitch: 0.5, alpha: turn });
      this.face?.lookAt(cameraPos);
    } else if (this.state === 'sip') {
      // Over the rim of the cup, still at the screen; head tips back as she drinks
      const s = this.screen.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5 * sipping, 0));
      aimJoint(j.neck, s, { maxYaw: 1.1, maxPitch: 0.6, alpha: turn });
      this.face?.lookAt(s);
    } else if (this.state === 'clock') {
      aimJoint(j.neck, this.clockPos, { maxYaw: 1.6, maxPitch: 0.6, alpha: turn * 1.5 });
      this.face?.lookAt(this.clockPos);
    } else {
      const s = this.screen.getWorldPosition(new THREE.Vector3());
      s.x += Math.sin(this.time * 0.37) * 0.04; // eyes wander over the tableau
      aimJoint(j.neck, s, { maxYaw: 1.1, maxPitch: 0.5, alpha: turn });
      this.face?.lookAt(s);
    }
    this.face?.update(dt);
  }
}
