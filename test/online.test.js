// Online integration test: spawns the real server, connects two WebSocket
// clients, runs the lobby handshake, starts a match, and checks that inputs
// move a fighter in the snapshot stream. Run with: node test/online.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MSG, join, selectCharacter, ready, startMatch, inputMsg } from '../shared/protocol.js';
import { COUNTDOWN_FRAMES, TICK_RATE } from '../shared/constants.js';

const PORT = 3123;

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const client = { ws, name, id: null, lobby: null, snapshots: [], matchStarted: false, matchEnd: null };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === MSG.WELCOME) { client.id = msg.yourId; resolve(client); }
      if (msg.type === MSG.LOBBY_STATE) client.lobby = msg;
      if (msg.type === MSG.MATCH_START) client.matchStarted = true;
      if (msg.type === MSG.SNAPSHOT) client.snapshots.push(msg);
      if (msg.type === MSG.MATCH_END) client.matchEnd = msg;
    });
    ws.on('open', () => ws.send(JSON.stringify(join(name))));
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (client, msg) => client.ws.send(JSON.stringify(msg));

const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

try {
  await sleep(700);

  // Lobby handshake.
  const alice = await connectClient('Alice');
  const bob = await connectClient('Bob');
  assert.ok(alice.id && bob.id, 'both welcomed');

  send(alice, selectCharacter('ranger'));
  send(bob, selectCharacter('titan'));
  send(alice, ready(true));
  send(bob, ready(true));
  await sleep(200);

  assert.equal(alice.lobby.players.length, 2);
  assert.ok(alice.lobby.players.every((p) => p.ready), 'both ready in lobby');
  assert.equal(alice.lobby.hostId, alice.id, 'first joiner hosts');

  // Non-host cannot start.
  send(bob, startMatch());
  await sleep(200);
  assert.equal(bob.matchStarted, false, 'non-host start refused');

  send(alice, startMatch());
  await sleep(300);
  assert.ok(alice.matchStarted && bob.matchStarted, 'MATCH_START received by all');

  // Wait out the countdown, then hold right as Alice.
  await sleep((COUNTDOWN_FRAMES / TICK_RATE) * 1000 + 300);
  assert.ok(alice.snapshots.length > 5, `snapshots flowing (${alice.snapshots.length})`);

  const before = alice.snapshots.at(-1).fighters.find((f) => f.id === alice.id);
  let seq = 0;
  const hold = setInterval(() => {
    send(alice, inputMsg(seq++, { right: true }));
  }, 33);
  await sleep(800);
  clearInterval(hold);
  send(alice, inputMsg(seq++, {}));

  const after = alice.snapshots.at(-1).fighters.find((f) => f.id === alice.id);
  assert.ok(after.x > before.x + 50, `moved right via inputs (${before.x} → ${after.x})`);

  // Stale input (old seq) must be ignored: send left with seq 0.
  await sleep(400); // let friction settle first
  const xNow = alice.snapshots.at(-1).fighters.find((f) => f.id === alice.id).x;
  send(alice, inputMsg(0, { left: true }));
  await sleep(400);
  const later = alice.snapshots.at(-1).fighters.find((f) => f.id === alice.id);
  assert.ok(Math.abs(later.x - xNow) < 5, `stale input dropped (${xNow} → ${later.x})`);

  // Both clients see the same authoritative state.
  const aliceView = alice.snapshots.at(-1);
  const bobView = bob.snapshots.at(-1);
  assert.ok(Math.abs(aliceView.tick - bobView.tick) < 60, 'clients near-synchronized');

  // Disconnect Bob mid-match → Alice wins via forfeit.
  bob.ws.close();
  await sleep(2500);
  assert.ok(alice.matchEnd, 'MATCH_END delivered after opponent left');
  assert.equal(alice.matchEnd.winnerId, alice.id, 'remaining player wins');

  alice.ws.close();
  console.log('online integration: all assertions passed');
} finally {
  server.kill();
}
