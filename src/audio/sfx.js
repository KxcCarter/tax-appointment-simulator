import * as THREE from 'three';
import { config } from '../config.js';

/*
  Every sound is synthesised here with the Web Audio API. No audio files.
  Call start() from a user gesture (browsers block audio before one).
  Positional sounds take a THREE.Vector3; the listener follows the camera.
  All methods are safe to call before start(); they just do nothing.
*/

const A = config.audio;
const rand = (a, b) => a + Math.random() * (b - a);

export class Sfx {
  constructor() {
    this.ctx = null;
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = A.master;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused by every noisy sound
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startHum();
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  /** Keep the listener on the camera. Call every frame. */
  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = camera.getWorldPosition(_v);
    const f = camera.getWorldDirection(_f);
    const u = _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.01);
      L.positionY.setTargetAtTime(p.y, t, 0.01);
      L.positionZ.setTargetAtTime(p.z, t, 0.01);
      L.forwardX.setTargetAtTime(f.x, t, 0.01);
      L.forwardY.setTargetAtTime(f.y, t, 0.01);
      L.forwardZ.setTargetAtTime(f.z, t, 0.01);
      L.upX.setTargetAtTime(u.x, t, 0.01);
      L.upY.setTargetAtTime(u.y, t, 0.01);
      L.upZ.setTargetAtTime(u.z, t, 0.01);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // ---------------------------------------------------------------- helpers

  /** Output chain: gain -> (panner) -> master. Returns the gain node to connect into. */
  _out(volume, position, spatial = {}) {
    const g = this.ctx.createGain();
    g.gain.value = volume;
    if (position) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = spatial.refDistance ?? 1;
      p.rolloffFactor = spatial.rolloff ?? 1;
      p.maxDistance = 50;
      if (p.positionX) {
        p.positionX.value = position.x;
        p.positionY.value = position.y;
        p.positionZ.value = position.z;
      } else {
        p.setPosition(position.x, position.y, position.z);
      }
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  _noise(t, dur, dest, filterType, freq, q = 1, peak = 1, attack = 0.001) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.9, dur + 0.05);
    return { src, filter: f, gain: g };
  }

  _tone(t, dur, dest, type, freq, peak = 1, attack = 0.002, endFreq = null) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { osc: o, gain: g };
  }

  // ---------------------------------------------------------------- room tone

  _startHum() {
    const c = this.ctx;
    const out = this._out(A.hum.volume, null);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(out);
    // Mains hum + ballast buzz
    for (const [type, f, v] of [['sine', 60, 0.6], ['sawtooth', 120, 0.35], ['sine', 240, 0.12]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = v;
      o.connect(g).connect(lp);
      o.start();
    }
    // Slow flutter, as fluorescent tubes do
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.27;
    const depth = c.createGain();
    depth.gain.value = A.hum.volume * 0.15;
    lfo.connect(depth).connect(out.gain);
    lfo.start();
  }

  // ---------------------------------------------------------------- one-shots

  clockTick(position, tock = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.clockTick.volume, position, A.clockTick);
    this._tone(t, 0.035, out, 'sine', tock ? 1550 : 1850, 0.5, 0.001);
    this._noise(t, 0.02, out, 'bandpass', tock ? 3200 : 3800, 3, 0.7);
  }

  mouseClick(position) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.mouseClick.volume, position, A.mouseClick);
    const v = rand(0.7, 1);
    // press...
    this._noise(t, 0.012, out, 'highpass', 2600, 1, 0.9 * v);
    this._tone(t, 0.012, out, 'triangle', rand(3200, 3700), 0.35 * v, 0.0005);
    // ...and release
    const r = t + rand(0.05, 0.08);
    this._noise(r, 0.01, out, 'highpass', 3200, 1, 0.45 * v);
  }

  /** Dialogue voice blip. pitch in Hz. */
  blip(pitch, position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.voice.volume, position, { refDistance: 2, rolloff: 0.6 });
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(out);
    const f = pitch * rand(0.9, 1.12);
    this._tone(t, 0.055, lp, 'square', f, 0.6, 0.004, f * rand(0.92, 1.0));
  }

  footstep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.footsteps.volume * rand(0.8, 1.1), null);
    this._noise(t, 0.09, out, 'lowpass', rand(380, 520), 1, 0.9, 0.004);
    this._tone(t, 0.08, out, 'sine', rand(70, 90), 0.6, 0.003, 45);
  }

  chairCreak(position = null) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = this._out(A.chairCreak.volume, position, { refDistance: 1.5, rolloff: 1 });
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(800, 1100);
    bp.Q.value = 5;
    bp.connect(out);
    const dur = rand(0.35, 0.55);
    const { osc } = this._tone(t, dur, bp, 'sawtooth', rand(150, 190), 0.8, 0.05, rand(100, 130));
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(18, 30);
    const depth = c.createGain();
    depth.gain.value = 18;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  ticketTear(position = null) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = this._out(A.ticketTear.volume, position, { refDistance: 1, rolloff: 1 });
    // Mechanical clunk of the dispenser...
    this._tone(t, 0.05, out, 'square', 220, 0.3, 0.001, 140);
    // ...then paper tearing: band-passed noise, swept, chopped into fibres
    const dur = 0.28;
    const n = this._noise(t + 0.05, dur, out, 'bandpass', 1400, 1.5, 1, 0.01);
    n.filter.frequency.exponentialRampToValueAtTime(4200, t + 0.05 + dur);
    const chop = c.createOscillator();
    chop.type = 'square';
    chop.frequency.value = 55;
    const depth = c.createGain();
    depth.gain.value = 0.6;
    chop.connect(depth).connect(n.gain.gain);
    chop.start(t + 0.05);
    chop.stop(t + 0.05 + dur + 0.05);
  }
}

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
