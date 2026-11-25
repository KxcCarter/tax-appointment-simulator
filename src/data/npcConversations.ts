import { config } from '../config.js';
import type { Action, GameState, Option, Scene, Beat } from '../director/types.ts';

/*
  Small talk with the waiting people. Every conversation has the same spine (owner's design):

    YOU:  "Hello." | "Excuse me."
    THEM: their greeting ("Hello." / "Hi." / "Hey.")
    YOU:  "What time is your appointment?"
    THEM: "I don't have an appointment." | "My appointment is at 3:00." | ...
    YOU:  "Okay, thank you."  (ends it)  |  "How long have you been waiting?"  | ...

  After the appointment question the conversation opens up into `topics`: questions the player can
  ask, each with an answer and, sometimes, follow-up questions. A question that has been asked is
  gone for good (people remember; it's kept in state.asked), so the menu slowly empties. Coming back
  later skips the appointment question ("Hello again.").

  Topic fields:
    id      unique within the person (state.asked key: '<person>.<id>')
    ask     what the player says
    answer  their reply: a line, a list of lines said in turn (each one a separate line), or (state) => line
    lead    actions before the answer (a cough, a glance, a face)
    extra   actions after the answer
    after   only offered once this other topic (same person) has been asked
    when    only offered while this is true
    follow  follow-up questions (offered right after the answer; "back" returns to the rest)
    back    what the player says to leave the follow-ups (default "I see.")
    end     the conversation ends after the answer (they turn away)

  Walking away (E) mid-conversation ends it; next time it starts from "Hello" again.
  Once the player's number has been called, nobody talks to the player.
  Lines marked PROPOSAL are Claude's (branch more-dialogue); keep, change or cut.
*/

const T = config.timings.reception;

export interface Topic {
  id: string;
  ask: string;
  answer: string | string[] | ((state: GameState) => string);
  lead?: Action[];
  extra?: Action[];
  after?: string;
  when?: (state: GameState) => boolean;
  follow?: Topic[];
  back?: string;
  end?: boolean;
}

interface Person {
  /** Display name in the dialogue box. */
  name: string;
  /** Voice blip pitch, Hz. */
  pitch: number;
  /** A list: the first time, then on later visits (in order, then at random). */
  greeting: string | string[];
  appointment: string;
  waiting: string;
  /** "What are you here for?" (PROPOSAL lines) */
  reason?: string;
  /** "Do you know how much longer it'll be?" (PROPOSAL lines) */
  howLong?: string;
  /** Their own questions and answers (PROPOSAL, branch more-dialogue). */
  topics?: Topic[];
  /** "Any news?" on later visits: one per visit, in order, then at random (PROPOSAL). */
  news?: string[];
  /** Things they mutter (e.g. the sitter, each time the radio gets turned off again). */
  radioComplaints?: string[];
}

const clockAt = (state: GameState): string => {
  const t = Math.floor(state.clockTime / 60) % 720;
  return `${Math.floor(t / 60) || 12}:${String(t % 60).padStart(2, '0')}`;
};
const pastTwo = (state: GameState): boolean => Math.floor(state.clockTime / 60) % 720 >= 2 * 60;
const radioOn = (state: GameState): boolean => state.radioOn;
const cough: Action = { do: 'sound', name: 'cough', who: 'cougher' };
const beat = (seconds: number): Action => ({ do: 'wait', seconds });

