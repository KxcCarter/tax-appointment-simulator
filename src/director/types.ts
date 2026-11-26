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
export type ReceptionistAnim =
  | 'lookAtPlayer' | 'glanceAtClock' | 'pointAtSign' | 'pointAtPoster' | 'phoneCall' | 'hangUp' | 'resumeSolitaire' | 'slideClipboard' | 'coffeeBreak' | 'sipCoffee'
  | 'filmPlayer'; // stand up, phone out of her pocket, film the player (keeps filming)

/**
 * Animations a waiting NPC understands (characters/npc.js): attend = turn to the player, resume = back to
 * fidgeting; standUp = stand up where they are, facing the player; confront = get up and walk up to the player; slap/shove/shoveHard/punch/kick = (walk up and)
 * hit him. Use untilDone: true to wait for them to arrive / the blow to land.
 */
export type NpcAnim = 'attend' | 'resume' | 'standUp' | 'confront' | 'slap' | 'shove' | 'shoveHard' | 'punch' | 'kick';

/** Expression presets (config.characters.expressions). */
/** 'default' = stop overriding: the character's own expressions again. A face set by the script holds
    until changed (receptionist) or until the conversation ends (waiting people). */
export type Expression = 'default' | 'neutral' | 'bored' | 'unimpressed' | 'annoyed' | 'surprised' | 'pleased' | 'angry' | 'furious' | 'appalled' | 'sultry';

/** Sounds a scene can trigger directly (audio/sfx.js). */
export type SoundName =
  | 'clockTick' | 'mouseClick' | 'blip' | 'footstep' | 'chairCreak' | 'ticketTear' | 'paperSlide'
  | 'cough' | 'sigh' | 'pageTurn' | 'chairShift' | 'watchTick' | 'chime' | 'phoneRing';

/*
  `say` with a list of lines says one of them each time it runs (variations):
    vary 'order' (default): in the order written; once all have been said, a random one each time
                            (never the same twice in a row)
    vary 'random': random from the start (never the same twice in a row)
    vary 'any':    truly random, every time (the same line can come up twice in a row)
    vary 'cycle':  round and round, in order
*/
export type Action =
  | { do: 'say'; who: string; text: Live<string> | Live<string>[]; vary?: 'order' | 'random' | 'any' | 'cycle'; cut?: Seconds } // cut: the next action starts after this long (talking over each other)
  | { do: 'anim'; who: string; name: ReceptionistAnim | NpcAnim; duration?: number; untilDone?: boolean }
  | { do: 'notice'; text: string; seconds?: number }
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
  /**
   * Keep offering this option after it's been picked. By default, a picked option that doesn't move
   * the story on (a response, or a jump back to the same beat) is removed for the rest of the visit.
   */
  repeatable?: boolean;
  /** Run the beat's onAdvance, then move to beat.next. Takes precedence over goto/response. */
  advance?: boolean;
  /** Run `actions`, then move to this beat id (null = the exchange is over). */
  goto?: Live<string | null>;
  /** Played after the choice is said: with goto, before moving; with advance, before the beat's onAdvance. */
  actions?: Action[];
  /** Gate before the goto target accepts an attempt. */
  unlockAfter?: Seconds;
  /** Neither advance nor goto: run these and stay (counts as being ignored). */
  response?: Action[];
  /**
   * How aggressive the line is: 0 polite (the default), 1 curt, 2 rude, 3 hostile. When it's picked the director
   * sets state.lastAggression to it and adds it to state.temper, before anything is said, so the option's own
   * actions, the beat's onAdvance and later beats can react: { do: 'if', test: (s) => s.lastAggression >= 2, ... }
   * or (s) => s.temper >= 5. (Nothing reacts to it yet: the stage is set.)
   */
  aggression?: Aggression;
}

/** How aggressive a dialogue option is: 0 polite, 1 curt, 2 rude, 3 hostile (see Option.aggression). */
export type Aggression = 0 | 1 | 2 | 3;

export interface Beat {
  id: string;
  trigger: { type: 'interact'; target: string | string[] }; // whose [E] opens its choices (one, or several: e.g. the person the line is to)
  /** Choices open by themselves as soon as this beat becomes current. */
  autoOpen?: boolean;
  /** Actions run each time the choices open. */
  onOpen?: Action[];
  options: Option[];
  /** Offered while the beat is still gated ([] = nothing appears). */
  lockedOptions?: Option[];
  /** Pressing E while the beat is still gated, with no lockedOptions: these run instead (e.g. she brushes you off). */
  lockedResponse?: Action[];
  onAdvance?: Action[];
  next?: string | null;
  nextUnlockAfter?: Seconds;
  /** While this beat is current: these actions every `every` seconds (the first after `first`), whenever nobody is
   *  talking or choosing. E.g. her side of a phone call. */
  during?: { every: Seconds; first?: Seconds; actions: Action[] };
  /** The argument's tension (0..1) from this beat on (state.tension): faster pacing, the choice timer, the crowd
   *  closing in, the heartbeat (config.argument). */
  tension?: number;
  /** Once this beat has been current for `after` seconds (and nothing's going on): run `actions`, then move to
   *  `goto` (null = the exchange is over), gated for `unlockAfter`. */
  timeout?: { after: Seconds; actions?: Action[]; goto: string | null; unlockAfter?: Seconds };
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
  /** Walking away mid-conversation (E) sends the scene back to `start` and runs onLeave. */
  resetOnLeave?: boolean;
  /** Pressing E while a beat is still gated and has nothing to offer (no lockedOptions or lockedResponse): these
   *  alerts, one per press, in order; the last one repeats. Starts over at each new gate. */
  lockedNotices?: string[];
  /** When the choice timer runs out and he has nothing aggressive to say: he says nothing, and this fills the silence. */
  timerSilence?: Action[];
  onLeave?: Action[];
}
