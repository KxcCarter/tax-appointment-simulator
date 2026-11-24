import * as THREE from 'three';
import { RAPIER } from '../physics.js';
import { GROUP_NOT_LIMBS } from '../characters/ragdoll.js';
import { config } from '../config.js';

const cfg = config.player;

/**
 * First-person controller: pointer-lock mouse look, WASD, Shift for a brisk walk.
 * Movement goes through a Rapier kinematic character controller (capsule).
 */
export class PlayerController {
  constructor(physics, camera) {
    this.physics = physics;
    this.camera = camera;
    this.yaw = cfg.spawn.yaw;
    this.pitch = 0;
    this.keys = new Set();
    this.velocity = new THREE.Vector3();
    this.verticalVelocity = 0;
    this.grounded = false;
    this.enabled = false;      // pointer locked and playing
    this.blocked = new Set();  // reasons input is suspended (e.g. 'dialogue')
    this.bobPhase = 0;
    this.seat = null;          // chair Object3D while seated
    this.seatYaw = 0;
    this.seatPitch = 0;
    this.strideAccum = 0;
    this.onStep = null;        // callback per footstep
    this.knockVel = new THREE.Vector3(); // being shoved (decays)
    this.shake = 0;            // camera shake amount (decays)

    const world = physics.world;
    // Capsule centre height so that the feet touch the floor (y = 0)
    this.centreHeight = cfg.capsuleHalfHeight + cfg.capsuleRadius;
    const spawn = new THREE.Vector3(cfg.spawn.x, this.centreHeight + 0.02, cfg.spawn.z);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(cfg.capsuleHalfHeight, cfg.capsuleRadius),
      this.body
    );

    this.cc = world.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.cc.enableAutostep(cfg.stepHeight, 0.15, false);
    this.cc.enableSnapToGround(0.2);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(cfg.characterMass);

    this.prevPos = spawn.clone();
    this.currPos = spawn.clone();

