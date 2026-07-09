// Message protocol (instructions §6). All messages are JSON: { type, ...payload }.
// Builders keep both sides honest about payload shapes without a type system.

export const MSG = {
  // Client → Server
  JOIN: 'JOIN',
  SELECT_CHARACTER: 'SELECT_CHARACTER',
  READY: 'READY',
  START_MATCH: 'START_MATCH',
  INPUT: 'INPUT',
  // Server → Client
  WELCOME: 'WELCOME',
  LOBBY_STATE: 'LOBBY_STATE',
  MATCH_START: 'MATCH_START',
  SNAPSHOT: 'SNAPSHOT',
  MATCH_END: 'MATCH_END',
  ERROR: 'ERROR',
};

// Client → Server
export const join = (name) => ({ type: MSG.JOIN, name });
export const selectCharacter = (characterId) => ({ type: MSG.SELECT_CHARACTER, characterId });
export const ready = (isReady) => ({ type: MSG.READY, ready: isReady });
export const startMatch = () => ({ type: MSG.START_MATCH });
export const inputMsg = (seq, input) => ({ type: MSG.INPUT, seq, input });

// Server → Client
export const welcome = (yourId) => ({ type: MSG.WELCOME, yourId });
export const lobbyState = (players, hostId) => ({ type: MSG.LOBBY_STATE, players, hostId });
export const matchStart = (stageId, fighters, yourId) => ({ type: MSG.MATCH_START, stageId, fighters, yourId });
export const snapshot = (tick, phase, fighters, events, extra = {}) =>
  ({ type: MSG.SNAPSHOT, tick, phase, fighters, events, ...extra });
export const matchEnd = (winnerId, standings) => ({ type: MSG.MATCH_END, winnerId, standings });
export const errorMsg = (message) => ({ type: MSG.ERROR, message });

export function encode(msg) {
  return JSON.stringify(msg);
}

// Returns null on malformed input rather than throwing — a bad client packet
// must never take down the server loop.
export function decode(raw) {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.type === 'string' ? msg : null;
  } catch {
    return null;
  }
}