export const people: Record<string, Person> = {
  cougher: {
    name: 'OLDER MAN', pitch: 150,
    greeting: ['Hello.', 'Hello again.'],
    appointment: "I don't have an appointment.",
    waiting: 'Since yesterday.',
    reason: "My wife's return. She passed in 1979. They still want it.",
    howLong: 'Longer.',
    news: ['No.', 'They skipped ten.', 'I coughed.'],
    topics: [
      {
        id: 'wife', after: 'reason',
        ask: 'Why do they still want her return?',
        answer: "She didn't file for 1979.",
        follow: [
          {
            id: 'wife2', ask: 'Because she passed away?',
            answer: "They said that's not one of the exemptions.",
            follow: [{ id: 'wife3', ask: "What did you tell them?", answer: ["I said I'd ask her.", 'That was in 1980.'] }],
          },
        ],
      },
      {
        id: 'cough', after: 'waiting', ask: 'Are you all right?',
        lead: [cough, beat(0.6)],
        answer: "It's the waiting.",
        follow: [{ id: 'cough2', ask: 'The waiting?', answer: 'It gets into the lungs.', extra: [beat(0.5), cough] }],
      },
      {
        id: 'number', after: 'howLong',
        ask: 'What number do you have?',
        answer: 'Nine.',
        follow: [
          {
            id: 'number2', ask: "They're on twelve.",
            answer: 'They skipped nine.',
            follow: [{ id: 'number3', ask: 'Why?', answer: 'I was coughing.' }],
          },
        ],
      },
      {
        id: 'accountant', after: 'wife',
        ask: 'Have you ever seen the accountant?',
        answer: 'Once. He was going to lunch.',
        follow: [{ id: 'accountant2', ask: 'When was that?', answer: ['1983.', 'I assume he came back.'] }],
      },
      {
        id: 'radio', when: radioOn,
        ask: 'Does the radio bother you?',
        answer: 'What radio?',
      },
    ],
  },
  watchChecker: {
    name: 'MAN WITH BRIEFCASE', pitch: 165,
    greeting: ['Hi.', 'Yes?'],
    appointment: 'My appointment is at 3:00.',
    waiting: 'Since 12:44.', // PROPOSAL: has an appointment; the brief didn't say. He'd know to the minute.
    reason: 'Quarterly estimates. I like to be early.',
    howLong: 'Seventeen minutes. Approximately.',
    news: ['Four minutes have passed.', 'My watch is still fast.', 'No.'],
    topics: [
      {
        id: 'early', after: 'waiting',
        ask: 'Why so early for a 3:00?',
        answer: 'Last year I came at 2:45. They had already called my three o\'clock.',
        follow: [
          {
            id: 'early2', ask: 'When did they call it?',
            answer: '12:44.',
            follow: [{ id: 'early3', ask: "How can they call a 3:00 at 12:44?", answer: ['I asked.', 'They said I was late.'] }],
          },
        ],
      },
      {
        id: 'briefcase', after: 'reason', ask: "What's in the briefcase?",
        answer: 'Receipts.',
        follow: [{ id: 'briefcase2', ask: 'For what?', answer: 'For the briefcase.' }],
      },
      {
        id: 'number', after: 'early',
        ask: 'What number do you have?',
        answer: "I don't need a number. I have an appointment.",
        follow: [
          {
            id: 'number2', ask: 'So do I. She still made me take one.',
            lead: [{ do: 'sound', name: 'watchTick', who: 'watchChecker' }, beat(1.2)],
            // Before 2:00 he's sorry for him in advance; after, it's simply a fact
            answer: (s) => (pastTwo(s) ? "It's past two. You had an appointment." : `It's ${clockAt(s)}. You still have one. For now.`),
          },
        ],
      },
      {
        id: 'watch', after: 'number',
        ask: 'Is your watch right?',
        answer: "It's a minute fast.",
        follow: [{ id: 'watch2', ask: "Why don't you set it right?", answer: "Then I'd be on time. Nobody here is on time." }],
      },
      {
        id: 'accountant', after: 'briefcase',
        ask: 'Have you ever seen the accountant?',
        answer: "I've heard him.",
        follow: [{ id: 'accountant2', ask: 'Heard what?', answer: 'Stapling.' }],
      },
    ],
  },
  sitter: {
    name: 'WOMAN', pitch: 260,
    greeting: ['Hello.', 'You again.'],
    appointment: "I don't have an appointment.",
    waiting: 'Since nine this morning.', // (8:58 on the check-in sheet)
    reason: 'They sent me a letter. It said to come in.',
    howLong: '...',
    news: ['No.', "It's still warm."],
    topics: [
      {
        id: 'letter', after: 'reason',
        ask: 'What did the letter say?',
        answer: 'To come in.',
        follow: [
          {
            id: 'letter2', ask: 'To come in for what?',
            answer: 'It said to bring the letter.',
            follow: [
              {
                id: 'letter3', ask: 'Did you bring it?',
                answer: ['I gave it to her. She kept it.', "So now I don't know what I'm here for."],
              },
            ],
          },
        ],
      },
      {
        id: 'number', after: 'waiting',
        ask: 'What number do you have?',
        answer: 'Twelve.',
        follow: [
          {
            id: 'number2', ask: "They're serving twelve!",
            answer: 'Not me. The other twelve.',
            follow: [{ id: 'number3', ask: 'There are two twelves?', answer: 'There were.' }],
          },
        ],
      },
      {
        id: 'radio', when: (s) => s.radioOn && s.radioOffCount === 0,
        ask: 'Is that your radio?',
        answer: "It's the office's. I just turn it on.",
        follow: [{ id: 'radio2', ask: 'Why?', answer: 'Somebody has to.' }],
      },
      {
        // After the player has turned it off on her (she's not violent yet: that blocks small talk anyway)
        id: 'radioWhy', when: (s) => s.radioOffCount > 0,
        ask: 'Why do you keep turning the radio back on?',
        lead: [{ do: 'face', who: 'sitter', expression: 'annoyed' }],
        answer: 'Why do you keep turning it off?',
        end: true,
      },
      {
        id: 'receptionist', after: 'letter',
        ask: 'Is the receptionist always like this?',
        answer: 'Like what?',
      },
    ],
  },
  jiggler: {
    name: 'YOUNG MAN', pitch: 205,
    greeting: ['Hey.', 'Hey. Again.'],
    appointment: 'My appointment is at 5:30.',
    waiting: 'Since lunch.', // PROPOSAL: has an appointment; the brief didn't say.
    reason: "I don't know, man. My mom made the appointment.",
    howLong: 'Dude, I have no idea.',
    news: ['Nah.', 'I think my leg fell asleep.', 'Nah, man.'],
    topics: [
      {
        id: 'early', after: 'waiting',
        ask: 'Why are you here so early for 5:30?',
        answer: 'My mom said to get here early.',
        follow: [{ id: 'early2', ask: 'This early?', answer: 'She said they can tell.' }],
      },
      {
        id: 'forWhat', after: 'reason',
        ask: 'What did she make it for?',
        answer: "I think I'm being claimed.",
        follow: [{ id: 'forWhat2', ask: 'Claimed by who?', answer: "She doesn't know. That's what the appointment's for." }],
      },
      {
        id: 'number', after: 'early',
        ask: 'What number do you have?',
        answer: ['Hold on.', '...My mom has it.'],
      },
      {
        id: 'receptionist', after: 'forWhat',
        ask: 'Is the receptionist always like this?',
        answer: "I don't know, dude. I don't look at her.",
        follow: [{ id: 'receptionist2', ask: 'Why not?', answer: "Then she'll know you're here." }],
      },
      {
        id: 'accountant', after: 'receptionist',
        ask: 'Have you ever seen the accountant?',
        answer: 'My mom says he\'s really good.',
        follow: [{ id: 'accountant2', ask: 'Has she met him?', answer: "No. That's how she knows." }],
      },
    ],
  },
  reader: {
    name: 'WOMAN WITH MAGAZINE', pitch: 285,
    greeting: ['Hi.', 'Mm?'],
    appointment: "I don't have an appointment.",
    waiting: 'About an hour.',
    reason: 'I came in to ask a question. In April.',
    howLong: 'They called twelve at eleven-thirty.',
    news: ['Page forty-one.', 'Someone did the crossword again. In pen.', 'No.'],
    topics: [
      {
        id: 'question', after: 'reason',
        ask: 'What was your question?',
        answer: 'Whether I needed an appointment.',
        follow: [
          {
            id: 'question2', ask: 'Do you?',
            answer: "I'm waiting to find out.",
            follow: [{ id: 'question3', ask: 'Since April?', answer: "I've been in and out." }],
          },
        ],
      },
      {
        id: 'magazine', after: 'waiting', ask: 'Is that magazine any good?',
        answer: "It's March, 1987.",
        follow: [
          {
            id: 'magazine2', ask: 'Is it any good, though?',
            lead: [{ do: 'sound', name: 'pageTurn', who: 'reader' }, beat(0.6)],
            answer: "I'll tell you when I find out what happened.",
          },
        ],
      },
      {
        id: 'accountant', after: 'question',
        ask: 'Have you ever seen the accountant?',
        answer: "There's a picture of him in here. \"Waiting Rooms of the Midwest.\"",
        follow: [{ id: 'accountant2', ask: 'What is he doing?', answer: 'Waiting. Second row, next to a plant.' }],
      },
      {
        id: 'receptionist', after: 'magazine',
        ask: 'Is the receptionist always like this?',
        answer: 'She was nicer in April.',
        follow: [{ id: 'receptionist2', ask: 'What happened?', answer: 'They got her the new solitaire.' }],
      },
      {
        // Sets up "Ew! This creep is asking for my number??" in the argument
        id: 'number', after: 'howLong',
        ask: 'What number do you have?',
        lead: [{ do: 'face', who: 'reader', expression: 'appalled' }, beat(0.8)],
        answer: 'Excuse me?',
        end: true,
      },
    ],
  },
  // The man in the trench coat: talkable once he's sat down with 848, until 848 is called (PROPOSAL)
  newcomer: {
    name: 'MAN IN TRENCH COAT', pitch: 140,
    greeting: ['Yeah?', 'Yeah.'],
    appointment: "Don't need one. I'm a walk-in.",
    waiting: 'I just got here.',
    reason: 'Same as everybody.',
    howLong: "Not long. I've got a feeling.",
    news: ['Nope.', 'Any minute now.'],
    topics: [
      {
        id: 'number', ask: 'What number did you get?',
        answer: 'Eight forty-eight.',
        follow: [{ id: 'number2', ask: "I'm eight forty-seven.", answer: 'Good for you.' }],
      },
      {
        id: 'before', after: 'number',
        ask: 'Have you been here before?',
        answer: 'Every year. Never had to wait.',
        follow: [{ id: 'before2', ask: 'How?', answer: "I don't make appointments." }],
      },
      {
        id: 'pen', when: (s) => s.needsPen,
        ask: 'You wouldn\'t have a pen, would you?',
        answer: 'Not on me.',
      },
    ],
  },
};

