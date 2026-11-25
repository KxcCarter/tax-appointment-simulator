# Sound effects

Drop a recording here named after the sound it replaces (`.mp3`, `.wav`, `.ogg`, `.m4a` or `.flac`), e.g. `hit_punch.mp3`.
Several versions of one sound: number them (`hit_punch_1.wav`, `hit_punch_2.wav`, ...) and one is picked at random each time.
A sound with no file here stays synthesised. Run `npm run sounds` to see what is here and what is missing.

Per sound, `config.audio.sounds` in src/config.js can say `synth` (keep the synthesised one even with a file here) or `both` (play the file and the synthesised one together); `config.audio.fileVolume` sets how loud a file plays. The list itself lives in src/audio/soundList.js.

## Room

| File name | When it plays |
|---|---|
| `hum` | The fluorescent lights: a low hum under everything, all the time. **Loops.** |
| `mouse_click` | The receptionist clicking her mouse at solitaire (positional, at the desk; sometimes twice quickly). |
| `chime` | The NOW SERVING display changing number (a two-tone electronic chime). |
| `radio_click` | The radio switched on or off (a plastic knob, then a little warm-up static). |
| `glug` | The water cooler, when you use it (big hollow glugs). |
| `ticket_tear` | Taking a ticket from the dispenser (a clunk, then paper tearing). You, and the newcomer. |
| `paper_slide` | The receptionist sliding the check-in clipboard across the counter. |

## Doors

| File name | When it plays |
|---|---|
| `knock` | Knocking on the accountant's door (three knocks). |
| `door_rattle` | Trying the accountant's door while it's locked (the handle rattles). |
| `door_unlock` | The accountant's door unlocking when the 4th person goes down (a deadbolt clunk). |
| `door_open` | Opening the accountant's door (a long low creak). |

## You

| File name | When it plays |
|---|---|
| `footstep` | Your footsteps (not positional). |
| `chair_creak` | Sitting down in, or getting up from, a chair (vinyl and metal creak). |
| `voice_blip` | Dialogue: one short blip per letter as a line types out, for everyone. Played higher or lower for each character's voice: record it at a middle pitch, around G3 (196 Hz); config.audio.blipBasePitch says which pitch it is. |

## Waiting people

| File name | When it plays |
|---|---|
| `cough` | The older man coughing (one cough; he does 2-3 in a row). |
| `sigh` | A long, resigned exhale (the man with the watch, the young man). |
| `page_turn` | The woman turning a magazine page. |
| `chair_shift` | The woman in red shifting her weight on her vinyl chair. |
| `watch_tick` | The man with the briefcase's wristwatch: a tiny tick every second, only audible up close. |
| `stomp` | A heavy footstep: someone angry walking (the radio war), the gamer walking, and landing from a leap in the brawl. Played louder the angrier they are. |

## The gamer

| File name | When it plays |
|---|---|
| `crunch` | Chips being crunched (a mouthful: a few crunches). |
| `bag_rustle` | A hand in a foil chip bag; also the bag upended for the crumbs. |
| `gulp` | Gulping from his energy drink (about three gulps). |
| `burp` | A short burp after a sip, sometimes. |

## Fighting

| File name | When it plays |
|---|---|
| `whoosh` | A swing that misses; someone leaping; something thrown. |
| `body_thud` | A body hitting the floor (knocked down, flopping about), and you going down. Louder for harder landings. |
| `hit_slap` | A slap. Also a magazine hitting someone. |
| `hit_shove` | A shove (you being shoved, by the newcomer, the receptionist guarding her space). |
| `hit_punch` | A punch landing (anyone's fists, a jab), also thrown things with no sound of their own. |
| `hit_kick` | A kick landing; your heavy 3rd punch (the hook); the briefcase, potted plant and water bottle as weapons. |
| `hit_block` | A blow caught on your raised arms (blocking). |
| `hit_chop` | A karate chop landing. (No file: uses hit_slap.) |
| `hit_bat` | The baseball bat (a wooden crack). |
| `swing_bat` | Swinging the baseball bat, hit or miss (a fast swoosh as it comes round). (No file: the whoosh.) |
| `hit_chair` | A chair, or the fire extinguisher, hitting someone (a metal-and-vinyl clang). |
| `hit_umbrella` | The umbrella, or the mop (a fabric fwump). |
| `hit_keyboard` | The receptionist's keyboard (a plastic smack and loose keys clattering). |
| `hit_clipboard` | The clipboard, smashed over someone's head (hardboard whack, the clip rattles). |
| `hit_radio` | The radio used as a weapon (a plastic clonk, the speaker crackles). |

## Things falling

| File name | When it plays |
|---|---|
| `prop_metal` | A chair landing or hitting something (a metal clatter). Louder for harder impacts. |
| `prop_paper` | A magazine or the clipboard landing (a paper slap). |
| `debris` | A small thing landing or hitting something: the bat, the radio, the keyboard, the gamer's can and chips, hats, glasses... (anything under `config.physics.impact.debrisBelow` kg; no file: `prop_thud`). |
| `prop_thud` | Anything heavier landing or hitting something: briefcase, plant, water bottle, umbrella stand, fire extinguisher... (a thud; louder for harder impacts). |

## Already files (not here)

- `src/audio/clock_tick.mp3`: the wall clock (config.audio.clockTick)
- `src/audio/look_to_the_sky.mp3`: the radio song (config.radio.file)

## Generated

`npm run sfxgen` (`scripts/sfxgen.mjs`) makes sounds with ElevenLabs from the prompts in that script: three takes each, trimmed and brought to the same level. So far: `hit_punch`, `hit_slap`, `hit_kick`, `swing_bat`, `hit_bat`, `hit_chair`. Delete a take you don't like and run it again for a new one. The script only ever touches the files it made itself (listed in `generated.json`): your own recordings in this folder are never regenerated, normalised or deleted, even with `--force`.
