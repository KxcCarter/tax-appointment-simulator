# Income Tax Appointment Simulator: Design & Build Brief

> **For Claude, starting a new session:** This brief is the source of truth for the game. Build **the first draft of the Waiting Room level only** (Milestones 1–5 below). Do not build the Accountant's Office yet. When you're done, deliver a playable build and list anything you assumed or left as a placeholder. Where this brief says *(proposal)*, it's a suggestion: implement it, but keep it easy to change.

---

## 1. Concept

A short first-person 3D game about attending a tax appointment. The tone is Kafkaesque, with very, very, very dry humor: the comedy comes from pacing, silence, indifference and bureaucratic absurdity. Nothing is played for winks. The world takes itself completely seriously.

The waiting-room sequence is slow, quiet and frustrating on purpose. It then abruptly turns into a ridiculous physics brawl with flopping ragdolls. That contrast is the core joke.

## 2. Player experience: Waiting Room level

### 2.1 Arrival
- The player starts just inside the entrance of the tax preparer's office, facing the waiting room.
- There are **5 other people** already seated and waiting.
- An **analog clock** on the wall reads **1:55**. It ticks quietly; the tick is positional audio, louder near the clock.
- There's a **front desk** with a **receptionist** (very fat, owner's decision; her build is `config.characters.receptionist.proportions`) playing solitaire on her computer. Mouse clicks are audible near the desk.

### 2.2 The receptionist exchange (pacing is everything)
Walking up to the desk and looking at her shows an interaction prompt. Dialogue choices appear on screen. Each attempt is gated by a timer, so the player is forced to wait.

| Beat | Player option that advances the story | Receptionist response |
|---|---|---|
| 1 | "I'm here for my appointment." | Looks at the player for a moment (about 2 s of silence), then turns back to her solitaire. Says nothing. |
| — | *(Dialogue options are unavailable for about 10–15 s; only mouse clicks are heard.)* | |
| 2 | "I'm here for my appointment." | Ignores the player for a few seconds (clicks continue). Without looking: **"Sshhh, momma's got to play her game."** |
| — | *(Another wait, about 10–15 s.)* | |
| 3 | "I'm here for my appointment at 2:00 PM." | Without looking: **"Take a number and have a seat."** |

