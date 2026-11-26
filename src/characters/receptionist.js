import * as THREE from 'three';
import { bloodSpray } from '../effects/blood.js';
import { config } from '../config.js';
import { theme, characterPalettes } from '../theme.js';
import { buildRig, solveTwoBone, aimJoint } from './rig.js';
import { Walker } from './walker.js';
import { realBodyFor } from './realBody.js';
import { Ragdoll } from './ragdoll.js';
import { Damage } from './damage.js';
import { RealDamage } from './realDamage.js';

/*
  The receptionist. Sits behind the desk playing solitaire.
  States: 'solitaire' (clicking, eyes on the CRT), 'look' (turned to the player, silent),
  'clock' (a glance over her shoulder at the wall clock),
  'point' (points over her left shoulder at the WALK-IN GUESTS sign, eyes still on her game),
  'clipboard' (slides the check-in sheet onto the counter without looking up, then
  goes back to solitaire by herself), 'sip' (a sip of coffee, once she has some).
  'coffeeBreak' walks her through the EMPLOYEES ONLY door and back with a cup (returns a
  Promise that resolves when she's seated again).
  The director drives her with play('lookAtPlayer' | 'glanceAtClock' | 'pointAtSign' | 'pointAtPoster' | 'resumeSolitaire' |
  'slideClipboard' | 'coffeeBreak' | 'sipCoffee').
  She clicks the mouse on her own schedule (config.timings.receptionistClicks),
  and keeps doing so no matter what happens around her.
*/

const T = config.timings.receptionistClicks;
const rand = (a, b) => a + Math.random() * (b - a);

