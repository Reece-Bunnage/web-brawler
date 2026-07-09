// Keyboard → input objects (instructions §6, §12). Supports two local players
// on one keyboard. Fields are raw held-state; the sim does its own edge
// detection from prev-input, so we never clear "pressed" flags here.

// KeyboardEvent.code → [playerIndex, field]. Kept as a flat table so a future
// remapping UI only has to swap this object out.
export const DEFAULT_BINDINGS = {
  // Player 1 (WASD cluster)
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  KeyW: [0, 'up'],
  KeyS: [0, 'down'],
  Space: [0, 'jump'],
  KeyF: [0, 'light'],
  KeyG: [0, 'heavy'],
  ShiftLeft: [0, 'shield'],
  KeyC: [0, 'dodge'],
  // Player 2 (arrow cluster)
  ArrowLeft: [1, 'left'],
  ArrowRight: [1, 'right'],
  ArrowUp: [1, 'up'],
  ArrowDown: [1, 'down'],
  Enter: [1, 'jump'],
  Period: [1, 'light'],
  Slash: [1, 'heavy'],
  ShiftRight: [1, 'shield'],
  Quote: [1, 'dodge'],
};

function emptyInput() {
  return {
    left: false, right: false, up: false, down: false,
    jump: false, light: false, heavy: false, shield: false, dodge: false,
  };
}

export class InputManager {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.players = [emptyInput(), emptyInput()];
    this._onKey = this._onKey.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    // Losing focus mid-hold would otherwise leave keys stuck down.
    window.addEventListener('blur', () => this.reset());
  }

  detach() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
  }

  reset() {
    this.players = [emptyInput(), emptyInput()];
  }

  _onKey(e) {
    const binding = this.bindings[e.code];
    if (!binding) return;
    e.preventDefault();
    const [playerIndex, field] = binding;
    this.players[playerIndex][field] = e.type === 'keydown';
  }

  // Fresh copy so callers (sim, network) can keep it without aliasing.
  getInput(playerIndex) {
    return { ...this.players[playerIndex] };
  }
}
