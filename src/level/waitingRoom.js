import * as THREE from 'three';
import { config } from '../config.js';
import { mat, basic, canvasTexture, seeded, hex, PALETTE as P } from './materials.js';
import { createClock } from './clock.js';
import { createNowServing } from './nowServing.js';

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
  const staticBox = (cx, cy, cz, hx, hy, hz, yaw = 0) =>
    physics.addStaticBox({ x: cx, y: cy, z: cz }, { x: hx, y: hy, z: hz }, yaw);

  // ---------- floor, ceiling, walls ----------
  const carpetTex = canvasTexture(64, 64, (g, w, h) => {
    const rnd = seeded(7);
    g.fillStyle = hex(P.carpet);
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? '#4e3727' : v < 0.85 ? '#6a4c37' : '#7a5a40';
      g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    }
  }, { repeat: [W / 1.2, D / 1.2] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xffffff, { map: carpetTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  staticBox(0, -0.25, 0, hw + 1, 0.25, hd + 1);

  const ceilTex = canvasTexture(32, 32, (g, w, h) => {
    g.fillStyle = hex(P.ceiling);
    g.fillRect(0, 0, w, h);
    const rnd = seeded(3);
    g.fillStyle = '#d4cdb8';
    for (let i = 0; i < 40; i++) g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    g.fillStyle = '#b9b4a2';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  }, { repeat: [W / 0.6, D / 0.6] });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xffffff, { map: ceilTex }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  scene.add(ceiling);

  const wallMat = mat(P.wallBeige);
  const wainscotMat = mat(P.mint);
  const railMat = mat(P.woodDark);
  const baseMat = mat(P.woodDark);
  const T = 0.2; // wall thickness

  // Each wall: [centre x, centre z, length, yaw of inward normal]
  const walls = [
    { x: 0, z: -hd - T / 2, len: W + 2 * T, normal: new THREE.Vector3(0, 0, 1) },  // north
    { x: 0, z: hd + T / 2, len: W + 2 * T, normal: new THREE.Vector3(0, 0, -1) },  // south
    { x: -hw - T / 2, z: 0, len: D, normal: new THREE.Vector3(1, 0, 0) },          // west
    { x: hw + T / 2, z: 0, len: D, normal: new THREE.Vector3(-1, 0, 0) },          // east
  ];
  for (const w of walls) {
    const alongX = w.normal.z !== 0;
    const sx = alongX ? w.len : T, sz = alongX ? T : w.len;
    box(sx, H, sz, wallMat, w.x, H / 2, w.z);
    staticBox(w.x, H / 2, w.z, sx / 2 + (alongX ? 0 : 0.05), H / 2 + 1, sz / 2 + (alongX ? 0.05 : 0));
    // Mint wainscot, wooden chair rail, dark baseboard (slightly proud of the wall)
    const off = (d) => ({ x: w.x + w.normal.x * (T / 2 + d), z: w.z + w.normal.z * (T / 2 + d) });
    const inner = alongX ? w.len - 2 * T : w.len;
    const ix = alongX ? inner : 0.02, iz = alongX ? 0.02 : inner;
    let p = off(0.01); box(ix, 0.9, iz, wainscotMat, p.x, 0.45, p.z);
    p = off(0.025); box(alongX ? inner : 0.04, 0.05, alongX ? 0.04 : inner, railMat, p.x, 0.92, p.z);
    p = off(0.02); box(alongX ? inner : 0.03, 0.1, alongX ? 0.03 : inner, baseMat, p.x, 0.05, p.z);
  }

  // ---------- lighting ----------
  const L = config.lighting;
  scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity));
  scene.add(new THREE.AmbientLight(0xffffff, L.ambientIntensity));
  const panelMat = basic(L.panelColor);
  const panelFrameMat = mat(P.metalGrey);
  for (const [px, pz] of [[-3, -2.5], [3, -2.5], [-3, 2], [3, 2]]) {
    box(1.3, 0.04, 0.7, panelFrameMat, px, H - 0.02, pz);
    box(1.2, 0.02, 0.6, panelMat, px, H - 0.045, pz);
    const light = new THREE.PointLight(L.panelColor, L.panelLightIntensity, L.panelLightDistance, 1.2);
    light.position.set(px, H - 0.3, pz);
    scene.add(light);
  }

  // ---------- entrance door (south wall, behind the player) ----------
  {
    const g = new THREE.Group();
    g.position.set(0, 0, hd - 0.01);
    g.rotation.y = Math.PI; // faces -z, into the room
    scene.add(g);
    box(1.2, 2.25, 0.06, mat(P.woodDark), 0, 1.125, 0.0, g);
    box(1.0, 2.1, 0.05, mat(P.doorWood), 0, 1.05, 0.03, g);
    // Frosted glass with the office name, mirrored because we see it from inside
    const glassTex = canvasTexture(128, 160, (c, w, h) => {
      c.fillStyle = '#b9c8c0';
      c.fillRect(0, 0, w, h);
      c.save();
      c.scale(-1, 1);
      c.fillStyle = '#2b2a26';
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
    box(0.7, 0.9, 0.02, basic(0xffffff, { map: glassTex }), 0, 1.45, 0.06, g);
    const handle = cyl(0.025, 0.025, 0.14, mat(P.metalGrey), 0.38, 1.0, 0.09, g);
    handle.rotation.x = Math.PI / 2;
    // Floor mat
    const doormat = box(1.2, 0.01, 0.7, mat(0x3d3a33), 0, 0.005, hd - 0.5);
    doormat.name = 'doormat';
  }

  // ---------- reception desk (north-west) ----------
  {
    const veneer = mat(P.woodVeneer);
    const veneerDark = mat(P.woodDark);
    const x0 = -4.6, x1 = -1.0, cx = (x0 + x1) / 2, dw = x1 - x0;
    // Front panel + transaction ledge
    box(dw, 1.1, 0.1, veneer, cx, 0.55, -2.78);
    box(dw + 0.06, 0.04, 0.34, veneerDark, cx, 1.12, -2.86);
    // Kick plate
    box(dw, 0.08, 0.02, mat(P.black), cx, 0.04, -2.72);
    // Vertical veneer strips on the front for that 1987 look
    for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.6) box(0.03, 1.0, 0.01, veneerDark, x, 0.55, -2.725);
    // Work surface behind
    box(dw, 0.04, 0.72, veneer, cx, 0.74, -3.3);
    // Return along the east side
    box(0.6, 0.04, 0.96, veneer, -1.3, 0.74, -4.12);
    box(0.04, 0.72, 0.96, veneer, -1.02, 0.36, -4.12);
    // Colliders: the whole enclosure (gap to the wall is too narrow for the player)
    staticBox(cx, 0.6, -3.2, dw / 2, 0.6, 0.48);
    staticBox(-1.3, 0.4, -4.12, 0.3, 0.4, 0.48);

    // Nameplate on the ledge
    const plateTex = canvasTexture(128, 24, (c, w, h) => {
      c.fillStyle = '#2b2416'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#d9c27a'; c.font = 'bold 14px monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('RECEPTION', w / 2, h / 2 + 1);
    });
    const plate = box(0.4, 0.075, 0.02, basic(0xffffff, { map: plateTex }), -3.6, 1.18, -2.72);
    plate.rotation.x = -0.35;

    // CRT computer, facing the receptionist (screen towards -z)
    const crt = new THREE.Group();
    crt.position.set(-2.7, 0.76, -3.25);
    crt.rotation.y = Math.PI + 0.25;
    scene.add(crt);
    box(0.26, 0.06, 0.24, mat(P.crtBeige), 0, 0.03, 0, crt);           // base
    box(0.44, 0.38, 0.38, mat(P.crtBeige), 0, 0.25, 0, crt);           // tube housing
    box(0.32, 0.26, 0.18, mat(P.crtBeige), 0, 0.24, -0.27, crt);       // back bulge
    const solitaireTex = canvasTexture(64, 48, (c, w, h) => {
      c.fillStyle = '#0d7a3a'; c.fillRect(0, 0, w, h);
      const rnd = seeded(11);
      for (let col = 0; col < 7; col++) {
        for (let r = 0; r <= col; r++) {
          const faceUp = r === col;
          c.fillStyle = faceUp ? '#f4f1e8' : '#2246a8';
          c.fillRect(3 + col * 8.5, 14 + r * 3, 7, 9);
          if (faceUp) { c.fillStyle = rnd() > 0.5 ? '#c02020' : '#111'; c.fillRect(4 + col * 8.5, 15 + r * 3, 2, 2); }
        }
      }
      for (let i = 0; i < 4; i++) { c.strokeStyle = '#3fae6a'; c.strokeRect(33 + i * 7.5, 2.5, 6, 9); }
      c.fillStyle = '#2246a8'; c.fillRect(3, 2, 7, 9);
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), basic(0xffffff, { map: solitaireTex }));
    screen.position.set(0, 0.26, 0.191);
    crt.add(screen);
    anchors.crt = crt;

    // Keyboard and mouse (in front of the receptionist)
    const kbTex = canvasTexture(64, 24, (c, w, h) => {
      c.fillStyle = hex(P.crtBeige); c.fillRect(0, 0, w, h);
      c.fillStyle = '#a99f84';
      for (let r = 0; r < 5; r++) for (let k = 0; k < 15; k++) c.fillRect(2 + k * 4, 2 + r * 4, 3, 3);
      c.fillRect(14, 22, 30, 1);
    });
    const keyboard = new THREE.Group();
    keyboard.position.set(-2.65, 0.775, -3.55);
    keyboard.rotation.y = Math.PI + 0.1;
    scene.add(keyboard);
    box(0.46, 0.03, 0.17, mat(P.crtBeige), 0, 0, 0, keyboard);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.15), mat(0xffffff, { map: kbTex }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.y = 0.016;
    keyboard.add(keys);
    anchors.keyboard = keyboard;

    box(0.22, 0.005, 0.18, mat(0x2d4a6a), -2.15, 0.763, -3.6); // mousepad
    const mouse = box(0.06, 0.03, 0.1, mat(P.crtBeige), -2.15, 0.78, -3.6);
    anchors.mouse = mouse;

    // Desk clutter
    box(0.22, 0.04, 0.3, mat(P.white), -3.9, 0.78, -3.3).rotation.y = 0.2;     // papers
    box(0.22, 0.03, 0.3, mat(0xe9e2c8), -3.88, 0.81, -3.28).rotation.y = 0.1;
    box(0.3, 0.08, 0.36, mat(P.black), -4.3, 0.8, -3.35);                        // in-tray
    cyl(0.04, 0.04, 0.1, mat(0xa83a2a), -1.7, 0.81, -3.4);                       // mug
    box(0.2, 0.07, 0.22, mat(0x2b2b2b), -1.35, 0.79, -3.9);                      // desk phone

    // Receptionist's office chair
    const oc = new THREE.Group();
    oc.position.set(-2.6, 0, -4.2);
    scene.add(oc);
    cyl(0.25, 0.25, 0.03, mat(P.black), 0, 0.05, 0, oc, 5);
    cyl(0.03, 0.03, 0.38, mat(P.metalGrey), 0, 0.24, 0, oc);
    box(0.48, 0.08, 0.46, mat(0x4a5a7a), 0, 0.46, 0, oc);
    box(0.44, 0.5, 0.06, mat(0x4a5a7a), 0, 0.82, -0.24, oc);
    anchors.receptionistSeat = oc;

    // Ticket dispenser on the ledge, east end
    const disp = new THREE.Group();
    disp.position.set(-1.35, 1.14, -2.86);
    scene.add(disp);
    cyl(0.02, 0.02, 0.12, mat(P.metalGrey), 0, 0.06, 0, disp);
    const dBody = cyl(0.08, 0.08, 0.16, mat(P.dispenserRed), 0, 0.2, 0, disp, 16);
    dBody.rotation.x = Math.PI / 2;
    box(0.06, 0.004, 0.06, mat(P.white), 0, 0.2, 0.1, disp).rotation.x = -0.3; // ticket tongue
    const signTex = canvasTexture(96, 32, (c, w, h) => {
      c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#b5332b'; c.font = 'bold 11px monospace'; c.textAlign = 'center';
      c.fillText('PLEASE TAKE', w / 2, 13); c.fillText('A NUMBER', w / 2, 26);
    });
    box(0.18, 0.06, 0.005, basic(0xffffff, { map: signTex }), 0, 0.33, 0.0, disp);
    anchors.ticketDispenser = disp;

    // Filing cabinets closing the gap between the desk and the west wall
    for (let i = 0; i < 3; i++) {
      const fx = -5.75 + i * 0.47;
      box(0.45, 1.3, 0.6, mat(0xb8b19a), fx, 0.65, -3.2);
      for (let d = 0; d < 3; d++) box(0.18, 0.03, 0.02, mat(P.metalGrey), fx, 1.1 - d * 0.4, -2.89);
    }
    staticBox(-5.3, 0.65, -3.2, 0.72, 0.65, 0.3);
    // A dying spider plant on top
    cyl(0.1, 0.08, 0.14, mat(P.terracotta), -5.3, 1.37, -3.2);
    for (let i = 0; i < 6; i++) {
      const leaf = box(0.02, 0.22, 0.02, mat(0x8a8f3a), -5.3, 1.48, -3.2);
      leaf.rotation.set(Math.cos(i) * 0.9, 0, Math.sin(i * 1.7) * 0.9);
    }
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
    box(1.2, 2.25, 0.06, mat(P.woodDark), doorX, 1.125, -hd + 0.03);
    const pivot = new THREE.Group(); // hinge on the west edge, swings later
    pivot.position.set(doorX - 0.5, 0, -hd + 0.06);
    scene.add(pivot);
    box(1.0, 2.1, 0.05, mat(P.doorWood), 0.5, 1.05, 0, pivot);
    for (const py of [0.55, 1.55]) box(0.8, 0.7, 0.01, mat(0x6e4a2a), 0.5, py, 0.03, pivot); // panels
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0xc8a54a));
    knob.position.set(0.88, 1.0, 0.07);
    pivot.add(knob);
    const plaqueTex = canvasTexture(160, 40, (c, w, h) => {
      c.fillStyle = '#c8a54a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#6b5420'; c.lineWidth = 2; c.strokeRect(2, 2, w - 4, h - 4);
      c.fillStyle = '#2b2010'; c.font = 'bold 16px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('ACCOUNTANT – PRIVATE', w / 2, h / 2 + 1);
    });
    box(0.56, 0.14, 0.01, basic(0xffffff, { map: plaqueTex }), 0.5, 1.62, 0.04, pivot);
    anchors.accountantDoor = { pivot, collider: staticBox(doorX, 1.05, -hd + 0.06, 0.5, 1.05, 0.05) };
  }

  // ---------- waiting chairs (dynamic props) ----------
  const chairMat = mat(P.chairSeat);
  const frameMat = mat(P.chairFrame);
  const makeChair = (x, z, yaw) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    scene.add(g);
    // Chair faces local +z (where a seated person looks)
    box(0.5, 0.07, 0.48, chairMat, 0, 0.45, 0, g);
    box(0.5, 0.48, 0.06, chairMat, 0, 0.78, -0.22, g);
    for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
      box(0.03, 0.42, 0.03, frameMat, lx, 0.21, lz, g);
    }
    box(0.03, 0.03, 0.42, frameMat, -0.22, 0.12, 0, g);
    box(0.03, 0.03, 0.42, frameMat, 0.22, 0.12, 0, g);
    physics.addDynamic(g, [
      { type: 'box', half: { x: 0.25, y: 0.035, z: 0.24 }, offset: { x: 0, y: 0.45, z: 0 } },
      { type: 'box', half: { x: 0.25, y: 0.24, z: 0.03 }, offset: { x: 0, y: 0.78, z: -0.22 } },
      { type: 'box', half: { x: 0.23, y: 0.2, z: 0.21 }, offset: { x: 0, y: 0.21, z: 0 }, density: 60 },
    ], { density: 200, angularDamping: 1.0, linearDamping: 0.6 });
    anchors.chairs.push({ object: g, occupant: null });
    return g;
  };
  for (const z of [-1.8, -1.1, -0.4, 0.3, 1.0]) makeChair(-hw + 0.45, z, Math.PI / 2);   // west row, facing east
  for (const z of [-1.8, -1.1, -0.4, 1.3, 2.0]) makeChair(hw - 0.45, z, -Math.PI / 2);   // east row, facing west

  // ---------- side table with magazines (east wall) ----------
  {
    const tx = hw - 0.4, tz = 0.45;
    box(0.5, 0.04, 0.55, mat(P.woodVeneer), tx, 0.5, tz);
    for (const [lx, lz] of [[-0.21, -0.23], [0.21, -0.23], [-0.21, 0.23], [0.21, 0.23]]) {
      box(0.04, 0.48, 0.04, mat(P.woodDark), tx + lx, 0.24, tz + lz);
    }
    staticBox(tx, 0.26, tz, 0.25, 0.26, 0.275);
    const covers = [
      ['TAX', 'QUARTERLY', '#b5332b'],
      ['FORMS', 'TODAY', '#2d4a6a'],
      ['AUDIT', 'LIVING', '#6b7a3a'],
      ['LEDGER', 'MAR 1987', '#a8822a'],
    ];
    covers.forEach(([a, b, col], i) => {
      const tex = canvasTexture(42, 56, (c, w, h) => {
        c.fillStyle = col; c.fillRect(0, 0, w, h);
        c.fillStyle = '#f4f1e8'; c.font = 'bold 10px monospace'; c.textAlign = 'center';
        c.fillText(a, w / 2, 14);
        c.font = '7px monospace'; c.fillText(b, w / 2, 24);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(8, 30, w - 16, 18);
      });
      const mg = new THREE.Group();
      mg.position.set(tx + (i % 2 ? 0.08 : -0.08), 0.53 + i * 0.012, tz + (i < 2 ? -0.1 : 0.12));
      mg.rotation.y = (i - 1.5) * 0.35;
      scene.add(mg);
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.01, 0.28), [
        mat(0xf4f1e8), mat(0xf4f1e8), mat(0xffffff, { map: tex }), mat(0xf4f1e8), mat(0xf4f1e8), mat(0xf4f1e8),
      ]);
      // Cover faces up (+y is material index 2)
      mg.add(page);
      physics.addDynamic(mg, [{ type: 'box', half: { x: 0.105, y: 0.005, z: 0.14 } }], { density: 700 });
    });
  }

  // ---------- potted plants (dynamic pots) ----------
  const makePlant = (x, z, tall) => {
    const g = new THREE.Group();
    g.position.set(x, 0.22, z);
    scene.add(g);
    cyl(0.2, 0.15, 0.44, mat(P.terracotta), 0, 0, 0, g);
    cyl(0.18, 0.18, 0.02, mat(0x3a2a1c), 0, 0.21, 0, g);
    const leafMat = mat(P.plantGreen);
    const rnd = seeded(tall ? 21 : 5);
    if (tall) {
      cyl(0.02, 0.025, 1.3, mat(0x5a4022), 0, 0.85, 0, g);
      for (let i = 0; i < 9; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), leafMat);
        leaf.scale.set(1, 0.35, 1.8);
        const a = rnd() * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.16, 0.6 + i * 0.12, Math.sin(a) * 0.16);
        leaf.rotation.y = -a;
        g.add(leaf);
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.7, 4), leafMat);
        const a = (i / 12) * Math.PI * 2;
        frond.position.set(Math.cos(a) * 0.12, 0.5, Math.sin(a) * 0.12);
        frond.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
        g.add(frond);
      }
    }
    physics.addDynamic(g, [{ type: 'cylinder', halfHeight: 0.22, radius: 0.19 }], { density: 400 });
    return g;
  };
  anchors.plants = [makePlant(-hw + 0.4, hd - 0.45, false), makePlant(hw - 0.4, hd - 0.45, true)];

  // ---------- water cooler (static base, dynamic bottle) ----------
  {
    const cx = hw - 0.4, cz = -hd + 0.45;
    box(0.34, 0.95, 0.34, mat(P.white), cx, 0.475, cz);
    box(0.06, 0.05, 0.04, mat(0x2d6ab0), cx - 0.07, 0.75, cz + 0.18);
    box(0.06, 0.05, 0.04, mat(0xb5332b), cx + 0.07, 0.75, cz + 0.18);
    box(0.2, 0.02, 0.1, mat(P.metalGrey), cx, 0.6, cz + 0.2);
    staticBox(cx, 0.475, cz, 0.17, 0.475, 0.17);
    const bottle = new THREE.Group();
    bottle.position.set(cx, 0.95 + 0.22, cz);
    scene.add(bottle);
    cyl(0.14, 0.14, 0.4, mat(P.waterBlue, { transparent: true, opacity: 0.75 }), 0, 0.02, 0, bottle);
    cyl(0.05, 0.13, 0.08, mat(P.waterBlue, { transparent: true, opacity: 0.75 }), 0, -0.2, 0, bottle);
    physics.addDynamic(bottle, [{ type: 'cylinder', halfHeight: 0.22, radius: 0.14 }], { density: 500 });
    anchors.coolerBottle = bottle;
    // Paper cup dispenser on the wall
    cyl(0.04, 0.04, 0.3, mat(P.white), cx - 0.3, 1.1, -hd + 0.06);
  }

  // ---------- umbrella stand by the entrance (dynamic) ----------
  {
    const g = new THREE.Group();
    g.position.set(1.0, 0.27, hd - 0.35);
    scene.add(g);
    cyl(0.13, 0.12, 0.54, mat(0x3f5a4a), 0, 0, 0, g);
    const umbrellaColors = [0x1b1a18, 0x7a2a3a];
    umbrellaColors.forEach((c, i) => {
      const u = new THREE.Group();
      u.position.set(i ? 0.04 : -0.04, 0.2, 0);
      u.rotation.z = i ? -0.12 : 0.1;
      g.add(u);
      cyl(0.012, 0.012, 0.9, mat(P.metalGrey), 0, 0, 0, u);
      cyl(0.05, 0.02, 0.6, mat(c), 0, 0.05, 0, u, 8);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), mat(0x5a4022));
      hook.position.set(0.05, 0.45, 0);
      u.add(hook);
    });
    physics.addDynamic(g, [{ type: 'cylinder', halfHeight: 0.27, radius: 0.13 }], { density: 250 });
    anchors.umbrellaStand = g;
  }

  // ---------- coat rack ----------
  {
    const rx = -1.2, rz = hd - 0.3;
    cyl(0.025, 0.025, 1.8, mat(P.woodDark), rx, 0.9, rz);
    cyl(0.22, 0.25, 0.04, mat(P.woodDark), rx, 0.02, rz);
    for (let i = 0; i < 4; i++) {
      const peg = box(0.02, 0.02, 0.18, mat(P.woodDark), rx, 1.72, rz);
      peg.rotation.set(0.5, (i * Math.PI) / 2, 0);
    }
    const coat = box(0.36, 0.7, 0.14, mat(0x6a5a44), rx + 0.05, 1.35, rz - 0.06);
    coat.rotation.z = 0.05;
    staticBox(rx, 0.9, rz, 0.12, 0.9, 0.12);
  }

  // ---------- wall decor ----------
  {
    const posterTex = canvasTexture(96, 128, (c, w, h) => {
      c.fillStyle = '#1b1a18'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#5a6a8a'; c.fillRect(8, 8, w - 16, 76);
      c.fillStyle = '#d8d0bc';
      c.beginPath(); c.moveTo(14, 84); c.lineTo(44, 30); c.lineTo(60, 56); c.lineTo(70, 44); c.lineTo(88, 84); c.fill();
      c.fillStyle = '#f4f1e8'; c.font = 'bold 14px monospace'; c.textAlign = 'center';
      c.fillText('PATIENCE', w / 2, 104);
      c.font = '7px monospace'; c.fillText('It is not a request.', w / 2, 118);
    });
    // West wall faces +x: BoxGeometry face 0 (+x) carries the poster
    box(0.02, 0.9, 0.68, mat(P.black), -hw + 0.02, 1.75, -0.4).material = [
      basic(0xffffff, { map: posterTex }), mat(P.black), mat(P.black), mat(P.black), mat(P.black), mat(P.black),
    ];

    const certTex = canvasTexture(96, 72, (c, w, h) => {
      c.fillStyle = '#f2ead0'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#a8822a'; c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#3a2e1a'; c.font = 'bold 8px monospace'; c.textAlign = 'center';
      c.fillText('CERTIFICATE OF', w / 2, 22); c.fillText('CONTINUED OPERATION', w / 2, 32);
      c.font = '6px monospace'; c.fillText('Awarded 1984', w / 2, 48);
      c.fillStyle = '#b5332b'; c.beginPath(); c.arc(w - 18, h - 16, 6, 0, Math.PI * 2); c.fill();
    });
    box(0.02, 0.4, 0.52, mat(P.woodDark), hw - 0.015, 1.7, -1.1);
    box(0.01, 0.34, 0.46, mat(P.woodDark), hw - 0.03, 1.7, -1.1).material = [
      mat(P.woodDark), basic(0xffffff, { map: certTex }), mat(P.woodDark), mat(P.woodDark), mat(P.woodDark), mat(P.woodDark),
    ];
  }

  return {
    anchors,
    clock,
    nowServing,
    update(dt) { for (const u of updaters) u(dt); },
  };
}
