# Character models (branch `realistic-receptionist` experiment; the whole cast: branch `realistic-characters`)

`mh-<id>.glb`: one per character (on this branch everyone but the gamer), built with MakeHuman (the MPFB add-on for Blender) from the recipes in
`tools/makehuman/recipes/` (see `tools/makehuman/README.md`). Rig: MPFB `game_engine` skeleton. Faces: ARKit-style
face units as morph targets, driven by the game's expression presets (`src/characters/realBody.js`).

All MakeHuman assets used are **CC0** (the `_cc0` asset packs and `faceunits01`), so no credits are required.
Textures are reduced to 1024 px with glTF-Transform.

With a realistic body, bruises, cuts and torn clothes (src/characters/damage.js) are skipped for now: they are drawn
on the primitive body, which is invisible.
