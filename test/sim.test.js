// Unit-drives the shared Stick Fight sim (no framework — plain node:assert).
// Run with: npm test
import assert from 'node:assert/strict';
import { createInitialState, stepGame, EMPTY_INPUT } from '../shared/simulation.js';
import { WEAPONS } from '../shared/weapons.js';
import {
  DT, MAX_HP, MOVE_SPEED, AIR_JUMPS, FIGHTER_HURTBOX,
  COUNTDOWN_FRAMES, ROUND_END_LINGER, ROUND_WINS_TARGET,
  WEAPON_SPAWN_INTERVAL, PUNCH_DAMAGE,
} from '../shared/constants.js';
import { LEVELS } from '../shared/levels.js';

// Geometry-dependent tests run on the Classic layout (level 0).
const FLOOR = LEVELS[0].solids[0];
const PLATFORMS = LEVELS[0].platforms;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function input(overrides = {}) {
  return { ...EMPTY_INPUT, ...overrides };
}

// Steps the state N frames; inputsFor(frame, state) returns {playerId: input}.
function run(state, frames, inputsFor = () => ({})) {
  for (let i = 0; i < frames; i++) {
    state = stepGame(state, inputsFor(i, state), DT);
  }
  return state;
}

function bottom(fighter) {
  return fighter.y + FIGHTER_HURTBOX.h / 2;
}

function skipCountdown(s) {
  s.phase = 'playing';
  s.countdownTimer = 0;
  return s;
}

function newState(seed = 1, levelIndex = 0) {
  return skipCountdown(createInitialState([
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' },
  ], seed, levelIndex));
}

// Two fighters settled on the floor, facing each other, no weapon drops yet.
function duelState() {
  let s = newState();
  s.nextSpawnTimer = 100000; // keep random guns out of targeted tests
  s.fighters.p1.x = 500;
  s.fighters.p2.x = 600;
  return run(s, 10);
}

function arm(fighter, weaponId) {
  fighter.weaponId = weaponId;
  fighter.fireCooldown = 0;
}

// --- Movement & platforms ----------------------------------------------------

test('fighters settle on the floor with full HP', () => {
  const s = run(newState(), 30);
  for (const f of Object.values(s.fighters)) {
    assert.ok(Math.abs(bottom(f) - FLOOR.y) < 1, `bottom ${bottom(f)} != floor ${FLOOR.y}`);
    assert.equal(f.onGround, true);
    assert.equal(f.hp, MAX_HP);
    assert.equal(f.alive, true);
  }
});

test('holding right moves right, capped at MOVE_SPEED', () => {
  let s = run(newState(), 10);
  const x0 = s.fighters.p1.x;
  s = run(s, 30, () => ({ p1: input({ right: true }) }));
  assert.ok(s.fighters.p1.x > x0 + 50, `moved ${s.fighters.p1.x - x0}px`);
  assert.ok(Math.abs(s.fighters.p1.vx) <= MOVE_SPEED + 0.001);
});

test('jump is edge-triggered and air jumps are limited', () => {
  let s = run(newState(), 10);
  s = run(s, 120, () => ({ p1: input({ jump: true }) })); // held forever
  assert.equal(s.fighters.p1.onGround, true, 'not bouncing forever');

  s = run(s, 2); // release so the next press is a fresh edge
  s = run(s, 1, () => ({ p1: input({ jump: true }) }));
  assert.equal(s.fighters.p1.onGround, false);
  s = run(s, 1);
  assert.equal(s.fighters.p1.jumpsRemaining, AIR_JUMPS);
  s = run(s, 1, () => ({ p1: input({ jump: true }) }));
  assert.equal(s.fighters.p1.jumpsRemaining, AIR_JUMPS - 1);
});

