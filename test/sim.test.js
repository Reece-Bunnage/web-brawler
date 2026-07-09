// Unit-drives the shared simulation (no framework — plain node:assert).
// Run with: npm test
import assert from 'node:assert/strict';
import { createInitialState, stepGame, EMPTY_INPUT } from '../shared/simulation.js';
import { CHARACTERS } from '../shared/characters.js';
import { FLOOR, PLATFORMS, DT, COUNTDOWN_FRAMES, ENDED_LINGER_FRAMES } from '../shared/constants.js';

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

// Movement/combat tests exercise the 'playing' phase directly.
function skipCountdown(s) {
  s.phase = 'playing';
  s.countdownTimer = 0;
  return s;
}

function newState(charA = 'ranger', charB = 'titan') {
  return skipCountdown(createInitialState([
    { id: 'p1', characterId: charA },
    { id: 'p2', characterId: charB },
  ]));
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
    let s = skipCountdown(createInitialState([{ id: 'p1', characterId: charId }]));
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
  let s = skipCountdown(createInitialState([{ id: 'p1', characterId: 'ranger' }]));
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
  let s = skipCountdown(createInitialState([{ id: 'p1', characterId: 'ranger' }]));
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
  // Walk left until the whole hurtbox is past the ledge (edge support lasts
  // while any part of the feet is still over the floor).
  const halfW = CHARACTERS.ranger.hurtbox.w / 2;
  for (let i = 0; i < 120 && s.fighters.p1.x + halfW >= FLOOR.x; i++) {
    s = stepGame(s, { p1: input({ left: true }) }, DT);
  }
  assert.ok(s.fighters.p1.x + halfW < FLOOR.x, 'walked past the ledge');
  assert.equal(s.fighters.p1.onGround, false);
});

test('stepGame does not mutate its input state', () => {
  const s0 = run(newState(), 5);
  const snapshot = JSON.stringify(s0);
  stepGame(s0, { p1: input({ right: true, jump: true }) }, DT);
  assert.equal(JSON.stringify(s0), snapshot);
});

// --- Combat (Phase 6) --------------------------------------------------------

// Two fighters settled on the floor within attack range of each other.
function combatState(charA = 'ranger', charB = 'titan') {
  let s = newState(charA, charB);
  s.fighters.p1.x = 500;
  s.fighters.p2.x = 570;
  s.fighters.p1.facing = 1;
  return run(s, 10);
}

test('light side attack damages the victim and causes hitstun', () => {
  let s = combatState();
  s = run(s, 1, () => ({ p1: input({ light: true, right: true }) }));
  assert.equal(s.fighters.p1.state, 'attack');
  assert.equal(s.fighters.p1.currentMove, 'lightSide');
  s = run(s, 10, () => ({ p1: input({ light: true, right: true }) }));
  assert.equal(s.fighters.p2.percent, CHARACTERS.ranger.moves.lightSide.damage);
  assert.ok(['hitstun', 'idle', 'run', 'air'].includes(s.fighters.p2.state));
});

test('a move hits each victim only once per activation', () => {
  let s = combatState();
  const move = CHARACTERS.ranger.moves.lightSide;
  const total = move.startup + move.active + move.recovery;
  s = run(s, 1, () => ({ p1: input({ light: true, right: true }) }));
  s = run(s, total + 5, () => ({ p1: input({ light: true, right: true }) })); // held: no re-trigger
  assert.equal(s.fighters.p2.percent, move.damage);
});

test('hit event is emitted with attacker and victim', () => {
  let s = combatState();
  s = run(s, 1, () => ({ p1: input({ light: true, right: true }) }));
  let hitEvent = null;
  for (let i = 0; i < 12 && !hitEvent; i++) {
    s = stepGame(s, {}, DT);
    hitEvent = s.events.find((e) => e.type === 'hit');
  }
  assert.ok(hitEvent, 'hit event emitted');
  assert.equal(hitEvent.attackerId, 'p1');
  assert.equal(hitEvent.victimId, 'p2');
});

test('knockback grows with victim percent', () => {
  const launchSpeed = (startPercent) => {
    let s = combatState();
    s.fighters.p2.percent = startPercent;
    s = run(s, 1, () => ({ p1: input({ heavy: true, right: true }) }));
    const move = CHARACTERS.ranger.moves.heavySide;
    for (let i = 0; i < move.startup + move.active + 2; i++) {
      s = stepGame(s, {}, DT);
      if (s.fighters.p2.state === 'hitstun') {
        return Math.hypot(s.fighters.p2.vx, s.fighters.p2.vy);
      }
    }
    throw new Error('never entered hitstun');
  };
  const low = launchSpeed(0);
  const high = launchSpeed(120);
  assert.ok(high > low * 2, `low ${low.toFixed(1)}, high ${high.toFixed(1)}`);
});