- **Optional follow-up (added by the owner):** right after "Take a number and have a seat.", choices open by themselves (no E press needed):
  - Player: "But I have an appointment at 2." → Receptionist: **"What time is it now?"**
  - Player chooses either the **exact time on the wall clock** (e.g. "It's 1:57.") or **"It's 2:00."**
    - "It's 2:00." → she glances over her shoulder at the wall clock, then: **"No it's not."** The question stands; the same two choices come back. *Exception:* if the clock really reads 2:00, "It's 2:00." is the true answer: it's the only choice shown, and she moves on to "And what time is your appointment?"
    - The exact time → **"And what time is your appointment?"** → Player: "My appointment is at 2:00." → **"Well it's not 2:00 yet, is it?"** → **"Take a seat and wait."**
      - The clock runs in real time, so her reply depends on what it reads when she answers. **On time = the clock reads 2:00 to 2:02** (`config.appointment.onTimeMinutes`; the owner may narrow it):
        - before 2:00: "Well it's not 2:00 yet, is it?" → "Take a seat and wait." (as above)
        - 2:00 to 2:02: the **check-in runaround** (owner's design): **"Did you check in already?"** → "No." / "That's what I'm trying to do right now." → **"You gotta check in first."** The choices close; the player has to press E again: "How do I check in?" / "Can you check me in, please?" → she ignores it: **"Ooo, look at them cards fly, hoo hoo!"** → the same two questions come straight back → **"You gotta sign the check-in sheet."** (she doesn't hand it over). For about 10 s (`timings.reception.newGameWait`) nothing works; pressing E gets **"Hold up, momma gotta start a new game..."** (a beat's `lockedResponse`). Then: "Can I check in for my appointment, please?" → **"Did you sign the check-in sheet?"** → "No." → she turns and looks at him: **"You can't go to your appointment until you check in."** → "Okay, so can I check in now?" → **"Gotta sign the sheet."** (back to her game). The choices close; press E again: "Please, can you just sign me in?" → **"Did you sign the check-in sheet?"**, and without looking up she slides the clipboard across the counter → "No." → **"Everybody gotta sign the check-in sheet. Did you sign it?"** (beats `checkin_already`, `checkin_how`, `checkin_how_again`, `checkin_can_i`, `checkin_sheet`, `checkin_okay`, `checkin_please`, `checkin_offered`).
      - **No pen (owner's design):** the clipboard on the counter can be used ("[E] Sign Check-in Sheet") → "You don't have a pen." Then the player can ask her "Do you have a pen?" She ignores it: **"Mamma gotta get her some coffee..."**, gets up, walks through the **EMPLOYEES ONLY** door behind the desk (into a small back room), is gone ~30 s (`timings.reception.coffeeAway`), and comes back to her seat with a cup of coffee. Then: "Do you have a pen I can borrow?" → **"No."** → "How am I supposed to check in for my appointment then?" → **"You can check-in online. What time is your appointment?"** → "2:00." / "It's supposed to be right now." → she looks at the clock, back at her computer, takes a sip of coffee: **"You're late for your appointment so the system won't let you sign in online, you're gonna have to fill in the check-in sheet."** The player can ask for a pen again. **The second time she refuses** ("No."), she calls the next number: **"Number 848! Our 2:00 was a no-show so you can go on ahead."** Now Serving chimes and jumps to 848, and the exchange is over.
      - **A newcomer (owner's design):** two seconds after she's back at her desk with the coffee, the entrance door swings open (there's a corridor outside) and a new person (a man in a tan trench coat) walks in, takes ticket **848** from the dispenser and sits in a free chair (`config.newcomer`).
        - 2:03 or later: **"You're late. You'll have to take a number and have a seat."**
      - The player can instead say "My appointment is right now." Unless the clock reads 2:00 to 2:02, she replies **"We don't have any appointments scheduled for {the time on the clock}."** and the same two choices come back. If it is 2:00 to 2:02, she answers as for an on-time player (the check-in sheet).
      - After "Well it's not 2:00 yet, is it? … Take a seat and wait." (or "(Say nothing)" to the first question) the player can walk back up later and say "But I have an appointment at 2." again (beat `protest_again`), so a patient player can reach the check-in sheet once it's 2:00.
  - The player can also say nothing and walk away; pressing E on her later picks the conversation up where it stopped.
- **During a wait (decided by the owner):** the player can still walk up and press E, but **no dialogue options appear**. Beat data has a `lockedOptions` list (empty for now) so recorded lines can be added there later without engine changes.

- Each beat also offers 1–2 other options (e.g. "Hello?", "Excuse me.", "(Say nothing)"). These get flat or no responses and don't advance the story. *(proposal: options that are nearly identical to each other are part of the joke.)*
- Timings must be in a config file so they're easy to tune.

### 2.3 Taking a number and waiting
- A ticket dispenser sits on or near the desk. The player takes a ticket. **The ticket can be taken at any time, even before the receptionist says so, but it doesn't help:** she still ignores the first two attempts (decided by the owner). *(proposal: the ticket number is absurdly high, e.g. **847**, while a "Now Serving" display shows a low number such as **12**.)*
- The player can sit in an empty chair (interact to sit and stand) or wander around.
- **The wait counts no matter what** the player does (sitting, standing, wandering) (decided by the owner).
- **Placeholder for content not yet designed:** the time between taking a number and being called. For the first draft, use a configurable wait (default **5 minutes**, owner's decision, so the clock passes 2:00 before the call) with small ambient beats: NPC idle animations, a sigh, someone checking their watch, someone coughing too often, the clock ticking. **The clock always runs in real time** (decided by the owner).
- **The waiting people (first draft, Milestone 3):** each has one idle personality: the **cougher** (coughs too often), the **watch-checker** (checks his watch, then the clock, sighs; has a briefcase), the **reader** (reads a magazine, turns pages), the **leg-jiggler** (arms crossed, knee bouncing, long exhales at the ceiling), and the **sitter** (a curvy woman in a pencil skirt and stockings; barely moves, shifts occasionally). All glance at the clock now and then. Their eyes (not heads) follow the player up close; everyone looks over when the player takes a ticket; sitting right next to someone makes them lean away. **Small talk (designed by the owner):** the player can talk to each of them: "Hello."/"Excuse me." → their greeting ("Hello." / "Hi." / "Hey.") → "What time is your appointment?" → "I don't have an appointment." / "My appointment is at 3:00." / "...at 5:30." → "Okay, thank you." (ends) or "How long have you been waiting?" → people without an appointment answer anything from an hour to since yesterday. Lines live in `src/data/npcConversations.ts`. While talking they turn to the player and stop fidgeting. Only one conversation runs at a time (the receptionist's call waits for it). After the call, nobody talks to the player.
- **At the call** the Now Serving display chimes and jumps to the ticket number, and all five heads turn to the player one by one and stay there, annoyed. That's where the brawl (Milestone 4) takes over. If the player is mid-conversation with the receptionist, the call waits for the current line to finish, then ends the exchange.
- **The radio (owner's request):** after exactly 1 minute of play (pauses don't count; `config.radio.at`), one of the waiting people (the sitter, from the opposite side of the room; `config.radio.who`) gets up, walks across the room to a small radio on the side table, turns it on and sits back down. It plays `look_to_the_sky.mp3` (supplied by the owner, in `src/audio/`) very, very softly, slightly tinny, on repeat, until the player can leave for the accountant (`doorOpen`). It keeps playing through the brawl. **The player can turn the radio off** ("[E] Turn off the radio"). The sitter gets up immediately and goes back to turn it on again, every time, angrier each time (annoyed → angry → furious), walking faster and faster (`config.npc.anger`), stomping, and glaring at the player on her way back. If the radio is switched off while she's walking back, she turns straight round. From the second time on she mutters as she gets up: "Rude...", "Seriously??", "No way...", "Really dude?", "Oooh no, nuh-uh!", "Son of a..." (in order, then at random; `radioComplaints` in `src/data/npcConversations.ts`). **She gets violent (owner's design):** from the 3rd time the radio is turned off she walks to the player and attacks first, then turns the radio back on: 3rd slap, 4th shove, 5th punch, 6th kick, 7th a slap-shove-punch combo, 8th+ she picks up the playing radio, hits the player with it, and puts it back (`config.npc.violence`, `config.npc.attacks`). Hits are feel only for now (knockback, camera shake, sound; no health). The player can't fight back until after her kick; then fists come up and left-click punches. **The onlookers (owner's idea):** the first time the player's punch lands on her, everyone else reacts as if she did absolutely nothing wrong and he's a violent maniac: heads snap round, a shocked face, then they stare at him, appalled, for good (they stop fidgeting and won't make small talk any more). Lines, in order: Woman with magazine "Oh my God." → Older man "He hit her." → Man with briefcase "She was listening to the radio." → Young man "What is wrong with you, man?" → (the newcomer, if he's arrived) "Unbelievable." → Woman with magazine "Somebody do something." → the receptionist, without looking up from her solitaire: **"Sir, I'm going to have to ask you to calm down, please."** *(proposal: the lines; edit `onlookers` in `src/data/npcConversations.ts`)*. She flinches when hit and, after 4 punches, falls down and stays down (scripted fall: a placeholder for Milestone 4's ragdolls), which ends the radio war. The song resumes where it would be by now, like a live station.
- When the wait is over, the receptionist calls the player: *(proposal)* "Eight hundred forty-seven. He'll see you now." The Now Serving display jumps to 847.

### 2.4 The brawl
- **What starts it (owner's direction, scene still to be written):** it grows out of the argument with the newcomer about who goes first. Tensions rise, and the newcomer grabs the check-in clipboard and smashes it over the player's head. That's the trigger. Until the scene is written, the brawl gets a temporary trigger.
- **Temporary trigger (built):** a few seconds after "Number 848!" (`config.brawl.placeholderDelay`), the newcomer gets up, takes the clipboard from the counter, walks up to the player and smashes it over his head. `?brawl` in the URL jumps straight to it (the newcomer walks in at once).
- **The others cheer him on and join in (owner's design):** everyone still standing gets up and joins, shouting things like "Yeah! Get that jerk!", "Smash his face in!", "Teach that creep a lesson!", "Learn to tell time, idiot.", "You think you're too good to wait in line?", "Oh, looks like this guy thinks he's something special!" (lines in `brawlShouts`, `src/data/npcConversations.ts`). Built in `src/level/brawl.js`: they move fast (`config.brawl.speed`); 2 attack at a time, **from two different sides** (owner: not one behind the other; `flankAngle`), and the rest spread out round the player a couple of metres away, cheering or with fists up, shouting from the sidelines.
- The player fights them in first person using:
  - **Punch** (left mouse), **kick** (F) and **block** (hold the right mouse button: arms, or the weapon, raised in front; owner's request). Visible first-person fist and foot. A fight-options panel (bottom right) lists the controls while there's a fight on, and walking is faster in a fight (owner: `config.combat.moveSpeedMul`). *(Built; kick: `config.combat.kick`. Game feel built: hit-stop (`config.combat.hitStop`), a white flash on the person hit, camera shake, knockback.)*
  - **Improvised weapons** picked up with E. **Anything can be a weapon (owner's decision):** chairs, the radio, magazines and books, briefcases, umbrellas (from the stand by the door), the receptionist's **computer keyboard**, and so on. The **baseball bat** is in the EMPLOYEES ONLY back room, along with a few other weapons. *(Built: once the player's fists are up, [E] picks up a chair, magazine, umbrella, potted plant, the water-cooler bottle, the briefcase, the clipboard, and during the brawl the radio and her keyboard; the back room holds a bat, a mop and a fire extinguisher, and its door opens as the player walks up. Stats and held poses are in `config.weapons`; damage is out of `config.brawl.health`, a punch does 25.)* Each has different reach, damage, swing speed and sound; light/long things swing in a wide horizontal arc, heavy ones are raised and smashed down (`style` in `config.weapons`). Pressing Q drops or throws the held weapon.
- Hitting an NPC reduces their health. At 0 they are **knocked down into a full physics ragdoll** (built: `src/characters/ragdoll.js`, tuning in `config.ragdoll`; the sitter's radio-war knockdown already uses it) that flops and tumbles, inheriting the momentum of the hit.
- **Knocking down at least 4** NPCs unlocks the door to the Accountant's Office. *(Built: "Knocked down: n / 4" at the top; at 4 the door unlocks with a click, [E] opens it, and walking through fades to the end card: "To be continued." with a few dry statistics (ticket, time on the clock, appointment 2:00, times woken up in a chair, times the radio was turned off). The sitter knocked down in the radio war counts. Before that, [E] on the door: "Locked.")* For the first draft, reaching the door shows a placeholder end card: "To be continued."
- Knocked-down NPCs stay down. *(proposal: if they flop in hilarious positions over chairs, that's a feature.)*
- **Player failure** *(proposal, fits the tone; built)*: the player has health (a subtle bar, bottom left; the NPCs' blows do `config.npc.attacks[kind].damage`, in the brawl only: the radio war stays feel-only). At 0 the screen fades; the player wakes up seated with ticket ×2 (847 → 1,694 → …); everyone is back in their seats; the receptionist says "Number 1,694. Please have a seat. We'll call you."; 5 s later they get up and go for him again ("He's back."). When it reaches 0, the screen fades, and the player wakes up seated in a waiting-room chair holding a new ticket with an even higher number. The brawl state resets.

## 3. Technical approach

### 3.1 Stack
- **Three.js** for rendering.
- **Rapier** (`@dimforge/rapier3d-compat`, which embeds the WASM so no separate file is needed) for physics, player movement and ragdolls.
- **Vite** dev server and bundler, plain JavaScript (ES modules). **Exception (owner's decision): scene data is TypeScript** (`src/data/waitingRoomBeats.ts`, types in `src/director/types.ts`); `npm run typecheck` checks it. Vite runs .ts directly.
- **No external art or sound assets in the first draft**, with exceptions chosen by the owner: the radio song `src/audio/look_to_the_sky.mp3` and the clock's tick-tock `src/audio/clock_tick.mp3` (a 2 s recording, restarted on every even second of the game clock). All geometry is built from primitives in code, and all sounds are synthesized with the Web Audio API (clock tick, mouse clicks, punches, thuds, voice blips).
- **Fallback if npm installs are unavailable in the session:** build a single HTML file that loads Three.js and Rapier from a CDN via an import map. Same architecture, fewer files.

### 3.2 Visual style
- Simple and comical, with a 1980s/90s look in the set dressing (not in the rendering). Characters and props are built from boxes, capsules, cylinders and spheres, like low-poly toy figures.
- Flat colors with `MeshLambertMaterial`, or `MeshToonMaterial` with a 3-step gradient.
- **No pixelated / low-resolution render.** Render at full resolution with antialiasing and smooth texture filtering. (A retro render was tried and dropped by the owner.)
- **Palette:** a 1980s/90s tax office: beige walls, brown carpet, mint and avocado accents, wood-veneer desk, slightly greenish fluorescent light, a beige CRT computer.
- **All look-related settings live in one file, `src/theme.js`:** palette colors, a material factory (e.g. `theme.material("wallBeige")`), lighting setup (types, colors, intensities, shadows), fog and background, and any post-processing. Character colors and accessories come from palettes defined there too. No other file may hard-code a color, create a material directly, or set up lights. That way the whole art style can change by editing `theme.js` alone (e.g. swap `MeshLambertMaterial` for `MeshToonMaterial` in one place).
- **Character style (chosen by the owner): `figure`.** Smooth toy figures: capsule limbs, rounded torso and head, ears, mitten hands, fitted hair. Not cartoonish. Set by `theme.look.characterStyle`; the other styles (`blocky`, `rounded`, `capsule`, `soft`) remain available for comparison via `?charstyle=` in the URL.
- **Faces can show expression** (`figure` style): eyeballs with gaze, blinking eyelids, independent eyebrows, and a mouth that can frown, smirk, smile, open, and move while talking. Expressions are named presets in `config.characters.expressions`; beat data can switch them with `{ do: 'face', who, expression }`.
- **Fixed early (expensive to change later):** characters are built from **separate primitive body parts** (the toy-like look), because animation, hit detection and ragdolls depend on that construction. Body proportions (chunky, slightly big-headed figures) and room scale are defined as constants in `config.js` so they can still be re-tuned.
- Room contents: rows of chairs along the walls, a small side table with magazines, a potted plant, a water cooler, an umbrella stand, the Now Serving display, the clock, the ticket dispenser, the front desk with CRT computer, keyboard and mouse, a door marked **"ACCOUNTANT – PRIVATE"**, and an **"EMPLOYEES ONLY"** door behind the reception desk leading to a small back room.

### 3.3 Player controller (first person)
- Pointer-lock mouse look, WASD movement, Shift to walk slightly faster *(proposal: the player can never truly run; office decorum)*, E to interact.
- A Rapier **kinematic character controller** with a capsule collider, so the player collides with walls and furniture and can push light props.
- Interaction uses a raycast from the camera centre and shows a small prompt, e.g. "[E] Talk", "[E] Sit", "[E] Take number", "[E] Pick up umbrella".
- Seated mode locks the camera to the chair with limited look-around.

### 3.4 Characters and ragdolls
- **Fixed cast (decided by the owner):** the five waiting people are always the same characters with the same design, defined explicitly (looks in `theme.js`, seats and personalities in `src/data/waitingRoomCast.js`), not randomized per load.
- Every humanoid (NPCs and receptionist) uses one parametric **primitive rig**: pelvis, torso, head, upper and lower arms, upper and lower legs. Clothing colors, height, hats (fedora, cap), hair and accessories are randomized per NPC so they read as distinct people.
- **Two modes per character:**
  1. **Animated (alive):** limbs are driven procedurally in code (sitting, fidgeting, standing up, walking, punching, flinching). Rapier bodies are *kinematic* and follow the animation, so hits can be detected.
  2. **Ragdoll (knocked down):** switch every body part to a *dynamic* Rapier rigid body, connected with joints (spherical joints for shoulders and hips, revolute joints for elbows and knees, all with sensible limits). Copy current velocities over, then apply the hit impulse at the contact point.
- Tune mass, damping and joint limits for **maximum comedic flop** while keeping limbs from passing through each other or exploding.
- Props (chairs, magazines, plant pot, water-cooler bottle, umbrella stand) are dynamic bodies, so ragdolls can knock them over.

### 3.5 Combat
- Attack hit detection uses a Rapier **shape cast** (sphere or capsule) in front of the camera, sized by the attack or weapon's reach.
- A weapon table in config sets `damage`, `reach`, `swingTime`, `knockbackImpulse` and `sound` for fist, kick, bat, umbrella and keyboard.
- **Game feel:** hit-stop (about 60 ms freeze on impact), small camera shake, a white flash on the hit NPC, and an exaggerated knockback impulse. *(proposal: the keyboard sheds a few loose keycap physics bodies on each hit.)*
- **NPC combat AI:** approach the player, wind up (a readable telegraph), swing, then a short cooldown. They flinch and stagger when hit. They don't all attack at once; 2–3 are active at a time while the others shout from the edges.

### 3.6 NPC state machine
`Seated → IdleFidget → Indignant (stand + shout) → Approach → WindUp → Attack → Cooldown → (Stunned) → KnockedDown (ragdoll)`

Receptionist: `PlayingSolitaire ⇄ GlanceAtPlayer → (calls player's number)`. She does not take part in the brawl. *(proposal: she keeps playing solitaire throughout the fight.)*

### 3.7 Scene director (beat system)
The narrative is **data-driven**. The level is a list of beats in `src/data/waitingRoomBeats.ts`, and a director steps through them. Each beat can define its trigger, available dialogue options, responses (lines, animations, sounds), delays, and `nextUnlockAfter` timers. Changing the pacing should never require touching engine code.

Example shape:
```js
{
  id: "reception_1",
  trigger: { type: "interact", target: "receptionist" },
  options: [
    { text: "I'm here for my appointment.", advance: true },
    { text: "Hello?", response: null },
  ],
  onAdvance: [
    { do: "anim", who: "receptionist", name: "lookAtPlayer", duration: 2 },
    { do: "anim", who: "receptionist", name: "resumeSolitaire" },
  ],
  next: "reception_2",
  nextUnlockAfter: 12,
}
```

### 3.8 UI
- An HTML/CSS overlay on top of the canvas.
- Dialogue box at the bottom: speaker name plus line, with text revealed character by character with soft blips.
- Choice list with number keys 1–4 or mouse click.
- Crosshair dot, interaction prompt, held-weapon name, player health (a subtle bar), and a knockdown counter during the brawl ("Knocked down: 2 / 4").
- Title screen: **INCOME TAX APPOINTMENT SIMULATOR** with "Click to begin." Pause menu on Esc.
- Font: a monospace or system font styled to look like an old office terminal (no external font downloads).

### 3.9 Audio (synthesized)
- **Clock tick:** positional, quiet, one per second.
- **Mouse clicks:** positional at the desk, irregular rhythm, with an occasional double-click.
- Low fluorescent-light hum (room tone).
- Footsteps; chair creak when sitting.
- Dialogue voice blips with a different pitch per character.
- Combat: punch thwack, kick thud, bat crack, umbrella "fwump", keyboard clatter, ragdoll body thuds based on impact velocity.

### 3.10 Global game state
A single state object holds `phase` (`arrival | reception | waiting | brawl | doorOpen`), `ticketNumber`, `nowServing`, `timesIgnored`, `knockdowns`, `playerHealth`, `heldWeapon` and `clockTime`. Later levels will read from this state.

## 4. Project structure
```
income-tax-sim/
├─ index.html
├─ package.json
├─ src/
│  ├─ main.js               # bootstrap, loop, renderer
│  ├─ config.js             # ALL tunables: timings, weapon stats, physics, proportions
│  ├─ theme.js              # ALL visuals: palette, materials, lighting, post-fx
│  ├─ state.js              # global game state
│  ├─ physics.js            # Rapier world setup + helpers
│  ├─ player/
│  │  ├─ controller.js      # first-person movement, look, sit
│  │  ├─ interaction.js     # raycast + prompts
│  │  └─ combat.js          # attacks, weapons, viewmodel fists/foot
│  ├─ characters/
│  │  ├─ rig.js             # primitive humanoid builder
│  │  ├─ ragdoll.js         # kinematic ⇄ dynamic switching, joints
│  │  ├─ npc.js             # NPC state machine + combat AI
│  │  └─ receptionist.js
│  ├─ level/
│  │  ├─ waitingRoom.js     # room geometry, furniture, props, light fixtures
│  │  ├─ waitingRoomLevel.js # wires room, receptionist, director, interactables, ambience
│  │  ├─ clock.js
│  │  └─ nowServing.js
│  ├─ director/
│  │  ├─ director.js        # beat runner
│  │  └─ types.ts           # types for scene data (beats, options, actions)
│  ├─ data/
│  │  ├─ waitingRoomBeats.ts
│  │  ├─ waitingRoomCast.js
│  │  └─ npcConversations.ts
│  ├─ audio/
│  │  └─ sfx.js             # Web Audio synthesis
│  ├─ util/
│  │  └─ random.js         # seeded random (room looks the same every load)
│  └─ ui/
│     ├─ ui.js
│     └─ ui.css
```

## 5. Milestones for the first draft

1. **Greybox + movement:** the waiting room built from primitives with lighting and colliders; a first-person controller with pointer lock; the title screen.
2. **Opening sequence:** clock, receptionist, director and beat system, dialogue UI, the three-attempt exchange with timed gates, ticket dispenser, Now Serving display, sitting, ambient audio.
3. **Waiting phase:** 5 seated NPCs with randomized looks and idle fidgets; the configurable wait; the receptionist calling the player's number.
4. **Brawl:** NPC aggression and combat AI, player punch and kick, weapon pickups (bat, umbrella, keyboard), health, hit feel, **Rapier ragdoll knockdowns**, knockdown counter, the door unlocking at 4, player-failure loop.
5. **Polish pass:** synthesized sound effects for everything, tuned timings, ragdoll tuning for comedy, a "To be continued" end card.

### Done when
- The full sequence plays from the title screen to the door without errors in a desktop Chrome or Firefox browser at 60 fps.
- The reception pacing matches section 2.2, and all timings live in `config.js`.
- At least 4 NPCs can be knocked down into convincing, funny ragdolls, and the door then opens.
- Changing the art style (colors, materials, lighting) needs edits to `theme.js` only.
- No external assets are required at runtime beyond the Three.js and Rapier libraries.

## 5b. Added beyond the brief (Claude's proposals, branch `milestones-4-5`; keep, change or cut)
- **Second way into the brawl:** if the player just waits and 847 is called, they become indignant ("I was here first!", "I've been here since nine!", "Unbelievable.") and the brawl starts (`config.brawl.afterCalled`).
- **The receptionist during the brawl:** keeps playing solitaire, with the odd remark ("Please keep it down.", "Sir, this is a place of business.", …; `brawlShouts.receptionist`).
- **Fighting:** knockback stagger, a punch combo (every 3rd quick punch is a harder hook), longer stun from heavy blows (`config.combat`). Hitting someone who's already down makes the body flop (no damage). Some weapons wear out: the magazine comes apart after 4 hits, the clipboard's sheet tears free after 6 (`breaksAfter` in `config.weapons`).
- **Easter eggs** (`src/data/roomRemarks.ts`): [E] on the poster, certificate, plants (one plastic, one dying), filing cabinets (locked; then "Sir."), the coat (a receipt for one pen, 1986), the Now Serving display, the clock (after a few looks: "Staring at it won't make it go any faster."), the magazines (headlines), her screen (solitaire; she is losing), the water cooler ("The water is for clients." … "Clients with appointments."), a second ticket ("One per customer."), and knocking on the accountant's door (third knock: a voice, "Not yet."). Wandering behind the desk or into the back room: "Sir, you can't be back here." **Her space (owner's request):** before the brawl she also shoves the player away: nobody gets closer than 1.25 m to her chair (she looks up, a shove, then back to her game; `config.npc.receptionistSpace`). That also keeps the back room (and the bat) out of reach until the brawl; from the brawl on, the player moves freely.
- **Small talk:** "What are you here for?" and "Do you know how much longer it'll be?" for everyone (lines in `people`).
- **Side scenarios:** sitting next to the leg-jiggler, the view bounces with his knee; ask him to stop ("Stop what?", then he stops briefly and starts again faster). Sitting next to the man with the watch, he asks the time; "It's 2:00." gets "No it isn't."
- **Room fixes:** walls have real doorway gaps; a staff gap at the east end of the desk makes the area behind it and the back room (with the bat) reachable.

## 6. Assumptions and open items
- **Planned next (owner's outline, not built yet; details to come):** after "Number 848! Our 2:00 was a no-show…" the player protests that HE is the 2:00 appointment and was on time, even early. He asks whether the newcomer has an appointment; the newcomer says no, he's a walk-in. The player refuses to let him take his appointment and says he has to wait. Newcomer: "Hey buddy, it's not my fault you couldn't be on time to your appointment. Maybe wear a watch next time." The newcomer then starts walking towards the accountant's door. Player: "How come he didn't need to sign the check-in sheet?" Receptionist: walk-ins don't have to sign the check-in sheet.
- **Platform:** desktop browser, keyboard and mouse. Mobile is out of scope for now.
- **Who writes the code:** Claude builds the draft and explains its structure, so the owner can tune `config.js` and the beat data.
- **Still to be designed by the owner:** what happens between taking a number and being called (currently a placeholder wait), any additional receptionist or NPC dialogue, and the **Accountant's Office** level (next phase, after the Waiting Room is approved).
- Items marked *(proposal)* are Claude's suggestions and can be changed or removed.
