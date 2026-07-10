// Transport-agnostic simulation core.
// stepGame(state, inputs, dt) is pure: no environment imports, no module
// globals — everything the sim knows lives in the state object (including the
// RNG cursor for weapon drops), so the same code runs on the server (online)
// and in the browser (local), and tests are deterministic for a given seed.

import {
  GRAVITY, TERMINAL_VY, GROUND_ACCEL, GROUND_FRICTION, AIR_ACCEL, AIR_DRAG,
  MOVE_SPEED, JUMP_VELOCITY, AIR_JUMPS,
  FLOOR, PLATFORMS, SPAWN_POINTS, BLAST,
  FIGHTER_HURTBOX, MAX_HP, FIGHTER_COLORS, HIT_FLINCH_FRAMES,
  PUNCH_DAMAGE, PUNCH_RANGE, PUNCH_RADIUS, PUNCH_KNOCKBACK, PUNCH_COOLDOWN,
  WEAPON_SPAWN_INTERVAL, WEAPON_SPAWN_MAX, WEAPON_DROP_FALL_SPEED, PICKUP_RADIUS,
  ROUND_WINS_TARGET, COUNTDOWN_FRAMES, ROUND_END_LINGER, ENDED_LINGER_FRAMES,
} from './constants.js';
import { WEAPONS, WEAPON_IDS } from './weapons.js';

export const EMPTY_INPUT = Object.freeze({
  left: false, right: false, down: false, jump: false, shoot: false,
  aimX: 0, aimY: 0,
});

// Frames of ignoring pass-through platforms after pressing down on one.
const DROP_THROUGH_FRAMES = 10;

// --- State construction ---------------------------------------------------

export function createInitialState(fighterConfigs, seed = 1) {
  const fighters = {};
  fighterConfigs.forEach((cfg, i) => {
    fighters[cfg.id] = createFighter(cfg, i);
  });
  const state = {
    tick: 0,
    phase: 'countdown',
    countdownTimer: COUNTDOWN_FRAMES,
    roundEndTimer: 0,
    endTimer: 0,
    roundNumber: 1,
    roundWinnerId: null,
    winnerId: null,
    rng: seed >>> 0,
    nextSpawnTimer: Math.floor(WEAPON_SPAWN_INTERVAL / 2), // first gun comes early
    nextEntityId: 1,
    fighters,
    drops: [],        // guns on/over the map: {id, weaponId, x, y, landed}
    projectiles: [],  // {id, ownerId, weaponId, x, y, vx, vy, life}
    events: [],
  };
  resetFightersForRound(state);
  return state;
}

function createFighter(cfg, index) {
  return {
    id: cfg.id,
    name: cfg.name || cfg.id,
    colorIndex: index % FIGHTER_COLORS.length,
    color: FIGHTER_COLORS[index % FIGHTER_COLORS.length],
    x: 0, y: 0, vx: 0, vy: 0,
    facing: index % 2 === 0 ? 1 : -1,
    aimX: index % 2 === 0 ? 1 : -1,
    aimY: 0,
    hp: MAX_HP,
    alive: true,
    roundWins: 0,
    onGround: false,
    jumpsRemaining: AIR_JUMPS,
    weaponId: null,          // null = fists
    fireCooldown: 0,
    flinchFrames: 0,
    dropThroughTimer: 0,
    prevInput: { ...EMPTY_INPUT }, // sim-side edge detection
  };
}

function resetFightersForRound(state) {
  const list = Object.values(state.fighters);
  list.forEach((f, i) => {
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
    f.x = spawn.x;
    f.y = spawn.y - FIGHTER_HURTBOX.h / 2; // spawn.y is a feet position
    f.vx = 0;
    f.vy = 0;
    f.facing = i % 2 === 0 ? 1 : -1;
    f.aimX = f.facing;
    f.aimY = 0;
    f.hp = MAX_HP;
    f.alive = true;
    f.onGround = false;
    f.jumpsRemaining = AIR_JUMPS;
    f.weaponId = null;
    f.fireCooldown = 0;
    f.flinchFrames = 0;
    f.dropThroughTimer = 0;
  });
}

