// DOM menus: main menu, lobby, results. The in-match HUD is drawn on canvas
// by renderer.js; this file only handles out-of-match screens in #ui.

import { FIGHTER_COLORS } from '/shared/constants.js';

const root = document.getElementById('ui');

export function clearUI() {
  root.innerHTML = '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title) {
  clearUI();
  const box = el('div', 'panel');
  if (title) box.appendChild(el('h1', 'panel-title', title));
  root.appendChild(box);
  return box;
}

export function showMainMenu({ onLocal, onOnline }) {
  const box = panel('STICK FIGHT');
  const local = el('button', 'btn', 'Local (2P, one keyboard)');
  const online = el('button', 'btn', 'Online');
  local.onclick = onLocal;
  online.onclick = onOnline;
  box.append(local, online);
  box.appendChild(el('p', 'hint', 'P1: WASD move/aim · Space jump · F fire  —  P2: arrows · Enter jump · . fire'));
  box.appendChild(el('p', 'hint', 'Online: move with WASD, aim with the mouse, click to fire. Guns fall from the sky — grab them!'));
}

export function showResults({ standings, onRematch, onMenu, menuLabel = 'Main Menu' }) {
  const box = panel('RESULTS');
  const list = el('ol', 'standings');
  standings.forEach((entry) => {
    const li = el('li', null,
      `${entry.name} — ${entry.roundWins} round${entry.roundWins === 1 ? '' : 's'}${entry.winner ? '  🏆' : ''}`);
    li.style.color = entry.color || '#e8e8ec';
    list.appendChild(li);
  });
  box.appendChild(list);
  if (onRematch) {
    const rematch = el('button', 'btn btn-primary', 'Rematch');
    rematch.onclick = onRematch;
    box.appendChild(rematch);
  }
  const menu = el('button', 'btn', menuLabel);
  menu.onclick = onMenu;
  box.appendChild(menu);
}

export function showMessage(title, detail) {
  const box = panel(title);
  if (detail) box.appendChild(el('p', 'hint', detail));
}

// --- Online lobby -------------------------------------------------------------

export function showNamePrompt({ onSubmit }) {
  const box = panel('ONLINE');
  const input = el('input', 'name-input');
  input.placeholder = 'Your name';
  input.maxLength = 16;
  const join = el('button', 'btn btn-primary', 'Join');
  join.onclick = () => onSubmit(input.value.trim() || 'Player');
  input.onkeydown = (e) => { if (e.key === 'Enter') join.onclick(); e.stopPropagation(); };
  box.append(input, join);
  input.focus();
}

// Re-rendered on every LOBBY_STATE broadcast. Colors are assigned by join
// order — no character select in Stick Fight, your color is your identity.
export function showLobby({ players, hostId, yourId, onReady, onStart }) {
  const you = players.find((p) => p.id === yourId);
  const isHost = hostId === yourId;
  const box = panel('LOBBY');

  const list = el('div', 'lobby-list');
  players.forEach((p, i) => {
    const color = FIGHTER_COLORS[i % FIGHTER_COLORS.length];
    const row = el('div', 'lobby-row');
    const name = el('span', 'lobby-name',
      `${p.name}${p.id === hostId ? ' (host)' : ''}${p.id === yourId ? ' — you' : ''}`);
    name.style.color = color;
    row.appendChild(name);
    row.appendChild(el('span', 'lobby-status', p.ready ? 'READY' : 'waiting…'));
    list.appendChild(row);
  });
  box.appendChild(list);

  const ready = el('button', 'btn', you?.ready ? 'Unready' : 'Ready');
  ready.onclick = () => onReady(!you.ready);
  box.appendChild(ready);

  if (isHost) {
    const start = el('button', 'btn btn-primary', 'Start Match');
    start.disabled = !(players.length >= 2 && players.every((p) => p.ready));
    start.onclick = onStart;
    box.appendChild(start);
    if (start.disabled) box.appendChild(el('p', 'hint', 'Needs 2–4 players, all ready.'));
  } else {
    box.appendChild(el('p', 'hint', 'Waiting for the host to start…'));
  }
}
