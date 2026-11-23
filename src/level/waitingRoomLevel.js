import * as THREE from 'three';
import { config } from '../config.js';
import { state } from '../state.js';
import { buildWaitingRoom } from './waitingRoom.js';
import { Receptionist } from '../characters/receptionist.js';
import { Director } from '../director/director.js';
import { waitingRoomBeats } from '../data/waitingRoomBeats.js';
import { Interaction } from '../player/interaction.js';

/**
 * Wires the Waiting Room together: geometry, the receptionist, the director,
 * interactables (receptionist, ticket dispenser, chairs) and ambient sound.
 */
export function setupWaitingRoom({ scene, physics, player, camera, ui, sfx }) {
  const room = buildWaitingRoom(scene, physics);
  const A = room.anchors;

  const receptionist = new Receptionist(scene, A, sfx);
  const actors = { receptionist };

  const director = new Director({
    data: waitingRoomBeats, state, ui, sfx, actors, player, config,
    onEvent: () => updatePhase(),
  });

  const interaction = new Interaction(camera, scene, ui, player);

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
  const clockPos = A.clock.getWorldPosition(new THREE.Vector3());
  let lastSecond = Math.floor(state.clockTime);

  return {
    room,
    director,
    receptionist,
    interaction,
    /** Game-time update (not called while paused). */
    update(dt) {
      room.update(dt);
      director.update(dt);
      receptionist.update(dt, camera.position);
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