// Deterministic RNG (mulberry32): the cursor lives in state so replaying the
// same inputs from the same seed reproduces every weapon drop.
function nextRandom(state) {
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- Main step --------------------------------------------------------------

export function stepGame(state, inputs, dt) {
  // Purity via clone-then-mutate: callers never see their input state change.
  const next = structuredClone(state);
  next.tick += 1;
  next.events = [];

  switch (next.phase) {
    case 'countdown': {
      next.countdownTimer -= 1;
      // Inputs tracked but ignored, so held buttons don't edge-trigger at start.
      for (const f of Object.values(next.fighters)) {
        f.prevInput = { ...(inputs[f.id] || EMPTY_INPUT) };
      }
      if (next.countdownTimer <= 0) {
        next.phase = 'playing';
        next.events.push({ type: 'roundStart', round: next.roundNumber });
      }
      return next;
    }

    case 'roundEnd': {
      next.roundEndTimer -= 1;
      // Physics keeps running so the last kill plays out under the banner.
      for (const f of Object.values(next.fighters)) {
        if (f.alive) stepFighterPhysics(next, f, EMPTY_INPUT);
      }
      if (next.roundEndTimer <= 0) beginNextRoundOrEnd(next);
      return next;
    }

    case 'ended': {
      if (next.endTimer > 0) {
        next.endTimer -= 1;
        for (const f of Object.values(next.fighters)) {
          if (f.alive) stepFighterPhysics(next, f, EMPTY_INPUT);
        }
      }
      return next;
    }
  }

  // --- playing ---
  stepWeaponSpawns(next);
  stepDrops(next);

  for (const fighter of Object.values(next.fighters)) {
    const input = inputs[fighter.id] || EMPTY_INPUT;
    if (fighter.alive) {
      stepFighter(next, fighter, input);
    }
    fighter.prevInput = { ...input };
  }

  stepProjectiles(next);
  checkPickups(next);
  checkBlastZones(next);
  checkRoundEnd(next);

  return next;
}

// --- Fighter stepping -----------------------------------------------------------

function stepFighter(state, fighter, input) {
  if (fighter.fireCooldown > 0) fighter.fireCooldown -= 1;
  if (fighter.flinchFrames > 0) fighter.flinchFrames -= 1;
  if (fighter.dropThroughTimer > 0) fighter.dropThroughTimer -= 1;

  updateAim(fighter, input);

  if (fighter.flinchFrames === 0) {
    applyMovementInput(fighter, input);
    if (input.shoot) {
      if (fighter.weaponId) tryFire(state, fighter, input);
      else tryPunch(state, fighter, input);
    }
  }

  stepFighterPhysics(state, fighter, input);
}

function updateAim(fighter, input) {
  const len = Math.hypot(input.aimX, input.aimY);
  if (len > 0.01) {
    fighter.aimX = input.aimX / len;
    fighter.aimY = input.aimY / len;
    if (Math.abs(fighter.aimX) > 0.15) fighter.facing = Math.sign(fighter.aimX);
  } else {
    // No aim input → aim where you face.
    fighter.aimX = fighter.facing;
    fighter.aimY = 0;
  }
}

function applyMovementInput(fighter, input) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (fighter.onGround) {
    if (dir !== 0) {
      fighter.vx += dir * GROUND_ACCEL;
      fighter.vx = clamp(fighter.vx, -MOVE_SPEED, MOVE_SPEED);
    } else {
      fighter.vx *= GROUND_FRICTION;
      if (Math.abs(fighter.vx) < 0.05) fighter.vx = 0;
    }
  } else if (dir !== 0) {
    fighter.vx += dir * AIR_ACCEL;
    fighter.vx = clamp(fighter.vx, -MOVE_SPEED, MOVE_SPEED);
  } else {
    fighter.vx *= AIR_DRAG;
  }

  if (pressed(input, fighter.prevInput, 'jump')) {
    if (fighter.onGround) {
      fighter.vy = JUMP_VELOCITY;
      fighter.onGround = false;
    } else if (fighter.jumpsRemaining > 0) {
      fighter.vy = JUMP_VELOCITY;
      fighter.jumpsRemaining -= 1;
    }
  }

  // Drop through pass-through platforms by pressing down while standing on one.
  if (fighter.onGround && input.down && isOnPassThroughPlatform(fighter)) {
    fighter.dropThroughTimer = DROP_THROUGH_FRAMES;
    fighter.onGround = false;
  }
}

function stepFighterPhysics(state, fighter, input) {
  if (!fighter.onGround) {
    fighter.vy = Math.min(fighter.vy + GRAVITY, TERMINAL_VY);
  }
  fighter.x += fighter.vx;
  fighter.y += fighter.vy;
  resolveStageCollision(fighter);
  if (fighter.onGround && !isSupported(fighter)) fighter.onGround = false;
}

// --- Punch & guns -----------------------------------------------------------------

