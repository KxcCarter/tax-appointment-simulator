/*
  The five people already waiting. Fixed cast (owner's decision): always the same.
    look         key into theme.characterPalettes.cast (their appearance)
    seat         index into the room's chairs: 0-4 west row (north to south), 5-9 east row
    personality  idle behaviour, see src/characters/npc.js
    expression   resting face (config.characters.expressions)
  Free seats for the player: 1, 4, 5, 7, 9 (1 is wedged between the watch-checker and the cougher).
*/
export const waitingRoomCast = [
  { id: 'watchChecker', look: 'watchChecker', seat: 0, personality: 'watchChecker', expression: 'bored', props: ['briefcase'] },
  { id: 'cougher',      look: 'cougher',      seat: 2, personality: 'cougher',      expression: 'bored' },
  { id: 'sitter',       look: 'sitter',       seat: 3, personality: 'sitter',       expression: 'sultry' },
  { id: 'jiggler',      look: 'jiggler',      seat: 6, personality: 'jiggler',      expression: 'annoyed' },
  { id: 'reader',       look: 'reader',       seat: 8, personality: 'reader',       expression: 'bored', props: ['magazine'] },
];

/*
  The gamer (owner's character): walks in at config.gamer.at seconds of play, straight past the ticket
  dispenser, and sits in the first free chair of config.gamer.seatPreference. Chips and an energy drink.
*/
export const gamer = { id: 'gamer', look: 'gamer', personality: 'gamer', expression: 'bored', props: ['chips', 'energyDrink'] };
