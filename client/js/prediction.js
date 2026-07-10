// Client-side prediction for the OWN fighter online. The world (other
// fighters, projectiles, drops) stays on delayed interpolation; only your own
// stick figure is advanced locally so controls feel instant.
//
// Loop shape (driven by main.js):
//   record(input) + step(input)  — once per local 60 Hz sim tick
//   reconcile(newestSnapshot)    — when a new snapshot arrives: rebase the
//                                  prediction on the authoritative fighter and
//                                  replay unacked inputs (seq > ackSeq)
//   apply(renderState)           — overwrite the own fighter's pose in the
//                                  interpolated state; smooth small server
//                                  corrections via a decaying render offset
//
// Approximation, by design: the server applies its latest-received input every
// tick (gaps skipped, stalls reuse the last input), while we replay each
// pending input exactly once — a ±1 tick residual that the 60 Hz rebase and
// the error decay absorb. Do not try to make the server tick-index inputs.

import { predictFighterStep, EMPTY_INPUT } from '/shared/simulation.js';
import {
  PREDICTION_SNAP_DIST, PREDICTION_ERROR_DECAY, PENDING_INPUT_MAX,
} from '/shared/constants.js';

// Pose comes from the prediction; identity/HUD stays authoritative.
// swingFrames is pose too: your saber swing animates the instant you press.
const PREDICTED_FIELDS = ['x', 'y', 'vx', 'vy', 'facing', 'aimX', 'aimY', 'onGround', 'dashFrames', 'swingFrames'];

export class Predictor {
  constructor(selfId) {
    this.selfId = selfId;
    this.pending = [];       // [{seq, input}] not yet acked by the server
    this.seq = 0;
    this.predicted = null;   // null while gated off (dead, countdown, banner…)
    this.renderError = { x: 0, y: 0 };
    this.lastAckedInput = { ...EMPTY_INPUT };
    this.lastSnapTick = -1;
    this.levelIndex = 0;
    this.modeId = 'classic';
    this.phase = null;
  }

  // Stamp + remember one sim tick's input. Always called (the server needs
  // inputs whether or not prediction is active).
  record(input) {
    const seq = this.seq++;
    this.pending.push({ seq, input });
    if (this.pending.length > PENDING_INPUT_MAX) this.pending.shift();
    return seq;
  }

  // Advance the predicted fighter one tick between snapshots.
  step(input) {
    if (!this.predicted) return;
    predictFighterStep(this.predicted, input, this.levelIndex, this.modeId);
  }

  reconcile(snap) {
    if (!snap || snap.tick <= this.lastSnapTick) return;
    const prevLevel = this.levelIndex;
    const prevPhase = this.phase;
    this.lastSnapTick = snap.tick;
    this.levelIndex = snap.levelIndex ?? this.levelIndex;
    this.modeId = snap.modeId ?? this.modeId;
    this.phase = snap.phase;

    const auth = snap.fighters.find((f) => f.id === this.selfId);
    if (!auth || snap.phase !== 'playing' || !auth.alive) {
      // Dead / between rounds: render pure interpolation, resume clean later.
      this.predicted = null;
      this.renderError = { x: 0, y: 0 };
      return;
    }

    const ack = snap.ackSeq?.[this.selfId] ?? -1;
    const acked = this.pending.find((p) => p.seq === ack);
    if (acked) this.lastAckedInput = acked.input;
    this.pending = this.pending.filter((p) => p.seq > ack);

    const prev = this.predicted;
    this.predicted = structuredClone(auth);
    // Seed edge detection from the input the server last applied, so a held
    // jump doesn't re-trigger on every replay.
    this.predicted.prevInput = { ...this.lastAckedInput };
    for (const p of this.pending) {
      predictFighterStep(this.predicted, p.input, this.levelIndex, this.modeId);
    }

    // Server correction → keep rendering where we were and decay toward the
    // new prediction, unless it's big or the world changed (then snap).
    if (prev && prevLevel === this.levelIndex && prevPhase === 'playing') {
      const ex = prev.x + this.renderError.x - this.predicted.x;
      const ey = prev.y + this.renderError.y - this.predicted.y;
      this.renderError = Math.hypot(ex, ey) > PREDICTION_SNAP_DIST
        ? { x: 0, y: 0 }
        : { x: ex, y: ey };
    } else {
      this.renderError = { x: 0, y: 0 };
    }
  }

  // Overwrite the own fighter's pose in the interpolated render state.
  apply(state) {
    if (!this.predicted) return;
    const self = state.fighters[this.selfId];
    if (!self) return;
    this.renderError.x *= PREDICTION_ERROR_DECAY;
    this.renderError.y *= PREDICTION_ERROR_DECAY;
    for (const k of PREDICTED_FIELDS) self[k] = this.predicted[k];
    self.x += this.renderError.x;
    self.y += this.renderError.y;
  }

  errorPx() {
    return Math.hypot(this.renderError.x, this.renderError.y);
  }
}
