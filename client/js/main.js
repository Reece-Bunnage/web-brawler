// Client entry: mode select and wiring (instructions §5).
import { InputManager } from './input.js';
import { Renderer } from './renderer.js';
import { LocalGame } from './localGame.js';
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

let currentGame = null;

function toMainMenu() {
  currentGame?.stop();
  currentGame = null;
  ui.showMainMenu({
    onLocal: startLocalFlow,
    onOnline: () => ui.showMessage('ONLINE', 'Online play arrives in Phase 9 — use Local for now.'),
  });
}

function startLocalFlow() {
  ui.showCharacterSelect({
    players: [{ label: 'P1' }, { label: 'P2' }],
    onDone: (characterIds) => startLocalMatch(characterIds),
  });
}

function startLocalMatch(characterIds) {
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
  const fighters = Object.values(state.fighters);
  const standings = fighters
    .slice()
    .sort((a, b) => b.stocks - a.stocks || a.percent - b.percent)
    .map((f) => ({ name: f.name, characterId: f.characterId, winner: f.id === state.winnerId }));
  ui.showResults({
    standings,
    onRematch: () => startLocalMatch(characterIds),
    onMenu: toMainMenu,
  });
}

toMainMenu();
