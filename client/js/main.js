// Client entry: mode select and wiring.
import { InputManager } from './input.js';
import { Renderer, interpolateSnapshots } from './renderer.js';
import { LocalGame } from './localGame.js';
import { NetClient } from './net.js';
import { AudioManager } from './audio.js';
import { Predictor } from './prediction.js';
import { standingsForMode } from '/shared/modes.js';
import { TICK_RATE } from '/shared/constants.js';
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

// F1 toggles the hitbox debug overlay; F2 the net-stats overlay; M mute.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') {
    e.preventDefault();
    renderer.toggleDebug();
  } else if (e.code === 'F2') {
    e.preventDefault();
    renderer.netDebug = !renderer.netDebug;
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
  ui.showMainMenu({ onLocal: showLocalModeSelect, onOnline: startOnlineFlow });
}

// --- Local mode ---------------------------------------------------------------

function showLocalModeSelect() {
  ui.showModeSelect({
    onSelect: (modeId) => startLocalMatch(modeId),
    onBack: toMainMenu,
  });
}

function startLocalMatch(modeId) {
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
    modeId,
    onMatchEnd: (state) => showLocalResults(state),
  });
  currentGame.start();
}

function showLocalResults(state) {
  uiMode = 'results';
  ui.showResults({
    standings: standingsForMode(state.fighters, state.modeId, state.winnerId),
    modeId: state.modeId,
    onRematch: () => startLocalMatch(state.modeId),
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
    modeId: lastLobby.modeId,
    onReady: (isReady) => net.setReady(isReady),
    onStart: () => net.startMatch(),
    onModeChange: (modeId) => net.setMode(modeId),
  });
}

function startOnlineMatch() {
  uiMode = 'match';
  ui.clearUI();
  inputManager.reset();
  window.__net = net; // debug/E2E hook: inspect snapshots from devtools
  let lastEventTick = -1;
  let lastRenderState = null;

  // Fixed 60 Hz local sim ticks (mirror of the server loop): each tick stamps
  // and sends one input and advances the own-fighter prediction one step, so
  // prediction stays in lockstep with server ticks regardless of display Hz.
  const TICK_MS = 1000 / TICK_RATE;
  const MAX_ACC_MS = 250; // backgrounded tab: skip time instead of spiraling
  let acc = 0;
  let lastTime = performance.now();
  const predictor = new Predictor(net.yourId);

  // Rolling fps for the F2 overlay.
  let fpsCount = 0;
  let fpsWindowStart = performance.now();
  let fps = 0;

  const frame = () => {
    if (uiMode !== 'match') return;
    const now = performance.now();
    acc = Math.min(acc + (now - lastTime), MAX_ACC_MS);
    lastTime = now;

    // Input + prediction run even during hit-stop (which freezes only the
    // draw) — pausing them would stall seq generation and cause a
    // misprediction burst after every big hit.
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      // Aim with the mouse relative to our own fighter's on-screen position
      // (the camera moves, so world coords and screen coords differ).
      const selfScreen = renderer.worldToScreen(selfPos.x, selfPos.y);
      const input = inputManager.getMouseAimInput(selfScreen.x, selfScreen.y);
      const seq = predictor.record(input);
      net.sendInputTick(seq, input);
      predictor.step(input);
    }

    // Play newly arrived events as one-shot cues.
    for (const snap of net.snapshots) {
      if (snap.tick <= lastEventTick) continue;
      lastEventTick = snap.tick;
      for (const ev of snap.events) {
        renderer.addEvent(ev);
        audio.addEvent(ev);
      }
    }

    // Rebase the prediction on the newest authoritative snapshot.
    predictor.reconcile(net.snapshots.at(-1));

    fpsCount += 1;
    if (now - fpsWindowStart >= 1000) {
      fps = fpsCount * 1000 / (now - fpsWindowStart);
      fpsCount = 0;
      fpsWindowStart = now;
    }

    if (renderer.hitStop > 0) {
      // Hit-stop: hold the last frame for a few ticks on big impacts
      // (cosmetic; the authoritative server never pauses, so no desync).
      renderer.hitStop -= 1;
      if (lastRenderState) renderer.draw(lastRenderState);
    } else {
      const pair = net.getInterpolationPair();
      if (pair) {
        const state = interpolateSnapshots(pair.a, pair.b, pair.t);
        predictor.apply(state); // own fighter pose from prediction
        const self = state.fighters[net.yourId];
        if (self) selfPos = { x: self.x, y: self.y };
        renderer.netStats = {
          fps,
          ...net.getNetStats(),
          pending: predictor.pending.length,
          predErrPx: predictor.errorPx(),
          predicting: !!predictor.predicted,
        };
        lastRenderState = state;
        renderer.draw(state);
        audio.update(state);
      }
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
    standings: msg.standings, // server standings already sorted for the mode
    modeId: msg.modeId,
    onRematch: null, // online rematch = everyone re-readies in the lobby
    onMenu: () => { uiMode = 'lobby'; renderLobby(); },
    menuLabel: 'Back to Lobby',
  });
}

toMainMenu();

// FUTURE: client-side prediction / rollback would hook in around
// startOnlineMatch — predict own fighter from local inputs, reconcile against
// authoritative snapshots. Out of scope for v1.
