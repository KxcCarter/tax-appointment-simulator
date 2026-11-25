import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';

/*
  Damage you can see (the brawl): every blow that lands leaves something where it landed.
    head   bruises, black eyes (a ring round the eye and a purple lid), cuts that bleed,
           a nosebleed, a split lip; hats and glasses knocked crooked, then off
    body   torn clothes (a ragged hole showing the shirt or the skin underneath), ripped-off
           sleeves; bruises on bare skin
  Marks are small shapes stuck to the body part they're on, so they ride along with every
  animation and the ragdoll. Blood runs down from cuts and the nose over a couple of seconds.
  Order and amounts: config.damage. Colours: theme.palette (bruise, blackEye, blood...).
*/

const D = () => config.damage;
const rand = (a, b) => a + Math.random() * (b - a);
const Z = new THREE.Vector3(0, 0, 1);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Decals sit on the surface: drawn in front of it without fighting it
const decal = (color) => theme.material(color, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

/** A ragged blob (bruise, tear): a fan of triangles with a random radius at every point. */
function ragged(r, jag = 0.35, n = 14) {
  const pos = [0, 0, 0];
  const radii = Array.from({ length: n }, () => r * (1 - jag + Math.random() * jag * 2));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = radii[i % n];
    pos.push(Math.cos(a) * k, Math.sin(a) * k, 0);
  }
  const idx = [];
  for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A thin strip hanging down from its top edge (a trickle of blood; grows downwards). */
function strip(w, len) {
  const g = new THREE.PlaneGeometry(w, len);
  g.translate(0, -len / 2, 0);
  return g;
}

export class Damage {
  constructor({ rig, look, physics, scene }) {
    this.rig = rig;
    this.look = look;
    this.physics = physics;
    this.scene = scene;
    this.marks = [];      // meshes added (removed by heal())
    this.growing = [];    // blood running down: { mesh, t, dur }
    this.swapped = [];    // [mesh, original material] (lids, sleeves)
    this.headHits = 0;
    this.bodyHits = 0;
    this.used = new Set(); // marks that only happen once (e.g. 'blackEye:1')
    this.raycaster = new THREE.Raycaster();
    // Which joint each mesh hangs from (for "where did it land")
    this.jointName = new Map(Object.entries(rig.joints).map(([k, j]) => [j, k]));
  }

  /**
   * A blow landed. hit: the raycast intersection from the player's swing (point, object, face) when
   * there is one; otherwise somewhere is picked. source: 'fist' | 'kick' | 'weapon' | 'thrown'.
   */
  add({ hit = null, dir = V(0, 0, 1), knock = 1, source = 'fist' } = {}) {
    if (!D().enabled) return;
    let region = hit ? this._regionOf(hit.object) : null;
    if (!region) region = source === 'kick' ? (Math.random() < 0.5 ? 'torso' : 'leg') : Math.random() < D().headShare ? 'head' : 'torso';
    // The side it landed on (+1 = their left)
    const side = hit ? (this.rig.joints.spine.worldToLocal(hit.point.clone()).x >= 0 ? 1 : -1) : Math.random() < 0.5 ? 1 : -1;
    if (region === 'head') this._head(side, knock, dir);
    else this._body(region, side, hit, knock);
  }

  /** Every frame: blood keeps running for a moment. */
  update(dt) {
    for (const g of this.growing) {
      g.t = Math.min(g.dur, g.t + dt);
      const k = g.t / g.dur;
      g.mesh.scale.y = 0.08 + 0.92 * (1 - (1 - k) * (1 - k));
    }
    if (this.growing.length && this.growing.every((g) => g.t >= g.dur)) this.growing = [];
  }

  /** Everything back as it was (config.damage.healOnRetry). Hats and glasses stay where they fell. */
  heal() {
    for (const m of this.marks) m.parent?.remove(m);
    for (const [mesh, mat] of this.swapped) mesh.material = mat;
    this.marks = []; this.growing = []; this.swapped = [];
    this.headHits = this.bodyHits = 0;
    this.used.clear();
  }

  // ---------------------------------------------------------------- the head

  _head(side, knock, dir) {
    const n = this.headHits++;
    const seq = D().headSequence;
    const kind = seq[Math.min(n, seq.length - 1)] === 'random' ? pickRandom(D().headRandom) : seq[Math.min(n, seq.length - 1)];
    this._headMark(kind, side);
    // Glasses: crooked, then off; a hat comes off from a hard enough blow
    const head = this.rig.joints.head;
    const glasses = head.getObjectByName('glasses');
    if (glasses) {
      if (!glasses.userData.crooked) {
        glasses.userData.crooked = true;
        glasses.rotation.z = side * rand(0.18, 0.3);
        glasses.position.y -= 0.008;
      } else if (knock >= D().knockOffAt) this._knockOff(glasses, dir, 60);
    }
    const hat = head.getObjectByName('hat');
    if (hat && knock >= D().knockOffAt) this._knockOff(hat, dir, 90);
  }

  _headMark(kind, side) {
    const H = this.rig.proportions.head, face = this.rig.face;
    const eyeY = face?.eyeY ?? H.h * 0.58;
    if (kind === 'blackEye') {
      // The eye on the side it landed (the other one next time)
      const s = this.used.has('blackEye:' + side) ? -side : side;
      if (this.used.has('blackEye:' + s)) return this._headMark('bruise', side);
      this.used.add('blackEye:' + s);
      const eye = face?.eyes.find((e) => e.side === s);
      const x = eye ? eye.socket.position.x : s * 0.056;
      const at = this._onHead(x, eyeY - 0.004);
      if (at) this._stick('head', at, ragged(0.028, 0.1, 18), 'blackEye', { sx: 1.05, sy: 0.82, roll: 0 });
      // The lids go purple and swell
      if (eye) {
        for (const m of eye.socket.children) if (m.isMesh && m.material === theme.material(this.look.skin)) this._swap(m, 'blackEye');
        eye.socket.scale.setScalar(1.08);
      }
    } else if (kind === 'cut') {
      // A cut on the brow or the cheekbone, bleeding down the face
      const spots = [[0.07, eyeY + 0.05], [0.085, H.h * 0.45], [0.03, H.h * 0.78]];
      const [x, y] = spots[Math.floor(Math.random() * spots.length)];
      const at = this._onHead(side * x, y);
      if (!at) return;
      this._stick('head', at, ragged(0.016, 0.3, 8), 'cut', { sx: 1.6, sy: 0.35, roll: rand(-0.6, 0.6) });
      this._trickle('head', at, 0.006, rand(0.05, 0.09));
    } else if (kind === 'noseBleed') {
      if (this.used.has('nose')) return this._headMark('cut', side);
      this.used.add('nose');
      for (const s of [1, -1]) {
        if (s === -side && Math.random() < 0.5) continue; // one nostril, or both
        const at = this._onHead(s * 0.011, H.h * 0.355);
        if (at) this._trickle('head', at, 0.006, rand(0.045, 0.065));
      }
    } else if (kind === 'lip') {
      if (this.used.has('lip')) return this._headMark('bruise', side);
      this.used.add('lip');
      const at = this._onHead(side * 0.022, H.h * 0.245);
      if (!at) return;
      this._stick('head', at, ragged(0.009, 0.3, 8), 'cut', { sx: 1, sy: 1, roll: 0 });
      this._trickle('head', at, 0.004, 0.03);
    } else {
      // A bruise on the cheek, the jaw or the temple
      const spots = [[0.08, H.h * 0.42], [0.07, H.h * 0.2], [0.095, eyeY + 0.03]];
      const [x, y] = spots[Math.floor(Math.random() * spots.length)];
      const at = this._onHead(side * x, y);
      if (at) this._stick('head', at, ragged(rand(0.02, 0.03)), Math.random() < 0.3 ? 'bruiseOld' : 'bruise', { sx: 1, sy: 0.8, roll: rand(0, 3) });
    }
  }

  // ---------------------------------------------------------------- the body

  _body(region, side, hit, knock) {
    this.bodyHits++;
    const look = this.look;
    const cloth = { torso: look.jacket ?? look.shirt, arm: look.jacket ?? look.shirt, leg: look.trousers, pelvis: look.trousers };
    // Under the jacket there's a shirt; under everything else, skin
    const under = region === 'torso' && look.shirt !== undefined && look.shirt !== cloth.torso ? look.shirt : look.skin;
    // An arm (or every few body blows): the sleeve comes off
    if ((region === 'arm' || (region === 'torso' && this.bodyHits % D().sleeveEvery === 0)) && this._ripSleeve(side)) return;
    const at = hit && this._regionOf(hit.object) === region ? this._fromHit(hit) : this._onPart(region === 'arm' ? 'torso' : region, side);
    if (!at) return;
    const covered = at.mesh.material !== theme.material(look.skin);
    if (covered && cloth[region] !== undefined) {
      const r = rand(...D().tearSize) * (0.8 + 0.2 * Math.min(2, knock));
      this._stick(at.joint, at, ragged(r, 0.45, 16), under, { sx: rand(0.8, 1.3), sy: rand(0.6, 1), roll: rand(0, 3) });
    } else {
      this._stick(at.joint, at, ragged(rand(0.025, 0.04)), 'bruise', { sx: 1, sy: 0.8, roll: rand(0, 3) });
    }
  }

  /** The sleeve on that side is torn off (the shirt sleeve under a jacket, or the bare arm). */
  _ripSleeve(side) {
    const key = 'sleeve:' + side;
    if (this.used.has(key)) return false;
    const look = this.look, jacket = look.jacket ?? look.shirt;
    if (jacket === undefined || jacket === look.skin) return false;
    const under = look.shirt !== undefined && look.shirt !== jacket ? look.shirt : look.skin;
    const j = this.rig.joints, pre = side === 1 ? 'l' : 'r';
    const sleeve = theme.material(jacket);
    let ripped = false;
    for (const joint of [j[pre + 'Shoulder'], j[pre + 'Elbow']]) {
      for (const m of joint.children) {
        if (m.isMesh && m.material === sleeve) { this._swap(m, under); ripped = true; }
      }
    }
    if (ripped) this.used.add(key);
    return ripped;
  }

  // ---------------------------------------------------------------- hats and glasses

  /** Off the head, into the room: a loose physics prop, thrown along the blow. */
  _knockOff(group, dir, density) {
    this.scene.attach(group);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(V(0, 0, 0)), centre = group.worldToLocal(box.getCenter(V(0, 0, 0)));
    this.physics.addDynamic(group, [{ type: 'box', half: { x: Math.max(0.02, size.x / 2), y: Math.max(0.01, size.y / 2), z: Math.max(0.02, size.z / 2) }, offset: centre }], { density, restitution: 0.3 });
    const b = group.userData.body;
    b.wakeUp();
    const d = dir.clone().setY(0).normalize();
    b.setLinvel({ x: d.x * rand(1.5, 2.5), y: rand(1.5, 2.5), z: d.z * rand(1.5, 2.5) }, true);
    b.setAngvel({ x: rand(-6, 6), y: rand(-6, 6), z: rand(-6, 6) }, true);
  }

  // ---------------------------------------------------------------- placing marks

  /** Head-pivot point (x, y) projected onto the front of the head: { point, normal, mesh, joint }. */
  _onHead(x, y) {
    const head = this.rig.joints.head, mesh = this.rig.parts.head;
    return this._cast(mesh, head.localToWorld(V(x, y, 0.5)), head.localToWorld(V(x, y, 0)), 'head');
  }

  /** Somewhere on the front of a body part (the torso, or a leg on that side). */
  _onPart(region, side) {
    const j = this.rig.joints, P = this.rig.proportions;
    if (region === 'leg') {
      const knee = side === 1 ? j.lKnee : j.rKnee;
      const mesh = knee.parent.children.find((m) => m.isMesh);
      const y = -P.upperLeg.len * rand(0.3, 0.85);
      return this._cast(mesh, knee.parent.localToWorld(V(0, y, 0.5)), knee.parent.localToWorld(V(0, y, 0)), side === 1 ? 'lHip' : 'rHip');
    }
    const x = side * rand(0, P.torso.w * 0.3), y = P.torso.h * rand(0.25, 0.8);
    return this._cast(this.rig.parts.torso, j.spine.localToWorld(V(x, y, 1)), j.spine.localToWorld(V(x, y, 0)), 'spine');
  }

  _cast(mesh, from, to, joint) {
    if (!mesh) return null;
    this.rig.root.updateMatrixWorld(true);
    this.raycaster.set(from, to.clone().sub(from).normalize());
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    return hit ? { ...this._fromHit(hit), joint } : null;
  }

  _fromHit(hit) {
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : V(0, 0, 1);
    return { point: hit.point.clone(), normal, mesh: hit.object, joint: this._jointOf(hit.object) };
  }

  /** Stick a flat mark onto the surface at `at` (on the joint it moves with). */
  _stick(joint, at, geometry, color, { sx = 1, sy = 1, roll = 0 }) {
    const parent = typeof joint === 'string' ? this.rig.joints[joint] : joint;
    const mesh = new THREE.Mesh(geometry, decal(color));
    mesh.position.copy(at.point).addScaledVector(at.normal, 0.0015);
    mesh.quaternion.setFromUnitVectors(Z, at.normal).multiply(new THREE.Quaternion().setFromAxisAngle(Z, roll));
    mesh.scale.set(sx, sy, 1);
    mesh.userData.rigRoot = this.rig.root; // (still part of them for the player's swings)
    mesh.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);
    parent.attach(mesh);
    this.marks.push(mesh);
    return mesh;
  }

  /** Blood running down the surface from `at` (straight down, as things are when it starts). */
  _trickle(joint, at, width, length, count = 1) {
    for (let i = 0; i < count; i++) {
      const n = at.normal.clone().normalize();
      const down = V(0, -1, 0).addScaledVector(n, n.y).normalize(); // world down, along the surface
      const x = V(0, 0, 0).crossVectors(down.clone().negate(), n).normalize();
      const basis = new THREE.Matrix4().makeBasis(x, down.clone().negate(), n);
      const mesh = new THREE.Mesh(strip(width * rand(0.7, 1.1), length * rand(0.7, 1.15)), decal('blood'));
      mesh.position.copy(at.point).addScaledVector(n, 0.002).addScaledVector(x, (i - (count - 1) / 2) * width * 1.3);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.scale.y = 0.08;
      mesh.userData.rigRoot = this.rig.root;
      const parent = this.rig.joints[joint] ?? joint;
      mesh.updateMatrixWorld(true);
      parent.updateMatrixWorld(true);
      parent.attach(mesh);
      this.marks.push(mesh);
      this.growing.push({ mesh, t: 0, dur: rand(...D().bleedTime) + i * 0.4 });
    }
  }

  _swap(mesh, color) {
    if (!this.swapped.some(([m]) => m === mesh)) this.swapped.push([mesh, mesh.material]);
    mesh.material = theme.material(color);
  }

  /** The rig joint a mesh hangs from. */
  _jointOf(o) {
    for (let p = o; p; p = p.parent) if (this.jointName.has(p)) return p;
    return this.rig.joints.spine;
  }

  /** Which part of them a mesh is: head | torso | arm | leg | pelvis (null: not theirs). */
  _regionOf(o) {
    const j = this._jointOf(o), name = this.jointName.get(j);
    if (!name) return null;
    if (name === 'head' || name === 'neck') return 'head';
    if (name === 'spine') return 'torso';
    if (name === 'pelvis') return 'leg';
    if (/Shoulder|Elbow/.test(name)) return 'arm';
    return 'leg';
  }
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}
