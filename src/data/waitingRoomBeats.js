import { config } from '../config.js';

/*
  The Waiting Room, as data. Edit lines and order here; edit timings in config.js.
  See src/director/director.js for every field and action this supports.

  lockedOptions: what the player can say while the receptionist is still ignoring
  them (the 10–15 s gate). Empty = no options appear at all (owner's decision).
  Recorded lines can be added here later.
*/

const T = config.timings.reception;

// Non-advancing options get silence or a flat reply. Near-duplicates are the joke.
const silence = [];
const flat = (text) => [
  { do: 'wait', seconds: T.sideOptionPause },
  { do: 'say', who: 'receptionist', text },
];

export const waitingRoomBeats = {
  start: 'reception_1',

  // Anything the director answers for, even once the beats are used up
  targets: ['receptionist'],

  speakers: {
    player: { name: 'YOU', pitch: config.characters.playerVoicePitch },
    receptionist: { name: 'RECEPTIONIST', pitch: config.characters.receptionist.voicePitch, actor: 'receptionist' },
  },

  beats: [
    {
      id: 'reception_1',
      trigger: { type: 'interact', target: 'receptionist' },
      onOpen: [{ do: 'setPhase', phase: 'reception' }],
      options: [
        { text: "I'm here for my appointment.", advance: true },
        { text: 'Hello?', response: silence },
        { text: 'Excuse me.', response: silence },
        { text: '(Say nothing)', silent: true, response: silence },
      ],
      lockedOptions: [],
      onAdvance: [
        // She looks at you. Two seconds. Nothing. Back to the cards.
        { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: T.glanceDuration },
        { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
      ],
      next: 'reception_2',
      nextUnlockAfter: T.gate,
    },
    {
      id: 'reception_2',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        { text: "I'm here for my appointment.", advance: true },
        { text: "Excuse me. I'm here for my appointment?", response: flat('Mm.') },
        { text: 'Hello?', response: silence },
        { text: '(Say nothing)', silent: true, response: silence },
      ],
      lockedOptions: [],
      onAdvance: [
        { do: 'wait', seconds: T.beat2IgnoreBeforeLine }, // clicks continue
        { do: 'say', who: 'receptionist', text: "Sshhh, momma's got to play her game." },
      ],
      next: 'reception_3',
      nextUnlockAfter: T.gate,
    },
    {
      id: 'reception_3',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        { text: "I'm here for my appointment.", response: silence },
        { text: "I'm here for my appointment at 2:00 PM.", advance: true },
        { text: "I'm here for my 2:00 PM appointment.", response: silence },
        { text: '(Say nothing)', silent: true, response: silence },
      ],
      lockedOptions: [],
      onAdvance: [
        { do: 'wait', seconds: T.beat3PauseBeforeLine },
        { do: 'say', who: 'receptionist', text: 'Take a number and have a seat.' },
        { do: 'set', key: 'toldToTakeNumber', value: true },
      ],
      next: null,
      nextUnlockAfter: 0,
    },
  ],
};