test('heavier characters take less knockback', () => {
  const launchSpeed = (victimChar) => {
    let s = combatState('ranger', victimChar);
    s.fighters.p2.percent = 80;
    s = run(s, 1, () => ({ p1: input({ heavy: true, right: true }) }));
    for (let i = 0; i < 25; i++) {
      s = stepGame(s, {}, DT);
      if (s.fighters.p2.state === 'hitstun') {
        return Math.hypot(s.fighters.p2.vx, s.fighters.p2.vy);
      }
    }
    throw new Error('never entered hitstun');
  };
  const titan = launchSpeed('titan');
  const sprite = launchSpeed('sprite');
  assert.ok(sprite > titan * 1.5, `titan ${titan.toFixed(1)}, sprite ${sprite.toFixed(1)}`);
});

test('victim has no control during hitstun', () => {
  let s = combatState();
  s = run(s, 1, () => ({ p1: input({ heavy: true, right: true }) }));
  for (let i = 0; i < 25 && s.fighters.p2.state !== 'hitstun'; i++) s = stepGame(s, {}, DT);
  assert.equal(s.fighters.p2.state, 'hitstun');
  const vx = s.fighters.p2.vx;
  s = run(s, 1, () => ({ p2: input({ left: true }) })); // try to fight the launch
  if (s.fighters.p2.state === 'hitstun') {
    assert.equal(s.fighters.p2.vx, vx, 'vx unchanged by input during hitstun');
  }
});

test('air-only restriction: grounded-only heavies cannot be used in the air', () => {
  let s = combatState();
  s = run(s, 1, () => ({ p1: input({ jump: true }) }));
  s = run(s, 3);
  assert.equal(s.fighters.p1.onGround, false);
  s = run(s, 1, () => ({ p1: input({ heavy: true }) })); // ranger heavyNeutral: canUseInAir false
  assert.notEqual(s.fighters.p1.state, 'attack');
});

test('crossing a blast zone costs a stock and respawns with i-frames at 0%', () => {
  let s = combatState();
  s.fighters.p2.percent = 87;
  s.fighters.p2.x = 1600; // past BLAST.right
  s.fighters.p2.onGround = false;
  s = stepGame(s, {}, DT);
  const p2 = s.fighters.p2;
  assert.equal(p2.stocks, 2);
  assert.equal(p2.percent, 0);
  assert.ok(p2.invulnFrames > 0, 'respawn i-frames granted');
  assert.ok(p2.x > 0 && p2.x < 1280, 'back on stage');
  assert.ok(s.events.some((e) => e.type === 'ko' && e.id === 'p2'));
});

test('a real launch at high percent flies past the blast zone', () => {
  let s = combatState('titan', 'ranger');
  s.fighters.p2.percent = 300;
  s = run(s, 1, () => ({ p1: input({ heavy: true, right: true }) }));
  let koSeen = false;
  for (let i = 0; i < 120 && !koSeen; i++) {
    s = stepGame(s, {}, DT);
    koSeen = s.events.some((e) => e.type === 'ko' && e.id === 'p2');
  }
  assert.ok(koSeen, 'victim was KOd by the launch');
});

test('last fighter standing ends the match', () => {
  let s = combatState();
  s.fighters.p2.stocks = 1;
  s.fighters.p2.x = 1600;
  s.fighters.p2.onGround = false;
  s = stepGame(s, {}, DT);
  assert.equal(s.fighters.p2.stocks, 0);
  assert.equal(s.fighters.p2.state, 'ko');
  assert.equal(s.phase, 'ended');
  assert.equal(s.winnerId, 'p1');
});

// --- Shield & dodge (Phase 7) ------------------------------------------------

test('shield blocks damage and knockback, draining by the hit damage', () => {
  let s = combatState();
  s = run(s, 2, () => ({ p2: input({ shield: true }) }));
  assert.equal(s.fighters.p2.state, 'shield');
  const shieldBefore = s.fighters.p2.shieldHealth;
  s = run(s, 1, () => ({ p1: input({ light: true, right: true }), p2: input({ shield: true }) }));
  s = run(s, 10, () => ({ p2: input({ shield: true }) }));
  assert.equal(s.fighters.p2.percent, 0, 'no damage through shield');
  assert.notEqual(s.fighters.p2.state, 'hitstun');
  const move = CHARACTERS.ranger.moves.lightSide;
  assert.ok(shieldBefore - s.fighters.p2.shieldHealth >= move.damage,
    `shield drained ${shieldBefore - s.fighters.p2.shieldHealth}`);
});

test('shield drains while held and regenerates when released', () => {
  let s = combatState();
  s = run(s, 60, () => ({ p2: input({ shield: true }) }));
  const drained = s.fighters.p2.shieldHealth;
  assert.ok(drained < 100, 'drained while held');
  s = run(s, 60);
  assert.ok(s.fighters.p2.shieldHealth > drained, 'regenerated after release');
});

