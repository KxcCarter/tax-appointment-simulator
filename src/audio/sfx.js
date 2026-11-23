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

  /** A clipboard shoved across a laminate counter, ending in a small tap. */
  paperSlide(position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.paperSlide.volume, position, { refDistance: 1.2, rolloff: 1 });
    const n = this._noise(t, 0.3, out, 'bandpass', 700, 1.2, 0.9, 0.015);
    n.filter.frequency.exponentialRampToValueAtTime(380, t + 0.3);
    this._tone(t + 0.28, 0.06, out, 'sine', 160, 0.5, 0.002, 90);
  }

  /** A dry, unproductive cough: two noise bursts through a throaty band-pass. */
  cough(position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.cough.volume * rand(0.8, 1.1), position, A.cough);
    const f = rand(500, 750);
    const a = this._noise(t, 0.16, out, 'bandpass', f, 2.2, 1, 0.006);
    a.filter.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.16);
    this._tone(t, 0.12, out, 'sawtooth', rand(110, 150), 0.25, 0.005, 80);
    this._noise(t + 0.09, 0.1, out, 'bandpass', f * 1.4, 2, 0.4, 0.005);
  }

  /** A long, resigned exhale. */
  sigh(position = null) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = this._out(A.sigh.volume, position, A.sigh);
    const dur = rand(1.0, 1.5);
    const n = this._noise(t, dur, out, 'lowpass', 1400, 0.7, 0.9, 0.25);
    n.filter.frequency.exponentialRampToValueAtTime(350, t + dur);
    this._tone(t + 0.05, dur * 0.6, out, 'sine', rand(150, 200), 0.08, 0.2, 110); // a hint of voice
  }

  pageTurn(position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.pageTurn.volume, position, A.pageTurn);
    const n = this._noise(t, 0.28, out, 'highpass', 1800, 0.8, 0.8, 0.04);
    n.filter.frequency.exponentialRampToValueAtTime(4500, t + 0.28);
  }

  /** Someone shifting their weight on a vinyl chair. */
  chairShift(position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.chairShift.volume, position, { refDistance: 1.2, rolloff: 1.2 });
    const n = this._noise(t, 0.35, out, 'bandpass', 420, 3, 0.7, 0.05);
    n.filter.frequency.exponentialRampToValueAtTime(260, t + 0.35);
    this._tone(t + 0.05, 0.25, out, 'sawtooth', 95, 0.15, 0.03, 75);
  }

  watchTick(position) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.watchTick.volume, position, A.watchTick);
    this._noise(t, 0.008, out, 'highpass', 5000, 1, 0.8, 0.0005);
  }

  /** The NOW SERVING display: a dull two-tone electronic chime. */
  chime(position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.chime.volume, position, { refDistance: 3, rolloff: 0.6 });
    this._tone(t, 0.9, out, 'triangle', 784, 0.6, 0.005);
    this._tone(t + 0.45, 1.2, out, 'triangle', 622, 0.6, 0.005);
  }

  /** A plastic rotary switch, then a moment of warm-up static. */
  radioClick(position = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.4, position, { refDistance: 1.2, rolloff: 1 });
    this._noise(t, 0.015, out, 'highpass', 2500, 1, 0.9, 0.0005);
    this._tone(t, 0.02, out, 'square', 900, 0.2, 0.001, 600);
    this._noise(t + 0.05, 0.5, out, 'bandpass', 2200, 0.8, 0.08, 0.05);
  }

  // ---------------------------------------------------------------- music (the radio)

  /** Fetch and decode an audio file from public/. Resolves to null (with a warning) if it isn't there. */
  async loadAudio(url) {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`Audio file not loaded (${url}): ${err.message}. Put it in public/ to hear it.`);
      return null;
    }
  }

  /**
   * Loop a decoded buffer from a point in the room, optionally band-limited like a small speaker.
   * Returns { stop() }.
   */
  playLoop(buffer, position, { volume, refDistance, rolloff, tinny, highpass, lowpass }) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const out = this._out(volume, position, { refDistance, rolloff });
    let chain = src;
    if (tinny) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = highpass;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      chain = chain.connect(hp).connect(lp);
    }
    chain.connect(out);
    // Fade in, as a radio warming up
    const t = this.ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(volume, t + 1.5);
    src.start();
    return {
      stop: () => {
        const now = this.ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
        src.stop(now + 0.85);
      },
    };
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