test('lands on a platform and can drop through it', () => {
  const plat = PLATFORMS[0];
  let s = newState();
  s.fighters.p1.x = plat.x + plat.w / 2;
  s.fighters.p1.y = plat.y - FIGHTER_HURTBOX.h / 2 - 40;
  s = run(s, 30);
  assert.ok(Math.abs(bottom(s.fighters.p1) - plat.y) < 1, 'landed on platform');
  s = run(s, 3, () => ({ p1: input({ down: true }) }));
  assert.equal(s.fighters.p1.onGround, false, 'dropped through');
  s = run(s, 90);
  assert.ok(Math.abs(bottom(s.fighters.p1) - FLOOR.y) < 1, 'landed on floor below');
});

test('stepGame does not mutate its input state', () => {
  const s0 = run(newState(), 5);
  const snapshot = JSON.stringify(s0);
  stepGame(s0, { p1: input({ right: true, shoot: true, aimX: 1 }) }, DT);
  assert.equal(JSON.stringify(s0), snapshot);
});

test('same seed and inputs replay identically (deterministic RNG)', () => {
  const a = run(newState(7), 600, () => ({ p1: input({ right: true }) }));
  const b = run(newState(7), 600, () => ({ p1: input({ right: true }) }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// --- Punch ---------------------------------------------------------------------

test('punch damages an adjacent enemy and knocks them back', () => {
  let s = duelState();
  s.fighters.p2.x = s.fighters.p1.x + 40; // in punch range
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.equal(s.fighters.p2.hp, MAX_HP - PUNCH_DAMAGE);
  assert.ok(s.fighters.p2.vx > 0, 'knocked away');
});

test('point-blank punch connects (overlapping opponents)', () => {
  let s = duelState();
  s.fighters.p2.x = s.fighters.p1.x + 3; // practically on top of each other
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.equal(s.fighters.p2.hp, MAX_HP - PUNCH_DAMAGE);
});

test('punch does not auto-repeat while shoot is held', () => {
  let s = duelState();
  s.fighters.p2.x = s.fighters.p1.x + 40;
  s = run(s, 60, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.equal(s.fighters.p2.hp, MAX_HP - PUNCH_DAMAGE, 'only one punch landed');
});

// --- Guns & projectiles -----------------------------------------------------------

test('pistol shot spawns one projectile and hits a distant target', () => {
  let s = duelState();
  arm(s.fighters.p1, 'pistol');
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.equal(s.projectiles.length, 1);
  s = run(s, 20);
  assert.equal(s.fighters.p2.hp, MAX_HP - WEAPONS.pistol.damage);
  assert.equal(s.projectiles.length, 0, 'bullet consumed on hit');
});

test('semi-auto: holding shoot fires only once per press', () => {
  let s = duelState();
  s.fighters.p2.x = 1100; // out of the line of fire? no — same height; move p2 up instead
  s.fighters.p2.y -= 200;
  arm(s.fighters.p1, 'pistol');
  let totalShots = 0;
  s = run(s, 60, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  // Count via events is per-tick; instead: no target, so count projectiles ever
  // spawned — with 60 held frames a semi-auto must have produced exactly 1.
  totalShots = s.projectiles.length; // bullets still in flight (life 90) or gone off world
  assert.ok(totalShots <= 1, `fired ${totalShots} bullets while held`);
});

test('uzi auto-fires while held', () => {
  let s = duelState();
  s.fighters.p2.y -= 300; // out of the way
  arm(s.fighters.p1, 'uzi');
  let shots = 0;
  s = run(s, 30, (i, st) => {
    shots += st.events.filter((e) => e.type === 'shot').length;
    return { p1: input({ shoot: true, aimX: 1 }) };
  });
  shots += s.events.filter((e) => e.type === 'shot').length;
  assert.ok(shots >= 4, `uzi fired ${shots} times over 30 frames`);
});

test('shotgun fires five pellets with recoil', () => {
  let s = duelState();
  s.fighters.p2.y -= 300;
  arm(s.fighters.p1, 'shotgun');
  const vx0 = s.fighters.p1.vx;
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.equal(s.projectiles.length, WEAPONS.shotgun.projectileCount);
  assert.ok(s.fighters.p1.vx < vx0 - 2, 'recoil pushed shooter backward');
});

test('bazooka rocket explodes and deals area damage', () => {
  let s = duelState();
  arm(s.fighters.p1, 'bazooka');
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.equal(s.projectiles.length, 1);
  let exploded = false;
  for (let i = 0; i < 60 && !exploded; i++) {
    s = stepGame(s, {}, DT);
    exploded = s.events.some((e) => e.type === 'explosion');
  }
  assert.ok(exploded, 'rocket exploded');
  assert.ok(s.fighters.p2.hp < MAX_HP - 20, `p2 took heavy damage (hp ${s.fighters.p2.hp})`);
});

test('bazooka explosion can hurt the shooter at point blank', () => {
  let s = duelState();
  s.fighters.p2.x = s.fighters.p1.x + 45; // rocket detonates immediately next to p1
  arm(s.fighters.p1, 'bazooka');
  s = run(s, 8, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  assert.ok(s.fighters.p1.hp < MAX_HP, `self-damage applied (hp ${s.fighters.p1.hp})`);
});

test('bullets stop at the stage (platforms give cover)', () => {
  let s = duelState();
  // Shooter below the platform aiming up through it.
  const plat = PLATFORMS[0];
  s.fighters.p1.x = plat.x + plat.w / 2;
  s.fighters.p2.x = plat.x + plat.w / 2;
  s.fighters.p2.y = plat.y - FIGHTER_HURTBOX.h / 2 - 100; // above the platform
  arm(s.fighters.p1, 'pistol');
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 0, aimY: -1 }) }));
  s = run(s, 30);
  assert.equal(s.fighters.p2.hp, MAX_HP, 'platform blocked the shot');
});

// --- Weapon drops -----------------------------------------------------------------

test('guns spawn from the sky, land, and can be picked up', () => {
  let s = newState(42);
  s = run(s, WEAPON_SPAWN_INTERVAL, () => ({}));
  assert.ok(s.drops.length >= 1, 'a gun dropped');
  s = run(s, 400);
  const drop = s.drops[0];
  assert.ok(drop.landed, 'drop landed on a surface');
  // Stand p1 on the drop's surface (drop.y sits 8px above it), feet planted.
  s.fighters.p1.x = drop.x;
  s.fighters.p1.y = drop.y + 8 - FIGHTER_HURTBOX.h / 2;
  s = run(s, 2);
  assert.equal(s.fighters.p1.weaponId, drop.weaponId, 'picked up on touch');
  assert.ok(!s.drops.some((d) => d.id === drop.id), 'drop removed from map');
});

test('touching a new gun swaps the held one', () => {
  let s = duelState();
  arm(s.fighters.p1, 'pistol');
  s.drops.push({ id: 999, weaponId: 'shotgun', x: s.fighters.p1.x, y: s.fighters.p1.y, landed: true });
  s = run(s, 2);
  assert.equal(s.fighters.p1.weaponId, 'shotgun');
});

// --- Rounds & match ------------------------------------------------------------------

test('countdown runs, ignores inputs, then plays', () => {
  let s = createInitialState([{ id: 'p1' }, { id: 'p2' }]);
  assert.equal(s.phase, 'countdown');
  const x0 = s.fighters.p1.x;
  s = run(s, 30, () => ({ p1: input({ right: true }) }));
  assert.equal(s.fighters.p1.x, x0, 'frozen during countdown');
  s = run(s, COUNTDOWN_FRAMES);
  assert.equal(s.phase, 'playing');
});

test('a kill ends the round and scores it; next round resets everyone', () => {
  let s = duelState();
  s.fighters.p2.hp = 5;
  arm(s.fighters.p1, 'pistol');
  s = run(s, 1, () => ({ p1: input({ shoot: true, aimX: 1 }) }));
  s = run(s, 20);
  assert.equal(s.fighters.p2.alive, false);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundWinnerId, 'p1');
  assert.equal(s.fighters.p1.roundWins, 1);

  s = run(s, ROUND_END_LINGER + 2);
  assert.equal(s.phase, 'countdown');
  assert.equal(s.roundNumber, 2);
  assert.equal(s.fighters.p2.alive, true);
  assert.equal(s.fighters.p2.hp, MAX_HP);
  assert.equal(s.fighters.p1.weaponId, null, 'weapons cleared between rounds');
  assert.equal(s.projectiles.length, 0);
});

test('falling past the blast zone is a round loss', () => {
  let s = duelState();
  s.fighters.p2.x = 2000; // past BLAST.right
  s = stepGame(s, {}, DT);
  assert.equal(s.fighters.p2.alive, false);
  assert.equal(s.roundWinnerId, 'p1');
});

test('simultaneous deaths draw the round: nobody scores', () => {
  let s = duelState();
  s.fighters.p1.x = 2000;
  s.fighters.p2.x = -2000;
  s = stepGame(s, {}, DT);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundWinnerId, null);
  assert.equal(s.fighters.p1.roundWins, 0);
  assert.equal(s.fighters.p2.roundWins, 0);
});

