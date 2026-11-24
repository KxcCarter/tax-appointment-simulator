import * as THREE from 'three';
import { config } from '../config.js';

/*
  The brawl (Milestone 4). Started by the newcomer's clipboard smash; everyone still standing
  joins in, cheering him on.

  Each fighter runs an endless walker routine; when one round ends, plan() hands them the next:
    attacker:   approach -> wind up (a readable telegraph) -> attack -> (next round: hang back)
    hanging back: walk to a spot a couple of metres from the player, stand there cheering / in guard
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
  start(instigator) {
    if (this.started) return;
    this.started = true;
    this.fighters = this.npcs().filter((n) => !n.down);
    for (const n of this.fighters) {
      if (n === instigator) continue;
      // Get up (staggered), cheer for a moment, then join in
      n.startBrawl([
        { type: 'hold', seconds: rand(...B().openingStagger), target: this.target, expression: 'surprised' },
      ], this);
    }
    // The opening cheers, one person each, in order
    const others = this.fighters.filter((n) => n !== instigator);
    this.queue = this.shouts.opening.map((text, i) => ({ who: others[i % Math.max(1, others.length)]?.id, text }));
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
    for (const n of this.npcs()) { n.justAttacked = false; n.angle = undefined; }
    const saved = this.shouts.opening;
    this.shouts.opening = this.shouts.again ?? saved;
    this.start(null);
    this.shouts.opening = saved;
  }

  /** The player's head, as a target for approach/attack/look. */
  target = () => this.camera.position.clone();

  /** Hand a fighter their next round (called by their walker when a round ends). */
  plan(npc) {
    if (npc.down) return null;
    this.attackers.delete(npc);
    const tgt = this.target;
    // Attack if there's room, unless they just did (then they hang back for a round first)
    if (!npc.justAttacked && this.attackers.size < B().maxAttackers) {
      this.attackers.add(npc);
      npc.justAttacked = true;
      const moves = B().moves[npc.id] ?? B().moves.default;
      // Come at the player from a different side than the other attacker
      npc.angle = this._attackAngle(npc);
      const at = () => {
        const p = this.camera.position;
        return new THREE.Vector3(p.x + Math.sin(npc.angle) * B().approachDistance, 0, p.z + Math.cos(npc.angle) * B().approachDistance);
      };
      return [
        { type: 'approach', target: tgt, at, distance: B().approachDistance, timeout: 8 },
        { type: 'hold', seconds: B().windUp, target: tgt, pose: 'guard', expression: 'furious' },
        { type: 'attack', kind: pick(moves), target: tgt, onHit: (kind) => this.onHit(npc, kind) },
      ];
    }
    npc.justAttacked = false;
    return [
      { type: 'walk', to: this._hangBackSpot(npc) },
      { type: 'hold', seconds: rand(...B().hangBackHold), target: tgt, pose: Math.random() < 0.5 ? 'cheer' : 'guard' },
    ];
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
  _hangBackSpot(npc) {
    const taken = this.fighters
      .filter((n) => n !== npc && !n.down && n.angle !== undefined)
      .map((n) => n.angle);
    const mine = this._angleOf(npc);
    const dist = rand(...B().hangBack);
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (!this._inBounds(a, dist)) continue;
      const room = taken.length ? Math.min(...taken.map((t) => angDist(a, t))) : Math.PI;
      const score = room - 0.35 * angDist(a, mine); // spread out, but don't cross the room for it
      if (!best || score > best.score) best = { a, score };
    }
    npc.angle = best?.a ?? mine;
    const p = this.camera.position;
    const spot = new THREE.Vector3(p.x + Math.sin(npc.angle) * dist, 0, p.z + Math.cos(npc.angle) * dist);
    const b = B().bounds;
    spot.x = THREE.MathUtils.clamp(spot.x, b.minX, b.maxX);
    spot.z = THREE.MathUtils.clamp(spot.z, b.minZ, b.maxZ);
    return spot;
  }

  update(dt) {
    if (!this.started) return;
    this.time += dt;
    for (const n of [...this.attackers]) if (n.down) this.attackers.delete(n);
    const standing = this.fighters.filter((n) => !n.down && n.walker.active);

    // Keep fighters from walking into each other
    const sep = B().separation;
    for (let i = 0; i < standing.length; i++) {
      for (let k = i + 1; k < standing.length; k++) {
        const a = standing[i].walker.pos, b = standing[k].walker.pos;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d > 1e-4 && d < sep) {
          const push = (sep - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
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
