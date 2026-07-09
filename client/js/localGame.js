// Local same-keyboard mode (instructions §10 Phase 5): the browser runs the
// shared sim directly at a fixed 60 Hz using an accumulator, so sim behavior
// is independent of display refresh rate. No interpolation needed — we render
// the live state.

import { createInitialState, stepGame } from '/shared/simulation.js';
import { TICK_RATE, DT } from '/shared/constants.js';

const FRAME_MS = 1000 / TICK_RATE;
// If the tab was backgrounded we might owe thousands of frames; cap the
// catch-up so we skip time instead of freezing.
const MAX_ACCUMULATED_MS = 250;

export class LocalGame {
  constructor({ inputManager, renderer, playerConfigs, onMatchEnd }) {
    this.inputManager = inputManager;
    this.renderer = renderer;
    this.onMatchEnd = onMatchEnd;
    this.state = createInitialState(playerConfigs);
    this.running = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  _frame(now) {
    if (!this.running) return;

    this.accumulator = Math.min(this.accumulator + (now - this.lastTime), MAX_ACCUMULATED_MS);
    this.lastTime = now;

    while (this.accumulator >= FRAME_MS) {
      this.accumulator -= FRAME_MS;
      const inputs = {
        p1: this.inputManager.getInput(0),
        p2: this.inputManager.getInput(1),
      };
      this.state = stepGame(this.state, inputs, DT);
      this._handleEvents(this.state.events);
    }

    this.renderer.draw(this.state);

    if (this.state.phase === 'ended') {
      this.running = false;
      this.onMatchEnd?.(this.state);
      return;
    }
    requestAnimationFrame(this._frame);
  }

  _handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'hit') this.renderer.flash(ev.victimId);
    }
  }
}
