// ALL tunables live here. Change numbers, not engine code.
// Units: metres, seconds, radians unless noted.

export const config = {
  // Look-related settings (colours, materials, lighting) live in theme.js, not here.
  render: {
    fov: 70,
    near: 0.05,
    far: 60,
    maxPixelRatio: 2,         // cap for high-DPI screens (performance)
  },

  physics: {
    gravity: -9.81,
    fixedStep: 1 / 60,
    maxSubSteps: 4,
    // Props landing / hitting things make a sound (physics.js onImpact; sounds in sfx.propHit)
    impact: { speedDrop: 1.2, loudAt: 5, gapFrames: 8 },
  },

  player: {
    spawn: { x: 0, z: 3.9, yaw: 0 }, // just inside the entrance, facing the room
    capsuleHalfHeight: 0.55,
    capsuleRadius: 0.28,
    eyeHeight: 1.62,          // from the floor
    walkSpeed: 1.55,          // a measured, professional pace
    briskSpeed: 2.2,          // Shift. Never a run. Office decorum.
    acceleration: 10,
    mouseSensitivity: 0.0022,
    pitchLimit: 1.45,
    stepHeight: 0.18,
    characterMass: 75,        // used when shoving light props
    headBobAmount: 0.025,
    headBobFrequency: 1.7,    // bobs per metre walked
  },

  room: {
    width: 12,                // x
    depth: 10,                // z
    height: 3,
  },

  clock: {
    startHour: 1,
    startMinute: 55,
    startSecond: 0,
    timeScale: 1,             // always real time (owner's decision)
  },

  nowServing: {
    initial: 12,
  },

  // ---- Player fighting (first draft: punching only) ----
  combat: {
    punchReach: 1.2,         // metres from the eye
    punchTime: 0.32,         // whole jab, out and back
    punchHitAt: 0.4,         // fraction of punchTime when the fist connects
    punchCooldown: 0.12,
    punchDamage: 25,         // people have config.brawl.health
    // Kick (right click or F): slower, longer reach, harder
    kick: { reach: 1.55, time: 0.44, hitAt: 0.5, damage: 34, knock: 1.7, cooldown: 0.25 },
    hitStop: 0.06,           // seconds the game freezes when a blow lands (game feel)
    moveSpeedMul: 1.9,       // walking is this much faster while there's a fight on
    swingTimeMul: 0.8,       // every weapon swing takes this share of its swingTime (snappier)
    // Block: hold the right mouse button. Blows from the front do `damage` x their damage and knock you
    // back less; the attacker staggers. Blows from the side or behind (beyond `arc`) get through.
    block: { damage: 0.15, knock: 0.3, shake: 0.4, arc: 0.25, attackerStun: 0.45, raiseSpeed: 14 },
    npcKnockback: 0.22,      // metres someone staggers back from a blow (x the blow's knock)
    heavyStun: 0.7,          // seconds stunned by a heavy blow (knock >= 1.5); light ones 0.35
    // Punch combo: punches thrown within `window` s of the last chain; every `every`-th is a harder hook
    combo: { window: 0.5, every: 3, damage: 1.6, knock: 1.7 },
    flashTime: 0.07,         // seconds someone flashes white when hit
    knockbackDecay: 6,       // how quickly being shoved wears off
    shakeDecay: 5,
  },

  // ---- The brawl (Milestone 4; src/level/brawl.js) ----
  brawl: {
    // OFF for now (owner): the 847 call and the end of the argument don't start the brawl.
    // It starts after "I just found all the pens." ({ do: 'emit', event: 'brawlStart' }, which works either way).
    // ?brawl in the URL still jumps straight to it, for testing. true turns the other triggers back on.
    enabled: false,
    receptionistQuipEvery: [5, 9], // seconds between her comments while she films the brawl (brawlShouts.receptionist)
    placeholderDelay: 1,         // ?brawl (debug): seconds after the newcomer sits down before he fetches the clipboard
    health: 100,                 // everyone's; a punch does config.combat.punchDamage
    playerHealth: 100,           // the player's; their blows do config.npc.attacks[kind].damage (brawl only:
                                 // the radio war stays feel-only, as designed)
    afterCalled: 4,              // seconds after his number is called before they get up (the 847 route)
    knockdownsToOpen: 4,         // knocked-down people (the sitter from the radio war counts) to unlock the door
    // Losing: the screen fades, the player wakes up in a chair with an even higher ticket, and it starts again
    failure: {
      ticketMultiplier: 2,       // 847 -> 1694 -> 3388 ...
      fadeOut: 1.4,
      blackFor: 1.5,
      fadeIn: 1.2,
      restartAfter: 5,           // seconds after waking before they come at him again
    },
    maxAttackers: 2,             // at once, from two different sides; the rest hang back and shout
    flankAngle: 1.9,             // radians between the two attackers' angles of approach (~110 degrees)
    speed: 2.7,                  // walking speed multiplier while fighting (x config.npc.walk.speed)
    approachDistance: 0.75,      // metres from the player when they swing
    windUp: 0.45,                // seconds with fists up before a swing (the telegraph)
    hangBack: [1.9, 2.8],        // metres from the player while waiting their turn
    hangBackHold: [1.0, 2.6],    // seconds standing there, cheering or in guard
    openingStagger: [0.3, 1.6],  // seconds before each person is up and fighting
    shoutEvery: [2.2, 4.5],      // seconds between shouts from the sidelines
    separation: 0.55,            // fighters don't get closer to each other than this
    bounds: { minX: -5.4, maxX: 5.4, minZ: -2.2, maxZ: 4.4 }, // where they stand (in front of the counter)
    // Each person's moves (config.npc.attacks; a move listed twice comes up twice as often)
    moves: {
      newcomer: ['punch', 'chop', 'kick', 'roundhouse', 'combo'],
      cougher: ['jab', 'jab', 'punch', 'boxCombo', 'kick'],   // a boxer; the kick is beneath him, but he'll do it
      watchChecker: ['punch', 'chop', 'kick', 'shove'],
      jiggler: ['punch', 'kick', 'roundhouse', 'chop', 'combo'],
      reader: ['slap', 'kick', 'chop', 'roundhouse'],
      sitter: ['slap', 'shove', 'punch', 'kick', 'roundhouse'],
      default: ['punch', 'chop', 'kick', 'shove'],
    },
    // Fighting stances, while they wait their turn and wind up (characters/walker.js STANCES).
    // They bounce lightly from foot to foot, `bounceRate` times a second.
    stances: { cougher: 'boxing', default: 'karate' }, // the old man: an old-fashioned, fists-up boxing stance
    bounceRate: 1.7,
    cheerChance: 0.25,          // hanging back: cheering him on instead of in their stance
    // Throwing things (owner): waiting their turn, someone fetches something and throws it at him.
    // Never the bat (or anything else from the back room), the radio, or her keyboard.
    throwing: {
      chance: 0.35,             // each time someone hangs back
      kinds: ['magazine', 'umbrella', 'plant', 'coolerBottle', 'briefcase', 'clipboard'], // (config.weapons names)
      search: 5,                // metres: only things this close to them
      from: [2.4, 3.4],         // metres from the player when they throw
      speed: 8,                 // m/s across the room
      spread: 0.35,             // metres of aim error
      damageShare: 0.4,         // x the thing's weapon damage (config.weapons)
      knockShare: 1.6,          // x its knock
      hitRadius: 0.6,           // metres from the player's head-to-chest line
      friendlyFire: true,       // a miss can hit one of the others instead (they'll take it personally)
      friendlyRadius: 0.3,      // ...if it passes this close to their chest
    },
  },

  // ---- Improvised weapons (owner: anything can be a weapon). [E] picks up, left click swings, Q throws ----
  // damage: out of config.brawl.health. reach: metres from the eye. swingTime: seconds for the whole swing.
  // knock: how hard a knockdown throws them (x config.ragdoll.hitImpulse). style: 'swing' (horizontal arc),
  // 'overhead' (raised and smashed down, for heavy things) or 'thrust' (a jab).
  // Held pose (camera space: x right, y up, -z forward): `grip` is the point in the object's own space that
  // goes in the hand at `at`; the object's `axis` (from the grip towards the business end) points along `out`.
  weapons: {
    throwSpeed: 7.5,           // m/s along the view (Q)
    throwLift: 1.5,            // m/s upwards
    throwDamage: 0.8,          // a thrown thing that hits someone does this share of its damage
    throwHitRadius: 0.55,      // metres from someone's chest
    // breaksAfter / breakLine on a weapon: it falls apart after that many hits
    floorFlop: 2.2,            // impulse (m/s) when you hit someone who's already down (no damage; physics)
    defaults: { damage: 30, reach: 1.4, swingTime: 0.6, knock: 1.2, sound: 'kick', style: 'swing',
      at: [0.26, -0.3, -0.55], out: [0, 1, 0], axis: [0, 1, 0] },
    chair:        { label: 'chair', damage: 60, reach: 1.9, swingTime: 0.95, knock: 1.8, sound: 'chair', style: 'overhead',
      grip: [0, 1.0, -0.22], axis: [0, -1, 0], out: [0, 0.08, -1], at: [0, -0.4, -0.3] }, // legs first, lion-tamer style
    magazine:     { label: 'magazine', damage: 6, reach: 1.3, swingTime: 0.3, knock: 0.6, sound: 'slap',
      breaksAfter: 4, breakLine: 'The magazine comes apart.',
      grip: [0, 0, 0.12], axis: [0, 0, -1], out: [-0.2, 0.7, -0.6], at: [0.25, -0.28, -0.45] },
    radio:        { label: 'radio', damage: 45, reach: 1.3, swingTime: 0.7, knock: 1.4, style: 'overhead', sound: 'radioHit',
      grip: [0, 0.18, 0], axis: [0, -1, 0], out: [0, -1, 0], at: [0.24, -0.2, -0.5] },
    briefcase:    { label: 'briefcase', damage: 40, reach: 1.4, swingTime: 0.7, knock: 1.5, style: 'overhead', sound: 'kick',
      grip: [0, 0.18, 0], axis: [0, -1, 0], out: [0, -1, 0], at: [0.28, -0.18, -0.5] },
    umbrella:     { label: 'umbrella', damage: 20, reach: 2.0, swingTime: 0.45, knock: 0.9, sound: 'umbrella', style: 'swing',
      grip: [0.05, 0.45, 0], axis: [0, -1, 0], out: [-0.1, 0.12, -1], at: [0.26, -0.3, -0.4] },
    keyboard:     { label: 'keyboard', damage: 30, reach: 1.5, swingTime: 0.5, knock: 1.2, sound: 'keyboard',
      grip: [0.21, 0, 0], axis: [-1, 0, 0], out: [-0.25, 0.75, -0.6], at: [0.26, -0.3, -0.45] },
    clipboard:    { label: 'clipboard', damage: 20, reach: 1.4, swingTime: 0.4, knock: 1.0, sound: 'clipboard',
      breaksAfter: 6, breakLine: 'The check-in sheet tears free. Nobody will sign it now.',
      grip: [0, 0, -0.14], axis: [0, 0, 1], out: [-0.2, 0.75, -0.6], at: [0.26, -0.3, -0.45] },
    plant:        { label: 'potted plant', damage: 50, reach: 1.4, swingTime: 0.9, knock: 1.6, style: 'overhead', sound: 'kick',
      grip: [0, 0, 0], axis: [0, 1, 0], out: [-0.3, 0.6, -0.75], at: [0.25, -0.45, -0.5] },
    coolerBottle: { label: 'water bottle', damage: 40, reach: 1.3, swingTime: 0.8, knock: 1.4, style: 'overhead', sound: 'kick',
      grip: [0, 0, 0], axis: [0, 1, 0], out: [0, 1, 0], at: [0.22, -0.3, -0.6] },
    bat:          { label: 'baseball bat', damage: 55, reach: 1.8, swingTime: 0.55, knock: 2.0, sound: 'bat',
      grip: [0, 0.05, 0], axis: [0, 1, 0], out: [-0.25, 0.75, -0.6], at: [0.26, -0.32, -0.42] },
    mop:          { label: 'mop', damage: 25, reach: 2.1, swingTime: 0.6, knock: 1.1, sound: 'umbrella', style: 'swing',
      grip: [0, -0.1, 0], axis: [0, -1, 0], out: [-0.1, 0.1, -1], at: [0.26, -0.3, -0.35] },
    extinguisher: { label: 'fire extinguisher', damage: 65, reach: 1.3, swingTime: 0.9, knock: 1.8, style: 'overhead', sound: 'chair',
      grip: [0, 0.02, 0], axis: [0, -1, 0], out: [0, -0.3, -1], at: [0.25, -0.25, -0.4] },
  },

  // ---- Damage you can see (the brawl; src/characters/damage.js) ----
  // Every blow that lands leaves a mark where it landed: on the head bruises, black eyes, cuts that bleed,
  // a nosebleed, a split lip; on the body torn clothes and ripped-off sleeves. Colours: theme.js (bruise...).
  damage: {
    enabled: true,
    headShare: 0.6,             // a blow with no exact spot (thrown things): the head this often, else the body
    // Head blows in order (the 1st, 2nd, ...); after the list, 'random' picks from headRandom
    headSequence: ['bruise', 'blackEye', 'cut', 'noseBleed', 'blackEye', 'lip', 'random'],
    headRandom: ['bruise', 'cut', 'bruise', 'cut', 'lip'],
    knockOffAt: 1.0,            // a blow this hard (knock) knocks a hat off, and crooked glasses
    sleeveEvery: 3,             // every 3rd body blow tears a sleeve off (an arm hit always does)
    tearSize: [0.03, 0.055],    // metres across, a hole in their clothes
    bleedTime: [1.5, 3],        // seconds for blood to run down
    healOnRetry: false,         // the player's failure loop: they're back in their seats "as if nothing
                                // happened", still bruised (true: the marks go too; hats stay where they fell)
    knuckles: 8,                // punches landed before the player's own knuckles are bloody (0: never)
  },

  // ---- Ragdolls (knocked-down characters; src/characters/ragdoll.js) ----
  // Tuned for maximum comedic flop without limbs exploding.
  ragdoll: {
    density: 900,              // kg/m^3 for every part (a person of ~70 kg)
    friction: 0.8,
    restitution: 0.05,
    linearDamping: 0.15,
    angularDamping: 1.2,       // higher = less spinning, more slumping
    elbowLimits: [-2.6, 0.05], // radians; negative = bending the natural way
    kneeLimits: [-2.6, 0.05],
    neckLimits: [-0.6, 0.9],   // + = chin down
    hitImpulse: 4.5,           // m/s given to the struck part by a knockdown blow
    impulseShare: 0.45,        // ...and this share of it to every other part
    liftRatio: 0.35,           // upward component of the blow (makes them stumble back, not slide)
    spin: 0.6,                 // random torque impulse on the torso, so nobody falls like a plank
    thudSpeedDrop: 1.4,        // m/s lost in one frame = an impact sound
    thudLoudAt: 4,             // ...this much is full volume
    thudGap: 0.12,             // seconds between thuds from one body
  },

  ticket: {
    number: 847,
  },

  // Someone who arrives after the receptionist's coffee run, takes the next ticket and sits down
  newcomer: {
    delay: 2,                         // seconds after she's back at her desk
    seatPreference: [9, 4, 5, 7, 1],  // first free chair from this list (see waitingRoomCast.js)
  },

  // The gamer (owner's character): walks in at `at` seconds of play, doesn't take a ticket, sits, snacks.
  // Looks: theme.characterPalettes.cast.gamer; build (and belly wobble): characters.builds.gamer.
  gamer: {
    at: 90,                           // seconds of play (pauses don't count); ?gamer=10 in the URL for testing
    seatPreference: [7, 5, 4, 1, 9],  // first free chair from this list (7: wedged between the young man and the woman with the magazine)
    // His walk: slower, a deeper bounce, a side-to-side waddle, feet and arms wide, heavy footsteps
    gait: { speed: 0.7, bob: 2.6, waddle: 0.07, hipWidth: 1.9, shoulderWidth: 1.9, steps: -0.6 },
    // In his chair: something from the bag, or a sip, every few seconds
    snack: {
      every: [3, 7],                  // seconds between snacks
      chances: { chip: 0.62, sip: 0.3, tip: 0.08 }, // tip: the bag upended over his mouth, for the crumbs
      bites: [1, 3],                  // chips per handful
      burpChance: 0.3,                // after a sip
    },
  },

  // The waiting people talking among themselves (overheard in src/data/npcConversations.ts)
  overheard: {
    enabled: false,           // switched off for now (owner): distracting as text; maybe back once they have voices
    first: 75,                // seconds of play before the first exchange
    every: [55, 90],          // seconds between exchanges
    retry: 6,                 // seconds before trying again when nobody can talk right now
    doorTalkAfterKnocks: 3,   // knocks on the accountant's door before the voice starts talking back
  },

  // The player's appointment, as read on the wall clock (12-hour face)
  appointment: {
    hour: 2,
    minute: 0,
    onTimeMinutes: 2,         // readings 2:00 .. 2:02 count as on time; 2:03 and later is late
  },

  // ---- Pacing. The beat data (src/data/waitingRoomBeats.ts) reads these. ----
  timings: {
    reception: {
      glanceDuration: 2.0,          // beat 1: silent look at the player
      gate: [10, 15],               // seconds before the next attempt unlocks (random in range)
      beat2IgnoreBeforeLine: 3.5,   // beat 2: clicks continue this long before "Sshhh..."
      beat3PauseBeforeLine: 1.2,    // beat 3: pause before "Take a number..."
      sideOptionPause: 1.5,         // pause before a flat reply to a non-advancing option
      newGameWait: 10,         // "You gotta sign the check-in sheet.": she starts a new game; the player can't go on for this long
      clipboardSlide: 2.0,          // on time: she slides the check-in sheet over (whole motion)
      phoneOut: 0.9,                // seconds to get her phone out of her pocket (anim 'filmPlayer')
      coffeeAway: 30,               // seconds she's gone through the EMPLOYEES ONLY door for coffee
      coffeeSip: 2.2,               // one sip of coffee
      clockGlance: 1.3,             // "It's 2:00." when it isn't: she checks the clock, then "No it's not."
    },
    dialogue: {
      charsPerSecond: 30,           // typewriter speed
      holdBase: 1.2,                // seconds a finished line stays on screen...
      holdPerChar: 0.035,           // ...plus this per character
      reactionDelay: 0.5,           // after a line finishes typing, before the next action starts
    },
    waiting: {
      duration: 300,                // seconds from "waiting" phase (told + ticket) to being called.
                                    // Owner's decision: long enough that the clock passes 2:00 first.
      fastDuration: 6,              // with ?fastwait in the URL (testing)
    },
    call: {
      // OFF for now (owner): the 5-minute wait ending in "Eight hundred forty-seven" cut off the check-in /
      // pen / newcomer storyline (848 is called in that instead). true brings it back.
      enabled: false,
      pauseBeforeLine: 0.8,
    },
    receptionistClicks: {
      gap: [0.35, 2.4],             // seconds between solitaire clicks
      doubleClickChance: 0.18,
      doubleClickGap: 0.11,
      longPauseChance: 0.12,        // occasionally she considers her move
      longPause: [3, 6],
    },
  },

  // ---- The five waiting people (see src/data/waitingRoomCast.js) ----
  npc: {
    noticeDistance: 3.0,        // eyes follow the player within this range (head stays put)
    ticketGlance: 1.4,          // everyone looks over when the player takes a ticket
    crowdedDistance: 0.85,      // player sits this close (chair to chair): neighbour leans away
    crowdLean: 0.14,            // radians
    headTurnSpeed: 4,
    clockGlance: { every: [15, 32], duration: 2.0 },
    cough: { every: [6, 10], coughs: [2, 3], gap: 0.28 },
    watch: { every: [12, 20], lookAtWatch: 2.2, lookAtClock: 1.6 },
    pageTurn: { every: [7, 13], duration: 0.7 },
    jiggle: {
      rate: 5.5, height: 0.028,
      seatShake: 0.35,       // the player's view bounces this much (x his knee lift) sitting next to him
      stopFor: 6,            // seconds he stops when asked (halved each time after)
      faster: 1.3,           // ...and then he starts again this much faster
    },
    askTime: { after: 4, every: 45, max: 3 },
    // Behind the desk, before the brawl, she shoves the player away: nobody gets closer than `radius`
    // metres to her chair. From the brawl on, everyone moves freely.
    // The newcomer, sent in ("Number 848, you can go on in."): walks towards the accountant's door but never
    // goes in. The player protesting stops him; every time he speaks he comes back closer, angrier.
    newcomerPush: {
      doorSpeed: 0.8,                       // x walk speed, heading for the door (unhurried)
      stopShort: 1.1,                       // metres in front of the door where he waits
      distances: [1.6, 1.2, 0.9, 0.7],      // how close he comes, each time he speaks (the last repeats)
      expressions: ['annoyed', 'angry', 'furious', 'furious'],
      speedPerLine: 0.35,                   // faster each time (x walk speed, on top of 1)
      sayThenWait: 2.5,                     // seconds he stays in the player's face before heading off again
    },
    receptionistSpace: { radius: 1.25, holdSpeed: 2.8, shoveSpeed: 3.4, shake: 0.3, shoveEvery: 0.8, lookFor: 1.5 }, // the man with the watch asks the time: seconds seated beside him, gap, times
    exhale: { every: [10, 18], duration: 2.2 },
    shift: { every: [15, 26], duration: 1.2 },
    calledLookDelay: [0.2, 0.9],
    // The first time the player hits the sitter back, everyone else is appalled (at the player)
    onlookers: { lookDelay: [0.05, 0.5], surprisedFor: 1.3 },  // after the call, each head turns to the player after a moment
    // Getting up, walking and sitting back down (the radio errand; the brawl reuses it)
    // Her attacks on the player (feel only for now: knockback, camera shake, sound; no health yet).
    //   knock = shove speed in m/s, shake = camera shake, hits land within `reach` metres
    attacks: {
      reach: 1.15,
      slap: { duration: 0.9, knock: 1.4, shake: 0.5, damage: 6, sound: 'slap' },
      shove: { duration: 1.0, knock: 3.4, shake: 0.4, damage: 5, sound: 'shove' },
      punch: { duration: 0.9, knock: 2.6, shake: 0.9, damage: 12, sound: 'punch' },
      kick: { duration: 1.1, knock: 3.8, shake: 1.0, damage: 15, sound: 'kick' },
      combo: { duration: 2.4, sequence: ['slap', 'shove', 'punch'] },
      chop: { duration: 0.95, knock: 1.8, shake: 0.9, damage: 11, sound: 'slap' },        // karate: a knife-hand chop from above
      roundhouse: { duration: 1.25, knock: 4.4, shake: 1.2, damage: 16, sound: 'kick' },  // karate: a sweeping kick
      jab: { duration: 0.55, knock: 1.2, shake: 0.5, damage: 6, sound: 'punch' },         // boxing: quick, straight, the lead hand
      boxCombo: { duration: 1.9, sequence: ['jab', 'jab', 'punch'] },                     // boxing: jab, jab, cross
      throw: { duration: 1.1, pose: 'radio', knock: 0, shake: 0, damage: 0, sound: 'whoosh' }, // (throwing: brawl.throwing)
      radio: { duration: 1.3, knock: 4.6, shake: 1.5, damage: 25, sound: 'radioHit' },
      shoveHard: { duration: 1.0, knock: 7.5, shake: 1.2, damage: 0, sound: 'shove', pose: 'shove' }, // the sitter's, in the argument: several feet
      clipboard: { duration: 1.4, knock: 3.6, shake: 1.6, damage: 18, sound: 'clipboard', pose: 'radio' }, // the newcomer's opener
    },
    // The radio war: from the `violentFrom`-th time the radio is turned off, she attacks the player
    // first, in this order (the last one repeats). The player can fight back after `fightBackAfter`.
    violence: {
      violentFrom: 3,
      escalation: ['slap', 'shove', 'punch', 'kick', 'combo', 'radio'],
      fightBackAfter: 'kick',
      approachDistance: 0.75,
    },
    // Fighting back: people flinch when hit, and go down as a ragdoll (config.ragdoll) when their
    // health (config.brawl.health) runs out: 4 punches, or fewer with something heavy
    // Each time the player turns the radio off, she gets angrier: faster and faster
    anger: { speedPerLevel: 0.45, maxSpeed: 3.2, expressions: ['annoyed', 'angry', 'furious'] },
    walk: { speed: 0.75, stride: 0.5, turnSpeed: 3.5, riseTime: 1.0, sitTime: 1.0, reachTime: 1.6, personalSpace: 0.55, getUpTime: 1.6 },
  },

  // ---- The radio (owner's request) ----
  radio: {
    at: 60,                     // seconds of play (pauses don't count) before someone turns it on
    who: 'sitter',              // which waiting person gets up (id from src/data/waitingRoomCast.js);
                                // the sitter is across the room, so it's a long walk
    // Fighting her before the brawl (owner): she takes this many times the usual hits to go down...
    toughness: 2,
    // ...and if she does go down, she gets back up when the brawl starts and joins in
    // (her radio-war knockdown then no longer counts towards the 4)
    wakeForBrawl: true,
    // The song (src/audio/), bundled by Vite; loops until the accountant's door opens
    file: new URL('./audio/look_to_the_sky.mp3', import.meta.url).href,
    volume: 0.18,               // very, very soft: about 4-5 dB under the fluorescent hum
    refDistance: 6,             // positional, but nearly the same volume anywhere in the room
    rolloff: 0.25,
    tinny: true,                // band-limit it like a small radio speaker
    highpass: 180,
    lowpass: 3600,
    stopAtPhase: 'doorOpen',    // stops when the player can leave for the accountant
  },

  interaction: {
    maxDistance: 2.6,               // metres from the eye
    readDistance: 3.6,              // things you only read (signs) can be read from this far
  },

  seated: {
    eyeHeight: 1.12,                // above the floor
    eyeForward: 0.02,               // from the chair centre, along its facing
    yawLimit: 1.2,                  // look-around while seated (radians each way)
    pitchLimit: 0.7,
    standUpDistance: 0.6,           // stand this far in front of the chair
    uprightThreshold: 0.9,          // chair up-vector dot; below this you can't sit
  },

  // ---- Character construction (shared by NPCs and the receptionist) ----
  characters: {
    // Chunky, slightly big-headed toy figures. Metres at scale 1.
    proportions: {
      pelvis: { w: 0.36, h: 0.16, d: 0.24 },
      torso: { w: 0.42, h: 0.5, d: 0.26 },
      neck: 0.06,
      head: { w: 0.3, h: 0.32, d: 0.3 },
      upperArm: { len: 0.3, thick: 0.12 },
      lowerArm: { len: 0.27, thick: 0.11 },
      hand: 0.065,                  // radius
      upperLeg: { len: 0.42, thick: 0.16 },
      lowerLeg: { len: 0.4, thick: 0.14 },
      foot: { w: 0.12, h: 0.07, l: 0.24 },
      shoulderInset: 0.03,
      hipSpacing: 0.1,
    },
    // Individual builds for the waiting people (override the shared proportions above)
    builds: {
      sitter: {   // an hourglass figure: narrow shoulders and a small waist, full hips and seat, a full bust
        curvy: true,                   // ('natural' style: the hourglass torso and pelvis, partShapes.js)
        pelvis: { w: 0.47, h: 0.2, d: 0.3 },
        torso: { w: 0.35, h: 0.48, d: 0.22 },
        bust: { r: 0.08, spacing: 0.099, y: 0.275, forward: 0.08, depth: 0.82 }, // depth: how far it stands out from the chest
        head: { w: 0.24, h: 0.29, d: 0.26 },
        upperArm: { len: 0.29, thick: 0.095 },
        lowerArm: { len: 0.26, thick: 0.085 },
        upperLeg: { len: 0.42, thick: 0.19 },  // full thighs: the skirt flows down from the hips
        lowerLeg: { len: 0.4, thick: 0.115 },
        hipSpacing: 0.12,
        shoulderInset: 0.02,
      },
      reader: {
        bust: { r: 0.075, spacing: 0.078, y: 0.325, forward: 0.05, depth: 0.7 }, // depth: how far it stands out from the chest
      },
      gamer: {    // huge: wider and deeper than the receptionist, a belly that hangs out over his lap
        pelvis: { w: 0.74, h: 0.24, d: 0.56 },
        torso: { w: 0.8, h: 0.52, d: 0.6 },
        belly: { w: 0.8, h: 0.5, d: 0.25, y: 0.13 },    // rounded front of the torso, low down, hanging over his belt
        chest: { w: 0.7, h: 0.24, d: 0.1, y: 0.37 },
        head: { w: 0.26, h: 0.29, d: 0.28 },
        jowls: { w: 0.27, h: 0.1, d: 0.16 },
        neck: 0.02,
        upperArm: { len: 0.3, thick: 0.185 },
        lowerArm: { len: 0.27, thick: 0.16 },
        upperLeg: { len: 0.42, thick: 0.31 },
        lowerLeg: { len: 0.4, thick: 0.22 },
        hipSpacing: 0.2,
        shoulderInset: 0.05,
        // The wobble (rig.js makeJiggle): the belly bounces when he walks, sits down or gets hit
        jiggle: { stiffness: 140, damping: 4.5, gain: 3, max: 0.07, squash: 2.5, parts: { belly: 1, chest: 0.6, jowls: 0.45 } },
      },
    },
    // Per-style changes to the proportions above (theme.look.characterStyle picks the style)
    styleProportions: {
      figure: {
        head: { w: 0.255, h: 0.3, d: 0.27 },  // a little smaller and less square: less cartoonish
        neck: 0.075,
        mitten: { w: 0.07, h: 0.1, d: 0.045 }, // mitten hands instead of balls
      },
      // More lifelike (characters/partShapes.js): a smaller head, a thicker neck, slimmer limbs that the
      // muscle shapes fill out, real hands (w = thickness, h = wrist to fingertip, d = across) and longer shoes
      natural: {
        head: { w: 0.235, h: 0.28, d: 0.255 },
        neck: 0.06,
        mitten: { w: 0.03, h: 0.15, d: 0.072 },
        upperArm: { len: 0.3, thick: 0.108 },
        lowerArm: { len: 0.27, thick: 0.092 },
        upperLeg: { len: 0.42, thick: 0.165 },
        lowerLeg: { len: 0.4, thick: 0.13 },
        foot: { w: 0.1, h: 0.075, l: 0.27 },
      },
      // MOCKUP: organic shapes (egg head with a jaw, chest and waist, hips, tapering limbs)
      sculpted: {
        head: { w: 0.245, h: 0.3, d: 0.265 },
        neck: 0.08,
        mitten: { w: 0.066, h: 0.1, d: 0.038 },
        upperArm: { len: 0.3, thick: 0.11 },
        lowerArm: { len: 0.27, thick: 0.095 },
        upperLeg: { len: 0.42, thick: 0.16 },
        lowerLeg: { len: 0.4, thick: 0.13 },
      },
    },
    // Facial expressions (only the 'figure' style has a face that can show them).
    //   lids   0 = wide open .. 1 = shut
    //   brows  raise (m, + up), angle (rad, + = inner ends up/worried, - = frown), asym (m, lifts her left brow)
    //   mouth  smile (+ up / - down), open (0..1), width (x1), asym (lifts her left corner: a smirk)
    expressions: {
      neutral:     { lids: 0.12, brows: { raise: 0, angle: 0 },           mouth: { smile: 0, open: 0, width: 1 } },
      bored:       { lids: 0.5,  brows: { raise: -0.003, angle: 0.05 },   mouth: { smile: -0.15, width: 0.9 } },
      unimpressed: { lids: 0.38, brows: { raise: -0.002, asym: 0.012 },   mouth: { smile: -0.1, width: 0.85, asym: 0.12 } },
      annoyed:     { lids: 0.3,  brows: { raise: -0.006, angle: -0.35 },  mouth: { smile: -0.35, width: 0.8 } },
      surprised:   { lids: 0,    brows: { raise: 0.012, angle: 0.15 },    mouth: { smile: 0, open: 0.55, width: 0.75 } },
      pleased:     { lids: 0.2,  brows: { raise: 0.004, angle: 0.05 },    mouth: { smile: 0.35, width: 1.1 } },
      angry:       { lids: 0.15, brows: { raise: -0.009, angle: -0.5 },   mouth: { smile: -0.5, width: 0.75 } },
      furious:     { lids: 0.0,  brows: { raise: -0.011, angle: -0.65 },  mouth: { smile: -0.6, open: 0.25, width: 0.7 } },
      appalled:    { lids: 0.05, brows: { raise: 0.006, angle: -0.25 },   mouth: { smile: -0.45, open: 0.15, width: 0.7, asym: 0.1 } },
      sultry:      { lids: 0.42, brows: { raise: 0.002, angle: 0.05, asym: 0.008 }, mouth: { smile: 0.18, width: 0.95, asym: 0.12 } }, // heavy-lidded, a knowing half-smile
    },
    blinkInterval: [2.5, 6],
    receptionist: {
      scale: 0.94,
      // Her build: very fat. Overrides the shared proportions above (same joints, wider parts).
      proportions: {
        pelvis: { w: 0.66, h: 0.22, d: 0.5 },
        torso: { w: 0.74, h: 0.5, d: 0.54 },
        belly: { w: 0.66, h: 0.4, d: 0.26, y: 0.17 },  // rounded front of the torso, low down
        chest: { w: 0.62, h: 0.22, d: 0.14, y: 0.36 },  // fuller upper front
        head: { w: 0.29, h: 0.31, d: 0.29 },
        jowls: { w: 0.24, h: 0.09, d: 0.14 },            // double chin under the jaw
        neck: 0.02,
        upperArm: { len: 0.3, thick: 0.2 },
        lowerArm: { len: 0.27, thick: 0.165 },
        upperLeg: { len: 0.42, thick: 0.29 },
        lowerLeg: { len: 0.4, thick: 0.21 },
        hipSpacing: 0.19,
        shoulderInset: 0.05,
      },
      voicePitch: 320,              // Hz, dialogue blips
      headTurnSpeed: 5,             // how quickly she turns to look
      clockGlanceTwist: 0.75,       // radians of upper-body turn to see the clock behind her
      signPointTwist: 0.35,         // radians of upper-body turn while pointing at the WALK-IN sign
    },
    playerVoicePitch: 190,
  },

  // ---- Audio levels (all sounds are synthesised in src/audio/sfx.js) ----
  audio: {
    master: 0.8,
    // The wall clock: a 2-second tick-tock recording (src/audio/), restarted on every even second
    // of the game clock so it stays in step with the second hand. Positional, louder near the clock.
    clockTick: {
      file: new URL('./audio/clock_tick.mp3', import.meta.url).href,
      volume: 0.35, refDistance: 1.2, rolloff: 1.4, // about as loud as the old synthesised tick
    },
    mouseClick: { volume: 0.55, refDistance: 1.0, rolloff: 1.3 },
    hum: { volume: 0.05 },
    footsteps: { volume: 0.22, strideLength: 0.7 },
    voice: { volume: 0.18 },
    ticketTear: { volume: 0.5 },
    paperSlide: { volume: 0.45 },
    cough: { volume: 0.5, refDistance: 1.5, rolloff: 1.1 },
    sigh: { volume: 0.35, refDistance: 1.2, rolloff: 1.2 },
    pageTurn: { volume: 0.3, refDistance: 1.0, rolloff: 1.3 },
    chairShift: { volume: 0.25 },
    watchTick: { volume: 0.12, refDistance: 0.4, rolloff: 2.0 },
    chime: { volume: 0.45 },
    stomp: { volume: 0.35, refDistance: 1.5, rolloff: 1.0 },
    hits: { volume: 0.7, refDistance: 1.5, rolloff: 1.0 },
    chairCreak: { volume: 0.35 },
    // The gamer's snacking (all synthesised, positional: you hear it from his corner of the room)
    snack: { volume: 0.4, refDistance: 1.0, rolloff: 1.4 },
  },

  debug: {
    showFps: false,           // toggle in-game with F3
    showBeat: true,           // the current beat, top left (toggle in-game with F4)
    // ?beat=argument_1 in the URL: the game plays itself at high speed up to that beat (src/debug/skipToBeat.js)
    skipStepsPerFrame: 40,    // game steps per frame while skipping (each config.physics.fixedStep long)
    skipGiveUpAfter: 1800,    // game seconds before giving up
    autostart: false,         // also enabled by ?autostart in the URL (skips the title screen)
  },
};
