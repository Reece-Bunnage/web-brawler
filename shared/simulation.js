// Transport-agnostic simulation core.
// stepGame(state, inputs, dt) is pure: no environment imports, no module
// globals — everything the sim knows lives in the state object (including the
// RNG cursor for weapon drops), so the same code runs on the server (online)
// and in the browser (local), and tests are deterministic for a given seed.

import {
  GRAVITY, TERMINAL_VY, GROUND_ACCEL, GROUND_FRICTION, AIR_ACCEL, AIR_DRAG,
  MOVE_SPEED, JUMP_VELOCITY, AIR_JUMPS,
  DASH_SPEED, DASH_FRAMES, DASH_COOLDOWN, AIR_DASHES,
  WALL_SLIDE_SPEED, WALL_JUMP_VY, WALL_JUMP_KICK,
  FIGHTER_HURTBOX, GUN_MOUNT_Y, MAX_HP, FIGHTER_COLORS, HIT_FLINCH_FRAMES,
  PUNCH_DAMAGE, PUNCH_RANGE, PUNCH_RADIUS, PUNCH_KNOCKBACK, PUNCH_COOLDOWN,
  SAW_DAMAGE, SAW_KNOCKBACK, HAZARD_HIT_COOLDOWN, BOUNCE_POWER,
  THROW_SPEED, THROW_DAMAGE, THROW_KNOCKBACK, THROW_LIFE,
  WEAPON_SPAWN_INTERVAL, WEAPON_SPAWN_MAX, WEAPON_DROP_FALL_SPEED, PICKUP_RADIUS,
  ROUND_WINS_TARGET, COUNTDOWN_FRAMES, ROUND_END_LINGER, ENDED_LINGER_FRAMES,
} from './constants.js';
import { WEAPONS, WEAPON_IDS } from './weapons.js';
import { LEVELS, blastBounds } from './levels.js';

export const EMPTY_INPUT = Object.freeze({
  left: false, right: false, down: false, jump: false, shoot: false, dash: false, throw: false,
  aimX: 0, aimY: 0,
});

// Frames of ignoring pass-through platforms after pressing down on one.
const DROP_THROUGH_FRAMES = 10;

// --- State construction ---------------------------------------------------

// levelIndex: pass an index to pin the map (tests); null picks one by seed.
export function createInitialState(fighterConfigs, seed = 1, levelIndex = null) {
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
    levelIndex: 0, // set for real just below (needs the rng cursor in place)
    nextSpawnTimer: Math.floor(WEAPON_SPAWN_INTERVAL / 2), // first gun comes early
    nextEntityId: 1,
    fighters,
    drops: [],        // guns on/over the map: {id, weaponId, x, y, landed}
    projectiles: [],  // {id, ownerId, weaponId, x, y, vx, vy, life}
    events: [],
  };
  state.levelIndex = levelIndex ?? Math.floor(nextRandom(state) * LEVELS.length);
  resetFightersForRound(state);
  return state;
}

function getLevel(state) {
  return LEVELS[state.levelIndex] ?? LEVELS[0];
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
    chargeFrames: 0,         // > 0 while charging a charge-weapon (sniper)
    flinchFrames: 0,
    dropThroughTimer: 0,
    dashFrames: 0,           // > 0 while mid-dash
    dashDir: 1,
    dashCooldown: 0,
    airDashesRemaining: AIR_DASHES,
    wallDir: 0,              // -1/1 = pressing into a wall on that side (this frame)
    hazardCooldown: 0,       // brief hazard immunity after a saw hit
    bounced: false,          // set by a bounce pad this frame; consumed for the event
    prevInput: { ...EMPTY_INPUT }, // sim-side edge detection
  };
}