function tryPunch(state, fighter, input) {
  if (fighter.fireCooldown > 0) return;
  if (!pressed(input, fighter.prevInput, 'shoot')) return; // punches don't auto-repeat
  fighter.fireCooldown = PUNCH_COOLDOWN;

  const fx = fighter.x + fighter.aimX * PUNCH_RANGE;
  const fy = fighter.y + fighter.aimY * PUNCH_RANGE;
  state.events.push({ type: 'punch', id: fighter.id, x: fx, y: fy });

  for (const victim of Object.values(state.fighters)) {
    if (victim.id === fighter.id || !victim.alive) continue;
    if (!circleOverlapsFighter(fx, fy, PUNCH_RADIUS, victim)) continue;
    damageFighter(state, victim, PUNCH_DAMAGE, fighter.id, {
      vx: fighter.aimX * PUNCH_KNOCKBACK,
      vy: fighter.aimY * PUNCH_KNOCKBACK - 2, // slight pop-up so punches feel meaty
    });
  }
}

function tryFire(state, fighter, input) {
  const weapon = WEAPONS[fighter.weaponId];
  if (fighter.fireCooldown > 0) return;
  if (!weapon.auto && !pressed(input, fighter.prevInput, 'shoot')) return;
  fighter.fireCooldown = weapon.fireCooldown;

  const baseAngle = Math.atan2(fighter.aimY, fighter.aimX);
  const muzzleX = fighter.x + fighter.aimX * weapon.barrel;
  const muzzleY = fighter.y + fighter.aimY * weapon.barrel;

  for (let i = 0; i < weapon.projectileCount; i++) {
    const angle = baseAngle + (nextRandom(state) - 0.5) * 2 * weapon.spread;
    state.projectiles.push({
      id: state.nextEntityId++,
      ownerId: fighter.id,
      weaponId: weapon.id,
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(angle) * weapon.projectileSpeed,
      vy: Math.sin(angle) * weapon.projectileSpeed,
      life: weapon.projectileLife,
    });
  }

  // Recoil pushes the shooter opposite the aim.
  fighter.vx -= fighter.aimX * weapon.recoil;
  fighter.vy -= fighter.aimY * weapon.recoil;

  state.events.push({ type: 'shot', id: fighter.id, weaponId: weapon.id, x: muzzleX, y: muzzleY });
}

// --- Projectiles ---------------------------------------------------------------

function stepProjectiles(state) {
  const survivors = [];
  for (const p of state.projectiles) {
    const weapon = WEAPONS[p.weaponId];
    p.vy += GRAVITY * weapon.gravityFactor;
    p.life -= 1;

    // Sub-step the movement so fast bullets can't tunnel through thin
    // platforms (or fighters) between frames.
    const speed = Math.hypot(p.vx, p.vy);
    const substeps = Math.max(1, Math.ceil(speed / 6));
    let consumed = false;

    for (let i = 0; i < substeps && !consumed; i++) {
      p.x += p.vx / substeps;
      p.y += p.vy / substeps;

      if (hitsStage(p)) {
        if (weapon.explosive) explode(state, p, weapon);
        consumed = true;
        break;
      }

      for (const victim of Object.values(state.fighters)) {
        if (!victim.alive || victim.id === p.ownerId) continue;
        if (!pointInFighter(p.x, p.y, victim)) continue;
        if (weapon.explosive) {
          explode(state, p, weapon);
        } else {
          const norm = speed || 1;
          damageFighter(state, victim, weapon.damage, p.ownerId, {
            vx: (p.vx / norm) * weapon.knockback,
            vy: (p.vy / norm) * weapon.knockback,
          });
        }
        consumed = true;
        break;
      }
    }

    if (!consumed && p.life > 0 && !outOfWorld(p)) survivors.push(p);
  }
  state.projectiles = survivors;
}

// Radial damage with linear falloff; hurts everyone in range, shooter included
// (bazooka self-damage is a core Stick Fight hazard).
function explode(state, p, weapon) {
  state.events.push({ type: 'explosion', x: p.x, y: p.y, radius: weapon.explosionRadius });
  for (const victim of Object.values(state.fighters)) {
    if (!victim.alive) continue;
    const dx = victim.x - p.x;
    const dy = victim.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > weapon.explosionRadius) continue;
    const falloff = 1 - dist / weapon.explosionRadius;
    const kb = weapon.explosionKnockback * (0.4 + 0.6 * falloff);
    const nx = dist > 0.01 ? dx / dist : 0;
    const ny = dist > 0.01 ? dy / dist : -1;
    damageFighter(state, victim, Math.round(weapon.explosionDamage * falloff + 5), p.ownerId, {
      vx: nx * kb,
      vy: ny * kb - 3, // explosions loft you
    });
  }
}

