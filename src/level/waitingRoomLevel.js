import * as THREE from 'three';
import { config } from '../config.js';
import { state } from '../state.js';
import { buildWaitingRoom } from './waitingRoom.js';
import { Receptionist } from '../characters/receptionist.js';
import { Director } from '../director/director.js';
import { waitingRoomBeats } from '../data/waitingRoomBeats.ts';
import { npcConversations, people, onlookers, brawlShouts } from '../data/npcConversations.ts';
import { Interaction } from '../player/interaction.js';
import { Combat, weaponDef } from '../player/combat.js';
import { Brawl } from './brawl.js';
import { Npc } from '../characters/npc.js';
import { waitingRoomCast } from '../data/waitingRoomCast.js';

/**
 * Wires the Waiting Room together: geometry, the receptionist, the director,
 * interactables (receptionist, ticket dispenser, chairs) and ambient sound.
 */
export function setupWaitingRoom({ scene, physics, player, camera, ui, sfx, fastWait = false, brawlNow = false }) {
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
      isBlocked: () => anyActive(d) || state.called || state.foughtBack, // nobody chats after the call, or with a maniac
    });
    smallTalk.push(d);
    n.conversation = d;
  }

  // The bystanders' outburst when the player hits the sitter back (one shared scene)
  const onlookerTalk = new Director({
    data: onlookers, state, ui, sfx, actors, player, config,
    isBlocked: () => anyActive(onlookerTalk),
  });
  smallTalk.push(onlookerTalk);

  const interaction = new Interaction(camera, scene, ui, player);

  // --- waiting people: small talk until the player's number is called ---
  for (const n of npcs) {
    if (!n.conversation) continue;
    interaction.register(n.rig.root, {
      prompt: () => (state.called || state.foughtBack || state.phase === 'brawl' || n.busyElsewhere ? null : '[E] Talk'),
      onInteract: () => n.conversation.interact(n.id),
    });
  }

  // --- receptionist ---
  interaction.register(receptionist.root, {
    prompt: () => '[E] Talk',
    onInteract: () => director.interact('receptionist'),
  });

  // --- the check-in sheet on the counter (once she's slid it over) ---
  interaction.register(A.clipboard, {
    prompt: () => (state.clipboardOffered && !director.active ? '[E] Sign Check-in Sheet' : null),
    onInteract: () => director.runNow('signSheet'),
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

  // --- a newcomer: after the receptionist's coffee run, someone walks in, takes the next ticket, sits ---
  let newcomer = null, newcomerTimer = null, entranceAngle = 0;
  function bringInNewcomer() {
    const pref = config.newcomer.seatPreference;
    const seat = pref.find((i) => A.chairs[i] && !A.chairs[i].occupant);
    if (seat === undefined) return;
    newcomer = new Npc({
      scene, physics, sfx, clockPos, receptionistHead,
      def: { id: 'newcomer', look: 'newcomer', seat, personality: 'sitter', expression: 'bored' },
      chair: A.chairs[seat],
    });
    actors.newcomer = newcomer;
    npcs.push(newcomer);
    const disp = A.ticketDispenser.getWorldPosition(new THREE.Vector3());
    newcomer.arrive({
      door: A.entrance,
      dispenserSpot: new THREE.Vector3(disp.x, 0, disp.z + 0.6),
      dispenserTarget: () => disp.clone().add(new THREE.Vector3(0, 0.2, 0.08)),
      onTicket: () => { sfx.ticketTear(disp); state.newcomerArrived = true; },
    });
  }

  // --- the player's fists (from the radio war on; Milestone 4 extends this) ---
  const combat = new Combat({
    camera, player, sfx, physics, scene,
    targets: () => npcs.filter((n) => !n.down),
    onHit: (target) => {
      // The first punch that lands on the sitter: everyone else is appalled, at the player
      if (target.id !== config.radio.who || state.foughtBack) return;
      state.foughtBack = true;
      for (const n of npcs) n.onPlayerFoughtBack();
      onlookerTalk.play('playerFoughtBack');
    },
  });

  // --- phases: arrival -> reception (director) -> waiting (told + holding a ticket) ---
  function updatePhase() {
    if (state.toldToTakeNumber && state.ticketNumber != null && state.phase !== 'waiting') {
      state.phase = 'waiting';
    }
  }

  // --- ambient: footsteps, clock tick ---
  player.onStep = () => sfx.footstep();
  let lastSecond = Math.floor(state.clockTime);
  let clockSound; // undefined = not loaded yet, null = loading, false = unavailable, else AudioBuffer
  // --- the radio ---
  // The sitter turns it on at config.radio.at. The player can turn it off; every time they do,
  // she gets up again, angrier and faster, and turns it back on.
  let radioStarted = false, radioLoop = null, radioBuffer = null, stationStart = null;
  const radioPos = () => A.radio.speaker.getWorldPosition(new THREE.Vector3());
  const radioWho = () => npcs.find((n) => n.id === config.radio.who);

  // Where the radio lives on the table, so it can be put back after being carried off
  const radioHome = { pos: A.radio.group.position.clone(), quat: A.radio.group.quaternion.clone() };
  const radioHandle = {
    group: A.radio.group,
    standSpot: A.radio.standSpot,
    faceYaw: A.radio.faceYaw,
    reachTarget: () => A.radio.knob.getWorldPosition(new THREE.Vector3()),
    onReach: () => turnOnRadio(),
    putBack: () => { A.radio.group.position.copy(radioHome.pos); A.radio.group.quaternion.copy(radioHome.quat); },
    drop: (at) => { A.radio.group.position.set(at.x + 0.3, 0, at.z + 0.2); A.radio.group.rotation.set(0, 0.7, 0.15); },
  };

  function sendToRadio(anger) {
    const who = radioWho();
    if (!who || who.down || who.brawling) return; // knocked down (or brawling): the radio war is over
    const V = config.npc.violence;
    if (anger < V.violentFrom) {
      who.startErrand({ ...radioHandle, anger });
      return;
    }
    // Violent: she comes for the player first (escalating), then deals with the radio
    const step = Math.min(V.escalation.length - 1, anger - V.violentFrom);
    who.startViolence({
      kind: V.escalation[step],
      target: () => camera.position.clone(),
      onHit: (kind) => attackLands(who, kind),
      radio: radioHandle,
      anger,
    });
  }

  /** Someone's blow reaches the moment of impact: does it land? */
  function hitPlayer(who, kind) {
    const def = config.npc.attacks[kind];
    const at = who.walker.pos;
    const d = Math.hypot(camera.position.x - at.x, camera.position.z - at.z);
    if (d <= config.npc.attacks.reach) {
      if (player.seat) standHandler.onInteract(); // knocked out of the chair
      const dir = new THREE.Vector3(camera.position.x - at.x, 0, camera.position.z - at.z);
      player.knock(dir, def.knock, def.shake);
      sfx.hit(def.sound, camera.position);
      return true;
    }
    sfx.whoosh(at.clone().setY(1.3));
    return false;
  }

  /** One of the sitter's radio-war blows. */
  function attackLands(who, kind) {
    hitPlayer(who, kind);
    state.sitterAttacks++;
    // After this attack the player can finally fight back
    if (kind === config.npc.violence.fightBackAfter) state.canFightBack = true;
  }

  async function turnOnRadio() {
    if (state.radioOn || state.phase === config.radio.stopAtPhase) return;
    state.radioOn = true;
    A.radio.turnOn();
    sfx.radioClick(radioPos());
    radioBuffer ??= await sfx.loadAudio(config.radio.file);
    if (!radioBuffer || !state.radioOn) return;
    // A station keeps broadcasting while it's off: resume where the song would be by now
    stationStart ??= sfx.ctx.currentTime;
    radioLoop = sfx.playLoop(radioBuffer, radioPos(), config.radio, sfx.ctx.currentTime - stationStart);
  }

  function turnOffRadio() {
    state.radioOn = false;
    A.radio.turnOff();
    sfx.radioClick(radioPos());
    radioLoop?.stop();
    radioLoop = null;
    state.radioOffCount++;
    sendToRadio(state.radioOffCount); // she's up before the static has faded
    complain(state.radioOffCount);
  }

  // From the second time on, she says something about it as she gets up
  let lastComplaint = null;
  function complain(times) {
    const who = radioWho();
    const lines = people[config.radio.who]?.radioComplaints;
    if (!who?.conversation || who.down || !lines?.length || times < 2) return;
    let line = lines[times - 2];
    if (!line) {
      const pool = lines.filter((l) => l !== lastComplaint);
      line = pool[Math.floor(Math.random() * pool.length)];
    }
    lastComplaint = line;
    who.conversation.runActions([
      { do: 'wait', seconds: 0.5 },
      { do: 'say', who: who.id, text: line },
    ]);
  }

  interaction.register(A.radio.group, {
    prompt: () => (state.radioOn && state.phase !== config.radio.stopAtPhase && !radioWho()?.carrying ? '[E] Turn off the radio' : null),
    onInteract: () => { if (state.radioOn) turnOffRadio(); },
  });

  // --- the brawl ---
  const brawl = new Brawl({
    npcs: () => npcs,
    camera,
    onHit: (npc, kind) => hitPlayer(npc, kind),
    say: (id, text) => onlookerTalk.runActions([{ do: 'say', who: id, text }]),
    shouts: brawlShouts,
  });
  // The check-in clipboard as something to carry and swing (the newcomer's opener)
  const clipHome = A.clipboardPath.end;
  const clipboardHandle = {
    group: A.clipboard,
    standSpot: new THREE.Vector3(clipHome.x, 0, clipHome.z + 0.55),
    faceYaw: Math.PI, // facing the counter
    reachTarget: () => A.clipboard.getWorldPosition(new THREE.Vector3()),
    orient: (g, yaw) => g.rotation.set(-1.2, yaw, 0, 'YXZ'), // held upright, board towards the victim
    isHeld: () => !!A.clipboard.userData.held,
    // In someone's hands: physics off (it may have become a physics prop after the player dropped it)
    take: () => { A.clipboard.userData.held = true; A.clipboard.userData.body?.setEnabled(false); },
    drop: (at) => {
      const c = A.clipboard;
      c.userData.held = false;
      c.position.set(at.x + 0.35, 0.01, at.z + 0.2);
      c.rotation.set(0, Math.random() * 6, 0);
      const body = c.userData.body;
      if (body) {
        body.setTranslation({ x: c.position.x, y: 0.05, z: c.position.z }, true);
        body.setRotation({ x: c.quaternion.x, y: c.quaternion.y, z: c.quaternion.z, w: c.quaternion.w }, true);
        body.setEnabled(true);
      }
    },
  };

  // --- improvised weapons: anything can be one (owner's decision) ---
  // Once the player's fists are up, [E] on any of these picks it up (instead of e.g. sitting).
  function registerWeapon(object, kind, canTake = () => true) {
    if (!object) return;
    const fallback = object.userData.interactable; // e.g. "[E] Sit" on a chair
    const label = weaponDef(kind).label ?? kind;
    const can = () => combat.canPickUp && !object.userData.held && canTake();
    interaction.register(object, {
      prompt: () => (can() ? `[E] Pick up ${label}` : fallback?.prompt() ?? null),
      onInteract: () => (can() ? combat.pickUp(object, kind) : fallback?.onInteract()),
    });
  }
  const inBrawl = () => state.phase === 'brawl';
  for (const c of A.chairs) registerWeapon(c.object, 'chair', () => !c.occupant);
  for (const m of A.magazines ?? []) registerWeapon(m, 'magazine');
  for (const u of A.umbrellas ?? []) registerWeapon(u, 'umbrella');
  for (const p of A.plants ?? []) registerWeapon(p, 'plant');
  registerWeapon(A.coolerBottle, 'coolerBottle');
  registerWeapon(A.radio.group, 'radio', () => inBrawl() && !radioWho()?.carrying);
  registerWeapon(A.keyboard, 'keyboard', inBrawl); // she's using it until then
  registerWeapon(A.clipboard, 'clipboard');
  for (const w of A.backRoomWeapons ?? []) registerWeapon(w.object, w.kind);
  for (const n of npcs) if (n.briefcase) registerWeapon(n.briefcase, 'briefcase');

  // The EMPLOYEES ONLY door opens for the player too (the bat is back there)
  A.employeeDoor.playerNear = () => Math.hypot(camera.position.x - A.employeeDoor.threshold.x, camera.position.z - A.employeeDoor.threshold.z) < 1.3;
  let smashTimer = null;
  function startSmash() {
    state.clipboardOffered = false; // it's in his hands now
    newcomer.startClipboardSmash({
      clipboard: clipboardHandle,
      target: brawl.target,
      brawl,
      onSmash: (kind) => {
        hitPlayer(newcomer, kind);
        state.phase = 'brawl';
        state.canFightBack = true;
        brawl.start(newcomer);
      },
    });
  }
  if (brawlNow) {
    // Debug (?brawl): the newcomer walks in right away and starts it
    state.hadCoffee = true;
    A.clipboard.position.copy(clipHome);
  }

  const waitDuration = fastWait ? config.timings.waiting.fastDuration : config.timings.waiting.duration;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  return {
    room,
    director,
    receptionist,
    npcs,
    interaction,
    combat,
    brawl,
    radioStatus: () => ({ started: radioStarted, playing: !!radioLoop }),
    /** Game-time update (not called while paused). */
    update(dt) {
      // Newcomer: arrives config.newcomer.delay seconds after she's back with her coffee
      if (state.hadCoffee && !newcomer) {
        newcomerTimer = (newcomerTimer ?? config.newcomer.delay) - dt;
        if (newcomerTimer <= 0) bringInNewcomer();
      }
      // The entrance door opens for whoever is walking through it
      const nearEntrance = newcomer?.walker.active && newcomer.walker.pos.distanceTo(A.entrance.threshold) < 1.2;
      entranceAngle += ((nearEntrance ? A.entrance.openAngle : 0) - entranceAngle) * (1 - Math.exp(-(nearEntrance ? 6 : 2.5) * dt));
      A.entrance.pivot.rotation.y = entranceAngle;
      // TEMPORARY brawl trigger (until the argument scene is written): a few seconds after
      // "Number 848!", once the newcomer is seated, he goes for the clipboard
      const nextCalled = state.nowServing === config.ticket.number + 1;
      if ((nextCalled || brawlNow) && newcomer && !newcomer.brawling && !newcomer.walker.active && !director.active) {
        smashTimer = (smashTimer ?? (brawlNow ? 1 : config.brawl.placeholderDelay)) - dt;
        if (smashTimer <= 0) startSmash();
      }
      brawl.update(dt);
      combat.enabled = state.canFightBack;
      combat.update(dt);
      const sitter = radioWho();
      if (sitter?.down && !state.sitterDown) state.sitterDown = true;
      room.update(dt);
      director.update(dt);
      for (const d of smallTalk) d.update(dt);
      receptionist.update(dt, camera.position);

      // The wait: counts no matter what the player does (owner's decision)
      if (state.phase === 'waiting' && !state.called && !this.callStarted && !brawl.started) {
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
        const who = radioWho();
        if (who && !who.attending && !who.conversation?.active) {
          radioStarted = true;
          sendToRadio(0);
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
        const CT = config.audio.clockTick;
        if (sfx.ctx && clockSound === undefined) {
          clockSound = null; // loading
          sfx.loadAudio(CT.file).then((b) => { clockSound = b ?? false; });
        }
        // The recording holds a tick and a tock: start it on even seconds. Until it's loaded
        // (or if it's missing), fall back to the synthesised tick every second.
        if (clockSound) { if (sec % 2 === 0) sfx.playOnce(clockSound, clockPos, CT); }
        else sfx.clockTick(clockPos, sec % 2 === 1);
      }
    },
    /** Every rendered frame. */
    frame() {
      room.clock.update(state.clockTime);
      interaction.update();
    },
  };
}
