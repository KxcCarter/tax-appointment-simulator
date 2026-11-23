import * as THREE from 'three';

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
  white: 0xffffff,           // neutral base under textures

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
  shirts: [0xe8e2cf, 0x9fb4c8, 0xc8b48a, 0xd8a8a0, 0xa8c8a0, 0xf4f1e8],
  jackets: [0x5a4a3a, 0x3f4a5a, 0x6b7a3a, 0x7a3a2a, 0x8a7a5a, 0x4a4a48],
  trousers: [0x3b3b38, 0x4a3a2a, 0x2d3a4a, 0x6a5a44, 0x5a5a52],
  shoes: [0x1b1a18, 0x3b2a1a, 0x5a4022],
  ties: [0xb5332b, 0x2d4a6a, 0x6b7a3a, 0xa8822a],
  hats: [0x3b3b38, 0x5a4a3a, 0x7a2a3a, 0x2d4a6a],
  accessories: ['none', 'glasses', 'moustache', 'tie', 'briefcase'],
  hatStyles: ['none', 'fedora', 'cap'],
  receptionist: {
    skin: 0xe0ac85,
    hair: 0x8a3a1a,
    blouse: 0xd8a8a0,
    cardigan: 0x6b7a3a,
    skirt: 0x4a3a2a,
    glasses: 0x1b1a18,
    shoes: 0x3b2a1a,
  },
};

// ---------------------------------------------------------------------------
// Rendering look
// ---------------------------------------------------------------------------
export const look = {
  materialStyle: 'lambert',     // 'lambert' | 'toon'
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
  '--ticket-bg': '#f4f1e8',
  '--ticket-text': '#b5332b',
  '--ticket-edge': '#b5332b',
  '--font': '"Courier New", Courier, ui-monospace, Menlo, Consolas, monospace',
};

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
  const key = `${kind}|${color}|${opts.map?.uuid ?? ''}|${opts.transparent ?? ''}|${opts.opacity ?? ''}`;
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
      return look.materialStyle === 'toon'
        ? new THREE.MeshToonMaterial({ ...params, gradientMap: getToonGradient() })
        : new THREE.MeshLambertMaterial(params);
    });
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

  /** Background, fog and renderer settings. */
  applyScene(scene, renderer) {
    scene.background = new THREE.Color(look.background);
    scene.fog = look.fog ? new THREE.Fog(look.fog.color, look.fog.near, look.fog.far) : null;
    if (renderer) {
      renderer.setClearColor(look.background);
      renderer.shadowMap.enabled = lighting.shadows;
    }
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
