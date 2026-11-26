/*
  Recorded voice lines (ElevenLabs text-to-speech).

    npm run voices -- --dry          list every line and the character count; nothing is generated
    npm run voices                   generate the lines that don't have a recording yet
    npm run voices -- --force        regenerate everything
    npm run voices -- --only "pen"   (re)generate only lines containing this text

  Who has a voice: VOICES below. The API key is read from .env.local (ELEVENLABS_API_KEY).
  The recordings go to src/audio/voice/<who>/, with lines.json mapping each line's text to its file.
  The game plays a line's recording whenever that exact text is said (src/director/director.js).
  Edit a line in the data and run this again: new text gets a new recording; recordings for text that's
  no longer said are listed as unused (delete them by hand, or with --prune).

  Lines built while playing (the time on the clock, the ticket number) are generated for the values they
  can realistically take: EXPAND below.

  Directing a line: DIRECTIONS below (what's sent instead of the text, e.g. with eleven_v3 audio tags,
  and other settings). The text on screen stays as written. Every request sent is kept in
  src/audio/voice/<who>/sent.json; change a line's direction and the next run records it again.

  The owner's own recordings are never replaced or deleted (owner's rule), not even with --force, --only
  or --prune. Only files this script made can be: each one it writes is fingerprinted in
  src/audio/voice/<who>/made.json, and a file that isn't listed there, or has changed since (re-recorded or
  edited by hand), is the owner's and is kept. Whole characters whose recordings are all the owner's:
  OWNER_VOICES (for them, only lines with no recording at all are generated).
*/
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry'), FORCE = args.includes('--force'), PRUNE = args.includes('--prune');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// Characters whose recordings the owner made or replaced by hand: never regenerated or pruned
const OWNER_VOICES = ['receptionist', 'reader'];

// ---- Who has a voice ----
export const VOICES = {
  receptionist: {
    voiceId: 'u0REnIJvUgcGQYW2Ux8K',
    model: 'eleven_multilingual_v2',
    // stability: lower = more expressive, higher = flatter and steadier
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
  },
  // The waiting people (ids: src/data/waitingRoomCast.js)
  sitter: { voiceId: 'wkqe33083YLBV35we7yB' },   // the woman in red
  cougher: { voiceId: 'MKlLqCItoCkvdhrxgtLv' },  // the older man
  jiggler: { voiceId: 'mrQhZWGbb2k9qWJb5qeA' },  // the young man
  newcomer: { voiceId: 'Cx1u6YPIa1SPiAbYj3gJ' }, // the man in the trench coat (848)
  watchChecker: { voiceId: '3y1FmEGNzXJhlyyCO6Kr' }, // the man in the suit, with the briefcase and the watch
  reader: { voiceId: 'ejl43bbp2vjkAFGSmAMa' },   // the woman with the magazine
};
// (anyone without their own model / settings gets these)
const DEFAULT_VOICE = { model: 'eleven_multilingual_v2', settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } };

// ---- Directions for single lines (owner) ----
// who -> the line exactly as written in the data -> what to send instead:
//   say:      the text spoken (e.g. with eleven_v3 audio tags: [scared], [laughs], [whispers], [shouts]...;
//             tags only work on eleven_v3: other models read them out)
//   model:    e.g. 'eleven_v3'
//   settings: voice_settings for this line (replace the voice's own). On eleven_v3, stability is
//             0 (Creative, the most expressive), 0.5 (Natural) or 1 (Robust).
export const DIRECTIONS = {
  receptionist: {
    'Oh Lawd he violent!!': { say: '[scared]Oh Lawd he violent!!', model: 'eleven_v3', settings: { stability: 0 } },
    "Shhh, momma's gotta play her game.": { say: 'Shhh, momma gotta play her game.' },
    'This man boutta make me lose my game...': { say: 'This man boutta make me lose my gaaame!' },
    "Mamma playin' her game...": { say: 'Mamma playin her gaaaame...' },
    'Ooo, this is a good angle.': { say: 'Ooo, this a good angle.' },
    'Mmm, from over here. Yes.': { say: 'Mmm, from over here. Yaaas.' },
  },
};