const pause: Action = { do: 'wait', seconds: T.beat3PauseBeforeLine * 0.6 };

/** state.asked key for a topic. */
const key = (who: string, id: string): string => `${who}.${id}`;
const asked = (state: GameState, who: string, id: string): boolean => !!state.asked[key(who, id)];
const markAsked = (who: string, id: string): Action => ({
  do: 'set', key: 'asked', value: (state: GameState) => ({ ...state.asked, [key(who, id)]: true }),
});

/** The reply to a topic: one line, or several said one after the other. */
function answerLines(who: string, answer: Topic['answer']): Action[] {
  if (!Array.isArray(answer)) return [{ do: 'say', who, text: answer }];
  return answer.flatMap((text, i) => (i ? [beat(0.9), { do: 'say', who, text } as Action] : [{ do: 'say', who, text } as Action]));
}

const offered = (s: GameState, who: string, t: Topic): boolean =>
  !asked(s, who, t.id) && (!t.after || asked(s, who, t.after)) && (!t.when || t.when(s));

/** A menu the conversation can go back to: its beat id, and the topics it still offers. */
interface Level { id: string; topics: Topic[] }

/**
 * Options for a list of topics, plus a beat for every topic with follow-ups. After an answer the
 * conversation goes back to the nearest menu that still has something to ask (the top one, 'chat',
 * always has "Okay, thank you."), so there's never an "I see." with nothing else on offer.
 */
