import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/*
  THEME: every look-related setting lives here.
  Palette, material factory, texture filtering, lighting, background/fog,
  character colour palettes and the UI colour scheme.

  Rule: no other file hard-codes a colour, creates a material or sets up a light.
  Other files ask for colours by NAME: theme.material('wallBeige'),
  theme.unlit('ledRed'), theme.css('inkBlack') for canvas drawing.
*/

// ---------------------------------------------------------------------------
// Palette: a 1980s/90s tax office. Names describe the use, not the hue.
// ---------------------------------------------------------------------------
export const palette = {
  // Room shell
  wallBeige: 0xd8c9a3,
  wainscotMint: 0x9fd8b5,
  woodDark: 0x6e4a2a,
  woodVeneer: 0x9a6a3c,
  doorWood: 0x7b5634,
  doorPanel: 0x6e4a2a,
  carpet: 0x5c4230,
  carpetFleckDark: 0x4e3727,
  carpetFleckMid: 0x6a4c37,
  carpetFleckLight: 0x7a5a40,
  ceilingTile: 0xe8e2cf,
  ceilingSpeck: 0xd4cdb8,
  ceilingGrid: 0xb9b4a2,
  lightPanel: 0xe6ffd8,      // fluorescent diffuser (unlit)
  doormat: 0x3d3a33,

  // Furniture & props
  chairVinyl: 0x7f9466,      // avocado vinyl
  chairFrame: 0x3b3b38,
  officeChairFabric: 0x4a5a7a,
  metalGrey: 0x8d8f8a,
  filingCabinet: 0xb8b19a,
  crtBeige: 0xcfc4a4,
  keycap: 0xa99f84,
  mousepad: 0x2d4a6a,
  paperWhite: 0xf4f1e8,
  paperCream: 0xe9e2c8,
  inTray: 0x1b1a18,
  mug: 0xa83a2a,
  deskPhone: 0x2b2b2b,
  dispenserRed: 0xb5332b,
  terracotta: 0xa45a3a,
  pottingSoil: 0x3a2a1c,
  plantGreen: 0x3e6b34,
  plantDying: 0x8a8f3a,
  plantStem: 0x5a4022,
  coolerWhite: 0xf4f1e8,
  coolerTapCold: 0x2d6ab0,
  coolerTapHot: 0xb5332b,
  waterBlue: 0x8fc4e0,
  umbrellaStand: 0x3f5a4a,
  umbrellaBlack: 0x1b1a18,
  umbrellaMaroon: 0x7a2a3a,
  umbrellaHandle: 0x5a4022,
  coat: 0x6a5a44,
  brassKnob: 0xc8a54a,
  black: 0x1b1a18,
  white: 0xffffff,
  eyeWhite: 0xf2eee4,
  watchStrap: 0x3b2a1a,
  watchFace: 0xd9c27a,
  briefcase: 0x5a3a22,
  radioCase: 0x7a5232,          // wood-grain plastic
  backRoom: 0x5a5444,           // the dim staff room behind EMPLOYEES ONLY
  backRoomFloor: 0x3a3a34,
  batWood: 0xc8a06a,            // the baseball bat in the back room
  batGrip: 0x2a2420,
  mopHandle: 0x9a8f7a,
  mopHead: 0xcfc7b0,
  extinguisherRed: 0xb3261e,
  corridor: 0x8a8470,            // the building corridor outside the entrance
  corridorFloor: 0x4a4038,
  coffeeCup: 0xf4f1e8,
  beltLeather: 0x2e2118,         // the 'natural' character style's belts
  beltBuckle: 0xb8a060,
  phoneBody: 0x1c1c20,           // the receptionist's cellphone
  phoneScreen: 0x9ec8e8,
  chipsBag: 0xd8442a,            // the gamer's family-size bag of chips
  chipsBagBand: 0xf0c030,
  chipsBagCrimp: 0xb8341e,
  chip: 0xe8c060,
  // Damage (the brawl: src/characters/damage.js)
  bruise: 0x6a3f5e,              // fresh: purple
  bruiseOld: 0x8a7f4a,           // older: yellow-green
  blackEye: 0x3e2a44,
  cut: 0x5a0808,
  blood: 0x8e1010,
  knuckleBlood: 0x9a2020,        // the player's own fists, after enough punches
  canBody: 0x1b1d1a,             // ...and his energy drink
  canStripe: 0x8ae03a,
  canTop: 0xb8bcc0,
  playerSkin: 0xd9a582,          // the player's fists
  playerSleeve: 0x4a4a48,
  playerTrousers: 0x3a3a40,     // the player's kicking leg
  playerShoe: 0x2a1e16,
  hitFlash: 0xffffff,           // someone flashes white when hit
  coffee: 0x3b2414,
  radioGrille: 0x2b2a26,
  radioDialOff: 0x5a5440,
  radioDialOn: 0xffc870,         // warm glow once it's on
  briefcaseLatch: 0xc8a54a,
  mouthDark: 0x4a2222,           // neutral base under textures
  // Realistic room props (src/level/props.js)
  chrome: 0xd8dcdf,
  plasticDark: 0x2a2926,
  crtBeigeDark: 0xb4a888,        // the shadowed beige of vents, seams and the back of the monitor
  crtGlass: 0x0c100e,
  bezelBeige: 0xc2b796,
  ledGreen: 0x5aff6a,
  ledAmber: 0xffb040,
  cable: 0x2e2d2a,
  laminate: 0xdcd2b8,            // the desk top
  coolerGrey: 0xd9d6cc,
  coolerDrip: 0x6a6c68,
  rubberBlack: 0x141413,
  cupPaper: 0xf6f4ee,
  soilDark: 0x2a1e14,
  leafDark: 0x2f5528,
  leafLight: 0x5a8a44,
  handleBlack: 0x1e1d1b,
  labelCard: 0xf0ead8,
  chainGold: 0xd8ae48,

  // Clock
  clockFace: 0xf2eedf,
  clockInk: 0x1b1a18,
  clockSecondHand: 0xb5332b,

  // NOW SERVING LED
  ledBackground: 0x140504,
  ledGhost: 0x220806,
  ledRed: 0xff3a22,
  ledLabel: 0xd8c9a3,

  // Solitaire on the CRT
  feltGreen: 0x0d7a3a,
  feltOutline: 0x3fae6a,
  cardBack: 0x2246a8,
  cardFace: 0xf4f1e8,
  cardRed: 0xc02020,
  cardBlack: 0x111111,

  // Signage & print
  inkBlack: 0x1b1a18,
  inkDark: 0x2b2a26,
  inkRed: 0xb5332b,
  inkBlue: 0x23408e,          // ballpoint signatures
  clipboardBoard: 0x8a5a32,   // masonite
  clipboardClip: 0x9a9c96,
  frostedGlass: 0xb9c8c0,
  nameplate: 0x2b2416,
  nameplateText: 0xd9c27a,
  brassPlaque: 0xc8a54a,
  brassPlaqueEdge: 0x6b5420,
  brassPlaqueText: 0x2b2010,
  posterBlack: 0x1b1a18,
  posterSky: 0x5a6a8a,
  posterMountain: 0xd8d0bc,
  certificatePaper: 0xf2ead0,
  certificateGold: 0xa8822a,
  certificateInk: 0x3a2e1a,
  magazineRed: 0xb5332b,
  magazineBlue: 0x2d4a6a,
  magazineAvocado: 0x6b7a3a,
  magazineMustard: 0xa8822a,
  magazineHighlight: 0xffffff, // drawn at 35% alpha
};