// ---- The brawl (owner): everything the waiting people shout in it, angry and energetic ----
// (the receptionist's lines are left alone). A line in DIRECTIONS above still wins.
// Which lines: brawlShouts in src/data/npcConversations.ts (opening, called, again, anytime,
// friendlyFire, byPerson), plus BRAWL_ALSO.
const BRAWL = { tags: '[angry] [shouting]', model: 'eleven_v3', settings: { stability: 0 } };
const BRAWL_ALSO = ["The creep's trying to run away! Get him!!"]; // (the young man: the line that starts it)
const BRAWL_LINES = {}; // who -> Set of lines (filled by collect)

/** The request body for a line: its direction if it has one, else the voice's defaults. */
function requestFor(who, text) {
  const v = { ...DEFAULT_VOICE, ...VOICES[who] };
  const brawl = who !== 'receptionist' && BRAWL_LINES[who]?.has(text)
    ? { say: `${BRAWL.tags} ${speakable(text)}`, model: BRAWL.model, settings: BRAWL.settings } : {};
  const d = DIRECTIONS[who]?.[text] ?? brawl;
  return { text: d.say ?? speakable(text), model_id: d.model ?? v.model, voice_settings: d.settings ?? v.settings };
}

// ---- Lines whose text depends on the game ----
const clockAt = (h, m) => ((h % 12) * 60 + m) * 60 + 12 * 3600; // state.clockTime for h:mm PM
const times = (from, to) => { const out = []; for (let m = from; m <= to; m++) out.push(clockAt(1, 0) + (m - 60) * 60); return out; };
const minutes = (h, m) => h * 60 + m; // 1:55 -> 115
const EXPAND = [
  // "Clock says it's 1:57." (only ever said before 2:00)
  { match: /^Clock says it's/, clock: times(minutes(1, 55), minutes(1, 59)) },
  // "We don't have any appointments scheduled for 2:07." (any time except 2:00 to 2:02; up to 2:30)
  { match: /^We don't have any appointments/, clock: [...times(minutes(1, 55), minutes(1, 59)), ...times(minutes(2, 3), minutes(2, 30))] },
];
const DEFAULT_CLOCK = times(minutes(1, 55), minutes(2, 30));
// Said from code, not the data files (src/level/waitingRoomLevel.js): the failure loop, ticket x2 each time
const EXTRA = {
  receptionist: [847 * 2, 847 * 4, 847 * 8, 847 * 16, 847 * 32]
    .map((n) => `Number ${n.toLocaleString('en-US')}. Please have a seat. We'll call you.`),
};

// ---- How a line is read out (the text on screen stays as written) ----
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words = (n) => {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + words(n % 100) : '');
  return words(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + words(n % 1000) : '');
};
const clockWords = (h, m) => m === 0 ? `${words(h)} o'clock` : `${words(h)} ${m < 10 ? 'oh-' + words(m) : words(m)}`;
export function speakable(text) {
  return text
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => clockWords(+h, +m))
    .replace(/\b(\d{1,3}(?:,\d{3})+|\d{3,})\b/g, (s) => {
      const n = +s.replace(/,/g, '');
      // ticket numbers are called like "eight forty-eight"; years like "nineteen seventy-nine"
      if (n < 1000) return `${ONES[Math.floor(n / 100)]} ${words(n % 100)}`;
      if (!s.includes(',') && n >= 1100 && n < 2100) {
        const r = n % 100;
        return `${words(Math.floor(n / 100))} ${r === 0 ? 'hundred' : r < 10 ? 'oh-' + words(r) : words(r)}`;
      }
      return words(n);
    })
    .replace(/\b\d+\b/g, (s) => words(+s));
}

