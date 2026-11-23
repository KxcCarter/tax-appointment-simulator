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
