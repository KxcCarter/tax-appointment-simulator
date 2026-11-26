import { config } from '../config.js';
import type { Action, GameState, Option, Scene } from '../director/types.ts';

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
// Whole minutes since the player walked in (the clock read 1:55:00 then)
const arrivedAt = config.clock.startHour * 3600 + config.clock.startMinute * 60 + config.clock.startSecond;
const minutesHere = (state: GameState): number => Math.max(0, Math.floor((state.clockTime - arrivedAt) / 60));
const pause: Action = { do: 'wait', seconds: T.sideOptionPause };

// Told to take a number when he already has one (owner's request). Her reply is a PROPOSAL.
const alreadyHaveTicket = (state: GameState): boolean => state.ticketNumber != null;
const alreadyTookTicket: Option = {
  text: 'I already took a ticket.',
  showIf: alreadyHaveTicket,
  response: [pause, { do: 'say', who: 'receptionist', text: 'Then have a seat.' }],
};

// During the argument he can turn to the receptionist at any point (owner's design). Each line is offered
// once; together they end with her sending the newcomer in.
const pleaCheckIn: Option = {
  text: 'Please, can I just check in for my appointment?',
  showIf: (state: GameState) => !state.checkInPleaded,
  response: [
    pause,
    { do: 'say', who: 'receptionist', text: "You can if you go find a pen. Otherwise you just gon' have to wait till tomorrow." },
    { do: 'notice', text: 'Go look for a pen', seconds: 3 },
    { do: 'set', key: 'checkInPleaded', value: true },
  ],
};
const pleaLetMeIn: Option = {
  text: "But I'm already here! Can't you just let me in?",
  showIf: (state: GameState) => state.checkInPleaded && !state.newcomerSentIn,
  response: [
    pause,
    { do: 'say', who: 'receptionist', text: 'Everybody gotta sign the check-in sheet. Number 848, you can go on in.' },
    { do: 'set', key: 'newcomerSentIn', value: true },
  ],
};
// ...then (owner's lines): "He didn't sign the check-in sheet!" -> walk-ins don't -> "But you said everyone..."
const pleaWalkIn: Option = {
  text: "Wait a minute! He didn't sign the check-in sheet!",
  aggression: 1,
  showIf: (state: GameState) => state.newcomerSentIn && !state.walkInExplained,
  response: [
    pause,
    { do: 'say', who: 'receptionist', text: "He was a walk-in. Walk-ins don't sign the check-in sheet." },
    { do: 'set', key: 'walkInExplained', value: true },
  ],
};
const pleaEveryone: Option = {
  text: 'But you said everyone has to sign the check-in sheet!',
  aggression: 1,
  showIf: (state: GameState) => state.walkInExplained && !state.attitudeWarned,
  response: [
    pause,
    { do: 'say', who: 'receptionist', text: 'Sir, you need to tone down the attitude, okay?' },
    { do: 'set', key: 'attitudeWarned', value: true },
  ],
};

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
    // The man who walks in after her coffee (same name and voice as in npcConversations.ts)
    newcomer: { name: 'MAN IN TRENCH COAT', pitch: 140, actor: 'newcomer' },
    // The waiting people (same names and voices as their small talk, npcConversations.ts)
    cougher: { name: 'OLDER MAN', pitch: 150, actor: 'cougher' },
    watchChecker: { name: 'MAN WITH BRIEFCASE', pitch: 165, actor: 'watchChecker' },
    sitter: { name: 'WOMAN', pitch: 260, actor: 'sitter' },
    jiggler: { name: 'YOUNG MAN', pitch: 205, actor: 'jiggler' },
    reader: { name: 'WOMAN WITH MAGAZINE', pitch: 285, actor: 'reader' },
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
        // PROPOSAL (more-dialogue): nothing, then one click
        {
          text: '(Clear your throat)',
          silent: true,
          response: [
            { do: 'sound', name: 'cough' },
            { do: 'wait', seconds: 1.5 },
            { do: 'sound', name: 'mouseClick', who: 'receptionist' },
          ],
        },
      ],
      lockedOptions: [],
      lockedResponse: [],
      onAdvance: [
        // She looks at you. Two seconds. Nothing. Back to the cards.
        { do: 'face', who: 'receptionist', expression: 'unimpressed' },
        // She looks at you. Two seconds. Nothing. Back to the cards.
        { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: T.glanceDuration },
        { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
        { do: 'face', who: 'receptionist', expression: 'neutral' },
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
        { text: 'Hello?', actions: [{ do: 'face', who: 'receptionist', expression: 'annoyed' }], response: silence },
      ],
      lockedOptions: [],
      lockedResponse: [],
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
        {
          do: 'say',
          who: 'receptionist',
          text: ['Take a number and have a seat.', 'Take a number and wait.'],
          vary: 'any',
        },
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
        alreadyTookTicket,
        {
          // She points at the WALK-IN GUESTS sign over her shoulder without looking up (owner's request)
          text: 'Why do I need a number if I have an appointment?',
          response: [
            pause,
            { do: 'anim', who: 'receptionist', name: 'pointAtSign', duration: 1.2 },
            {
              do: 'say',
              who: 'receptionist',
              text: ['Everybody gotta take a number.', 'Sir, read the sign.'],
              vary: 'any',
            },
            { do: 'wait', seconds: 0.8 },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
          ],
        },
        {
          text: "But I'm not a walk-in.",
          response: [
            { do: 'wait', seconds: 2 },
            { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: T.glanceDuration },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire', duration: T.glanceDuration },
            { do: 'say', who: 'receptionist', text: 'This man boutta make me lose my game...' },
          ],
        },
      ],
      lockedOptions: [],
      lockedResponse: [{ do: 'say', who: 'receptionist', text: 'Got me a full stack...' }],
    },
    {
      // The same objection, raised again later by walking up and pressing E (no auto-open).
      // Reached after "(Say nothing)" or "...Take a seat and wait.", so the player can come
      // back once the clock reads 2:00.
      id: 'protest_again',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: 'Sorry, I have an appointment at 2.',
          goto: 'what_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: ['What time is it now?', 'Mmm? And what time is it?'] },
          ],
        },
        {
          text: "I'm ready for my appointment.",
          goto: 'protest_again',
          actions: [
            { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: T.glanceDuration },
            { do: 'say', who: 'receptionist', text: 'Mmhmm.' },
            { do: 'anim', who: 'receptionist', name: 'glanceAtClock', duration: T.glanceDuration },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
          ],
        },
        // PROPOSAL (more-dialogue)
        {
          text: 'Roughly how long is the wait?',
          showIf: (state: GameState) => !state.asked['receptionist.howLong'], // asked once in the whole game
          response: [
            {
              do: 'set',
              key: 'asked',
              value: (state: GameState) => ({ ...state.asked, 'receptionist.howLong': true }),
            },
            pause,
            { do: 'say', who: 'receptionist', text: 'Ooooo, this man impatient!' },
          ],
        },
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
          text: (state: GameState) => `${state.playerToldTime ? "Fine, it's" : "It's"} ${clockReading(state)}.`,
          showIf: (state: GameState) => !clockReadsTwo(state), // at exactly 2:00, "It's 2:00." below is the true answer
          goto: 'appointment_time',
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'And what time is your appointment?' },
            { do: 'set', key: 'playerToldTime', value: false },
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
                {
                  do: 'say',
                  who: 'receptionist',
                  text: ["No it's not.", "No it ain't.", "It ain't 2 yet."],
                  vary: 'any',
                },
              ],
            },
            { do: 'set', key: 'playerToldTime', value: true },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      // "You're late. You'll have to take a number and have a seat." when he already has one
      id: 'late_ticket',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: 'I already took a ticket.',
          goto: 'late_wait', // that's all she has to say about it (for now: he can come back, late_wait)
          unlockAfter: T.lateWait,
          actions: [pause, { do: 'say', who: 'receptionist', text: 'Then have a seat.' }],
        },
        { text: '(Say nothing)', silent: true, goto: 'late_wait', unlockAfter: T.lateWait },
      ],
      lockedOptions: [],
    },
    {
      // (Claude's proposal: the late route rejoins the story) Told he's late and to sit down, he comes back to
      // the desk: she asks whether he's checked in, and it's the check-in runaround (sheet, pen, coffee, 848...)
      id: 'late_wait',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: "I've been sitting there for ages. Can I at least check in?",
          goto: 'checkin_already',
          actions: [{ do: 'wait', seconds: T.sideOptionPause }, ...askCheckedIn],
        },
        {
          text: "I'm not taking a number. I had an appointment. Check me in.",
          aggression: 2,
          goto: 'checkin_already',
          actions: [{ do: 'wait', seconds: T.sideOptionPause }, ...askCheckedIn],
        },
        { text: '(Say nothing)', silent: true, response: [] },
      ],
      lockedOptions: [],
    },
    {
      id: 'appointment_time',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: (state: GameState) => `${state.playerRoundedTime ? "Okay fine, my" : "My"} appointment is at 2:00.`,
          // On time: "Did you check in already?" (checkin_already). Early ("not 2:00 yet"): she can be asked again later.
          // Late: the exchange is over.
          goto: (state: GameState) =>
            (state.checkInAsked ? 'checkin_already' : late(state) ? (alreadyHaveTicket(state) ? 'late_ticket' : 'late_wait') : 'protest_again'),
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
                    {
                      do: 'say',
                      who: 'receptionist',
                      text: [
                        "Well it's not 2:00 yet, is it?",
                        "Still ain't 2:00.",
                        (state: GameState) => `Clock says it's ${clockReading(state)}.`,
                      ],
                    },
                    { do: 'wait', seconds: T.sideOptionPause },
                    {
                      do: 'say',
                      who: 'receptionist',
                      text: ['Take a seat and wait.', 'Take a number and sit down.', 'Take a number and wait.'],
                      vary: 'any',
                    },
                    { do: 'say', who: 'player', text: ['Oh come on...', 'Unbelievable...'] },
                    { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: T.glanceDuration },
                    { do: 'face', who: 'receptionist', expression: 'unimpressed' },
                    { do: 'wait', seconds: 2 },
                    { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
                    { do: 'face', who: 'receptionist', expression: 'bored' },
                  ],
                  else: askCheckedIn, // on time (2:00-2:02)
                },
              ],
            },
            { do: 'set', key: 'playerRoundedTime', value: false },
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
                { do: 'set', key: 'playerRoundedTime', value: true },
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
          actions: [
            { do: 'wait', seconds: T.sideOptionPause },
            { do: 'say', who: 'receptionist', text: 'You gotta check in first.' },
          ],
        },
        {
          text: "That's what I'm trying to do right now.",
          goto: 'checkin_how',
          actions: [
            { do: 'wait', seconds: T.sideOptionPause },
            { do: 'say', who: 'receptionist', text: 'You gotta check in first.' },
          ],
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
          actions: [
            { do: 'wait', seconds: T.beat2IgnoreBeforeLine },
            { do: 'say', who: 'receptionist', text: 'Ooo, look at them cards fly, hoo hoo!' },
          ],
        },
        {
          text: 'Can you check me in, please?',
          goto: 'checkin_how_again',
          actions: [
            { do: 'wait', seconds: T.beat2IgnoreBeforeLine },
            { do: 'say', who: 'receptionist', text: 'Ooo, look at them cards fly, hoo hoo!' },
          ],
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
          actions: [
            { do: 'wait', seconds: T.sideOptionPause },
            { do: 'say', who: 'receptionist', text: 'You gotta sign the check-in sheet.' },
          ],
        },
        {
          text: 'Can you check me in, please?',
          goto: 'checkin_can_i',
          unlockAfter: T.newGameWait,
          actions: [
            { do: 'wait', seconds: T.sideOptionPause },
            { do: 'say', who: 'receptionist', text: 'You gotta sign the check-in sheet.' },
          ],
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
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'Did you sign the check-in sheet?' },
          ],
        },
        {
          text: 'I need to check in right now.',
          aggression: 1,
          response: [
            { do: 'say', who: 'receptionist', text: 'What you NEED to do is be patient.' },
            { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', untilDone: true },
            { do: 'face', who: 'receptionist', expression: 'annoyed' },
            { do: 'anim', who: 'receptionist', name: 'pointAtPoster' }, // she points at the PATIENCE poster as she says it
            { do: 'say', who: 'receptionist', text: 'Read that sign.' },
            { do: 'wait', seconds: 1 },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
          ],
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
          actions: [
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            { do: 'say', who: 'receptionist', text: 'Did you sign the check-in sheet?' },
            { do: 'anim', who: 'receptionist', name: 'slideClipboard', duration: T.clipboardSlide },
            { do: 'set', key: 'clipboardOffered', value: true },
          ], // "Did you sign the check-in sheet?" + the clipboard
        },
        {
          text: 'Can you please give me the check-in sheet?',
          goto: 'checkin_offered',
          actions: [
            { do: 'say', who: 'receptionist', text: 'Ooo, this man impatient.' },
            { do: 'wait', seconds: 2 },
            { do: 'face', who: 'receptionist', expression: 'angry' },
            { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', duration: T.glanceDuration },
            { do: 'anim', who: 'receptionist', name: 'resumeSolitaire' },
            { do: 'say', who: 'receptionist', text: "Mamma playin' her game..." },
            { do: 'face', who: 'receptionist', expression: 'bored' },
            { do: 'anim', who: 'receptionist', name: 'slideClipboard', duration: T.clipboardSlide },
            { do: 'set', key: 'clipboardOffered', value: true },
          ],
        },
      ],
      lockedOptions: [],
    },
    {
      // The clipboard is on the counter now (sign it: sequences.signSheet -> the pen)
      id: 'checkin_offered',
      trigger: { type: 'interact', target: 'receptionist' },
      onOpen: [{ do: 'say', who: 'receptionist', text: 'Did you sign the sheet?' }],
      options: [
        {
          text: 'No.',
          actions: [],
          response: [
            {
              do: 'say',
              who: 'receptionist',
              text: [
                'Everybody gotta sign the check-in sheet. Did you sign it?',
                'Did you sign the check-in sheet?',
                'Gotta sign that sheet...',
              ],
            },
          ],
        },
        // PROPOSAL (more-dialogue)
        {
          text: 'What do I put on it?',
          response: [
            pause,
            {
              do: 'say',
              who: 'receptionist',
              text: ['Name. Appointment time. Time you got here.', 'Name. Time. Time.'],
            },
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
          // (asked: "Are you telling me you don't have any pens...?" can come up in pen_borrow)
          actions: [
            { do: 'set', key: 'askedForPen', value: true },
            // She ignores the question entirely
            { do: 'wait', seconds: T.beat3PauseBeforeLine },
            {
              do: 'say',
              who: 'receptionist',
              text: [
                'Oooo, Mamma gotta get her some coffee... mmm, mmm.',
                'Mamma gotta get her some coffee...',
                'Boy I need me some coffee...',
              ],
              vary: 'any',
            },
            { do: 'wait', seconds: 1 },
            { do: 'say', who: 'player', text: 'Are you serious?' },
            { do: 'anim', who: 'receptionist', name: 'coffeeBreak', untilDone: true }, // ~30 s away
            { do: 'set', key: 'hadCoffee', value: true },
          ],
        },
        // PROPOSAL (more-dialogue)
        {
          text: 'Could I sign it in pencil?',
          showIf: (state: GameState) => !state.asked['receptionist.pencil'], // asked once in the whole game
          response: [
            { do: 'set', key: 'asked', value: (state: GameState) => ({ ...state.asked, 'receptionist.pencil': true }) },
            pause,
            { do: 'say', who: 'receptionist', text: 'Gotta be in pen.' },
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
          // The second "No." is followed by calling the next number (848, the newcomer), then he can protest
          goto: (state: GameState) => (state.penRefusals >= 2 ? 'newcomer_checks_in' : 'how_check_in'),
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
        // PROPOSAL (more-dialogue)
        {
          text: 'What about the pen you use for solitaire?',
          showIf: (state: GameState) => !state.asked['receptionist.solitairePen'], // asked once in the whole game
          response: [
            {
              do: 'set',
              key: 'asked',
              value: (state: GameState) => ({ ...state.asked, 'receptionist.solitairePen': true }),
            },
            pause,
            { do: 'say', who: 'receptionist', text: "Solitaire's on the computer." },
          ],
        },
        {
          text: "Are you telling me you don't have any pens in this entire office?",
          showIf: (state: GameState) => state.askedForPen === true && !state.asked['receptionist.allPens'], // (once)
          aggression: 1,
          response: [
            { do: 'set', key: 'asked', value: (state: GameState) => ({ ...state.asked, 'receptionist.allPens': true }) },
            { do: 'say', who: 'receptionist', text: "It ain't my job to keep track of pens." },
            { do: 'say', who: 'player', text: "You're a receptionist. I'm pretty sure that's part of your job." },
          ],
        },
      ],
      lockedOptions: [],
      next: 'newcomer_checks_in',
    },
    {
      id: 'newcomer_checks_in',
      trigger: { type: 'interact', target: 'receptionist' },
      options: [
        {
          text: "I'm not a no-show! I'm right here!",
          response: [
            {
              do: 'say',
              who: 'receptionist',
              text: ["Didn't check in.", "Didn't check in though.", "Didn't sign the check-in sheet so you a no-show."],
              vary: 'any',
            },
          ],
        },
        { text: 'But how come he gets to go first? My number was before his!', advance: true },
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [
        { do: 'anim', who: 'receptionist', name: 'lookAtPlayer', untilDone: true },
        {
          do: 'say',
          who: 'receptionist',
          text: ['His number was called.', 'His number is being served now.'],
          vary: 'any',
        },
        { do: 'say', who: 'newcomer', text: 'Yeah buddy, first come, first served.' },
      ],
      next: 'argument_1',
      nextUnlockAfter: 0,
    },

    // ---- The argument that leads to the fight (owner's script, temp_script_leading_to_fight.md) ----
    // Every reply opens by itself: it's an argument. It ends with the newcomer grabbing the clipboard.
    {
      id: 'argument_1',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        { text: 'But I was here first. I have an appointment at 2:00.', advance: true },
        { text: "Excuse me? I've been here since 1:55. Sit down.", aggression: 2, advance: true }, // (the aggressive way: same replies)
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [
        pause,
        { do: 'anim', who: 'newcomer', name: 'attend' },
        { do: 'anim', who: 'newcomer', name: 'confront' },
        { do: 'say', who: 'newcomer', text: "Well you're late. You forfeit your appointment." },
        { do: 'say', who: 'player', text: 'Whoa, okay...' },
        { do: 'anim', who: 'jiggler', name: 'attend' },
        { do: 'say', who: 'jiggler', text: 'Yeah dude, get a watch.' },
        { do: 'anim', who: 'cougher', name: 'attend' },
        {
          do: 'say',
          who: 'cougher',
          text: "These youngsters can't tell time anymore unless it's on their iPad phone.",
        },
      ],
      next: 'argument_2',
      nextUnlockAfter: 0,
    },
    {
      id: 'argument_2',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: (state: GameState) => `I was on time! I've been here for ${minutesHere(state)} minutes!`,
          advance: true, // (always offered: it's the only way on; hiding it after the check-in plea left the beat empty)
        },
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [pause, { do: 'say', who: 'newcomer', text: "Why didn't you check in then?" }],
      next: 'argument_2_checkin',
      nextUnlockAfter: 0,
    },
    {
      // (owner's addition) Why didn't he check in? Politely, or blaming her solitaire
      id: 'argument_2_checkin',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: "I've been trying to check in since I got here!",
          goto: 'argument_3',
          actions: [pause, { do: 'say', who: 'receptionist', text: 'Sir, I need to ask you to lower your voice.' }],
        },
        {
          // (the aggressive way)
          text: "Because this lady can't stop playing solitaire long enough to do her job!",
          aggression: 2,
          goto: 'argument_3',
          actions: [
            pause,
            { do: 'say', who: 'receptionist', text: "Sir I'm going to have to ask you to calm ALL the way down." },
          ],
        },
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
    },
    {
      id: 'argument_3',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        { text: "I'm not yelling. I'm just saying I was here first.", advance: true },
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [
        pause,
        { do: 'face', who: 'newcomer', expression: 'pleased' },
        { do: 'say', who: 'newcomer', text: 'Oh, we got a smart-ass here...' },
        pause,
        { do: 'anim', who: 'reader', name: 'attend' },
        { do: 'face', who: 'reader', expression: 'angry' },
        { do: 'say', who: 'reader', text: 'Actually, I was here first.' },
        // She gets up and walks over to the reception desk, angrily
        { do: 'anim', who: 'reader', name: 'confront', untilDone: true },
        { do: 'say', who: 'reader', text: 'If anyone should go next it should be me.' },
      ],
      next: 'argument_4',
      nextUnlockAfter: 0,
    },
    {
      id: 'argument_4',
      trigger: { type: 'interact', target: ['receptionist', 'reader'] }, // (whose E reopens the choices if they're closed: her, or the reader it's asked of)
      autoOpen: true,
      options: [
        { text: 'What time is your appointment?', advance: true },
        { text: "You don't even have an appointment, do you?", aggression: 1, advance: true }, // (the aggressive way)
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [pause, { do: 'say', who: 'reader', text: "I don't have an appointment. I was here first." }],
      next: 'argument_5',
      nextUnlockAfter: 0,
    },
    {
      id: 'argument_5',
      trigger: { type: 'interact', target: ['receptionist', 'reader'] }, // ("Okay, well do you have a number?": to the reader too)
      autoOpen: true,
      options: [
        { text: 'Okay, well do you have a number?', advance: true },
        { text: "Then where's your ticket? What's your number?", aggression: 1, advance: true }, // (the aggressive way: still asking for her "number")
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [
        pause,
        { do: 'face', who: 'reader', expression: 'appalled' },
        { do: 'say', who: 'reader', text: 'Ew! This creep is asking for my number??' },
        { do: 'anim', who: 'reader', name: 'slap', untilDone: true }, // across the face
        pause,
        { do: 'say', who: 'receptionist', text: 'Sir...' },
        { do: 'say', who: 'newcomer', text: 'Wow, dude, really?' },
      ],
      next: 'argument_6',
      nextUnlockAfter: 0,
    },
    {
      id: 'argument_6',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        { text: "I wasn't asking for her phone number!", advance: true },
        {
          // (the aggressive way)
          text: 'Nobody wants your phone number!',
          aggression: 2,
          advance: true,
          actions: [pause, { do: 'say', who: 'newcomer', text: 'Wow, dude.' }],
        },
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [
        pause,
        { do: 'say', who: 'receptionist', text: 'Sir, I need you to calm down.' },
        // The sitter stands up, marches over and shoves him back several feet
        // (if the radio war put her on the floor, the young man does it)
        {
          do: 'if',
          test: (state: GameState) => !state.sitterDown,
          then: [
            { do: 'face', who: 'sitter', expression: 'furious' },
            { do: 'anim', who: 'sitter', name: 'shoveHard', untilDone: true },
          ],
          else: [
            { do: 'face', who: 'jiggler', expression: 'furious' },
            { do: 'anim', who: 'jiggler', name: 'shoveHard', untilDone: true },
          ],
        },
      ],
      next: 'argument_7',
      nextUnlockAfter: 0,
    },
    {
      id: 'argument_7',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: "Okay everyone, let's just calm down here.",
          advance: true,
          actions: [{ do: 'anim', who: 'jiggler', name: 'standUp' }],
        },
        {
          // (the aggressive way)
          text: 'You know what? Everybody shut up!',
          aggression: 3,
          advance: true,
          actions: [{ do: 'anim', who: 'jiggler', name: 'standUp' }],
        },
        pleaCheckIn,
        pleaLetMeIn,
        pleaWalkIn,
        pleaEveryone,
      ],
      lockedOptions: [],
      onAdvance: [
        pause,
        { do: 'say', who: 'newcomer', text: "Dude, I think you're the one who needs to calm down." },
        { do: 'emit', event: 'clipboardSmash' }, // he grabs the check-in clipboard: the brawl starts (waitingRoomLevel.js)
      ],
      next: 'fighting_words',
      nextUnlockAfter: 0,
    },
    {
      id: 'fighting_words',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true,
      options: [
        {
          text: "I'm just trying to check in for my appointment!",
          goto: 'calm_down',
          actions: [
            { do: 'say', who: 'receptionist', text: "You didn't sign the check-in sheet." },
            { do: 'say', who: 'player', text: "I've been trying to check in since I got here!" },
          ],
        },
        {
          text: 'I am calm.',
          goto: 'you_calling_me_a_liar',
          actions: [{ do: 'say', who: 'newcomer', text: 'Are you calling me a liar?' }],
        },
      ],
      lockedOptions: [],
      onAdvance: [],
      next: 'you_calling_me_a_liar',
      nextUnlockAfter: 0,
    },
    {
      id: 'calm_down',
      trigger: { type: 'interact', target: 'receptionist' },
      autoOpen: true, // (it's an argument: no walking up and pressing E)
      onOpen: [{ do: 'say', who: 'receptionist', text: 'Sir you need to calm down.' }],
      options: [
        {
          text: "I'm trying to be calm but you are being totally unreasonable here.",
          aggression: 1,
          advance: true,
          actions: [{ do: 'say', who: 'receptionist', text: "Oh no he didn't..." }],
        },
        { text: "How can I be calm when you people are being insane and acting like it's normal?", response: [] },
        { text: "I'd be a lot calmer if you would just do your job.", response: [] },
      ],
      lockedOptions: [],
      onAdvance: [{ do: 'say', who: 'newcomer', text: 'You got a problem, pal?' }],
      next: 'you_calling_me_a_liar',
      nextUnlockAfter: 0,
    },
    {
      id: 'you_calling_me_a_liar',
      trigger: { type: 'interact', target: 'receptionist' }, // (whose E reopens the choices if they're closed)
      autoOpen: true,
      options: [
        {
          text: 'No',
          goto: null, // the scene ends in the brawl
          actions: [
            { do: 'say', who: 'newcomer', text: 'You want me to be calm?' },
            { do: 'say', who: 'player', text: 'That would be great, yeah' },
            { do: 'say', who: 'newcomer', text: 'Yeah? Yeah?!' },
            { do: 'anim', who: 'newcomer', name: 'lookAtPlayer' },
            { do: 'say', who: 'player', text: 'If we could all just be calm that would be...' },
            // He cuts him off with a shove
            { do: 'face', who: 'newcomer', expression: 'furious' },
            { do: 'anim', who: 'newcomer', name: 'shove', untilDone: true },
            { do: 'say', who: 'newcomer', text: 'Is this calm enough for you??' },
            { do: 'say', who: 'player', text: 'Uh, not really.' },
            { do: 'anim', who: 'newcomer', name: 'shove', untilDone: true },
            { do: 'say', who: 'newcomer', text: 'Am I calm enough for you now? Am I?' },
            // The old man gets up out of his chair
            { do: 'face', who: 'cougher', expression: 'angry' },
            { do: 'anim', who: 'cougher', name: 'standUp', untilDone: true },
            { do: 'say', who: 'cougher', text: 'The man asked you a question, boy!' },
            { do: 'say', who: 'player', text: "You've got to be kidding me." },
            // Shove after shove
            { do: 'anim', who: 'newcomer', name: 'shove', untilDone: true },
            { do: 'anim', who: 'newcomer', name: 'shove', untilDone: true },
            { do: 'anim', who: 'newcomer', name: 'shove', untilDone: true },
            { do: 'anim', who: 'newcomer', name: 'shove' }, // still at it while she talks
            { do: 'face', who: 'receptionist', expression: 'pleased' },
            { do: 'say', who: 'receptionist', text: 'Oooo, Imma put this on Instagram! Hold up, lemme get my phone.' },
            // She stands up, takes her phone out of her pocket and films it (and keeps filming)
            { do: 'anim', who: 'receptionist', name: 'filmPlayer', untilDone: true },
            { do: 'say', who: 'player', text: "I'm just trying to do my taxes!" },
            // The sitter (the young man, if the radio war put her on the floor)
            {
              do: 'if',
              test: (state: GameState) => !state.sitterDown,
              then: [
                { do: 'say', who: 'sitter', text: "Oh yeah? Looks like you're just trying to cause a problem to me." },
                { do: 'say', who: 'sitter', text: "I know you ain't lookin at my breasts again!" },
                { do: 'say', who: 'cougher', text: "You quit lookin at that girl's breasts!" },
                { do: 'anim', who: 'cougher', name: 'confront' },
              ],
              else: [
                { do: 'say', who: 'jiggler', text: "Oh yeah? Looks like you're just trying to cause a problem to me." },
              ],
            },
            { do: 'say', who: 'player', text: "You know what? I'm just going to go..." },
            { do: 'wait', seconds: 1.2 },
            { do: 'say', who: 'receptionist', text: 'Oh look at that, I just found all the pens.' },
            { do: 'say', who: 'receptionist', text: 'My bad.' },
            { do: 'wait', seconds: 0.6 },
            { do: 'face', who: 'jiggler', expression: 'furious' },
            { do: 'say', who: 'jiggler', text: "The creep's trying to run away! Get him!!" },
            { do: 'emit', event: 'brawlStart' }, // the all-out brawl (waitingRoomLevel.js); she keeps filming
          ],
        },
      ],
      lockedOptions: [],
      onAdvance: [],
      nextUnlockAfter: 0,
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
            { do: 'say', who: 'player', text: ['Of course...', '*sigh*', 'Here we go...'] },
          ],
        },
      ],
      lockedOptions: [],
    },
  ],
};
