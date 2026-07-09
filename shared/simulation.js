// Transport-agnostic simulation core (instructions §2.1).
// stepGame(state, inputs, dt) is pure: no environment imports, no module
// globals — everything the sim knows lives in the state object, so the same
// code runs on the server (online) and in the browser (local).

import {
  GRAVITY, TERMINAL_VY, GROUND_ACCEL, GROUND_FRICTION, AIR_ACCEL, AIR_DRAG,
  FLOOR, PLATFORMS, SPAWN_POINTS, STOCKS, BLAST, RESPAWN_POINT,
  RESPAWN_IFRAMES, HITSTUN_PER_KNOCKBACK,
  SHIELD_MAX, SHIELD_REGEN, SHIELD_DRAIN_HELD, SHIELD_BREAK_STUN,
  DODGE_IFRAMES, ROLL_IFRAMES, ROLL_SPEED, ROLL_DURATION,
  SPOT_DODGE_DURATION, AIR_DODGE_DURATION, AIR_DODGE_BURST,
} from './constants.js';
import { CHARACTERS } from './characters.js';

export const EMPTY_INPUT = Object.freeze({
  left: false, right: false, up: false, down: false,
  jump: false, light: false, heavy: false, shield: false, dodge: false,
});

// Frames of ignoring pass-through platforms after pressing down on one.
const DROP_THROUGH_FRAMES = 10;

// States in which the fighter is free to act (attack, move, jump).
const NEUTRAL_STATES = new Set(['idle', 'run', 'air', 'respawning']);

// --- State construction ---------------------------------------------------

export function createInitialState(fighterConfigs) {
  const fighters = {};
  fighterConfigs.forEach((cfg, i) => {
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
    fighters[cfg.id] = createFighter(cfg, spawn, i);
  });
  return {
    tick: 0,
    phase: 'playing',
    winnerId: null,
    fighters,
    hitboxes: [],
    events: [],
  };
}

function createFighter(cfg, spawn, index) {
  const character = CHARACTERS[cfg.characterId];
  return {
    id: cfg.id,
    characterId: cfg.characterId,
    name: cfg.name || cfg.id,
    facing: index % 2 === 0 ? 1 : -1, // alternate spawns face inward-ish
    x: spawn.x,
    y: spawn.y - character.hurtbox.h / 2, // spawn.y is a feet position
    vx: 0,
    vy: 0,
    percent: 0,
    stocks: STOCKS,
    onGround: false,
    jumpsRemaining: character.airJumps,
    state: 'idle',
    stateTimer: 0,
    currentMove: null,
    moveHits: [],      // fighter ids already hit by the current move activation
    invulnFrames: 0,
    shieldHealth: SHIELD_MAX,
    airDodgeUsed: false,
    dropThroughTimer: 0,
    prevInput: { ...EMPTY_INPUT }, // sim-side edge detection (§6)
  };
}

// --- Main step --------------------------------------------------------------

export function stepGame(state, inputs, dt) {
  // Purity via clone-then-mutate: callers never see their input state change.
  const next = structuredClone(state);
  next.tick += 1;
  next.events = [];

  if (next.phase === 'ended') return next;

  // Movement/state first for everyone, then hits are resolved against the
  // post-move positions so simultaneous attacks are handled symmetrically.
  for (const fighter of Object.values(next.fighters)) {
    const input = inputs[fighter.id] || EMPTY_INPUT;
    stepFighter(next, fighter, input);
    fighter.prevInput = { ...input };
  }

  next.hitboxes = buildHitboxes(next);
  resolveHits(next);
  checkBlastZones(next);
  checkMatchEnd(next);

  return next;
}

function stepFighter(state, fighter, input) {
  if (fighter.stocks <= 0) return; // eliminated
  const character = CHARACTERS[fighter.characterId];

  tickTimers(fighter);
  resolveExpiredState(fighter);

  regenShield(fighter);

  if (NEUTRAL_STATES.has(fighter.state)) {
    if (!tryStartDodge(fighter, input)
      && !tryStartShield(fighter, input)
      && !tryStartAttack(fighter, character, input)) {
      applyMovementInput(fighter, character, input);
    }
  } else if (fighter.state === 'attack') {
    if (fighter.onGround) {
      fighter.vx *= GROUND_FRICTION; // ground attacks lock movement
    } else {
      applyAirDrift(fighter, character, input); // air attacks keep drift
    }
  } else if (fighter.state === 'shield') {
    stepShield(fighter, input);
  }
  // hitstun: no control at all — the launch trajectory plays out untouched.
  // dodge: committed — rolls keep their velocity, spot/air dodges ride physics.

  applyGravity(fighter);
  integratePosition(fighter);
  resolveStageCollision(fighter, character, input);
  updateGroundedState(fighter, character);
}

