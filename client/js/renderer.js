// Canvas rendering (instructions §10 Phase 4). Given a game state, draw it —
// the renderer holds no game logic and never mutates the state.

import { STAGE, FLOOR, PLATFORMS, COUNTDOWN_FRAMES, TICK_RATE } from '/shared/constants.js';
import { CHARACTERS } from '/shared/characters.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.debug = false; // toggled with F1 (wired in main.js)
    this.flashes = new Map(); // fighterId → frames of hit flash remaining
  }

  toggleDebug() {
    this.debug = !this.debug;
  }

  // Call when a 'hit' event arrives so the victim flashes for a few frames.
  flash(fighterId, frames = 6) {
    this.flashes.set(fighterId, frames);
  }

  draw(state) {
    const { ctx } = this;
    ctx.clearRect(0, 0, STAGE.width, STAGE.height);

    this.drawStage();
    for (const fighter of Object.values(state.fighters)) {
      this.drawFighter(fighter);
    }
    if (this.debug) this.drawDebug(state);
    this.drawHUD(state);
    if (state.phase === 'countdown') this.drawCountdown(state);
    if (state.phase === 'ended') this.drawWinner(state);
  }

  drawStage() {
    const { ctx } = this;
    ctx.fillStyle = '#3a3f55';
    ctx.fillRect(FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h);
    ctx.fillStyle = '#565d7d';
    ctx.fillRect(FLOOR.x, FLOOR.y, FLOOR.w, 6);
    for (const p of PLATFORMS) {
      ctx.fillStyle = '#565d7d';
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
  }

  drawFighter(fighter) {
    const { ctx } = this;
    const ch = CHARACTERS[fighter.characterId];
    const { w, h } = ch.hurtbox;
    const left = fighter.x - w / 2;
    const top = fighter.y - h / 2;

    if (fighter.state === 'ko' || fighter.stocks <= 0 && fighter.state !== 'respawning') {
      if (fighter.stocks <= 0) return; // eliminated
    }

    // Invulnerable (dodge/respawn) → blink. Hit → white flash.
    const flashing = (this.flashes.get(fighter.id) || 0) > 0;
    if (flashing) this.flashes.set(fighter.id, this.flashes.get(fighter.id) - 1);
    const blinking = fighter.invulnFrames > 0 && Math.floor(fighter.invulnFrames / 4) % 2 === 0;

    ctx.save();
    if (blinking) ctx.globalAlpha = 0.45;

    // Body: rounded rect in the character color.
    ctx.fillStyle = flashing ? '#ffffff'
      : fighter.state === 'hitstun' ? shade(ch.color, 1.35)
      : fighter.state === 'shield' ? shade(ch.color, 0.7)
      : ch.color;
    roundRect(ctx, left, top, w, h, 8);
    ctx.fill();

    // Facing indicator: a nose on the front edge at eye height.
    ctx.fillStyle = '#14151a';
    const eyeY = top + h * 0.22;
    const noseX = fighter.facing === 1 ? left + w - 6 : left + 2;
    ctx.fillRect(noseX, eyeY, 4, 10);

    // Shield bubble.
    if (fighter.state === 'shield') {
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fighter.x, fighter.y, Math.max(w, h) * 0.62 * (0.5 + 0.5 * fighter.shieldHealth / 100), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Wind-up cue while a move is in startup.
    if (fighter.state === 'attack' && fighter.currentMove) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      roundRect(ctx, left - 3, top - 3, w + 6, h + 6, 10);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawDebug(state) {
    const { ctx } = this;
    ctx.lineWidth = 1;
    for (const fighter of Object.values(state.fighters)) {
      if (fighter.stocks <= 0) continue;
      const ch = CHARACTERS[fighter.characterId];
      ctx.strokeStyle = '#00e5ff';
      ctx.strokeRect(
        fighter.x - ch.hurtbox.w / 2, fighter.y - ch.hurtbox.h / 2,
        ch.hurtbox.w, ch.hurtbox.h,
      );
      ctx.fillStyle = '#00e5ff';
      ctx.font = '11px monospace';
      ctx.fillText(`${fighter.state} vx:${fighter.vx.toFixed(1)} vy:${fighter.vy.toFixed(1)}`,
        fighter.x - ch.hurtbox.w / 2, fighter.y - ch.hurtbox.h / 2 - 6);
    }
    ctx.strokeStyle = '#ff3355';
    for (const hb of state.hitboxes || []) {
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
    }
  }

  drawHUD(state) {
    const { ctx } = this;
    const fighters = Object.values(state.fighters);
    const slotW = 200;
    const totalW = fighters.length * slotW;
    const startX = (STAGE.width - totalW) / 2;

    fighters.forEach((fighter, i) => {
      const ch = CHARACTERS[fighter.characterId];
      const x = startX + i * slotW;
      const y = STAGE.height - 84;

      ctx.fillStyle = 'rgba(10, 12, 20, 0.75)';
      roundRect(ctx, x + 8, y, slotW - 16, 70, 10);
      ctx.fill();

      ctx.fillStyle = ch.color;
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(fighter.name, x + 20, y + 22);

      ctx.fillStyle = fighter.stocks > 0 ? percentColor(fighter.percent) : '#666';
      ctx.font = 'bold 26px system-ui';
      ctx.fillText(fighter.stocks > 0 ? `${Math.round(fighter.percent)}%` : 'OUT', x + 20, y + 52);

      for (let sIdx = 0; sIdx < fighter.stocks; sIdx++) {
        ctx.fillStyle = ch.color;
        ctx.beginPath();
        ctx.arc(x + slotW - 30 - sIdx * 18, y + 46, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  drawWinner(state) {
    const { ctx } = this;
    const winner = state.winnerId ? state.fighters[state.winnerId] : null;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(winner ? `${winner.name} WINS!` : 'DRAW!', STAGE.width / 2, STAGE.height / 2 - 60);
    ctx.textAlign = 'left';
  }

  drawCountdown(state) {
    const { ctx } = this;
    const framesLeft = state.countdownTimer ?? COUNTDOWN_FRAMES;
    const seconds = Math.ceil(framesLeft / TICK_RATE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, STAGE.width, STAGE.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 120px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(seconds > 0 ? String(seconds) : 'GO!', STAGE.width / 2, STAGE.height / 2);
    ctx.textAlign = 'left';
  }
}

// Build a drawable state from two snapshots, lerping fighter positions by t
// (0 → a, 1 → b). Discrete fields (percent, stocks, state) come from the newer
// snapshot; only motion is smoothed (§11).
export function interpolateSnapshots(a, b, t) {
  const older = Object.fromEntries(a.fighters.map((f) => [f.id, f]));
  const fighters = {};
  for (const fb of b.fighters) {
    const fa = older[fb.id] ?? fb;
    fighters[fb.id] = {
      ...fb,
      x: fa.x + (fb.x - fa.x) * t,
      y: fa.y + (fb.y - fa.y) * t,
    };
  }
  return {
    phase: b.phase,
    countdownTimer: b.countdownTimer,
    winnerId: b.winnerId,
    tick: b.tick,
    fighters,
    hitboxes: b.hitboxes ?? [],
    events: [],
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Percent readout shifts white → yellow → red as damage racks up, Smash-style.
function percentColor(percent) {
  if (percent < 50) return '#ffffff';
  if (percent < 100) return '#ffd24d';
  return '#ff5a4d';
}

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}
