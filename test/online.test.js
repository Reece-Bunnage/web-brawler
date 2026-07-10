// Online integration test: spawns the real server, connects two WebSocket
// clients, runs the lobby handshake, starts a match, and checks that inputs
// move a fighter, a punch lands, and a disconnect forfeits the match.
// Run with: node test/online.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MSG, join, ready, startMatch, inputMsg } from '../shared/protocol.js';
import { COUNTDOWN_FRAMES, TICK_RATE, MAX_HP } from '../shared/constants.js';

const PORT = 3123;

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const client = { ws, name, id: null, lobby: null, snapshots: [], matchStarted: false, matchEnd: null, seq: 0 };
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
const sendInput = (client, input) => send(client, inputMsg(client.seq++, input));
const me = (client) => client.snapshots.at(-1)?.fighters.find((f) => f.id === client.id);
const foe = (client) => client.snapshots.at(-1)?.fighters.find((f) => f.id !== client.id);

const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

try {
  await sleep(700);

  // Lobby handshake (no character select — colors are auto-assigned).
  const alice = await connectClient('Alice');
  const bob = await connectClient('Bob');
  assert.ok(alice.id && bob.id, 'both welcomed');

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

  // Wait out the countdown.
  await sleep((COUNTDOWN_FRAMES / TICK_RATE) * 1000 + 400);
  assert.ok(alice.snapshots.length > 5, `snapshots flowing (${alice.snapshots.length})`);
  assert.equal(me(alice).hp, MAX_HP);

  // Alice walks right until she's in punch range of Bob.
  const xStart = me(alice).x;
  const walker = setInterval(() => sendInput(alice, { right: true, aimX: 1 }), 33);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await sleep(60);
    const a = me(alice);
    const b = foe(alice);
    if (a && b && Math.abs(b.x - a.x) < 55) break;
  }
  clearInterval(walker);
  sendInput(alice, {});
  assert.ok(me(alice).x > xStart + 100, 'inputs moved the fighter');

  // Punch: press-release-press so edges register.
  for (let i = 0; i < 3; i++) {
    sendInput(alice, { shoot: true, aimX: 1 });
    await sleep(120);
    sendInput(alice, { aimX: 1 });
    await sleep(120);
  }
  const bobHp = foe(alice).hp;
  assert.ok(bobHp < MAX_HP, `punch landed (bob hp ${bobHp})`);

  // Both clients see the same authoritative state.
  assert.ok(Math.abs(alice.snapshots.at(-1).tick - bob.snapshots.at(-1).tick) < 60,
    'clients near-synchronized');

  // Disconnect Bob mid-match → match ends, Alice wins by forfeit.
  bob.ws.close();
  await sleep(1500);
  assert.ok(alice.matchEnd, 'MATCH_END delivered after opponent left');
  assert.equal(alice.matchEnd.winnerId, alice.id, 'remaining player wins');

  alice.ws.close();
  console.log('online integration: all assertions passed');
} finally {
  server.kill();
}
