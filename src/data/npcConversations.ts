import { config } from '../config.js';
import type { Action, Scene } from '../director/types.ts';

/*
  Small talk with the five waiting people. Every conversation has the same shape:

    YOU:  "Hello." | "Excuse me."
    THEM: their greeting ("Hello." / "Hi." / "Hey.")
    YOU:  "What time is your appointment?"
    THEM: "I don't have an appointment." | "My appointment is at 3:00." | ...
    YOU:  "Okay, thank you."  (ends it)  |  "How long have you been waiting?"
    THEM: how long (people without an appointment: anywhere from an hour to since yesterday)
    YOU:  "Okay, thank you."

  Edit the per-person lines in `people` below; the shape is built by `conversation()`.
  Walking away (E) mid-conversation ends it; next time it starts from "Hello" again.
  Once the player's number has been called, nobody talks to them.
*/

const T = config.timings.reception;

interface Person {
  /** Display name in the dialogue box. */
  name: string;
  /** Voice blip pitch, Hz. */
  pitch: number;
  greeting: string;
  appointment: string;
  waiting: string;
  /** "What are you here for?" (PROPOSAL lines) */
  reason?: string;
  /** "Do you know how much longer it'll be?" (PROPOSAL lines) */
  howLong?: string;
  /** Things they mutter (e.g. the sitter, each time the radio gets turned off again). */
  radioComplaints?: string[];
}

export const people: Record<string, Person> = {
  cougher: {
    name: 'OLDER MAN', pitch: 150,
    greeting: 'Hello.',
    appointment: "I don't have an appointment.",
    waiting: 'Since yesterday.',
    reason: "My wife's return. She passed in 1979. They still want it.",
    howLong: 'Longer.',
  },
  watchChecker: {
    name: 'MAN WITH BRIEFCASE', pitch: 165,
    greeting: 'Hi.',
    appointment: 'My appointment is at 3:00.',
    waiting: 'Since 12:44.', // PROPOSAL: has an appointment; the brief didn't say. He'd know to the minute.
    reason: 'Quarterly estimates. I like to be early.',
    howLong: 'Seventeen minutes. Approximately.',
  },
  sitter: {
    name: 'WOMAN', pitch: 260,
    greeting: 'Hello.',
    appointment: "I don't have an appointment.",
    waiting: 'Since nine this morning.', // (8:58 on the check-in sheet)
    reason: 'They sent me a letter. It said to come in.',
    howLong: '...',
    // Said as she gets up to turn the radio back on, from the 2nd time it's turned off.
    // In order; after the last one, a random pick (never the same twice in a row).
    radioComplaints: ['Rude...', 'Seriously??', 'No way...', 'Really dude?', 'Oooh no, nuh-uh!', 'Son of a...'],
  },
  jiggler: {
    name: 'YOUNG MAN', pitch: 205,
    greeting: 'Hey.',
    appointment: 'My appointment is at 5:30.',
    waiting: 'Since lunch.', // PROPOSAL: has an appointment; the brief didn't say.
    reason: "I don't know, man. My mom made the appointment.",
    howLong: 'Dude, I have no idea.',
  },
  reader: {
    name: 'WOMAN WITH MAGAZINE', pitch: 285,
    greeting: 'Hi.',
    appointment: "I don't have an appointment.",
    waiting: 'About an hour.',
    reason: 'I came in to ask a question. In April.',
    howLong: 'They called twelve at eleven-thirty.',
  },
};

const pause: Action = { do: 'wait', seconds: T.beat3PauseBeforeLine * 0.6 };

