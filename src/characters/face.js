import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';
import { partGeometry } from './partShapes.js';

/*
  An expressive face for the rig: eyeballs that can look around, eyelids,
  independent eyebrows, and a mouth that can tighten, frown, smile and open.

  Expressions are named presets in config.characters.expressions, e.g.
    face.setExpression('bored')       // blends there over ~0.25 s
  Plus:
    face.lookAt(worldPoint | null)    // eyes only; null = straight ahead
    face.setTalking(true | false)     // mouth flaps while a line types out
  Blinking happens on its own.

  Coordinates: built inside the head pivot. `front(x, y)` gives the z of the
  face surface at (x, y) in head-pivot space.
*/

const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);

export class Face {
  constructor(headPivot, H, front, colors) {
    this.head = headPivot;
    const m = (c) => theme.material(c);
    const eyeY = H.h * 0.57, eyeX = 0.056, eyeR = 0.0175;
    this.eyeY = eyeY;

    // ---- eyes: socket (fixed) -> eyeball (rotates for gaze) -> iris; lid on the socket
    this.eyes = [];
    for (const side of [1, -1]) {
      const x = side * eyeX;
      const socket = new THREE.Group();
      socket.position.set(x, eyeY, front(x, eyeY) - eyeR * 0.55);
      headPivot.add(socket);
      const ball = new THREE.Group();
      socket.add(ball);
      ball.add(new THREE.Mesh(new THREE.SphereGeometry(eyeR, 16, 12), theme.material('eyeWhite')));
      const iris = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.6, 12, 10), m(colors.eyes));
      iris.scale.set(1, 1, 0.4);
      iris.position.z = eyeR * 0.82;
      ball.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.27, 10, 8), theme.material('black'));
      pupil.scale.set(1, 1, 0.4);
      pupil.position.z = eyeR * 0.95;
      ball.add(pupil);
      // Upper lid: a skin-coloured dome over the eyeball. Rotating it forward closes the eye.
      const lid = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(colors.skin));
      socket.add(lid);
      // Lower lid: a thin fixed rim, so the eye sits in the face rather than on it
      const lower = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.1, 16, 6, 0, Math.PI * 2, Math.PI * 0.72, Math.PI * 0.28), m(colors.skin));
      socket.add(lower);
      this.eyes.push({ side, socket, ball, lid });
    }

    // ---- eyebrows: pivot at the brow centre; raise = y offset, angle = tilt (inner end up > 0)
    this.brows = [];
    for (const side of [1, -1]) {
      const x = side * (eyeX + 0.004);
      const y = eyeY + 0.056; // clear of glasses frames
      const pivot = new THREE.Group();
      pivot.position.set(x, y, front(x, y) + 0.004);
      headPivot.add(pivot);
      const brow = new THREE.Mesh(partGeometry('figure', 'trim', 0.056, 0.012, 0.014), m(colors.brows));
      pivot.add(brow);
      this.brows.push({ side, pivot, baseY: y });
    }

    // ---- mouth: a dark opening (scales open) with two corner pieces (tilt for smile/frown)
    const mouthY = H.h * 0.25;
    this.mouth = new THREE.Group();
    this.mouth.position.set(0, mouthY, front(0, mouthY) + 0.002);
    headPivot.add(this.mouth);
    this.mouthGap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), theme.material('mouthDark'));
    this.mouthGap.scale.set(0.05, 0.007, 0.012);
    this.mouth.add(this.mouthGap);
    // Lower lip: a thin, slightly darker-than-skin curve under the opening
    this.lip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), m(colors.lips));
    this.lip.scale.set(0.042, 0.007, 0.01);
    this.lip.position.set(0, -0.008, -0.001);
    this.mouth.add(this.lip);
    this.corners = [];
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      this.mouth.add(pivot);
      const seg = new THREE.Mesh(partGeometry('figure', 'trim', 0.022, 0.006, 0.008), theme.material('mouthDark'));
      seg.position.x = side * 0.009;
      pivot.add(seg);
      this.corners.push({ side, pivot });
    }

    // ---- state
    this.target = resolve('neutral');
    this.current = { ...this.target, brows: { ...this.target.brows }, mouth: { ...this.target.mouth } };
    this.blendSpeed = 10;
    this.blink = 0;
    this.nextBlink = rand(1, 4);
    this.talking = false;
    this.talkPhase = 0;
    this.gazeTarget = null;
    this.apply();
  }

  setExpression(nameOrSpec, blendSpeed = 10) {
    this.target = resolve(nameOrSpec);
    this.blendSpeed = blendSpeed;
  }

  lookAt(worldPoint) {
    this.gazeTarget = worldPoint ? worldPoint.clone() : null;
  }

  setTalking(on) {
    this.talking = on;
  }

  update(dt) {
    // Blend towards the target expression
    const k = 1 - Math.exp(-this.blendSpeed * dt);
    const c = this.current, t = this.target;
    c.lids = lerp(c.lids, t.lids, k);
    for (const key of ['raise', 'angle', 'asym']) c.brows[key] = lerp(c.brows[key], t.brows[key], k);
    for (const key of ['smile', 'open', 'width', 'asym']) c.mouth[key] = lerp(c.mouth[key], t.mouth[key], k);

    // Blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = rand(...config.characters.blinkInterval);
    }
    this.blink = Math.max(0, this.blink - dt / 0.14);

    // Talking: the mouth opens and closes irregularly
    this.talkPhase += dt * 11;
    this.talkOpen = this.talking ? Math.max(0, Math.sin(this.talkPhase) * 0.5 + Math.sin(this.talkPhase * 2.3) * 0.25) : 0;

    this.apply();
  }

  apply() {
    const c = this.current;
    // Lids: 0 = wide open, 1 = shut. A blink drives them shut briefly.
    const closed = clamp(Math.max(c.lids, Math.sin(this.blink * Math.PI)), 0, 1);
    for (const e of this.eyes) e.lid.rotation.x = lerp(-1.0, 1.55, closed);

    // Gaze (eyes only, limited)
    for (const e of this.eyes) {
      if (this.gazeTarget) {
        const local = e.socket.worldToLocal(this.gazeTarget.clone());
        const yaw = clamp(Math.atan2(local.x, local.z), -0.45, 0.45);
        const pitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.3, 0.3);
        e.ball.rotation.set(pitch, yaw, 0, 'YXZ');
      } else {
        e.ball.rotation.set(0, 0, 0);
      }
    }

    // Brows: side 1 is her left. asym > 0 lifts her left brow more (one-brow raise).
    for (const b of this.brows) {
      const lift = c.brows.raise + (b.side === 1 ? c.brows.asym : 0);
      b.pivot.position.y = b.baseY + lift;
      // Inner end is towards x = 0: on her left (+x) that's the -x end, so tilt the other way
      b.pivot.rotation.z = -b.side * c.brows.angle;
    }

    // Mouth
    const open = clamp(c.mouth.open + (this.talkOpen ?? 0), 0, 1);
    const w = 0.05 * c.mouth.width;
    this.mouthGap.scale.set(w, 0.006 + open * 0.034, 0.012);
    this.lip.scale.x = 0.042 * c.mouth.width;
    this.lip.position.y = -0.008 - open * 0.016;
    for (const cn of this.corners) {
      cn.pivot.position.x = cn.side * w * 0.5;
      // smile > 0 lifts the corners; asym > 0 lifts her left corner more (a smirk)
      const s = c.mouth.smile + (cn.side === 1 ? c.mouth.asym : 0);
      cn.pivot.rotation.z = cn.side * s * 1.3;
    }
  }
}

/** Turn a preset name or partial spec into a full expression. */
function resolve(spec) {
  const presets = config.characters.expressions;
  const base = presets.neutral;
  const e = typeof spec === 'string' ? presets[spec] ?? base : spec;
  return {
    lids: e.lids ?? base.lids,
    brows: { raise: 0, angle: 0, asym: 0, ...base.brows, ...e.brows },
    mouth: { smile: 0, open: 0, width: 1, asym: 0, ...base.mouth, ...e.mouth },
  };
}
