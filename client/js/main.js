// Client entry: mode select and wiring.
import { InputManager } from './input.js';
import { Renderer, interpolateSnapshots } from './renderer.js';
import { LocalGame } from './localGame.js';
import { NetClient } from './net.js';
import { AudioManager } from './audio.js';
import * as ui from './ui.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const inputManager = new InputManager();
inputManager.attach(canvas);
const audio = new AudioManager();

// Browsers block audio until a user gesture — unlock on the first key/click.
const unlockAudio = () => audio.unlock();
window.addEventListener('keydown', unlockAudio);
window.addEventListener('pointerdown', unlockAudio);

// F1 toggles the hitbox debug overlay; M toggles mute.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') {
    e.preventDefault();
    renderer.toggleDebug();
  } else if (e.code === 'KeyM') {
    e.preventDefault();
    syncAudioControls(audio.toggleMute());
  }
});

// Minimal always-on audio control (mute + volume), bottom-left.
const audioBar = document.createElement('div');
audioBar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:50;display:flex;align-items:center;gap:8px;'
  + 'padding:6px 10px;border-radius:8px;background:rgba(10,12,20,0.6);font:12px system-ui;color:#cdd3ea;user-select:none';
const muteBtn = document.createElement('button');
muteBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;line-height:1';
const volSlider = document.createElement('input');
volSlider.type = 'range';
volSlider.min = '0'; volSlider.max = '1'; volSlider.step = '0.05';
volSlider.value = String(audio.volume);
volSlider.style.cssText = 'width:80px;cursor:pointer';
muteBtn.addEventListener('click', () => { audio.unlock(); syncAudioControls(audio.toggleMute()); });
volSlider.addEventListener('input', () => { audio.unlock(); audio.setVolume(Number(volSlider.value)); syncAudioControls(audio.muted); });
audioBar.append(muteBtn, volSlider);
document.body.appendChild(audioBar);

function syncAudioControls(muted) {
  muteBtn.textContent = muted ? '🔇' : '🔊';
  volSlider.style.opacity = muted ? '0.4' : '1';
}
syncAudioControls(audio.muted);

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
    audio,
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
  let lastRenderState = null;

  const frame = () => {
    if (uiMode !== 'match') return;

    // Hit-stop: hold the last frame for a few ticks on big impacts (cosmetic;
    // the authoritative server never pauses, so this can't desync).
    if (renderer.hitStop > 0) {
      renderer.hitStop -= 1;
      if (lastRenderState) renderer.draw(lastRenderState);
      onlineLoop = requestAnimationFrame(frame);
      return;
    }

    // Aim with the mouse relative to our own fighter's on-screen position
    // (the camera moves, so world coords and screen coords differ).
    const selfScreen = renderer.worldToScreen(selfPos.x, selfPos.y);
    net.sendInput(inputManager.getMouseAimInput(selfScreen.x, selfScreen.y));

    // Play newly arrived events as one-shot cues.
    for (const snap of net.snapshots) {
      if (snap.tick <= lastEventTick) continue;
      lastEventTick = snap.tick;
      for (const ev of snap.events) {
        renderer.addEvent(ev);
        audio.addEvent(ev);
      }
    }

    const pair = net.getInterpolationPair();
    if (pair) {
      const state = interpolateSnapshots(pair.a, pair.b, pair.t);
      const self = state.fighters[net.yourId];
      if (self) selfPos = { x: self.x, y: self.y };
      lastRenderState = state;
      renderer.draw(state);
      audio.update(state);
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
