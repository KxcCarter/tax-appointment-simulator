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

  ticket: {
    number: 847,
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
      clipboardSlide: 2.0,          // on time: she slides the check-in sheet over (whole motion)
      clockGlance: 1.3,             // "It's 2:00." when it isn't: she checks the clock, then "No it's not."
    },
    dialogue: {
      charsPerSecond: 30,           // typewriter speed
      holdBase: 1.2,                // seconds a finished line stays on screen...
      holdPerChar: 0.035,           // ...plus this per character
      reactionDelay: 0.5,           // after a line finishes typing, before the next action starts
    },
    waiting: {
      duration: 60,                 // seconds from "waiting" phase (told + ticket) to being called
      fastDuration: 6,              // with ?fastwait in the URL (testing)
    },
    call: {
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
    jiggle: { rate: 5.5, height: 0.028 },
    exhale: { every: [10, 18], duration: 2.2 },
    shift: { every: [15, 26], duration: 1.2 },
    calledLookDelay: [0.2, 0.9],  // after the call, each head turns to the player after a moment
    // Getting up, walking and sitting back down (the radio errand; the brawl reuses it)
    walk: { speed: 0.75, stride: 0.5, turnSpeed: 3.5, riseTime: 1.0, sitTime: 1.0, reachTime: 1.6, personalSpace: 0.55 },
  },

  // ---- The radio (owner's request) ----
  radio: {
    at: 120,                    // seconds of play (pauses don't count) before someone turns it on
    who: 'reader',              // which waiting person gets up (id from src/data/waitingRoomCast.js)
    file: 'audio/look_to_the_sky.wav', // in public/; loops until the accountant's door opens
    volume: 0.05,               // very, very soft
    refDistance: 6,             // positional, but nearly the same volume anywhere in the room
    rolloff: 0.25,
    tinny: true,                // band-limit it like a small radio speaker
    highpass: 180,
    lowpass: 3600,
    stopAtPhase: 'doorOpen',    // stops when the player can leave for the accountant
  },

  interaction: {
    maxDistance: 2.6,               // metres from the eye
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
    // Per-style changes to the proportions above (theme.look.characterStyle picks the style)
    styleProportions: {
      figure: {
        head: { w: 0.255, h: 0.3, d: 0.27 },  // a little smaller and less square: less cartoonish
        neck: 0.075,
        mitten: { w: 0.07, h: 0.1, d: 0.045 }, // mitten hands instead of balls
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
    },
    blinkInterval: [2.5, 6],
    receptionist: {
      scale: 0.94,
      voicePitch: 320,              // Hz, dialogue blips
      headTurnSpeed: 5,             // how quickly she turns to look
      clockGlanceTwist: 0.75,       // radians of upper-body turn to see the clock behind her
    },
    playerVoicePitch: 190,
  },

  // ---- Audio levels (all sounds are synthesised in src/audio/sfx.js) ----
  audio: {
    master: 0.8,
    clockTick: { volume: 0.5, refDistance: 1.2, rolloff: 1.4 },
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
    chairCreak: { volume: 0.35 },
  },

  debug: {
    showFps: false,           // toggle in-game with F3
    autostart: false,         // also enabled by ?autostart in the URL (skips the title screen)
  },
};
