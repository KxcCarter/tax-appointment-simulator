// ALL tunables live here. Change numbers, not engine code.
// Units: metres, seconds, radians unless noted.

export const config = {
  render: {
    fov: 70,
    near: 0.05,
    far: 60,
    materialStyle: 'lambert', // 'lambert' | 'toon' (3-step gradient)
    maxPixelRatio: 2,         // cap for high-DPI screens (performance)
    background: 0x1a1612,
  },

  lighting: {
    hemiSky: 0xf0ffe4,        // faintly green fluorescent
    hemiGround: 0x5a4632,     // brown carpet bounce
    hemiIntensity: 1.6,
    ambientIntensity: 0.35,
    panelColor: 0xe6ffd8,
    panelLightIntensity: 4.0,
    panelLightDistance: 9,
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
    timeScale: 1,             // 1 = real time. (proposal: make this ~0.2 later so it barely moves)
  },

  nowServing: {
    initial: 12,
  },

  debug: {
    showFps: false,           // toggle in-game with F3
    autostart: false,         // also enabled by ?autostart in the URL (skips the title screen)
  },
};
