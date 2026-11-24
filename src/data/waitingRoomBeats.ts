import { config } from '../config.js';
import type { Action, GameState, Scene } from '../director/types.ts';

/*
  The Waiting Room, as data. Edit lines and order here; edit timings in config.js.
  See src/director/types.ts for every field and action this supports
  (`npm run typecheck` checks this file against it).

  lockedOptions: what the player can say while the receptionist is still ignoring
  them (the 10–15 s gate). Empty = no options appear at all (owner's decision).
  Recorded lines can be added here later.
*/

const T = config.timings.reception;

// Non-advancing options get silence or a flat reply. Near-duplicates are the joke.
const silence: Action[] = [];

// The time on the wall clock, as the player would read it: "1:57"
const clockReading = (state: GameState): string => {
  const t = Math.floor(state.clockTime / 60) % 720;
  const h = Math.floor(t / 60) || 12;
  return `${h}:${String(t % 60).padStart(2, '0')}`;
};
// The appointment, in clock minutes (config.appointment). The player reads whole minutes,
// so "on time" means the clock READS between 2:00 and 2:02.
const AP = config.appointment;
const clockMinute = (state: GameState): number => Math.floor(state.clockTime / 60) % 720;
const apptMinute = (AP.hour % 12) * 60 + AP.minute;
const beforeAppointment = (state: GameState): boolean => clockMinute(state) < apptMinute;
const late = (state: GameState): boolean => clockMinute(state) > apptMinute + AP.onTimeMinutes;
const clockReadsTwo = (state: GameState): boolean => clockMinute(state) === apptMinute;
const onTime = (state: GameState): boolean => !beforeAppointment(state) && !late(state);

// On time (2:00-2:02), first the check-in runaround: "Did you check in already?" (beats checkin_already,
// checkin_how, checkin_how_again, checkin_can_i). Only at the end does she ask about the sheet.
const askCheckedIn: Action[] = [
  { do: 'say', who: 'receptionist', text: 'Did you check in already?' },
  { do: 'set', key: 'checkInAsked', value: true },
];
// "Did you sign the check-in sheet?": she slides the clipboard over without looking up.
const checkInSheet: Action[] = [
  { do: 'say', who: 'receptionist', text: 'Did you sign the check-in sheet?' },
  { do: 'anim', who: 'receptionist', name: 'slideClipboard', duration: T.clipboardSlide },
  { do: 'set', key: 'clipboardOffered', value: true },
];
const flat = (text: string): Action[] => [
  { do: 'wait', seconds: T.sideOptionPause },
  { do: 'say', who: 'receptionist', text },
];

