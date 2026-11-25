import * as THREE from 'three';
import { config } from '../config.js';
import { SOUNDS, soundNameOf } from './soundList.js';

/*
  Every sound is synthesised here with the Web Audio API, unless there's a recording of it: a file named
  after it in src/audio/sfx/ (the names: src/audio/soundList.js). config.audio.sounds says, per sound,
  whether to use the file ('auto', the default: the file if there is one), the synthesised version
  ('synth'), or both at once ('both').
  Call start() from a user gesture (browsers block audio before one).
  Positional sounds take a THREE.Vector3; the listener follows the camera.
  All methods are safe to call before start(); they just do nothing.
*/

const A = config.audio;
// hit(kind) -> its sound's name, where they differ (the rest: 'hit_' + kind)
const HIT_FILES = { radioHit: 'hit_radio' };
const rand = (a, b) => a + Math.random() * (b - a);

// The recordings in src/audio/sfx/ (bundled by Vite; a file added while the dev server runs reloads the page)
const FILE_URLS = import.meta.glob('./sfx/*.{mp3,wav,ogg,m4a,flac}', { eager: true, query: '?url', import: 'default' });
const FILES = {}; // sound name -> [url, ...] (numbered versions: hit_punch_1, hit_punch_2...)
for (const [path, url] of Object.entries(FILE_URLS)) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '');
  const name = soundNameOf(base);
  if (!name) { console.warn(`Sound file "${path.split('/').pop()}" isn't named after a sound in src/audio/soundList.js: not used.`); continue; }
  (FILES[name] ??= []).push(url);
}

