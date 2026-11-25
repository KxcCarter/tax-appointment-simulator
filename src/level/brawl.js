import * as THREE from 'three';
import { config } from '../config.js';

/*
  The brawl (Milestone 4). Started by the newcomer's clipboard smash; everyone still standing
  joins in, cheering him on.

  Each fighter runs an endless walker routine; when one round ends, plan() hands them the next:
    close fighters (config.brawl.maxAttackers, the nearest when it starts; this.attackers), round after round:
                  approach -> leap in -> wind up (a readable telegraph) -> attack -> spring back -> catch breath
                  When one goes down, the nearest of the others is promoted (update()).
    hanging back: walk to a spot a couple of metres from the player, stand there in their fighting
                  stance (bouncing from foot to foot) or cheering
    throwing:     (sometimes, instead of hanging back) fetch something nearby, step out, throw it at him
  Only config.brawl.maxAttackers attack at once; the rest hang back and shout.
*/

const B = () => config.brawl;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
/** Angle between two directions, 0..PI. */
const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class Brawl {
  /**
   * @param npcs      () => Npc[]  everyone who might fight
   * @param camera    the player's camera (target)
   * @param onHit     (npc, kind) => void  one of their blows reaches the moment of impact
   * @param say       (npcId, text) => void  shout a line (dialogue box)
   * @param shouts    { opening: string[], anytime: string[], byPerson?: Record<id, string[]> }
   */
  constructor({ npcs, camera, onHit, say, shouts }) {
    this.npcs = npcs;
    this.camera = camera;
    this.onHit = onHit;
    this.say = say;
    this.shouts = shouts;
    this.started = false;
    this.attackers = new Set();
    this.fighters = [];
    this.time = 0;
  }

  /** Everyone still standing joins in. `instigator` is already fighting. */
  start(instigator, opening = this.shouts.opening) {
    if (this.started) return;
    this.started = true;
    this.beforeStart?.(); // (the level: the sitter gets back up)
    this.fighters = this.npcs().filter((n) => !n.down);
    for (const n of this.fighters) {
      if (n === instigator || n.walker.current?.type === 'getUp') continue; // (already on her way up)
      // Get up (staggered), cheer for a moment, then join in
      n.startBrawl([
        { type: 'hold', seconds: rand(...B().openingStagger), target: this.target, expression: 'surprised' },
      ], this);
    }
    // The opening cheers, one person each, in order
    const others = this.fighters.filter((n) => n !== instigator);
    this.queue = opening.map((text, i) => ({ who: others[i % Math.max(1, others.length)]?.id, text }));
    this.nextShout = 0.8;
  }

  /** Everyone has been put back in their seats: stop coordinating until restart(). */
  reset() {
    this.started = false;
    this.attackers.clear();
    this.queue = [];
  }

  /**
   * After the player's failure loop: everyone is back in their seats. A moment later they all get
   * up and go for him again, with a fresh set of opening shouts.
   */
  restart() {
    this.started = false;
    this.attackers.clear();
    for (const n of this.npcs()) n.angle = undefined;
    this.start(null, this.shouts.again ?? this.shouts.opening);
  }

  /** The player's head, as a target for approach/attack/look. */
  target = () => this.camera.position.clone();

  /** Hand a fighter their next round (called by their walker when a round ends). */
  plan(npc) {
    if (npc.down) { this.attackers.delete(npc); return null; }
    this._fillCloseSlots();
    const tgt = this.target;
    // A close fighter: at him again
    if (this.attackers.has(npc)) {
      const moves = B().moves[npc.id] ?? B().moves.default;
      // Come at the player from a different side than the other attacker
      npc.angle = this._attackAngle(npc);
      // A point on the ring round the player at their angle, d metres out (inside the room)
      const ring = (d) => () => {
        const p = this.camera.position;
        return this._clamp(new THREE.Vector3(p.x + Math.sin(npc.angle) * d, 0, p.z + Math.cos(npc.angle) * d));
      };
      const Nj = B().ninja, flip = Math.random() < Nj.flipChance, back = Math.random() < Nj.backflipChance;
      return [
        // Up to a couple of metres out, then a ninja leap in (sometimes a front flip)...
        { type: 'approach', target: tgt, at: ring(Nj.leapFrom), distance: Nj.leapFrom, timeout: 8 },
        { type: 'leap', to: ring(B().approachDistance), face: tgt, flip: flip ? 1 : 0, height: flip ? Nj.flipHeight : Nj.height, duration: flip ? Nj.flipTime : Nj.time },
        { type: 'hold', seconds: B().windUp, target: tgt, pose: 'stance', expression: 'furious' },
        { type: 'attack', kind: pick(moves), target: tgt, onHit: (kind) => this.onHit(npc, kind) },
        // ...and spring back out afterwards (sometimes a backflip)
        { type: 'leap', to: ring(Nj.backTo), face: tgt, flip: back ? -1 : 0, height: back ? Nj.flipHeight : Nj.height * 0.7, duration: back ? Nj.flipTime : Nj.time },
        { type: 'hold', seconds: rand(...B().closeRest), target: tgt, pose: 'stance' },
      ];
    }
    // Everyone else keeps their distance
    // Sometimes: something to throw at him instead (config.brawl.throwing)
    if (this.throws && !npc.carrying && Math.random() < B().throwing.chance) {
      const item = this.throws.find(npc);
      if (item) return this._throwRound(npc, item);
    }
    // To a spot to wait their turn: a hop if it's not far, else they walk
    const spot = this._hangBackSpot(npc), from = npc.walker.pos ?? npc.rig.root.position;
    const Nj = B().ninja, far = Math.hypot(spot.x - from.x, spot.z - from.z);
    const move = far > 0.4 && far < Nj.hopMax
      ? { type: 'leap', to: spot, face: tgt, height: Nj.hopHeight, duration: 0.35 + far * 0.1 }
      : { type: 'walk', to: spot };
    return [
      move,
      { type: 'hold', seconds: rand(...B().hangBackHold), target: tgt, pose: Math.random() < B().cheerChance ? 'cheer' : 'stance' },
    ];
  }

  /** If `npc` is walking towards the other person (direction ux, uz), a sidestep to their right. */
  _keepRight(npc, ux, uz, push) {
    const w = npc.walker;
    if (w.moving < 0.3 || w.yaw === undefined) return;
    const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
    if (fx * ux + fz * uz < 0.3) return; // not heading into them
    const k = push * B().keepRight; // right = -left = (-cos yaw, sin yaw)
    w.nudge(-Math.cos(w.yaw) * k, Math.sin(w.yaw) * k);
  }

  /** A floor point kept inside the room (in front of the counter). */
  _clamp(v) {
    const b = B().bounds;
    v.x = THREE.MathUtils.clamp(v.x, b.minX, b.maxX);
    v.z = THREE.MathUtils.clamp(v.z, b.minZ, b.maxZ);
    return v;
  }

  /** Fetch `item`, step out to a few metres from the player, throw it at him. */
  _throwRound(npc, item) {
    const tgt = this.target;
    const where = () => item.object.getWorldPosition(new THREE.Vector3());
    const p = where(), from = npc.walker.pos ?? npc.rig.root.position;
    const d = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
    const spot = d.length() > 0.5 ? new THREE.Vector3(p.x, 0, p.z).addScaledVector(d.normalize(), -0.45) : from.clone().setY(0);
    return [
      { type: 'walk', to: spot, pushThrough: true },
      {
        type: 'reach', target: where,
        onReach: () => {
          // Gone (the player got there first): this round ends here, and they're handed the next
          if (!this.throws.take(npc, item)) npc.walker.steps.length = npc.walker.i + 1;
        },
      },
      { type: 'walk', to: this._hangBackSpot(npc, rand(...B().throwing.from)), pushThrough: true },
      { type: 'hold', seconds: 0.3, target: tgt, expression: 'furious' },
      { type: 'attack', kind: 'throw', target: tgt, onHit: () => this.throws.release(npc, this.target()) },
    ];
  }

  /**
   * Keep config.brawl.maxAttackers close fighters: the nearest of the others to the player moves in
   * (someone in the middle of a throw finishes it first: their next round is a close one).
   */
  _fillCloseSlots() {
    for (const n of [...this.attackers]) if (n.down || !this.fighters.includes(n)) this.attackers.delete(n);
    const p = this.camera.position;
    const far = (n) => { const at = n.walker.pos ?? n.rig.root.position; return Math.hypot(at.x - p.x, at.z - p.z); };
    while (this.attackers.size < B().maxAttackers) {
      const next = this.fighters.filter((n) => !n.down && !this.attackers.has(n)).sort((a, b) => far(a) - far(b))[0];
      if (!next) break;
      this.attackers.add(next);
      next.angle = this._attackAngle(next);
      // Standing about (not mid-throw): come in now
      const s = next.walker.current;
      if (s?.type === 'hold' && s.seconds !== Infinity && !next.carrying) s.seconds = 0;
    }
  }

  /** The angle (around the player) this fighter is at now. */
  _angleOf(npc) {
    const p = this.camera.position, at = npc.walker.pos ?? npc.rig.root.position;
    return Math.atan2(at.x - p.x, at.z - p.z);
  }

  _inBounds(angle, dist) {
    const p = this.camera.position, b = B().bounds;
    const x = p.x + Math.sin(angle) * dist, z = p.z + Math.cos(angle) * dist;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  /** First attacker comes straight from where they are; the second from flankAngle round from them. */
  _attackAngle(npc) {
    const mine = this._angleOf(npc);
    const other = [...this.attackers].find((a) => a !== npc && a.angle !== undefined);
    if (!other) return mine;
    const F = B().flankAngle;
    const options = [other.angle + F, other.angle - F]
      .sort((a, b) => angDist(a, mine) - angDist(b, mine));
    return options.find((a) => this._inBounds(a, B().approachDistance + 0.3)) ?? options[0];
  }

  /**
   * Somewhere a couple of metres from the player to wait their turn: in a direction nobody else
   * is (so they spread out round him instead of queueing behind each other), inside the room.
   */
  _hangBackSpot(npc, dist = rand(...B().hangBack)) {
    // Where everyone else is (or is headed): their spots, else where they stand
    const others = this.fighters
      .filter((n) => n !== npc && !n.down)
      .map((n) => n.spot ?? n.walker.pos ?? n.rig.root.position);
    const mine = this._angleOf(npc);
    const p = this.camera.position, bd = B().bounds;
    let best = null;
    // Round the player, at this distance or (near a wall) a bit closer; a spot outside the room is
    // pulled in to the wall, so compare the spots as they really are, and keep clear of everyone else's
    for (const d of [dist, dist * 0.8, dist * 0.65]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const spot = new THREE.Vector3(
          THREE.MathUtils.clamp(p.x + Math.sin(a) * d, bd.minX, bd.maxX), 0,
          THREE.MathUtils.clamp(p.z + Math.cos(a) * d, bd.minZ, bd.maxZ));
        const fromPlayer = Math.hypot(spot.x - p.x, spot.z - p.z);
        if (fromPlayer < Math.min(2, dist * 0.6)) continue; // (pulled in too close to him by a wall)
        const room = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - spot.x, o.z - spot.z))) : 3;
        // Spread out (room to the nearest other, up to 2.5 m), but don't cross the room for it
        const score = Math.min(room, 2.5) - 0.3 * angDist(a, mine) - (d < dist ? 0.3 : 0);
        if (!best || score > best.score) best = { spot, score };
      }
    }
    const spot = best?.spot ?? this._clamp(new THREE.Vector3(p.x + Math.sin(mine) * dist, 0, p.z + Math.cos(mine) * dist));
    npc.spot = spot.clone();
    npc.angle = Math.atan2(spot.x - p.x, spot.z - p.z);
    return spot;
  }


  update(dt) {
    if (!this.started) return;
    this.time += dt;
    if ([...this.attackers].some((n) => n.down) || this.attackers.size < B().maxAttackers) this._fillCloseSlots();
    const standing = this.fighters.filter((n) => !n.down && n.walker.active);

    // Keep fighters from walking (or leaping) into each other, or standing inside someone on the floor:
    // a few passes, so pushing one out of another doesn't push them into a third
    const sep = B().separation;
    const downed = this.npcs().filter((n) => n.down && n.ragdoll).map((n) => n.rig.joints.pelvis.getWorldPosition(new THREE.Vector3()));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < standing.length; i++) {
        const A = standing[i], a = A.walker.pos;
        for (let k = i + 1; k < standing.length; k++) {
          const Bn = standing[k], b = Bn.walker.pos;
          const min = A.bodyRadius + Bn.bodyRadius + sep;
          const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
          if (d < min) {
            const [ux, uz] = d > 1e-4 ? [dx / d, dz / d] : [Math.cos(i + k), Math.sin(i + k)];
            const push = (min - d) / 2;
            A.walker.nudge(-ux * push, -uz * push);
            Bn.walker.nudge(ux * push, uz * push);
            // Walking into each other: each also steps to their own right, so they get past
            this._keepRight(A, ux, uz, push);
            this._keepRight(Bn, -ux, -uz, push);
          }
        }
        for (const p of downed) {
          const min = A.bodyRadius + B().downedRadius;
          const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz);
          if (d < min && d > 1e-4) A.walker.nudge((dx / d) * (min - d), (dz / d) * (min - d));
        }
      }
    }

    // ...and inside the room (knockback can shove them towards a wall)
    const bd = B().bounds;
    for (const n of standing) {
      const p = n.walker.pos;
      p.x = THREE.MathUtils.clamp(p.x, bd.minX - 0.3, bd.maxX + 0.3);
      p.z = THREE.MathUtils.clamp(p.z, bd.minZ - 0.6, bd.maxZ + 0.4);
    }

    // Shouting from the sidelines
    this.nextShout -= dt;
    if (this.nextShout <= 0) {
      const line = this._nextLine(standing);
      if (line) this.say(line.who, line.text);
      this.nextShout = this.queue.length ? 1.5 : rand(...B().shoutEvery);
    }
  }

  _nextLine(standing) {
    while (this.queue.length) {
      const l = this.queue.shift();
      if (standing.some((n) => n.id === l.who)) return l;
    }
    const idle = standing.filter((n) => !this.attackers.has(n));
    const who = pick(idle.length ? idle : standing);
    if (!who) return null;
    const pool = [...this.shouts.anytime, ...(this.shouts.byPerson?.[who.id] ?? [])].filter((t) => t !== this.lastLine);
    this.lastLine = pick(pool);
    return { who: who.id, text: this.lastLine };
  }
}