function topicOptions(who: string, topics: Topic[], levels: Level[], beats: Beat[]): Option[] {
  const backTo = (s: GameState, from: Level[]): string =>
    (from.find((l) => l.id === 'chat' || l.topics.some((t) => offered(s, who, t))) ?? { id: 'chat' }).id;
  return topics.map((t) => {
    const hasFollow = !!t.follow?.length;
    const here: Level = { id: `t_${t.id}`, topics: t.follow ?? [] };
    if (hasFollow) {
      beats.push({
        id: here.id,
        trigger: { type: 'interact', target: who },
        autoOpen: true,
        options: [
          ...topicOptions(who, t.follow as Topic[], [here, ...levels], beats),
          { text: t.back ?? 'I see.', goto: (s: GameState) => backTo(s, levels) },
        ],
      });
    }
    return {
      text: t.ask,
      showIf: (s: GameState) => offered(s, who, t),
      // (asked is marked first, so this topic no longer counts as something left to ask)
      goto: t.end ? 'hello' : (s: GameState) => backTo(s, hasFollow ? [here, ...levels] : levels),
      actions: [
        markAsked(who, t.id),
        pause,
        ...(t.lead ?? []),
        ...answerLines(who, t.answer),
        ...(t.extra ?? []),
        ...(t.end ? [beat(0.6), { do: 'anim', who, name: 'resume' } as Action] : []),
      ],
    };
  });
}

