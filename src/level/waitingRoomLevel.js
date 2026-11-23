import * as THREE from 'three';
import { config } from '../config.js';
import { state } from '../state.js';
import { buildWaitingRoom } from './waitingRoom.js';
import { Receptionist } from '../characters/receptionist.js';
import { Director } from '../director/director.js';
import { waitingRoomBeats } from '../data/waitingRoomBeats.ts';
import { npcConversations } from '../data/npcConversations.ts';
import { Interaction } from '../player/interaction.js';
import { Npc } from '../characters/npc.js';
import { waitingRoomCast } from '../data/waitingRoomCast.js';

/**
 * Wires the Waiting Room together: geometry, the receptionist, the director,
 * interactables (receptionist, ticket dispenser, chairs) and ambient sound.
 */
export function setupWaitingRoom({ scene, physics, player, camera, ui, sfx, fastWait = false }) {
  const room = buildWaitingRoom(scene, physics);
  const A = room.anchors;

  const receptionist = new Receptionist(scene, A, sfx);
  const actors = { receptionist };

  // --- the five people already waiting (fixed cast) ---
  const clockPos = A.clock.getWorldPosition(new THREE.Vector3());
  const receptionistHead = () => receptionist.voicePosition();
  const npcs = waitingRoomCast.map((def) => {
    const npc = new Npc({ scene, physics, def, chair: A.chairs[def.seat], sfx, clockPos, receptionistHead });
    actors[def.id] = npc;
    return npc;
  });

  // Small talk: one director per waiting person (each remembers where it stopped).
  // Only one conversation owns the dialogue box at a time.
  const smallTalk = [];
  const anyActive = (except) => [director, ...smallTalk].some((d) => d !== except && d.active);

  const director = new Director({
    data: waitingRoomBeats, state, ui, sfx, actors, player, config,
    isBlocked: () => anyActive(director),
    onEvent: (type, key) => {
      if (type === 'set' && key === 'nowServing') {
        room.nowServing.setNumber(state.nowServing);
        sfx.chime(A.nowServing.getWorldPosition(new THREE.Vector3()));
      }
      if (type === 'set' && key === 'called') for (const n of npcs) n.onCalled();
      updatePhase();
    },
  });

  for (const n of npcs) {
    const data = npcConversations[n.id];
    if (!data) continue;
    const d = new Director({
      data, state, ui, sfx, actors, player, config,
      isBlocked: () => anyActive(d) || state.called, // after the call nobody's chatty
    });
    smallTalk.push(d);
    n.conversation = d;
  }

  const interaction = new Interaction(camera, scene, ui, player);

  // --- waiting people: small talk until the player's number is called ---
  for (const n of npcs) {
    if (!n.conversation) continue;
    interaction.register(n.rig.root, {
      prompt: () => (state.called || n.busyElsewhere ? null : '[E] Talk'),
      onInteract: () => n.conversation.interact(n.id),
    });
  }

  // --- receptionist ---
  interaction.register(receptionist.root, {
    prompt: () => '[E] Talk',
    onInteract: () => director.interact('receptionist'),
  });

  // --- ticket dispenser: works any time; taking a ticket early doesn't help ---
  interaction.register(A.ticketDispenser, {
    prompt: () => (state.ticketNumber == null ? '[E] Take number' : null),
    onInteract: () => {
      if (state.ticketNumber != null) return;
      state.ticketNumber = config.ticket.number;
      sfx.ticketTear(A.ticketDispenser.getWorldPosition(new THREE.Vector3()));
      ui.setTicket(state.ticketNumber);
      for (const n of npcs) n.glanceAtPlayer();
      updatePhase();
    },
  });

  // --- chairs ---
  const up = new THREE.Vector3();
  const canSit = (c) => {
    if (c.occupant) return false;
    up.set(0, 1, 0).applyQuaternion(c.object.quaternion);
    return up.y > config.seated.uprightThreshold;
  };
  const standHandler = {
    prompt: () => '[E] Stand',
    onInteract: () => {
      const c = A.chairs.find((ch) => ch.occupant === 'player');
      if (c) c.occupant = null;
      player.stand();
      sfx.chairCreak(c?.object.position);
      interaction.setOverride(null);
    },
  };
  for (const c of A.chairs) {
    interaction.register(c.object, {
      prompt: () => (canSit(c) ? '[E] Sit' : null),
      onInteract: () => {
        if (!canSit(c)) return;
        c.occupant = 'player';
        player.sit(c.object);
        sfx.chairCreak(c.object.position);
        interaction.setOverride(standHandler);
      },
    });
  }

  // --- phases: arrival -> reception (director) -> waiting (told + holding a ticket) ---
  function updatePhase() {
    if (state.toldToTakeNumber && state.ticketNumber != null && state.phase !== 'waiting') {
      state.phase = 'waiting';
    }
  }

  // --- ambient: footsteps, clock tick ---
  player.onStep = () => sfx.footstep();
  let lastSecond = Math.floor(state.clockTime);
  // --- the radio ---
  let radioStarted = false, radioLoop = null;
  const radioPos = () => A.radio.speaker.getWorldPosition(new THREE.Vector3());
  async function turnOnRadio() {
    state.radioOn = true;
    A.radio.turnOn();
    sfx.radioClick(radioPos());
    const buffer = await sfx.loadAudio(import.meta.env.BASE_URL + config.radio.file);
    if (buffer && state.phase !== config.radio.stopAtPhase) radioLoop = sfx.playLoop(buffer, radioPos(), config.radio);
  }

  const waitDuration = fastWait ? config.timings.waiting.fastDuration : config.timings.waiting.duration;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  return {
    room,
    director,
    receptionist,
    npcs,
    interaction,
    radioStatus: () => ({ started: radioStarted, playing: !!radioLoop }),
    /** Game-time update (not called while paused). */
    update(dt) {
      room.update(dt);
      director.update(dt);
      for (const d of smallTalk) d.update(dt);
      receptionist.update(dt, camera.position);

      // The wait: counts no matter what the player does (owner's decision)
      if (state.phase === 'waiting' && !state.called && !this.callStarted) {
        state.waitElapsed += dt;
        if (state.waitElapsed >= waitDuration) {
          this.callStarted = true;
          director.play('call');
        }
      }

      // The radio: at config.radio.at seconds of play, someone gets up and turns it on
      state.playTime += dt;
      const R = config.radio;
      if (!radioStarted && state.playTime >= R.at) {
        const who = npcs.find((n) => n.id === R.who);
        if (who && !who.attending && !who.conversation?.active) {
          radioStarted = true;
          who.startErrand({
            standSpot: A.radio.standSpot,
            faceYaw: A.radio.faceYaw,
            reachTarget: () => A.radio.knob.getWorldPosition(new THREE.Vector3()),
            onReach: () => turnOnRadio(),
          });
        }
      }
      if (radioLoop && state.phase === R.stopAtPhase) {
        radioLoop.stop();
        radioLoop = null;
      }

      // Sitting right next to someone makes them lean away
      const mine = A.chairs.find((c) => c.occupant === 'player');
      for (const n of npcs) {
        let side = 0;
        if (mine) {
          const d = _a.copy(mine.object.position).distanceTo(_b.copy(n.chair.object.position));
          if (d < config.npc.crowdedDistance) side = n.local(mine.object.position).x > 0 ? 1 : -1;
        }
        n.setCrowded(side);
        n.update(dt, camera);
      }
      const sec = Math.floor(state.clockTime);
      if (sec !== lastSecond) {
        lastSecond = sec;
        sfx.clockTick(clockPos, sec % 2 === 1);
      }
    },
    /** Every rendered frame. */
    frame() {
      room.clock.update(state.clockTime);
      interaction.update();
    },
  };
}
