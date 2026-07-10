// DOM menus: main menu, lobby, results. The in-match HUD is drawn on canvas
// by renderer.js; this file only handles out-of-match screens in #ui.

import { FIGHTER_COLORS } from '/shared/constants.js';
import { MODES, MODE_IDS, getMode } from '/shared/modes.js';

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
  box.appendChild(el('p', 'hint', 'P1: WASD · W/Space jump · F fire · Shift dash · Q throw  —  P2: arrows · ↑ jump · . fire · / dash · , throw'));
  box.appendChild(el('p', 'hint', 'Online: WASD move, W/Space jump, mouse aims, click fires. Guns fall from the sky — grab them!'));
}

// Pick each mode from a card list; used by the local flow before a match.
export function showModeSelect({ onSelect, onBack }) {
  const box = panel('CHOOSE MODE');
  for (const id of MODE_IDS) {
    const mode = MODES[id];
    const card = el('button', 'mode-card');
    card.appendChild(el('strong', null, mode.name));
    card.appendChild(el('small', null, mode.description));
    card.onclick = () => onSelect(id);
    box.appendChild(card);
  }
  const back = el('button', 'btn', 'Back');
  back.onclick = onBack;
  box.appendChild(back);
}

// One standings line per mode family: rounds won, kills/deaths, or ladder rung.
function standingLine(entry, mode) {
  if (mode.winCondition === 'kills') {
    return `${entry.name} — ${entry.kills} kill${entry.kills === 1 ? '' : 's'} · ${entry.deaths} death${entry.deaths === 1 ? '' : 's'}`;
  }
  if (mode.winCondition === 'ladder') {
    return `${entry.name} — rung ${entry.ladderLevel + 1}/${mode.ladder.length}`;
  }
  return `${entry.name} — ${entry.roundWins} round${entry.roundWins === 1 ? '' : 's'}`;
}

export function showResults({ standings, modeId = 'classic', onRematch, onMenu, menuLabel = 'Main Menu' }) {
  const mode = getMode(modeId);
  const box = panel('RESULTS');
  if (mode.id !== 'classic') box.appendChild(el('p', 'hint', mode.name));
  const list = el('ol', 'standings');
  standings.forEach((entry) => {
    const li = el('li', null, `${standingLine(entry, mode)}${entry.winner ? '  🏆' : ''}`);
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
export function showLobby({ players, hostId, yourId, modeId = 'classic', onReady, onStart, onModeChange }) {
  const you = players.find((p) => p.id === yourId);
  const isHost = hostId === yourId;
  const box = panel('LOBBY');

  // Game mode: the host picks, everyone else sees the pick live.
  const modeRow = el('div', 'lobby-row');
  modeRow.appendChild(el('span', 'lobby-name', 'Mode'));
  if (isHost) {
    const select = el('select', 'mode-select');
    for (const id of MODE_IDS) {
      const opt = el('option', null, MODES[id].name);
      opt.value = id;
      if (id === modeId) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => onModeChange?.(select.value);
    modeRow.appendChild(select);
  } else {
    modeRow.appendChild(el('span', 'lobby-status', getMode(modeId).name));
  }
  box.appendChild(modeRow);
  box.appendChild(el('p', 'hint', getMode(modeId).description));

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
