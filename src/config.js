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
