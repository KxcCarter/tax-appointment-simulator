import './ui.css';

const CONTROLS = [
  'MOUSE ........ look',
  'W A S D ...... walk',
  'SHIFT ........ walk briskly',
  'E ............ interact',
  'R ............ pick up (when there is a fight on)',
  'LEFT CLICK ... punch / swing',
  'F ............ kick',
  'RIGHT CLICK .. block (hold)',
  'Q ............ throw what you hold',
  'ESC .......... pause',
].join('\n');

/** HTML overlay: title screen, pause menu, crosshair, prompt, toasts. */
export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers; // { onBegin, onResume }
    root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="crosshair"></div>
        <div id="prompt" class="hidden"></div>
      </div>
      <div id="ticket" class="hidden"></div>
      <div id="health" class="hidden"><div id="health-fill"></div></div>
      <div id="knockdowns" class="hidden"></div>
      <div id="held" class="hidden"></div>
      <div id="fighthelp" class="hidden"></div>
      <div id="hurt-blur"></div>
      <div id="hurt-blood"></div>
      <div id="damage"></div>
      <div id="fade"></div>
      <div id="endcard" class="hidden"></div>
      <div id="dialogue" class="hidden">
        <div id="dlg-speaker"></div>
        <div id="dlg-text"></div>
        <ol id="dlg-choices" class="hidden"></ol>
        <div id="dlg-timer" class="hidden"><div id="dlg-timer-fill"></div></div>
        <div id="dlg-hint" class="hidden">1–4, or move the mouse and click · E to step away</div>
      </div>
      <div id="fps" class="hidden"></div>
      <div id="debugbeat" class="hidden"></div>
      <div id="skipping" class="hidden"></div>
      <div id="toast" style="opacity:0"></div>

      <div id="loading" class="screen">
        <div class="subtitle">LOADING . . .</div>
      </div>

      <div id="title" class="screen hidden">
        <h1 class="title">INCOME TAX APPOINTMENT SIMULATOR</h1>
        <div class="subtitle blink">Click to begin.</div>
        <div class="style-pick" id="style-pick">CHARACTERS:
          <button data-style="realistic">Realistic</button><button data-style="cartoon">Cartoon</button></div>
        <div class="controls">${CONTROLS}</div>
      </div>

      <div id="pause" class="screen overlay hidden">
        <h2 class="title" style="font-size:1.8rem">PAUSED</h2>
        <div class="menu">
          <button id="btn-resume">Resume</button>
        </div>
        <div class="controls">${CONTROLS}</div>
      </div>
    `;
    this.$ = (id) => root.querySelector('#' + id);

    this.$('title').addEventListener('click', () => handlers.onBegin());
    // Realistic or cartoon characters (main.js; picking the other one reloads the game)
    for (const b of this.$('style-pick').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.style === (handlers.characterStyle ?? 'realistic'));
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // (not "click to begin")
        if (b.dataset.style !== handlers.characterStyle || handlers.styleFromUrl) handlers.onCharacterStyle?.(b.dataset.style); // (the URL's choice isn't saved: saving it is a change)
      });
    }
    this.$('btn-resume').addEventListener('click', (e) => { e.stopPropagation(); handlers.onResume(); });
    // Clicking anywhere on the pause backdrop also resumes
    this.$('pause').addEventListener('click', () => handlers.onResume());
  }

  ready() {
    this.$('loading').classList.add('hidden');
    this.$('title').classList.remove('hidden');
  }

  showError(msg) {
    this.$('loading').innerHTML = `<div class="subtitle">ERROR</div><div class="controls">${msg}</div>`;
  }

  hideTitle() { this.$('title').classList.add('hidden'); }

  showHud(on) { this.$('hud').classList.toggle('hidden', !on); }

  showPause(on) { this.$('pause').classList.toggle('hidden', !on); }

  setPrompt(text) {
    const p = this.$('prompt');
    p.classList.toggle('hidden', !text);
    if (text) p.textContent = text;
  }

  // ------------------------------------------------------------ dialogue

  /** Show a line (text may be partial while it types out). */
  showLine(speaker, text) {
    this.$('dialogue').classList.remove('hidden');
    this.$('dlg-speaker').textContent = speaker;
    this.$('dlg-text').textContent = text;
    this.$('dlg-text').classList.remove('hidden');
    // Someone else talking while a menu is open (a remark, the radio, an overheard line): the line shows
    // above the choices, which stay open. Hiding them would leave the player stuck in a menu they can't see.
    if (this.choicesOpen) return;
    this.$('dlg-choices').classList.add('hidden');
    this.$('dlg-hint').classList.add('hidden');
  }

  /**
   * Clear a finished line. An open choice menu belongs to whoever opened it and is left alone
   * (its line is cleared, the choices stay); closeChoices() closes it.
   */
  hideDialogue() {
    if (this.choicesOpen) {
      this.$('dlg-text').classList.add('hidden');
      this.$('dlg-speaker').textContent = 'YOU';
      return;
    }
    this.$('dialogue').classList.add('hidden');
  }

  /** Close an open choice menu without picking (it doesn't tell its owner; for the end of the game). */
  closeChoices() {
    this._closeChoices();
    this.$('dialogue').classList.add('hidden');
  }

  /**
   * Show numbered choices. onPick(index) or onCancel() is called once.
   * canInput() lets the caller ignore input while paused.
   */
  showChoices(options, { onPick, onCancel, canInput, context = null }) {
    const box = this.$('dialogue');
    const list = this.$('dlg-choices');
    box.classList.remove('hidden');
    // Optionally keep the line being answered above the choices
    this.$('dlg-speaker').textContent = context ? context.speaker : 'YOU';
    this.$('dlg-text').textContent = context ? context.text : '';
    this.$('dlg-text').classList.toggle('hidden', !context);
    list.classList.remove('hidden');
    const hint = this.$('dlg-hint');
    hint.classList.remove('hidden');
    hint.textContent = `${options.length > 1 ? `1–${Math.min(9, options.length)}` : '1'}, or move the mouse and click · E to step away`; // the number keys that work
    list.innerHTML = '';
    options.forEach((o, i) => {
      const li = document.createElement('li');
      li.textContent = o.text;
      li.addEventListener('mouseenter', () => setSel(i));
      list.appendChild(li);
    });
    let sel = 0, accum = 0, done = false;
    this.choicesOpen = true;
    const setSel = (i) => {
      sel = (i + options.length) % options.length;
      [...list.children].forEach((li, k) => li.classList.toggle('selected', k === sel));
    };
    setSel(0);
    const finish = (fn) => { if (done) return; done = true; this._closeChoices(); fn(); };
    const onKey = (e) => {
      if (!canInput()) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= options.length) { e.preventDefault(); finish(() => onPick(n - 1)); }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') setSel(sel - 1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') setSel(sel + 1);
      else if (e.code === 'Enter' || e.code === 'Space') finish(() => onPick(sel));
      else if (e.code === 'KeyE' && !e.repeat) finish(() => onCancel());
    };
    const onMove = (e) => {
      if (!canInput() || !document.pointerLockElement) return;
      accum += e.movementY;
      if (Math.abs(accum) > 45) { setSel(sel + Math.sign(accum)); accum = 0; }
    };
    const onWheel = (e) => { if (canInput()) setSel(sel + Math.sign(e.deltaY)); };
    const onDown = (e) => {
      if (!canInput() || e.button !== 0) return;
      e.preventDefault();
      finish(() => onPick(sel));
    };
    // Registered on the next tick so the E press that opened the menu doesn't close it
    setTimeout(() => {
      if (done) return;
      document.addEventListener('keydown', onKey);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('wheel', onWheel);
      document.addEventListener('mousedown', onDown);
    }, 0);
    this._closeChoices = () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('mousedown', onDown);
      list.classList.add('hidden');
      this.$('dlg-hint').classList.add('hidden');
      box.classList.add('hidden');
      this.choicesOpen = false;
      this._closeChoices = () => {};
    };
  }

  _closeChoices() {}

  /** The choice timer (the argument): how much time is left, 1..0, or null to hide it. */
  setChoiceTimer(f) {
    const el = this.$('dlg-timer');
    el.classList.toggle('hidden', f == null);
    if (f == null) return;
    this.$('dlg-timer-fill').style.width = `${Math.max(0, f) * 100}%`;
    el.classList.toggle('low', f < 0.35);
  }

  setTicket(n) {
    const el = this.$('ticket');
    el.classList.toggle('hidden', n == null);
    if (n != null) el.textContent = `TICKET  ${n}`;
  }

  /** Player health 0..1, or null to hide the bar. */
  setHealth(f) {
    const el = this.$('health');
    el.classList.toggle('hidden', f == null);
    if (f == null) return;
    this.$('health-fill').style.width = `${Math.max(0, f) * 100}%`;
    el.classList.toggle('low', f < 0.3);
  }

  /** "Knocked down: n / of", or null to hide. */
  setKnockdowns(n, of) {
    const el = this.$('knockdowns');
    el.classList.toggle('hidden', n == null);
    if (n != null) el.textContent = `Knocked down: ${n} / ${of}`;
  }

  /** Name of the held weapon, or null. */
  setHeld(name) {
    const el = this.$('held');
    el.classList.toggle('hidden', !name);
    if (name) el.textContent = name;
  }

  /** The fight options panel (lines), or null to hide it. */
  setFightHelp(lines) {
    const el = this.$('fighthelp');
    const text = lines ? lines.join('\n') : '';
    el.classList.toggle('hidden', !lines);
    if (el.textContent !== text) el.textContent = text;
  }

  /**
   * How hurt the player looks (0..1): blood at the edges of the screen, the edges of the view blurred and greyed.
   * blur (px) and desaturate (0..1) at full strength.
   */
  setHurt(level, { blur = 6, desaturate = 0.7 } = {}) {
    const k = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
    if (k === this._hurt) return;
    this._hurt = k;
    if (!this._bloodDrawn && k > 0) this._drawBlood();
    this.$('hurt-blood').style.opacity = String(Math.min(1, k * 1.15));
    const f = k > 0 ? `blur(${(blur * k).toFixed(1)}px) saturate(${(1 - desaturate * k).toFixed(2)})` : 'none';
    const el = this.$('hurt-blur');
    el.style.backdropFilter = f;
    el.style.webkitBackdropFilter = f;
  }

  /** The blood overlay: splatters, smears and drips round the edges, clear in the middle (drawn once). */
  _drawBlood() {
    this._bloodDrawn = true;
    const W = 1280, H = 800, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const red = css.getPropertyValue('--hurt-blood').trim() || '#8a0c08', dark = css.getPropertyValue('--hurt-blood-dark').trim() || '#3a0303';
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // A point near an edge (more towards the corners)
    const edgePoint = () => {
      const side = Math.floor(rnd() * 4), t = rnd(), d = Math.pow(rnd(), 2.2) * 0.22;
      return side === 0 ? [t * W, d * H] : side === 1 ? [t * W, H - d * H] : side === 2 ? [d * W, t * H] : [W - d * W, t * H];
    };
    // Soft smears
    for (let i = 0; i < 70; i++) {
      const [x, y] = edgePoint(), r = 40 + rnd() * 140;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, red); grad.addColorStop(1, 'transparent');
      g.globalAlpha = 0.25 + rnd() * 0.35;
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // Splatters: a blot with droplets round it, and some drips running down
    for (let i = 0; i < 26; i++) {
      const [x, y] = edgePoint(), r = 8 + rnd() * 26;
      g.globalAlpha = 0.7 + rnd() * 0.3;
      g.fillStyle = rnd() < 0.4 ? dark : red;
      g.beginPath();
      for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
      for (let k = 0; k < 10; k++) { const a = rnd() * Math.PI * 2, d = r * (1.2 + rnd() * 2.2); g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rnd() * 4, 0, Math.PI * 2); g.fill(); }
      if (rnd() < 0.5) { const len = 30 + rnd() * 120, w = 2 + rnd() * 5; g.fillRect(x - w / 2, y, w, len); g.beginPath(); g.arc(x, y + len, w * 0.9, 0, Math.PI * 2); g.fill(); }
    }
    // Darkened corners under it all
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-over';
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, 'transparent'); v.addColorStop(1, dark);
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    this.$('hurt-blood').style.backgroundImage = `url(${c.toDataURL()})`;
  }

  /** A red flash at the edges of the screen (strength 0..1). */
  damageFlash(strength = 1) {
    const el = this.$('damage');
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, 0.35 + strength * 0.65));
    requestAnimationFrame(() => { el.style.transition = 'opacity 0.45s'; el.style.opacity = '0'; });
  }

  /** Fade the screen to black (true) or back (false). Resolves when done. */
  fade(toBlack, seconds = 1.2) {
    const el = this.$('fade');
    el.style.transition = `opacity ${seconds}s`;
    el.style.opacity = toBlack ? '1' : '0';
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  /** The end card ("To be continued.") with a few dry statistics. */
  showEndCard(title, lines) {
    const el = this.$('endcard');
    el.innerHTML = `<div class="title">${title}</div><div class="stats">${lines.join('\n')}</div>`;
    el.classList.remove('hidden');
  }

  setFps(fps) {
    const el = this.$('fps');
    el.classList.toggle('hidden', fps == null);
    if (fps != null) el.textContent = `${fps.toFixed(0)} fps`;
  }

  /** Debug: the current beat(s), top left; null hides it. */
  setDebugBeat(text) {
    const el = this.$('debugbeat');
    el.classList.toggle('hidden', text == null);
    if (text != null && el.textContent !== text) el.textContent = text;
  }

  /** Debug (?beat=): a notice while the game fast-forwards; null hides it. */
  setSkipping(text) {
    const el = this.$('skipping');
    el.classList.toggle('hidden', text == null);
    if (text != null) el.textContent = text;
  }

  toast(text, seconds = 1.5) {
    const el = this.$('toast');
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.style.opacity = '0'; }, seconds * 1000);
  }
}
