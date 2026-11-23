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
  toldToTakeNumber: false, // receptionist said "Take a number..."
  clipboardOffered: false, // on time: she slid the check-in sheet over
  needsPen: false,         // tried to sign the check-in sheet without a pen
  hadCoffee: false,        // the receptionist has been for her coffee
  waitElapsed: 0,          // seconds spent in the waiting phase
  called: false,           // the receptionist called the player's number
  playTime: 0,             // seconds of play (pauses don't count)
  radioOn: false,
  radioOffCount: 0,        // times the player has turned the radio off (the sitter's anger)
  sitterAttacks: 0,        // times she has attacked the player
  canFightBack: false,     // after her kick, the player can punch
  sitterDown: false,       // knocked down by the player; the radio war is over
  clockTime:               // seconds since midnight (12h face)
    config.clock.startHour * 3600 + config.clock.startMinute * 60 + config.clock.startSecond,

  // runtime flags (not narrative)
  started: false,
  paused: false,
};
