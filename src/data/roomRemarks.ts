/*
  Things in the room the player can look at (E), and what happens. Easter eggs: none of it matters.
  Each list plays in order, one per press; after the last, the last line repeats (unless `loop`).

  A line is either something the player notices (shown briefly at the bottom of the screen), or a
  line someone says: { who, text } (who = a speaker id from `onlookers` in npcConversations.ts).
*/

export type Remark = string | { who: string; text: string };

export interface RemarkSet {
  prompt: string;
  lines: Remark[];
  loop?: boolean;
}

export const roomRemarks: Record<string, RemarkSet> = {
  poster: {
    prompt: '[E] Read the poster',
    lines: [
      'PATIENCE. It is not a request.',
      'It still says patience.',
      'Patience.',
    ],
  },
  certificate: {
    prompt: '[E] Read the certificate',
    lines: [
      'Certificate of Continued Operation. Awarded 1984.',
      'It does not say who awarded it.',
      'The frame is nicer than the certificate.',
    ],
  },
  plantEast: {
    prompt: '[E] Touch the plant',
    lines: ["It's plastic.", 'Still plastic.', 'It has been dusted, at some point.'],
  },
  plantWest: {
    prompt: '[E] Touch the plant',
    lines: ["It's real.", "It's dying.", 'It is doing its best.'],
  },
  cabinets: {
    prompt: '[E] Open a drawer',
    lines: [
      'Locked.',
      'Also locked.',
      'They are all locked.',
      { who: 'receptionist', text: 'Sir.' },
      'Locked.',
    ],
  },
  coat: {
    prompt: '[E] Check the coat',
    lines: [
      'In the pocket: a receipt for one (1) pen. March 1986.',
      'The pen is not in the pocket.',
      'It is not your coat.',
    ],
  },
  nowServing: {
    prompt: '[E] Look at the display',
    lines: ['NOW SERVING 12.', 'It has said 12 for some time.', 'Twelve.'],
  },
  clock: {
    prompt: '[E] Look at the clock',
    lines: [
      'CLOCK', // replaced with the time on the clock
      'CLOCK',
      { who: 'receptionist', text: "Staring at it won't make it go any faster." },
      'CLOCK',
    ],
    loop: true,
  },
  dispenserAgain: {
    prompt: '[E] Take another number',
    lines: [
      { who: 'receptionist', text: 'One per customer.' },
      { who: 'receptionist', text: 'Sir. One.' },
      'The dispenser does not give you another one.',
    ],
  },
  water: {
    prompt: '[E] Have a cup of water',
    lines: [
      'A paper cup of water. It tastes of paper cup.',
      { who: 'receptionist', text: 'The water is for clients.' },
      { who: 'receptionist', text: 'Clients with appointments.' },
      { who: 'receptionist', text: "Sir, I'm going to have to ask you to stop drinking the water." },
      'You have another cup. Nobody stops you.',
    ],
  },
  accountantDoor: {
    prompt: '[E] Knock',
    lines: [
      'No answer.',
      'No answer. Something shuffles behind the door.',
      { who: 'voice', text: 'Not yet.' },
      { who: 'receptionist', text: "Don't knock on the door. He'll call you." },
      'No answer.',
    ],
  },
  magazine: {
    prompt: '[E] Read a magazine',
    lines: [
      'TAX QUARTERLY: "Is Your Deduction Too Happy?"',
      'FORMS TODAY: "Form 4562 and You: A Love Story"',
      'AUDIT LIVING: "Ten Rooms That Say Itemize"',
      'LEDGER, March 1987: "The Return of the Carbon Copy"',
      'TAX QUARTERLY: "Waiting Rooms of the Midwest" (photo essay)',
      'Someone has done the crossword. All the answers are "TAX".',
    ],
    loop: true,
  },
  screen: {
    prompt: '[E] Look at her screen',
    lines: ['Solitaire. She is losing.', 'She has been losing for some time.', 'She moves a card. It does not help.'],
  },
};

/** What the receptionist says when the player wanders behind the desk or into the back room. */
export const trespassLines: string[] = [
  "Sir, you can't be back here.",
  'Employees only.',
  'Sir.',
];
