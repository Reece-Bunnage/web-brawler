// Keyboard/mouse → sim input objects: { left, right, down, jump, shoot, aimX, aimY }.
// Local mode: two players on one keyboard, aim synthesized 8-way from held
// direction keys. Online mode: P1 keys for movement + mouse for aim/fire.
// Fields are raw held-state; the sim edge-detects via prev-input.

import { STAGE } from '/shared/constants.js';

// KeyboardEvent.code → [playerIndex, field]. Flat table so a future remapping
// UI only has to swap this object out.
export const DEFAULT_BINDINGS = {
  // Player 1 (WASD cluster)
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  KeyW: [0, 'up'],
  KeyS: [0, 'down'],
  Space: [0, 'jump'],
  KeyF: [0, 'shoot'],
  // Player 2 (arrow cluster)
  ArrowLeft: [1, 'left'],
  ArrowRight: [1, 'right'],
  ArrowUp: [1, 'up'],
  ArrowDown: [1, 'down'],
  Enter: [1, 'jump'],
  Period: [1, 'shoot'],
};

function emptyKeys() {
  return { left: false, right: false, up: false, down: false, jump: false, shoot: false };
}

export class InputManager {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.players = [emptyKeys(), emptyKeys()];
    this.mouse = { x: STAGE.width / 2, y: STAGE.height / 2, down: false };
    this.canvas = null;
    this._onKey = this._onKey.bind(this);
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    // Losing focus mid-hold would otherwise leave keys stuck down.
    window.addEventListener('blur', () => this.reset());

    canvas.addEventListener('mousemove', (e) => {
      const world = this._toWorld(e);
      this.mouse.x = world.x;
      this.mouse.y = world.y;
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.down = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    this.players = [emptyKeys(), emptyKeys()];
    this.mouse.down = false;
  }

  _onKey(e) {
    const binding = this.bindings[e.code];
    if (!binding) return;
    e.preventDefault();
    const [playerIndex, field] = binding;
    this.players[playerIndex][field] = e.type === 'keydown';
  }

  // The canvas is CSS-scaled; map client coords back to stage coords.
  _toWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (STAGE.width / rect.width),
      y: (e.clientY - rect.top) * (STAGE.height / rect.height),
    };
  }

  // Local mode: 8-way aim from held direction keys (sim defaults to facing
  // when no direction is held).
  getInput(playerIndex) {
    const k = this.players[playerIndex];
    return {
      left: k.left,
      right: k.right,
      down: k.down,
      jump: k.jump,
      shoot: k.shoot,
      aimX: (k.right ? 1 : 0) - (k.left ? 1 : 0),
      aimY: (k.down ? 1 : 0) - (k.up ? 1 : 0),
    };
  }

  // Online mode: P1 movement keys, aim from the mouse relative to the local
  // fighter's world position, fire with mouse button (or F as fallback).
  getMouseAimInput(selfX, selfY) {
    const k = this.players[0];
    return {
      left: k.left,
      right: k.right,
      down: k.down,
      jump: k.jump,
      shoot: this.mouse.down || k.shoot,
      aimX: this.mouse.x - selfX,
      aimY: this.mouse.y - selfY,
    };
  }
}