function conversation(id: string, p: Person): Scene {
  const thanks: Option = {
    text: 'Okay, thank you.',
    goto: 'hello', // over; next time starts from the top
    actions: [{ do: 'anim', who: id, name: 'resume' }],
  };
  // The spine's own questions are topics too, so they disappear once asked
  const topics: Topic[] = [
    { id: 'waiting', ask: 'How long have you been waiting?', answer: p.waiting },
    ...(p.reason ? [{ id: 'reason', ask: 'What are you here for?', answer: p.reason }] : []),
    ...(p.howLong ? [{ id: 'howLong', after: 'waiting', ask: "Do you know how much longer it'll be?", answer: p.howLong }] : []),
    ...(p.topics ?? []),
  ];
  const beats: Beat[] = [];
  const chatOptions = topicOptions(id, topics, [{ id: 'chat', topics }], beats);
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
          // The first time: their appointment. After that, straight to whatever is left to ask.
          goto: (s: GameState) => (asked(s, id, 'appointment') ? 'chat' : 'appointment'),
          actions: [
            { do: 'anim', who: id, name: 'attend' },
            pause,
            { do: 'say', who: id, text: p.greeting },
            // Coming back: "Any news?" is on offer from now on
            { do: 'if', test: (s: GameState) => asked(s, id, 'appointment'), then: [markAsked(id, 'returned')] },
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
            goto: 'chat',
            actions: [markAsked(id, 'appointment'), pause, { do: 'say', who: id, text: p.appointment }],
          },
        ],
      },
      {
        id: 'chat',
        trigger: { type: 'interact', target: id },
        autoOpen: true,
        options: [
          thanks,
          ...(p.news?.length ? [{
            text: 'Any news?',
            showIf: (s: GameState) => asked(s, id, 'returned'),
            goto: 'chat', // once per visit
            actions: [pause, { do: 'say', who: id, text: p.news }] as Action[],
          }] : []),
          ...chatOptions,
        ],
      },
      ...beats,
    ],
  };
}

/** One scene per person, keyed by NPC id (matches src/data/waitingRoomCast.js; 'newcomer' once he's arrived). */
export const npcConversations: Record<string, Scene> = Object.fromEntries(
  Object.entries(people).map(([id, p]) => [id, conversation(id, p)]),
);

// ---------------------------------------------------------------------------------------------
// Side scenarios built on top of the small talk
// ---------------------------------------------------------------------------------------------

const clockReading = (state: GameState): string => {
  const t = Math.floor(state.clockTime / 60) % 720;
  return `${Math.floor(t / 60) || 12}:${String(t % 60).padStart(2, '0')}`;
};
const resume = (id: string): Action => ({ do: 'anim', who: id, name: 'resume' });

