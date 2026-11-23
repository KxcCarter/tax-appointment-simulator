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
}

export const people: Record<string, Person> = {
  cougher: {
    name: 'OLDER MAN', pitch: 150,
    greeting: 'Hello.',
    appointment: "I don't have an appointment.",
    waiting: 'Since yesterday.',
  },
  watchChecker: {
    name: 'MAN WITH BRIEFCASE', pitch: 165,
    greeting: 'Hi.',
    appointment: 'My appointment is at 3:00.',
    waiting: 'Since 12:44.', // PROPOSAL: has an appointment; the brief didn't say. He'd know to the minute.
  },
  sitter: {
    name: 'WOMAN', pitch: 260,
    greeting: 'Hello.',
    appointment: "I don't have an appointment.",
    waiting: 'Since nine this morning.', // (8:58 on the check-in sheet)
  },
  jiggler: {
    name: 'YOUNG MAN', pitch: 205,
    greeting: 'Hey.',
    appointment: 'My appointment is at 5:30.',
    waiting: 'Since lunch.', // PROPOSAL: has an appointment; the brief didn't say.
  },
  reader: {
    name: 'WOMAN WITH MAGAZINE', pitch: 285,
    greeting: 'Hi.',
    appointment: "I don't have an appointment.",
    waiting: 'About an hour.',
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
        ],
      },
      {
        id: 'goodbye',
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
