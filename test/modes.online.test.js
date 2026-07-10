// Online integration test for game modes: spawns the real server, checks the
// host-only SET_MODE flow, and that a gun-game match starts with mode fields
// flowing through MATCH_START and snapshots.
// Run with: node test/modes.online.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MSG, join, ready, setMode, startMatch } from '../shared/protocol.js';

const PORT = 3157;

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const client = { ws, name, id: null, lobby: null, snapshots: [], matchStart: null, matchEnd: null };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === MSG.WELCOME) { client.id = msg.yourId; resolve(client); }
      if (msg.type === MSG.LOBBY_STATE) client.lobby = msg;
      if (msg.type === MSG.MATCH_START) client.matchStart = msg;
      if (msg.type === MSG.SNAPSHOT) client.snapshots.push(msg);
      if (msg.type === MSG.MATCH_END) client.matchEnd = msg;
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

  // Non-host SET_MODE is ignored; the host's pick sticks and reaches everyone.
  send(bob, setMode('deathmatch'));
  await sleep(150);
  assert.notEqual(bob.lobby?.modeId, 'deathmatch', 'non-host cannot set the mode');
  send(alice, setMode('gungame'));
  await sleep(150);
  assert.equal(alice.lobby.modeId, 'gungame', 'host set the mode');
  assert.equal(bob.lobby.modeId, 'gungame', 'non-host sees the pick');
  send(alice, setMode('bogus'));
  await sleep(150);
  assert.equal(alice.lobby.modeId, 'gungame', 'invalid mode rejected');

  send(alice, ready(true));
  send(bob, ready(true));
  await sleep(150);
  send(alice, startMatch());
  await sleep(400);
  assert.equal(alice.matchStart?.modeId, 'gungame', 'MATCH_START carries the mode');

  // Wait out the countdown, then check the snapshot shape.
  await sleep(2400);
  const snap = alice.snapshots.at(-1);
  assert.equal(snap.modeId, 'gungame', 'snapshots carry modeId');
  assert.ok(snap.fighters.every((f) => f.weaponId === 'pistol'), 'everyone starts on the first rung');
  assert.ok(snap.fighters.every((f) => 'kills' in f && 'ladderLevel' in f), 'score fields in snapshots');
  assert.equal(snap.drops.length, 0, 'no sky drops in gun game');

  console.log('modes online integration: all assertions passed');
} finally {
  server.kill();
}