export const waitingRoomBeats: Scene = {
  start: 'reception_1',

  // Anything the director answers for, even once the beats are used up
  targets: ['receptionist'],

  speakers: {
    player: { name: 'YOU', pitch: config.characters.playerVoicePitch },
    receptionist: { name: 'RECEPTIONIST', pitch: config.characters.receptionist.voicePitch, actor: 'receptionist' },
  },

  // Sequences the game starts itself (director.play(name)).
  sequences: {
    // The player tries to sign the check-in sheet on the counter
    signSheet: [
      { do: 'notice', text: "You don't have a pen." },
      {
        do: 'if',
        test: (state: GameState) => !state.needsPen,
        then: [
          { do: 'set', key: 'needsPen', value: true },
          { do: 'goto', beat: 'pen_request' }, // now the player can ask her for one
        ],
      },
    ],
    // The wait is over (config.timings.waiting.duration after the "waiting" phase begins).
    // Proposal from the brief; the wording is easy to change.
    call: [
      { do: 'goto', beat: null }, // whatever stage the reception exchange reached, it's over
      { do: 'wait', seconds: config.timings.call.pauseBeforeLine },
      { do: 'say', who: 'receptionist', text: "Eight hundred forty-seven. He'll see you now." },
      { do: 'set', key: 'nowServing', value: config.ticket.number }, // display jumps, chimes
      { do: 'set', key: 'called', value: true }, // every head turns to the player
    ],
  },

  beats: [
    {
      id: 'reception_1',
      trigger: { type: 'interact', target: 'receptionist' },
      onOpen: [{ do: 'setPhase', phase: 'reception' }],
      options: [
        { text: "I'm here for my appointment.", advance: true },
        { text: 'Excuse me.', response: silence },
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
        { text: "Excuse me. I'm here for my appointment?", response: flat('Mmhmm.') },
        { text: 'Hello?', response: silence },
      ],
      lockedOptions: [],
      onAdvance: [
        { do: 'wait', seconds: T.beat2IgnoreBeforeLine }, // clicks continue
        { do: 'say', who: 'receptionist', text: "Shhh, momma's gotta play her game." },
      ],
      next: 'reception_3',
      nextUnlockAfter: T.gate,
    },
    {
      id: 'reception_3',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        { text: "I'm here for my appointment.", response: flat("Oooo, look at them cards go, yeah baby!") },
        { text: 'I have an appointment at 2:00 PM.', advance: true },
        { text: "I'm here for my 2:00 PM appointment.", response: flat("Mamma's playin' her game.") },
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
          text: 'I already have an appointment at 2.',
          goto: 'what_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'What time is it now?' },
          ],
        },
        // Letting it go isn't final: she can be asked again later (protest_again)
        { text: 'Okay.', silent: true, goto: 'protest_again' },
      ],
      lockedOptions: [],
    },
    {
      // The same objection, raised again later by walking up and pressing E (no auto-open).
      // Reached after "(Say nothing)" or "...Take a seat and wait.", so the player can come
      // back once the clock reads 2:00.
      id: 'protest_again',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'But I have an appointment at 2.',
          goto: 'what_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'What time is it now?' },
          ],
        },
        { text: '(Say nothing)', silent: true, goto: 'protest_again' },
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
          text: (state: GameState) => `It's ${clockReading(state)}.`,
          showIf: (state: GameState) => !clockReadsTwo(state), // at exactly 2:00, "It's 2:00." below is the true answer
          goto: 'appointment_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'And what time is your appointment?' },
          ],
        },
        {
          text: "It's 2 o'clock.",
          // Untrue: she isn't having it and the question stands. True (clock reads 2:00): accepted.
          goto: (state: GameState) => (clockReadsTwo(state) ? 'appointment_time' : 'what_time'),
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            {
              do: 'if',
              test: clockReadsTwo,
              then: [{ do: 'say', who: 'receptionist', text: 'And what time is your appointment?' }],
              // Untrue: a glance over her shoulder at the wall clock first
              else: [
                { do: 'anim', who: 'receptionist', name: 'glanceAtClock', duration: T.clockGlance },
                { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
                { do: 'say', who: 'receptionist', text: "No it's not." },
              ],
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
          // On time: "Did you check in already?" (checkin_already). Early ("not 2:00 yet"): she can be asked again later.
          // Late: the exchange is over.
          goto: (state: GameState) => (state.checkInAsked ? 'checkin_already' : late(state) ? null : 'protest_again'),
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            {
              do: 'if',
              test: late, // the clock runs in real time; 2:03 or later is late
              then: [
                { do: 'anim', who: 'receptionist', name: 'glanceAtClock', duration: T.clockGlance },
                { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
                { do: 'say', who: 'receptionist', text: "You're late. You'll have to take a number and have a seat." },
              ],
              else: [
                {
                  do: 'if',
                  test: beforeAppointment,
                  then: [
                    { do: 'anim', who: 'receptionist', name: 'glanceAtClock', duration: T.clockGlance },
                    { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
                    { do: 'say', who: 'receptionist', text: "Well it's not 2:00 yet, is it?" },
                    { do: 'wait', seconds: T.sideOptionPause },
                    { do: 'say', who: 'receptionist', text: 'Take a seat and wait.' },
                  ],
                  else: askCheckedIn, // on time (2:00-2:02)
                },
              ],
            },
          ],
        },
        {
          text: 'My appointment is right now.',
          // Unless it really is 2:00-2:02, she has no appointment at whatever time it is,
          // and the question stands. (On time it's the check-in sheet, as above.)
          goto: (state: GameState) => (state.checkInAsked ? 'checkin_already' : 'appointment_time'),
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            {
              do: 'if',
              test: onTime,
              then: askCheckedIn,
              else: [
                {
                  do: 'say',
                  who: 'receptionist',
                  text: (state: GameState) => `We don't have any appointments scheduled for ${clockReading(state)}.`,
                },
              ],
            },
          ],
        },
      ],
      lockedOptions: [],
    },
    // ---- The check-in runaround (owner's design). On time, she asked "Did you check in already?" ----
    {
      id: 'checkin_already',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true, // she just asked a question: answer right away
      options: [
        {
          text: 'No.',
          goto: 'checkin_how', // the box closes; press E again
          actions: [{ do: 'wait', seconds: T.sideOptionPause }, { do: 'say', who: 'receptionist', text: 'You gotta check in first.' }],
        },
        {
          text: "That's what I'm trying to do right now.",
          goto: 'checkin_how',
          actions: [{ do: 'wait', seconds: T.sideOptionPause }, { do: 'say', who: 'receptionist', text: 'You gotta check in first.' }],
        },
      ],
      lockedOptions: [],
    },
    {
      // Not autoOpen: the player has to walk up and press E again
      id: 'checkin_how',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'How do I check in?',
          goto: 'checkin_how_again',
          actions: [{ do: 'wait', seconds: T.beat2IgnoreBeforeLine }, { do: 'say', who: 'receptionist', text: 'Ooo, look at them cards fly, hoo hoo!' }],
        },
        {
          text: 'Can you check me in, please?',
          goto: 'checkin_how_again',
          actions: [{ do: 'wait', seconds: T.beat2IgnoreBeforeLine }, { do: 'say', who: 'receptionist', text: 'Ooo, look at them cards fly, hoo hoo!' }],
        },
      ],
      lockedOptions: [],
    },
    {
      // She ignored that; the same two questions come straight back
      id: 'checkin_how_again',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'How do I check in?',
          goto: 'checkin_can_i',
          unlockAfter: T.newGameWait, // she starts a new game: nothing for about 10 s
          actions: [{ do: 'wait', seconds: T.sideOptionPause }, { do: 'say', who: 'receptionist', text: 'You gotta sign the check-in sheet.' }],
        },
        {
          text: 'Can you check me in, please?',
          goto: 'checkin_can_i',
          unlockAfter: T.newGameWait,
          actions: [{ do: 'wait', seconds: T.sideOptionPause }, { do: 'say', who: 'receptionist', text: 'You gotta sign the check-in sheet.' }],
        },
      ],
      lockedOptions: [],
    },
    {
      // Locked for config.timings.reception.newGameWait; pressing E before then gets brushed off
      id: 'checkin_can_i',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'Can I check in for my appointment, please?',
          goto: 'checkin_sheet',
          // Only the question: she doesn't hand the sheet over yet
          actions: [{ do: 'wait', seconds: T.beat3PauseBeforeLine }, { do: 'say', who: 'receptionist', text: 'Did you sign the check-in sheet?' }],
        },
      ],
      lockedOptions: [],
      lockedResponse: [{ do: 'say', who: 'receptionist', text: 'Hold up, momma gotta start a new game...' }],
    },
    {
      id: 'checkin_sheet',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true, // she just asked a question: answer right away
      options: [
        {
          text: 'No.',
          goto: 'checkin_okay',
          actions: [
            { do: 'wait', seconds: T.sideOptionPause },
            { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: 0.6 }, // she turns and looks at him
            { do: 'say', who: 'receptionist', text: "You can't go to your appointment until you check in." },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      id: 'checkin_okay',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'Okay, so can I check in now?',
          goto: 'checkin_please', // the box closes; press E again
          actions: [
            { do: 'wait', seconds: T.sideOptionPause },
            { do: 'say', who: 'receptionist', text: 'Gotta sign the sheet.' },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' }, // back to her game
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      // Not autoOpen: the player has to walk up and press E again
      id: 'checkin_please',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'Please, can you just sign me in?',
          goto: 'checkin_offered',
          actions: [{ do: 'wait', seconds: T.beat3PauseBeforeLine }, ...checkInSheet], // "Did you sign the check-in sheet?" + the clipboard
        },
      ],
      lockedOptions: [],
    },
    {
      // The clipboard is on the counter now (sign it: sequences.signSheet -> the pen)
      id: 'checkin_offered',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'No.',
          actions: [],
          response: [
            { do: 'say', who: 'receptionist', text: ['Everybody gotta sign the check-in sheet. Did you sign it?', "Did you sign the check-in sheet?"] },
          ],
        },
      ],
      lockedOptions: [],
    },

    // ---- No pen. (Signing the sheet sends the exchange here; see sequences.signSheet.) ----
    {
      id: 'pen_request',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'Do you have a pen?',
          goto: 'pen_borrow',
          actions: [
            // She ignores the question entirely
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'Mamma gotta get her some coffee...' },
            { do: 'anim', who: 'receptionist', name: 'coffeeBreak', untilDone: true }, // ~30 s away
            { do: 'set', key: 'hadCoffee', value: true },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      id: 'pen_borrow',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'Do you have a pen I can borrow?',
          // The second "No." is followed by calling the next number: the exchange is over
          goto: (state: GameState) => (state.penRefusals >= 2 ? null : 'how_check_in'),
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'No.' },
            { do: 'set', key: 'penRefusals', value: (state: GameState) => state.penRefusals + 1 },
            {
              do: 'if',
              test: (state: GameState) => state.penRefusals === 2,
              then: [
                { do: 'wait', seconds: T.sideOptionPause },
                {
                  do: 'say',
                  who: 'receptionist',
                  text: `Number ${config.ticket.number + 1}! Our 2:00 was a no-show so you can go on ahead.`,
                },
                { do: 'set', key: 'nowServing', value: config.ticket.number + 1 }, // display chimes, jumps
              ],
            },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      id: 'how_check_in',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'How am I supposed to check in for my appointment then?',
          goto: 'online_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'You can check-in online. What time is your appointment?' },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      id: 'online_time',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: '2:00.',
          goto: 'pen_borrow',
          actions: [
            { do: 'anim', who: 'receptionist', name: 'glanceAtClock', duration: T.clockGlance },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
            { do: 'wait', seconds: 0.8 },
            { do: 'anim', who: 'receptionist', name: 'sipCoffee', duration: T.coffeeSip },
            { do: 'wait', seconds: 0.4 },
            {
              do: 'say',
              who: 'receptionist',
              text: "You're late for your appointment so the system won't let you sign in online, you're gonna have to fill in the check-in sheet.",
            },
          ],
        },
        {
          text: "It's supposed to be right now.",
          goto: 'pen_borrow',
          actions: [
            { do: 'anim', who: 'receptionist', name: 'glanceAtClock', duration: T.clockGlance },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
            { do: 'wait', seconds: 0.8 },
            { do: 'anim', who: 'receptionist', name: 'sipCoffee', duration: T.coffeeSip },
            { do: 'wait', seconds: 0.4 },
            {
              do: 'say',
              who: 'receptionist',
              text: "You're late for your appointment so the system won't let you sign in online, you're gonna have to fill in the check-in sheet.",
            },
          ],
        },
      ],
      lockedOptions: [],
    },
  ],
};