    this._bindInput();
  }

  _bindInput() {
    document.addEventListener('mousemove', (e) => {
      if (!this.canAct) return;
      // Clamp spikes some browsers report on pointer-lock edge cases
      const dx = THREE.MathUtils.clamp(e.movementX, -200, 200);
      const dy = THREE.MathUtils.clamp(e.movementY, -200, 200);
      if (this.seat) {
        const S = config.seated;
        this.seatYaw = THREE.MathUtils.clamp(this.seatYaw - dx * cfg.mouseSensitivity, -S.yawLimit, S.yawLimit);
        this.seatPitch = THREE.MathUtils.clamp(this.seatPitch - dy * cfg.mouseSensitivity, -S.pitchLimit, S.pitchLimit);
        return;
      }
      this.yaw -= dx * cfg.mouseSensitivity;
      this.pitch -= dy * cfg.mouseSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -cfg.pitchLimit, cfg.pitchLimit);
    });
    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** True when the player may look/move/interact. */
  get canAct() {
    return this.enabled && this.blocked.size === 0;
  }

  block(reason, on) {
    if (on) this.blocked.add(reason);
    else this.blocked.delete(reason);
  }

  // ---------------------------------------------------------------- sitting

  /** Yaw a camera needs to look along a chair's facing (+z local). */
  static chairYaw(chair) {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.quaternion);
    return Math.atan2(-f.x, -f.z);
  }

  sit(chair) {
    this.seat = chair;
    this.seatYaw = 0;
    this.seatPitch = 0;
    this.velocity.set(0, 0, 0);
    this.collider.setEnabled(false); // don't shove the chair we're sitting in
  }

  stand() {
    const chair = this.seat;
    if (!chair) return;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.quaternion).setY(0).normalize();
    const p = chair.position.clone().addScaledVector(f, config.seated.standUpDistance);
    this.seat = null;
    this.collider.setEnabled(true);
    this.teleport(p.x, p.z, PlayerController.chairYaw(chair) + this.seatYaw);
  }

  /** Get hit: shoved along `dir` at `speed` m/s, camera shaken by `shake`. */
  knock(dir, speed, shake) {
    this.knockVel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    this.shake = Math.max(this.shake, shake);
  }

  /** Called once per fixed physics step, before world.step(). */
  fixedUpdate(dt) {
    this.shake = Math.max(0, this.shake - dt * config.combat.shakeDecay * Math.max(0.3, this.shake));
    if (this.seat) return;
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.canAct) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    }
    const wish = new THREE.Vector3(fx, 0, fz);
    if (wish.lengthSq() > 0) wish.normalize();
    wish.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);

    const brisk = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = brisk ? cfg.briskSpeed : cfg.walkSpeed;
    const target = wish.multiplyScalar(speed);
    const a = 1 - Math.exp(-cfg.acceleration * dt);
    this.velocity.lerp(target, a);

    if (this.grounded) this.verticalVelocity = -0.5;
    else this.verticalVelocity += config.physics.gravity * dt;

    this.knockVel.multiplyScalar(Math.exp(-config.combat.knockbackDecay * dt));
    const desired = {
      x: (this.velocity.x + this.knockVel.x) * dt,
      y: this.verticalVelocity * dt,
      z: (this.velocity.z + this.knockVel.z) * dt,
    };
    this.cc.computeColliderMovement(this.collider, desired, undefined, GROUP_NOT_LIMBS); // step over flopped limbs
    const m = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();

    const t = this.body.translation();
    this.prevPos.copy(this.currPos);
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.currPos.set(next.x, next.y, next.z);

    // Velocity actually achieved (so walking into a wall doesn't bob the head)
    const horiz = Math.hypot(m.x, m.z);
    if (this.grounded) {
      this.bobPhase += horiz * cfg.headBobFrequency * Math.PI * 2;
      this.strideAccum += horiz;
      if (this.strideAccum >= config.audio.footsteps.strideLength) {
        this.strideAccum = 0;
        this.onStep?.();
      }
    }

    // Safety net: fell out of the world
    if (next.y < -5) this.teleport(cfg.spawn.x, cfg.spawn.z, cfg.spawn.yaw);
  }

  teleport(x, z, yaw) {
    const p = { x, y: this.centreHeight + 0.02, z };
    this.body.setTranslation(p, true);
    this.prevPos.set(p.x, p.y, p.z);
    this.currPos.copy(this.prevPos);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    if (yaw !== undefined) { this.yaw = yaw; this.pitch = 0; }
  }

  /** Called every rendered frame. alpha = interpolation between physics steps. */
  updateCamera(alpha) {
    if (this.seat) {
      const S = config.seated;
      const eye = new THREE.Vector3(0, 0, S.eyeForward).applyQuaternion(this.seat.quaternion).add(this.seat.position);
      eye.y = this.seat.position.y + S.eyeHeight + (this.seatBob ?? 0); // e.g. a neighbour's bouncing knee
      this.camera.position.copy(eye);
      this.camera.rotation.set(this.seatPitch, PlayerController.chairYaw(this.seat) + this.seatYaw, 0, 'YXZ');
      return;
    }
    const pos = new THREE.Vector3().lerpVectors(this.prevPos, this.currPos, alpha);
    const feetY = pos.y - this.centreHeight;
    const moving = Math.min(1, this.velocity.length() / cfg.walkSpeed);
    const bob = Math.sin(this.bobPhase) * cfg.headBobAmount * moving;
    this.camera.position.set(pos.x, feetY + cfg.eyeHeight + bob, pos.z);
    // Camera shake from being hit
    const sh = this.shake * 0.05;
    const jitter = () => (Math.random() * 2 - 1) * sh;
    this.camera.rotation.set(this.pitch + jitter(), this.yaw + jitter(), jitter() * 1.5, 'YXZ');
  }
}