// ---------------------------------------------------------------------------
// Characters (used from Milestone 3). Randomised per NPC from these lists.
// ---------------------------------------------------------------------------
export const characterPalettes = {
  skin: [0xf1c9a5, 0xe0ac85, 0xc68863, 0x9c6644, 0x6f4a32, 0x4a3022],
  hair: [0x1b1a18, 0x3b2a1a, 0x6a4a2a, 0xa07a4a, 0xc9c2b4, 0x8a3a1a],
  eyes: [0x3b2a1a, 0x4a6a8a, 0x5a6a3a, 0x2b2a26],
  shirts: [0xe8e2cf, 0x9fb4c8, 0xc8b48a, 0xd8a8a0, 0xa8c8a0, 0xf4f1e8],
  jackets: [0x5a4a3a, 0x3f4a5a, 0x6b7a3a, 0x7a3a2a, 0x8a7a5a, 0x4a4a48],
  trousers: [0x3b3b38, 0x4a3a2a, 0x2d3a4a, 0x6a5a44, 0x5a5a52],
  shoes: [0x1b1a18, 0x3b2a1a, 0x5a4022],
  ties: [0xb5332b, 0x2d4a6a, 0x6b7a3a, 0xa8822a],
  hats: [0x3b3b38, 0x5a4a3a, 0x7a2a3a, 0x2d4a6a],
  accessories: ['none', 'glasses', 'moustache', 'tie', 'briefcase'],
  hatStyles: ['none', 'fedora', 'cap'],
  // The five people in the waiting room. Fixed cast: always these, always looking like this.
  // (Seats and behaviour are in src/data/waitingRoomCast.js.)
  cast: {
    cougher: {        // older man, brown three-piece suit, fedora, moustache
      scale: 0.97, skin: 0xe9b896, hair: 0xc9c2b4, hairStyle: 'balding', eyes: 0x4a6a8a, lips: 0xc08a78,
      jacket: 0x5a4a3a, shirt: 0xe8e2cf, tie: 0x7a2a3a, trousers: 0x4a3a2a, shoes: 0x3b2a1a,
      hat: 'fedora', hatColor: 0x6a5a44, hatBand: 0x2b2a26, moustache: true,
    },
    watchChecker: {   // tall man, navy suit, briefcase, wristwatch
      scale: 1.04, skin: 0x6f4a32, hair: 0x1b1a18, hairStyle: 'short', eyes: 0x2b2a26, lips: 0x5a3a2e,
      jacket: 0x3f4a5a, shirt: 0x9fb4c8, tie: 0xa8822a, trousers: 0x2d3a4a, shoes: 0x1b1a18,
      watch: true,
    },
    reader: {         // woman, rust cardigan, glasses, bob
      scale: 0.93, skin: 0xf1c9a5, hair: 0xa07a4a, hairStyle: 'bob', eyes: 0x5a6a3a, lips: 0xb0606a,
      jacket: 0x7a3a2a, shirt: 0xf4f1e8, trousers: 0x5a4a3a, shoes: 0x5a4022, glasses: 0x6a4a2a,
    },
    jiggler: {        // young man, avocado windbreaker, cap, jeans
      scale: 1.0, skin: 0xc68863, hair: 0x3b2a1a, hairStyle: 'short', eyes: 0x3b2a1a, lips: 0x9a6050,
      jacket: 0x6b7a3a, shirt: 0xe8e2cf, trousers: 0x2d4a6a, shoes: 0xe8e2cf,
      hat: 'cap', hatColor: 0x7a2a3a,
    },
    newcomer: {       // arrives later: a 'bro' (owner's redesign): white tank top, navy cargo shorts, sneakers, sunglasses, gold chain
      scale: 1.02, skin: 0xe0ac85, hair: 0x5a4022, hairStyle: 'short', eyes: 0x4a6a8a, lips: 0xb07868,
      jacket: 0xf2f0ea, shirt: 0xf2f0ea, trousers: 0x2d3a4a, shoes: 0xe8e2cf, glasses: 0x1b1a18, shortSleeves: true,
      legLower: 0xe0ac85,   // shorts: bare calves
      chain: true, stubble: 0x7a5a3a,
    },
    gamer: {          // arrives at 90 s: huge young man, black T-shirt, cargo shorts, cap on backwards, headphones round his neck
      scale: 1.05, skin: 0xe9b896, hair: 0x6a4a2a, hairStyle: 'short', eyes: 0x5a6a3a, lips: 0xc08a78,
      jacket: 0x3a3a42, shirt: 0x3a3a42, trousers: 0x6a6450, shoes: 0xe8e2cf, shortSleeves: true,
      legLower: 0xe9b896,   // cargo shorts: bare calves
      hat: 'cap', hatColor: 0x2d4a6a, capBackwards: true,
      headset: 0x1b1a18, headsetCushion: 0x8ae03a,   // (lime ear cushions, like his can)
      stubble: 0x8a6a4a,
    },
    sitter: {         // woman, a bit of a seductress: fitted wine-red dress, plunging neckline, dark stockings, red heels, long hair
      scale: 0.95, skin: 0x9c6644, hair: 0x2b2a26, hairStyle: 'long', eyes: 0x3b2a1a, lips: 0xb0202e,
      jacket: 0x7a1424, shirt: 0x7a1424, trousers: 0x7a1424, shoes: 0xa0101c,
      shortSleeves: true, neckline: 'plunge', heels: true,
      legUpper: 0x7a1424,   // the dress's pencil skirt on the thighs...
      legLower: 0x3a2622,   // ...and dark sheer stockings below the knee
      lashes: 0x1b1a18,
      earrings: 0xd9c27a,
    },
  },
  receptionist: {
    skin: 0x6f4a32,
    hair: 0x8a3a1a,
    blouse: 0xd8a8a0,
    cardigan: 0x6b7a3a,
    skirt: 0x4a3a2a,
    glasses: 0x1b1a18,
    eyes: 0x4a3a2a,
    lips: 0x9a4a4e,
    shoes: 0x3b2a1a,
  },
};

