import * as THREE from 'three';
import { config } from '../config.js';

/*
  "Look at a thing and press E."
  A ray from the centre of the screen finds the nearest surface within reach.
  If it (or any parent) was registered, its prompt is shown and E triggers it.

  register(object, {
    prompt: () => '[E] Talk' | null,   // null = not interactable right now
    range: 3.5,                         // optional: reach in metres (default config.interaction.maxDistance)
    onInteract: () => {},
    // optional second action on another key, shown beside the first:
    alt: { prompt: () => '[R] Pick up chair' | null, onInteract: () => {} },
  })
*/
export class Interaction {
  constructor(camera, scene, ui, player) {
    this.camera = camera;
    this.scene = scene;
    this.ui = ui;
    this.player = player;
    this.raycaster = new THREE.Raycaster();
    // Long enough for the farthest-reaching thing (e.g. a sign read from across the counter); each
    // interactable is then checked against its own `range` (default config.interaction.maxDistance)
    this.raycaster.far = Math.max(config.interaction.maxDistance, config.interaction.readDistance ?? 0);
    this.current = null;
    this.override = null; // e.g. seated: always "[E] Stand"

    document.addEventListener('keydown', (e) => {
      if (e.repeat || !this.player.canAct) return;
      const h = this.override ?? this.current;
      if (!h) return;
      if (e.code === 'KeyE' && h.prompt()) h.onInteract();
      else if (e.code === 'KeyR' && h.alt?.prompt()) h.alt.onInteract();
    });
  }

  register(object3d, handler) {
    object3d.userData.interactable = handler;
  }

  /** Force one interaction regardless of what we look at (or null to clear). */
  setOverride(handler) {
    this.override = handler;
  }

  update() {
    if (!this.player.canAct) {
      this.current = null;
      this.ui.setPrompt(null);
      return;
    }
    if (this.override) {
      this.current = null;
      this.ui.setPrompt(this.override.prompt());
      return;
    }
    this.raycaster.setFromCamera(_centre, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    let found = null;
    for (const hit of hits) {
      if (!hit.object.visible || hit.object.isLight || hit.object.userData.heldMesh) continue; // not what's in your hands
      let o = hit.object;
      while (o && !o.userData.interactable) o = o.parent;
      if (o && hit.distance <= (o.userData.interactable.range ?? config.interaction.maxDistance)) found = o.userData.interactable;
      break; // first solid thing blocks anything behind it
    }
    const text = found ? [found.prompt(), found.alt?.prompt()].filter(Boolean).join('     ') || null : null;
    this.current = text ? found : null;
    this.ui.setPrompt(text);
  }
}

const _centre = new THREE.Vector2(0, 0);
