// Canvas rendering. Given a game state (live local state or an interpolated
// snapshot), draw it — the renderer holds no game logic and never mutates the
// state. Transient effects (muzzle flash, explosions, splats) are client-side
// only and fed in via addEvent().

import {
  STAGE, FIGHTER_HURTBOX, GUN_MOUNT_Y, MAX_HP,
  ROUND_WINS_TARGET, TICK_RATE,
} from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { getLevel, worldSize } from '/shared/levels.js';

const HEAD_R = 8;

// Visual proportions of a stick figure within the hurtbox.
const NECK_Y = -14;   // shoulder line, relative to center
const HIP_Y = 12;
const FOOT_Y = FIGHTER_HURTBOX.h / 2;

// Camera tuning.
const CAM_PADDING = 240;      // world px kept around the fighters' bounding box
const CAM_MAX_ZOOM = 1.25;    // never closer than this
const CAM_EDGE_MARGIN = 120;  // how far past the world edge the view may show
const CAM_POS_EASE = 0.12;    // per-frame lerp toward the target
const CAM_ZOOM_EASE = 0.08;
const CAM_LOOKAHEAD = 6;      // frames of vx projected ahead of each fighter

// Juice tuning.
const SHAKE_MAX = 26;         // cap on shake magnitude (screen px)
const SHAKE_DECAY = 0.82;     // per-frame falloff
const RAGDOLL_GRAVITY = 0.7;
const RAGDOLL_FRICTION = 0.86;
const RAGDOLL_LIFE = 150;     // frames before a corpse fades out

// Smash-style camera: frames all living fighters, zooming between "whole
// level fits" and CAM_MAX_ZOOM, easing toward the target each frame.
class Camera {
  constructor(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.x = viewW / 2;
    this.y = viewH / 2;
    this.zoom = 1;
  }

  update(state, level, snap = false) {
    const world = worldSize(level);
    let targets = Object.values(state.fighters).filter((f) => f.alive);
    if (targets.length === 0) targets = Object.values(state.fighters);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of targets) {
      const ahead = (f.vx ?? 0) * CAM_LOOKAHEAD;
      minX = Math.min(minX, f.x, f.x + ahead);
      maxX = Math.max(maxX, f.x, f.x + ahead);
      minY = Math.min(minY, f.y);
      maxY = Math.max(maxY, f.y);
    }
    if (!Number.isFinite(minX)) { minX = maxX = world.width / 2; minY = maxY = world.height / 2; }

    const boxW = maxX - minX + CAM_PADDING * 2;
    const boxH = maxY - minY + CAM_PADDING * 2;
    // Zoom floor = whole level in frame (capped at 1:1 for view-sized levels).
    const fitWorld = Math.min(this.viewW / world.width, this.viewH / world.height);
    const minZoom = Math.min(1, fitWorld);
    const zoom = clampNum(Math.min(this.viewW / boxW, this.viewH / boxH), minZoom, CAM_MAX_ZOOM);

    // Keep the view inside the world (plus a small margin of void).
    const cx = clampCenter((minX + maxX) / 2, this.viewW / 2 / zoom, world.width);
    const cy = clampCenter((minY + maxY) / 2, this.viewH / 2 / zoom, world.height);

    if (snap) {
      this.x = cx; this.y = cy; this.zoom = zoom;
    } else {
      this.x += (cx - this.x) * CAM_POS_EASE;
      this.y += (cy - this.y) * CAM_POS_EASE;
      this.zoom += (zoom - this.zoom) * CAM_ZOOM_EASE;
    }
  }

  applyTransform(ctx) {
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }
}

