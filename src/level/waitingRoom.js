import * as THREE from 'three';
import { config } from '../config.js';
import { theme } from '../theme.js';
import { seeded } from '../util/random.js';
import { partGeometry } from '../characters/partShapes.js';

const mat = (name, opts) => theme.material(name, opts);
import { createClock } from './clock.js';
import { createNowServing } from './nowServing.js';
import * as P from './props.js';
const surf = (name, opts) => theme.surface(name, opts);

/*
  Layout (metres). Origin = centre of the floor. The player enters from the south (+z)
  and looks north (-z).

            north wall (z = -5)
   ┌──────────────────────────────────────────────┐
   │ cabinets│ [reception desk]  clock   NOW    [ACCOUNTANT]  cooler
   │─────────┘ (receptionist behind)     SERVING  [PRIVATE  ]
   │ chairs                                         chairs │
   │ chairs                                    side table  │
   │ chairs                                         chairs │
   │ plant              [entrance]  umbrella stand   plant │
   └──────────────────────────────────────────────┘
            south wall (z = +5)
*/

export function buildWaitingRoom(scene, physics) {
  const { width: W, depth: D, height: H } = config.room;
  const hw = W / 2, hd = D / 2;
  const anchors = { chairs: [] };
  const updaters = [];

  // ---------- helpers ----------
  const box = (w, h, d, material, x, y, z, parent = scene) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const cyl = (rt, rb, h, material, x, y, z, parent = scene, seg = 16) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  /**
   * Something to pick up and fight with (or throw): built by `build` into a group, centred, set down with its bottom
   * at (x, y, z), turned by yaw, and given a physics body its size (anchors.officeItems; the level makes it a weapon).
   * density: kg/m³ (heavier things hurt more and fly less); sound: what it sounds like landing (sfx.propHit).
   */
  anchors.officeItems = [];
  const office = (kind, build, x, y, z, yaw = 0, { density = 400, sound } = {}) => {
    const g = new THREE.Group();
    build(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    for (const ch of g.children) ch.position.sub(c);
    g.position.set(x, y + size.y / 2 + 0.002, z);
    g.rotation.y = yaw;
    scene.add(g);
    physics.addDynamic(g, [{ type: 'box', half: { x: Math.max(0.01, size.x / 2), y: Math.max(0.01, size.y / 2), z: Math.max(0.01, size.z / 2) } }], { density, angularDamping: 0.6 });
    if (sound) g.userData.impactSound = sound;
    anchors.officeItems.push({ object: g, kind });
    return g;
  };
  const staticBox = (cx, cy, cz, hx, hy, hz, yaw = 0) =>
    physics.addStaticBox({ x: cx, y: cy, z: cz }, { x: hx, y: hy, z: hz }, yaw);

  // ---------- floor, ceiling, walls ----------
  const carpetTex = theme.canvasTexture(64, 64, (g, w, h) => {
    const rnd = seeded(7);
    g.fillStyle = theme.css('carpet');
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? theme.css('carpetFleckDark') : v < 0.85 ? theme.css('carpetFleckMid') : theme.css('carpetFleckLight');
      g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    }
  }, { repeat: [W / 1.2, D / 1.2] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), surf('carpet', { repeat: [W / 1.4, D / 1.4] }));
  carpetTex.dispose();
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  staticBox(0, -0.25, 0, hw + 1, 0.25, hd + 1);

  const ceilTex = theme.canvasTexture(32, 32, (g, w, h) => {
    g.fillStyle = theme.css('ceilingTile');
    g.fillRect(0, 0, w, h);
    const rnd = seeded(3);
    g.fillStyle = theme.css('ceilingSpeck');
    for (let i = 0; i < 40; i++) g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    g.fillStyle = theme.css('ceilingGrid');
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  }, { repeat: [W / 0.6, D / 0.6] });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), theme.textured(ceilTex, { lit: true }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  scene.add(ceiling);

  // (textures sized to each piece of wall: painted plaster, and beadboard with a groove every 10 cm)
  const wallMat = (len) => surf('wall', { repeat: [Math.max(0.2, Math.round(len / 1.5 * 4) / 4), 2] });
  const wainscotMat = (len) => surf('wainscot', { repeat: [Math.max(0.2, Math.round(len / 0.6 * 4) / 4), 1] });
  const railMat = surf('woodDark', { repeat: [8, 0.2] });
  const baseMat = surf('woodDark', { repeat: [8, 0.2] });
  const T = 0.2; // wall thickness

  // Each wall: centre, length, inward normal, and door openings (centre along the wall, width, height).
  // Openings are real holes, so doors can open onto something.
  const EMP_DOOR = { x: -3.9, w: 0.95, h: 2.15 };  // EMPLOYEES ONLY, behind the reception desk
  const ACC_DOOR = { x: 3.6, w: 1.02, h: 2.12 };   // ACCOUNTANT - PRIVATE
  const walls = [
    { x: 0, z: -hd - T / 2, len: W + 2 * T, normal: new THREE.Vector3(0, 0, 1), openings: [EMP_DOOR, ACC_DOOR] }, // north
    { x: 0, z: hd + T / 2, len: W + 2 * T, normal: new THREE.Vector3(0, 0, -1), openings: [{ x: 0, w: 1.02, h: 2.12 }] }, // south (entrance)
    { x: -hw - T / 2, z: 0, len: D, normal: new THREE.Vector3(1, 0, 0), openings: [] },                           // west
    { x: hw + T / 2, z: 0, len: D, normal: new THREE.Vector3(-1, 0, 0), openings: [] },                           // east
  ];
  /** Pieces of [a, b] left after cutting out the openings. */
  const spans = (a, b, openings) => {
    const out = [];
    let cur = a;
    for (const o of [...openings].sort((p, q) => p.x - q.x)) {
      if (o.x - o.w / 2 > cur) out.push([cur, o.x - o.w / 2]);
      cur = Math.max(cur, o.x + o.w / 2);
    }
    if (b > cur) out.push([cur, b]);
    return out;
  };
  for (const w of walls) {
    const alongX = w.normal.z !== 0;
    // A strip along the wall from u0 to u1 (wall coordinate), at height y..y+h, depth d, pushed `off` into the room
    const strip = (u0, u1, y, h, d, off, material) => {
      const len = u1 - u0, mid = (u0 + u1) / 2;
      const cx = alongX ? w.x + mid : w.x + w.normal.x * off;
      const cz = alongX ? w.z + w.normal.z * off : w.z + mid;
      return box(alongX ? len : d, h, alongX ? d : len, material, cx, y + h / 2, cz);
    };
    const half = w.len / 2;
    for (const [u0, u1] of spans(-half, half, w.openings)) strip(u0, u1, 0, H, T, 0, wallMat(u1 - u0));
    for (const o of w.openings) strip(o.x - o.w / 2, o.x + o.w / 2, o.h, H - o.h, T, 0, wallMat(o.w)); // header above the door
    // Colliders: one per solid span, so doorways can be walked through (each door has its own collider)
    const solid = (u0, u1, y0, y1) => {
      const len = u1 - u0, mid = (u0 + u1) / 2;
      const cx = alongX ? w.x + mid : w.x, cz = alongX ? w.z : w.z + mid;
      staticBox(cx, (y0 + y1) / 2, cz, (alongX ? len : T) / 2 + (alongX ? 0 : 0.05), (y1 - y0) / 2, (alongX ? T : len) / 2 + (alongX ? 0.05 : 0));
    };
    for (const [u0, u1] of spans(-half, half, w.openings)) solid(u0, u1, -1, H + 1);
    for (const o of w.openings) solid(o.x - o.w / 2, o.x + o.w / 2, o.h, H + 1);
    // Mint wainscot, wooden chair rail, dark baseboard (slightly proud of the wall), broken by doors
    const inner = alongX ? half - T : half;
    for (const [u0, u1] of spans(-inner, inner, w.openings)) {
      strip(u0, u1, 0, 0.9, 0.02, T / 2 + 0.01, wainscotMat(u1 - u0));
      strip(u0, u1, 0.895, 0.05, 0.04, T / 2 + 0.025, railMat);
      strip(u0, u1, 0, 0.1, 0.03, T / 2 + 0.02, baseMat);
    }
  }

  // ---------- EMPLOYEES ONLY door and the back room behind it ----------
  {
    const dx = EMP_DOOR.x, wallFace = -hd;
    // Casing round the opening
    { const c = new THREE.Group(); c.position.set(dx, 0, wallFace); scene.add(c); P.buildCasing(c, EMP_DOOR.w, EMP_DOOR.h); }
    // Door, hinged on its west edge, swinging into the back room
    const pivot = new THREE.Group();
    pivot.position.set(dx - EMP_DOOR.w / 2 + 0.02, 0, wallFace - 0.03);
    scene.add(pivot);
    box(EMP_DOOR.w - 0.04, EMP_DOOR.h - 0.03, 0.045, surf('doorWood', { repeat: [1, 2] }), (EMP_DOOR.w - 0.04) / 2, (EMP_DOOR.h - 0.03) / 2, 0, pivot);
    const knob = new THREE.Group();
    knob.position.set(EMP_DOOR.w - 0.14, 1.0, 0.0225);
    pivot.add(knob);
    P.buildKnob(knob, surf('steel'));
    P.buildHinges(pivot, 0.0, 0.025, EMP_DOOR.h - 0.03, surf('steel'));
    const signTex = theme.canvasTexture(160, 48, (c, w, h) => {
      c.fillStyle = theme.css('paperWhite'); c.fillRect(0, 0, w, h);
      c.strokeStyle = theme.css('inkRed'); c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6);
      c.fillStyle = theme.css('inkRed'); c.font = 'bold 17px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('EMPLOYEES ONLY', w / 2, h / 2 + 1);
    });
    box(0.46, 0.14, 0.01, theme.textured(signTex), (EMP_DOOR.w - 0.04) / 2, 1.6, 0.028, pivot);

    // A small, dim back room: floor, ceiling, three walls
    const bx = dx, bz = wallFace - T - 0.8, bw = 1.6, bd = 1.6, bh = 2.4;
    const back = mat('backRoom');
    box(bw, 0.02, bd, mat('backRoomFloor'), bx, 0.0, bz);
    box(bw, 0.02, bd, back, bx, bh, bz);
    box(0.05, bh, bd, back, bx - bw / 2, bh / 2, bz);
    box(0.05, bh, bd, back, bx + bw / 2, bh / 2, bz);
    box(bw, bh, 0.05, back, bx, bh / 2, bz - bd / 2);
    // A shelf with a coffee machine, glimpsed through the door
    box(0.7, 0.05, 0.35, mat('woodDark'), bx + 0.3, 0.95, bz - bd / 2 + 0.2);
    box(0.22, 0.32, 0.22, mat('black'), bx + 0.3, 1.13, bz - bd / 2 + 0.2);
    // Colliders for its walls, so you can't walk out of the back of it
    staticBox(bx - bw / 2, bh / 2, bz, 0.05, bh / 2, bd / 2);
    staticBox(bx + bw / 2, bh / 2, bz, 0.05, bh / 2, bd / 2);
    staticBox(bx, bh / 2, bz - bd / 2, bw / 2, bh / 2, 0.05);
    // ...and a floor (from the doorway threshold to the back wall)
    staticBox(bx, -0.05, (wallFace + bz - bd / 2) / 2, bw / 2, 0.05, (wallFace - (bz - bd / 2)) / 2);

    // Things to fight with, kept back here (owner: the bat lives in the back room, with some others).
    // Each group's origin is where you'd hold it.
    anchors.backRoomWeapons = [];
    {
      // Baseball bat, leaning in the corner: origin at the grip end
      const bat = new THREE.Group();
      bat.position.set(bx - bw / 2 + 0.12, 0.02, bz - bd / 2 + 0.15);
      bat.rotation.set(0.2, 0, -0.2);
      scene.add(bat);
      cyl(0.017, 0.017, 0.2, mat('batGrip'), 0, 0.1, 0, bat);
      cyl(0.036, 0.02, 0.66, mat('batWood'), 0, 0.53, 0, bat);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8), mat('batWood'));
      cap.position.y = 0.86;
      bat.add(cap);
      physics.addDynamic(bat, [{ type: 'cylinder', halfHeight: 0.43, radius: 0.03, offset: { x: 0, y: 0.45, z: 0 } }], { density: 700 });
      anchors.backRoomWeapons.push({ object: bat, kind: 'bat' });
    }
    {
      // Mop, leaning against the side wall: origin at the top of the handle
      const mop = new THREE.Group();
      mop.position.set(bx + bw / 2 - 0.15, 1.3, bz + 0.2);
      mop.rotation.set(0, 0, -0.12);
      scene.add(mop);
      cyl(0.013, 0.013, 1.2, mat('mopHandle'), 0, -0.6, 0, mop);
      cyl(0.09, 0.13, 0.12, mat('mopHead'), 0, -1.24, 0, mop, 10);
      physics.addDynamic(mop, [
        { type: 'cylinder', halfHeight: 0.6, radius: 0.02, offset: { x: 0, y: -0.6, z: 0 } },
        { type: 'cylinder', halfHeight: 0.06, radius: 0.11, offset: { x: 0, y: -1.24, z: 0 } },
      ], { density: 300 });
      anchors.backRoomWeapons.push({ object: mop, kind: 'mop' });
    }
    {
      // Fire extinguisher on the floor: origin at the handle on top
      const ext = new THREE.Group();
      ext.position.set(bx - 0.35, 0.5, bz + 0.45);
      scene.add(ext);
      cyl(0.075, 0.075, 0.42, mat('extinguisherRed'), 0, -0.25, 0, ext);
      cyl(0.03, 0.04, 0.06, mat('black'), 0, -0.02, 0, ext);
      box(0.12, 0.015, 0.025, mat('black'), 0.03, 0.02, 0, ext);
      physics.addDynamic(ext, [{ type: 'cylinder', halfHeight: 0.24, radius: 0.075, offset: { x: 0, y: -0.25, z: 0 } }], { density: 900 });
      anchors.backRoomWeapons.push({ object: ext, kind: 'extinguisher' });
    }

    anchors.employeeDoor = {
      pivot,
      openAngle: 1.6,
      // Walking route from behind the desk, through the door, out of sight
      front: new THREE.Vector3(dx + 0.1, 0, wallFace + 0.55),
      threshold: new THREE.Vector3(dx + 0.1, 0, wallFace - 0.1),
      inside: new THREE.Vector3(dx + 0.1, 0, wallFace - 0.75),
      behindDesk: new THREE.Vector3(-3.05, 0, -4.35),
    };
  }

  // ---------- light fixtures (the theme decides what light they emit) ----------
  const fixtures = [{ x: -3, z: -2.5 }, { x: 3, z: -2.5 }, { x: -3, z: 2 }, { x: 3, z: 2 }];
  for (const f of fixtures) {
    // A recessed troffer: a white steel frame, the glowing panel, a grid of louvres in front of it
    box(1.3, 0.04, 0.7, surf('coolerBody'), f.x, H - 0.02, f.z);
    box(1.2, 0.02, 0.6, theme.unlit('lightPanel'), f.x, H - 0.045, f.z);
    for (let i = -2; i <= 2; i++) box(0.012, 0.03, 0.6, surf('chrome'), f.x + i * 0.24, H - 0.06, f.z);
    for (let i = -1; i <= 1; i++) box(1.2, 0.03, 0.012, surf('chrome'), f.x, H - 0.06, f.z + i * 0.2);
  }
  theme.setupLighting(scene, { ceilingFixtures: fixtures, ceilingHeight: H });

  // ---------- entrance door (south wall, behind the player) ----------
  {
    const g = new THREE.Group();
    g.position.set(0, 0, hd - 0.01);
    g.rotation.y = Math.PI; // local +z faces into the room
    scene.add(g);
    // Frame around a real opening (jambs and header)
    P.buildCasing(g, 1.02, 2.12, { width: 0.085 });
    // The door itself, hinged on the side away from the handle; it swings into the room
    const pivot = new THREE.Group();
    pivot.position.set(-0.5, 0, 0.03);
    g.add(pivot);
    box(1.0, 2.1, 0.05, surf('doorWood', { repeat: [1, 2] }), 0.5, 1.05, 0, pivot);
    // Frosted glass with the office name, mirrored because we see it from inside
    const glassTex = theme.canvasTexture(128, 160, (c, w, h) => {
      c.fillStyle = theme.css('frostedGlass');
      c.fillRect(0, 0, w, h);
      c.save();
      c.scale(-1, 1);
      c.fillStyle = theme.css('inkDark');
      c.textAlign = 'center';
      c.font = 'bold 13px monospace';
      c.fillText('TAX', -w / 2, 40);
      c.fillText('PREPARATION', -w / 2, 58);
      c.fillText('SERVICES', -w / 2, 76);
      c.font = '10px monospace';
      c.fillText('HOURS 9 - 5', -w / 2, 110);
      c.fillText('BY APPOINTMENT', -w / 2, 124);
      c.restore();
    });
    box(0.7, 0.9, 0.02, theme.textured(glassTex, { lit: true }), 0.5, 1.45, 0.03, pivot); // (frosted glass: lit, not glowing)
    const handle = cyl(0.018, 0.018, 0.14, surf('chrome'), 0.88, 1.0, 0.06, pivot);
    handle.rotation.x = Math.PI / 2;

    // Outside: a short corridor, glimpsed when the door opens
    const cz = hd + T + 1.0, corridor = mat('corridor');
    box(2.4, 0.02, 2.0, mat('corridorFloor'), 0, 0.0, cz);
    box(2.4, 0.02, 2.0, corridor, 0, 2.6, cz);
    box(0.05, 2.6, 2.0, corridor, -1.2, 1.3, cz);
    box(0.05, 2.6, 2.0, corridor, 1.2, 1.3, cz);
    box(2.4, 2.6, 0.05, corridor, 0, 1.3, cz + 1.0);

    // The entrance stays shut for the player (the newcomer walks in; nobody walks out)
    staticBox(0, 1.06, hd + T / 2, 0.52, 1.06, 0.12);
    anchors.entrance = {
      pivot,
      openAngle: -1.5,
      threshold: new THREE.Vector3(0, 0, hd),
      outside: new THREE.Vector3(0, 0, hd + 1.3),
      inside: new THREE.Vector3(0, 0, hd - 0.8),
    };
    // Floor mat
    const doormat = P.rbox(1.2, 0.012, 0.7, 0.005, surf('doormat'), 0, 0.006, hd - 0.5, scene);
    doormat.name = 'doormat';
  }

  // ---------- reception desk (north-west) ----------
  {
    const veneer = surf('woodVeneer', { repeat: [3, 1] });
    const veneerDark = surf('woodDark', { repeat: [3, 0.3] });
    const x0 = -4.6, x1 = -1.0, cx = (x0 + x1) / 2, dw = x1 - x0;
    // Front panel + transaction ledge
    box(dw, 1.1, 0.1, veneer, cx, 0.55, -2.78);
    P.rbox(dw + 0.06, 0.04, 0.34, 0.012, surf('laminate', { repeat: [4, 0.4] }), cx, 1.12, -2.86, scene);
    // Kick plate
    box(dw, 0.08, 0.02, mat('black'), cx, 0.04, -2.72);
    // Vertical veneer strips on the front for that 1987 look
    for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.6) box(0.03, 1.0, 0.01, veneerDark, x, 0.55, -2.725);
    // Work surface behind
    P.rbox(dw, 0.04, 0.72, 0.01, surf('laminate', { repeat: [4, 0.8] }), cx, 0.74, -3.3, scene);
    // Return along the east side: short, leaving a staff gap to the back wall (the way behind the desk,
    // to the EMPLOYEES ONLY door and the back room)
    P.rbox(0.6, 0.04, 0.5, 0.01, surf('laminate'), -1.3, 0.74, -3.89, scene);
    box(0.04, 0.72, 0.5, veneer, -1.02, 0.36, -3.89);
    staticBox(cx, 0.6, -3.2, dw / 2, 0.6, 0.48);
    staticBox(-1.3, 0.4, -3.89, 0.3, 0.4, 0.25);

    // Nameplate on the ledge
    const plateTex = theme.canvasTexture(128, 24, (c, w, h) => {
      c.fillStyle = theme.css('nameplate'); c.fillRect(0, 0, w, h);
      c.fillStyle = theme.css('nameplateText'); c.font = 'bold 14px monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('RECEPTION', w / 2, h / 2 + 1);
    });
    const plate = box(0.4, 0.075, 0.02, theme.textured(plateTex), -3.6, 1.18, -2.72);
    plate.rotation.x = -0.35;

    // CRT computer, facing the receptionist (screen towards -z)
    const crt = new THREE.Group();
    // Her workstation is angled off to her right, so a glance at the player reads as a real head turn
    const deskYaw = -0.6; // her facing: +z rotated towards -x
    crt.position.set(-3.096, 0.76, -3.329); // (far enough from the counter that its back doesn't go through it)
    crt.rotation.y = Math.PI + deskYaw; // screen faces her
    scene.add(crt);
    const solitaireTex = theme.canvasTexture(256, 192, (c) => {
      c.scale(4, 4); // (drawn at 64 x 48, four times sharper)
      const w = 64, h = 48;
      c.fillStyle = theme.css('feltGreen'); c.fillRect(0, 0, w, h);
      const rnd = seeded(11);
      for (let col = 0; col < 7; col++) {
        for (let r = 0; r <= col; r++) {
          const faceUp = r === col;
          c.fillStyle = faceUp ? theme.css('cardFace') : theme.css('cardBack');
          c.fillRect(3 + col * 8.5, 14 + r * 3, 7, 9);
          if (faceUp) { c.fillStyle = rnd() > 0.5 ? theme.css('cardRed') : theme.css('cardBlack'); c.fillRect(4 + col * 8.5, 15 + r * 3, 2, 2); }
        }
      }
      for (let i = 0; i < 4; i++) { c.strokeStyle = theme.css('feltOutline'); c.strokeRect(33 + i * 7.5, 2.5, 6, 9); }
      c.fillStyle = theme.css('cardBack'); c.fillRect(3, 2, 7, 9);
    });
    const screen = P.buildComputer(crt, theme.textured(solitaireTex)); // (the PC and its monitor: props.js)
    anchors.crt = crt;
    anchors.crtScreen = screen;

    // Keyboard and mouse (in front of the receptionist)
    const kbTex = theme.canvasTexture(64, 24, (c, w, h) => {
      c.fillStyle = theme.css('crtBeige'); c.fillRect(0, 0, w, h);
      c.fillStyle = theme.css('keycap');
      for (let r = 0; r < 5; r++) for (let k = 0; k < 15; k++) c.fillRect(2 + k * 4, 2 + r * 4, 3, 3);
      c.fillRect(14, 22, 30, 1);
    });
    const keyboard = new THREE.Group();
    keyboard.position.set(-2.93, 0.775, -3.55);
    keyboard.rotation.y = Math.PI + deskYaw;
    scene.add(keyboard);
    P.buildKeyboard(keyboard);
    kbTex.dispose();
    anchors.keyboard = keyboard;

    // Mouse on her right (she faces +z, so her right is -x)
    P.rbox(0.22, 0.005, 0.18, 0.002, surf('mousepad'), -3.21, 0.763, -3.58, scene).rotation.y = deskYaw; // mousepad
    const mouse = new THREE.Group();
    mouse.position.set(-3.21, 0.78, -3.58);
    mouse.rotation.y = deskYaw;
    scene.add(mouse);
    P.buildMouse(mouse);
    anchors.mouse = mouse;

    // Desk clutter
    // Desk clutter: stacks of papers, an in-tray, a mug, the phone
    for (let i = 0; i < 6; i++) box(0.215, 0.006, 0.28, surf('paper'), -3.9 + (i % 2) * 0.006, 0.765 + i * 0.007, -3.3, scene).rotation.y = 0.2 - i * 0.03;
    {
      const tray = new THREE.Group();
      tray.position.set(-4.3, 0.765, -3.35);
      scene.add(tray);
      const k = surf('plasticBlack');
      box(0.3, 0.008, 0.36, k, 0, 0.004, 0, tray);
      for (const sx of [-1, 1]) box(0.008, 0.07, 0.36, k, sx * 0.146, 0.035, 0, tray);
      box(0.3, 0.07, 0.008, k, 0, 0.035, -0.176, tray);
      box(0.3, 0.035, 0.008, k, 0, 0.018, 0.176, tray);
      for (let i = 0; i < 4; i++) box(0.21, 0.005, 0.29, surf('paper'), 0, 0.012 + i * 0.006, 0, tray).rotation.y = (i - 1.5) * 0.04;
    }
    office('mug', P.buildMug, -1.7, 0.76, -3.4, 0, { density: 600 });                     // (hers: you can grab it in the brawl)
    office('phone', P.buildDeskPhone, -1.35, 0.76, -3.9, 0.5, { density: 500 });

    // Check-in sheet on a clipboard, on her left. She slides it onto the counter if you're on time.
    // The clip end points at her, so the sheet reads the right way up for the player.
    {
      const sheetTex = theme.canvasTexture(128, 176, (c, w, h) => {
        c.fillStyle = theme.css('paperWhite'); c.fillRect(0, 0, w, h);
        c.fillStyle = theme.css('inkBlack'); c.textAlign = 'center';
        c.font = 'bold 11px monospace'; c.fillText('CHECK-IN SHEET', w / 2, 34);
        c.font = '7px monospace'; c.textAlign = 'left';
        c.fillText('NAME', 8, 48); c.fillText('ARRIVED', 70, 48); c.fillText('APPT', 104, 48);
        c.strokeStyle = theme.css('inkBlack'); c.lineWidth = 0.5;
        const rnd = seeded(31);
        const arrived = ['8:58', '9:14', '10:41', '11:20', '1:47'];
        for (let r = 0; r < 11; r++) {
          const y = 60 + r * 10;
          c.beginPath(); c.moveTo(6, y + 2); c.lineTo(w - 6, y + 2); c.stroke();
          if (r < arrived.length) {
            // a signature squiggle, an arrival time, an appointment time
            c.strokeStyle = theme.css('inkBlue'); c.lineWidth = 0.8; c.beginPath(); c.moveTo(8, y);
            for (let x = 8; x < 58; x += 3) c.lineTo(x, y - 1 - rnd() * 5);
            c.stroke();
            c.fillStyle = theme.css('inkBlue'); c.fillText(arrived[r], 72, y); c.fillText(r === 4 ? '2:00' : '9:00', 104, y);
            c.strokeStyle = theme.css('inkBlack'); c.lineWidth = 0.5;
          }
        }
      });
      const clip = new THREE.Group();
      scene.add(clip);
      box(0.23, 0.012, 0.32, mat('clipboardBoard'), 0, 0, 0, clip);
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.29), theme.textured(sheetTex, { lit: true }));
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(0, 0.0065, 0.01);
      clip.add(sheet);
      box(0.1, 0.02, 0.04, mat('clipboardClip'), 0, 0.012, -0.135, clip);
      // Path: on the work surface by her left hand -> up onto the counter -> shoved to its front edge
      anchors.clipboard = clip;
      clip.userData.impactSound = 'paper';
      anchors.clipboardPath = {
        start: new THREE.Vector3(-2.2, 0.766, -3.42),
        lift: new THREE.Vector3(-2.3, 1.152, -3.02),
        end: new THREE.Vector3(-2.3, 1.152, -2.83),
      };
      clip.position.copy(anchors.clipboardPath.start);
      clip.rotation.y = 0.15;
    }

    // Receptionist's office chair
    const oc = new THREE.Group();
    oc.position.set(-2.65, 0, -3.98);
    oc.rotation.y = deskYaw;
    scene.add(oc);
    P.buildOfficeChair(oc);
    anchors.receptionistSeat = oc;
    anchors.receptionistSeatTop = 0.5;

    // Ticket dispenser on the ledge, east end
    const disp = new THREE.Group();
    disp.position.set(-1.35, 1.14, -2.86);
    scene.add(disp);
    P.buildTicketDispenser(disp);
    const signTex = theme.canvasTexture(96, 32, (c, w, h) => {
      c.fillStyle = theme.css('paperWhite'); c.fillRect(0, 0, w, h);
      c.fillStyle = theme.css('inkRed'); c.font = 'bold 11px monospace'; c.textAlign = 'center';
      c.fillText('PLEASE TAKE', w / 2, 13); c.fillText('A NUMBER', w / 2, 26);
    });
    box(0.18, 0.06, 0.005, theme.textured(signTex), 0, 0.335, 0.0, disp);
    anchors.ticketDispenser = disp;

    // Filing cabinets closing the gap between the desk and the west wall
    for (let i = 0; i < 3; i++) {
      const fx = -5.75 + i * 0.47;
      (anchors.cabinets ??= []).push(P.rbox(0.45, 1.3, 0.6, 0.008, surf('cabinetMetal'), fx, 0.65, -3.2, scene));
      for (let d = 0; d < 3; d++) {
        const dr = new THREE.Group();
        dr.position.set(fx, 1.08 - d * 0.42, -2.895);
        scene.add(dr);
        P.buildDrawer(dr, 0.45, 0.42);
      }
    }
    staticBox(-5.3, 0.65, -3.2, 0.72, 0.65, 0.3);
    // A dying spider plant on top
    const sp = new THREE.Group();
    sp.position.set(-5.3, 1.37, -3.2);
    scene.add(sp);
    P.buildPot(sp, 0.1, 0.14);
    P.buildFronds(sp, { y: 0.05, count: 14, length: 0.3, width: 0.025, arch: -0.18, droop: -0.08, material: surf('leafDying'), seed: 9, spread: 1.2 });
  }

  // ---------- clock and NOW SERVING on the north wall ----------
  const clock = createClock();
  clock.group.position.set(-0.4, 2.35, -hd);
  scene.add(clock.group);
  anchors.clock = clock.group;

  const nowServing = createNowServing(config.nowServing.initial);
  nowServing.group.position.set(1.4, 2.2, -hd);
  scene.add(nowServing.group);
  anchors.nowServing = nowServing.group;

  // ---------- accountant door (north wall, east) ----------
  {
    const doorX = 3.6;
    { const c = new THREE.Group(); c.position.set(doorX, 0, -hd); scene.add(c); P.buildCasing(c, 1.02, 2.12); }
    const pivot = new THREE.Group(); // hinge on the west edge, swings later
    pivot.position.set(doorX - 0.5, 0, -hd + 0.06);
    scene.add(pivot);
    box(1.0, 2.1, 0.05, surf('doorWood', { repeat: [1, 2] }), 0.5, 1.05, 0, pivot);
    for (const py of [0.55, 1.55]) { // raised panels with a moulding round them
      P.rbox(0.8, 0.7, 0.02, 0.008, surf('woodDark', { repeat: [1, 1] }), 0.5, py, 0.03, pivot);
      P.rbox(0.7, 0.6, 0.02, 0.02, surf('doorWood'), 0.5, py, 0.04, pivot);
    }
    const knob = new THREE.Group();
    knob.position.set(0.88, 1.0, 0.025);
    pivot.add(knob);
    P.buildKnob(knob, surf('brass'));
    P.buildHinges(pivot, 0.0, 0.03, 2.1);
    P.rbox(0.92, 0.2, 0.004, 0.002, surf('brass'), 0.5, 0.11, 0.027, pivot); // kick plate
    const plaqueTex = theme.canvasTexture(160, 40, (c, w, h) => {
      c.fillStyle = theme.css('brassPlaque'); c.fillRect(0, 0, w, h);
      c.strokeStyle = theme.css('brassPlaqueEdge'); c.lineWidth = 2; c.strokeRect(2, 2, w - 4, h - 4);
      c.fillStyle = theme.css('brassPlaqueText'); c.font = 'bold 16px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('ACCOUNTANT – PRIVATE', w / 2, h / 2 + 1);
    });
    box(0.56, 0.14, 0.01, theme.textured(plaqueTex), 0.5, 1.62, 0.04, pivot);
    anchors.accountantDoor = { pivot, collider: staticBox(doorX, 1.05, -hd + 0.06, 0.5, 1.05, 0.05) };
  }

  // ---------- waiting chairs (dynamic props) ----------
  const makeChair = (x, z, yaw) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    scene.add(g);
    // Chair faces local +z (where a seated person looks)
    P.buildWaitingChair(g);
    physics.addDynamic(g, [
      { type: 'box', half: { x: 0.25, y: 0.035, z: 0.24 }, offset: { x: 0, y: 0.45, z: 0 } },
      { type: 'box', half: { x: 0.25, y: 0.24, z: 0.03 }, offset: { x: 0, y: 0.78, z: -0.22 } },
      { type: 'box', half: { x: 0.23, y: 0.2, z: 0.21 }, offset: { x: 0, y: 0.21, z: 0 }, density: 60 },
    ], { density: 200, angularDamping: 1.0, linearDamping: 0.6 });
    g.userData.impactSound = 'metal';
    anchors.chairs.push({ object: g, occupant: null });
    return g;
  };
  for (const z of [-1.8, -1.1, -0.4, 0.3, 1.0]) makeChair(-hw + 0.45, z, Math.PI / 2);   // west row, facing east
  for (const z of [-1.8, -1.1, -0.4, 1.3, 2.0]) makeChair(hw - 0.45, z, -Math.PI / 2);   // east row, facing west

  // ---------- side table with magazines (east wall) ----------
  {
    const tx = hw - 0.4, tz = 0.45;
    P.rbox(0.5, 0.035, 0.55, 0.01, surf('woodVeneer'), tx, 0.5, tz, scene);
    P.rbox(0.44, 0.06, 0.49, 0.005, surf('woodDark'), tx, 0.46, tz, scene); // apron
    for (const [lx, lz] of [[-0.21, -0.23], [0.21, -0.23], [-0.21, 0.23], [0.21, 0.23]]) {
      P.cylinder(0.018, 0.013, 0.48, surf('woodDark'), tx + lx, 0.24, tz + lz, scene, 12);
    }
    staticBox(tx, 0.26, tz, 0.25, 0.26, 0.275);
    const covers = [
      ['TAX', 'QUARTERLY', 'magazineRed'],
      ['FORMS', 'TODAY', 'magazineBlue'],
      ['AUDIT', 'LIVING', 'magazineAvocado'],
      ['LEDGER', 'MAR 1987', 'magazineMustard'],
    ];
    covers.forEach(([a, b, col], i) => {
      const tex = theme.canvasTexture(42, 56, (c, w, h) => {
        c.fillStyle = theme.css(col); c.fillRect(0, 0, w, h);
        c.fillStyle = theme.css('paperWhite'); c.font = 'bold 10px monospace'; c.textAlign = 'center';
        c.fillText(a, w / 2, 14);
        c.font = '7px monospace'; c.fillText(b, w / 2, 24);
        c.fillStyle = theme.css('magazineHighlight', 0.35); c.fillRect(8, 30, w - 16, 18);
      });
      const mg = new THREE.Group();
      // A loose pile at the back of the table (the radio sits at the front)
      mg.position.set(tx + 0.1 + (i % 2 ? 0.02 : -0.02), 0.53 + i * 0.012, tz + (i % 2 ? 0.03 : -0.03));
      mg.rotation.y = (i - 1.5) * 0.3;
      scene.add(mg);
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.01, 0.28), [
        mat('paperWhite'), mat('paperWhite'), theme.textured(tex, { lit: true }), mat('paperWhite'), mat('paperWhite'), mat('paperWhite'),
      ]);
      // Cover faces up (+y is material index 2)
      mg.add(page);
      physics.addDynamic(mg, [{ type: 'box', half: { x: 0.105, y: 0.005, z: 0.14 } }], { density: 700 });
      mg.userData.impactSound = 'paper';
      (anchors.magazines ??= []).push(mg);
    });

    // A small 1980s radio at the front edge of the table, dial facing the room (-x).
    // Turned on by one of the waiting people at config.radio.at seconds.
    const radio = new THREE.Group();
    radio.position.set(tx - 0.12, 0.52, tz);
    radio.rotation.y = -Math.PI / 2; // local +z (its front) faces the room
    scene.add(radio);
    const caseMesh = new THREE.Mesh(partGeometry('rounded', 'trim', 0.32, 0.17, 0.11), mat('radioCase'));
    caseMesh.position.y = 0.085;
    radio.add(caseMesh);
    const grille = box(0.15, 0.11, 0.01, mat('radioGrille'), -0.07, 0.09, 0.056, radio);
    grille.name = 'radioGrille';
    const dial = box(0.11, 0.04, 0.01, theme.unlit('radioDialOff'), 0.085, 0.115, 0.056, radio);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 14), mat('black'));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.085, 0.055, 0.062);
    radio.add(knob);
    const handle = box(0.2, 0.015, 0.015, mat('metalGrey'), 0, 0.18, 0, radio);
    handle.name = 'radioHandle';
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.3, 6), mat('metalGrey'));
    antenna.position.set(0.13, 0.3, -0.03);
    antenna.rotation.z = -0.35;
    radio.add(antenna);
    anchors.radio = {
      group: radio,
      knob,
      speaker: grille,
      turnOn() { dial.material = theme.unlit('radioDialOn'); },
      turnOff() { dial.material = theme.unlit('radioDialOff'); },
      // Where someone stands to reach it, and which way they face (towards the wall, +x)
      standSpot: new THREE.Vector3(tx - 0.6, 0, tz),
      faceYaw: Math.PI / 2,
    };
  }

  // ---------- potted plants (dynamic pots) ----------
  const makePlant = (x, z, tall) => {
    const g = new THREE.Group();
    g.position.set(x, 0.22, z);
    scene.add(g);
    P.buildPot(g, 0.2, 0.44);
    if (tall) P.buildRubberPlant(g, { y0: 0.2, height: 1.3, seed: 21 }); // (a rubber plant)
    else P.buildFronds(g, { y: 0.2, count: 22, length: 0.65, width: 0.06, arch: -0.25, material: surf('leaf'), seed: 5, spread: 0.75 }); // (a palm)
    physics.addDynamic(g, [{ type: 'cylinder', halfHeight: 0.22, radius: 0.19 }], { density: 400 });
    return g;
  };
  anchors.plants = [makePlant(-hw + 0.4, hd - 0.45, false), makePlant(hw - 0.4, hd - 0.45, true)];

  // ---------- water cooler (static base, dynamic bottle) ----------
  {
    const cx = hw - 0.4, cz = -hd + 0.45;
    const cab = new THREE.Group();
    cab.position.set(cx, 0, cz);
    scene.add(cab);
    P.buildCoolerCabinet(cab);
    staticBox(cx, 0.475, cz, 0.17, 0.475, 0.17);
    const bottle = new THREE.Group();
    bottle.position.set(cx, 0.95 + 0.22, cz);
    scene.add(bottle);
    P.buildCoolerBottle(bottle);
    physics.addDynamic(bottle, [{ type: 'cylinder', halfHeight: 0.22, radius: 0.14 }], { density: 500 });
    anchors.coolerBottle = bottle;
    // Paper cup dispenser on the wall
    const cups = new THREE.Group();
    cups.position.set(cx - 0.3, 1.1, -hd + 0.06);
    scene.add(cups);
    P.buildCupDispenser(cups);
  }

  // ---------- umbrella stand by the entrance (dynamic) ----------
  {
    const g = new THREE.Group();
    g.position.set(1.0, 0.27, hd - 0.35);
    scene.add(g);
    P.cylinder(0.13, 0.12, 0.54, surf('umbrellaStand'), 0, 0, 0, g, 28);
    P.cylinder(0.135, 0.135, 0.02, surf('chrome'), 0, 0.26, 0, g, 28);
    const umbrellaColors = ['umbrellaBlack', 'umbrellaMaroon'];
    umbrellaColors.forEach((c, i) => {
      const u = new THREE.Group();
      u.position.set(i ? 0.04 : -0.04, 0.2, 0);
      u.rotation.z = i ? -0.12 : 0.1;
      g.add(u);
      cyl(0.007, 0.007, 0.9, surf('chrome'), 0, 0, 0, u, 10);
      const canopy = P.furledCanopy(mat(c));
      canopy.rotation.x = Math.PI; // (the tip at the bottom)
      canopy.position.y = 0.05;
      u.add(canopy);
      P.cylinder(0.026, 0.026, 0.015, mat(c), 0, 0.12, 0, u, 16); // the strap round it
      P.cylinder(0.003, 0.002, 0.04, surf('chrome'), 0, -0.47, 0, u, 8); // the ferrule
      // The J handle
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.013, 10, 24, Math.PI), mat('umbrellaHandle'));
      hook.position.set(0.045, 0.45, 0);
      u.add(hook);
      P.cylinder(0.013, 0.013, 0.06, mat('umbrellaHandle'), 0, 0.42, 0, u, 12);
      (anchors.umbrellas ??= []).push(u);
    });
    physics.addDynamic(g, [{ type: 'cylinder', halfHeight: 0.27, radius: 0.13 }], { density: 250 });
    anchors.umbrellaStand = g;
  }

  // ---------- coat rack ----------
  {
    const rx = -1.2, rz = hd - 0.3;
    const tree = new THREE.Group();
    tree.position.set(rx, 0, rz);
    scene.add(tree);
    P.buildCoatTree(tree);
    // A coat hung on the hook facing the room (it hangs from its collar, a little off the post)
    const coat = new THREE.Group();
    coat.position.set(rx, 1.76, rz - 0.2);
    coat.rotation.set(0.12, Math.PI, 0.02); // (its back to the post, front to the room)
    scene.add(coat);
    P.buildHangingCoat(coat, surf('coatFabric'));
    anchors.coat = coat;
    staticBox(rx, 0.9, rz, 0.12, 0.9, 0.12);
  }

  // ---------- fittings: ceiling vents, smoke detector, sprinklers; outlets, a switch, the thermostat ----------
  {
    const at = (fn, x, y, z, ry = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); fn(g); return g; };
    for (const [x, z] of [[0, -2.5], [0, 2.3]]) at(P.buildVent, x, H - 0.008, z);
    at(P.buildSmokeDetector, 0.3, H, 0);
    for (const [x, z] of [[-3, 0], [3, 0], [-1.5, -3.6], [1.5, 3.6]]) at(P.buildSprinkler, x, H, z);
    // Wall plates (each group faces into the room: +z rotated by ry)
    const plate = (kind) => (g) => P.buildWallPlate(g, kind);
    at(plate('switch'), 0.75, 1.2, hd, Math.PI);                  // by the entrance
    at(plate('outlet'), -2.5, 0.3, hd, Math.PI);
    at(plate('outlet'), -hw, 0.3, -2.4, Math.PI / 2);
    at(plate('outlet'), hw, 0.3, 1.7, -Math.PI / 2);
    at(plate('outlet'), 2.2, 0.3, -hd, 0);
    at(plate('thermostat'), -0.95, 1.5, hd, Math.PI);
  }

  // ---------- the office table (south wall, west of the door): a spare computer, a printer, office things ----------
  {
    const tx = -3.6, tz = hd - 0.4, TH = 0.74;
    const table = new THREE.Group();
    table.position.set(tx, 0, tz);
    table.rotation.y = Math.PI; // (its front faces into the room)
    scene.add(table);
    P.buildOfficeTable(table, { w: 1.9, d: 0.7, h: TH });
    staticBox(tx, TH / 2, tz, 0.95, TH / 2, 0.35);
    // A spare PC, switched on, showing a spreadsheet
    const sheetTex = theme.canvasTexture(256, 192, (c, w, h) => {
      c.fillStyle = theme.css('ledBackground'); c.fillRect(0, 0, w, h);
      c.fillStyle = theme.css('ledGreen'); c.font = '11px monospace';
      c.fillText('A1: QUARTERLY ESTIMATES', 8, 16);
      for (let r = 0; r < 12; r++) for (let k = 0; k < 4; k++) c.fillText(String((r * 37 + k * 113) % 997).padStart(5, ' '), 12 + k * 60, 36 + r * 13);
    });
    office('computer', (g) => P.buildComputer(g, theme.textured(sheetTex)), tx + 0.55, TH, tz - 0.02, Math.PI, { density: 300 });
    office('keyboard', P.buildKeyboard, tx + 0.55, TH, tz - 0.22, Math.PI, { density: 500 });
    office('printer', P.buildPrinter, tx - 0.55, TH, tz - 0.02, Math.PI, { density: 260 });
    office('phone', P.buildDeskPhone, tx - 0.1, TH, tz + 0.05, Math.PI + 0.3, { density: 500 });
    office('calculator', P.buildCalculator, tx - 0.15, TH, tz - 0.2, Math.PI - 0.2, { density: 500 });
    office('stapler', P.buildStapler, tx + 0.12, TH, tz - 0.18, 0.4, { density: 1500, sound: 'metal' });
    office('mug', P.buildMug, tx + 0.22, TH, tz + 0.05, 0, { density: 600 });
    office('pencilCup', P.buildPencilCup, tx + 0.86, TH, tz + 0.05, 0, { density: 500 });
    office('tape', P.buildTapeDispenser, tx - 0.85, TH, tz - 0.22, 0.3, { density: 1200 });
    office('holePunch', P.buildHolePunch, tx + 0.02, TH, tz + 0.1, -0.3, { density: 1300, sound: 'metal' });
  }

  // ---------- filing cabinets (north and south walls) and a glass shelf (west wall), things on all of them ----------
  // (owner: the cabinets make it look more like an accountant's office; the shelf's glass breaks)
  anchors.glassPanels = [];
  {
    const shelves = [
      { x: -hw + 0.21, z: 2.7, yaw: Math.PI / 2 },        // west wall, past the chairs
    ];
    const cabinetBanks = [
      { x: 1.05, z: -hd + 0.3, yaw: 0, drawers: [4, 4] },         // north wall, under the clock and NOW SERVING
      { x: 3.0, z: hd - 0.3, yaw: Math.PI, drawers: [4, 3] },     // south wall, east of the door
    ];
    const rnd = seeded(41);
    // What's on them (a few things per shelf, at random)
    const stock = [
      ['binder', (g) => P.buildBinder(g, 'binderBlue'), 300], ['binder', (g) => P.buildBinder(g, 'binderRed'), 300],
      ['binder', (g) => P.buildBinder(g, 'binderBlack'), 300], ['trophy', P.buildTrophy, 1400], ['photoFrame', P.buildPhotoFrame, 500],
      ['mug', P.buildMug, 600], ['lamp', P.buildDeskLamp, 700], ['calculator', P.buildCalculator, 500], ['stapler', P.buildStapler, 1500],
    ];
    for (const [k, s] of shelves.entries()) {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
      scene.add(g);
      const panels = P.buildGlassShelf(g, { w: 1.0, d: 0.38 });
      g.updateMatrixWorld(true);
      // The frame's posts are solid; each sheet of glass is its own collider (gone when it breaks)
      for (const px of [-0.49, 0.49]) for (const pz of [-0.18, 0.18]) {
        const p = g.localToWorld(new THREE.Vector3(px, 0.85, pz));
        staticBox(p.x, p.y, p.z, 0.014, 0.85, 0.014, s.yaw);
      }
      for (const [i, pn] of panels.entries()) {
        const c = pn.mesh.getWorldPosition(new THREE.Vector3());
        const collider = staticBox(c.x, c.y, c.z, pn.half.x, pn.half.y, pn.half.z, s.yaw);
        pn.mesh.userData.glass = true;
        anchors.glassPanels.push({ mesh: pn.mesh, collider, center: c, half: pn.half, yaw: s.yaw, shelf: k, level: i });
        // Two or three things on each shelf
        const n = 2 + Math.floor(rnd() * 2);
        for (let j = 0; j < n; j++) {
          const [kind, build, density] = stock[Math.floor(rnd() * stock.length)];
          const lx = -0.32 + (j / Math.max(1, n - 1)) * 0.64 + (rnd() - 0.5) * 0.06;
          const at = g.localToWorld(new THREE.Vector3(lx, pn.y, (rnd() - 0.5) * 0.06));
          office(kind, build, at.x, at.y, at.z, s.yaw + (kind === 'binder' ? Math.PI / 2 : (rnd() - 0.5) * 0.6), { density, sound: kind === 'stapler' ? 'metal' : undefined });
        }
      }
    }
    // The cabinets: two side by side, solid, with office things on top (all of them can be picked up)
    const onTop = [
      ...stock,
      ['phone', P.buildDeskPhone, 700], ['pencilCup', P.buildPencilCup, 500], ['tape', P.buildTapeDispenser, 1200],
      ['holePunch', P.buildHolePunch, 1300],
    ];
    const CW = 0.46, CD = 0.6;
    for (const b of cabinetBanks) {
      const g = new THREE.Group();
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.yaw;
      scene.add(g);
      for (const [i, drawers] of b.drawers.entries()) {
        const c = new THREE.Group();
        c.position.x = (i - (b.drawers.length - 1) / 2) * (CW + 0.01);
        g.add(c);
        (anchors.cabinets ??= []).push(P.buildFilingCabinet(c, { w: CW, h: 0.34 * drawers - 0.04 + 0.06, d: CD, drawers }));
      }
      g.updateMatrixWorld(true);
      // One collider per cabinet (they're different heights), and three or four things on top of each
      for (const [i, drawers] of b.drawers.entries()) {
        const h = 0.34 * drawers + 0.02, lx = (i - (b.drawers.length - 1) / 2) * (CW + 0.01);
        const p = g.localToWorld(new THREE.Vector3(lx, h / 2, 0));
        staticBox(p.x, p.y, p.z, CW / 2, h / 2, CD / 2, b.yaw);
        const n = 2 + Math.floor(rnd() * 2);
        for (let j = 0; j < n; j++) {
          const [kind, build, density] = onTop[Math.floor(rnd() * onTop.length)];
          const at = g.localToWorld(new THREE.Vector3(lx + (j - (n - 1) / 2) * 0.15, h, -0.08 + (j % 2) * 0.16));
          office(kind, build, at.x, at.y, at.z, b.yaw + (kind === 'binder' ? Math.PI / 2 : (rnd() - 0.5) * 0.6), { density, sound: kind === 'stapler' || kind === 'holePunch' ? 'metal' : undefined });
        }
      }
    }
  }

  // ---------- wall decor ----------
  {
    const posterTex = theme.canvasTexture(96, 128, (c, w, h) => {
      c.fillStyle = theme.css('posterBlack'); c.fillRect(0, 0, w, h);
      c.fillStyle = theme.css('posterSky'); c.fillRect(8, 8, w - 16, 76);
      c.fillStyle = theme.css('posterMountain');
      c.beginPath(); c.moveTo(14, 84); c.lineTo(44, 30); c.lineTo(60, 56); c.lineTo(70, 44); c.lineTo(88, 84); c.fill();
      c.fillStyle = theme.css('paperWhite'); c.font = 'bold 14px monospace'; c.textAlign = 'center';
      c.fillText('PATIENCE', w / 2, 104);
      c.font = '7px monospace'; c.fillText('It is not a request.', w / 2, 118);
    });
    // West wall faces +x: BoxGeometry face 0 (+x) carries the poster
    (anchors.poster = box(0.02, 0.9, 0.68, mat('black'), -hw + 0.02, 1.75, -0.4)).material = [
      theme.textured(posterTex), mat('black'), mat('black'), mat('black'), mat('black'), mat('black'),
    ];

    const certTex = theme.canvasTexture(96, 72, (c, w, h) => {
      c.fillStyle = theme.css('certificatePaper'); c.fillRect(0, 0, w, h);
      c.strokeStyle = theme.css('certificateGold'); c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = theme.css('certificateInk'); c.font = 'bold 8px monospace'; c.textAlign = 'center';
      c.fillText('CERTIFICATE OF', w / 2, 22); c.fillText('CONTINUED OPERATION', w / 2, 32);
      c.font = '6px monospace'; c.fillText('Awarded 1984', w / 2, 48);
      c.fillStyle = theme.css('inkRed'); c.beginPath(); c.arc(w - 18, h - 16, 6, 0, Math.PI * 2); c.fill();
    });
    box(0.02, 0.4, 0.52, mat('woodDark'), hw - 0.015, 1.7, -1.1);
    (anchors.certificate = box(0.01, 0.34, 0.46, mat('woodDark'), hw - 0.03, 1.7, -1.1)).material = [
      mat('woodDark'), theme.textured(certTex), mat('woodDark'), mat('woodDark'), mat('woodDark'), mat('woodDark'),
    ];

    // A printed notice on the north wall, behind the receptionist (owner's request)
    const signTex = theme.canvasTexture(256, 112, (c, w, h) => {
      c.fillStyle = theme.css('paperWhite'); c.fillRect(0, 0, w, h);
      c.strokeStyle = theme.css('inkBlack'); c.lineWidth = 2; c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = theme.css('inkBlack'); c.textAlign = 'center';
      c.font = 'bold 14px monospace';
      ['PLEASE BE SURE TO ARRIVE', 'AT LEAST 5 MINUTES BEFORE', 'YOUR SCHEDULED APPOINTMENT.'].forEach((l, i) => c.fillText(l, w / 2, 30 + i * 19));
      c.fillStyle = theme.css('inkRed'); c.font = '9px monospace';
      c.fillText('Thank you. - The Management', w / 2, h - 14);
    });
    // North wall faces +z: BoxGeometry face 4 (+z) carries the sign
    (anchors.arrivalSign = box(0.72, 0.32, 0.01, mat('paperWhite'), -1.85, 1.75, -hd + 0.012)).material = [
      mat('paperWhite'), mat('paperWhite'), mat('paperWhite'), mat('paperWhite'), theme.textured(signTex), mat('paperWhite'),
    ];

    // A second notice, to her left, under the clock: the one she points at (beat 'protest')
    const walkInTex = theme.canvasTexture(224, 112, (c, w, h) => {
      c.fillStyle = theme.css('paperWhite'); c.fillRect(0, 0, w, h);
      c.strokeStyle = theme.css('inkBlack'); c.lineWidth = 2; c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = theme.css('inkBlack'); c.textAlign = 'center';
      c.font = 'bold 15px monospace';
      ['WALK-IN GUESTS', 'MUST TAKE', 'A TICKET.'].forEach((l, i) => c.fillText(l, w / 2, 32 + i * 21));
      c.fillStyle = theme.css('inkRed'); c.font = '9px monospace';
      c.fillText('No exceptions.', w / 2, h - 13);
    });
    (anchors.walkInSign = box(0.5, 0.25, 0.01, mat('paperWhite'), -1.15, 1.62, -hd + 0.012)).material = [
      mat('paperWhite'), mat('paperWhite'), mat('paperWhite'), mat('paperWhite'), theme.textured(walkInTex), mat('paperWhite'),
    ];
  }

  return {
    anchors,
    clock,
    nowServing,
    update(dt) { for (const u of updaters) u(dt); },
  };
}
