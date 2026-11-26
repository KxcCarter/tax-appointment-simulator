# TODO

## Realistic characters (branch `realistic-receptionist`)
- [x] Ripped-off sleeves on realistic models: the build keeps the arm skin under the sleeves (`armskin`); a rip removes that sleeve and shows the bare arm (`realDamage.js` `_ripSleeve`).
- [x] Crooked glasses on realistic models: the model's glasses hang rigidly on the head bone and the first blow to the head tilts them (the second still knocks them off).
- [x] The man with the briefcase's wristwatch: added in the game, on his left wrist just past the cuff (`realExtras.js`).
- [x] Ties repainted in each figure's tie colour (`tie` in `theme.look.realistic.tint`).
- [x] The newcomer: redesigned by the owner as a "bro" (the trench coat was dropped): a tank top (a T-shirt with its sleeves cut off: recipe `sleeveless`), navy cargo shorts, sunglasses and a gold chain. (The build's `coat` option is still there.)
- [x] The older man's moustache has hairs (drawn in its shader) and a smooth outline.
- [x] The gamer's headphones round his neck and his stubble (`realExtras.js`).
- [x] The gamer's baseball cap on backwards (MakeHuman's baseball cap, its printing removed, turned round: recipe `reverse`, `plain`) and knee-length cargo shorts (cargo trousers cut off at the knee: recipe `cut`).

## Cartoon figures
- [x] The receptionist's name badge, "D'ar-Tanyuh", on her cartoon figure too (`look.badge` in `src/characters/rig.js`: pinned on her cardigan on her left, above the bust; the realistic model's is `addBadge` in `src/characters/realExtras.js`). The name is `characterPalettes.receptionist.badge` in `theme.js`, the colours `badgePlate`, `badgeText`, `badgeEdge`.
- [x] Torn clothes and ripped-off sleeves show skin on the cartoon figures too (`src/characters/damage.js`), as on the realistic models.
