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
  clockTime:               // seconds since midnight (12h face)
    config.clock.startHour * 3600 + config.clock.startMinute * 60 + config.clock.startSecond,

  // runtime flags (not narrative)
  started: false,
  paused: false,
};
