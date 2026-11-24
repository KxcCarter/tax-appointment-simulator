import * as THREE from 'three';
import { config } from '../config.js';
import { state } from '../state.js';
import { buildWaitingRoom } from './waitingRoom.js';
import { Receptionist } from '../characters/receptionist.js';
import { Director } from '../director/director.js';
import { waitingRoomBeats } from '../data/waitingRoomBeats.ts';
import { roomRemarks, trespassLines } from '../data/roomRemarks.ts';
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
  // Props landing and hitting things are heard (Milestone 5: sound for everything)
  physics.onImpact = (pos, strength, object, mass) => sfx.propHit(pos, strength, object.userData.impactSound, mass);
  const A = room.anchors;
  let receptionistQuip = 12, quipIndex = 0; // her remarks during the brawl
  let calledBrawlTimer = null; // after his number is called: the brawl starts (set from the director's events)
  let smashWanted = false;     // the argument is over: the newcomer goes for the clipboard
  let lastLine = null;         // the director's line being typed (who's talking, for the newcomer)

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
      if (type === 'clipboardSmash' && config.brawl.enabled) smashWanted = true; // the end of the argument: he grabs the clipboard
      if (type === 'set' && key === 'newcomerSentIn' && state.newcomerSentIn && newcomer) {
        const d = A.accountantDoor.pivot.position, P = config.npc.newcomerPush;
        newcomer.leaveFor(new THREE.Vector3(d.x + 0.5, 0, d.z + P.stopShort), Math.PI); // never goes in
      }
      if (type === 'set' && key === 'nowServing') {
        room.nowServing.setNumber(state.nowServing);
        sfx.chime(A.nowServing.getWorldPosition(new THREE.Vector3()));
        // His number: the newcomer gets up and goes to stand at the counter, beside the player
        if (state.nowServing === config.ticket.number + 1 && newcomer) {
          const c = A.clipboardPath.end;
          newcomer.goStand(new THREE.Vector3(c.x + 0.8, 0, c.z + 0.55), Math.PI);
        }
      }
      if (type === 'set' && key === 'called') {
        for (const n of npcs) n.onCalled();
        if (config.brawl.enabled) calledBrawlTimer = config.brawl.afterCalled; // the brief: called -> indignant -> brawl
      }
      updatePhase();
    },
  });

  for (const n of npcs) {
    const data = npcConversations[n.id];
    if (!data) continue;
    const d = new Director({
      data, state, ui, sfx, actors, player, config,
      onEvent: (type) => { if (type === 'jiggleAsked') jiggleAsked(); },
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
    newcomer.hitPlayer = (w, k) => hitPlayer(w, k);
    newcomer.onKnockedDown = (n) => onKnockedDown(n);
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
    targets: () => npcs, // the downed too: hitting them makes them flop (combat.js)
    onHit: (target) => {
      state.hitStop = config.combat.hitStop; // a tiny freeze on impact (main loop)
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
      // Blocking (right mouse, held): blows from the front mostly stop on the raised arms
      const Bk = config.combat.block;
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const fromFront = -dir.clone().normalize().dot(fwd) > Bk.arc;
      if (combat.block > 0.6 && fromFront) {
        player.knock(dir, def.knock * Bk.knock, def.shake * Bk.shake);
        sfx.hit('block', camera.position);
        hurtPlayer((def.damage ?? 0) * Bk.damage, who);
        who.walker.stun = Bk.attackerStun; // the blow bounces off; they stagger
        return true;
      }
      player.knock(dir, def.knock, def.shake);
      sfx.hit(def.sound, camera.position);
      hurtPlayer(def.damage ?? 0, who);
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
  combat.onBreak = (line) => ui.toast(line, 2.5);
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
    standSpot: new THREE.Vector3(clipHome.x - 0.65, 0, clipHome.z + 0.55), // beside where the player stands at the counter
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

  // --- side scenarios: the bouncing knee, the man who wants the time ---
  const byId = (id) => npcs.find((n) => n.id === id);
  function jiggleAsked() {
    const j = byId('jiggler'), J = config.npc.jiggle;
    if (!j || state.jiggleAsks < 2) return; // the first time: "Stop what?"
    j.jiggleStop = J.stopFor / Math.pow(2, state.jiggleAsks - 2);
    j.jiggleRate = (j.jiggleRate ?? 1) * J.faster;
  }
  const nextTo = (n) => {
    const mine = A.chairs.find((c) => c.occupant === 'player');
    return mine && n && !n.walker.active && mine.object.position.distanceTo(n.chair.object.position) < config.npc.crowdedDistance;
  };
  let besideWatch = 0, askGap = 0;
  function sideScenarios(dt) {
    // Sitting next to the jiggler, the seat bounces with his knee
    const j = byId('jiggler');
    player.seatBob = nextTo(j) && !j.brawling ? (j.footLiftNow ?? 0) * config.npc.jiggle.seatShake : 0;
    // Sitting next to the man with the watch: after a while he asks the time
    const w = byId('watchChecker'), Q = config.npc.askTime;
    askGap -= dt;
    if (nextTo(w) && !state.called && calm()) besideWatch += dt; else besideWatch = 0;
    if (besideWatch > Q.after && askGap <= 0 && state.timeAsks < Q.max && w.conversation && !anyActive(null)) {
      askGap = Q.every;
      state.timeAsks++;
      w.conversation.runNow('askTime').then(() => {
        const c = w.conversation;
        if (c.current?.autoOpen && !c.active) c.openChoices(c.current);
      });
    }
  }

  // --- things to look at (easter eggs; src/data/roomRemarks.ts) ---
  const remarkCount = {};
  function clockText() {
    const t = Math.floor(state.clockTime / 60) % 720;
    return `It's ${Math.floor(t / 60) || 12}:${String(t % 60).padStart(2, '0')}.`;
  }
  function remark(key) {
    const set = roomRemarks[key];
    const i = remarkCount[key] = (remarkCount[key] ?? -1) + 1;
    const line = set.loop ? set.lines[i % set.lines.length] : set.lines[Math.min(i, set.lines.length - 1)];
    if (typeof line === 'string') {
      const text = line === 'CLOCK' ? clockText() : line;
      ui.toast(text, 1.6 + text.length * 0.035);
    } else if (!onlookerTalk.active) {
      onlookerTalk.runActions([{ do: 'say', who: line.who, text: line.text }]);
    }
  }
  function lookable(object, key, when = () => true, then = null, range) {
    if (!object) return;
    interaction.register(object, {
      range,
      prompt: () => (when() ? roomRemarks[key].prompt : null),
      onInteract: () => { if (!when()) return; then?.(); remark(key); },
    });
  }
  const calm = () => state.phase !== 'brawl' && state.phase !== 'doorOpen';
  lookable(A.poster, 'poster', undefined, null, config.interaction.readDistance);
  lookable(A.certificate, 'certificate', undefined, null, config.interaction.readDistance);
  lookable(A.arrivalSign, 'arrivalSign', undefined, null, config.interaction.readDistance); // readable from the counter
  lookable(A.walkInSign, 'walkInSign', undefined, null, config.interaction.readDistance);
  lookable(A.plants?.[0], 'plantWest');
  lookable(A.plants?.[1], 'plantEast');
  for (const c of A.cabinets ?? []) lookable(c, 'cabinets', calm);
  lookable(A.coat, 'coat');
  lookable(A.nowServing, 'nowServing', calm);
  lookable(A.clock, 'clock');
  lookable(A.crtScreen ?? A.crt, 'screen', calm);
  for (const m of A.magazines ?? []) lookable(m, 'magazine');
  lookable(A.coolerBottle, 'water', calm, () => sfx.glug(A.coolerBottle.getWorldPosition(new THREE.Vector3())));
  // The dispenser, once you have a ticket
  {
    const take = A.ticketDispenser.userData.interactable;
    interaction.register(A.ticketDispenser, {
      prompt: () => take.prompt() ?? roomRemarks.dispenserAgain.prompt,
      onInteract: () => (state.ticketNumber == null ? take.onInteract() : remark('dispenserAgain')),
    });
  }
  // Behind the desk or in the back room, she notices (not during the brawl)
  let trespassCooldown = 0, trespassCount = 0;
  let shoveCooldown = 0, lookTimer = 0;
  function sayTrespass() {
    if (trespassCooldown > 0 || onlookerTalk.active || director.active) return;
    trespassCooldown = 18;
    onlookerTalk.runActions([{ do: 'say', who: 'receptionist', text: trespassLines[Math.min(trespassCount++, trespassLines.length - 1)] }]);
  }
  function checkTrespass(dt) {
    trespassCooldown -= dt;
    shoveCooldown -= dt;
    const p = camera.position;
    const behind = (p.z < -3.75 && p.x < -0.95) || p.z < -5.1;
    const away = receptionist.walker?.active; // off getting coffee
    // She looks up while shoving; back to the game once he has backed off
    if (lookTimer > 0 && (lookTimer -= dt) <= 0 && !director.active) receptionist.play('resumeSolitaire');
    if (!behind || !calm() || away) return;
    sayTrespass();
    // Her space: nobody gets closer than R to her chair (until the brawl)
    const R = config.npc.receptionistSpace;
    const her = receptionist.rig.root.position;
    const out = new THREE.Vector3(p.x - her.x, 0, p.z - her.z);
    const d = out.length();
    if (d >= R.radius) return;
    if (d < 1e-3) out.set(1, 0, 0); else out.divideScalar(d);
    if (player.seat) return;
    // Hold him out: faster than he can walk in
    const along = player.knockVel.dot(out);
    if (along < R.holdSpeed) player.knockVel.addScaledVector(out, R.holdSpeed - along);
    // ...with an audible shove on the way in
    if (shoveCooldown <= 0) {
      shoveCooldown = R.shoveEvery;
      player.knock(out, R.shoveSpeed, R.shake);
      sfx.hit('shove', camera.position);
      if (!director.active) receptionist.play('lookAtPlayer');
      lookTimer = R.lookFor;
    }
  }

  // --- improvised weapons: anything can be one (owner's decision) ---
  // Once the player's fists are up, anything registered here can be picked up. If it also has its
  // normal use (Sit, Sign the sheet, Turn off the radio), that stays on E and picking up goes on R.
  function registerWeapon(object, kind, canTake = () => true) {
    if (!object) return;
    const fallback = object.userData.interactable; // e.g. "[E] Sit" on a chair
    const label = weaponDef(kind).label ?? kind;
    const can = () => combat.canPickUp && !object.userData.held && canTake();
    const take = () => combat.pickUp(object, kind);
    interaction.register(object, {
      prompt: () => fallback?.prompt() ?? (can() ? `[E] Pick up ${label}` : null),
      onInteract: () => (fallback?.prompt() ? fallback.onInteract() : can() && take()),
      alt: {
        prompt: () => (fallback?.prompt() && can() ? `[R] Pick up ${label}` : null),
        onInteract: () => can() && take(),
      },
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
  let smashTimer = null, smashStarted = false;
  function startSmash() {
    smashStarted = true; // once: after the failure loop, the brawl restarts without the opener
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

  // --- the player's health (brawl only; the radio war stays feel-only) ---
  const B = config.brawl;
  state.playerHealth = B.playerHealth;
  let failing = false, restartTimer = null;
  function hurtPlayer(damage, who) {
    if (state.phase !== 'brawl' || failing || damage <= 0) return;
    state.playerHealth = Math.max(0, state.playerHealth - damage);
    ui.damageFlash(damage / 20);
    if (state.playerHealth <= 0) fail();
  }

  /**
   * Losing (proposal in the brief, fits the tone): the screen fades; the player wakes up seated in a
   * waiting-room chair holding a new ticket with an even higher number. Everyone is back in their
   * seats as if nothing happened, and a few seconds later it starts again.
   */
  async function fail() {
    if (failing) return;
    failing = true;
    player.block('failure', true);
    combat.drop(false);
    sfx.bodyThud(camera.position, 1);
    const F = B.failure;
    await ui.fade(true, F.fadeOut);
    await new Promise((r) => setTimeout(r, F.blackFor * 1000));
    state.ticketNumber = Math.round((state.ticketNumber ?? config.ticket.number) * F.ticketMultiplier);
    ui.setTicket(state.ticketNumber.toLocaleString('en-US'));
    state.playerHealth = B.playerHealth;
    state.knockdowns = 0;
    state.retries = (state.retries ?? 0) + 1;
    for (const n of npcs) n.resetToSeat();
    brawl.reset?.();
    // Wake up in a free chair
    const seat = A.chairs.find((c) => canSit(c));
    if (seat) {
      if (player.seat) standHandler.onInteract();
      seat.occupant = 'player';
      player.sit(seat.object);
      interaction.setOverride(standHandler);
    }
    await ui.fade(false, F.fadeIn);
    player.block('failure', false);
    failing = false;
    onlookerTalk.runActions([{ do: 'wait', seconds: 1.2 }, { do: 'say', who: 'receptionist', text: `Number ${state.ticketNumber.toLocaleString('en-US')}. Please have a seat. We'll call you.` }]);
    restartTimer = F.restartAfter;
  }

  // --- knockdowns: at config.brawl.knockdownsToOpen the accountant's door unlocks ---
  for (const n of npcs) { n.onKnockedDown = onKnockedDown; n.hitPlayer = hitPlayer; } // hitPlayer: scripted slaps and shoves
  function onKnockedDown() {
    state.knockdowns++;
    if (state.knockdowns >= B.knockdownsToOpen && state.phase === 'brawl') {
      state.phase = 'doorOpen';
      sfx.doorUnlock?.(A.accountantDoor.pivot.getWorldPosition(new THREE.Vector3()));
      ui.toast('Click.', 1.5);
    }
  }

  // --- the accountant's door ---
  const accDoor = A.accountantDoor;
  let accAngle = 0, accOpen = false, ended = false;
  interaction.register(accDoor.pivot, {
    prompt: () => {
      if (accOpen) return null;
      if (state.phase === 'doorOpen') return '[E] Open the door';
      return state.phase === 'brawl' ? '[E] Try the door' : roomRemarks.accountantDoor.prompt;
    },
    onInteract: () => {
      if (state.phase !== 'doorOpen' && state.phase !== 'brawl') {
        sfx.knock(accDoor.pivot.getWorldPosition(new THREE.Vector3()));
        setTimeout(() => remark('accountantDoor'), 700);
        return;
      }
      if (state.phase === 'doorOpen') {
        accOpen = true;
        physics.world.removeCollider(accDoor.collider, true);
        sfx.doorOpen?.(accDoor.pivot.getWorldPosition(new THREE.Vector3()));
      } else {
        sfx.doorRattle?.(accDoor.pivot.getWorldPosition(new THREE.Vector3()));
        ui.toast('Locked.', 1.2);
      }
    },
  });
  const doorPos = accDoor.pivot.getWorldPosition(new THREE.Vector3());

  /** Through the door: the end card (Milestone 5). */
  async function end() {
    ended = true;
    state.ended = true;
    player.block('end', true);
    brawl.reset(); // no more shouting
    await ui.fade(true, 1.5);
    const t = Math.floor(state.clockTime / 60) % 720, h = Math.floor(t / 60) || 12, m = String(t % 60).padStart(2, '0');
    ui.showEndCard('To be continued.', [
      `Ticket: ${(state.ticketNumber ?? config.ticket.number).toLocaleString('en-US')}`,
      `Time on the clock: ${h}:${m}`,
      `Appointment: 2:00`,
      `Times woken up in a chair: ${state.retries ?? 0}`,
      `Times the radio was turned off: ${state.radioOffCount}`,
    ]);
    ui.hideDialogue();
    document.exitPointerLock?.();
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
      // The argument (beats argument_*) ends with { do: 'emit', event: 'clipboardSmash' }; ?brawl skips to it
      if ((smashWanted || brawlNow) && !smashStarted && newcomer && !newcomer.brawling && !director.active && (smashWanted || !newcomer.walker.active)) {
        smashTimer = (smashTimer ?? (brawlNow && !smashWanted ? config.brawl.placeholderDelay : 0)) - dt;
        if (smashTimer <= 0) startSmash();
      }
      // Called (847) before anything else started a fight: indignation, then the brawl
      if (calledBrawlTimer != null && !brawl.started && state.phase !== 'doorOpen') {
        calledBrawlTimer -= dt;
        if (calledBrawlTimer <= 0) {
          calledBrawlTimer = null;
          state.phase = 'brawl';
          state.canFightBack = true;
          brawl.start(null, brawlShouts.called);
        }
      }
      // The newcomer, once sent in: protests stop him; when he speaks he comes back at the player
      const ty = director.typing;
      if (ty && ty !== lastLine && newcomer?.leaving) {
        const sp = director.data.speakers;
        if (ty.speaker === sp.player?.name) newcomer.halt();
        else if (ty.speaker === sp.newcomer?.name) newcomer.pressIn();
      }
      lastLine = ty;
      brawl.update(dt);
      // She keeps playing solitaire through all of it, with the odd remark
      if (brawl.started && !ended) {
        receptionistQuip -= dt;
        if (receptionistQuip <= 0 && !onlookerTalk.active) {
          receptionistQuip = 14 + Math.random() * 10;
          const lines = brawlShouts.receptionist;
          onlookerTalk.runActions([{ do: 'say', who: 'receptionist', text: lines[quipIndex++ % lines.length] }]);
        }
      }
      // Fists up only while there's a fight on: the brawl, or the sitter coming at him (after her kick)
      const sitterNow = radioWho();
      combat.enabled = state.canFightBack && (state.phase === 'brawl' || state.phase === 'doorOpen' || !!(sitterNow?.violent && !sitterNow.down));
      combat.update(dt);
      checkTrespass(dt);
      player.speedMul = combat.enabled ? config.combat.moveSpeedMul : 1; // quicker on your feet in a fight
      // Fight options (only while the fists are up)
      ui.setFightHelp(combat.enabled ? (combat.held
        ? [`LEFT CLICK ...... swing the ${combat.held.def.label}`, 'F ............... kick', 'RIGHT CLICK ..... block (hold)', 'Q ............... throw it', 'R ............... pick up something else']
        : ['LEFT CLICK ...... punch (quick 3rd: hook)', 'F ............... kick', 'RIGHT CLICK ..... block (hold)', 'R ............... pick something up']) : null);
      // Brawl HUD
      const fighting = state.phase === 'brawl' || state.phase === 'doorOpen';
      ui.setHealth(fighting ? state.playerHealth / B.playerHealth : null);
      ui.setKnockdowns(fighting ? Math.min(state.knockdowns, B.knockdownsToOpen) : null, B.knockdownsToOpen);
      ui.setHeld(combat.held?.def.label ?? null);
      if (restartTimer != null && !failing) {
        restartTimer -= dt;
        if (restartTimer <= 0) { restartTimer = null; brawl.restart(); }
      }
      // The accountant's door swings open; walking through it ends the level
      accAngle += ((accOpen ? -1.45 : 0) - accAngle) * (1 - Math.exp(-3 * dt));
      accDoor.pivot.rotation.y = accAngle;
      if (accOpen && !ended && camera.position.z < doorPos.z - 0.25 && Math.abs(camera.position.x - doorPos.x - 0.5) < 0.9) end();
      const sitter = radioWho();
      if (sitter?.down && !state.sitterDown) state.sitterDown = true;
      room.update(dt);
      director.update(dt);
      for (const d of smallTalk) d.update(dt);
      receptionist.update(dt, camera.position);

      // The wait: counts no matter what the player does (owner's decision)
      if (config.timings.call.enabled && state.phase === 'waiting' && !state.called && !this.callStarted && !brawl.started) {
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

      sideScenarios(dt);

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