function damageFighter(state, victim, damage, attackerId, impulse) {
  victim.hp -= damage;
  victim.vx += impulse.vx;
  victim.vy += impulse.vy;
  victim.onGround = false;
  victim.flinchFrames = HIT_FLINCH_FRAMES;
  state.events.push({
    type: 'hit', victimId: victim.id, attackerId, damage,
    x: victim.x, y: victim.y,
  });
  if (victim.hp <= 0) killFighter(state, victim, attackerId);
}

function killFighter(state, victim, attackerId = null) {
  victim.hp = 0;
  victim.alive = false;
  victim.weaponId = null;
  state.events.push({ type: 'death', id: victim.id, attackerId, x: victim.x, y: victim.y });
}

// --- Weapon drops ---------------------------------------------------------------

function stepWeaponSpawns(state) {
  state.nextSpawnTimer -= 1;
  if (state.nextSpawnTimer > 0) return;
  state.nextSpawnTimer = WEAPON_SPAWN_INTERVAL;
  if (state.drops.length >= WEAPON_SPAWN_MAX) return;

  const weaponId = WEAPON_IDS[Math.floor(nextRandom(state) * WEAPON_IDS.length)];
  const x = FLOOR.x + 60 + nextRandom(state) * (FLOOR.w - 120);
  state.drops.push({
    id: state.nextEntityId++,
    weaponId,
    x,
    y: -30, // enters from above the screen
    landed: false,
  });
  state.events.push({ type: 'weaponSpawn', weaponId, x });
}

function stepDrops(state) {
  for (const drop of state.drops) {
    if (drop.landed) continue;
    drop.y += WEAPON_DROP_FALL_SPEED;
    // Land on the first surface whose top we cross.
    for (const s of [FLOOR, ...PLATFORMS]) {
      if (drop.x > s.x && drop.x < s.x + s.w &&
          drop.y >= s.y - 8 && drop.y - WEAPON_DROP_FALL_SPEED < s.y - 8) {
        drop.y = s.y - 8;
        drop.landed = true;
        break;
      }
    }
    if (drop.y > BLAST.bottom) drop.landed = true; // missed everything; unreachable, culled below
  }
  state.drops = state.drops.filter((d) => d.y <= FLOOR.y + 40);
}

function checkPickups(state) {
  for (const fighter of Object.values(state.fighters)) {
    if (!fighter.alive) continue;
    for (let i = 0; i < state.drops.length; i++) {
      const drop = state.drops[i];
      if (Math.hypot(drop.x - fighter.x, drop.y - fighter.y) > PICKUP_RADIUS) continue;
      // Touching a gun takes it; a held gun is swapped away (vanishes).
      fighter.weaponId = drop.weaponId;
      fighter.fireCooldown = 0;
      state.drops.splice(i, 1);
      state.events.push({ type: 'pickup', id: fighter.id, weaponId: drop.weaponId });
      break;
    }
  }
}

// --- Round lifecycle ---------------------------------------------------------------

function checkBlastZones(state) {
  for (const fighter of Object.values(state.fighters)) {
    if (!fighter.alive) continue;
    if (fighter.x < BLAST.left || fighter.x > BLAST.right
      || fighter.y < BLAST.top || fighter.y > BLAST.bottom) {
      killFighter(state, fighter);
    }
  }
}

function checkRoundEnd(state) {
  const all = Object.values(state.fighters);
  if (all.length < 2) return;
  const alive = all.filter((f) => f.alive);
  if (alive.length > 1) return;

  const winner = alive[0] ?? null; // null = everyone died: draw, no point
  if (winner) winner.roundWins += 1;
  state.roundWinnerId = winner?.id ?? null;
  state.phase = 'roundEnd';
  state.roundEndTimer = ROUND_END_LINGER;
  state.projectiles = [];
  state.events.push({
    type: 'roundEnd',
    winnerId: state.roundWinnerId,
    round: state.roundNumber,
    scores: Object.fromEntries(all.map((f) => [f.id, f.roundWins])),
  });
}

