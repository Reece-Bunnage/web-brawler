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
    // Clock-seeded so every match gets a fresh level rotation and drop
    // pattern; GAME_SEED pins it for integration tests.
    const seed = process.env.GAME_SEED ? Number(process.env.GAME_SEED) : (Date.now() >>> 0);
    this.state = createInitialState(playerConfigs, seed);
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
    // Sanitize: only known fields; aim components are finite numbers, the
    // rest booleans.
    const clean = {};
    for (const key of Object.keys(EMPTY_INPUT)) {
      if (key === 'aimX' || key === 'aimY') {
        const v = Number(input?.[key]);
        clean[key] = Number.isFinite(v) ? v : 0;
      } else {
        clean[key] = Boolean(input?.[key]);
      }
    }
    this.inputs[playerId] = clean;
  }

  removePlayer(playerId) {
    if (!(playerId in this.inputs)) return;
    delete this.inputs[playerId];
    delete this.lastSeq[playerId];
    // Leaving forfeits: the fighter is removed from this and future rounds.
    const fighter = this.state.fighters[playerId];
    if (fighter) {
      this.pendingEvents.push({ type: 'death', id: playerId, x: fighter.x, y: fighter.y });
      delete this.state.fighters[playerId];
    }
    // With fewer than 2 fighters left the match can't continue — the last
    // one standing wins now.
    const remaining = Object.values(this.state.fighters);
    if (remaining.length < 2 && this.timer) {
      this.state.winnerId = remaining[0]?.id ?? null;
      this.finish();
    }
  }

  broadcastSnapshot() {
    // Send only what the client needs to render, floats rounded.
    const r1 = (v) => Math.round(v * 10) / 10;
    const fighters = Object.values(this.state.fighters).map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      x: r1(f.x),
      y: r1(f.y),
      vx: r1(f.vx),
      vy: r1(f.vy),
      onGround: f.onGround,
      facing: f.facing,
      aimX: Math.round(f.aimX * 100) / 100,
      aimY: Math.round(f.aimY * 100) / 100,
      hp: Math.round(f.hp),
      alive: f.alive,
      roundWins: f.roundWins,
      weaponId: f.weaponId,
      chargeFrames: f.chargeFrames,
    }));
    const projectiles = this.state.projectiles.map((p) => ({
      id: p.id, weaponId: p.weaponId, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy),
      kind: p.kind, spin: p.spin,
    }));
    const drops = this.state.drops.map((d) => ({
      id: d.id, weaponId: d.weaponId, x: r1(d.x), y: r1(d.y), landed: d.landed,
    }));
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.room.broadcast(snapshot(this.state.tick, this.state.phase, fighters, events, {
      countdownTimer: this.state.countdownTimer,
      roundNumber: this.state.roundNumber,
      levelIndex: this.state.levelIndex,
      roundWinnerId: this.state.roundWinnerId,
      winnerId: this.state.winnerId,
      projectiles,
      drops,
    }));
  }

  finish() {
    this.stop();
    const standings = Object.values(this.state.fighters)
      .slice()
      .sort((a, b) => b.roundWins - a.roundWins)
      .map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        roundWins: f.roundWins,
      }));
    this.room.broadcast(matchEnd(this.state.winnerId, standings));
    this.room.onMatchOver();
    console.log(`[game] match over, winner: ${this.state.winnerId ?? 'none'}`);
  }
}
