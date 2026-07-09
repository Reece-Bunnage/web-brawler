// Unit-drives the shared simulation (no framework — plain node:assert).
// Run with: npm test
import assert from 'node:assert/strict';
import { createInitialState, stepGame, EMPTY_INPUT } from '../shared/simulation.js';
import { CHARACTERS } from '../shared/characters.js';
import { FLOOR, PLATFORMS, DT } from '../shared/constants.js';

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
  return fighter.y + CHARACTERS[fighter.characterId].hurtbox.h / 2;
}

function newState(charA = 'ranger', charB = 'titan') {
  return createInitialState([
    { id: 'p1', characterId: charA },
    { id: 'p2', characterId: charB },
  ]);
}

// --- Movement & platforms (Phase 2) ---------------------------------------

test('fighters settle on the floor', () => {
  const s = run(newState(), 30);
  for (const f of Object.values(s.fighters)) {
    assert.ok(Math.abs(bottom(f) - FLOOR.y) < 1, `bottom ${bottom(f)} != floor ${FLOOR.y}`);
    assert.equal(f.onGround, true);
    assert.equal(f.state, 'idle');
  }
});

test('holding right moves right and sets facing/run state', () => {
  let s = run(newState(), 10); // settle
  const x0 = s.fighters.p1.x;
  s = run(s, 30, () => ({ p1: input({ right: true }) }));
  assert.ok(s.fighters.p1.x > x0 + 50, `moved ${s.fighters.p1.x - x0}px`);
  assert.equal(s.fighters.p1.facing, 1);
  assert.equal(s.fighters.p1.state, 'run');
});

test('ground speed is clamped to character moveSpeed', () => {
  let s = run(newState('sprite', 'titan'), 10);
  s = run(s, 60, () => ({ p1: input({ right: true }), p2: input({ right: true }) }));
  assert.ok(Math.abs(s.fighters.p1.vx) <= CHARACTERS.sprite.moveSpeed + 0.001);
  assert.ok(Math.abs(s.fighters.p2.vx) <= CHARACTERS.titan.moveSpeed + 0.001);
  assert.ok(Math.abs(s.fighters.p1.vx) > Math.abs(s.fighters.p2.vx));
});

test('jump is edge-triggered: holding jump does not bounce forever', () => {
  let s = run(newState(), 10);
  s = run(s, 120, () => ({ p1: input({ jump: true }) })); // held the whole time
  // One ground jump + one air jump max; after both resolve, fighter is grounded
  // again and stays there because jump was never released.
  assert.equal(s.fighters.p1.onGround, true);
});

test('jump rises and lands back on the floor', () => {
  let s = run(newState(), 10);
  s = run(s, 1, () => ({ p1: input({ jump: true }) }));
  assert.equal(s.fighters.p1.onGround, false);
  assert.ok(s.fighters.p1.vy < 0);
  s = run(s, 90);
  assert.equal(s.fighters.p1.onGround, true);
  assert.ok(Math.abs(bottom(s.fighters.p1) - FLOOR.y) < 1);
});

test('air jumps: ranger gets 1, sprite gets 2, then no more', () => {
  for (const [charId, airJumps] of [['ranger', 1], ['sprite', 2]]) {
    let s = createInitialState([{ id: 'p1', characterId: charId }]);
    s = run(s, 10);
    // Ground jump.
    s = run(s, 1, () => ({ p1: input({ jump: true }) }));
    s = run(s, 1); // release
    for (let j = 0; j < airJumps; j++) {
      assert.equal(s.fighters.p1.jumpsRemaining, airJumps - j);
      s = run(s, 1, () => ({ p1: input({ jump: true }) }));
      assert.ok(s.fighters.p1.vy < 0, `${charId} air jump ${j + 1} applied`);
      s = run(s, 1); // release
    }
    assert.equal(s.fighters.p1.jumpsRemaining, 0);
    const vyBefore = s.fighters.p1.vy;
    s = run(s, 1, () => ({ p1: input({ jump: true }) }));
    assert.ok(s.fighters.p1.vy >= vyBefore, `${charId} jump denied when out of air jumps`);
  }
});

test('double jump reaches a platform and lands on top of it', () => {
  const plat = PLATFORMS[0];
  let s = createInitialState([{ id: 'p1', characterId: 'ranger' }]);
  s.fighters.p1.x = plat.x + plat.w / 2; // directly under the platform
  s = run(s, 10);
  s = run(s, 1, () => ({ p1: input({ jump: true }) }));
  s = run(s, 200, (i, st) => {
    // Air jump once we start falling.
    const f = st.fighters.p1;
    return !f.onGround && f.vy > 0 && f.jumpsRemaining > 0 && i % 2 === 0
      ? { p1: input({ jump: true }) } : {};
  });
  assert.equal(s.fighters.p1.onGround, true);
  assert.ok(Math.abs(bottom(s.fighters.p1) - plat.y) < 1,
    `landed at ${bottom(s.fighters.p1)}, platform top ${plat.y}`);
});

test('holding down drops through a platform onto the floor', () => {
  const plat = PLATFORMS[0];
  let s = createInitialState([{ id: 'p1', characterId: 'ranger' }]);
  const f = s.fighters.p1;
  f.x = plat.x + plat.w / 2;
  f.y = plat.y - CHARACTERS.ranger.hurtbox.h / 2 - 5;
  s = run(s, 10); // land on platform
  assert.ok(Math.abs(bottom(s.fighters.p1) - plat.y) < 1, 'starts on platform');
  s = run(s, 3, () => ({ p1: input({ down: true }) }));
  assert.equal(s.fighters.p1.onGround, false, 'dropped off platform');
  s = run(s, 90);
  assert.ok(Math.abs(bottom(s.fighters.p1) - FLOOR.y) < 1, 'landed on floor below');
});

test('walking off the floor edge becomes airborne', () => {
  let s = run(newState(), 10);
  s = run(s, 300, () => ({ p1: input({ left: true }) }));
  assert.equal(s.fighters.p1.onGround, false);
  assert.ok(s.fighters.p1.x < FLOOR.x, 'walked past the ledge');
});

test('stepGame does not mutate its input state', () => {
  const s0 = run(newState(), 5);
  const snapshot = JSON.stringify(s0);
  stepGame(s0, { p1: input({ right: true, jump: true }) }, DT);
  assert.equal(JSON.stringify(s0), snapshot);
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
