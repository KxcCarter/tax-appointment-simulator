/*
  Sound effects generated with ElevenLabs (text to sound effects), into src/audio/sfx/ under the names
  the game looks for (src/audio/soundList.js), several versions of each (hit_punch_1.wav, hit_punch_2.wav...:
  the game picks one at random each time).

    npm run sfxgen                      generate the sounds below that don't have files yet
    npm run sfxgen -- --only hit_bat    (re)generate just this one (all its versions)
    npm run sfxgen -- --force           regenerate everything below
    npm run sfxgen -- --dry             list what would be made
    npm run sfxgen -- --normalize       bring the WAVs already there to the same peak level (no generating)

  The API key is read from .env.local (ELEVENLABS_API_KEY). Each version is a fresh take: if one is bad,
  delete its file and run this again (only missing files are made).

  Files this script didn't make are never touched (owner's rule): not regenerated (even with --force or
  --only), not normalised, not deleted. It keeps a list of the files it made in src/audio/sfx/generated.json;
  anything else in the folder (your own recordings, e.g. hit_bat_1.wav) is yours.
  Files come back as WAV, with the silence before the sound trimmed off so it lands on the frame it's played
  (and MP3, untrimmed, if the account can't get raw audio).
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/audio/sfx');
const args = process.argv.slice(2);
const DRY = args.includes('--dry'), FORCE = args.includes('--force'), NORMALIZE = args.includes('--normalize');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// What to make. versions: how many takes; seconds: length asked for (at least 0.5);
// influence: how literally to follow the prompt (0..1).
const STYLE = 'Single sound effect, close up, dry, no music, no voices, no reverb tail.';
export const SFX = {
  hit_punch: { versions: 3, seconds: 0.6, influence: 0.6,
    prompt: "A hard bare-knuckle punch landing on a man's face: one meaty, slapping fist impact, like a movie fight punch." },
  hit_slap: { versions: 3, seconds: 0.5, influence: 0.6,
    prompt: "A sharp open-hand slap across someone's cheek: one crisp, stinging skin smack." },
  hit_kick: { versions: 3, seconds: 0.6, influence: 0.6,
    prompt: "A heavy kick landing in someone's stomach: one deep, muffled body thud with a rustle of clothes." },
  swing_bat: { versions: 3, seconds: 0.6, influence: 0.6,
    prompt: 'A wooden baseball bat swung hard through the air: one fast, low swoosh. No impact.' },
  hit_bat: { versions: 3, seconds: 0.8, influence: 0.6,
    prompt: "A wooden baseball bat hitting a person's body: a hard hollow wooden crack with a heavy meaty thud." },
  hit_chair: { versions: 3, seconds: 1.0, influence: 0.6,
    prompt: "A metal folding chair with a vinyl seat smashed over someone's back: a loud metallic clang, the frame rattling, a body thud." },
};

function apiKey() {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const m = env.match(/^\s*ELEVENLABS_API_KEY\s*=\s*["']?([^"'\s]+)/m);
  if (!m) throw new Error('No ELEVENLABS_API_KEY in .env.local');
  return m[1];
}

async function generate(def, key, format) {
  const res = await fetch(`https://api.elevenlabs.io/v1/sound-generation?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `${def.prompt} ${STYLE}`, duration_seconds: Math.max(0.5, def.seconds), prompt_influence: def.influence }),
  });
  if (!res.ok) {
    const err = new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

// Every take is brought to the same peak, so versions picked at random are equally loud
// (how loud each sound plays in the game: config.audio.fileVolume). Takes that come back nearly silent are
// generated again.
const PEAK_DB = -1, TOO_QUIET_DB = -35;

/** Raw 16-bit mono PCM -> trimmed (leading silence; a short fade in and out), normalised -> WAV. */
function toWav(pcm, rate = 44100) {
  const n = Math.floor(pcm.length / 2);
  const s = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) { s[i] = pcm.readInt16LE(i * 2) / 32768; peak = Math.max(peak, Math.abs(s[i])); }
  const peakDb = 20 * Math.log10(peak || 1e-9);
  const thr = peak * 0.05;
  let start = 0;
  while (start < n && Math.abs(s[start]) < thr) start++;
  start = Math.max(0, start - Math.round(rate * 0.004)); // (keep the attack)
  let end = n;
  while (end > start && Math.abs(s[end - 1]) < peak * 0.01) end--;
  const out = s.subarray(start, end);
  const fadeIn = Math.min(out.length, Math.round(rate * 0.002)), fadeOut = Math.min(out.length, Math.round(rate * 0.03));
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut;
  const gain = 10 ** (PEAK_DB / 20) / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  const buf = Buffer.alloc(44 + out.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + out.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(out.length * 2, 40);
  for (let i = 0; i < out.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
  return { wav: buf, seconds: out.length / rate, peakDb };
}

// The files this script made (only these may be overwritten, normalised or replaced)
const MANIFEST = path.join(OUT, 'generated.json');
const made = new Set(fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : []);
const mine = (file) => made.has(path.basename(file));
const remember = (file) => { made.add(path.basename(file)); fs.writeFileSync(MANIFEST, JSON.stringify([...made].sort(), null, 2) + '\n'); };

// --normalize: the WAVs this script made, to the same peak (no API calls)
if (NORMALIZE) {
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.wav') && mine(f))) {
    const b = fs.readFileSync(path.join(OUT, f));
    const d = b.indexOf('data');
    const pcm = b.subarray(d + 8, d + 8 + b.readUInt32LE(d + 4));
    const { wav, peakDb } = toWav(Buffer.from(pcm), b.readUInt32LE(24));
    fs.writeFileSync(path.join(OUT, f), wav);
    console.log(`  ${f.padEnd(22)} was ${peakDb.toFixed(1)} dB${peakDb < TOO_QUIET_DB ? '  (nearly silent: delete it and run again for a new take)' : ''}`);
  }
  process.exit(0);
}