function tickTimers(fighter) {
  if (fighter.invulnFrames > 0) fighter.invulnFrames -= 1;
  if (fighter.dropThroughTimer > 0) fighter.dropThroughTimer -= 1;
  if (fighter.stateTimer > 0) fighter.stateTimer -= 1;
}

// When a timed state runs out, drop back to neutral; updateGroundedState
// picks the right neutral flavor (idle/run/air) at the end of the step.
function resolveExpiredState(fighter) {
  if (fighter.stateTimer > 0) return;
  if (fighter.state === 'attack' || fighter.state === 'hitstun' || fighter.state === 'dodge') {
    fighter.state = fighter.onGround ? 'idle' : 'air';
    fighter.currentMove = null;
    fighter.moveHits = [];
  }
}

// --- Shield & dodge -------------------------------------------------------

function regenShield(fighter) {
  if (fighter.state !== 'shield') {
    fighter.shieldHealth = Math.min(SHIELD_MAX, fighter.shieldHealth + SHIELD_REGEN);
  }
}

function tryStartShield(fighter, input) {
  // Ground-only: in the air the defensive option is the air dodge.
  if (!input.shield || !fighter.onGround || fighter.shieldHealth <= 0) return false;
  fighter.state = 'shield';
  fighter.stateTimer = 0; // held state, no fixed duration
  return true;
}

function stepShield(fighter, input) {
  fighter.vx *= GROUND_FRICTION; // movement locked while shielding
  fighter.shieldHealth -= SHIELD_DRAIN_HELD;
  if (fighter.shieldHealth <= 0) {
    breakShield(fighter);
    return;
  }
  if (!input.shield) {
    fighter.state = 'idle';
  }
}

function breakShield(fighter) {
  fighter.shieldHealth = 0;
  // Break stun reuses hitstun: no control, long enough to be heavily punished.
  fighter.state = 'hitstun';
  fighter.stateTimer = SHIELD_BREAK_STUN;
}

function tryStartDodge(fighter, input) {
  if (!pressed(input, fighter.prevInput, 'dodge')) return false;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (!fighter.onGround) {
    if (fighter.airDodgeUsed) return false; // once per airtime
    fighter.airDodgeUsed = true;
    fighter.state = 'dodge';
    fighter.stateTimer = AIR_DODGE_DURATION;
    fighter.invulnFrames = DODGE_IFRAMES;
    // Small directional burst; gravity still applies over the dodge.
    fighter.vx = dir * AIR_DODGE_BURST;
    fighter.vy = ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * AIR_DODGE_BURST;
    return true;
  }

  if (dir !== 0) {
    // Roll: travel with i-frames, facing preserved.
    fighter.state = 'dodge';
    fighter.stateTimer = ROLL_DURATION;
    fighter.invulnFrames = ROLL_IFRAMES;
    fighter.vx = dir * ROLL_SPEED;
  } else {
    // Spot dodge: i-frames in place.
    fighter.state = 'dodge';
    fighter.stateTimer = SPOT_DODGE_DURATION;
    fighter.invulnFrames = DODGE_IFRAMES;
    fighter.vx = 0;
  }
  return true;
}

// --- Attacks ------------------------------------------------------------------

function tryStartAttack(fighter, character, input) {
  const prev = fighter.prevInput;
  const strength = pressed(input, prev, 'light') ? 'light'
    : pressed(input, prev, 'heavy') ? 'heavy' : null;
  if (!strength) return false;

  // Direction priority: up > down > side > neutral.
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let variant = 'Neutral';
  if (input.up) variant = 'Up';
  else if (input.down) variant = 'Down';
  else if (dir !== 0) {
    variant = 'Side';
    fighter.facing = dir; // side attacks turn you before swinging
  }

  const moveKey = strength + variant;
  const move = character.moves[moveKey];
  if (!fighter.onGround && !move.canUseInAir) return false;

  fighter.state = 'attack';
  fighter.currentMove = moveKey;
  fighter.stateTimer = move.startup + move.active + move.recovery;
  fighter.moveHits = [];
  return true;
}

function moveElapsedFrames(fighter, move) {
  const total = move.startup + move.active + move.recovery;
  return total - fighter.stateTimer;
}

function buildHitboxes(state) {
  const hitboxes = [];
  for (const fighter of Object.values(state.fighters)) {
    if (fighter.state !== 'attack' || !fighter.currentMove) continue;
    const move = CHARACTERS[fighter.characterId].moves[fighter.currentMove];
    const elapsed = moveElapsedFrames(fighter, move);
    if (elapsed < move.startup || elapsed >= move.startup + move.active) continue;

    const hb = move.hitbox;
    const centerX = fighter.x + hb.offsetX * fighter.facing;
    const centerY = fighter.y + hb.offsetY;
    hitboxes.push({
      ownerId: fighter.id,
      moveKey: fighter.currentMove,
      x: centerX - hb.w / 2,
      y: centerY - hb.h / 2,
      w: hb.w,
      h: hb.h,
    });
  }
  return hitboxes;
}