// ---- Collecting the lines ----
async function collect() {
  const beats = await import('../src/data/waitingRoomBeats.ts');
  const convo = await import('../src/data/npcConversations.ts');
  const remarks = await import('../src/data/roomRemarks.ts');
  const found = Object.fromEntries(Object.keys(VOICES).map((w) => [w, new Set()]));
  const seen = new Set();
  const addText = (who, text) => {
    if (!found[who]) return;
    if (typeof text === 'string') { if (/[A-Za-z0-9]/.test(text)) found[who].add(text); } // ("..." stays blips)
    else if (Array.isArray(text)) text.forEach((t) => addText(who, t));
    else if (typeof text === 'function') {
      // try it at every likely time on the clock; keep the times this line can be said at
      // (and every count of things asked: the young man's replies to "Could you stop that?")
      const states = DEFAULT_CLOCK.flatMap((clockTime) => [1, 2, 3, 4, 5, 6].map((jiggleAsks) => ({ clockTime, ticketNumber: 847, jiggleAsks })));
      const outs = new Set(states.map((st) => {
        try { return text(st); } catch { return null; }
      }).filter((s) => typeof s === 'string'));
      for (const s of outs) {
        const rule = EXPAND.find((r) => r.match.test(s));
        if (!rule) { found[who].add(s); continue; }
        const ok = new Set(rule.clock.map((clockTime) => text({ clockTime, ticketNumber: 847 })));
        if (ok.has(s)) found[who].add(s);
      }
    }
  };
  const walk = (o, who = null) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (typeof o.who === 'string' && 'text' in o) addText(o.who, o.text);
    for (const v of Object.values(o)) walk(v);
  };
  walk(beats);
  walk(convo);
  walk(remarks);
  // Lists that are the receptionist's by name
  const B = convo.brawlShouts;
  addText('receptionist', [...B.receptionist, ...B.receptionistMoving, B.receptionistAfter, B.receptionistAllDown, ...remarks.trespassLines]);
  // Brawl shouts go to whoever's standing (src/level/brawl.js), so everyone with a voice says them all
  for (const who of Object.keys(VOICES)) {
    if (who === 'receptionist') continue;
    const shouts = [...B.opening, ...B.called, ...(B.again ?? []), ...B.anytime, ...B.friendlyFire, ...(B.byPerson?.[who] ?? [])];
    // (a shout that's also said outside the brawl shares its recording: it's angry there too)
    const shared = shouts.filter((t) => found[who].has(t));
    if (shared.length) console.log(`  (${who}: also said outside the brawl, so angry there too: ${shared.join(' | ')})`);
    BRAWL_LINES[who] = new Set([...shouts, ...BRAWL_ALSO.filter((t) => found[who].has(t))]);
    addText(who, shouts);
    addText(who, convo.people?.[who]?.radioComplaints ?? []);
  }
  // Brushing him off after he hit the woman in red
  for (const [who, list] of Object.entries(convo.appalledReplies ?? {})) addText(who, list);
  // The sitter, caught being looked at (config.npc.eyesUp)
  addText('sitter', (convo.eyesUp ?? []).map((l) => l.text));
  for (const [who, list] of Object.entries(EXTRA)) addText(who, list);
  return found;
}

// ---- Files ----
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'line';
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
function apiKey() {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const m = env.match(/^\s*ELEVENLABS_API_KEY\s*=\s*["']?([^"'\s]+)/m);
  if (!m) throw new Error('No ELEVENLABS_API_KEY in .env.local');
  return m[1];
}

async function tts(voiceId, body, key) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const reply = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`ElevenLabs ${res.status}: ${reply.slice(0, 300)}`);
  }
}

