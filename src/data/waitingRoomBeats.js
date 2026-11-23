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

// The time on the wall clock, as the player would read it: "1:57"
const clockReading = (state) => {
  const t = Math.floor(state.clockTime / 60) % 720;
  const h = Math.floor(t / 60) || 12;
  return `${h}:${String(t % 60).padStart(2, '0')}`;
};
// The appointment, in clock minutes (config.appointment). The player reads whole minutes,
// so "on time" means the clock READS between 2:00 and 2:02.
const AP = config.appointment;
const clockMinute = (state) => Math.floor(state.clockTime / 60) % 720;
const apptMinute = (AP.hour % 12) * 60 + AP.minute;
const beforeAppointment = (state) => clockMinute(state) < apptMinute;
const late = (state) => clockMinute(state) > apptMinute + AP.onTimeMinutes;
const clockReadsTwo = (state) => clockMinute(state) === apptMinute;
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

  // Sequences the game starts itself (director.play(name)).
  sequences: {
    // The wait is over (config.timings.waiting.duration after the "waiting" phase begins).
    // Proposal from the brief; the wording is easy to change.
    call: [
      { do: 'goto', beat: null },  // whatever stage the reception exchange reached, it's over
      { do: 'wait', seconds: config.timings.call.pauseBeforeLine },
      { do: 'say', who: 'receptionist', text: "Eight hundred forty-seven. He'll see you now." },
      { do: 'set', key: 'nowServing', value: config.ticket.number }, // display jumps, chimes
      { do: 'set', key: 'called', value: true },                     // every head turns to the player
    ],
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
      next: 'protest',
      nextUnlockAfter: 0,
    },

    // ---- Optional: the player objects. Choices open right after "Take a number...". ----
    {
      id: 'protest',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'But I have an appointment at 2.',
          goto: 'what_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'What time is it now?' },
          ],
        },
        { text: '(Say nothing)', silent: true, goto: null },
      ],
      lockedOptions: [],
    },
    {
      id: 'what_time',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          // Read off the wall clock at the moment the choices appear
          text: (state) => `It's ${clockReading(state)}.`,
          showIf: (state) => !clockReadsTwo(state), // at exactly 2:00, "It's 2:00." below is the true answer
          goto: 'appointment_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'And what time is your appointment?' },
          ],
        },
        {
          text: "It's 2:00.",
          // Untrue: she isn't having it and the question stands. True (clock reads 2:00): accepted.
          goto: (state) => (clockReadsTwo(state) ? 'appointment_time' : 'what_time'),
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            {
              do: 'if',
              test: clockReadsTwo,
              then: [{ do: 'say', who: 'receptionist', text: 'And what time is your appointment?' }],
              else: [{ do: 'say', who: 'receptionist', text: "No it's not." }],
            },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      id: 'appointment_time',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'My appointment is at 2:00.',
          goto: null, // end of the exchange
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            {
              do: 'if',
              test: late, // the clock runs in real time; 2:03 or later is late
              then: [
                { do: 'say', who: 'receptionist', text: "You're late. You'll have to take a number and have a seat." },
              ],
              else: [
                {
                  do: 'if',
                  test: beforeAppointment,
                  then: [
                    { do: 'say', who: 'receptionist', text: "Well it's not 2:00 yet, is it?" },
                    { do: 'wait', seconds: T.sideOptionPause },
                    { do: 'say', who: 'receptionist', text: 'Take a seat and wait.' },
                  ],
                  // On time (2:00-2:02): the check-in sheet. She doesn't look up.
                  else: [
                    { do: 'say', who: 'receptionist', text: 'Did you sign the check-in sheet?' },
                    { do: 'anim', who: 'receptionist', name: 'slideClipboard', duration: T.clipboardSlide },
                    { do: 'set', key: 'clipboardOffered', value: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
      lockedOptions: [],
    },
  ],
};