// ---------------------------------------------------------------------------
// Rendering look
// ---------------------------------------------------------------------------
// Where the tie is in the texture of MakeHuman's 'suit with tie and jacket' (toigo_male_suit_tie_and_jacket)
const SUIT_TIE_JACKET_TIE = [0.749, 0.218, 1.0, 0.556];

export const look = {
  materialStyle: 'standard',    // 'lambert' | 'toon' | 'standard' (physically based: roughness, reflections)
  standard: { roughness: 0.85 },        // theme.material()'s default roughness ('standard' only)
  environment: { intensity: 0.4 },      // reflections of a generic lit room on 'standard' materials (null = none)
  toneMapping: 'neutral',               // 'none' | 'neutral' | 'aces' | 'agx'
  exposure: 1.05,
  // Contact shadows in corners, under furniture and between things (GTAO post-processing). ?ao=0 turns it off.
  ambientOcclusion: { enabled: true, radius: 0.4, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 16, msaa: 4 },
  // EXPERIMENT (branch realistic-receptionist): realistic versions of the whole cast. Rigged glTF models built with
  // MakeHuman (CC0; see tools/makehuman/README.md) that copies the primitive rig's pose (characters/realBody.js).
  // Her primitive body stays as an invisible hitbox. ?realistic=0 turns it off.
  realistic: {
    enabled: true,
    models: {
      receptionist: new URL('./models/characters/mh-receptionist.glb', import.meta.url).href,
      sitter: new URL('./models/characters/mh-sitter.glb', import.meta.url).href,
      cougher: new URL('./models/characters/mh-cougher.glb', import.meta.url).href,
      jiggler: new URL('./models/characters/mh-jiggler.glb', import.meta.url).href,
      watchChecker: new URL('./models/characters/mh-watchChecker.glb', import.meta.url).href,
      reader: new URL('./models/characters/mh-reader.glb', import.meta.url).href,
      newcomer: new URL('./models/characters/mh-newcomer.glb', import.meta.url).href,
      gamer: new URL('./models/characters/mh-gamer.glb', import.meta.url).href,
    },
    jiggleGain: 0.8, // how much a model's belly, breasts and double chin bounce, x her figure's wobble (config.characters.jiggle)
    // Colour multiplied over a model, or over materials whose name contains a key
    tint: {
      // Each character's look from characterPalettes. A value is a colour or [colour, brightness gain]
      // (gain > 1 brightens a dark texture), or { recolor: colour } to change only the dark fabric of a texture
      // and leave the shirt and tie alone (realBody.js recolor). The keys match parts of material or mesh names
      // (the first that matches). { tie: [u0, v0, u1, v1] } repaints the tie printed in a suit's texture (that
      // rectangle of it) in the figure's tie colour (realExtras.js paintTie).
      receptionist: { dress: [0x6b7a3a, 4.5], hair: [0x8a3a1a, 2.2] }, // olive (her cardigan), auburn hair
      sitter: { dress: [0x9a1a2c, 1.6], booties: [0xc01020, 1.2] }, // wine-red dress, red heels
      cougher: { suit: { recolor: 0x6a5038, tie: SUIT_TIE_JACKET_TIE }, fedora: [0x9a8060, 1.8], short04: [0xd8d2c8, 2.0] }, // brown suit and hat, grey hair
      jiggler: { cap: 0x8a2a3a }, // the white newsboy cap -> maroon
      reader: { sweater: [0x80c890, 1.45], pants: [0x8a6a50, 1.4], bob: [0xa89878, 1.0], glasses: 0x6a4a2a }, // rust sweater, brown trousers, honey bob, brown frames
      watchChecker: { suit: { tie: [0.85, 0.03, 0.935, 0.265] } }, // his mustard tie
      newcomer: { cargo: { recolor: 0x2d3a4a, below: 0.6, maxSat: 1, ref: 0.05 }, glasses: { color: 0x141414, dark: 0.88 }, short02: [0x6a4a2a, 1.3] }, // white tank top, navy cargo shorts, dark sunglasses, brown hair
      gamer: { 't-shirt': 0x3a3a42, cargo: { recolor: 0x8a8060, below: 0.6, maxSat: 1, ref: 0.05 }, cap: [0x2d4a6a, 1.25] }, // charcoal T-shirt, khaki cargo shorts (recoloured), navy cap
    },
  },
  characterStyle: 'natural',    // 'blocky' | 'rounded' | 'capsule' | 'soft' | 'figure' | 'sculpted' | 'natural' (see characters/partShapes.js)
  toonSteps: [90, 170, 255],    // gradient for 'toon'
  background: 0x1a1612,
  fog: null,                    // e.g. { color: 0x1a1612, near: 8, far: 30 }
  antialias: true,
  textureAnisotropy: 8,
  textureFilter: 'linear',      // 'linear' | 'nearest'
};

