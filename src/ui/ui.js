import './ui.css';

const CONTROLS = [
  'MOUSE ........ look',
  'W A S D ...... walk',
  'SHIFT ........ walk briskly',
  'E ............ interact',
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
      <div id="dialogue" class="hidden">
        <div id="dlg-speaker"></div>
        <div id="dlg-text"></div>
        <ol id="dlg-choices" class="hidden"></ol>
        <div id="dlg-hint" class="hidden">1–4, or move the mouse and click · E to step away</div>
      </div>
      <div id="fps" class="hidden"></div>
      <div id="toast" style="opacity:0"></div>

      <div id="loading" class="screen">
        <div class="subtitle">LOADING . . .</div>
      </div>

      <div id="title" class="screen hidden">
        <h1 class="title">INCOME TAX APPOINTMENT SIMULATOR</h1>
        <div class="subtitle blink">Click to begin.</div>
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
    this.$('dlg-choices').classList.add('hidden');
    this.$('dlg-hint').classList.add('hidden');
  }

  hideDialogue() {
    this.$('dialogue').classList.add('hidden');
    this._closeChoices();
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
    this.$('dlg-hint').classList.remove('hidden');
    list.innerHTML = '';
    options.forEach((o, i) => {
      const li = document.createElement('li');
      li.textContent = o.text;
      li.addEventListener('mouseenter', () => setSel(i));
      list.appendChild(li);
    });
    let sel = 0, accum = 0, done = false;
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
      this._closeChoices = () => {};
    };
  }

  _closeChoices() {}

  setTicket(n) {
    const el = this.$('ticket');
    el.classList.toggle('hidden', n == null);
    if (n != null) el.textContent = `TICKET  ${n}`;
  }

  setFps(fps) {
    const el = this.$('fps');
    el.classList.toggle('hidden', fps == null);
    if (fps != null) el.textContent = `${fps.toFixed(0)} fps`;
  }

  toast(text, seconds = 1.5) {
    const el = this.$('toast');
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.style.opacity = '0'; }, seconds * 1000);
  }
}