const existing = (name, k) => ['wav', 'mp3'].map((e) => path.join(OUT, `${name}_${k}.${e}`)).find((f) => fs.existsSync(f));
let key = null, pcm = true;
for (const [name, def] of Object.entries(SFX)) {
  if (ONLY && name !== ONLY) continue;
  for (let k = 1; k <= def.versions; k++) {
    const have = existing(name, k);
    if (have && !mine(have)) { if (FORCE || ONLY) console.log(`  ${path.basename(have)}: yours, kept`); continue; }
    if (have && !FORCE && !ONLY) continue;
    if (DRY) { console.log(`  would make ${name}_${k}`); continue; }
    key ??= apiKey();
    let file;
    try {
      if (!pcm) throw Object.assign(new Error('mp3'), { status: 0 });
      let made;
      for (let tries = 1; ; tries++) {
        made = toWav(await generate(def, key, 'pcm_44100'));
        if (made.peakDb >= TOO_QUIET_DB || tries >= 3) break;
        console.log(`  (${name}_${k}: nearly silent, ${made.peakDb.toFixed(0)} dB; another take)`);
      }
      const { wav, seconds } = made;
      file = `${name}_${k}.wav`;
      fs.writeFileSync(path.join(OUT, file), wav);
      console.log(`  ${file}  (${seconds.toFixed(2)} s)`);
    } catch (err) {
      if (err.status !== 0 && err.status !== 403 && err.status !== 400 && err.status !== 422) throw err;
      if (pcm && err.status) console.log(`  (raw audio not available: ${err.message.slice(0, 120)}; using MP3, untrimmed)`);
      pcm = false;
      file = `${name}_${k}.mp3`;
      fs.writeFileSync(path.join(OUT, file), await generate(def, key, 'mp3_44100_128'));
      console.log(`  ${file}`);
    }
    remember(file);
    if (have && have !== path.join(OUT, file)) { fs.rmSync(have); made.delete(path.basename(have)); remember(file); } // (replaced in the other format)
  }
}