export const lighting = {
  hemisphere: { sky: 0xf0ffe4, ground: 0x5a4632, intensity: 1.6 }, // greenish fluorescent / carpet bounce
  ambient: { color: 0xffffff, intensity: 0.35 },
  ceilingPanels: { color: 0xe6ffd8, intensity: 4.0, distance: 9, decay: 1.2, dropBelowCeiling: 0.3 },
  shadows: false,
};

// UI overlay colours, applied as CSS custom properties on :root
export const ui = {
  '--phosphor': '#b8f0a0',
  '--phosphor-dim': '#6f9a5f',
  '--phosphor-glow': 'rgba(184, 240, 160, 0.45)',
  '--phosphor-hover': 'rgba(184, 240, 160, 0.12)',
  '--amber': '#e8c27a',
  '--page-bg': '#000000',
  '--screen-bg': '#0b0c08',
  '--overlay-bg': 'rgba(8, 9, 6, 0.78)',
  '--scanline': 'rgba(0, 0, 0, 0.28)',
  '--crosshair': 'rgba(255, 255, 255, 0.85)',
  '--crosshair-outline': 'rgba(0, 0, 0, 0.5)',
  '--hud-bg': 'rgba(0, 0, 0, 0.55)',
  '--dialogue-bg': 'rgba(12, 14, 9, 0.88)',
  '--dialogue-border': 'rgba(184, 240, 160, 0.35)',
  '--dialogue-text': '#e6f2dc',
  '--health': '#c9d6a0',        // the player's health bar (subtle)
  '--health-low': '#b5332b',
  '--damage': 'rgba(150, 20, 10, 0.45)', // red flash at the edges when hit
  '--hurt-blood': '#8a0c08',             // being hurt: the blood at the edges of the screen...
  '--hurt-blood-dark': '#3a0303',        // ...and its darker clots
  '--fade': '#000000',
  '--ticket-bg': '#f4f1e8',
  '--ticket-text': '#b5332b',
  '--ticket-edge': '#b5332b',
  '--font': '"Courier New", Courier, ui-monospace, Menlo, Consolas, monospace',
};

