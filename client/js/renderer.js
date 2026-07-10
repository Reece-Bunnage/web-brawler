// Canvas rendering. Given a game state (live local state or an interpolated
// snapshot), draw it — the renderer holds no game logic and never mutates the
// state. Transient effects (muzzle flash, explosions, splats) are client-side
// only and fed in via addEvent().

import {
  STAGE, FIGHTER_HURTBOX, MAX_HP,
  ROUND_WINS_TARGET, TICK_RATE,
} from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { getLevel } from '/shared/levels.js';

const HEAD_R = 8;

// Visual proportions of a stick figure within the hurtbox.
const NECK_Y = -14;   // shoulder line, relative to center
const HIP_Y = 12;
const FOOT_Y = FIGHTER_HURTBOX.h / 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.debug = false; // toggled with F1 (wired in main.js)
    this.effects = [];  // {type, x, y, age, ...}
  }

  toggleDebug() {
    this.debug = !this.debug;
  }

  // Feed sim events (from local stepGame or arriving snapshots) to spawn
  // one-shot visual effects.
  addEvent(ev) {
    switch (ev.type) {
      case 'shot':
        this.effects.push({ type: 'muzzle', x: ev.x, y: ev.y, age: 0, life: 5 });
        break;
      case 'punch':
        this.effects.push({ type: 'punch', x: ev.x, y: ev.y, age: 0, life: 7 });
        break;
      case 'hit':
        this.effects.push({ type: 'hitspark', x: ev.x, y: ev.y, age: 0, life: 8 });
        break;
      case 'explosion':
        this.effects.push({ type: 'explosion', x: ev.x, y: ev.y, radius: ev.radius, age: 0, life: 18 });
        break;
      case 'death':
        this.effects.push({ type: 'splat', x: ev.x, y: ev.y, age: 0, life: 40 });
        break;
    }
  }

  draw(state) {
    const { ctx } = this;
    ctx.clearRect(0, 0, STAGE.width, STAGE.height);

    this.drawStage(getLevel(state.levelIndex ?? 0));
    for (const drop of state.drops ?? []) this.drawDrop(drop, state.tick ?? 0);
    for (const fighter of Object.values(state.fighters)) {
      if (fighter.alive) this.drawFighter(fighter, state.tick ?? 0);
      else this.drawCorpse(fighter);
    }
    for (const p of state.projectiles ?? []) this.drawProjectile(p);
    this.drawEffects();
    if (this.debug) this.drawDebug(state);
    this.drawHUD(state);

    if (state.phase === 'countdown') this.drawCountdown(state);
    if (state.phase === 'roundEnd') this.drawRoundBanner(state);
    if (state.phase === 'ended') this.drawWinner(state);
  }

  drawStage(level) {
    const { ctx } = this;
    for (const s of level.solids) {
      ctx.fillStyle = level.accent;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#565d7d';
      ctx.fillRect(s.x, s.y, s.w, 6);
    }
    for (const p of level.platforms) {
      ctx.fillStyle = '#565d7d';
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
  }

  // --- Stick figures -------------------------------------------------------

  drawFighter(f, tick) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.strokeStyle = f.color;
    ctx.fillStyle = f.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    // Legs swing with horizontal speed; planted when still.
    const speed = Math.min(1, Math.abs(f.vx ?? 0) / 5);
    const phase = Math.sin(tick * 0.35) * speed;
    line(ctx, 0, HIP_Y, -6 - 8 * phase, FOOT_Y);
    line(ctx, 0, HIP_Y, 6 + 8 * phase, FOOT_Y);

    // Torso.
    line(ctx, 0, NECK_Y, 0, HIP_Y);

    // Head (filled, with a face dot so facing reads even unarmed).
    const headY = NECK_Y - HEAD_R + 1;
    ctx.beginPath();
    ctx.arc(0, headY - HEAD_R + 4, HEAD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14151a';
    ctx.beginPath();
    ctx.arc(f.facing * 4, headY - HEAD_R + 2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.color;

    // Arms + weapon along the aim direction.
    const angle = Math.atan2(f.aimY ?? 0, f.aimX ?? f.facing);
    if (f.weaponId) {
      this.drawArmsWithGun(f, angle);
    } else {
      // Unarmed: one arm forward, one relaxed.
      line(ctx, 0, NECK_Y, Math.cos(angle) * 16, NECK_Y + Math.sin(angle) * 16);
      line(ctx, 0, NECK_Y, -f.facing * 8, NECK_Y + 14);
    }

    ctx.restore();

    // HP bar + name above the head.
    const barW = 44;
    const top = f.y - FIGHTER_HURTBOX.h / 2;
    ctx.fillStyle = 'rgba(10,12,20,0.7)';
    ctx.fillRect(f.x - barW / 2, top - 18, barW, 6);
    ctx.fillStyle = hpColor(f.hp);
    ctx.fillRect(f.x - barW / 2, top - 18, barW * Math.max(0, f.hp) / MAX_HP, 6);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(f.name, f.x, top - 24);
    ctx.textAlign = 'left';
  }

  drawArmsWithGun(f, angle) {
    const { ctx } = this;
    const weapon = WEAPONS[f.weaponId];
    const hx = Math.cos(angle);
    const hy = Math.sin(angle);
    // Both hands grip toward the gun.
    line(ctx, 0, NECK_Y, hx * 14, NECK_Y + hy * 14 + 2);
    line(ctx, 0, NECK_Y, hx * 18, NECK_Y + hy * 18);

    ctx.save();
    ctx.translate(hx * 10, NECK_Y + hy * 10);
    ctx.rotate(angle);
    drawGunShape(ctx, weapon.id);
    ctx.restore();
  }

  drawCorpse(f) {
    // Fallen stick figure where they died, faded.
    const { ctx } = this;
    if (f.x < -100 || f.x > STAGE.width + 100 || f.y > STAGE.height + 100) return;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.translate(f.x, Math.min(f.y + FIGHTER_HURTBOX.h / 2 - 6, FLOOR.y - 6));
    ctx.rotate(Math.PI / 2 * (f.facing || 1));
    ctx.strokeStyle = f.color;
    ctx.fillStyle = f.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    line(ctx, 0, -20, 0, 8);          // torso
    line(ctx, 0, 8, -7, 26);          // legs
    line(ctx, 0, 8, 7, 24);
    line(ctx, 0, -16, -9, -2);        // arms
    line(ctx, 0, -16, 9, -4);
    ctx.beginPath();
    ctx.arc(0, -26, HEAD_R - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- Weapons on the map ------------------------------------------------------

  drawDrop(drop, tick) {
    const { ctx } = this;
    ctx.save();
    // Gentle bob + glow so drops read as pickups.
    const bob = drop.landed ? Math.sin(tick * 0.1) * 2 : 0;
    ctx.translate(drop.x, drop.y + bob);
    ctx.shadowColor = '#ffd24d';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#e8e8ec';
    ctx.fillStyle = '#e8e8ec';
    ctx.lineWidth = 3;
    drawGunShape(ctx, drop.weaponId);
    ctx.restore();

    if (!drop.landed) {
      // Little chute line while falling.
      ctx.strokeStyle = 'rgba(232,232,236,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y - 18, 12, Math.PI, 0);
      ctx.stroke();
    }
  }

  drawProjectile(p) {
    const { ctx } = this;
    const weapon = WEAPONS[p.weaponId];
    if (weapon.explosive) {
      // Rocket: fat body + flame.
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.fillStyle = '#c8ccdd';
      ctx.fillRect(-8, -3, 14, 6);
      ctx.fillStyle = '#ff9040';
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-15 - Math.random() * 4, -2);
      ctx.lineTo(-15 - Math.random() * 4, 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Bullet: short tracer along the velocity.
      const len = Math.min(10, Math.hypot(p.vx, p.vy));
      const nx = p.vx / (Math.hypot(p.vx, p.vy) || 1);
      const ny = p.vy / (Math.hypot(p.vx, p.vy) || 1);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x - nx * len, p.y - ny * len);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  // --- Effects -------------------------------------------------------------------

  drawEffects() {
    const { ctx } = this;
    this.effects = this.effects.filter((e) => e.age <= e.life);
    for (const e of this.effects) {
      const t = e.age / e.life;
      switch (e.type) {
        case 'muzzle': {
          ctx.fillStyle = `rgba(255, 220, 120, ${1 - t})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 6 * (1 - t) + 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'punch': {
          ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 6 + t * 10, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'hitspark': {
          ctx.fillStyle = `rgba(255, 90, 90, ${1 - t})`;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + t * 2;
            ctx.fillRect(e.x + Math.cos(a) * 10 * t, e.y + Math.sin(a) * 10 * t, 3, 3);
          }
          break;
        }
        case 'explosion': {
          ctx.strokeStyle = `rgba(255, 160, 60, ${1 - t})`;
          ctx.lineWidth = 6 * (1 - t) + 1;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius * t, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(255, 220, 120, ${(1 - t) * 0.5})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius * t * 0.7, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'splat': {
          ctx.fillStyle = `rgba(200, 40, 40, ${1 - t})`;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const d = 6 + t * 22;
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d - t * 8, 3.5 * (1 - t) + 1, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
      }
      e.age += 1;
    }
  }

  // --- HUD & banners -----------------------------------------------------------------

  drawHUD(state) {
    const { ctx } = this;
    const fighters = Object.values(state.fighters);
    const slotW = 210;
    const startX = (STAGE.width - fighters.length * slotW) / 2;

    fighters.forEach((f, i) => {
      const x = startX + i * slotW;
      const y = STAGE.height - 74;

      ctx.fillStyle = 'rgba(10, 12, 20, 0.75)';
      ctx.beginPath();
      ctx.roundRect(x + 8, y, slotW - 16, 60, 10);
      ctx.fill();

      ctx.fillStyle = f.color;
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(f.name + (f.weaponId ? ` · ${WEAPONS[f.weaponId].name}` : ''), x + 20, y + 21);

      // HP bar.
      const barW = slotW - 40;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 20, y + 30, barW, 8);
      ctx.fillStyle = f.alive ? hpColor(f.hp) : '#555';
      ctx.fillRect(x + 20, y + 30, barW * Math.max(0, f.hp) / MAX_HP, 8);

      // Round-win pips.
      for (let w = 0; w < ROUND_WINS_TARGET; w++) {
        ctx.beginPath();
        ctx.arc(x + 26 + w * 16, y + 50, 5, 0, Math.PI * 2);
        if (w < f.roundWins) {
          ctx.fillStyle = f.color;
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    });
  }

  drawCountdown(state) {
    const { ctx } = this;
    const seconds = Math.ceil((state.countdownTimer ?? 0) / TICK_RATE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, STAGE.width, STAGE.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px system-ui';
    ctx.fillText(`ROUND ${state.roundNumber ?? 1}`, STAGE.width / 2, STAGE.height / 2 - 90);
    ctx.font = 'bold 110px system-ui';
    ctx.fillText(seconds > 0 ? String(seconds) : 'GO!', STAGE.width / 2, STAGE.height / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '20px system-ui';
    ctx.fillText(getLevel(state.levelIndex ?? 0).name, STAGE.width / 2, STAGE.height / 2 + 56);
    ctx.textAlign = 'left';
  }

  drawRoundBanner(state) {
    const { ctx } = this;
    const winner = state.roundWinnerId ? state.fighters[state.roundWinnerId] : null;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, STAGE.height / 2 - 70, STAGE.width, 110);
    ctx.fillStyle = winner ? winner.color : '#ffffff';
    ctx.font = 'bold 54px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(winner ? `${winner.name} takes the round!` : 'DRAW!', STAGE.width / 2, STAGE.height / 2);
    ctx.textAlign = 'left';
  }

  drawWinner(state) {
    const { ctx } = this;
    const winner = state.winnerId ? state.fighters[state.winnerId] : null;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, STAGE.width, STAGE.height);
    ctx.fillStyle = winner ? winner.color : '#ffffff';
    ctx.font = 'bold 72px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(winner ? `${winner.name} WINS THE MATCH!` : 'DRAW!', STAGE.width / 2, STAGE.height / 2 - 40);
    ctx.textAlign = 'left';
  }

  drawDebug(state) {
    const { ctx } = this;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#00e5ff';
    for (const f of Object.values(state.fighters)) {
      if (!f.alive) continue;
      ctx.strokeRect(
        f.x - FIGHTER_HURTBOX.w / 2, f.y - FIGHTER_HURTBOX.h / 2,
        FIGHTER_HURTBOX.w, FIGHTER_HURTBOX.h,
      );
      ctx.fillStyle = '#00e5ff';
      ctx.font = '11px monospace';
      ctx.fillText(`hp:${f.hp} ${f.weaponId ?? 'fists'}`,
        f.x - FIGHTER_HURTBOX.w / 2, f.y - FIGHTER_HURTBOX.h / 2 - 30);
    }
    ctx.strokeStyle = '#ff3355';
    for (const p of state.projectiles ?? []) {
      ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
    }
  }
}

// Build a drawable state from two snapshots, lerping fighter/projectile/drop
// positions by t (0 → a, 1 → b). Discrete fields come from the newer snapshot.
export function interpolateSnapshots(a, b, t) {
  const lerpBy = (arrA, arrB, key = 'id') => {
    const older = new Map(arrA.map((e) => [e[key], e]));
    return arrB.map((eb) => {
      const ea = older.get(eb[key]) ?? eb;
      return { ...eb, x: ea.x + (eb.x - ea.x) * t, y: ea.y + (eb.y - ea.y) * t };
    });
  };
  const fighters = {};
  for (const f of lerpBy(a.fighters, b.fighters)) fighters[f.id] = f;
  return {
    phase: b.phase,
    countdownTimer: b.countdownTimer,
    roundNumber: b.roundNumber,
    levelIndex: b.levelIndex,
    roundWinnerId: b.roundWinnerId,
    winnerId: b.winnerId,
    tick: b.tick,
    fighters,
    drops: lerpBy(a.drops ?? [], b.drops ?? []),
    projectiles: lerpBy(a.projectiles ?? [], b.projectiles ?? []),
    events: [],
  };
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawGunShape(ctx, weaponId) {
  switch (weaponId) {
    case 'pistol':
      ctx.fillRect(0, -2.5, 16, 5);
      ctx.fillRect(1, 0, 4, 9);
      break;
    case 'uzi':
      ctx.fillRect(-2, -3, 18, 6);
      ctx.fillRect(3, 0, 4, 10);
      ctx.fillRect(-2, 0, 3, 7);
      break;
    case 'shotgun':
      ctx.fillRect(-6, -3, 30, 5);
      ctx.fillRect(-10, -1, 8, 5);
      break;
    case 'bazooka':
      ctx.fillRect(-12, -5, 38, 10);
      ctx.fillRect(2, 4, 5, 6);
      break;
    default:
      ctx.fillRect(0, -2, 14, 4);
  }
}

function hpColor(hp) {
  if (hp > 60) return '#6fe26f';
  if (hp > 30) return '#ffd24d';
  return '#ff5a4d';
}