function conversation(id: string, p: Person): Scene {
  const thanks = {
    text: 'Okay, thank you.',
    goto: 'hello', // over; next time starts from the top
    actions: [{ do: 'anim', who: id, name: 'resume' }] as Action[],
  };
  return {
    start: 'hello',
    targets: [id],
    resetOnLeave: true,
    onLeave: [{ do: 'anim', who: id, name: 'resume' }],
    speakers: {
      player: { name: 'YOU', pitch: config.characters.playerVoicePitch },
      [id]: { name: p.name, pitch: p.pitch, actor: id },
    },
    beats: [
      {
        id: 'hello',
        trigger: { type: 'interact', target: id },
        options: ['Hello.', 'Excuse me.'].map((text) => ({
          text,
          goto: 'appointment',
          actions: [
            { do: 'anim', who: id, name: 'attend' },
            pause,
            { do: 'say', who: id, text: p.greeting },
          ] as Action[],
        })),
      },
      {
        id: 'appointment',
        trigger: { type: 'interact', target: id },
        autoOpen: true,
        options: [
          {
            text: 'What time is your appointment?',
            goto: 'followUp',
            actions: [pause, { do: 'say', who: id, text: p.appointment }],
          },
        ],
      },
      {
        id: 'followUp',
        trigger: { type: 'interact', target: id },
        autoOpen: true,
        options: [
          thanks,
          {
            text: 'How long have you been waiting?',
            goto: 'goodbye',
            actions: [pause, { do: 'say', who: id, text: p.waiting }],
          },
          ...(p.reason ? [{
            text: 'What are you here for?',
            goto: 'goodbye',
            actions: [pause, { do: 'say', who: id, text: p.reason as string }] as Action[],
          }] : []),
        ],
      },
      {
        id: 'goodbye',
        trigger: { type: 'interact', target: id },
        autoOpen: true,
        options: [
          thanks,
          ...(p.howLong ? [{
            text: "Do you know how much longer it'll be?",
            goto: 'last',
            actions: [pause, { do: 'say', who: id, text: p.howLong }] as Action[],
          }] : []),
        ],
      },
      {
        id: 'last',
        trigger: { type: 'interact', target: id },
        autoOpen: true,
        options: [thanks],
      },
    ],
  };
}

/** One scene per person, keyed by NPC id (matches src/data/waitingRoomCast.js). */
export const npcConversations: Record<string, Scene> = Object.fromEntries(
  Object.entries(people).map(([id, p]) => [id, conversation(id, p)]),
);

/*
  The first time the player hits the sitter back (after she has slapped, shoved, punched and
  kicked him), everyone else reacts as if she did absolutely nothing wrong and he is a violent
  maniac. Lines play in order, one speaker at a time. Edit freely; the newcomer only speaks if
  he has already walked in.
*/
const gap: Action = { do: 'wait', seconds: [0.3, 0.7] };

export const onlookers: Scene = {
  start: '',
  speakers: {
    ...Object.fromEntries(Object.entries(people).map(([id, p]) => [id, { name: p.name, pitch: p.pitch, actor: id }])),
    newcomer: { name: 'MAN IN TRENCH COAT', pitch: 140, actor: 'newcomer' },
    voice: { name: 'VOICE BEHIND THE DOOR', pitch: 110 },
    receptionist: { name: 'RECEPTIONIST', pitch: config.characters.receptionist.voicePitch, actor: 'receptionist' },
  },
  beats: [],
  sequences: {
    playerFoughtBack: [
      { do: 'wait', seconds: 0.5 },
      { do: 'say', who: 'reader', text: 'Oh my God.' },
      gap,
      { do: 'say', who: 'cougher', text: 'He hit her.' },
      gap,
      { do: 'say', who: 'watchChecker', text: 'She was listening to the radio.' },
      gap,
      { do: 'say', who: 'jiggler', text: "What is wrong with you, man?" },
      {
        do: 'if', test: (state) => state.newcomerArrived,
        then: [gap, { do: 'say', who: 'newcomer', text: 'Unbelievable.' }],
      },
      gap,
      { do: 'say', who: 'reader', text: 'Somebody do something.' },
      { do: 'wait', seconds: 1.2 },
      // Without looking up from her solitaire
      { do: 'say', who: 'receptionist', text: "Sir, I'm going to have to ask you to calm down, please." },
    ],
  },
};

/*
  The brawl (src/level/brawl.js): the newcomer starts it, and everyone else cheers him on and
  joins in. `opening` plays first, in order, one person each; after that, people on the
  sidelines shout something from `anytime` (or their own `byPerson` lines) every few seconds.
*/
export const brawlShouts: { opening: string[]; called: string[]; again: string[]; anytime: string[]; byPerson: Record<string, string[]> } = {
  opening: [
    'Yeah! Get that jerk!',
    'Smash his face in!',
    'Teach that creep a lesson!',
  ],
  // When his number (847) is called before any of that happened: they're indignant (from the brief)
  called: [
    'I was here first!',
    "I've been here since nine!",
    'Unbelievable.',
  ],
  // After the player wakes up in a chair with an even higher ticket and they go for him again (PROPOSAL)
  again: [
    "He's back.",
    'Oh, here we go.',
    'Get him!',
  ],
  anytime: [
    'Learn to tell time, idiot.',
    "You think you're too good to wait in line?",
    "Oh, looks like this guy thinks he's something special!",
    'Yeah! Get that jerk!',
    'Smash his face in!',
    'Teach that creep a lesson!',
    'Wait your turn!',         // PROPOSAL
    'I was here first!',       // (from the brief)
  ],
  byPerson: {
    sitter: ["I've been here since nine!"], // (from the brief)
  },
};