function resolveHits(state) {
  for (const hb of state.hitboxes) {
    const attacker = state.fighters[hb.ownerId];
    const move = CHARACTERS[attacker.characterId].moves[hb.moveKey];

    for (const victim of Object.values(state.fighters)) {
      if (victim.id === attacker.id) continue;
      if (victim.stocks <= 0 || victim.state === 'ko') continue;
      if (victim.invulnFrames > 0) continue;
      if (attacker.moveHits.includes(victim.id)) continue; // once per activation

      const ch = CHARACTERS[victim.characterId];
      if (!aabbOverlap(hb, {
        x: victim.x - ch.hurtbox.w / 2,
        y: victim.y - ch.hurtbox.h / 2,
        w: ch.hurtbox.w,
        h: ch.hurtbox.h,
      })) continue;

      attacker.moveHits.push(victim.id);
      if (victim.state === 'shield') {
        applyShieldedHit(state, attacker, victim, move);
      } else {
        applyHit(state, attacker, victim, move);
      }
    }
  }
}

// A blocked hit deals no damage/knockback; it drains shield by the hit's
// damage instead, and an emptied shield means break stun (§9).
function applyShieldedHit(state, attacker, victim, move) {
  victim.shieldHealth -= move.damage;
  state.events.push({
    type: 'shieldHit',
    attackerId: attacker.id,
    victimId: victim.id,
    x: victim.x,
    y: victim.y,
  });
  if (victim.shieldHealth <= 0) {
    breakShield(victim);
    state.events.push({ type: 'shieldBreak', id: victim.id });
  }
}

function applyHit(state, attacker, victim, move) {
  const weight = CHARACTERS[victim.characterId].weight;

  // Damage lands before knockback is computed, so the hit itself contributes
  // to its own launch strength (§9 core Smash feel).
  victim.percent += move.damage;
  const knockback = (move.baseKnockback + victim.percent * move.knockbackScaling) / weight;

  const rad = (move.angle * Math.PI) / 180;
  victim.vx = Math.cos(rad) * knockback * attacker.facing;
  victim.vy = -Math.sin(rad) * knockback; // negative = up
  victim.onGround = false;

  victim.state = 'hitstun';
  victim.stateTimer = Math.max(1, Math.round(knockback * HITSTUN_PER_KNOCKBACK));
  victim.currentMove = null;
  victim.moveHits = [];

  state.events.push({
    type: 'hit',
    attackerId: attacker.id,
    victimId: victim.id,
    damage: move.damage,
    knockback,
    x: victim.x,
    y: victim.y,
  });
}

// --- KO / stocks ---------------------------------------------------------------

function checkBlastZones(state) {
  for (const fighter of Object.values(state.fighters)) {
    if (fighter.stocks <= 0) continue;
    const out = fighter.x < BLAST.left || fighter.x > BLAST.right
      || fighter.y < BLAST.top || fighter.y > BLAST.bottom;
    if (!out) continue;

    fighter.stocks -= 1;
    state.events.push({ type: 'ko', id: fighter.id, x: fighter.x, y: fighter.y });

    if (fighter.stocks > 0) {
      respawn(fighter);
    } else {
      eliminate(fighter);
    }
  }
}

function respawn(fighter) {
  const character = CHARACTERS[fighter.characterId];
  fighter.x = RESPAWN_POINT.x;
  fighter.y = RESPAWN_POINT.y - character.hurtbox.h / 2;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.percent = 0;
  fighter.onGround = false;
  fighter.jumpsRemaining = character.airJumps;
  fighter.state = 'respawning';
  fighter.stateTimer = 0;
  fighter.currentMove = null;
  fighter.moveHits = [];
  fighter.invulnFrames = RESPAWN_IFRAMES;
  fighter.shieldHealth = SHIELD_MAX;
  fighter.airDodgeUsed = false;
}

function eliminate(fighter) {
  fighter.state = 'ko';
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.currentMove = null;
}

function checkMatchEnd(state) {
  const all = Object.values(state.fighters);
  if (state.phase !== 'playing' || all.length < 2) return;
  const alive = all.filter((f) => f.stocks > 0);
  if (alive.length <= 1) {
    state.phase = 'ended';
    state.winnerId = alive[0]?.id ?? null;
    state.events.push({ type: 'matchEnd', winnerId: state.winnerId });
  }
}

// --- Movement ---------------------------------------------------------------