// ---------------------------------------------------------------------------
// Realistic surfaces (theme.surface(name)): the room's props. color: a palette name; roughness 0 (mirror) to 1
// (chalk); metalness 0 or 1; texture: a generated one (see surfaceTexture) and bump: how deep it looks.
// ---------------------------------------------------------------------------
export const surfaces = {
  crtPlastic: { color: 'crtBeige', roughness: 0.5, texture: 'plastic', bump: 0.15 },
  crtPlasticDark: { color: 'crtBeigeDark', roughness: 0.6, texture: 'plastic', bump: 0.15 },
  bezel: { color: 'bezelBeige', roughness: 0.55, texture: 'plastic', bump: 0.15 },
  crtGlass: { color: 'crtGlass', roughness: 0.15, transparent: true, opacity: 0.08, envMapIntensity: 0.25 },
  keycap: { color: 'keycap', roughness: 0.45, texture: 'plastic', bump: 0.1 },
  keycapDark: { color: 'crtBeigeDark', roughness: 0.45, texture: 'plastic', bump: 0.1 },
  plasticBlack: { color: 'plasticDark', roughness: 0.4, texture: 'plastic', bump: 0.12 },
  plasticRed: { color: 'dispenserRed', roughness: 0.35 },
  rubber: { color: 'rubberBlack', roughness: 0.9 },
  cable: { color: 'cable', roughness: 0.55 },
  ledGreen: { color: 'ledGreen', roughness: 0.3, emissive: 'ledGreen', emissiveIntensity: 1.5 },
  ledAmber: { color: 'ledAmber', roughness: 0.3, emissive: 'ledAmber', emissiveIntensity: 1.2 },
  chrome: { color: 'chrome', roughness: 0.18, metalness: 1 },
  steel: { color: 'metalGrey', roughness: 0.45, metalness: 1, texture: 'brushed' },
  paintedMetal: { color: 'chairFrame', roughness: 0.5, metalness: 0.3 },
  cabinetMetal: { color: 'filingCabinet', roughness: 0.55, metalness: 0.2, texture: 'plastic', bump: 0.1 },
  vinyl: { color: 'chairVinyl', roughness: 0.45, texture: 'vinyl', bump: 0.8 },
  officeFabric: { color: 'officeChairFabric', texture: 'fabric', bump: 1.2, repeat: [3, 3] },
  woodVeneer: { color: 'woodVeneer', roughness: 0.55, texture: 'wood', bump: 0.3 },
  woodDark: { color: 'woodDark', roughness: 0.6, texture: 'wood', bump: 0.3 },
  doorWood: { color: 'doorWood', roughness: 0.6, texture: 'wood', bump: 0.3 },
  laminate: { color: 'laminate', roughness: 0.4, texture: 'plastic', bump: 0.07 },
  coolerBody: { color: 'coolerGrey', roughness: 0.45, texture: 'plastic', bump: 0.12 },
  coolerDrip: { color: 'coolerDrip', roughness: 0.35, metalness: 0.6 },
  tapBlue: { color: 'coolerTapCold', roughness: 0.35 },
  tapRed: { color: 'coolerTapHot', roughness: 0.35 },
  bottle: { color: 'waterBlue', roughness: 0.05, transparent: true, opacity: 0.35 },
  water: { color: 'waterBlue', roughness: 0.1, transparent: true, opacity: 0.45 },
  paperCup: { color: 'cupPaper', roughness: 0.8 },
  ceramic: { color: 'mug', roughness: 0.25 },
  coffee: { color: 'coffee', roughness: 0.08 },
  wall: { color: 'wallBeige', roughness: 0.9, texture: 'wall', bump: 0.25 },
  wainscot: { color: 'wainscotMint', roughness: 0.55, texture: 'wall', bump: 0.2 },
  carpet: { color: 'carpet', roughness: 1, texture: 'carpet', bump: 1.5 },
  ceilingTile: { color: 'ceilingTile', roughness: 0.95, texture: 'carpet', bump: 0.8 },
  mousepad: { color: 'mousepad', roughness: 0.9, texture: 'fabric', bump: 0.5, repeat: [2, 2] },
  doormat: { color: 'doormat', roughness: 1, texture: 'carpet', bump: 2, repeat: [3, 2] },
  terracotta: { color: 'terracotta', roughness: 0.85, texture: 'plastic', bump: 0.3 },
  soil: { color: 'soilDark', roughness: 1, texture: 'carpet', bump: 2 },
  leaf: { color: 'plantGreen', roughness: 0.5, side: 'double' },
  leafDark: { color: 'leafDark', roughness: 0.5, side: 'double' },
  leafDying: { color: 'plantDying', roughness: 0.7, side: 'double' },
  paper: { color: 'paperWhite', roughness: 0.9 },
  phone: { color: 'deskPhone', roughness: 0.35, texture: 'plastic', bump: 0.1 },
  brass: { color: 'brassKnob', roughness: 0.3, metalness: 1 },
  gold: { color: 'chainGold', roughness: 0.22, metalness: 1 },
  umbrellaStand: { color: 'umbrellaStand', roughness: 0.4, metalness: 0.3 },
};
/** Each look of surface texture is generated once (canvas), then shared. */
const surfaceTextures = new Map();
function prepareData(tex, repeat) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = look.textureAnisotropy;
  tex.needsUpdate = true;
}
/** Smooth noise: a sum of `octaves` layers of interpolated random grids, tiling at n x n. */
function noiseField(n, cells, octaves, seed) {
  let a = seed >>> 0;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(n * n);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++, cells *= 2, amp *= 0.5) {
    const g = Array.from({ length: cells * cells }, rnd);
    const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, fy = (y / n) * cells, i = Math.floor(fx), j = Math.floor(fy);
      let u = fx - i, v = fy - j;
      u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
      const val = at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
      out[y * n + x] += val * amp;
    }
    total += amp;
  }
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}
function greyCanvas(n, f) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
  for (let k = 0; k < n * n; k++) { const v = Math.max(0, Math.min(255, Math.round(f(k % n, Math.floor(k / n), k) * 255))); img.data.set([v, v, v, 255], k * 4); }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