/*
  The leg-jiggler: sitting next to him, the player's view bounces with his knee. He can be asked to
  stop. First: "Stop what?" (nothing changes). Then he stops, briefly, and starts again faster.
  (The level counts the asks and does the stopping: event 'jiggleAsked'.)
*/
const jiggleReplies = ['Stop what?', 'Oh. Sorry.', 'Yeah. Sorry.', 'Sorry, man.', "I'm not doing anything."];
npcConversations.jiggler.beats[0].options.push({
  text: 'Could you stop bouncing your leg?',
  goto: 'hello',
  actions: [
    { do: 'anim', who: 'jiggler', name: 'attend' },
    pause,
    { do: 'set', key: 'jiggleAsks', value: (state: GameState) => state.jiggleAsks + 1 },
    { do: 'say', who: 'jiggler', text: (state) => jiggleReplies[Math.min(state.jiggleAsks - 1, jiggleReplies.length - 1)] },
    { do: 'emit', event: 'jiggleAsked' },
    resume('jiggler'),
  ],
});

/*
  The man with the watch: sitting next to him, he asks the player the time (the level starts it).
  "It's 2:00." when it isn't gets what the receptionist said: "No it isn't."
*/
npcConversations.watchChecker.sequences = {
  askTime: [
    { do: 'anim', who: 'watchChecker', name: 'attend' },
    pause,
    { do: 'say', who: 'watchChecker', text: 'Excuse me. Do you have the time?' },
    { do: 'goto', beat: 'timeAnswer' },
  ],
};
npcConversations.watchChecker.beats.push({
  id: 'timeAnswer',
  trigger: { type: 'interact', target: 'watchChecker' },
  autoOpen: true,
  options: [
    {
      text: (state) => `It's ${clockReading(state)}.`,
      goto: 'hello',
      actions: [pause, { do: 'say', who: 'watchChecker', text: 'Thank you.' }, { do: 'wait', seconds: 1.4 },
        { do: 'say', who: 'watchChecker', text: "I'm a minute fast." }, resume('watchChecker')],
    },
    {
      text: "It's 2:00.",
      showIf: (state) => clockReading(state) !== '2:00',
      goto: 'hello',
      actions: [pause, { do: 'wait', seconds: 0.8 }, { do: 'say', who: 'watchChecker', text: "No it isn't." }, resume('watchChecker')],
    },
    {
      text: '(Say nothing)',
      silent: true,
      goto: 'hello',
      actions: [{ do: 'wait', seconds: 2 }, { do: 'say', who: 'watchChecker', text: 'Never mind.' }, resume('watchChecker')],
    },
  ],
});

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
    gamer: { name: 'MAN WITH CHIPS', pitch: 95, actor: 'gamer' }, // (brawl shouts; no lines of his own yet)
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
/*
  The sitter catches the player looking at her while she's up and walking about (owner's request): she
  stops, turns on him and says one of these, in order, then at random (never the same twice in a row).
  pose: what she does with her hands (walker.js ATTACK_POSES): 'coverChest' (arms over her chest),
  'pointEyes' (two fingers at her eyes: "up HERE"), 'pointAt' (pointing at him, for the room's benefit).
  When and how often: config.npc.eyesUp.
*/
export const eyesUp: { text: string; pose: string; expression: string }[] = [
  { text: 'Are you looking at my breasts??', pose: 'coverChest', expression: 'angry' },
  { text: 'Hey perv, my eyes are up HERE!', pose: 'pointEyes', expression: 'furious' },
  { text: 'This creep is looking at my breasts!!', pose: 'pointAt', expression: 'furious' },
];

export const brawlShouts: { opening: string[]; called: string[]; again: string[]; anytime: string[]; receptionist: string[]; receptionistMoving: string[]; receptionistAfter: string; friendlyFire: string[]; byPerson: Record<string, string[]> } = {
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
  // The receptionist, during the brawl, filming it all on her phone (owner's lines; in order, round and round)
  receptionist: [
    'Oo, get him!',
    'Ouch!',
    "Mmhmm, that's what you get!",
  ],
  // The receptionist, moving to a better spot behind the counter, still filming (the first two are the
  // owner's; in order, then at random)
  receptionistMoving: [
    'Ooo, this is a good angle.',
    'Let me see some of that action!',
    'Hold on, hold on, I gotta get this.',      // PROPOSAL
    'Mmm, from over here. Yes.',                // PROPOSAL
    "Y'all are going viral.",                   // PROPOSAL
  ],
  // The receptionist, when the fight is over (the door unlocks); then she sits down and watches it back (owner's line)
  receptionistAfter: 'Oooo, this boutta go viral!',
  // Someone hit by a thing one of the others threw at the player (PROPOSAL; config.brawl.throwing.friendlyFire)
  friendlyFire: [
    'Hey!',
    'Watch it!',
    'Whose side are you on?',
    'Thanks a lot.',
  ],
  byPerson: {
    sitter: ["I've been here since nine!"], // (from the brief)
  },
};

