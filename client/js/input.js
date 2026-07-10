// Keyboard/mouse → sim input objects: { left, right, down, jump, shoot, aimX, aimY }.
// Local mode: two players on one keyboard, aim synthesized 8-way from held
// direction keys. Online mode: P1 keys for movement + mouse for aim/fire.
// Fields are raw held-state; the sim edge-detects via prev-input.

import { STAGE } from '/shared/constants.js';

// KeyboardEvent.code → one or more [playerIndex, field] bindings. A value may
// be a single [player, field] pair or an array of them (so one key can drive
// two fields — e.g. W both jumps and aims up). Flat table so a future
// remapping UI only has to swap this object out.
export const DEFAULT_BINDINGS = {
  // Player 1 (WASD cluster). W is jump + aim-up (dual purpose); Space is a
  // second jump-only key (the comfortable default online, where P1 keys drive).
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  KeyW: [[0, 'jump'], [0, 'up']],
  Space: [0, 'jump'],
  KeyS: [0, 'down'],
  KeyF: [0, 'shoot'],
  ShiftLeft: [0, 'dash'],
  KeyQ: [0, 'throw'],
  // Player 2 (arrow cluster). Up Arrow is jump + aim-up.
  ArrowLeft: [1, 'left'],
  ArrowRight: [1, 'right'],
  ArrowUp: [[1, 'jump'], [1, 'up']],
  ArrowDown: [1, 'down'],
  Period: [1, 'shoot'],
  Slash: [1, 'dash'],
  Comma: [1, 'throw'],
};

function emptyKeys() {
  return { left: false, right: false, up: false, down: false, jump: false, shoot: false, dash: false, throw: false };
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
    const down = e.type === 'keydown';
    // A binding is either a single [player, field] pair or an array of them.
    const pairs = Array.isArray(binding[0]) ? binding : [binding];
    for (const [playerIndex, field] of pairs) {
      this.players[playerIndex][field] = down;
    }
  }

  // The canvas is CSS-scaled; map client coords back to canvas (view) pixels.
  // With the dynamic camera these are SCREEN coords, not world coords.
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
      dash: k.dash,
      throw: k.throw,
      aimX: (k.right ? 1 : 0) - (k.left ? 1 : 0),
      aimY: (k.down ? 1 : 0) - (k.up ? 1 : 0),
    };
  }

  // Online mode: P1 movement keys, aim from the mouse toward/away from the
  // local fighter's SCREEN position (camera scale is uniform, so a screen-space
  // direction is the same as the world-space direction), fire with mouse
  // button (or F as fallback).
  getMouseAimInput(selfScreenX, selfScreenY) {
    const k = this.players[0];
    return {
      left: k.left,
      right: k.right,
      down: k.down,
      jump: k.jump,
      shoot: this.mouse.down || k.shoot,
      dash: k.dash,
      throw: k.throw,
      aimX: this.mouse.x - selfScreenX,
      aimY: this.mouse.y - selfScreenY,
    };
  }
}
