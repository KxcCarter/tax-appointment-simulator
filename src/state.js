import { config } from './config.js';

// Single global game state. Later levels read from this.
export const state = {
  phase: 'arrival',        // arrival | reception | waiting | brawl | doorOpen
  ticketNumber: null,
  nowServing: config.nowServing.initial,
  timesIgnored: 0,
  knockdowns: 0,
  playerHealth: 100,
  heldWeapon: null,
  playerToldTime: false,   // 
  playerRoundedTime: false,   // 
  toldToTakeNumber: false, // receptionist said "Take a number..."
  checkInAsked: false,     // on time: she asked "Did you check in already?" (the check-in runaround)
  clipboardOffered: false, // she slid the check-in sheet over (after "Did you sign the check-in sheet?")
  needsPen: false,         // tried to sign the check-in sheet without a pen
  askedForPen: false,      // asked her for a pen ("Do you have a pen?")
  tension: 0,              // the argument heating up, 0..1 (beats' `tension`, and every line he picks): config.argument
  temper: 0,               // how aggressive the player has been: the sum of the aggression of every line he's picked
  lastAggression: 0,       // the aggression of the line he picked last (0 polite .. 3 hostile; Option.aggression)
  hadCoffee: false,        // the receptionist has been for her coffee
  penRefusals: 0,          // times she has said "No." to lending a pen
  newcomerArrived: false,  // someone came in after her coffee and took the next ticket
  waitElapsed: 0,          // seconds spent in the waiting phase
  called: false,           // the receptionist called the player's number
  playTime: 0,             // seconds of play (pauses don't count)
  radioOn: false,
  radioOffCount: 0,        // times the player has turned the radio off (the sitter's anger)
  sitterAttacks: 0,        // times she has attacked the player
  canFightBack: false,     // after her kick, the player can punch
  foughtBack: false,       // the player has hit the sitter; the others think he's a maniac
  sitterDown: false,       // knocked down by the player; the radio war is over
  clockTime:               // seconds since midnight (12h face)
    config.clock.startHour * 3600 + config.clock.startMinute * 60 + config.clock.startSecond,

  checkInPleaded: false,   // during the argument: "Please, can I just check in...?" ("go find a pen")
  newcomerSentIn: false,   // ...and "Can't you just let me in?": "Number 848, you can go on in."
  walkInExplained: false,  // ..."He didn't sign the check-in sheet!": "He was a walk-in."
  attitudeWarned: false,   // ..."But you said everyone...": "Sir, you need to tone down the attitude, okay?"
  jiggleAsks: 0,           // times the player asked the young man to stop bouncing his leg
  timeAsks: 0,             // times the man with the watch has asked the player the time
  asked: /** @type {Record<string, boolean>} */ ({}), // small-talk questions already asked ('<person>.<topic>')
  retries: 0,              // times the player has woken up in a chair with a higher ticket
  ended: false,            // walked through the accountant's door (end card)

  // runtime flags (not narrative)
  hitStop: 0,              // seconds of hit-stop left
  started: false,
  paused: false,
};