function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Clamp a view center along one axis so the view stays within
// [-margin, worldExtent + margin]; a view wider than that centers instead.
function clampCenter(c, halfView, worldExtent) {
  const lo = -CAM_EDGE_MARGIN + halfView;
  const hi = worldExtent + CAM_EDGE_MARGIN - halfView;
  if (lo > hi) return worldExtent / 2;
  return clampNum(c, lo, hi);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.debug = false; // toggled with F1 (wired in main.js)
    this.effects = [];  // {type, x, y, age, ...}
    this.camera = new Camera(canvas.width, canvas.height);
    this._bgCache = new Map();     // level.id → parallax layers
    this._lastLevelIndex = -1;     // camera snaps when the map changes
    this.shake = 0;                // current screen-shake magnitude
    this.hitStop = 0;              // frames the game loop should freeze on
    this.ragdolls = new Map();     // fighterId → client-side corpse physics
    this._figState = new Map();    // fighterId → { wasAir, squash } for pose juice
    this._lastPhase = null;        // detects round (re)starts to clear corpses
  }

  toggleDebug() {
    this.debug = !this.debug;
  }

  worldToScreen(x, y) {
    return this.camera.worldToScreen(x, y);
  }

  addShake(mag) {
    this.shake = Math.min(SHAKE_MAX, Math.max(this.shake, mag));
  }

  // Client-side hit-stop: the game loops freeze the sim/interpolation for a
  // few frames on big impacts. Purely cosmetic, so it never desyncs online.
  triggerHitStop(frames) {
    this.hitStop = Math.max(this.hitStop, frames);
  }

  spawnRagdoll(ev) {
    this.ragdolls.set(ev.id, {
      id: ev.id,
      color: ev.color ?? '#c9ccd6',
      x: ev.x,
      y: ev.y,
      vx: (ev.vx ?? 0) * 1.1 + (Math.random() - 0.5) * 2,
      vy: (ev.vy ?? 0) - 3,
      angle: 0,
      angVel: ((ev.vx ?? 0) * 0.02) + (Math.random() - 0.5) * 0.3,
      age: 0,
      settled: false,
    });
  }

  // Feed sim events (from local stepGame or arriving snapshots) to spawn
  // one-shot visual effects.
  addEvent(ev) {
    switch (ev.type) {
      case 'shot': {
        const charged = ev.charged; // full-charge sniper shot
        this.effects.push({ type: 'muzzle', x: ev.x, y: ev.y, age: 0, life: charged ? 8 : 5, big: charged });
        if (charged) this.addShake(9);
        break;
      }
      case 'punch':
        this.effects.push({ type: 'punch', x: ev.x, y: ev.y, age: 0, life: 7 });
        break;
      case 'hit':
        this.effects.push({ type: 'hitspark', x: ev.x, y: ev.y, age: 0, life: 8 });
        this.spawnBlood(ev.x, ev.y, 5);
        this.addShake(4);
        break;
      case 'explosion':
        this.effects.push({ type: 'explosion', x: ev.x, y: ev.y, radius: ev.radius, age: 0, life: 18 });
        this.addShake(Math.min(SHAKE_MAX, (ev.radius ?? 60) * 0.22));
        this.triggerHitStop(3);
        break;
      case 'death':
        this.effects.push({ type: 'splat', x: ev.x, y: ev.y, age: 0, life: 40 });
        this.spawnBlood(ev.x, ev.y, 12);
        this.spawnRagdoll(ev);
        this.addShake(14);
        this.triggerHitStop(4);
        break;
      case 'dash':
        this.effects.push({ type: 'dashTrail', x: ev.x, y: ev.y, dir: ev.dir, age: 0, life: 12 });
        break;
      case 'wallJump':
        this.effects.push({ type: 'dust', x: ev.x, y: ev.y, dir: ev.dir, age: 0, life: 14 });
        break;
      case 'bounce':
        this.effects.push({ type: 'bounceRing', x: ev.x, y: ev.y, age: 0, life: 14 });
        break;
      case 'throw':
        this.effects.push({ type: 'punch', x: ev.x, y: ev.y, age: 0, life: 6 });
        break;
    }
  }

  draw(state) {
    const { ctx } = this;
    const levelIndex = state.levelIndex ?? 0;
    const level = getLevel(levelIndex);
    // Snap (don't glide) when the map rotates to a new level.
    this.camera.update(state, level, levelIndex !== this._lastLevelIndex);
    this._lastLevelIndex = levelIndex;

    // A fresh countdown means a new round — clear last round's corpses/pose state.
    if (state.phase === 'countdown' && this._lastPhase !== 'countdown') {
      this.ragdolls.clear();
      this._figState.clear();
    }
    this._lastPhase = state.phase;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground(level);

    // Screen-shake offset, applied to the world layer only (HUD stays put).
    let sx = 0, sy = 0;
    if (this.shake > 0.3) {
      sx = (Math.random() * 2 - 1) * this.shake;
      sy = (Math.random() * 2 - 1) * this.shake;
      this.shake *= SHAKE_DECAY;
    } else {
      this.shake = 0;
    }

    // World space: everything the camera looks at.
    ctx.save();
    ctx.translate(sx, sy);
    this.camera.applyTransform(ctx);
    this.drawStage(level);
    this.drawHazards(level, state.tick ?? 0);
    for (const drop of state.drops ?? []) this.drawDrop(drop, state.tick ?? 0);
    this.stepAndDrawRagdolls(level);
    for (const fighter of Object.values(state.fighters)) {
      if (fighter.alive) this.drawFighter(fighter, state.tick ?? 0, level);
      else if (!this.ragdolls.has(fighter.id)) this.drawCorpse(fighter); // fallback if we missed the death event
    }
    for (const p of state.projectiles ?? []) this.drawProjectile(p);
    this.drawEffects();
    if (this.debug) this.drawDebug(state);
    ctx.restore();

    // Screen space: HUD and banners are pinned to the view.
    this.drawHUD(state);
    if (state.phase === 'countdown') this.drawCountdown(state);
    if (state.phase === 'roundEnd') this.drawRoundBanner(state);
    if (state.phase === 'ended') this.drawWinner(state);
  }

  // Parallax backdrop: a sky gradient plus star and silhouette layers that
  // track the camera at fractional factors for depth. Layers are generated
  // once per level from a seeded RNG so every client sees the same skyline.
  drawBackground(level) {
    const { ctx, camera } = this;
    const world = worldSize(level);

    const sky = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    sky.addColorStop(0, '#1a1e2e');
    sky.addColorStop(1, '#0f1119');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const layer of this._backgroundLayers(level)) {
      const f = layer.factor;
      // A layer at factor f follows camera position AND zoom at strength f,
      // pivoting on the world center so depth reads correctly while zooming.
      const z = 1 + (camera.zoom - 1) * f;
      const cx = world.width / 2 + (camera.x - world.width / 2) * f;
      const cy = world.height / 2 + (camera.y - world.height / 2) * f;
      ctx.save();
      ctx.translate(camera.viewW / 2, camera.viewH / 2);
      ctx.scale(z, z);
      ctx.translate(-cx, -cy);
      for (const s of layer.shapes) {
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.color;
        if (s.r) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _backgroundLayers(level) {
    let layers = this._bgCache.get(level.id);
    if (layers) return layers;

    const world = worldSize(level);
    const rng = mulberry32(hashString(level.id));
    const stars = [];
    const starCount = Math.round(40 * world.width / 1280);
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: -200 + rng() * (world.width + 400),
        y: -150 + rng() * world.height * 0.6,
        r: 0.8 + rng() * 1.4,
        alpha: 0.25 + rng() * 0.4,
        color: '#cdd3ea',
      });
    }
    const silhouettes = (count, minH, maxH, color, alpha) => {
      const shapes = [];
      for (let i = 0; i < count; i++) {
        const w = 80 + rng() * 180;
        const h = minH + rng() * (maxH - minH);
        shapes.push({
          x: -200 + rng() * (world.width + 400 - w),
          y: world.height - h,
          w,
          h: h + 500, // extend below the world so the camera never sees under them
          color,
          alpha,
        });
      }
      return shapes;
    };
    const far = Math.round(10 * world.width / 1280);
    const near = Math.round(6 * world.width / 1280);
    layers = [
      { factor: 0.12, shapes: stars },
      { factor: 0.3, shapes: silhouettes(far, 120, 360, mixHex(level.accent, '#12141d', 0.75), 1) },
      { factor: 0.55, shapes: silhouettes(near, 60, 220, mixHex(level.accent, '#12141d', 0.55), 0.9) },
    ];
    this._bgCache.set(level.id, layers);
    return layers;
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

  drawHazards(level, tick) {
    const { ctx } = this;
    for (const h of level.hazards ?? []) {
      if (h.type === 'saw') this.drawSaw(h, tick);
      else if (h.type === 'bounce') this.drawBouncePad(h, tick);
    }
  }

  drawSaw(h, tick) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate((tick * 0.3) % (Math.PI * 2));
    // Toothed disc.
    const teeth = 12;
    ctx.fillStyle = '#c2c7d6';
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
      ctx.lineTo(Math.cos(a0) * h.r, Math.sin(a0) * h.r);
      ctx.lineTo(Math.cos(a1) * (h.r + 6), Math.sin(a1) * (h.r + 6));
    }
    ctx.closePath();
    ctx.fill();
    // Hub.
    ctx.fillStyle = '#7c8298';
    ctx.beginPath();
    ctx.arc(0, 0, h.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b5064';
    ctx.beginPath();
    ctx.arc(0, 0, h.r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawBouncePad(h, tick) {
    const { ctx } = this;
    // Springy pad sitting on its surface, top at h.y; gentle idle pulse.
    const pulse = Math.sin(tick * 0.12) * 1.5;
    const top = h.y - 4 - pulse;
    ctx.fillStyle = '#2b3350';
    ctx.fillRect(h.x, h.y - 2, h.w, h.h + 6);           // base
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.roundRect(h.x, top, h.w, 10, 5);                // bouncy top
    ctx.fill();
    // Up-chevrons hint at the launch.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    const cx = h.x + h.w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, top + 6);
    ctx.lineTo(cx, top + 1);
    ctx.lineTo(cx + 8, top + 6);
    ctx.stroke();
  }

  // --- Stick figures -------------------------------------------------------

  drawFighter(f, tick, level) {
    const { ctx } = this;

    // Laser sight is drawn in world space, under the figure, before any squash.
    if (f.weaponId === 'sniper' && level) this.drawLaserSight(f, level);

    // Squash & stretch: airborne stretch along vertical speed, plus a squash
    // pulse on landing. Volume-preserving scale around the feet.
    const onGround = f.onGround ?? true;
    const vy = f.vy ?? 0;
    const st = this._figState.get(f.id) ?? { wasAir: false, squash: 0 };
    if (st.wasAir && onGround) {
      st.squash = 1;
      this.effects.push({ type: 'dust', x: f.x, y: f.y + FOOT_Y, dir: 0, age: 0, life: 12 });
    }
    st.wasAir = !onGround;
    st.squash = st.squash > 0.02 ? st.squash * 0.8 : 0;
    this._figState.set(f.id, st);

    let sxScale = 1, syScale = 1;
    if (st.squash > 0) {
      syScale = 1 - 0.28 * st.squash;
      sxScale = 1 + 0.28 * st.squash;
    } else if (!onGround) {
      const stretch = Math.min(0.3, Math.abs(vy) / 26);
      syScale = 1 + stretch;
      sxScale = 1 - stretch * 0.6;
    }

    ctx.save();
    ctx.translate(f.x, f.y);
    if (sxScale !== 1 || syScale !== 1) {
      ctx.translate(0, FOOT_Y);
      ctx.scale(sxScale, syScale);
      ctx.translate(0, -FOOT_Y);
    }
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

  // Sniper laser: a line from the muzzle along the aim, raycast to the first
  // solid surface, brightening/thickening as the shot charges.
  drawLaserSight(f, level) {
    const { ctx } = this;
    const weapon = WEAPONS.sniper;
    const ax = f.aimX ?? f.facing ?? 1;
    const ay = f.aimY ?? 0;
    const len = Math.hypot(ax, ay) || 1;
    const dx = ax / len;
    const dy = ay / len;
    const ox = f.x + dx * weapon.barrel;
    const oy = f.y + GUN_MOUNT_Y + dy * weapon.barrel;

    const maxDist = 2600;
    const step = 10;
    let dist = maxDist;
    for (let d = step; d <= maxDist; d += step) {
      const px = ox + dx * d;
      const py = oy + dy * d;
      const inRect = (r) => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
      if (level.solids.some(inRect)) { dist = d; break; }
    }

    const charge = Math.min(1, (f.chargeFrames ?? 0) / weapon.chargeFrames);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.5 * charge;
    ctx.strokeStyle = charge >= 0.99 ? '#ff5a4d' : '#ff8a7a';
    ctx.lineWidth = 1 + 2 * charge;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + dx * dist, oy + dy * dist);
    ctx.stroke();
    // Charge glow at the muzzle.
    if (charge > 0) {
      ctx.globalAlpha = charge;
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath();
      ctx.arc(ox, oy, 2 + 5 * charge, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  spawnBlood(x, y, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.5;
      this.effects.push({
        type: 'blood', x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        age: 0, life: 22 + Math.random() * 14,
      });
    }
  }

  // Client-side corpse physics: fly from the killing blow, tumble, land on the
  // level's solids, slide to rest, then fade. Purely cosmetic.
  stepAndDrawRagdolls(level) {
    for (const [id, r] of this.ragdolls) {
      r.age += 1;
      if (r.age > RAGDOLL_LIFE) { this.ragdolls.delete(id); continue; }

      if (!r.settled) {
        r.vy = Math.min(r.vy + RAGDOLL_GRAVITY, 18);
        r.x += r.vx;
        r.y += r.vy;
        r.angle += r.angVel;

        // Rest on the first solid whose top the corpse crosses while falling.
        const foot = r.y + 24;
        for (const s of level.solids) {
          if (r.x > s.x && r.x < s.x + s.w && foot >= s.y && foot - r.vy <= s.y + 2 && r.vy >= 0) {
            r.y = s.y - 24;
            r.vy = 0;
            r.vx *= RAGDOLL_FRICTION;
            r.angVel *= 0.5;
            if (Math.abs(r.vx) < 0.2) { r.vx = 0; r.settled = true; r.angle = Math.PI / 2 * Math.sign(r.angle || 1); }
            break;
          }
        }
      }

      this.drawRagdoll(r);
    }
  }

  drawRagdoll(r) {
    const { ctx } = this;
    const fade = r.age > RAGDOLL_LIFE - 40 ? (RAGDOLL_LIFE - r.age) / 40 : 1;
    ctx.save();
    ctx.globalAlpha = 0.85 * fade;
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);
    ctx.strokeStyle = r.color;
    ctx.fillStyle = r.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    line(ctx, 0, -18, 0, 10);       // torso
    line(ctx, 0, 10, -8, 26);       // legs, splayed
    line(ctx, 0, 10, 9, 24);
    line(ctx, 0, -14, -11, -4);     // arms, limp
    line(ctx, 0, -14, 10, -8);
    ctx.beginPath();
    ctx.arc(0, -26, HEAD_R - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawCorpse(f) {
    // Fallen stick figure where they died, faded. Off-view corpses are
    // clipped by the canvas, so no bounds guard is needed.
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.translate(f.x, f.y + FIGHTER_HURTBOX.h / 2 - 6);
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
    if (p.kind === 'thrown') {
      // A tumbling gun.
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin ?? 0);
      ctx.strokeStyle = '#e8e8ec';
      ctx.fillStyle = '#e8e8ec';
      ctx.lineWidth = 3;
      ctx.translate(-8, 0);
      drawGunShape(ctx, p.weaponId);
      ctx.restore();
      return;
    }
    if (p.weaponId === 'grenade') {
      // Lobbed bomb: dark orb + lit fuse spark.
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = '#2c2f3a';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath();
      ctx.arc(3, -6, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
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
          const r = (e.big ? 11 : 6) * (1 - t) + 2;
          ctx.fillStyle = `rgba(255, 220, 120, ${1 - t})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
          ctx.fill();
          // Spark spokes for extra snap (bigger on a charged shot).
          ctx.strokeStyle = `rgba(255, 240, 190, ${(1 - t) * 0.8})`;
          ctx.lineWidth = 1.5;
          const spokes = e.big ? 6 : 4;
          for (let i = 0; i < spokes; i++) {
            const a = (i / spokes) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
            ctx.lineTo(e.x + Math.cos(a) * (r + (e.big ? 12 : 7)), e.y + Math.sin(a) * (r + (e.big ? 12 : 7)));
            ctx.stroke();
          }
          break;
        }
        case 'blood': {
          e.vy += 0.35; // droplets fall
          e.x += e.vx;
          e.y += e.vy;
          ctx.fillStyle = `rgba(200, 40, 40, ${Math.max(0, 1 - t)})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 2.4 * (1 - t) + 0.6, 0, Math.PI * 2);
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
        case 'dashTrail': {
          // Speed lines trailing opposite the dash direction.
          ctx.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.6})`;
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            const y = e.y - 14 + i * 14;
            const len = (26 - i * 6) * (1 - t);
            ctx.beginPath();
            ctx.moveTo(e.x - e.dir * 8, y);
            ctx.lineTo(e.x - e.dir * (8 + len), y);
            ctx.stroke();
          }
          break;
        }
        case 'dust': {
          // Kick-off puffs drifting away from the wall.
          ctx.fillStyle = `rgba(200,205,225,${(1 - t) * 0.5})`;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(e.x + e.dir * t * (10 + i * 6), e.y + 16 - i * 10, 3 * (1 - t) + 1, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'bounceRing': {
          // Expanding launch ring at the pad.
          ctx.strokeStyle = `rgba(255,179,71,${1 - t})`;
          ctx.lineWidth = 3 * (1 - t) + 1;
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, 10 + t * 34, 5 + t * 12, 0, 0, Math.PI * 2);
          ctx.stroke();
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
    // Hazard bounds: saw hit-circles and bounce-pad launch lines.
    ctx.strokeStyle = '#ffaa00';
    for (const h of getLevel(state.levelIndex ?? 0).hazards ?? []) {
      if (h.type === 'saw') {
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (h.type === 'bounce') {
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x + h.w, h.y);
        ctx.stroke();
      }
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
    case 'grenade':
      ctx.beginPath();
      ctx.arc(4, 2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(2, -7, 4, 4); // fuse cap
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

// --- Background helpers --------------------------------------------------------

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Blend hexA toward hexB by t (0 → A, 1 → B).
function mixHex(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ch = (shift) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
