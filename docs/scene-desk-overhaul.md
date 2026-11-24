# Scene Desk overhaul: plan

`scene-desk.html` is the dialogue-scripting tool at the project root: open a beats file, edit the beats in a
form, see the flow map, play-test it, and save it back. This overhaul makes it match what the game can actually
do, and lets it edit all of the game's dialogue data, not just the receptionist's beats.

Each step is done in order and ticked off here when it's finished and tested.

## Goals
- Everything the director understands can be edited with proper fields (no raw code for normal actions).
- Names (animations, expressions, sounds, state keys, phases) come from the game itself, so the menus are
  never out of date and mistakes are caught.
- Any dialogue file can be edited: the receptionist's beats, the onlookers' scene, the small talk, the brawl
  shouts and the easter eggs.
- Saving round-trips exactly: a file opened and saved without edits comes back the same, and passes
  `npm run typecheck`.
- From the tool, one click to see the change in the game.

## Steps

### 1. The game's vocabulary
A single `VOCAB` object in the tool: action types and their fields, animation names (per actor kind), expression
presets, sound names, phases, and game-state keys.
- When the tool is served by the dev server (`npm run dev`, then `/scene-desk.html`), it reads them from the game:
  `src/director/types.ts` (action types, animations, expressions, sounds, phases), `src/state.js` (state keys) and
  the real `src/config.js` (expression presets; real numbers for the play test instead of guesses).
- Opened as a plain file, it falls back to a built-in copy of the same lists.
- The status bar says which one it's using.

- [x] Done

### 2. Every action type gets an editor
Today: `say`, `wait`, `anim`, `set`, `setPhase`, `if`. Added: `face` (who + expression menu), `sound` (sound menu +
optional who), `emit` (event name), `goto` (beat menu), `notice` (text + seconds).
- The "Add" row offers all of them.
- `anim` offers only the animations that actor understands (receptionist vs. waiting people).
- `set` offers the real state keys; its value is a plain value or code.
- `who` menus list the scene's speakers.

- [x] Done

### 3. Checks
New checks, alongside the existing "unreachable beat" and "broken reference" ones:
- unknown action type
- `who` that isn't a speaker in the scene
- unknown animation for that actor, unknown expression, unknown sound, unknown phase
- `set` on a key that isn't in the game state
- `goto` (option or action) to a beat that doesn't exist
- an option that does nothing (no `advance`, `goto`, `actions` or `response`), which leaves the player stuck
- a beat with no options

Clicking a check jumps to the beat (as now).

- [x] Done

### 4. Several scenes per file
A file can hold more than one scene (e.g. `onlookers` in `npcConversations.ts`). On open, the tool lists every
`export const name = {...}` it finds; a picker in the toolbar switches between them. Only the chosen one is
rewritten on save; everything else in the file is kept exactly as written.

- [x] Done

### 5. Lists mode: small talk, shouts, easter eggs
Exports that aren't scenes (no `beats`), such as `people` (small talk), `brawlShouts` and `roomRemarks`, open in a
simple **lists editor** instead of the beat editor:
- objects become sections, string fields become text boxes, arrays of lines become editable lists (add, remove,
  reorder), numbers stay numbers;
- `{ who, text }` lines (the easter eggs) get a speaker box;
- comments are kept, as with beats.

The flow map and play test are hidden in this mode; the Code tab and Checks (empty lines, duplicates) still work.

- [x] Done

### 6. Opening, saving, trying it in the game
- **Open from project** (dev server only): a menu of the game's dialogue files (`src/data/*.ts`); picking one loads
  it straight from the project, and **Save** writes it straight back. *(Changed while building: instead of asking
  where to save, a small dev-server helper in `vite.config.js` reads and writes files in `src/data/` only.)*
- **Try in game** (dev server only): saves, then opens the game in a new tab with chosen shortcuts (`?autostart`,
  `?fastwait`, `?brawl`). Vite reloads the game on save, so an open game tab picks the change up too.
- Fixes: the copy button shows the right extension (`Copy .ts`); hints and help text mention `.ts`.

- [x] Done

### 7. Testing
- Round-trip every dialogue file through the tool without edits: the game's data must be identical, and
  `npm run typecheck` must pass, for `waitingRoomBeats.ts`, `npcConversations.ts` (every export) and `roomRemarks.ts`.
- Headless smoke tests: add one of each action type and save; checks flag deliberate mistakes; the scene picker
  switches; lists mode edits a line; the play test runs; "Open from project" loads a file.
- The tool still opens and saves an old `.js` beats file.

- [x] Done

## Not changing
- The game's own code and data (except to fix anything the tests turn up).
- The play test's rules (it still approximates `director.js`).
- One file, no build step: the tool stays a single HTML file that also works opened directly.

## Done: what changed beyond the plan
- **Sequences** (action lists the game starts itself, like the call or the onlookers' outburst) are edited in Scene
  settings, with the same action editor and checks. A scene that only has sequences (e.g. `onlookers`) is not
  flagged for having no beats.
- The flow map and checks follow `goto` actions, including from sequences (no more false "nothing leads to …"
  for the pen beats).
- Values written as expressions on imports (`config.ticket.number + 1`, templates like `` `Number ${…}` ``) stay
  code, so saving no longer garbles them.
- Not covered: exports that are arrays rather than objects (e.g. `trespassLines` in `roomRemarks.ts`) are kept
  as written but can't be edited in the tool yet.

## How to use it
1. `npm run dev`, then open `http://localhost:5173/scene-desk.html` (opening the file directly also works, with
   built-in name lists and no project menu).
2. **Project file…** → pick a file in `src/data/`. If it has several exports, pick one in the menu next to it.
3. Scenes open in the beat editor (beats on the left, Scene settings for speakers and sequences); everything else
   opens in the lists editor (sections on the left).
4. **Save** is always there: it writes back to the project file the scene came from (a pasted scene or a draft kept
   in the browser is linked to the file that exports the same name), or to the file you opened; a brand-new scene
   gets **Save as…**. **Save** writes the file back; **Try in game** saves and opens the game (no title / short wait / brawl /
   title screen). **Checks** lists anything that won't work in the game.