/*
  Overheard (PROPOSAL, branch more-dialogue): every so often, while nothing else is being said, two of
  the waiting people talk to each other (or the receptionist talks to nobody). Each exchange plays once,
  in the order written; one is skipped for now if someone in it is up, down or busy, or if its `when`
  (overheardWhen below) isn't true yet. Timing: config.overheard. Lines are said where the speaker sits.
*/
const lull = (seconds: number): Action => ({ do: 'wait', seconds });

export const overheard: Scene = {
  start: '',
  speakers: {
    ...Object.fromEntries(Object.entries(people).map(([id, p]) => [id, { name: p.name, pitch: p.pitch, actor: id }])),
    receptionist: { name: 'RECEPTIONIST', pitch: config.characters.receptionist.voicePitch, actor: 'receptionist' },
  },
  beats: [],
  sequences: {
    twelve: [
      { do: 'say', who: 'cougher', text: 'Did they call twelve yet?' },
      lull(1.2),
      { do: 'say', who: 'watchChecker', text: 'Eleven-thirty.' },
      lull(1.5),
      { do: 'say', who: 'cougher', text: "Then who's in there?" },
      lull(1.2),
      { do: 'say', who: 'watchChecker', text: 'Twelve.' },
      lull(2.5),
      { do: 'say', who: 'cougher', text: 'Lucky.' },
    ],
    warm: [
      { do: 'say', who: 'sitter', text: 'Is it warm in here?' },
      lull(4),
      { do: 'say', who: 'sitter', text: "It's warm." },
    ],
    average: [
      { do: 'sound', name: 'pageTurn', who: 'reader' },
      lull(0.8),
      { do: 'say', who: 'reader', text: 'It says here the average person spends three years of their life waiting.' },
      lull(1.5),
      { do: 'say', who: 'jiggler', text: 'Waiting for what?' },
      lull(1.5),
      { do: 'sound', name: 'pageTurn', who: 'reader' },
      lull(0.6),
      { do: 'say', who: 'reader', text: "It doesn't say." },
    ],
    numberTwelve: [
      // To no one in particular, without looking up. Nobody moves.
      { do: 'say', who: 'receptionist', text: 'Number twelve?' },
      lull(4),
      { do: 'sound', name: 'mouseClick', who: 'receptionist' },
      lull(1),
      { do: 'say', who: 'receptionist', text: 'Mm.' },
    ],
    whatTime: [
      { do: 'say', who: 'cougher', text: 'What time is it?' },
      lull(1),
      { do: 'sound', name: 'watchTick', who: 'watchChecker' },
      lull(1),
      { do: 'say', who: 'watchChecker', text: (s: GameState) => `It's ${clockReading(s)}.` },
      lull(2),
      { do: 'say', who: 'cougher', text: 'Still?' },
    ],
    wentIn: [
      { do: 'say', who: 'jiggler', text: 'Has anybody ever actually gone in there?' },
      lull(1.5),
      { do: 'say', who: 'cougher', text: 'A man went in. In 1988.' },
      lull(1),
      { do: 'say', who: 'jiggler', text: 'What happened?' },
      lull(1.5),
      { do: 'say', who: 'cougher', text: "He's still in there." },
      lull(2),
      { do: 'say', who: 'cougher', text: 'Or he left by the other door.' },
      lull(1),
      { do: 'say', who: 'jiggler', text: "There's another door?" },
      lull(1),
      { do: 'sound', name: 'cough', who: 'cougher' },
    ],
    twoMinutes: [
      { do: 'say', who: 'watchChecker', text: 'Two minutes.' },
      lull(1.5),
      { do: 'say', who: 'reader', text: 'Until what?' },
      lull(1.5),
      { do: 'say', who: 'watchChecker', text: "I'll know in two minutes." },
    ],
    walkIn: [
      { do: 'say', who: 'newcomer', text: "How long's the wait, usually?" },
      lull(1.5),
      { do: 'say', who: 'watchChecker', text: 'For what?' },
      lull(1),
      { do: 'say', who: 'newcomer', text: 'For anything.' },
      lull(1),
      { do: 'sound', name: 'sigh', who: 'watchChecker' },
      lull(1),
      { do: 'say', who: 'watchChecker', text: 'Longer than that.' },
    ],
    someoneWhoStayed: [
      { do: 'say', who: 'jiggler', text: 'My mom says if you leave, they give your appointment to someone else.' },
      lull(1.5),
      { do: 'say', who: 'sitter', text: 'Who?' },
      lull(1.5),
      { do: 'say', who: 'jiggler', text: 'Someone who stayed.' },
    ],
  },
};

