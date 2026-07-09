// DOM menus: main menu, character select, lobby (Phase 9), results.
// The in-match HUD is drawn on canvas by renderer.js; this file only handles
// out-of-match screens layered in the #ui div.

import { CHARACTERS, CHARACTER_IDS } from '/shared/characters.js';

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
  const box = panel('WEB BRAWLER');
  const local = el('button', 'btn', 'Local (2P, one keyboard)');
  const online = el('button', 'btn', 'Online');
  local.onclick = onLocal;
  online.onclick = onOnline;
  box.append(local, online);
  box.appendChild(el('p', 'hint', 'P1: WASD + Space/F/G/Shift/C  ·  P2: Arrows + Enter/./ /Shift/\''));
}

// Character select. players: [{label}] — one picker row per local player, or a
// single row online. onDone receives an array of characterIds in player order.
export function showCharacterSelect({ players, onDone, title = 'CHOOSE YOUR FIGHTER' }) {
  const box = panel(title);
  const picks = new Array(players.length).fill(null);
  const rows = [];

  players.forEach((player, pIdx) => {
    const row = el('div', 'char-row');
    row.appendChild(el('span', 'char-row-label', player.label));
    const cards = [];
    for (const id of CHARACTER_IDS) {
      const ch = CHARACTERS[id];
      const card = el('button', 'char-card');
      card.style.setProperty('--char-color', ch.color);
      card.appendChild(el('strong', null, ch.name));
      card.appendChild(el('small', null, describe(ch)));
      card.onclick = () => {
        picks[pIdx] = id;
        cards.forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        refresh();
      };
      cards.push(card);
      row.appendChild(card);
    }
    rows.push(row);
    box.appendChild(row);
  });

  const start = el('button', 'btn btn-primary', 'Start Match');
  start.disabled = true;
  start.onclick = () => onDone(picks);
  box.appendChild(start);

  function refresh() {
    start.disabled = picks.some((p) => p === null);
  }
}

function describe(ch) {
  if (ch.id === 'titan') return 'Heavy · slow · huge hits';
  if (ch.id === 'sprite') return 'Light · fast · fragile';
  return 'Balanced all-rounder';
}

export function showResults({ standings, onRematch, onMenu, menuLabel = 'Main Menu' }) {
  const box = panel('RESULTS');
  const list = el('ol', 'standings');
  standings.forEach((entry) => {
    const ch = CHARACTERS[entry.characterId];
    const li = el('li', null, `${entry.name} — ${ch.name}${entry.winner ? '  🏆' : ''}`);
    li.style.color = ch.color;
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

// --- Online lobby (Phase 9) -------------------------------------------------

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

// Re-rendered on every LOBBY_STATE broadcast.
export function showLobby({ players, hostId, yourId, onSelectCharacter, onReady, onStart }) {
  const you = players.find((p) => p.id === yourId);
  const isHost = hostId === yourId;
  const box = panel('LOBBY');

  const list = el('div', 'lobby-list');
  for (const p of players) {
    const ch = p.characterId ? CHARACTERS[p.characterId] : null;
    const row = el('div', 'lobby-row');
    row.appendChild(el('span', 'lobby-name',
      `${p.name}${p.id === hostId ? ' (host)' : ''}${p.id === yourId ? ' — you' : ''}`));
    const status = el('span', 'lobby-status',
      `${ch ? ch.name : 'picking…'} ${p.ready ? '· READY' : ''}`);
    if (ch) status.style.color = ch.color;
    row.appendChild(status);
    list.appendChild(row);
  }
  box.appendChild(list);

  const chRow = el('div', 'char-row');
  for (const id of CHARACTER_IDS) {
    const ch = CHARACTERS[id];
    const card = el('button', 'char-card');
    card.style.setProperty('--char-color', ch.color);
    if (you?.characterId === id) card.classList.add('selected');
    card.appendChild(el('strong', null, ch.name));
    card.onclick = () => onSelectCharacter(id);
    chRow.appendChild(card);
  }
  box.appendChild(chRow);

  const ready = el('button', 'btn', you?.ready ? 'Unready' : 'Ready');
  ready.disabled = !you?.characterId;
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
