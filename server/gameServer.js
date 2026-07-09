// Authoritative match loop (instructions §10 Phase 10): runs the shared sim at
// 60 Hz with an accumulator, applies the latest input per player each tick,
// and broadcasts slim snapshots at 30 Hz.

import { createInitialState, stepGame, EMPTY_INPUT } from '../shared/simulation.js';
import { TICK_RATE, SNAPSHOT_RATE, DT } from '../shared/constants.js';
import { matchStart, snapshot, matchEnd } from '../shared/protocol.js';

const TICK_MS = 1000 / TICK_RATE;
const TICKS_PER_SNAPSHOT = TICK_RATE / SNAPSHOT_RATE;
// Cap catch-up after an event-loop stall so we skip time instead of spiraling.
const MAX_ACCUMULATED_MS = 250;

export class GameServer {
  constructor(room, playerConfigs) {
    this.room = room;
    this.state = createInitialState(playerConfigs);
    this.inputs = {};   // playerId → latest input object (persists across ticks §11)
    this.lastSeq = {};  // playerId → highest seq seen (stale/out-of-order dropped)
    this.pendingEvents = []; // events accumulated between snapshots, drained on send
    this.accumulator = 0;
    this.lastTime = 0;
    this.timer = null;

    for (const cfg of playerConfigs) {
      this.inputs[cfg.id] = { ...EMPTY_INPUT };
      this.lastSeq[cfg.id] = -1;
      this.room.sendTo(cfg.id, matchStart('main', playerConfigs, cfg.id));
    }
  }

  start() {
    this.lastTime = performance.now();
    // Short interval + accumulator: sim advances in exact TICK_MS steps
    // regardless of timer jitter.
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  pump() {
    const now = performance.now();
    this.accumulator = Math.min(this.accumulator + (now - this.lastTime), MAX_ACCUMULATED_MS);
    this.lastTime = now;

    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.tick();
      if (!this.timer) return; // match ended mid-catch-up
    }
  }

  tick() {
    this.state = stepGame(this.state, this.inputs, DT);
    this.pendingEvents.push(...this.state.events);

    if (this.state.tick % TICKS_PER_SNAPSHOT === 0) {
      this.broadcastSnapshot();
    }

    if (this.state.phase === 'ended' && this.state.endTimer <= 0) {
      this.finish();
    }
  }

  receiveInput(playerId, seq, input) {
    if (!(playerId in this.inputs)) return;
    if (typeof seq !== 'number' || seq <= this.lastSeq[playerId]) return; // stale
    this.lastSeq[playerId] = seq;
    // Sanitize: only known fields, coerced to booleans.
    const clean = {};
    for (const key of Object.keys(EMPTY_INPUT)) clean[key] = Boolean(input?.[key]);
    this.inputs[playerId] = clean;
  }

  removePlayer(playerId) {
    if (!(playerId in this.inputs)) return;
    delete this.inputs[playerId];
    delete this.lastSeq[playerId];
    // Their fighter forfeits: zero stocks so the match resolves naturally.
    const fighter = this.state.fighters[playerId];
    if (fighter && fighter.stocks > 0) {
      fighter.stocks = 0;
      fighter.state = 'ko';
      this.pendingEvents.push({ type: 'ko', id: playerId, x: fighter.x, y: fighter.y });
    }
  }

  broadcastSnapshot() {
    // Send only what the client needs to render (§11), floats rounded.
    const fighters = Object.values(this.state.fighters).map((f) => ({
      id: f.id,
      characterId: f.characterId,
      name: f.name,
      x: Math.round(f.x * 10) / 10,
      y: Math.round(f.y * 10) / 10,
      facing: f.facing,
      percent: Math.round(f.percent * 10) / 10,
      stocks: f.stocks,
      state: f.state,
      currentMove: f.currentMove,
      invulnFrames: f.invulnFrames,
      shieldHealth: Math.round(f.shieldHealth),
    }));
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.room.broadcast(snapshot(this.state.tick, this.state.phase, fighters, events, {
      countdownTimer: this.state.countdownTimer,
      hitboxes: this.state.hitboxes, // for the client debug overlay
      winnerId: this.state.winnerId,
    }));
  }

  finish() {
    this.stop();
    const standings = Object.values(this.state.fighters)
      .slice()
      .sort((a, b) => b.stocks - a.stocks || a.percent - b.percent)
      .map((f) => ({
        id: f.id,
        name: f.name,
        characterId: f.characterId,
        stocks: f.stocks,
        percent: Math.round(f.percent),
      }));
    this.room.broadcast(matchEnd(this.state.winnerId, standings));
    this.room.onMatchOver();
    console.log(`[game] match over, winner: ${this.state.winnerId ?? 'none'}`);
  }
}
