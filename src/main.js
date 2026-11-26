import * as THREE from 'three';
import { config } from './config.js';
import { state } from './state.js';
import { initRapier, Physics } from './physics.js';
import { PlayerController } from './player/controller.js';
import { setupWaitingRoom } from './level/waitingRoomLevel.js';
import { loadCharacterModels } from './characters/realBody.js';
import { Sfx } from './audio/sfx.js';
import { UI } from './ui/ui.js';
import { theme } from './theme.js';
import { createBeatSkipper } from './debug/skipToBeat.js';

theme.applyUi();

const params = new URLSearchParams(location.search);
const sfx = new Sfx();
const ui = new UI(document.getElementById('ui'), {
  onBegin: begin,
  onResume: requestLock,
});

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: theme.look.antialias, powerPreference: 'high-performance' });
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
theme.applyScene(scene, renderer);
const camera = new THREE.PerspectiveCamera(config.render.fov, 1, config.render.near, config.render.far);
// (the theme decides how a frame is drawn: post-processing such as contact shadows; ?ao=0 turns that off)
const pipeline = theme.renderPipeline(renderer, scene, camera, { off: params.get('ao') === '0' });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio));
  renderer.setSize(w, h);
  pipeline.setSize(w, h);
}
window.addEventListener('resize', resize);

function render() {
  pipeline.render();
}

// ---------- pointer lock / pause ----------
function requestLock() {
  const el = renderer.domElement;
  try {
    const p = el.requestPointerLock();
    // Chrome rejects re-locking too soon after Esc; just ask for another click.
    if (p && p.catch) p.catch(() => ui.toast('Click again to resume.'));
  } catch {
    ui.toast('Click again to resume.');
  }
}

function begin() {
  if (state.started) return;
  state.started = true;
  sfx.start(); // needs this click: browsers block audio until a user gesture
  ui.hideTitle();
  ui.showHud(true);
  requestLock();
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    state.paused = false;
    player.enabled = true;
    sfx.resume();
    ui.showPause(false);
    ui.showHud(true);
  } else if (state.started && !state.ended) {
    state.paused = true;
    player.enabled = false;
    player.keys.clear();
    sfx.suspend();
    ui.showPause(true);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'F4') { e.preventDefault(); config.debug.showBeat = !config.debug.showBeat; if (!config.debug.showBeat) ui.setDebugBeat(null); }
  if (e.code === 'F3') { e.preventDefault(); config.debug.showFps = !config.debug.showFps; if (!config.debug.showFps) ui.setFps(null); }
});

// ---------- boot ----------
let physics, player, level;
let skipper = null; // debug ?beat=: fast-forwarding to a beat