// Recorded voice lines (src/audio/voice/<who>/, made by `npm run voices`): lines.json maps each line's
// text to its file. Said with exactly that text, the line plays its recording instead of the blips.
const VOICE_URLS = import.meta.glob('./voice/*/*.{mp3,wav,ogg,m4a,flac}', { eager: true, query: '?url', import: 'default' });
const VOICE_LISTS = import.meta.glob('./voice/*/lines.json', { eager: true, import: 'default' });
const VOICES = {}; // who -> text -> url
for (const [path, lines] of Object.entries(VOICE_LISTS)) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1), who = dir.split('/').at(-2);
  for (const [text, file] of Object.entries(lines)) {
    const url = VOICE_URLS[dir + file];
    if (url) (VOICES[who] ??= {})[text] = url;
  }
}

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
    this._loadFiles();
    this._loadVoices();
  }

  // ---------------------------------------------------------------- voice lines (src/audio/voice/)

  /** Decode every voice line in the background (a line said before its recording is ready gets blips). */
  async _loadVoices() {
    this.voices = {};
    for (const [who, lines] of Object.entries(VOICES)) {
      const out = (this.voices[who] = {});
      await Promise.all(Object.entries(lines).map(async ([text, url]) => {
        const buf = await this.loadAudio(url);
        if (buf) out[text] = buf;
      }));
    }
  }

  /** Is there a recording of this line, ready to play? Its length in seconds, or 0. */
  voiceLength(who, text) {
    if (!A.voices?.enabled) return 0;
    return this.voices?.[who]?.[text]?.duration ?? 0;
  }

  /**
   * Say a line from its recording (from `position`, a Vector3, if given). Returns { setPosition(v), stop() },
   * or null if there's no recording (then: blips).
   */
  voiceLine(who, text, position = null) {
    const buf = this.voiceLength(who, text) ? this.voices[who][text] : null;
    if (!buf) return null;
    const V = A.voices;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this._out(V.volume * (V.byWho?.[who] ?? 1), position, V);
    src.connect(g);
    src.start();
    const panner = position ? this._lastPanner : null;
    return {
      setPosition(v) {
        if (!panner || !v) return;
        if (panner.positionX) { panner.positionX.value = v.x; panner.positionY.value = v.y; panner.positionZ.value = v.z; }
        else panner.setPosition(v.x, v.y, v.z);
      },
      stop() { try { src.stop(); } catch { /* already over */ } },
    };
  }

  // ---------------------------------------------------------------- recordings (src/audio/sfx/)

  /** Decode every recording (in the background: until one's ready, its sound is synthesised). */
  async _loadFiles() {
    this.files = {};
    await Promise.all(Object.entries(FILES).map(async ([name, urls]) => {
      const list = (await Promise.all(urls.map((u) => this.loadAudio(u)))).filter(Boolean);
      if (list.length) this.files[name] = list;
    }));
    // The hum is already running (synthesised): swap in the recording
    if (this.files.hum && this._mode('hum') !== 'synth') this._fileHum();
  }

  /** 'auto' (the file if there is one, else synthesised) | 'synth' | 'both' (config.audio.sounds). */
  _mode(name) {
    return A.sounds?.[name] ?? 'auto';
  }

  /**
   * Play the recording of `name`, if there is one and its mode allows, through the same volume and
   * position as the synthesised version. Returns true if that's all (skip the synthesised one).
   * rate: playback speed (pitch), e.g. the voice blips.
   */
  _play(name, volume, position = null, spatial = {}, rate = 1) {
    const mode = this._mode(name);
    if (mode === 'synth') return false;
    const fb = SOUNDS[name]?.fallback;
    const list = this.files?.[name] ?? (fb && !FILES[name] ? this.files?.[fb] : null);
    if (!list?.length) return false;
    // One of the versions, never the same one twice in a row
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this._last?.[name]) i = (i + 1) % list.length;
    (this._last ??= {})[name] = i;
    const src = this.ctx.createBufferSource();
    src.buffer = list[i];
    src.playbackRate.value = rate;
    src.connect(this._out(volume * (A.fileVolume?.[name] ?? 1), position, spatial));
    src.start();
    return mode !== 'both';
  }

  /** The hum from its recording, looped (and the synthesised one stopped, unless 'both'). */
  _fileHum() {
    if (this._mode('hum') !== 'both') this.humOut?.disconnect(); // (the synthesised hum, silenced)
    const src = this.ctx.createBufferSource();
    src.buffer = this.files.hum[0];
    src.loop = true;
    src.connect(this._out(A.hum.volume * (A.fileVolume?.hum ?? 1), null));
    src.start();
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
      this._lastPanner = p; // (voiceLine moves it with the speaker)
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
    this.humOut = out; // (stopped if there's a recording: _fileHum)
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

  /** Synthesised tick: only used if the recorded tick-tock (config.audio.clockTick.file) isn't available. */
  clockTick(position, tock = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.clockTick.volume, position, A.clockTick);
    this._tone(t, 0.035, out, 'sine', tock ? 1550 : 1850, 0.5, 0.001);
    this._noise(t, 0.02, out, 'bandpass', tock ? 3200 : 3800, 3, 0.7);
  }

  mouseClick(position) {
    if (!this.ctx) return;
    if (this._play('mouse_click', A.mouseClick.volume, position, A.mouseClick)) return;
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
    if (this._play('voice_blip', A.voice.volume, position, { refDistance: 2, rolloff: 0.6 }, (pitch / A.blipBasePitch) * rand(0.95, 1.06))) return;
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
    if (this._play('footstep', A.footsteps.volume * rand(0.8, 1.1))) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.footsteps.volume * rand(0.8, 1.1), null);
    this._noise(t, 0.09, out, 'lowpass', rand(380, 520), 1, 0.9, 0.004);
    this._tone(t, 0.08, out, 'sine', rand(70, 90), 0.6, 0.003, 45);
  }

  chairCreak(position = null) {
    if (!this.ctx) return;
    if (this._play('chair_creak', A.chairCreak.volume, position, { refDistance: 1.5, rolloff: 1 })) return;
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
    if (this._play('paper_slide', A.paperSlide.volume, position, { refDistance: 1.2, rolloff: 1 })) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.paperSlide.volume, position, { refDistance: 1.2, rolloff: 1 });
    const n = this._noise(t, 0.3, out, 'bandpass', 700, 1.2, 0.9, 0.015);
    n.filter.frequency.exponentialRampToValueAtTime(380, t + 0.3);
    this._tone(t + 0.28, 0.06, out, 'sine', 160, 0.5, 0.002, 90);
  }

  /** A dry, unproductive cough: two noise bursts through a throaty band-pass. */
  cough(position = null) {
    if (!this.ctx) return;
    if (this._play('cough', A.cough.volume * rand(0.8, 1.1), position, A.cough)) return;
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
    if (this._play('sigh', A.sigh.volume, position, A.sigh)) return;
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
    if (this._play('page_turn', A.pageTurn.volume, position, A.pageTurn)) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.pageTurn.volume, position, A.pageTurn);
    const n = this._noise(t, 0.28, out, 'highpass', 1800, 0.8, 0.8, 0.04);
    n.filter.frequency.exponentialRampToValueAtTime(4500, t + 0.28);
  }

  /** Someone shifting their weight on a vinyl chair. */
  chairShift(position = null) {
    if (!this.ctx) return;
    if (this._play('chair_shift', A.chairShift.volume, position, { refDistance: 1.2, rolloff: 1.2 })) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.chairShift.volume, position, { refDistance: 1.2, rolloff: 1.2 });
    const n = this._noise(t, 0.35, out, 'bandpass', 420, 3, 0.7, 0.05);
    n.filter.frequency.exponentialRampToValueAtTime(260, t + 0.35);
    this._tone(t + 0.05, 0.25, out, 'sawtooth', 95, 0.15, 0.03, 75);
  }

  watchTick(position) {
    if (!this.ctx) return;
    if (this._play('watch_tick', A.watchTick.volume, position, A.watchTick)) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.watchTick.volume, position, A.watchTick);
    this._noise(t, 0.008, out, 'highpass', 5000, 1, 0.8, 0.0005);
  }

  /** The NOW SERVING display: a dull two-tone electronic chime. */
  chime(position = null) {
    if (!this.ctx) return;
    if (this._play('chime', A.chime.volume, position, { refDistance: 3, rolloff: 0.6 })) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.chime.volume, position, { refDistance: 3, rolloff: 0.6 });
    this._tone(t, 0.9, out, 'triangle', 784, 0.6, 0.005);
    this._tone(t + 0.45, 1.2, out, 'triangle', 622, 0.6, 0.005);
  }

  /** A plastic rotary switch, then a moment of warm-up static. */
  radioClick(position = null) {
    if (!this.ctx) return;
    if (this._play('radio_click', 0.4, position, { refDistance: 1.2, rolloff: 1 })) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.4, position, { refDistance: 1.2, rolloff: 1 });
    this._noise(t, 0.015, out, 'highpass', 2500, 1, 0.9, 0.0005);
    this._tone(t, 0.02, out, 'square', 900, 0.2, 0.001, 600);
    this._noise(t + 0.05, 0.5, out, 'bandpass', 2200, 0.8, 0.08, 0.05);
  }

  /** Play a decoded buffer once from a point in the room. */
  playOnce(buffer, position, { volume, refDistance, rolloff }) {
    if (!this.ctx || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this._out(volume, position, { refDistance, rolloff }));
    src.start();
  }

  // ---------------------------------------------------------------- music (the radio)

  /** Fetch and decode an audio file. Resolves to null (with a warning) if it's missing or unreadable. */
  async loadAudio(url) {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      // A missing file can come back as the HTML page instead of a 404
      if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('file not found');
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`Audio file not loaded (${url}): ${err.message}`);
      return null;
    }
  }

  /**
   * Loop a decoded buffer from a point in the room, optionally band-limited like a small speaker.
   * offset: seconds into the track to start from. Returns { stop() }.
   */
  playLoop(buffer, position, { volume, refDistance, rolloff, tinny, highpass, lowpass }, offset = 0) {
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
    src.start(0, (offset ?? 0) % buffer.duration);
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

  // ---------------------------------------------------------------- the gamer's snacks

  /** Chips being crunched: a few sharp, dry cracks. */
  crunch(position = null, bites = 3, volume = 1) {
    if (!this.ctx) return;
    if (this._play('crunch', A.snack.volume * volume, position, A.snack)) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.snack.volume * volume, position, A.snack);
    for (let i = 0; i < bites; i++) {
      const at = t + i * rand(0.14, 0.22);
      this._noise(at, rand(0.05, 0.09), out, 'bandpass', rand(2200, 3800), 1.4, rand(0.6, 1), 0.002);
      this._noise(at + 0.01, 0.04, out, 'highpass', 5000, 0.7, 0.35, 0.001);
    }
  }

  /** A hand in a foil chip bag: crinkly, scattered high noise. */
  bagRustle(position = null, seconds = 0.5) {
    if (!this.ctx) return;
    if (this._play('bag_rustle', A.snack.volume * 0.8, position, A.snack)) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.snack.volume * 0.8, position, A.snack);
    const n = Math.round(seconds * 22);
    for (let i = 0; i < n; i++) {
      this._noise(t + Math.random() * seconds, rand(0.015, 0.05), out, 'highpass', rand(3000, 6500), 0.8, rand(0.2, 0.7), 0.001);
    }
  }

  /** Swallowing from a can: a few gulps, then the can's hollow little ring. */
  gulp(position = null, gulps = 3) {
    if (!this.ctx) return;
    if (this._play('gulp', A.snack.volume * 0.9, position, A.snack)) return;
    const t = this.ctx.currentTime;
    const out = this._out(A.snack.volume * 0.9, position, A.snack);
    for (let i = 0; i < gulps; i++) {
      const at = t + i * rand(0.42, 0.55);
      this._tone(at, 0.12, out, 'sine', rand(170, 210), 0.7, 0.01, rand(90, 110));
      this._noise(at, 0.1, out, 'lowpass', 500, 1, 0.3, 0.01);
    }
    this._tone(t + gulps * 0.5 + 0.1, 0.25, out, 'sine', 1900, 0.06, 0.003, 1850);
  }

  /** A short, unembarrassed burp. */
  burp(position = null) {
    if (!this.ctx) return;
    if (this._play('burp', A.snack.volume * 1.1, position, A.snack)) return;
    const c = this.ctx, t = c.currentTime;
    const out = this._out(A.snack.volume * 1.1, position, A.snack);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(out);
    const dur = rand(0.35, 0.55);
    const { osc } = this._tone(t, dur, lp, 'sawtooth', rand(85, 100), 0.9, 0.02, rand(60, 70));
    // The rattle of it
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(22, 30);
    const depth = c.createGain();
    depth.gain.value = 25;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    this._noise(t, dur, lp, 'bandpass', 400, 2, 0.4, 0.02);
  }

  /** An angry footstep; heavier the angrier she is. */
  stomp(position, anger = 1) {
    if (!this.ctx) return;
    if (this._play('stomp', A.stomp.volume * Math.min(2, 0.7 + anger * 0.3) * rand(0.85, 1.1), position, A.stomp)) return;
    const t = this.ctx.currentTime;
    const v = A.stomp.volume * Math.min(2, 0.7 + anger * 0.3) * rand(0.85, 1.1);
    const out = this._out(v, position, A.stomp);
    this._noise(t, 0.1, out, 'lowpass', rand(300, 420), 1, 1, 0.003);
    this._tone(t, 0.12, out, 'sine', rand(55, 70), 0.9, 0.002, 38);
  }

  // ---------------------------------------------------------------- fighting

  /** Hit sounds by name: slap | shove | punch | kick | radioHit. */
  hit(kind, position = null) {
    if (!this.ctx) return;
    if (this._play(HIT_FILES[kind] ?? 'hit_' + kind, A.hits.volume * rand(0.9, 1.1), position, A.hits)) return;
    if (kind === 'chop') kind = 'slap'; // (synthesised: the same as a slap)
    const t = this.ctx.currentTime;
    const out = this._out(A.hits.volume * rand(0.9, 1.1), position, A.hits);
    if (kind === 'slap') {
      this._noise(t, 0.07, out, 'highpass', 1800, 0.8, 1, 0.001);
      this._noise(t, 0.05, out, 'bandpass', 3500, 2, 0.6, 0.001);
    } else if (kind === 'shove') {
      this._noise(t, 0.14, out, 'lowpass', 600, 1, 0.8, 0.01);
      this._tone(t, 0.15, out, 'sine', 90, 0.5, 0.005, 60);
    } else if (kind === 'punch') {
      this._noise(t, 0.08, out, 'bandpass', 1100, 1.2, 1, 0.001);
      this._tone(t, 0.1, out, 'sine', 120, 0.8, 0.002, 55);
    } else if (kind === 'kick') {
      this._noise(t, 0.12, out, 'lowpass', 500, 1, 1, 0.002);
      this._tone(t, 0.16, out, 'sine', 80, 1, 0.002, 40);
    } else if (kind === 'block') {
      // a blow caught on the forearms: dull and short
      this._noise(t, 0.06, out, 'lowpass', 450, 1, 0.8, 0.002);
      this._tone(t, 0.07, out, 'sine', 70, 0.6, 0.002, 50);
    } else if (kind === 'bat') {
      // wooden CRACK
      this._noise(t, 0.05, out, 'highpass', 2200, 0.7, 1, 0.0005);
      this._tone(t, 0.09, out, 'triangle', 420, 0.6, 0.0005, 260);
      this._tone(t, 0.14, out, 'sine', 110, 0.8, 0.002, 60);
    } else if (kind === 'chair') {
      // metal-and-vinyl clang
      this._tone(t, 0.35, out, 'square', 610, 0.25, 0.001, 590);
      this._tone(t, 0.3, out, 'square', 870, 0.15, 0.001, 850);
      this._noise(t, 0.12, out, 'lowpass', 700, 1, 0.9, 0.002);
    } else if (kind === 'umbrella') {
      // fabric fwump
      this._noise(t, 0.18, out, 'lowpass', 380, 0.8, 1, 0.02);
      this._tone(t, 0.12, out, 'sine', 95, 0.4, 0.01, 70);
    } else if (kind === 'keyboard') {
      // plastic smack and a clatter of loose keys
      this._noise(t, 0.06, out, 'bandpass', 1600, 1.5, 1, 0.001);
      for (let i = 0; i < 6; i++) this._noise(t + 0.04 + i * rand(0.02, 0.05), 0.02, out, 'bandpass', rand(2500, 5000), 6, 0.35, 0.001);
    } else if (kind === 'clipboard') {
      // flat hardboard WHACK on a skull, the clip rattles
      this._noise(t, 0.09, out, 'bandpass', 900, 0.8, 1, 0.001);
      this._tone(t, 0.08, out, 'triangle', 210, 0.7, 0.001, 140);
      this._noise(t + 0.05, 0.12, out, 'bandpass', 4200, 4, 0.3, 0.005);
    } else if (kind === 'radioHit') {
      // plastic clonk, then the speaker crackles
      this._tone(t, 0.12, out, 'square', 320, 0.5, 0.001, 180);
      this._noise(t, 0.1, out, 'bandpass', 1500, 3, 0.9, 0.001);
      this._noise(t + 0.08, 0.4, out, 'bandpass', 2600, 1, 0.25, 0.02);
    }
  }

  /**
   * A prop landing or hitting something. kind: 'metal' (chairs), 'paper' (magazines, clipboard),
   * anything else a thud, deeper for heavier things. strength 0..1.
   */
  propHit(position, strength = 0.5, kind = 'thud', mass = 2) {
    if (!this.ctx) return;
    if (this._play(kind === 'metal' ? 'prop_metal' : kind === 'paper' ? 'prop_paper' : 'prop_thud', 0.15 + 0.6 * strength, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.15 + 0.6 * strength, position, A.hits);
    if (kind === 'metal') {
      this._tone(t, 0.25, out, 'square', rand(520, 680), 0.18, 0.001, rand(480, 560));
      this._tone(t + 0.03, 0.2, out, 'square', rand(780, 900), 0.1, 0.001, 760);
      this._noise(t, 0.08, out, 'bandpass', 2200, 2, 0.6, 0.001);
    } else if (kind === 'paper') {
      this._noise(t, 0.06, out, 'highpass', 1500, 0.7, 0.7, 0.002);
    } else {
      const low = Math.max(45, 140 - Math.min(10, mass) * 9); // heavier: deeper
      this._noise(t, 0.12, out, 'lowpass', 500, 1, 0.8, 0.002);
      this._tone(t, 0.14, out, 'sine', low * 1.5, 0.7, 0.002, low);
    }
  }

  /** The accountant's door unlocking: a deadbolt clunk. */
  doorUnlock(position = null) {
    if (!this.ctx) return;
    if (this._play('door_unlock', 0.6, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.6, position, A.hits);
    this._noise(t, 0.05, out, 'bandpass', 2400, 3, 1, 0.001);
    this._tone(t + 0.04, 0.09, out, 'square', 180, 0.4, 0.001, 120);
  }

  /** Knuckles on a wooden door: three knocks. */
  knock(position = null) {
    if (!this.ctx) return;
    if (this._play('knock', 0.6, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.6, position, A.hits);
    for (let i = 0; i < 3; i++) {
      this._tone(t + i * 0.16, 0.08, out, 'sine', 180, 0.7, 0.001, 120);
      this._noise(t + i * 0.16, 0.04, out, 'bandpass', 900, 2, 0.5, 0.001);
    }
  }

  /** The water cooler: a big hollow glug. */
  glug(position = null) {
    if (!this.ctx) return;
    if (this._play('glug', 0.5, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5, position, A.hits);
    for (let i = 0; i < 3; i++) this._tone(t + i * 0.22, 0.18, out, 'sine', 140 + i * 25, 0.6, 0.01, 220 + i * 30);
  }

  /** A door opening: a long low creak. */
  doorOpen(position = null) {
    if (!this.ctx) return;
    if (this._play('door_open', 0.5, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5, position, A.hits);
    this._tone(t, 1.1, out, 'sawtooth', 95, 0.18, 0.05, 140);
    this._noise(t, 1.0, out, 'bandpass', 700, 8, 0.25, 0.1);
  }

  /** Trying a locked door: the handle rattles. */
  doorRattle(position = null) {
    if (!this.ctx) return;
    if (this._play('door_rattle', 0.5, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5, position, A.hits);
    for (let i = 0; i < 3; i++) this._noise(t + i * 0.09, 0.05, out, 'bandpass', 1600 + i * 200, 4, 0.8, 0.002);
  }

  /** A swing that misses. */
  /** A weapon swung (as it comes round, hit or miss): its own recording (swing_<name>), else the whoosh. */
  swing(name, position = null) {
    if (!this.ctx) return;
    if (this._play('swing_' + name, 0.35, position, A.hits)) return;
    this.whoosh(position);
  }

  whoosh(position = null) {
    if (!this.ctx) return;
    if (this._play('whoosh', 0.25, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.25, position, A.hits);
    const n = this._noise(t, 0.22, out, 'bandpass', 500, 2, 0.8, 0.05);
    n.filter.frequency.exponentialRampToValueAtTime(1800, t + 0.22);
  }

  /** A body hitting the carpet. */
  bodyThud(position = null, strength = 1) {
    if (!this.ctx) return;
    if (this._play('body_thud', 0.8 * strength, position, A.hits)) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.8 * strength, position, A.hits);
    this._noise(t, 0.25, out, 'lowpass', 300, 1, 1, 0.003);
    this._tone(t, 0.3, out, 'sine', 65, 1, 0.003, 35);
  }

  ticketTear(position = null) {
    if (!this.ctx) return;
    if (this._play('ticket_tear', A.ticketTear.volume, position, { refDistance: 1, rolloff: 1 })) return;
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
