import RAPIER from '@dimforge/rapier3d-compat';
import { config } from './config.js';

export { RAPIER };

export async function initRapier() {
  await RAPIER.init();
}

/**
 * Thin wrapper around a Rapier world: fixed-step stepping plus helpers
 * for building static and dynamic bodies that drive Three.js objects.
 */
export class Physics {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: config.physics.gravity, z: 0 });
    this.world.timestep = config.physics.fixedStep;
    this.synced = []; // { body, object3d }
  }

  step() {
    this.world.step();
  }

  /**
   * Copy dynamic body transforms onto their meshes. Also notices impacts: a prop that suddenly
   * loses speed (landed, hit a wall or someone) calls onImpact(position, strength 0..1, object3d, mass).
   */
  sync() {
    const I = config.physics.impact;
    for (const e of this.synced) {
      const { body, object3d } = e;
      if (object3d.userData.held || body.isSleeping()) { e.lastSpeed = 0; continue; } // held = in the player's hands
      const v = body.linvel(), speed = Math.hypot(v.x, v.y, v.z);
      const drop = (e.lastSpeed ?? 0) - speed;
      e.lastSpeed = speed;
      e.quiet = Math.max(0, (e.quiet ?? 0) - 1);
      if (drop > I.speedDrop && !e.quiet && this.onImpact) {
        e.quiet = I.gapFrames;
        const t = body.translation();
        this.onImpact({ x: t.x, y: t.y, z: t.z }, Math.min(1, drop / I.loudAt), object3d, body.mass());
      }
      const t = body.translation();
      const r = body.rotation();
      object3d.position.set(t.x, t.y, t.z);
      object3d.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Static axis-aligned (or yaw-rotated) box collider. pos = centre, half = half extents. */
  addStaticBox(pos, half, yaw = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(pos.x, pos.y, pos.z)
      .setFriction(0.8);
    if (yaw) desc.setRotation(yawQuat(yaw));
    return this.world.createCollider(desc);
  }

  /**
   * Dynamic body that drives an Object3D (which must be a direct child of the scene).
   * shapes: [{ type: 'box', half: {x,y,z}, offset?: {x,y,z} } |
   *          { type: 'cylinder', halfHeight, radius, offset? } |
   *          { type: 'ball', radius, offset? }]
   */
  addDynamic(object3d, shapes, opts = {}) {
    const p = object3d.position;
    const q = object3d.quaternion;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(opts.linearDamping ?? 0.2)
      .setAngularDamping(opts.angularDamping ?? 0.4)
      .setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);
    for (const s of shapes) {
      let cd;
      if (s.type === 'box') cd = RAPIER.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z);
      else if (s.type === 'cylinder') cd = RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
      else if (s.type === 'ball') cd = RAPIER.ColliderDesc.ball(s.radius);
      else throw new Error(`Unknown shape ${s.type}`);
      if (s.offset) cd.setTranslation(s.offset.x, s.offset.y, s.offset.z);
      cd.setDensity(s.density ?? opts.density ?? 300)
        .setFriction(opts.friction ?? 0.7)
        .setRestitution(opts.restitution ?? 0.05);
      this.world.createCollider(cd, body);
    }
    body.sleep(); // props start at rest
    this.synced.push({ body, object3d });
    object3d.userData.body = body;
    return body;
  }

  /** Take an Object3D's dynamic body out of the world (it stays where it is, no longer simulated). */
  remove(object3d) {
    const body = object3d.userData.body;
    if (!body) return;
    this.synced = this.synced.filter((e) => e.object3d !== object3d);
    this.world.removeRigidBody(body);
    delete object3d.userData.body;
  }
}

export function yawQuat(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