test('an emptied shield causes a long break stun', () => {
  let s = combatState();
  s.fighters.p2.shieldHealth = 3;
  s = run(s, 2, () => ({ p2: input({ shield: true }) }));
  s = run(s, 1, () => ({ p1: input({ light: true, right: true }), p2: input({ shield: true }) }));
  s = run(s, 10, () => ({ p2: input({ shield: true }) }));
  assert.equal(s.fighters.p2.state, 'hitstun');
  assert.ok(s.fighters.p2.stateTimer > 60, `break stun ${s.fighters.p2.stateTimer} frames`);
});

test('spot dodge i-frames avoid a hit', () => {
  let s = combatState();
  // p1 starts a light attack; p2 dodges just before it becomes active.
  s = run(s, 1, () => ({ p1: input({ light: true, right: true }), p2: input({ dodge: true }) }));
  assert.equal(s.fighters.p2.state, 'dodge');
  assert.ok(s.fighters.p2.invulnFrames > 0);
  s = run(s, 12);
  assert.equal(s.fighters.p2.percent, 0, 'hit passed through during i-frames');
});

test('roll travels and dodge states expire back to neutral', () => {
  let s = combatState();
  const x0 = s.fighters.p2.x;
  s = run(s, 1, () => ({ p2: input({ dodge: true, left: true }) }));
  assert.equal(s.fighters.p2.state, 'dodge');
  s = run(s, 40);
  assert.ok(s.fighters.p2.x < x0 - 40, `rolled ${x0 - s.fighters.p2.x}px`);
  assert.ok(['idle', 'run'].includes(s.fighters.p2.state), 'back to neutral');
  assert.equal(s.fighters.p2.invulnFrames, 0, 'no lingering invulnerability');
});

test('air dodge only once per airtime, restored on landing', () => {
  let s = combatState();
  // Start high in the air so the whole dodge plays out before landing.
  s.fighters.p1.y = 150;
  s.fighters.p1.onGround = false;
  s.fighters.p1.state = 'air';
  s = run(s, 1, () => ({ p1: input({ dodge: true, up: true }) }));
  assert.equal(s.fighters.p1.state, 'dodge');
  assert.equal(s.fighters.p1.airDodgeUsed, true);
  // Wait out the dodge; still airborne, a second press must be refused.
  s = run(s, 30);
  assert.equal(s.fighters.p1.onGround, false, 'still airborne after dodge');
  assert.equal(s.fighters.p1.state, 'air');
  s = run(s, 1, () => ({ p1: input({ dodge: true }) }));
  assert.notEqual(s.fighters.p1.state, 'dodge', 'second air dodge refused');
  // Land, then air dodge must be available again.
  s = run(s, 200);
  assert.equal(s.fighters.p1.onGround, true);
  assert.equal(s.fighters.p1.airDodgeUsed, false);
});

// --- Match flow (Phase 8) ------------------------------------------------------

test('match starts in countdown, ignores inputs, then goes to playing', () => {
  let s = createInitialState([
    { id: 'p1', characterId: 'ranger' },
    { id: 'p2', characterId: 'titan' },
  ]);
  assert.equal(s.phase, 'countdown');
  const x0 = s.fighters.p1.x;
  s = run(s, 30, () => ({ p1: input({ right: true, jump: true }) }));
  assert.equal(s.phase, 'countdown');
  assert.equal(s.fighters.p1.x, x0, 'frozen during countdown');
  s = run(s, COUNTDOWN_FRAMES, () => ({ p1: input({ right: true }) }));
  assert.equal(s.phase, 'playing');
  s = run(s, 10, () => ({ p1: input({ right: true }) }));
  assert.ok(s.fighters.p1.x > x0, 'moving once playing');
});

test('buttons held through the countdown do not edge-trigger at match start', () => {
  let s = createInitialState([
    { id: 'p1', characterId: 'ranger' },
    { id: 'p2', characterId: 'titan' },
  ]);
  s = run(s, COUNTDOWN_FRAMES + 5, () => ({ p1: input({ light: true }) }));
  assert.equal(s.phase, 'playing');
  assert.notEqual(s.fighters.p1.state, 'attack', 'held light did not fire');
});

test('ended phase lingers, then freezes with a winner', () => {
  let s = combatState();
  s.fighters.p2.stocks = 1;
  s.fighters.p2.x = 1600;
  s.fighters.p2.onGround = false;
  s = stepGame(s, {}, DT);
  assert.equal(s.phase, 'ended');
  assert.ok(s.endTimer > 0, 'linger timer set');
  s = run(s, ENDED_LINGER_FRAMES + 5);
  assert.equal(s.endTimer, 0);
  assert.equal(s.winnerId, 'p1');
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