test('reaching the round-win target ends the match', () => {
  let s = duelState();
  s.fighters.p1.roundWins = ROUND_WINS_TARGET - 1;
  s.fighters.p2.x = 2000; // p1 wins this round
  s = stepGame(s, {}, DT);
  assert.equal(s.phase, 'roundEnd');
  s = run(s, ROUND_END_LINGER + 2);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winnerId, 'p1');
});

// --- Levels ---------------------------------------------------------------------

test('every level: fighters spawn standing on ground and settle safely', () => {
  LEVELS.forEach((level, k) => {
    let s = newState(1, k);
    s = run(s, 90);
    for (const f of Object.values(s.fighters)) {
      assert.equal(f.alive, true, `${level.id}: fighter fell to death from spawn`);
      assert.equal(f.onGround, true, `${level.id}: fighter not standing after settle`);
    }
  });
});

test('every level: sky drops land on a surface', () => {
  LEVELS.forEach((level, k) => {
    let s = newState(3, k);
    let landed = false;
    for (let i = 0; i < 2500 && !landed; i++) {
      s = stepGame(s, {}, DT);
      landed = s.drops.some((d) => d.landed);
    }
    assert.ok(landed, `${level.id}: no drop ever landed`);
    const drop = s.drops.find((d) => d.landed);
    const surfaces = [...level.solids, ...level.platforms];
    assert.ok(surfaces.some((r) => drop.x > r.x && drop.x < r.x + r.w && Math.abs(drop.y - (r.y - 8)) < 1),
      `${level.id}: landed drop not resting on a surface`);
  });
});

