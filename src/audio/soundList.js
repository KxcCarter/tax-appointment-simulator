/*
  Every sound effect in the game, by the name its file should have.

  To replace a synthesised sound with a recording, drop a file named after it into src/audio/sfx/:
    hit_punch.mp3   (or .wav, .ogg, .m4a, .flac)
  Several versions of one sound: add a number, and one is picked at random each time (never the same
  one twice in a row):
    hit_punch_1.wav, hit_punch_2.wav, hit_punch_3.wav
  Then `npm run sounds` lists what's there, what's missing, and any file whose name isn't on this list.

  Whether each sound uses its file, the synthesised version or both: config.audio.sounds (src/config.js).
  How loud a file plays: config.audio.fileVolume (1 = as loud as the synthesised version was set).

  group: for the list. where: when it plays. loop: plays continuously (a seamless loop is best).
  pitched: played faster or slower (higher or lower) per character.
*/
export const SOUNDS = {
  // ---- The room ----
  hum: { group: 'Room', where: 'The fluorescent lights: a low hum under everything, all the time.', loop: true },
  mouse_click: { group: 'Room', where: 'The receptionist clicking her mouse at solitaire (positional, at the desk; sometimes twice quickly).' },
  chime: { group: 'Room', where: 'The NOW SERVING display changing number (a two-tone electronic chime).' },
  radio_click: { group: 'Room', where: 'The radio switched on or off (a plastic knob, then a little warm-up static).' },
  glug: { group: 'Room', where: 'The water cooler, when you use it (big hollow glugs).' },
  ticket_tear: { group: 'Room', where: 'Taking a ticket from the dispenser (a clunk, then paper tearing). You, and the newcomer.' },
  paper_slide: { group: 'Room', where: 'The receptionist sliding the check-in clipboard across the counter.' },

  // ---- Doors ----
  knock: { group: 'Doors', where: "Knocking on the accountant's door (three knocks)." },
  door_rattle: { group: 'Doors', where: "Trying the accountant's door while it's locked (the handle rattles)." },
  door_unlock: { group: 'Doors', where: "The accountant's door unlocking when the 4th person goes down (a deadbolt clunk)." },
  door_open: { group: 'Doors', where: "Opening the accountant's door (a long low creak)." },

  // ---- You ----
  footstep: { group: 'You', where: 'Your footsteps (not positional).' },
  chair_creak: { group: 'You', where: 'Sitting down in, or getting up from, a chair (vinyl and metal creak).' },
  voice_blip: { group: 'You', where: "Dialogue: one short blip per letter as a line types out, for everyone. Played higher or lower for each character's voice: record it at a middle pitch, around G3 (196 Hz); config.audio.blipBasePitch says which pitch it is.", pitched: true },

  // ---- The waiting people ----
  cough: { group: 'Waiting people', where: 'The older man coughing (one cough; he does 2-3 in a row).' },
  sigh: { group: 'Waiting people', where: 'A long, resigned exhale (the man with the watch, the young man).' },
  page_turn: { group: 'Waiting people', where: 'The woman turning a magazine page.' },
  chair_shift: { group: 'Waiting people', where: 'The woman in red shifting her weight on her vinyl chair.' },
  watch_tick: { group: 'Waiting people', where: "The man with the briefcase's wristwatch: a tiny tick every second, only audible up close." },
  stomp: { group: 'Waiting people', where: 'A heavy footstep: someone angry walking (the radio war), the gamer walking, and landing from a leap in the brawl. Played louder the angrier they are.' },

  // ---- The gamer ----
  crunch: { group: 'The gamer', where: 'Chips being crunched (a mouthful: a few crunches).' },
  bag_rustle: { group: 'The gamer', where: 'A hand in a foil chip bag; also the bag upended for the crumbs.' },
  gulp: { group: 'The gamer', where: 'Gulping from his energy drink (about three gulps).' },
  burp: { group: 'The gamer', where: 'A short burp after a sip, sometimes.' },

  // ---- Fighting ----
  whoosh: { group: 'Fighting', where: 'A swing that misses; someone leaping; something thrown.' },
  body_thud: { group: 'Fighting', where: 'A body hitting the floor (knocked down, flopping about), and you going down. Louder for harder landings.' },
  hit_slap: { group: 'Fighting', where: 'A slap. Also a magazine hitting someone.' },
  hit_shove: { group: 'Fighting', where: 'A shove (you being shoved, by the newcomer, the receptionist guarding her space).' },
  hit_punch: { group: 'Fighting', where: "A punch landing (anyone's fists, a jab), also thrown things with no sound of their own." },
  hit_kick: { group: 'Fighting', where: "A kick landing; your heavy 3rd punch (the hook); the briefcase, potted plant and water bottle as weapons." },
  hit_block: { group: 'Fighting', where: 'A blow caught on your raised arms (blocking).' },
  hit_chop: { group: 'Fighting', where: 'A karate chop landing. (No file: uses hit_slap.)', fallback: 'hit_slap' },
  hit_bat: { group: 'Fighting', where: 'The baseball bat (a wooden crack).' },
  hit_chair: { group: 'Fighting', where: 'A chair, or the fire extinguisher, hitting someone (a metal-and-vinyl clang).' },
  hit_umbrella: { group: 'Fighting', where: 'The umbrella, or the mop (a fabric fwump).' },
  hit_keyboard: { group: 'Fighting', where: "The receptionist's keyboard (a plastic smack and loose keys clattering)." },
  hit_clipboard: { group: 'Fighting', where: 'The clipboard, smashed over someone\'s head (hardboard whack, the clip rattles).' },
  hit_radio: { group: 'Fighting', where: 'The radio used as a weapon (a plastic clonk, the speaker crackles).' },

  // ---- Things falling over ----
  prop_metal: { group: 'Things falling', where: 'A chair landing or hitting something (a metal clatter). Louder for harder impacts.' },
  prop_paper: { group: 'Things falling', where: 'A magazine or the clipboard landing (a paper slap).' },
  prop_thud: { group: 'Things falling', where: 'Anything else landing or hitting something: briefcase, umbrella, plant, water bottle, radio, the gamer\'s can... (a thud; louder for harder impacts).' },
};

/*
  Not on this list (already files, set up elsewhere in config.js):
    src/audio/clock_tick.mp3        the wall clock's tick-tock (config.audio.clockTick)
    src/audio/look_to_the_sky.mp3   the song on the radio (config.radio.file)
*/

/** "hit_punch_2" -> "hit_punch" (numbered versions of one sound). */
export function soundNameOf(fileBase) {
  if (SOUNDS[fileBase]) return fileBase;
  const m = fileBase.match(/^(.*)_\d+$/);
  return m && SOUNDS[m[1]] ? m[1] : null;
}