function resetFightersForRound(state) {
  const spawnPoints = getLevel(state).spawnPoints;
  const list = Object.values(state.fighters);
  list.forEach((f, i) => {
    const spawn = spawnPoints[i % spawnPoints.length];
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
    f.chargeFrames = 0;
    f.flinchFrames = 0;
    f.dropThroughTimer = 0;
    f.dashFrames = 0;
    f.dashCooldown = 0;
    f.airDashesRemaining = AIR_DASHES;
    f.wallDir = 0;
    f.hazardCooldown = 0;
    f.bounced = false;
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
  stepHazards(next);
  checkBlastZones(next);
  checkRoundEnd(next);

  return next;
}

// --- Fighter stepping -----------------------------------------------------------

function stepFighter(state, fighter, input) {
  if (fighter.fireCooldown > 0) fighter.fireCooldown -= 1;
  if (fighter.flinchFrames > 0) fighter.flinchFrames -= 1;
  if (fighter.dropThroughTimer > 0) fighter.dropThroughTimer -= 1;
  if (fighter.dashCooldown > 0) fighter.dashCooldown -= 1;

  updateAim(fighter, input);

  if (fighter.flinchFrames === 0) {
    applyMovementInput(state, fighter, input, getLevel(state));
    const weapon = fighter.weaponId ? WEAPONS[fighter.weaponId] : null;
    // Throw takes priority over firing: hurl the held gun on a fresh press.
    if (fighter.weaponId && pressed(input, fighter.prevInput, 'throw')) {
      throwWeapon(state, fighter);
    } else if (weapon && weapon.charge) {
      stepChargeWeapon(state, fighter, input, weapon); // hold to charge, release to fire
    } else if (input.shoot) {
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

function applyMovementInput(state, fighter, input, level) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // Dash: a committed burst in the held direction (or facing). One per
  // cooldown; airborne dashes are limited and refresh on landing.
  if (pressed(input, fighter.prevInput, 'dash')
    && fighter.dashCooldown === 0 && fighter.dashFrames === 0
    && (fighter.onGround || fighter.airDashesRemaining > 0)) {
    if (!fighter.onGround) fighter.airDashesRemaining -= 1;
    fighter.dashDir = dir || fighter.facing;
    fighter.dashFrames = DASH_FRAMES;
    fighter.dashCooldown = DASH_COOLDOWN;
    fighter.facing = fighter.dashDir;
    state.events.push({ type: 'dash', id: fighter.id, x: fighter.x, y: fighter.y, dir: fighter.dashDir });
  }

  if (fighter.dashFrames > 0) {
    fighter.vx = fighter.dashDir * DASH_SPEED; // steering is locked mid-dash
  } else if (fighter.onGround) {
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
      fighter.dashFrames = 0; // jump cancels a dash
      state.events.push({ type: 'jump', id: fighter.id, x: fighter.x, y: fighter.y, air: false });
    } else if (fighter.wallDir !== 0) {
      // Wall jump: free (doesn't spend an air jump), kicks away from the wall.
      fighter.vy = WALL_JUMP_VY;
      fighter.vx = -fighter.wallDir * WALL_JUMP_KICK;
      fighter.facing = -fighter.wallDir;
      fighter.dashFrames = 0;
      state.events.push({ type: 'wallJump', id: fighter.id, x: fighter.x, y: fighter.y, dir: -fighter.wallDir });
    } else if (fighter.jumpsRemaining > 0) {
      fighter.vy = JUMP_VELOCITY;
      fighter.jumpsRemaining -= 1;
      fighter.dashFrames = 0;
      state.events.push({ type: 'jump', id: fighter.id, x: fighter.x, y: fighter.y, air: true });
    }
  }

  // Drop through pass-through platforms by pressing down while standing on one.
  if (fighter.onGround && input.down && isOnPassThroughPlatform(fighter, level)) {
    fighter.dropThroughTimer = DROP_THROUGH_FRAMES;
    fighter.onGround = false;
  }
}

function stepFighterPhysics(state, fighter, input) {
  const level = getLevel(state);
  if (fighter.dashFrames > 0) {
    // Dashing: gravity is suspended, the burst is purely horizontal.
    fighter.dashFrames -= 1;
    fighter.vy = 0;
  } else if (!fighter.onGround) {
    fighter.vy = Math.min(fighter.vy + GRAVITY, TERMINAL_VY);
    // Wall slide: holding into a wall brakes the fall.
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (fighter.wallDir !== 0 && dir === fighter.wallDir && fighter.vy > WALL_SLIDE_SPEED) {
      fighter.vy = WALL_SLIDE_SPEED;
    }
  }
  fighter.x += fighter.vx;
  fighter.y += fighter.vy;
  resolveStageCollision(fighter, level);
  if (fighter.bounced) {
    fighter.bounced = false;
    state.events.push({ type: 'bounce', id: fighter.id, x: fighter.x, y: fighter.y });
  }
  if (fighter.onGround && !isSupported(fighter, level)) fighter.onGround = false;
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
    // Check along the whole arm (half reach and full reach), not just at the
    // fist — otherwise a point-blank punch whiffs past an overlapping target.
    const hit = [0.5, 1].some((reach) => circleOverlapsFighter(
      fighter.x + fighter.aimX * PUNCH_RANGE * reach,
      fighter.y + fighter.aimY * PUNCH_RANGE * reach,
      PUNCH_RADIUS, victim));
    if (!hit) continue;
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
  const muzzleY = fighter.y + GUN_MOUNT_Y + fighter.aimY * weapon.barrel;

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

// Charge weapons (sniper): accumulate charge while shoot is held, fire on
// release. Damage, knockback and projectile speed scale with the charge held.
function stepChargeWeapon(state, fighter, input, weapon) {
  if (fighter.fireCooldown > 0) return; // still recovering from the last shot
  if (input.shoot) {
    fighter.chargeFrames = Math.min(fighter.chargeFrames + 1, weapon.chargeFrames);
  } else if (fighter.chargeFrames > 0) {
    fireChargedShot(state, fighter, weapon);
    fighter.chargeFrames = 0;
  }
}

function fireChargedShot(state, fighter, weapon) {
  const ratio = clamp(fighter.chargeFrames / weapon.chargeFrames, 0, 1);
  const power = 0.5 + 0.5 * ratio; // a tap still does half; full charge is lethal
  fighter.fireCooldown = weapon.fireCooldown;

  const angle = Math.atan2(fighter.aimY, fighter.aimX);
  const speed = weapon.projectileSpeed * (0.7 + 0.3 * ratio);
  const muzzleX = fighter.x + fighter.aimX * weapon.barrel;
  const muzzleY = fighter.y + GUN_MOUNT_Y + fighter.aimY * weapon.barrel;
  state.projectiles.push({
    id: state.nextEntityId++,
    ownerId: fighter.id,
    weaponId: weapon.id,
    x: muzzleX,
    y: muzzleY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: weapon.projectileLife,
    power, // scales damage + knockback on hit
  });

  fighter.vx -= fighter.aimX * weapon.recoil * power;
  fighter.vy -= fighter.aimY * weapon.recoil * power;
  state.events.push({
    type: 'shot', id: fighter.id, weaponId: weapon.id,
    x: muzzleX, y: muzzleY, charged: ratio >= 0.99,
  });
}

// Hurl the held gun as an arcing, spinning projectile. Empties the hands
// (back to fists) regardless of whether it connects.
function throwWeapon(state, fighter) {
  const weaponId = fighter.weaponId;
  fighter.weaponId = null;
  fighter.fireCooldown = 0;
  fighter.chargeFrames = 0;

  const spin = (fighter.aimX >= 0 ? 1 : -1) * 0.5;
  state.projectiles.push({
    id: state.nextEntityId++,
    ownerId: fighter.id,
    weaponId,
    kind: 'thrown',
    x: fighter.x + fighter.aimX * 22,
    y: fighter.y + GUN_MOUNT_Y + fighter.aimY * 22,
    vx: fighter.aimX * THROW_SPEED,
    vy: fighter.aimY * THROW_SPEED - 2, // slight loft
    life: THROW_LIFE,
    spin: 0,
    spinRate: spin,
  });
  state.events.push({ type: 'throw', id: fighter.id, weaponId, x: fighter.x, y: fighter.y + GUN_MOUNT_Y });
}

// --- Projectiles ---------------------------------------------------------------

function stepProjectiles(state) {
  const survivors = [];
  const blast = blastBounds(getLevel(state));
  for (const p of state.projectiles) {
    if (p.kind === 'thrown') {
      if (stepThrownWeapon(state, p, blast)) survivors.push(p);
      continue;
    }
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

      if (hitsStage(p, getLevel(state))) {
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
          const scale = p.power ?? 1; // charge weapons scale damage + knockback
          damageFighter(state, victim, Math.round(weapon.damage * scale), p.ownerId, {
            vx: (p.vx / norm) * weapon.knockback * scale,
            vy: (p.vy / norm) * weapon.knockback * scale,
          });
        }
        consumed = true;
        break;
      }
    }

    if (!consumed && p.life > 0 && !outOfWorld(p, blast)) survivors.push(p);
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

// A thrown gun: full gravity arc + spin. A fighter hit deals damage + knockback
// and destroys the gun; hitting the stage or running out of flight time drops it
// back onto the map as a recoverable weapon. Returns true to keep it flying.
function stepThrownWeapon(state, p, blast) {
  p.vy = Math.min(p.vy + GRAVITY, TERMINAL_VY);
  p.spin += p.spinRate;
  p.life -= 1;

  const speed = Math.hypot(p.vx, p.vy);
  const substeps = Math.max(1, Math.ceil(speed / 6));
  const level = getLevel(state);

  for (let i = 0; i < substeps; i++) {
    p.x += p.vx / substeps;
    p.y += p.vy / substeps;

    for (const victim of Object.values(state.fighters)) {
      if (!victim.alive || victim.id === p.ownerId) continue;
      if (!pointInFighter(p.x, p.y, victim)) continue;
      const norm = speed || 1;
      damageFighter(state, victim, THROW_DAMAGE, p.ownerId, {
        vx: (p.vx / norm) * THROW_KNOCKBACK,
        vy: (p.vy / norm) * THROW_KNOCKBACK - 1,
      });
      return false; // gun consumed on a hit
    }

    if (hitsStage(p, level)) {
      dropThrownWeapon(state, p);
      return false;
    }
  }

  if (outOfWorld(p, blast)) return false;
  if (p.life <= 0) { dropThrownWeapon(state, p); return false; }
  return true;
}

// Return a thrown gun to the map as a drop; stepDrops settles it next tick.
function dropThrownWeapon(state, p) {
  state.drops.push({
    id: state.nextEntityId++,
    weaponId: p.weaponId,
    x: p.x,
    y: p.y,
    landed: false,
  });
  state.events.push({ type: 'weaponLand', weaponId: p.weaponId, x: p.x, y: p.y });
}

function damageFighter(state, victim, damage, attackerId, impulse) {
  victim.hp -= damage;
  victim.vx += impulse.vx;
  victim.vy += impulse.vy;
  victim.onGround = false;
  victim.flinchFrames = HIT_FLINCH_FRAMES;
  victim.dashFrames = 0;   // getting hit interrupts a dash
  victim.chargeFrames = 0; // ...and interrupts a charging shot
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
  victim.chargeFrames = 0;
  // Carry the death impulse + color on the event so the client can ragdoll the corpse.
  state.events.push({
    type: 'death', id: victim.id, attackerId, color: victim.color,
    x: victim.x, y: victim.y, vx: victim.vx, vy: victim.vy,
  });
}

// --- Weapon drops ---------------------------------------------------------------

function stepWeaponSpawns(state) {
  state.nextSpawnTimer -= 1;
  if (state.nextSpawnTimer > 0) return;
  state.nextSpawnTimer = WEAPON_SPAWN_INTERVAL;
  if (state.drops.length >= WEAPON_SPAWN_MAX) return;

  const weaponId = WEAPON_IDS[Math.floor(nextRandom(state) * WEAPON_IDS.length)];
  const { min, max } = getLevel(state).dropRange;
  const x = min + nextRandom(state) * (max - min);
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
  const level = getLevel(state);
  for (const drop of state.drops) {
    if (drop.landed) continue;
    drop.y += WEAPON_DROP_FALL_SPEED;
    // Land on the first surface whose top we cross.
    for (const s of [...level.solids, ...level.platforms]) {
      if (drop.x > s.x && drop.x < s.x + s.w &&
          drop.y >= s.y - 8 && drop.y - WEAPON_DROP_FALL_SPEED < s.y - 8) {
        drop.y = s.y - 8;
        drop.landed = true;
        break;
      }
    }
  }
  // A drop that missed every surface falls into the void and is culled.
  const blast = blastBounds(level);
  state.drops = state.drops.filter((d) => d.y <= blast.bottom);
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
      fighter.chargeFrames = 0;
      state.drops.splice(i, 1);
      state.events.push({ type: 'pickup', id: fighter.id, weaponId: drop.weaponId });
      break;
    }
  }
}

// --- Hazards -----------------------------------------------------------------------

// Static level hazards. Saws deal contact damage + radial knockback with a
// short per-fighter immunity window so a single touch can't drain you instantly
// (the knockback near an edge is usually what kills). Bounce pads are resolved
// in resolveStageCollision, not here.
function stepHazards(state) {
  const hazards = getLevel(state).hazards;
  if (!hazards) return;
  for (const fighter of Object.values(state.fighters)) {
    if (!fighter.alive) continue;
    if (fighter.hazardCooldown > 0) { fighter.hazardCooldown -= 1; continue; }
    for (const h of hazards) {
      if (h.type !== 'saw') continue;
      if (!circleOverlapsFighter(h.x, h.y, h.r, fighter)) continue;
      const dx = fighter.x - h.x;
      const dy = fighter.y - h.y;
      const dist = Math.hypot(dx, dy) || 1;
      damageFighter(state, fighter, SAW_DAMAGE, null, {
        vx: (dx / dist) * SAW_KNOCKBACK,
        vy: (dy / dist) * SAW_KNOCKBACK - 2, // slight upward pop
      });
      fighter.hazardCooldown = HAZARD_HIT_COOLDOWN;
      break;
    }
  }
}

// --- Round lifecycle ---------------------------------------------------------------

function checkBlastZones(state) {
  const blast = blastBounds(getLevel(state));
  for (const fighter of Object.values(state.fighters)) {
    if (!fighter.alive) continue;
    if (fighter.x < blast.left || fighter.x > blast.right
      || fighter.y < blast.top || fighter.y > blast.bottom) {
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
  // Rotate the map: pick a different level than the one just played.
  if (LEVELS.length > 1) {
    let next = state.levelIndex;
    while (next === state.levelIndex) {
      next = Math.floor(nextRandom(state) * LEVELS.length);
    }
    state.levelIndex = next;
  }
  resetFightersForRound(state);
  state.events.push({ type: 'roundReset', round: state.roundNumber, levelIndex: state.levelIndex });
}

// --- Stage collision (fighter AABB vs floor/platforms) -------------------------

function fighterBottom(fighter) {
  return fighter.y + FIGHTER_HURTBOX.h / 2;
}

function isOnPassThroughPlatform(fighter, level) {
  const bottom = fighterBottom(fighter);
  return level.platforms.some((p) =>
    Math.abs(bottom - p.y) < 1 &&
    fighter.x > p.x && fighter.x < p.x + p.w
  );
}

function resolveStageCollision(fighter, level) {
  const halfW = FIGHTER_HURTBOX.w / 2;
  const halfH = FIGHTER_HURTBOX.h / 2;
  const wasFalling = fighter.vy >= 0;
  const prevBottom = fighter.y - fighter.vy + halfH;
  fighter.wallDir = 0; // only a side collision this frame counts as wall contact

  // Solid blocks: land on top; block sides/underside.
  for (const s of level.solids) {
    const overlapsX = fighter.x + halfW > s.x && fighter.x - halfW < s.x + s.w;
    const overlapsY = fighter.y + halfH > s.y && fighter.y - halfH < s.y + s.h;
    if (!overlapsX || !overlapsY) continue;
    if (wasFalling && prevBottom <= s.y + 0.001) {
      landOn(fighter, s.y);
    } else if (fighter.y - fighter.vy - halfH >= s.y + s.h && fighter.vy < 0) {
      fighter.y = s.y + s.h + halfH; // bonked the underside
      fighter.vy = 0;
    } else {
      const fromLeft = fighter.x < s.x + s.w / 2;
      fighter.x = fromLeft ? s.x - halfW : s.x + s.w + halfW;
      fighter.vx = 0;
      fighter.wallDir = fromLeft ? 1 : -1; // wall is on this side of the fighter
      fighter.dashFrames = 0;              // dashing into a wall ends the dash
    }
  }

  // Pass-through platforms: only catch a falling fighter whose feet were above
  // the platform top last frame, unless they're deliberately dropping through.
  if (wasFalling && fighter.dropThroughTimer === 0) {
    for (const p of level.platforms) {
      const overlapsX = fighter.x > p.x && fighter.x < p.x + p.w;
      const bottom = fighter.y + halfH;
      if (overlapsX && prevBottom <= p.y + 0.001 && bottom >= p.y) {
        landOn(fighter, p.y);
        break;
      }
    }
  }

  // Bounce pads: same top-crossing test as a platform, but instead of landing
  // the fighter is launched upward (and jumps/air-dashes are refreshed). Runs
  // after solid/platform resolution so a fighter resting on the surface the pad
  // sits on (vy just zeroed) still gets flung on contact.
  if (wasFalling) {
    for (const h of level.hazards ?? []) {
      if (h.type !== 'bounce') continue;
      const overlapsX = fighter.x > h.x && fighter.x < h.x + h.w;
      const bottom = fighter.y + halfH;
      if (overlapsX && prevBottom <= h.y + 0.001 && bottom >= h.y) {
        fighter.y = h.y - halfH;
        fighter.vy = -BOUNCE_POWER;
        fighter.onGround = false;
        fighter.jumpsRemaining = AIR_JUMPS;
        fighter.airDashesRemaining = AIR_DASHES;
        fighter.dashFrames = 0;
        fighter.bounced = true; // caller emits the event
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
  fighter.airDashesRemaining = AIR_DASHES;
}

function isSupported(fighter, level) {
  const bottom = fighterBottom(fighter);
  const halfW = FIGHTER_HURTBOX.w / 2;
  const onSolid = level.solids.some((s) =>
    Math.abs(bottom - s.y) < 1 &&
    fighter.x + halfW > s.x && fighter.x - halfW < s.x + s.w);
  return onSolid || isOnPassThroughPlatform(fighter, level);
}

// --- Geometry helpers --------------------------------------------------------------

function hitsStage(p, level) {
  const inRect = (r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  return level.solids.some(inRect) || level.platforms.some(inRect);
}

function outOfWorld(p, blast) {
  return p.x < blast.left || p.x > blast.right || p.y < blast.top || p.y > blast.bottom;
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
