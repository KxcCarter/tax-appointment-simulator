# Sound effects

Every sound in the game, for replacing with recorded audio. Today almost all of them are **synthesized** in
code (`src/audio/sfx.js`, Web Audio); two are already real files. Volumes and how far each carries are in
`config.audio` (`src/config.js`).

**Positional** sounds come from a point in the room (louder when you're close, panned left/right); the others
are heard the same everywhere. **Variations** = worth recording a few takes, because it repeats a lot.

## Already real files
| Sound | File | Notes |
|---|---|---|
| Radio song | `src/audio/look_to_the_sky.mp3` | Loops from the radio, very soft and band-limited like a small speaker (`config.radio`). |
| Clock tick-tock | `src/audio/clock_tick.mp3` | 2 s recording (tick + tock), restarted every even second from the clock. Synthesized fallback: `clockTick`. |

## Room and ambience
| ID | What it is | When it plays | Positional | Record |
|---|---|---|---|---|
| `hum` | Fluorescent-light hum and ballast buzz, slowly wavering | All the time (room tone) | No | A seamless loop, 10–30 s |
| `clockTick` | A single tick (fallback only) | Only if `clock_tick.mp3` can't load | Clock | Already replaced |
| `mouseClick` | A mouse click, sometimes a double click | The receptionist playing solitaire, on and off, all game | Her desk | Single + double click, several takes |
| `chime` | Dull two-tone electronic chime | The NOW SERVING display changes (848, 847) | Display | One take |
| `radioClick` | Plastic rotary switch, then a moment of warm-up static | The radio turned on or off | Radio | On and off clicks |
| `glug` | Big hollow glug from the water cooler | [E] "Have a cup of water" | Cooler | Cooler bottle glugs |

## The player
| ID | What it is | When it plays | Positional | Record |
|---|---|---|---|---|
| `footstep` | Soft step on carpet | Walking, one per stride | No | Office shoes on carpet, 4–6 takes |
| `chairCreak` | Vinyl chair creak | Sitting down / standing up | Chair | 3–4 takes |
| `ticketTear` | Paper ticket torn off a dispenser roll | Taking a number (also the newcomer taking his) | Dispenser | One or two takes |
| `blip` | Short voice blip, pitched per speaker | Every few letters while a line of dialogue types out | Speaker | Could become short mumble syllables per character, or stay synthesized |

## The receptionist
| ID | What it is | When it plays | Positional | Record |
|---|---|---|---|---|
| `paperSlide` | Clipboard shoved across a laminate counter, ending in a tap | She slides the check-in sheet over | Counter | One take |
| `mouseClick` | (see Room) | | | |

## The waiting people
| ID | What it is | When it plays | Positional | Record |
|---|---|---|---|---|
| `cough` | Dry, unproductive cough | The older man, too often | Him | Several takes (it repeats a lot) |
| `sigh` | Long, resigned exhale | The man with the watch, after checking it | Him | 2–3 takes |
| `watchTick` | Faint wristwatch ticking | While he looks at his watch | His wrist | Short loop or a few ticks |
| `pageTurn` | Magazine page turn | The woman reading | Her | 3–4 takes |
| `chairShift` | Weight shifting on a vinyl chair | People fidgeting in their seats | Them | 3–4 takes |
| `stomp` | Angry footstep, heavier the angrier | The sitter marching to the radio (radio war), people storming over in the brawl | Them | Heels on carpet, a few weights of stomp |

## Doors
| ID | What it is | When it plays | Positional | Record |
|---|---|---|---|---|
| `knock` | Three knocks on a wooden door | [E] "Knock" on the accountant's door (before the brawl) | Door | One take |
| `doorRattle` | Locked handle rattling | [E] "Try the door" during the brawl | Door | One take |
| `doorUnlock` | Deadbolt clunk | The door unlocks after 4 knockdowns | Door | One take |
| `doorOpen` | Long low door creak | Opening the accountant's door | Door | One take |

## Fighting
### Hits: `hit(kind)`
Played where the blow lands (on the player, or on whoever the player hits). All of these get variations.

| Kind | What it is | When it plays |
|---|---|---|
| `slap` | Sharp open-hand slap | The sitter's slap (radio war, brawl) |
| `shove` | Muffled two-handed shove | Shoves; also the receptionist pushing the player out from behind her desk |
| `punch` | Punch thwack | Punches, both ways |
| `kick` | Heavy thud | Kicks; also the default hit for heavy weapons (briefcase, plant, water bottle) and the punch combo's hook |
| `block` | Dull blow caught on raised forearms | The player blocking a blow from the front |
| `bat` | Wooden crack | Baseball bat |
| `chair` | Metal-and-vinyl clang | Chair; also the fire extinguisher |
| `umbrella` | Fabric fwump | Umbrella, mop |
| `keyboard` | Plastic smack and a clatter of loose keys | The receptionist's keyboard |
| `clipboard` | Hardboard whack on a skull, clip rattling | The clipboard (the newcomer's opener, or the player's) |
| `radioHit` | Plastic clonk, then speaker crackle | The radio as a weapon (the sitter's, or the player's) |
| *(magazine)* | uses `slap` | |

Which sound each weapon uses is `sound` in `config.weapons`, and for the people's attacks `sound` in
`config.npc.attacks`, so a new recording can be assigned per weapon there.

### Other fight sounds
| ID | What it is | When it plays | Positional | Record |
|---|---|---|---|---|
| `whoosh` | Swing through the air | A punch, kick or swing that misses; a thrown object | Swinger | Light and heavy whooshes |
| `bodyThud` | Body hitting the carpet, louder the harder | Ragdolls landing; the player going down (failure); punching a body on the floor | Body | Several weights; it plays a lot |

## Props landing: `propHit(kind)`
A prop that suddenly stops (landed, hit a wall or someone) makes a sound, louder the harder it hit
(`config.physics.impact`).

| Kind | What it is | Used for |
|---|---|---|
| `metal` | Metal chair clatter | Waiting-room chairs |
| `paper` | Papery slap | Magazines, the clipboard |
| `thud` | Thud, deeper for heavier things | Everything else (plant, water bottle, bat, extinguisher, umbrella stand, dropped weapons) |

## Scripted sounds (beat data)
Dialogue scenes can play a sound with `{ do: 'sound', name }` (see `SoundName` in `src/director/types.ts`):
`clockTick`, `mouseClick`, `blip`, `footstep`, `chairCreak`, `ticketTear`, `paperSlide`, `cough`, `sigh`,
`pageTurn`, `chairShift`, `watchTick`, `chime`. Replacing those IDs replaces them in scenes too.

## Replacing a sound
The game can already load and play files (`loadAudio`, `playOnce`, `playLoop` in `sfx.js`; that's how the radio
and the clock work). When recordings are ready:
1. Put them in `src/audio/`, named after the ID (e.g. `cough_1.mp3`, `cough_2.mp3`, `hit_bat.mp3`).
2. Add a list of files per ID in `config.audio` (e.g. `files: { cough: [...], 'hit.bat': [...] }`).
3. Each sound function plays a random file from its list if there is one, and falls back to the synthesized
   version if not, so sounds can be replaced one at a time.

Step 3 isn't built yet; it's a small change to `sfx.js` once the first files exist.

**Format:** `.mp3` or `.ogg`, mono for positional sounds (the game places them in the room), 44.1 or 48 kHz.
Keep one-shots short and trimmed tight at the start, so they line up with the hit or footstep.
