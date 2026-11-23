/*
  Types for scene data (src/data/*.ts) run by the director (director.js).
  They describe exactly what the director understands, so `npm run typecheck`
  catches misspelled actions, missing fields and wrong value types in the beats.
*/
import type { state } from '../state.js';

export type GameState = typeof state;

/** A value, or a function that computes it from the game state when it's needed. */
export type Live<T> = T | ((state: GameState) => T);

/** Seconds: a fixed number, or [min, max] for a random duration in that range. */
export type Seconds = number | number[];

export type Phase = 'arrival' | 'reception' | 'waiting' | 'brawl' | 'doorOpen';

/** Animations the receptionist understands (characters/receptionist.js). */
export type ReceptionistAnim = 'lookAtPlayer' | 'glanceAtClock' | 'resumeSolitaire' | 'slideClipboard';

/** Expression presets (config.characters.expressions). */
export type Expression = 'neutral' | 'bored' | 'unimpressed' | 'annoyed' | 'surprised' | 'pleased';

/** Sounds a scene can trigger directly (audio/sfx.js). */
export type SoundName =
  | 'clockTick' | 'mouseClick' | 'blip' | 'footstep' | 'chairCreak' | 'ticketTear' | 'paperSlide'
  | 'cough' | 'sigh' | 'pageTurn' | 'chairShift' | 'watchTick' | 'chime';

export type Action =
  | { do: 'say'; who: string; text: Live<string> }
  | { do: 'anim'; who: string; name: ReceptionistAnim; duration?: number }
  | { do: 'wait'; seconds: Seconds }
  | { do: 'setPhase'; phase: Phase }
  | { do: 'set'; key: keyof GameState; value: unknown }
  | { do: 'sound'; name: SoundName; who?: string }
  | { do: 'emit'; event: string }
  | { do: 'face'; who: string; expression: Expression }
  | { do: 'goto'; beat: string | null }
  | { do: 'if'; test: (state: GameState) => boolean; then?: Action[]; else?: Action[] };

export interface Option {
  /** What the player says. A function gives live text (e.g. the time on the clock). */
  text: Live<string>;
  /** Hide the option when this returns false. */
  showIf?: (state: GameState) => boolean;
  /** No spoken line (e.g. "(Say nothing)"). */
  silent?: boolean;
  /** Run the beat's onAdvance, then move to beat.next. Takes precedence over goto/response. */
  advance?: boolean;
  /** Run `actions`, then move to this beat id (null = the exchange is over). */
  goto?: Live<string | null>;
  actions?: Action[];
  /** Gate before the goto target accepts an attempt. */
  unlockAfter?: Seconds;
  /** Neither advance nor goto: run these and stay (counts as being ignored). */
  response?: Action[];
}

export interface Beat {
  id: string;
  trigger: { type: 'interact'; target: string };
  /** Choices open by themselves as soon as this beat becomes current. */
  autoOpen?: boolean;
  /** Actions run each time the choices open. */
  onOpen?: Action[];
  options: Option[];
  /** Offered while the beat is still gated ([] = nothing appears). */
  lockedOptions?: Option[];
  onAdvance?: Action[];
  next?: string | null;
  nextUnlockAfter?: Seconds;
}

export interface Speaker {
  name: string;
  /** Voice blip pitch, Hz. */
  pitch: number;
  /** Actor whose head the voice comes from. */
  actor?: string;
}

export interface Scene {
  /** Id of the first beat. */
  start: string;
  /** Interact targets the director answers for, even after the beats are used up. */
  targets?: string[];
  speakers: Record<string, Speaker>;
  /** Action lists the game starts itself with director.play(name). */
  sequences?: Record<string, Action[]>;
  beats: Beat[];
}
