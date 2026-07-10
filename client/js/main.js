// Client entry: mode select and wiring.
import { InputManager } from './input.js';
import { Renderer, interpolateSnapshots } from './renderer.js';
import { LocalGame } from './localGame.js';
import { NetClient } from './net.js';
import * as ui from './ui.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const inputManager = new InputManager();
inputManager.attach(canvas);

// F1 toggles the hitbox debug overlay.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') {
    e.preventDefault();
    renderer.toggleDebug();
  }
});

let currentGame = null;   // LocalGame instance when playing locally
let net = null;           // NetClient when online
let uiMode = 'menu';      // menu | lobby | match | results
let lastLobby = null;     // latest LOBBY_STATE, re-rendered when relevant
let onlineLoop = null;    // rAF handle for the online render loop
let selfPos = { x: 640, y: 400 }; // own fighter position for mouse aim

function toMainMenu() {
  currentGame?.stop();
  currentGame = null;
  stopOnlineLoop();
  net?.disconnect();
  net = null;
  uiMode = 'menu';
  ui.showMainMenu({ onLocal: startLocalMatch, onOnline: startOnlineFlow });
}

// --- Local mode ---------------------------------------------------------------

function startLocalMatch() {
  uiMode = 'match';
  ui.clearUI();
  inputManager.reset();
  // ?seed=N pins the level rotation and drop pattern (used by E2E tests).
  const seedParam = Number(new URLSearchParams(location.search).get('seed'));
  currentGame = new LocalGame({
    inputManager,
    renderer,
    playerConfigs: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
    seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : undefined,
    onMatchEnd: (state) => showLocalResults(state),
  });
  currentGame.start();
}

function showLocalResults(state) {
  uiMode = 'results';
  ui.showResults({
    standings: standingsFrom(Object.values(state.fighters), state.winnerId),
    onRematch: startLocalMatch,
    onMenu: toMainMenu,
  });
}

function standingsFrom(fighters, winnerId) {
  return fighters
    .slice()
    .sort((a, b) => b.roundWins - a.roundWins)
    .map((f) => ({
      name: f.name,
      color: f.color,
      roundWins: f.roundWins,
      winner: f.id === winnerId,
    }));
}

// --- Online mode ---------------------------------------------------------------

function startOnlineFlow() {
  uiMode = 'lobby';
  ui.showNamePrompt({
    onSubmit: async (name) => {
      net = new NetClient();
      net.onLobby = (lobby) => {
        lastLobby = lobby;
        if (uiMode === 'lobby') renderLobby();
      };
      net.onMatchStart = startOnlineMatch;
      net.onMatchEnd = showOnlineResults;
      net.onError = (message) => alert(message);
      net.onClose = () => {
        if (uiMode !== 'menu') {
          ui.showMessage('DISCONNECTED', 'Lost connection to the server.');
          setTimeout(toMainMenu, 1500);
        }
      };
      try {
        await net.connect();
        net.join(name);
      } catch {
        ui.showMessage('CONNECTION FAILED', 'Could not reach the server.');
        setTimeout(toMainMenu, 1500);
      }
    },
  });
}

function renderLobby() {
  if (!lastLobby || !net) return;
  ui.showLobby({
    players: lastLobby.players,
    hostId: lastLobby.hostId,
    yourId: net.yourId,
    onReady: (isReady) => net.setReady(isReady),
    onStart: () => net.startMatch(),
  });
}

function startOnlineMatch() {
  uiMode = 'match';
  ui.clearUI();
  inputManager.reset();
  window.__net = net; // debug/E2E hook: inspect snapshots from devtools
  let lastEventTick = -1;

  const frame = () => {
    if (uiMode !== 'match') return;
    // Aim with the mouse relative to our own fighter's on-screen position
    // (the camera moves, so world coords and screen coords differ).
    const selfScreen = renderer.worldToScreen(selfPos.x, selfPos.y);
    net.sendInput(inputManager.getMouseAimInput(selfScreen.x, selfScreen.y));

    // Play newly arrived events as one-shot cues.
    for (const snap of net.snapshots) {
      if (snap.tick <= lastEventTick) continue;
      lastEventTick = snap.tick;
      for (const ev of snap.events) renderer.addEvent(ev);
    }

    const pair = net.getInterpolationPair();
    if (pair) {
      const state = interpolateSnapshots(pair.a, pair.b, pair.t);
      const self = state.fighters[net.yourId];
      if (self) selfPos = { x: self.x, y: self.y };
      renderer.draw(state);
    }
    onlineLoop = requestAnimationFrame(frame);
  };
  onlineLoop = requestAnimationFrame(frame);
}

function stopOnlineLoop() {
  if (onlineLoop) cancelAnimationFrame(onlineLoop);
  onlineLoop = null;
}

function showOnlineResults(msg) {
  uiMode = 'results';
  stopOnlineLoop();
  ui.showResults({
    standings: msg.standings.map((s) => ({
      name: s.name,
      color: s.color,
      roundWins: s.roundWins,
      winner: s.id === msg.winnerId,
    })),
    onRematch: null, // online rematch = everyone re-readies in the lobby
    onMenu: () => { uiMode = 'lobby'; renderLobby(); },
    menuLabel: 'Back to Lobby',
  });
}

toMainMenu();

// FUTURE: client-side prediction / rollback would hook in around
// startOnlineMatch — predict own fighter from local inputs, reconcile against
// authoritative snapshots. Out of scope for v1.
