import * as THREE from 'three';
import { config } from './config.js';
import { state } from './state.js';
import { initRapier, Physics } from './physics.js';
import { PlayerController } from './player/controller.js';
import { setupWaitingRoom } from './level/waitingRoomLevel.js';
import { Sfx } from './audio/sfx.js';
import { UI } from './ui/ui.js';
import { theme } from './theme.js';

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

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio));
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

function render() {
  renderer.render(scene, camera);
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
  } else if (state.started) {
    state.paused = true;
    player.enabled = false;
    player.keys.clear();
    sfx.suspend();
    ui.showPause(true);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'F3') { e.preventDefault(); config.debug.showFps = !config.debug.showFps; if (!config.debug.showFps) ui.setFps(null); }
});

// ---------- boot ----------
let physics, player, level;

async function boot() {
  // Debug: ?charstyle=soft previews a character style without editing theme.js
  if (params.get('charstyle')) theme.look.characterStyle = params.get('charstyle');
  await initRapier();
  physics = new Physics();
  player = new PlayerController(physics, camera);
  level = setupWaitingRoom({ scene, physics, player, camera, ui, sfx, fastWait: params.has('fastwait') });
  scene.add(camera);

  resize();
  ui.ready();

  // Debug: ?autostart skips the title. ?view=x,y,z,yawDeg,pitchDeg places a free camera (screenshots).
  if (config.debug.autostart || params.has('autostart')) {
    state.started = true;
    ui.hideTitle();
    ui.showHud(true);
    player.enabled = true;
    // No click yet, so audio starts on the first one
    document.addEventListener('mousedown', () => sfx.start(), { once: true });
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

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const step = config.physics.fixedStep;
  if (state.started && !state.paused) {
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