async function boot() {
  // Debug: ?charstyle=soft previews a character style without editing theme.js
  if (params.get('charstyle')) theme.look.characterStyle = params.get('charstyle');
  if (params.get('realistic') === '0') theme.look.realistic.enabled = false;
  await Promise.all([initRapier(), loadCharacterModels()]);
  physics = new Physics();
  player = new PlayerController(physics, camera);
  // Debug: ?radio=10 makes the radio come on after 10 s instead of config.radio.at
  if (params.get('radio')) config.radio.at = Number(params.get('radio'));
  // ?gamer=5: the gamer walks in after 5 s instead of config.gamer.at
  if (params.get('gamer')) config.gamer.at = Number(params.get('gamer'));
  level = setupWaitingRoom({ scene, physics, player, camera, ui, sfx, fastWait: params.has('fastwait'), brawlNow: params.has('brawl') });
  theme.applyShadows(scene); // (the theme decides what casts shadows)
  scene.add(camera);

  resize();
  ui.ready();

  // Debug: ?autostart skips the title. ?view=x,y,z,yawDeg,pitchDeg places a free camera (screenshots).
  if (config.debug.autostart || params.has('autostart') || params.has('beat') || params.has('fight')) {
    state.started = true;
    ui.hideTitle();
    ui.showHud(true);
    player.enabled = true;
    // No click yet (the title screen's click is what normally starts the audio and captures the mouse),
    // so a click in the game does both: the first one, and any after the mouse has been let go
    document.addEventListener('mousedown', () => sfx.start(), { once: true });
    renderer.domElement.addEventListener('mousedown', () => {
      if (!document.pointerLockElement && !state.ended) requestLock();
    });
    ui.toast('Click to look around.', 4);
  }
  // Debug: ?beat=argument_1 fast-forwards the game to that beat (src/debug/skipToBeat.js)
  if (params.get('beat')) {
    const desk = level.receptionist.root.getWorldPosition(new THREE.Vector3());
    const at = { x: -2.3, z: -2.3 }; // at the counter, out of the doorway (the newcomer comes in through it)
    player.teleport(at.x, at.z, Math.atan2(-(desk.x - at.x), -(desk.z - at.z)));
    skipper = createBeatSkipper({ target: params.get('beat'), level, state, player, ui, sfx, config });
  }
  // Debug: ?fight starts the all-out brawl right away (everyone in it), you in the middle of the room
  if (params.has('fight')) {
    const desk = level.receptionist.root.getWorldPosition(new THREE.Vector3());
    player.teleport(0, 1.2, Math.atan2(-desk.x, -(desk.z - 1.2))); // facing the counter
    level.startFight();
  }
  const view = params.get('view');
  if (view) {
    const [x, y, z, yaw = 0, pitch = 0] = view.split(',').map(Number);
    debugView = { x, y, z, yaw: THREE.MathUtils.degToRad(yaw), pitch: THREE.MathUtils.degToRad(pitch) };
  }

  window.__game = {
    state, config, scene, camera, physics, player, level, renderer, sfx,
    // Debug: place a free camera (degrees), or pass nothing to return to the player
    setView: (x, y, z, yaw = 0, pitch = 0) => {
      debugView = x === undefined ? null : { x, y, z, yaw: THREE.MathUtils.degToRad(yaw), pitch: THREE.MathUtils.degToRad(pitch) };
    },
  };
  requestAnimationFrame(loop);
}

let debugView = null;
let last = performance.now();
let accumulator = 0;
let fpsTimer = 0, fpsFrames = 0;

/** Advance the game by dt seconds (physics in fixed steps). */
function simulate(dt) {
  const step = config.physics.fixedStep;
  accumulator += dt;
  let n = 0;
  while (accumulator >= step && n < config.physics.maxSubSteps) {
    player.fixedUpdate(step);
    physics.step();
    accumulator -= step;
    n++;
  }
  if (n === config.physics.maxSubSteps) accumulator = 0; // don't spiral after a hitch
  physics.sync();
  state.clockTime += dt * config.clock.timeScale;
  level.update(dt);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const step = config.physics.fixedStep;
  // Hit-stop: a blow that lands freezes the game for a few frames (config.combat.hitStop)
  const frozen = state.hitStop > 0;
  if (frozen) state.hitStop = Math.max(0, state.hitStop - dt);
  if (state.started && !state.paused && skipper?.active) {
    // Debug ?beat=: many game steps per frame until the target beat comes up
    for (let k = 0; k < config.debug.skipStepsPerFrame && skipper.active; k++) {
      state.hitStop = 0;
      simulate(step);
      skipper.update(step);
    }
  } else if (state.started && !state.paused && !frozen) {
    simulate(dt);
  }
  player.updateCamera(Math.min(1, accumulator / step));
  level.frame();
  sfx.updateListener(camera);

  if (debugView) {
    camera.position.set(debugView.x, debugView.y, debugView.z);
    camera.rotation.set(debugView.pitch, debugView.yaw, 0, 'YXZ');
  }

  render();

  if (config.debug.showFps) {
    fpsFrames++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) { ui.setFps(fpsFrames / fpsTimer); fpsFrames = 0; fpsTimer = 0; }
  }
}

boot().catch((err) => {
  console.error(err);
  ui.showError(String(err && err.message ? err.message : err));
});
