# Scene Desk: to do

Improvements found by reviewing `scene-desk.html` against the game's director (`src/director/director.js`).
Proposals, most important first; nothing here is built yet. See also `docs/scene-desk-overhaul.md` (what's done).

## 1. The play test is out of step with the game
Each of these makes a scene play one way in the Scene Desk and another way in the game.

- [ ] **Beats whose [E] belongs to two characters** (`trigger.target: ['receptionist', 'reader']`, e.g. `argument_4`,
  `argument_5`): `ptTalk` compares the target with `!==`, so talking to the receptionist says "doesn't respond" and
  you can't get past them. Treat the target as one name or a list, like `director.targets()`.
- [ ] **Beats that open by themselves** (`autoOpen`) don't: you have to click Talk every time. In the game their
  choices appear as soon as the beat becomes current (after a `goto`, `advance`, or the end of `onAdvance`).
- [ ] **`set` with a computed value** (e.g. `value: (state) => ({ ...state.asked, 'receptionist.pencil': true })`,
  `penRefusals + 1`): the play test stores the function itself instead of its result, so later "show only if"
  conditions go wrong. The director calls it: `typeof a.value === 'function' ? a.value(state) : a.value`.
- [ ] **The game state starts almost empty** (just the clock and the phase): conditions such as
  `state.asked['receptionist.pencil']` throw and hide options the game would show. Start from the defaults in
  `src/state.js` (the tool already reads its keys).
- [ ] **`goto` actions aren't simulated**, so sequences that jump to a beat (`signSheet` → `pen_request`) do nothing.
  Also simulate `notice` (show it), and show `face` and `emit` in the log.
- [ ] **No way to do what the player does in the room**: using the clipboard (`signSheet`), the coffee break,
  848 being called. You can't get past `checkin_offered`. Add a button per sequence ("Run signSheet").
- [ ] **`actions` on a reply-only option** (no `advance`/`goto`): the play test runs them, the game ignores them
  (it only runs `response`). Match the game.

## 2. New checks (the mistakes found by hand so far)
- [ ] **`response` on an option that moves on is never said.** With `goto` or `advance` the game ignores `response`
  (it runs `actions`). This silently dropped the "Are you telling me you don't have any pens…?" reply, and the first
  version of `argument_2_checkin`'s.
- [ ] **`actions` on a reply-only option are ignored**: the same rule, the other way round.
- [ ] **A condition reads a state key nothing sets** (`showIf` / `if` tests): e.g. `askedForPen`, read by
  "Are you telling me…?" but never set, so the line never appeared.
- [ ] **Beats offering only one choice**: the list asked for by the owner, kept up to date while editing
  (counting conditional options: "single once the check-in pleas are used up", etc.).
- [ ] **Routes that can end the conversation for good**, including code-decided gotos that can return `null`
  (the late-player dead end was one of these and wasn't visible on the flow map).
- [ ] **The same player line in two places**, e.g. "I've been trying to check in since I got here!"
  (`argument_2_checkin` and `fighting_words`).
- [ ] **Lines with no recording**: read each character's `src/audio/voice/<who>/lines.json` (dev server) and mark
  lines that will play as blips, including lines whose recording no longer matches because the text was edited.
  For the receptionist and the reader (the owner records them by hand), say "for you to record".

## 3. Aggression (Option.aggression: 0 polite, 1 curt, 2 rude, 3 hostile)
The tone menu on each option is built; the rest isn't.
- [ ] **Colour by tone**: option cards and the flow map's arrows, so the rude routes are easy to see.
- [ ] **Ready-made conditions** in the condition menu: "the player was rude" (`lastAggression >= 2`) and
  "temper ≥ N", instead of writing code.
- [ ] **In the play test**: `temper` and `lastAggression` in the state panel (needs the state to start from
  `src/state.js`, section 1), and picking an option updates them as the director does.
- [ ] **"+ rude version" button** on an option: copies it with tone "rude" and the same outcome, ready to reword
  (how the aggressive argument lines were made).

## 4. Working faster
- [ ] **Try in game from this beat**: open the game with `?beat=<selected beat>` (the game already skips there).
- [ ] **Search every line** across all the dialogue files, and jump to it.
- [ ] **Flow map**: highlight the route from the start to the selected beat; mark single-choice beats.
- [ ] **Edit list-shaped exports**, e.g. `trespassLines` in `roomRemarks.ts` (noted as not covered in the overhaul).

## Suggested order
Sections 1 and 2 first (mostly small fixes, and they'd have caught every dialogue bug found by hand), then the
tone colours and ready-made conditions from section 3.