/**
 * Generated textures: { map (light/dark variation, multiplied by the surface's colour, so it's greyscale around
 * white), bump, rough }. Kinds: wood (grain), fabric (a weave), vinyl (a fine leather-like pebble), plastic (a
 * faint moulded texture), brushed (metal), carpet (loop pile).
 */
function surfaceTexture(kind) {
  if (surfaceTextures.has(kind)) return surfaceTextures.get(kind);
  const t = {};
  if (kind === 'wood') {
    // Straight grain along x: fine lines, gently wandering, in bands of lighter and darker wood
    const n = 512, warp = noiseField(n, 3, 2, 11), fine = noiseField(n, 96, 1, 12), band = noiseField(n, 2, 2, 13);
    const grain = (x, y, k) => { const v = Math.sin((y / n) * 420 + warp[k] * 9) * 0.5 + 0.5; return Math.pow(v, 6); };
    t.map = greyCanvas(n, (x, y, k) => 0.8 + 0.12 * band[k] - 0.14 * grain(x, y, k) + 0.05 * fine[k]);
    t.bump = greyCanvas(n, (x, y, k) => 0.6 - 0.3 * grain(x, y, k) + 0.1 * fine[k]);
  } else if (kind === 'fabric') {
    const n = 256, fuzz = noiseField(n, 64, 2, 21), slub = noiseField(n, 8, 2, 22);
    const weave = (x, y) => (((x >> 1) + (y >> 1)) % 2 ? Math.sin(((x % 2) + 0.5) * Math.PI) : Math.sin(((y % 2) + 0.5) * Math.PI));
    t.map = greyCanvas(n, (x, y, k) => 0.82 + 0.1 * weave(x, y) + 0.08 * slub[k] + 0.05 * fuzz[k]);
    t.bump = greyCanvas(n, (x, y, k) => 0.4 + 0.4 * weave(x, y) + 0.2 * fuzz[k]);
  } else if (kind === 'vinyl') {
    const n = 256, pebble = noiseField(n, 48, 2, 31), broad = noiseField(n, 6, 2, 32);
    t.map = greyCanvas(n, (x, y, k) => 0.9 + 0.1 * broad[k]);
    t.bump = greyCanvas(n, (x, y, k) => pebble[k]);
  } else if (kind === 'plastic') {
    const n = 256, f = noiseField(n, 96, 2, 41);
    t.bump = greyCanvas(n, (x, y, k) => f[k]);
  } else if (kind === 'brushed') {
    const n = 256, f = noiseField(n, 4, 2, 51);
    t.bump = greyCanvas(n, (x, y, k) => 0.5 + 0.5 * Math.sin(y * 2.3 + f[k] * 40) * 0.5);
  } else if (kind === 'carpet') {
    const n = 256, pile = noiseField(n, 128, 1, 61), tone = noiseField(n, 16, 3, 62);
    t.map = greyCanvas(n, (x, y, k) => 0.7 + 0.25 * pile[k] + 0.12 * tone[k]);
    t.bump = greyCanvas(n, (x, y, k) => pile[k]);
  } else if (kind === 'wall') {
    const n = 256, peel = noiseField(n, 64, 2, 71), tone = noiseField(n, 4, 3, 72);
    t.map = greyCanvas(n, (x, y, k) => 0.93 + 0.07 * tone[k]);
    t.bump = greyCanvas(n, (x, y, k) => peel[k]);
  }
  surfaceTextures.set(kind, t);
  return t;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------
function colorOf(name) {
  if (!(name in palette)) throw new Error(`theme: unknown palette colour "${name}"`);
  return palette[name];
}

let toonGradient = null;
function getToonGradient() {
  if (toonGradient) return toonGradient;
  toonGradient = new THREE.DataTexture(new Uint8Array(look.toonSteps), look.toonSteps.length, 1, THREE.RedFormat);
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}

const cache = new Map();
function cached(kind, color, opts, build) {
  const key = `${kind}|${color}|${opts.map?.uuid ?? ''}|${opts.transparent ?? ''}|${opts.opacity ?? ''}|${opts.side ?? ''}|${opts.polygonOffset ? opts.polygonOffsetFactor : ''}`;
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

export const theme = {
  palette,
  characterPalettes,
  look,
  lighting,

  /** Numeric colour for a palette name. */
  color: colorOf,

  /** CSS colour string for canvas drawing. alpha optional (0..1). */
  css(name, alpha = 1) {
    const c = new THREE.Color(colorOf(name));
    if (alpha >= 1) return '#' + c.getHexString();
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
  },

  /** Lit surface material. name = palette key, or a raw colour number from characterPalettes. */
  material(name, opts = {}) {
    const color = typeof name === 'number' ? name : colorOf(name);
    return cached('lit', color, opts, () => {
      const params = { color, ...opts };
      if (look.materialStyle === 'standard') return new THREE.MeshStandardMaterial({ roughness: look.standard.roughness, metalness: 0, ...params });
      return look.materialStyle === 'toon'
        ? new THREE.MeshToonMaterial({ ...params, gradientMap: getToonGradient() })
        : new THREE.MeshLambertMaterial(params);
    });
  },

  /**
   * A realistic surface (the room's props: src/level/props.js), by name from `surfaces`: its colour, how rough
   * or shiny it is, whether it's metal, and a generated texture (wood grain, fabric weave...). opts: extra
   * material settings, and `repeat` [u, v] for its texture.
   */
  surface(name, opts = {}) {
    const S = surfaces[name];
    if (!S) throw new Error(`theme: unknown surface "${name}"`);
    const { repeat = S.repeat ?? [1, 1], ...rest } = opts;
    const key = `surface|${name}|${repeat}|${JSON.stringify(rest)}`;
    if (cache.has(key)) return cache.get(key);
    const params = { color: colorOf(S.color), roughness: S.roughness ?? 0.8, metalness: S.metalness ?? 0, ...rest };
    if (S.transparent) Object.assign(params, { transparent: true, opacity: S.opacity ?? 0.5, depthWrite: false });
    if (S.side === 'double') params.side = THREE.DoubleSide;
    if (S.envMapIntensity !== undefined) params.envMapIntensity = S.envMapIntensity;
    if (S.emissive) Object.assign(params, { emissive: colorOf(S.emissive), emissiveIntensity: S.emissiveIntensity ?? 1 });
    if (S.texture) {
      const t = surfaceTexture(S.texture);
      if (t.map) { params.map = theme.prepareTexture(t.map.clone(), { repeat }); params.map.needsUpdate = true; }
      if (t.bump) { params.bumpMap = t.bump.clone(); params.bumpScale = S.bump ?? 1; prepareData(params.bumpMap, repeat); }
      if (t.rough) { params.roughnessMap = t.rough.clone(); prepareData(params.roughnessMap, repeat); }
    }
    const m = new THREE.MeshStandardMaterial(params);
    cache.set(key, m);
    return m;
  },

  /** Unlit material: screens, signs, light diffusers. */
  unlit(name, opts = {}) {
    const color = typeof name === 'number' ? name : colorOf(name);
    return cached('unlit', color, opts, () => new THREE.MeshBasicMaterial({ color, ...opts }));
  },

  /** Material showing a texture as-is. lit=false for screens and printed signs. */
  textured(map, { lit = false } = {}) {
    return lit ? theme.material('white', { map }) : theme.unlit('white', { map });
  },

  /** Configure a CanvasTexture (or other texture) according to the look settings. */
  prepareTexture(tex, { repeat = null } = {}) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = look.textureAnisotropy;
    if (look.textureFilter === 'nearest') {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestMipmapLinearFilter;
    }
    if (repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
    }
    return tex;
  },

  /** Build a texture by drawing into a 2D canvas. Draw with theme.css(name). */
  canvasTexture(w, h, draw, opts = {}) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return theme.prepareTexture(new THREE.CanvasTexture(c), opts);
  },

  /** Background, fog and renderer settings (tone mapping, reflections). */
  applyScene(scene, renderer) {
    scene.background = new THREE.Color(look.background);
    scene.fog = look.fog ? new THREE.Fog(look.fog.color, look.fog.near, look.fog.far) : null;
    if (renderer) {
      renderer.setClearColor(look.background);
      renderer.shadowMap.enabled = lighting.shadows;
      renderer.toneMapping = { none: THREE.NoToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping }[look.toneMapping] ?? THREE.NoToneMapping;
      renderer.toneMappingExposure = look.exposure ?? 1;
      if (look.environment && look.materialStyle === 'standard') {
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = look.environment.intensity;
        pmrem.dispose();
      }
    }
  },

  /**
   * How a frame is drawn: straight to the screen, or (look.ambientOcclusion) through post-processing that adds
   * contact shadows. Returns { render(), setSize(w, h) }. off: true skips the post-processing (?ao=0).
   */
  renderPipeline(renderer, scene, camera, { off = false } = {}) {
    const AO = look.ambientOcclusion;
    if (!AO?.enabled || off) return { render: () => renderer.render(scene, camera), setSize: () => {} };
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: AO.msaa ?? 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: AO.radius, distanceExponent: AO.distanceExponent, thickness: AO.thickness, scale: AO.scale, samples: AO.samples });
    gtao.blendIntensity = AO.blend ?? 1;
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
    return {
      render: () => composer.render(),
      setSize: (w, h) => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    };
  },

  /**
   * All scene lights. The level passes where its light fixtures are;
   * the theme decides what kind of light they emit.
   */
  setupLighting(scene, { ceilingFixtures = [], ceilingHeight = 3 } = {}) {
    const L = lighting;
    const lights = [];
    lights.push(new THREE.HemisphereLight(L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity));
    lights.push(new THREE.AmbientLight(L.ambient.color, L.ambient.intensity));
    const P = L.ceilingPanels;
    for (const f of ceilingFixtures) {
      const light = new THREE.PointLight(P.color, P.intensity, P.distance, P.decay);
      light.position.set(f.x, ceilingHeight - P.dropBelowCeiling, f.z);
      light.castShadow = L.shadows;
      lights.push(light);
    }
    for (const l of lights) scene.add(l);
    return lights;
  },

  /** Push UI colours into CSS custom properties. */
  applyUi(root = document.documentElement) {
    for (const [k, v] of Object.entries(ui)) root.style.setProperty(k, v);
  },
};
