# Character models (branch `realistic-receptionist` experiment; the whole cast: branch `realistic-characters`)

`mh-<id>.glb`: one per character (on this branch the whole cast), built with MakeHuman (the MPFB add-on for Blender) from the recipes in
`tools/makehuman/recipes/` (see `tools/makehuman/README.md`). Rig: MPFB `game_engine` skeleton. Faces: ARKit-style
face units as morph targets, driven by the game's expression presets (`src/characters/realBody.js`).

All MakeHuman assets used are **CC0** (the `_cc0` asset packs and `faceunits01`), so no credits are required.
Textures are reduced to 1024 px with glTF-Transform.

Damage on a realistic body (bruises, black eyes, cuts that bleed, a nosebleed, a split lip, torn clothes) is painted into the
model's own textures: src/characters/realDamage.js (same order and amounts as damage.js, config.damage). Knocked-off hats and
glasses: the model's own vanish and the figure's flies off in their place.
