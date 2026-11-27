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
| `glass_break` | A glass shelf shattering (hit, or something thrown or someone knocked into it). |
| `phone_shutter` | A phone camera's shutter, quiet (the man with the watch sneaking a photo of the woman in red). |
| `phone_ring` | The receptionist's cellphone ringing (her cousin calls: beat phone_call). |
| `radio_click` | The radio switched on or off (a plastic knob, then a little warm-up static). |
| `glug` | The water cooler, when you use it (big hollow glugs). |
| `ticket_tear` | Taking a ticket from the dispenser (a clunk, then paper tearing). You, and the newcomer. |
| `paper_slide` | The receptionist sliding the check-in clipboard across the counter. |

## Player

| File name | When it plays |
|---|---|
| `heartbeat` | The player's heart pounding as the argument heats up (one lub-dub; it speeds up). Used if there are none of the three below. |
| `heartbeat_slow` | One heartbeat, the argument just heating up (falls back to heartbeat). |
| `heartbeat_medium` | One heartbeat, the argument well under way (falls back to heartbeat). |
| `heartbeat_fast` | One heartbeat, the argument about to boil over (falls back to heartbeat). |
| `breathing_slow` | The player breathing hard, steadily: a loop (several seconds). Crossfades into breathing_fast as he gets worked up (the argument) or tired and hurt (the brawl). With these two, the breath_* sounds below are not used. **Loops.** |
| `breathing_fast` | The player panting, out of breath: a loop (several seconds). See breathing_slow. **Loops.** |
| `breath_in` | The player breathing in, hard, as the argument heats up. |
| `brawl_breath_in` | The player breathing in, heavily, out of breath in the brawl (falls back to breath_in). |
| `brawl_breath_out` | The player breathing out, heavily, out of breath in the brawl (falls back to breath_out). |
| `breath_out` | The player breathing out, hard, as the argument heats up. |
| `player_hurt` | The player grunting when a blow gets through (not when he blocks it). |

## Doors

| File name | When it plays |
|---|---|
| `knock` | Knocking on the accountant's door (three knocks). |
| `door_rattle` | Trying the accountant's door while it's locked (the handle rattles). |
| `door_unlock` | The accountant's door unlocking when the last of them goes down (a deadbolt clunk). |
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
| `hurt_male_loud` | A man hit hard (a heavy blow, a knockdown): a loud grunt. |
| `hurt_male` | A man hit (a grunt). |
| `hurt_male_quiet` | A man hit lightly, or grabbed (a small grunt). |
| `hurt_female_hard` | A woman hit hard (a heavy blow, a knockdown). |
| `hurt_female` | A woman hit (a grunt). |
| `hurt_female_soft` | A woman hit lightly (a small grunt). |
| `gasp_female` | A woman gasping: grabbed by the player; the woman with the magazine when he first hits the woman in red. |
| `effort_female` | The woman in red or the woman with the magazine yelling as she attacks (now and then, only when nobody is talking). |
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
| `hit_kick` | A kick landing; the briefcase, potted plant and water bottle as weapons. |
| `hit_punch_heavy` | Your heavy punches: the hook (every 3rd quick punch) and wound-up ones. (No file: hit_kick.) |
| `hit_punch_taken` | Their punches landing on you. (No file: hit_punch.) |
| `hit_jab` | The old man's boxing jabs. (No file: hit_punch.) |
| `wall_slam` | Someone shoved (G, then click) into a wall or the furniture: a crash. |
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
| `glass_tinkle` | Pieces of a broken glass shelf landing. |
| `debris` | A small thing landing or hitting something: the bat, the radio, the keyboard, the gamer's can and chips, hats, glasses... (lighter than config.physics.impact.debrisBelow kg; heavier things: prop_thud). |
| `prop_thud` | Anything else landing or hitting something: briefcase, umbrella, plant, water bottle, radio, the gamer's can... (a thud; louder for harder impacts). |

## Already files (not here)

- `src/audio/clock_tick.mp3`: the wall clock (config.audio.clockTick)
- `src/audio/look_to_the_sky.mp3`: the radio song (config.radio.file)

## From the weloveindies.com pack

Most of the grunts, gasps, yells, the breathing loops, the heartbeats, the coughs, the glass, the wall slams and the
heavy / taken / jab punches came from a pack (renamed from their labels). Unused from it, left in `sound_fx_pack/`:
a stone-debris explosion and two long heartbeat sequences. Like your own recordings, the scripts never touch them.

## Generated

`npm run sfxgen` (`scripts/sfxgen.mjs`) makes sounds with ElevenLabs from the prompts in that script: three takes each, trimmed and brought to the same level. So far: `hit_punch`, `hit_slap`, `hit_kick`, `swing_bat`, `hit_bat`, `hit_chair`. Delete a take you don't like and run it again for a new one. The script only ever touches the files it made itself (listed in `generated.json`): your own recordings in this folder are never regenerated, normalised or deleted, even with `--force`.
