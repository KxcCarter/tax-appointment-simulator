# Building characters with MakeHuman (MPFB in Blender)

Branch `realistic-characters` experiment. Each character is a JSON recipe in `recipes/`; `build_human.py`
turns it into a rigged `.glb` (MPFB `game_engine` skeleton, ARKit-style face units as morph targets).

## Setup (once)
- Blender 4.5 LTS in /Applications.
- MPFB extension: `Blender --online-mode --command extension install --enable mpfb`
- MakeHuman asset packs (CC0) unzipped into MPFB's user data folder
  (`~/Library/Application Support/Blender/4.5/extensions/.user/blender_org/mpfb/data`):
  makehuman_system_assets, suits01, suits02, skirts01, dress01, shirts01, pants01, shoes01, hair01,
  hats01, glasses01, skins01, eyebrows01, eyelashes01, faceunits01. From https://static.makehumancommunity.org/assets/assetpacks.html
  (only the `_cc0` packs are used, so no credits are needed).

## Build one
```
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/makehuman/build_human.py -- \
  tools/makehuman/recipes/receptionist.json out/receptionist.glb out/receptionist_preview.png
```
Then shrink the textures (glTF-Transform): `gltf-transform resize in.glb out.glb --width 1024 --height 1024`
and put it in `src/models/characters/`, named in `theme.look.realistic.models`.

## Recipe fields
- `phenotype`: MakeHuman macros, 0..1: gender (0 female, 1 male), age (0.5 = 25 years, 1 = 90), muscle, weight,
  height, proportions, cupsize, firmness, race {african, caucasian, asian}.
- `targets`: extra shape tweaks, e.g. `{"target": "stomach-pregnant-incr", "value": 0.75}`
  (names from MPFB's data/targets folders).
- `skin`, `eyes`, `eyebrows`, `eyelashes`, `hair`, `clothes`: asset paths inside MPFB's data folders.
- `faceunits`: true = add the 52 ARKit face shapes (the game drives them from its expression presets).
- `cover_reach`: how far (m) above the skin clothing must be for the skin under it to be deleted (default 0.05).
- `clothes_masks`: false = ignore the clothes' own masks of the skin under them (drawn for an average body:
  on a much bigger one they cut holes past the clothes' edges) and delete only skin that clothing really covers.
- `cover_erode`: rings of skin kept round the edge of each deleted patch (0 = none), so the deleted patch's
  sawtooth edge stays hidden under the clothes.
- `moustache`: `{"color": [r, g, b], "width": 0.032, "top": 0.012, "bottom": 0.034, "thickness": 0.004}`: MakeHuman has
  no moustaches, so the skin under the nose (from `top` to `bottom` metres below the nose tip, `width` either side) is
  copied out from the face, thickened, coloured and bound to the head.
- `jiggle`: wobble bones for soft parts, e.g. `{"belly": {"radius": [0.3, 0.22, 0.2]}, "breasts": {...}, "chin": {...}}`.
  Each gets a bone at the part's centre (found from the dressed shape; `inset` = how far in from the surface, as a
  share of the depth radius) and the skin and clothes inside the ellipsoid `radius` (x across, y depth, z up, metres)
  blended onto it (up to `weight`). The game bounces them on a spring (`src/characters/realBody.js`).
- `poke_reach`: skin with clothing up to this far (m) *under* it pokes through the clothes and is deleted too (0 = off).
- `skirt_leg_keep`: how far up from a skirt's hem the leg skin under it is kept (1 = all the way, the default;
  e.g. 0.5 = the lower half). Kept skin shows when the skirt rides up seated; higher up, full thighs poke through.
- `tube_amount`: how much skirts and dresses follow both thighs equally (1 = a tube, the default; e.g. 0.5 =
  halfway, so a walking leg doesn't swing through the fabric, while seated it still doesn't split).
- `tube_clothes`: clothes that should move like a skirt (both thighs equally), for outfits whose skirt isn't a separate piece.
- `arm_skin`: true (the default) = the arm skin under sleeves is kept as a separate mesh, `<name>.armskin`, hidden in the
  game until a sleeve is ripped off (`src/characters/realDamage.js`).
- `cut`: `{"part of a garment's name": metres}`: the garment is sliced level that far above (or, negative, below) the
  knees and everything lower dropped, e.g. `{"cargo_pants": -0.03}` turns cargo trousers into knee-length shorts.
- `reverse`: `["part of a garment's name"]`: worn backwards (turned half round about the top of the head), e.g. a cap.
- `plain`: `{"part of a garment's name": {"color": [r, g, b], "name": "material name"}}`: its texture dropped (e.g.
  printing on it), one plain colour instead (tinted in the game).
- `coat`: a long coat generated from the body (MakeHuman's free clothes have none): `{"margin": 0.012, "cuff": 0.06,
  "hem": 0.0, "flare": 0.06, "v_depth": 0.06, "v_width": 0.085, "belt": 0.045}`. The top is the skin pushed out
  `margin` m past the outermost clothing, open in a V at the front (`v_depth` below the chest bone, `v_width` either
  side at the neck), with cuffs `cuff` m short of the wrists; a skirt hangs from the waist round both legs to `hem` m
  above the knees, flaring out `flare` m. Materials `coat` (a pale fabric texture to tint) and `coat_belt`.

The game adds a few things itself, from the figure's look (`src/characters/realExtras.js`): a wristwatch, headphones
round the neck, stubble, hairs on a built moustache, and glasses that can be knocked crooked. Ties printed in a suit's
texture are repainted in the figure's tie colour (`tie` in `theme.look.realistic.tint`).
- `neckline`: `{"part of a garment's name": {"depth": -0.05, "width": 0.11, "shape": 2.5}}`: a lower neckline cut
  into its front (clean edges), from `depth` m below the chest bone (negative: above it; the sitter's bust is above it)
  up to the base of the neck, `width` m either side there. `shape`: 1 = a V, higher = rounder (a scoop). The skin
  under it stays (the garment is cut before the skin it covers is worked out).
- `sleeveless`: `{"part of a garment's name": metres}`: its sleeves cut off, and the shoulders out past that far from
  the middle (a T-shirt into a tank top).