const found = await collect();
let key = null;
for (const [who, set] of Object.entries(found)) {
  const dir = path.join(ROOT, 'src/audio/voice', who);
  const manifestFile = path.join(dir, 'lines.json');
  const manifest = readJson(manifestFile);
  const sentFile = path.join(dir, 'sent.json');
  const sent = readJson(sentFile); // text -> the request its recording was made with
  const lines = [...set];
  // A line's direction changed since it was recorded (lines from before sent.json: only if directed)
  const directed = (t) => !!DIRECTIONS[who]?.[t] || (who !== 'receptionist' && !!BRAWL_LINES[who]?.has(t));
  const changed = (t) => JSON.stringify(sent[t] ?? (directed(t) ? null : requestFor(who, t))) !== JSON.stringify(requestFor(who, t));
  // Fingerprints of the files this script made: anything else (or changed since) is the owner's
  const madeFile = path.join(dir, 'made.json');
  const made = readJson(madeFile);
  const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, file))).digest('hex');
  const has = (t) => manifest[t] && fs.existsSync(path.join(dir, manifest[t]));
  const owners = (t) => has(t) && (OWNER_VOICES.includes(who) || made[manifest[t]] !== hash(manifest[t]));
  const kept = lines.filter((t) => owners(t) && (FORCE || ONLY ? (!ONLY || t.includes(ONLY)) : changed(t)));
  const todo = lines.filter((t) => !owners(t) && (ONLY ? t.includes(ONLY) : FORCE || !has(t) || changed(t)));
  if (kept.length) console.log(`  (${who}: ${kept.length} of your own recording(s) kept, not regenerated)`);
  const chars = todo.reduce((n, t) => n + requestFor(who, t).text.length, 0);
  const recorded = lines.filter((t) => manifest[t] && fs.existsSync(path.join(dir, manifest[t]))).length;
  console.log(`\n${who}: ${lines.length} lines, ${recorded} recorded, ${todo.length} to generate (${chars} characters)`);
  if (DRY) {
    for (const t of lines) {
      const r = requestFor(who, t), dir = directed(t);
      console.log(`  ${todo.includes(t) ? '·' : '✓'} ${t}${r.text !== t ? `   [says: ${r.text}]` : ''}${dir ? `   (${r.model_id}, ${JSON.stringify(r.voice_settings)})` : ''}`);
    }
    continue;
  }
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set(Object.values(manifest));
  let n = 0;
  for (const text of todo) {
    key ??= apiKey();
    let file = manifest[text];
    if (!file) {
      const base = slug(text);
      file = `${base}.mp3`;
      for (let i = 2; used.has(file) || fs.existsSync(path.join(dir, file)); i++) file = `${base}_${i}.mp3`; // (never over a file that's there)
      used.add(file);
    }
    const body = requestFor(who, text);
    const audio = await tts(VOICES[who].voiceId, body, key);
    fs.writeFileSync(path.join(dir, file), audio);
    made[file] = hash(file);
    fs.writeFileSync(madeFile, JSON.stringify(made, null, 2) + '\n');
    manifest[text] = file;
    sent[text] = body;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n'); // (after each, so a failure keeps what's done)
    fs.writeFileSync(sentFile, JSON.stringify(sent, null, 2) + '\n');
    console.log(`  [${++n}/${todo.length}] ${file}  ${text}`);
  }
  // Recordings of lines nobody says any more
  const stale = Object.keys(manifest).filter((t) => !set.has(t));
  if (stale.length) {
    console.log(`  ${stale.length} recording(s) of lines no longer in the game:`);
    for (const t of stale) {
      console.log(`    ${manifest[t]}  ${t}`);
      if (PRUNE && owners(t)) { console.log('      (yours: kept)'); continue; }
      if (PRUNE) { fs.rmSync(path.join(dir, manifest[t]), { force: true }); delete made[manifest[t]]; delete manifest[t]; }
    }
    if (PRUNE) { fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n'); fs.writeFileSync(madeFile, JSON.stringify(made, null, 2) + '\n'); }
  }
}
