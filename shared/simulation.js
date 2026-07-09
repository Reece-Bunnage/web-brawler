// Transport-agnostic simulation core (instructions §2.1).
// stepGame(state, inputs, dt) is pure: no environment imports, no module
// globals — everything the sim knows lives in the state object, so the same
// code runs on the server (online) and in the browser (local).

import {
  GRAVITY, TERMINAL_VY, GROUND_ACCEL, GROUND_FRICTION, AIR_ACCEL, AIR_DRAG,
  FLOOR, PLATFORMS, SPAWN_POINTS, STOCKS,
} from './constants.js';
import { CHARACTERS } from './characters.js';

export const EMPTY_INPUT = Object.freeze({
  left: false, right: false, up: false, down: false,
  jump: false, light: false, heavy: false, shield: false, dodge: false,
});

// Frames of ignoring pass-through platforms after pressing down on one.
const DROP_THROUGH_FRAMES = 10;

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
    invulnFrames: 0,
    shieldHealth: 100,
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

  for (const fighter of Object.values(next.fighters)) {
    const input = inputs[fighter.id] || EMPTY_INPUT;
    stepFighter(next, fighter, input);
    fighter.prevInput = { ...input };
  }

  return next;
}

function stepFighter(state, fighter, input) {
  const character = CHARACTERS[fighter.characterId];

  tickTimers(fighter);
  applyMovementInput(fighter, character, input);
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
    if (dir !== 0) {
      fighter.vx += dir * AIR_ACCEL;
      fighter.vx = clamp(fighter.vx, -character.moveSpeed, character.moveSpeed);
    } else {
      fighter.vx *= AIR_DRAG;
    }
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
}

function updateGroundedState(fighter, character) {
  // Walking off an edge: no surface under our feet anymore → airborne.
  if (fighter.onGround && !isSupported(fighter, character)) {
    fighter.onGround = false;
  }
  if (fighter.state === 'idle' || fighter.state === 'run' || fighter.state === 'air') {
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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