function beginNextRoundOrEnd(state) {
  const champion = Object.values(state.fighters).find((f) => f.roundWins >= ROUND_WINS_TARGET);
  if (champion) {
    state.phase = 'ended';
    state.endTimer = ENDED_LINGER_FRAMES;
    state.winnerId = champion.id;
    state.events.push({ type: 'matchEnd', winnerId: champion.id });
    return;
  }
  state.roundNumber += 1;
  state.roundWinnerId = null;
  state.phase = 'countdown';
  state.countdownTimer = COUNTDOWN_FRAMES;
  state.drops = [];
  state.projectiles = [];
  state.nextSpawnTimer = Math.floor(WEAPON_SPAWN_INTERVAL / 2);
  resetFightersForRound(state);
  state.events.push({ type: 'roundReset', round: state.roundNumber });
}

// --- Stage collision (fighter AABB vs floor/platforms) -------------------------

function fighterBottom(fighter) {
  return fighter.y + FIGHTER_HURTBOX.h / 2;
}

function isOnPassThroughPlatform(fighter) {
  const bottom = fighterBottom(fighter);
  return PLATFORMS.some((p) =>
    Math.abs(bottom - p.y) < 1 &&
    fighter.x > p.x && fighter.x < p.x + p.w
  );
}

function resolveStageCollision(fighter) {
  const halfW = FIGHTER_HURTBOX.w / 2;
  const halfH = FIGHTER_HURTBOX.h / 2;
  const wasFalling = fighter.vy >= 0;
  const prevBottom = fighter.y - fighter.vy + halfH;

  // Solid floor: land on top; block sides/underside.
  const f = FLOOR;
  const overlapsFloorX = fighter.x + halfW > f.x && fighter.x - halfW < f.x + f.w;
  const overlapsFloorY = fighter.y + halfH > f.y && fighter.y - halfH < f.y + f.h;
  if (overlapsFloorX && overlapsFloorY) {
    if (wasFalling && prevBottom <= f.y + 0.001) {
      landOn(fighter, f.y);
    } else if (fighter.y - fighter.vy - halfH >= f.y + f.h && fighter.vy < 0) {
      fighter.y = f.y + f.h + halfH; // bonked the underside
      fighter.vy = 0;
    } else {
      const fromLeft = fighter.x < f.x + f.w / 2;
      fighter.x = fromLeft ? f.x - halfW : f.x + f.w + halfW;
      fighter.vx = 0;
    }
  }

  // Pass-through platforms: only catch a falling fighter whose feet were above
  // the platform top last frame, unless they're deliberately dropping through.
  if (wasFalling && fighter.dropThroughTimer === 0) {
    for (const p of PLATFORMS) {
      const overlapsX = fighter.x > p.x && fighter.x < p.x + p.w;
      const bottom = fighter.y + halfH;
      if (overlapsX && prevBottom <= p.y + 0.001 && bottom >= p.y) {
        landOn(fighter, p.y);
        break;
      }
    }
  }
}

function landOn(fighter, surfaceY) {
  fighter.y = surfaceY - FIGHTER_HURTBOX.h / 2;
  fighter.vy = 0;
  fighter.onGround = true;
  fighter.jumpsRemaining = AIR_JUMPS;
}

function isSupported(fighter) {
  const bottom = fighterBottom(fighter);
  const halfW = FIGHTER_HURTBOX.w / 2;
  const onFloor =
    Math.abs(bottom - FLOOR.y) < 1 &&
    fighter.x + halfW > FLOOR.x && fighter.x - halfW < FLOOR.x + FLOOR.w;
  return onFloor || isOnPassThroughPlatform(fighter);
}

// --- Geometry helpers --------------------------------------------------------------

function hitsStage(p) {
  const inRect = (r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  return inRect(FLOOR) || PLATFORMS.some(inRect);
}

function outOfWorld(p) {
  return p.x < BLAST.left || p.x > BLAST.right || p.y < BLAST.top || p.y > BLAST.bottom;
}

function pointInFighter(x, y, fighter) {
  return Math.abs(x - fighter.x) < FIGHTER_HURTBOX.w / 2
    && Math.abs(y - fighter.y) < FIGHTER_HURTBOX.h / 2;
}

function circleOverlapsFighter(cx, cy, r, fighter) {
  const nearX = clamp(cx, fighter.x - FIGHTER_HURTBOX.w / 2, fighter.x + FIGHTER_HURTBOX.w / 2);
  const nearY = clamp(cy, fighter.y - FIGHTER_HURTBOX.h / 2, fighter.y + FIGHTER_HURTBOX.h / 2);
  return Math.hypot(cx - nearX, cy - nearY) <= r;
}

function pressed(input, prev, key) {
  return input[key] && !prev[key];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