/** Exchanges that wait for something (the rest can play any time). */
export const overheardWhen: Record<string, (state: GameState) => boolean> = {
  walkIn: (s) => s.newcomerArrived && s.nowServing !== config.ticket.number + 1,
  someoneWhoStayed: (s) => s.ticketNumber != null, // once the player has a number too
};

/*
  The voice behind the accountant's door (PROPOSAL, branch more-dialogue). Knocking: "No answer." twice,
  then "Not yet." (roomRemarks.accountantDoor); from the next knock on, this conversation. When it's over,
  knocking goes back to the remarks (the receptionist: "Don't knock on the door. He'll call you.").
*/
const door = (text: string): Action[] => [lull(1.4), { do: 'say', who: 'voice', text }];

export const doorVoice: Scene = {
  start: 'door_1',
  targets: ['accountantDoor'],
  speakers: {
    player: { name: 'YOU', pitch: config.characters.playerVoicePitch },
    voice: { name: 'VOICE BEHIND THE DOOR', pitch: 110 },
    receptionist: { name: 'RECEPTIONIST', pitch: config.characters.receptionist.voicePitch, actor: 'receptionist' },
  },
  beats: [
    {
      id: 'door_1',
      trigger: { type: 'interact', target: 'accountantDoor' },
      autoOpen: true,
      options: [
        { text: 'Hello? I have a 2:00 appointment.', goto: 'door_2', actions: door('With whom?') },
        { text: 'Hello?', goto: 'door_1', actions: door('Not yet.') },
      ],
    },
    {
      id: 'door_2',
      trigger: { type: 'interact', target: 'accountantDoor' },
      autoOpen: true,
      options: [{ text: 'With the accountant.', goto: 'door_3', actions: door("He's with a client.") }],
    },
    {
      id: 'door_3',
      trigger: { type: 'interact', target: 'accountantDoor' },
      autoOpen: true,
      options: [
        { text: 'Who am I talking to?', goto: 'door_4', actions: door('The client.') },
        { text: 'Can I talk to him?', goto: 'door_3', actions: door('So could I.') },
      ],
    },
    {
      id: 'door_4',
      trigger: { type: 'interact', target: 'accountantDoor' },
      autoOpen: true,
      options: [
        {
          text: "Then who's he with?",
          goto: 'door_5',
          actions: [
            lull(1.4),
            { do: 'say', who: 'voice', text: 'Me.' },
            lull(1.4),
            { do: 'say', who: 'voice', text: "He stepped out. I'm waiting for him to come back." },
          ],
        },
      ],
    },
    {
      id: 'door_5',
      trigger: { type: 'interact', target: 'accountantDoor' },
      autoOpen: true,
      options: [
        {
          text: "Stepped out? Is there another door?",
          goto: null,
          actions: [
            lull(1.4),
            { do: 'say', who: 'voice', text: "There's always another door." },
            lull(1.4),
            { do: 'say', who: 'voice', text: "Please stop knocking. He'll think it's for him." },
            lull(1.5),
            { do: 'say', who: 'receptionist', text: "Sir. Don't talk to the door." }, // without looking up
          ],
        },
        {
          text: 'How long have you been waiting in there?',
          goto: 'door_5',
          actions: door("Since my one o'clock. On the fourteenth."),
        },
      ],
    },
  ],
};
