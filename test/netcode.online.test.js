// Netcode integration test: spawns the real server and checks the low-latency
// plumbing — 60Hz snapshot cadence (one per tick), the ackSeq echo used by
// client-side prediction, and the movement-state fields prediction re-seeds
// from. Run with: node test/netcode.online.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MSG, join, ready, startMatch, inputMsg } from '../shared/protocol.js';
import { EMPTY_INPUT } from '../shared/simulation.js';

const PORT = 3181;

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const client = { ws, name, id: null, snapshots: [], matchStart: null };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === MSG.WELCOME) { client.id = msg.yourId; resolve(client); }
      if (msg.type === MSG.MATCH_START) client.matchStart = msg;
      if (msg.type === MSG.SNAPSHOT) client.snapshots.push(msg);
    });
    ws.on('open', () => ws.send(JSON.stringify(join(name))));
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (c, msg) => c.ws.send(JSON.stringify(msg));

const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), GAME_SEED: '7' },
  stdio: 'ignore',
});

try {
  await sleep(700);
  const alice = await connectClient('Alice');
  const bob = await connectClient('Bob');
  send(alice, ready(true));
  send(bob, ready(true));
  await sleep(150);
  send(alice, startMatch());
  await sleep(2400); // through the countdown

  // ackSeq: send a run of seq-stamped inputs, server echoes the last applied.
  for (let seq = 0; seq < 20; seq++) {
    send(alice, inputMsg(seq, { ...EMPTY_INPUT, right: true, aimX: 1 }));
    await sleep(10);
  }
  await sleep(300);
  let snap = alice.snapshots.at(-1);
  assert.equal(snap.ackSeq?.[alice.id], 19, `ackSeq echoes the last input seq (got ${snap.ackSeq?.[alice.id]})`);

  // Movement-state fields prediction needs are present on every fighter.
  for (const f of snap.fighters) {
    for (const k of ['jumpsRemaining', 'airDashesRemaining', 'dashFrames', 'dashDir',
      'dashCooldown', 'dropThroughTimer', 'wallDir', 'flinchFrames', 'fireCooldown']) {
      assert.ok(k in f, `fighter ${f.id} snapshot has ${k}`);
    }
  }

  // Cadence: one snapshot per sim tick (60Hz), no gaps in the tick sequence.
  alice.snapshots.length = 0;
  await sleep(1000);
  const ticks = alice.snapshots.map((s) => s.tick);
  assert.ok(ticks.length >= 50, `≥50 snapshots in 1s (got ${ticks.length})`);
  for (let i = 1; i < ticks.length; i++) {
    assert.equal(ticks[i] - ticks[i - 1], 1, `consecutive ticks (${ticks[i - 1]} → ${ticks[i]})`);
  }

  console.log('netcode integration: all assertions passed');
} finally {
  server.kill();
}
