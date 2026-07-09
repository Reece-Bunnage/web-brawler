// Lobby/session state (instructions §10 Phase 9). One room per server for v1;
// all state is instance-scoped so multiple rooms could be constructed later.

import { MSG, decode, encode, welcome, lobbyState, errorMsg } from '../shared/protocol.js';
import { CHARACTERS } from '../shared/characters.js';
import { GameServer } from './gameServer.js';

const MAX_PLAYERS = 4;

export class Room {
  constructor() {
    this.players = new Map();   // playerId → { id, name, characterId, ready, socket }
    this.bySocket = new Map();  // socket → playerId
    this.hostId = null;
    this.nextPlayerNum = 1;
    this.game = null;           // GameServer while a match is running
  }

  addConnection(socket) {
    socket.on('message', (raw) => this.handleMessage(socket, raw));
    socket.on('close', () => this.handleDisconnect(socket));
    socket.on('error', () => socket.close());
  }

  handleMessage(socket, raw) {
    const msg = decode(raw);
    if (!msg) return;

    if (msg.type === MSG.JOIN) {
      this.handleJoin(socket, msg);
      return;
    }

    const player = this.players.get(this.bySocket.get(socket));
    if (!player) return; // must JOIN first

    switch (msg.type) {
      case MSG.SELECT_CHARACTER:
        if (CHARACTERS[msg.characterId] && !this.game) {
          player.characterId = msg.characterId;
          this.broadcastLobby();
        }
        break;
      case MSG.READY:
        if (!this.game) {
          player.ready = Boolean(msg.ready) && Boolean(player.characterId);
          this.broadcastLobby();
        }
        break;
      case MSG.START_MATCH:
        this.handleStartMatch(player);
        break;
      case MSG.INPUT:
        this.game?.receiveInput(player.id, msg.seq, msg.input);
        break;
    }
  }

  handleJoin(socket, msg) {
    if (this.bySocket.has(socket)) return;
    if (this.players.size >= MAX_PLAYERS) {
      socket.send(encode(errorMsg('Room is full (4 players max).')));
      socket.close();
      return;
    }
    if (this.game) {
      socket.send(encode(errorMsg('A match is already in progress.')));
      socket.close();
      return;
    }

    const id = `player${this.nextPlayerNum++}`;
    const name = String(msg.name || '').slice(0, 16).trim() || id;
    this.players.set(id, { id, name, characterId: null, ready: false, socket });
    this.bySocket.set(socket, id);
    if (!this.hostId) this.hostId = id; // first joiner hosts

    socket.send(encode(welcome(id)));
    this.broadcastLobby();
    console.log(`[room] ${name} joined as ${id} (${this.players.size} players)`);
  }

  handleStartMatch(player) {
    if (player.id !== this.hostId) {
      this.sendTo(player.id, errorMsg('Only the host can start the match.'));
      return;
    }
    if (this.game) return;
    const players = [...this.players.values()];
    if (players.length < 2 || !players.every((p) => p.ready && p.characterId)) {
      this.sendTo(player.id, errorMsg('Need 2–4 players, everyone ready.'));
      return;
    }

    this.game = new GameServer(this, players.map((p) => ({
      id: p.id,
      characterId: p.characterId,
      name: p.name,
    })));
    this.game.start();
    console.log(`[room] match started with ${players.length} players`);
  }

  // Called by GameServer when the match finishes; back to the lobby.
  onMatchOver() {
    this.game = null;
    for (const p of this.players.values()) p.ready = false;
    this.broadcastLobby();
  }

  handleDisconnect(socket) {
    const id = this.bySocket.get(socket);
    if (!id) return;
    this.bySocket.delete(socket);
    const player = this.players.get(id);
    this.players.delete(id);
    console.log(`[room] ${player?.name ?? id} disconnected`);

    if (this.hostId === id) {
      this.hostId = this.players.keys().next().value ?? null; // promote next joiner
    }
    this.game?.removePlayer(id);
    this.broadcastLobby();
  }

  broadcastLobby() {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      ready: p.ready,
    }));
    this.broadcast(lobbyState(players, this.hostId));
  }

  sendTo(playerId, msg) {
    const player = this.players.get(playerId);
    if (player && player.socket.readyState === player.socket.OPEN) {
      player.socket.send(encode(msg));
    }
  }

  broadcast(msg) {
    const raw = encode(msg);
    for (const p of this.players.values()) {
      if (p.socket.readyState === p.socket.OPEN) p.socket.send(raw);
    }
  }
}
