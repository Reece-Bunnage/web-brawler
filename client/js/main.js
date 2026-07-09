// Client entry: mode select and wiring (instructions §5).
import { InputManager } from './input.js';
import { Renderer, interpolateSnapshots } from './renderer.js';
import { LocalGame } from './localGame.js';
import { NetClient } from './net.js';
import * as ui from './ui.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const inputManager = new InputManager();
inputManager.attach();

// F1 toggles the hitbox/hurtbox debug overlay.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') {
    e.preventDefault();
    renderer.toggleDebug();
  }
});

let currentGame = null;   // LocalGame instance when playing locally
let net = null;           // NetClient when online
let uiMode = 'menu';      // menu | charselect | lobby | match | results
let lastLobby = null;     // latest LOBBY_STATE, re-rendered when relevant
let onlineLoop = null;    // rAF handle for the online render loop

function toMainMenu() {
  currentGame?.stop();
  currentGame = null;
  stopOnlineLoop();
  net?.disconnect();
  net = null;
  uiMode = 'menu';
  ui.showMainMenu({ onLocal: startLocalFlow, onOnline: startOnlineFlow });
}

// --- Local mode ---------------------------------------------------------------

function startLocalFlow() {
  uiMode = 'charselect';
  ui.showCharacterSelect({
    players: [{ label: 'P1' }, { label: 'P2' }],
    onDone: (characterIds) => startLocalMatch(characterIds),
  });
}

function startLocalMatch(characterIds) {
  uiMode = 'match';
  ui.clearUI();
  inputManager.reset();
  const playerConfigs = [
    { id: 'p1', characterId: characterIds[0], name: 'P1' },
    { id: 'p2', characterId: characterIds[1], name: 'P2' },
  ];
  currentGame = new LocalGame({
    inputManager,
    renderer,
    playerConfigs,
    onMatchEnd: (state) => showLocalResults(state, characterIds),
  });
  currentGame.start();
}

function showLocalResults(state, characterIds) {
  uiMode = 'results';
  const standings = Object.values(state.fighters)
    .slice()
    .sort((a, b) => b.stocks - a.stocks || a.percent - b.percent)
    .map((f) => ({ name: f.name, characterId: f.characterId, winner: f.id === state.winnerId }));
  ui.showResults({
    standings,
    onRematch: () => startLocalMatch(characterIds),
    onMenu: toMainMenu,
  });
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
    onSelectCharacter: (id) => net.selectCharacter(id),
    onReady: (isReady) => net.setReady(isReady),
    onStart: () => net.startMatch(),
  });
}

function startOnlineMatch() {
  uiMode = 'match';
  ui.clearUI();
  inputManager.reset();
  let lastEventTick = -1;

  const frame = () => {
    if (uiMode !== 'match') return;
    // Own inputs use the Player 1 layout online (§12).
    net.sendInput(inputManager.getInput(0));

    // Play newly arrived events as one-shot cues.
    for (const snap of net.snapshots) {
      if (snap.tick <= lastEventTick) continue;
      lastEventTick = snap.tick;
      for (const ev of snap.events) {
        if (ev.type === 'hit') renderer.flash(ev.victimId);
      }
    }

    const pair = net.getInterpolationPair();
    if (pair) {
      renderer.draw(interpolateSnapshots(pair.a, pair.b, pair.t));
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
  const standings = msg.standings.map((s) => ({
    name: s.name,
    characterId: s.characterId,
    winner: s.id === msg.winnerId,
  }));
  ui.showResults({
    standings,
    onRematch: null, // online rematch = everyone re-readies in the lobby
    onMenu: () => { uiMode = 'lobby'; renderLobby(); },
    menuLabel: 'Back to Lobby',
  });
}

toMainMenu();

// FUTURE: client-side prediction / rollback would hook in around
// startOnlineMatch — predict own fighter from local inputs, reconcile against
// authoritative snapshots. Out of scope for v1 (§11).
