/*
  npm run sounds: which sound effects have a recording in src/audio/sfx/, which are still synthesised,
  and any file there whose name isn't a sound (src/audio/soundList.js). Also what config.audio.sounds
  says for each (auto / synth / both). Read-only: it changes nothing.
*/
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOUNDS, soundNameOf } from '../src/audio/soundList.js';

const dir = fileURLToPath(new URL('../src/audio/sfx/', import.meta.url));
const AUDIO = /\.(mp3|wav|ogg|m4a|flac)$/i;
const files = readdirSync(dir).filter((f) => AUDIO.test(f));
const others = readdirSync(dir).filter((f) => !AUDIO.test(f) && !f.startsWith('.') && f !== 'README.md' && f !== 'generated.json');

// config.audio.sounds, read from config.js without running the game
let modes = {};
try {
  const { config } = await import('../src/config.js');
  modes = config.audio.sounds ?? {};
} catch { /* (config.js needs the browser for some imports: modes shown as auto) */ }

const found = {}, unknown = [];
for (const f of files) {
  const name = soundNameOf(f.replace(AUDIO, ''));
  if (name) (found[name] ??= []).push(f); else unknown.push(f);
}

let group = null, have = 0;
for (const [name, s] of Object.entries(SOUNDS)) {
  if (s.group !== group) { group = s.group; console.log(`\n${group}`); }
  const mode = modes[name] ?? 'auto';
  const list = found[name];
  if (list) have++;
  const status = list ? `FILE  ${list.join(', ')}` : s.fallback && found[s.fallback] ? `(uses ${s.fallback})` : 'synthesised';
  const note = mode === 'auto' ? '' : `   [${mode}]`;
  console.log(`  ${list ? '✓' : '·'} ${name.padEnd(14)} ${status}${note}`);
}
console.log(`\n${have} of ${Object.keys(SOUNDS).length} sounds have a recording.`);
if (unknown.length) console.log(`\nNot used (the name isn't a sound; see src/audio/soundList.js):\n  ${unknown.join('\n  ')}`);
if (others.length) console.log(`\nNot audio files (ignored): ${others.join(', ')}`);