function pressed(input, prev, key) {
  return input[key] && !prev[key];
}

function applyMovementInput(fighter, character, input) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (fighter.onGround) {
    if (dir !== 0) {
      fighter.vx += dir * GROUND_ACCEL;
      fighter.vx = clamp(fighter.vx, -character.moveSpeed, character.moveSpeed);
      fighter.facing = dir;
    } else {
      fighter.vx *= GROUND_FRICTION;
      if (Math.abs(fighter.vx) < 0.05) fighter.vx = 0;
    }
  } else {
    applyAirDrift(fighter, character, input);
  }

  if (pressed(input, fighter.prevInput, 'jump')) {
    tryJump(fighter, character);
  }

  // Drop through pass-through platforms by pressing down while standing on one.
  if (fighter.onGround && input.down && isOnPassThroughPlatform(fighter, character)) {
    fighter.dropThroughTimer = DROP_THROUGH_FRAMES;
    fighter.onGround = false;
  }
}

function applyAirDrift(fighter, character, input) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    fighter.vx += dir * AIR_ACCEL;
    fighter.vx = clamp(fighter.vx, -character.moveSpeed, character.moveSpeed);
  } else {
    fighter.vx *= AIR_DRAG;
  }
}

function tryJump(fighter, character) {
  if (fighter.onGround) {
    fighter.vy = character.jumpVelocity;
    fighter.onGround = false;
  } else if (fighter.jumpsRemaining > 0) {
    fighter.vy = character.jumpVelocity;
    fighter.jumpsRemaining -= 1;
  }
}

function applyGravity(fighter) {
  if (!fighter.onGround) {
    fighter.vy = Math.min(fighter.vy + GRAVITY, TERMINAL_VY);
  }
}

function integratePosition(fighter) {
  fighter.x += fighter.vx;
  fighter.y += fighter.vy;
}

// --- Stage collision ----------------------------------------------------------

function fighterBottom(fighter, character) {
  return fighter.y + character.hurtbox.h / 2;
}

function isOnPassThroughPlatform(fighter, character) {
  const bottom = fighterBottom(fighter, character);
  return PLATFORMS.some((p) =>
    Math.abs(bottom - p.y) < 1 &&
    fighter.x > p.x && fighter.x < p.x + p.w
  );
}

function resolveStageCollision(fighter, character, input) {
  const halfW = character.hurtbox.w / 2;
  const halfH = character.hurtbox.h / 2;
  const wasFalling = fighter.vy >= 0;
  const prevBottom = fighter.y - fighter.vy + halfH;

  // Solid floor: land on top; block sides/underside.
  const f = FLOOR;
  const overlapsFloorX = fighter.x + halfW > f.x && fighter.x - halfW < f.x + f.w;
  const overlapsFloorY = fighter.y + halfH > f.y && fighter.y - halfH < f.y + f.h;
  if (overlapsFloorX && overlapsFloorY) {
    if (wasFalling && prevBottom <= f.y + 0.001) {
      landOn(fighter, character, f.y);
    } else if (fighter.y - fighter.vy - halfH >= f.y + f.h && fighter.vy < 0) {
      fighter.y = f.y + f.h + halfH; // bonked the underside
      fighter.vy = 0;
    } else {
      // side push-out toward the nearer edge
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
        landOn(fighter, character, p.y);
        break;
      }
    }
  }
}

function landOn(fighter, character, surfaceY) {
  fighter.y = surfaceY - character.hurtbox.h / 2;
  fighter.vy = 0;
  fighter.onGround = true;
  fighter.jumpsRemaining = character.airJumps;
  fighter.airDodgeUsed = false;
  // Landing cancels hitstun — you've "teched" the launch by reaching ground.
  if (fighter.state === 'hitstun' && fighter.stateTimer > 0) {
    fighter.stateTimer = Math.min(fighter.stateTimer, 6);
  }
}

function updateGroundedState(fighter, character) {
  // Walking off an edge: no surface under our feet anymore → airborne.
  if (fighter.onGround && !isSupported(fighter, character)) {
    fighter.onGround = false;
  }
  if (NEUTRAL_STATES.has(fighter.state)) {
    fighter.state = !fighter.onGround ? 'air' : (Math.abs(fighter.vx) > 0.1 ? 'run' : 'idle');
  }
}

function isSupported(fighter, character) {
  const bottom = fighterBottom(fighter, character);
  const halfW = character.hurtbox.w / 2;
  const onFloor =
    Math.abs(bottom - FLOOR.y) < 1 &&
    fighter.x + halfW > FLOOR.x && fighter.x - halfW < FLOOR.x + FLOOR.w;
  return onFloor || isOnPassThroughPlatform(fighter, character);
}

// --- Helpers -------------------------------------------------------------------

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