test('the map rotates to a different level each round', () => {
  let s = newState(9, 0);
  const first = s.levelIndex;
  s.fighters.p2.x = 9999; // p1 wins the round via blast zone
  s = stepGame(s, {}, DT);
  assert.equal(s.phase, 'roundEnd');
  s = run(s, ROUND_END_LINGER + 2);
  assert.equal(s.phase, 'countdown');
  assert.notEqual(s.levelIndex, first, 'level changed between rounds');
  assert.ok(s.levelIndex >= 0 && s.levelIndex < LEVELS.length, 'valid level index');
  // Fighters must be standing on the new level's spawn points.
  s = run(s, COUNTDOWN_FRAMES + 30);
  for (const f of Object.values(s.fighters)) {
    assert.equal(f.alive, true);
    assert.equal(f.onGround, true);
  }
});

test('level choice and rotation are deterministic per seed', () => {
  const play = () => {
    let s = createInitialState([{ id: 'p1' }, { id: 'p2' }], 1234);
    skipCountdown(s);
    const sequence = [s.levelIndex];
    for (let round = 0; round < 3; round++) {
      s.fighters.p2.x = 9999;
      s.fighters.p2.hp = MAX_HP;
      s = stepGame(s, {}, DT);
      s = run(s, ROUND_END_LINGER + 2);
      skipCountdown(s);
      sequence.push(s.levelIndex);
    }
    return sequence.join(',');
  };
  assert.equal(play(), play());
});

// --- Runner -----------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} tests failed` : `\nall ${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