export class Receptionist {
  constructor(scene, anchors, sfx, physics = null) {
    this.sfx = sfx;
    this.physics = physics;
    const c = characterPalettes.receptionist;
    this.rig = buildRig({
      scale: config.characters.receptionist.scale,
      proportions: config.characters.receptionist.proportions,
      skin: c.skin, hair: c.hair, hairStyle: 'bun', shirt: c.blouse, jacket: c.cardigan,
      trousers: c.skirt, shoes: c.shoes, glasses: c.glasses, eyes: c.eyes, lips: c.lips,
      badge: c.badge, // her name badge (the realistic model gets its own: realExtras.js)
    });
    this.face = this.rig.face; // null unless the character style has an expressive face
    this.baseExpression = 'bored';
    this.face?.setExpression(this.baseExpression, 100);
    const seat = anchors.receptionistSeat; // office chair group, faces +z
    const root = this.rig.root;
    root.position.copy(seat.position);
    root.quaternion.copy(seat.quaternion);
    this.realBody = realBodyFor('receptionist', this.rig, characterPalettes.receptionist); // experiment: realistic body (theme.look.realistic)
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
    this.signPos = anchors.walkInSign?.getWorldPosition(new THREE.Vector3()) ?? null;
    this.posterPos = anchors.poster?.getWorldPosition(new THREE.Vector3()) ?? null; // the PATIENCE poster (west wall)
    this.pointAt = this.signPos; // what she's pointing at ('pointAtSign' / 'pointAtPoster')
    this.pointAmt = 0; // 0 = left hand on the keys, 1 = arm out at the sign

    this.state = 'solitaire';
    this.lookTarget = new THREE.Vector3();
    this.clickTimer = rand(...T.gap);
    this.pendingDouble = 0;
    this.press = 0;            // 0..1 hand dip for a click
    this.time = 0;
    // Hit with the fire extinguisher (the only thing that can: config.brawl.receptionistHit): marks, and down she goes
    this.down = false;
    this.health = config.brawl.receptionistHit.health;
    this.id = 'receptionist';
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
      expression: () => self.scripted ?? (self.cup.visible ? 'neutral' : 'bored'),
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

    // --- her cellphone (in her pocket until she films the player) ---
    this.phone = new THREE.Group();
    this.phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.012), theme.material('phoneBody')));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.063, 0.125), theme.material('phoneScreen'));
    screen.position.z = -0.007; // facing her: the camera side faces the player
    screen.rotation.y = Math.PI;
    this.phone.add(screen);
    this.phone.visible = false;
    scene.add(this.phone);
    this.filming = null; // the step list while she's up filming
  }

  _mouseHand() {
    return this.mouse.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
  }

  _keyboardHand() {
    // Where the keyboard was: if someone runs off with it, she types on the desk anyway
    this.kbRest ??= this.keyboard.getWorldPosition(new THREE.Vector3());
    const kb = this.kbRest.clone();
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
    this.onBreak = true; // (out of the room: the level lets the player get on with other things)
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
      ], { onDone: () => { this.cupInHand = false; this.onBreak = false; resolve(); } });
    });
  }

  /** World position of her right hand. */
  _rightHand() {
    const len = config.characters.receptionist.proportions?.lowerArm?.len ?? config.characters.proportions.lowerArm.len;
    return this.rig.joints.rElbow.localToWorld(new THREE.Vector3(0, -len - 0.06, 0.02));
  }

  /**
   * Stand up, take her phone out of her pocket and film the player (and keep filming).
   * Resolves once the phone is up.
   */
  _filmPlayer() {
    if (this.filming) return Promise.resolve();
    const C = config.timings.reception;
    const target = () => (this.cameraPos ? this.cameraPos.clone() : this.rig.root.position.clone());
    return new Promise((resolve) => {
      this.state = 'solitaire';
      const pocket = { type: 'hold', seconds: C.phoneOut, pose: 'pocket', target };
      const film = { type: 'hold', seconds: Infinity, pose: 'film', target, until: () => { resolve(); return false; } };
      this.filming = { pocket, film };
      this.walker.start([{ type: 'rise' }, pocket, film]);
    });
  }

  /**
   * The brawl (every frame): filming it, bouncing with excitement, and now and then walking (still
   * filming) to a better spot behind the counter. Returns true when she sets off (the level has her
   * say something about it).
   */
  filmBrawl(dt) {
    const R = config.brawl.receptionist;
    if (!this.filming) { this._filmPlayer(); return false; }
    const F = this.filming, step = this.walker.current;
    if (!F.excited) { F.excited = true; F.film.pose = 'filmBounce'; F.film.rate = R.bounceRate / 2; this.moveT = R.moveEvery[0]; }
    if (step !== F.film) return false; // (still getting her phone out, or on her way)
    this.moveT = (this.moveT ?? R.moveEvery[0]) - dt;
    if (this.moveT > 0) return false;
    this.moveT = R.moveEvery[0] + Math.random() * (R.moveEvery[1] - R.moveEvery[0]);
    // Somewhere else along the counter (not where she is)
    const here = this.walker.pos;
    const spots = R.spots.map(([x, z]) => new THREE.Vector3(x, 0, z)).filter((p) => p.distanceTo(here) > 0.5);
    const to = spots[Math.floor(Math.random() * spots.length)];
    if (!to) return false;
    const target = () => (this.cameraPos ? this.cameraPos.clone() : this.rig.root.position.clone());
    const film = { type: 'hold', seconds: Infinity, pose: 'filmBounce', rate: R.bounceRate / 2, target, until: () => false };
    F.film = film;
    this.walker.start([{ type: 'walk', to, pose: 'film', look: target, phone: true, pushThrough: true }, film]);
    return true;
  }

  /** Done filming: back to her chair, sit down, and watch it back on her phone (state 'phone'). */
  _backToPhone() {
    this.filming = null;
    const settle = () => { this.state = 'phone'; this.phoneT = 0; };
    if (!this.walker.active) { settle(); return Promise.resolve(); }
    return new Promise((resolve) => {
      this.walker.start([
        { type: 'walk', to: 'front', pushThrough: true },
        { type: 'turn', yaw: 'chair' },
        { type: 'sit' },
      ], { onDone: () => { settle(); resolve(); } });
    });
  }

  /** Called by the director's 'anim' action. */
  play(name) {
    if (this.down) return; // (out cold)
    // An expression set by the script ({ do: 'face' }) wins over the one each animation would pick
    const face = (auto) => this.face?.setExpression(this.scripted ?? auto);
    if (name === 'lookAtPlayer') { this.state = 'look'; face('unimpressed'); }
    else if (name === 'glanceAtClock') { this.state = 'clock'; face('unimpressed'); }
    else if (name === 'pointAtSign') { if (this.signPos) { this.pointAt = this.signPos; this.state = 'point'; } }
    else if (name === 'pointAtPoster') { if (this.posterPos) { this.pointAt = this.posterPos; this.state = 'point'; } } // "Read that sign." (PATIENCE)
    else if (name === 'resumeSolitaire') { this.state = 'solitaire'; face(this.baseExpression); this.phone.visible = !!this.filming; }
    else if (name === 'phoneCall') { this.state = 'call'; this.callT = 0; face('pleased'); } // her cellphone to her ear (a call from her cousin)
    else if (name === 'hangUp') { this.state = 'solitaire'; this.phone.visible = false; face(this.baseExpression); }
    else if (name === 'coffeeBreak') return this._coffeeBreak();
    else if (name === 'filmPlayer') return this._filmPlayer();
    else if (name === 'backToPhone') return this._backToPhone();
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
    // Set by the script: holds through her animations until the script changes it.
    // 'default' hands her face back to the animations (bored at solitaire, unimpressed when she looks up).
    this.scripted = name === 'default' ? null : name;
    const auto = this.state === 'look' || this.state === 'clock' ? 'unimpressed' : this.baseExpression;
    this.face?.setExpression(this.scripted ?? auto);
  }

  setTalking(on) {
    this.face?.setTalking(on);
  }

  /** Where her voice comes from. */
  /**
   * Hit (only ever with the fire extinguisher: the level only lists her as a target while the player holds one).
   * Bruises and cuts like everyone else's; at 0 health she drops into a ragdoll, wherever she was.
   */
  takeHit(dir, { damage = 0, knock = 1, hit = null, source = 'weapon' } = {}) {
    if (this.down) return;
    if (!this.damage && this.physics) {
      const c = characterPalettes.receptionist;
      const look = { skin: c.skin, shirt: c.blouse, jacket: c.cardigan, trousers: c.skirt };
      this.damage = this.realBody?.ok
        ? new RealDamage({ realBody: this.realBody, rig: this.rig, look, physics: this.physics, scene: this.rig.root.parent })
        : new Damage({ rig: this.rig, look, physics: this.physics, scene: this.rig.root.parent });
    }
    if (damage > 0) this.damage?.add({ hit, dir, knock, source });
    if (damage > 0) bloodSpray(hit?.point ?? this.rig.parts.head?.getWorldPosition(new THREE.Vector3()), dir, { damage, source });
    this.health -= damage;
    this.face?.setExpression('surprised', 3);
    if (this.health <= 0) this._knockDown(dir, knock);
  }

  _knockDown(dir, knock = 1) {
    this.down = true;
    this.state = 'down';
    if (this.walker) this.walker.steps = null; // (whatever she was doing: filming, walking to a better angle...)
    this.filming = null;
    this.rig.root.updateMatrixWorld(true);
    this.ragdoll = new Ragdoll(this.physics, this.rig);
    this.ragdoll.push(dir, config.ragdoll.hitImpulse * knock);
    this.face?.setExpression({ lids: 1, brows: { angle: 0.2 }, mouth: { open: 0.35, width: 0.8 } }, 6);
    this.onKnockedDown?.(this);
  }

  /**
   * The next round (the player lost and wakes up in a chair: config.brawl.failure): back in her chair at her game,
   * as if nothing happened (owner). Out cold from the fire extinguisher: she comes round; her marks heal if
   * config.damage.healOnRetry. (She starts filming again when the brawl does.)
   */
  resetToSeat() {
    if (this.ragdoll) { this.ragdoll.dispose(); this.ragdoll = null; }
    if (config.damage.healOnRetry) this.damage?.heal();
    this.down = false;
    this.health = config.brawl.receptionistHit.health;
    this.walker.steps = null;
    this.filming = null;
    this.cupInHand = false;
    this.phone.visible = false;
    this.root.position.copy(this.seatRoot);
    this.root.quaternion.copy(this.seatQuat);
    this.rig.root.visible = true;
    this.state = 'solitaire';
    this.face?.setExpression(this.baseExpression, 100);
  }

  voicePosition() {
    return this.rig.joints.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0));
  }

  _click() {
    this.press = 1;
    this.sfx.mouseClick(this.mouse.getWorldPosition(new THREE.Vector3()));
  }

  update(dt, cameraPos) {
    if (this.down) { this.ragdoll?.update(dt, (pos, strength) => this.sfx.bodyThud(pos, strength)); this.face?.update(dt); return; }
    this._update(dt, cameraPos);
    this.rig.jiggle(dt); // her belly, chest and double chin wobble (config.characters.jiggle)
  }

  _update(dt, cameraPos) {
    this.time += dt;
    const j = this.rig.joints;
    const L = this.rig.lengths;

    // The EMPLOYEES ONLY door opens as she comes near it, and swings shut behind her
    if (this.door) {
      const near = (this.walker.active && this.walker.pos.distanceTo(this.door.threshold) < 1.1) || !!this.door.playerNear?.();
      const goal = near ? this.door.openAngle : 0;
      this.doorAngle += (goal - this.doorAngle) * (1 - Math.exp(-(near ? 6 : 2.5) * dt));
      this.door.pivot.rotation.y = this.doorAngle;
    }

    // Up and about: the walker does the whole pose
    this.cameraPos = cameraPos;
    if (this.walker.active) {
      this.walker.update(dt, { position: cameraPos });
      if (this.cupInHand) this.cup.position.copy(this._leftHand());
      // Her phone: out of the pocket at the end of reaching for it, then held up at the player
      const F = this.filming, step = this.walker.current;
      this.phone.visible = !!F && (step === F.film || step?.phone || (step === F.pocket && this.walker.t > config.timings.reception.phoneOut * 0.6));
      if (this.phone.visible) {
        this.phone.position.copy(this._rightHand()).add(this._leftHand()).multiplyScalar(0.5);
        if (step === F.film || step?.phone) this.phone.position.y += 0.05;
        this.phone.lookAt(this.cameraPos);
      }
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
    const R = config.characters.receptionist;
    const twistGoal = this.state === 'clock' ? R.clockGlanceTwist : this.state === 'point' ? (this.pointAt === this.signPos ? R.signPointTwist : 0) : 0; // (the poster's in front of her)
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
    // Watching it back on her phone: held in both hands in front of her chest, her thumb scrolling now and then
    let phoneAt = null;
    if (this.state === 'phone') {
      this.phoneT = (this.phoneT ?? 0) + dt;
      phoneAt = this.voicePosition().add(new THREE.Vector3(0, -0.5, 0)).addScaledVector(fwd, 0.3);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion); // her left
      const scroll = (this.phoneT % 4) < 0.5 ? Math.sin(((this.phoneT % 4) / 0.5) * Math.PI) * 0.015 : 0;
      handOnMouse.copy(phoneAt).addScaledVector(side, -0.045).add(new THREE.Vector3(0, -0.02 + scroll, 0));
      this.phone.visible = true;
      this.phone.position.copy(phoneAt);
      // (its camera faces away from her: the screen faces her)
      this.phone.lookAt(phoneAt.clone().multiplyScalar(2).sub(this.voicePosition().add(new THREE.Vector3(0, -0.15, 0))));
    }
    // On the phone: her right hand holds it to her right ear, elbow out and down
    if (this.state === 'call') {
      this.callT = (this.callT ?? 0) + dt;
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion); // her left
      const ear = this.rig.joints.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.07, 0)).addScaledVector(side, -0.1 * this.rig.scale).addScaledVector(fwd, 0.02);
      handOnMouse.copy(ear).addScaledVector(side, -0.03).add(new THREE.Vector3(0, -0.06, 0));
      this.phone.visible = true;
      this.phone.position.copy(ear).addScaledVector(side, -0.012);
      // (flat against her cheek: its face towards her head, top up past her ear)
      this.phone.lookAt(this.phone.position.clone().addScaledVector(side, -1));
      this.phone.rotateZ(Math.PI / 2 - 0.35);
    }
    solveTwoBone(j.rShoulder, j.rElbow, handOnMouse, L.upperArm, L.lowerArm,
      this.state === 'call'
        ? new THREE.Vector3(-1, -0.6, 0.2).normalize().applyQuaternion(this.root.quaternion)
        : new THREE.Vector3(-0.6, -0.4, -1).applyQuaternion(this.root.quaternion));
    const kb = this.keyboard.getWorldPosition(new THREE.Vector3());
    const handOnKeys = kb.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion), 0.12);
    handOnKeys.y += 0.05;
    if (clipHand) handOnKeys.lerp(clipHand, engage);
    if (phoneAt) handOnKeys.copy(phoneAt).addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion), 0.045).add(new THREE.Vector3(0, -0.02, 0));
    // Pointing at the sign: the left arm swings up and out over her shoulder (eases in and out)
    this.pointAmt += ((this.state === 'point' ? 1 : 0) - this.pointAmt) * (1 - Math.exp(-7 * dt));
    if (this.pointAmt > 0.001 && this.pointAt) {
      const sh = j.lShoulder.getWorldPosition(new THREE.Vector3());
      const reach = (L.upperArm + L.lowerArm) * 0.97;
      const dir = this.pointAt.clone().sub(sh).normalize();
      // The poster's straight ahead, past her monitor: the arm goes up and a little out to her left, over it
      if (this.pointAt === this.posterPos) dir.add(new THREE.Vector3(0, 0.55, 0)).addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion), 0.3).normalize();
      const aim = sh.clone().addScaledVector(dir, reach);
      handOnKeys.lerp(aim, this.pointAmt);
      // (her realistic body points its index finger at it: realBody.js)
      this.rig.handShape = { 1: { shape: 'point', aim: this.pointAt.clone(), amount: this.pointAmt } };
      this.rig.handShapeT = performance.now();
    }
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
    } else if (this.state === 'phone' && phoneAt) {
      // Looking down at her phone, pleased with herself
      aimJoint(j.neck, phoneAt, { maxYaw: 1.1, maxPitch: 0.7, alpha: turn });
      this.face?.lookAt(phoneAt);
      if (!this.scripted) this.face?.setExpression('pleased');
    } else if (this.state === 'call') {
      // Chatting: looking off into the middle distance (not at her game, not at him), head tilted to the phone
      const off = this.voicePosition().addScaledVector(fwd, 2).add(new THREE.Vector3(Math.sin(this.callT * 0.5) * 0.4, -0.2, 0));
      aimJoint(j.neck, off, { maxYaw: 1.1, maxPitch: 0.5, alpha: turn });
      this.face?.lookAt(off);
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
