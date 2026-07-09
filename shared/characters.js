// Character + move definitions (instructions §8). Data-driven: the sim reads
// these tables and has no per-character logic.
//
// Move shape:
// {
//   damage,              // % added to victim
//   baseKnockback,
//   knockbackScaling,    // multiplied by victim's percent
//   angle,               // degrees, relative to facing (0 = forward, 90 = up)
//   startup,             // frames before hitbox active
//   active,              // frames hitbox is live
//   recovery,            // frames after, locked
//   hitbox: { offsetX, offsetY, w, h }, // relative to fighter center, mirrored by facing
//   canUseInAir: bool
// }

export const CHARACTERS = {
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    color: '#4da6ff',
    weight: 1.0,
    moveSpeed: 5,
    jumpVelocity: -12,
    airJumps: 1,
    hurtbox: { w: 40, h: 80 },
    moves: {
      lightNeutral: {
        damage: 4, baseKnockback: 3, knockbackScaling: 0.03, angle: 60,
        startup: 4, active: 3, recovery: 8,
        hitbox: { offsetX: 32, offsetY: -8, w: 36, h: 28 }, canUseInAir: true,
      },
      lightSide: {
        damage: 6, baseKnockback: 4, knockbackScaling: 0.05, angle: 35,
        startup: 6, active: 4, recovery: 11,
        hitbox: { offsetX: 40, offsetY: 0, w: 44, h: 24 }, canUseInAir: true,
      },
      lightUp: {
        damage: 5, baseKnockback: 4, knockbackScaling: 0.05, angle: 88,
        startup: 5, active: 4, recovery: 10,
        hitbox: { offsetX: 6, offsetY: -50, w: 40, h: 32 }, canUseInAir: true,
      },
      lightDown: {
        damage: 5, baseKnockback: 3.5, knockbackScaling: 0.04, angle: 75,
        startup: 5, active: 4, recovery: 10,
        hitbox: { offsetX: 26, offsetY: 30, w: 40, h: 22 }, canUseInAir: true,
      },
      heavyNeutral: {
        damage: 11, baseKnockback: 6.5, knockbackScaling: 0.10, angle: 45,
        startup: 12, active: 4, recovery: 18,
        hitbox: { offsetX: 36, offsetY: -6, w: 44, h: 40 }, canUseInAir: false,
      },
      heavySide: {
        damage: 13, baseKnockback: 7, knockbackScaling: 0.12, angle: 32,
        startup: 15, active: 5, recovery: 21,
        hitbox: { offsetX: 46, offsetY: 0, w: 52, h: 30 }, canUseInAir: false,
      },
      heavyUp: {
        damage: 12, baseKnockback: 7, knockbackScaling: 0.11, angle: 88,
        startup: 11, active: 5, recovery: 19,
        hitbox: { offsetX: 4, offsetY: -58, w: 46, h: 40 }, canUseInAir: true,
      },
      heavyDown: {
        damage: 12, baseKnockback: 6.5, knockbackScaling: 0.11, angle: 28,
        startup: 14, active: 5, recovery: 20,
        hitbox: { offsetX: 30, offsetY: 32, w: 48, h: 24 }, canUseInAir: true,
      },
    },
  },

  titan: {
    id: 'titan',
    name: 'Titan',
    color: '#ff6b4d',
    weight: 1.4,
    moveSpeed: 3.5,
    jumpVelocity: -10.5,
    airJumps: 1,
    hurtbox: { w: 56, h: 96 },
    moves: {
      lightNeutral: {
        damage: 6, baseKnockback: 4, knockbackScaling: 0.04, angle: 55,
        startup: 7, active: 3, recovery: 12,
        hitbox: { offsetX: 40, offsetY: -10, w: 44, h: 34 }, canUseInAir: true,
      },
      lightSide: {
        damage: 8, baseKnockback: 5, knockbackScaling: 0.06, angle: 35,
        startup: 9, active: 4, recovery: 15,
        hitbox: { offsetX: 50, offsetY: 0, w: 56, h: 30 }, canUseInAir: true,
      },
      lightUp: {
        damage: 7, baseKnockback: 5, knockbackScaling: 0.06, angle: 88,
        startup: 8, active: 4, recovery: 14,
        hitbox: { offsetX: 8, offsetY: -62, w: 50, h: 38 }, canUseInAir: true,
      },
      lightDown: {
        damage: 7, baseKnockback: 4.5, knockbackScaling: 0.05, angle: 70,
        startup: 8, active: 4, recovery: 14,
        hitbox: { offsetX: 34, offsetY: 36, w: 50, h: 26 }, canUseInAir: true,
      },
      heavyNeutral: {
        damage: 16, baseKnockback: 8.5, knockbackScaling: 0.13, angle: 45,
        startup: 18, active: 5, recovery: 24,
        hitbox: { offsetX: 44, offsetY: -8, w: 56, h: 50 }, canUseInAir: false,
      },
      heavySide: {
        damage: 18, baseKnockback: 9, knockbackScaling: 0.15, angle: 30,
        startup: 22, active: 6, recovery: 28,
        hitbox: { offsetX: 56, offsetY: 0, w: 64, h: 36 }, canUseInAir: false,
      },
      heavyUp: {
        damage: 16, baseKnockback: 9, knockbackScaling: 0.13, angle: 88,
        startup: 16, active: 6, recovery: 26,
        hitbox: { offsetX: 6, offsetY: -70, w: 58, h: 46 }, canUseInAir: true,
      },
      heavyDown: {
        damage: 17, baseKnockback: 8.5, knockbackScaling: 0.14, angle: 26,
        startup: 20, active: 6, recovery: 26,
        hitbox: { offsetX: 38, offsetY: 40, w: 58, h: 28 }, canUseInAir: true,
      },
    },
  },

  sprite: {
    id: 'sprite',
    name: 'Sprite',
    color: '#7dff7a',
    weight: 0.7,
    moveSpeed: 6.5,
    jumpVelocity: -13,
    airJumps: 2,
    hurtbox: { w: 32, h: 64 },
    moves: {
      lightNeutral: {
        damage: 3, baseKnockback: 2.5, knockbackScaling: 0.025, angle: 60,
        startup: 3, active: 3, recovery: 6,
        hitbox: { offsetX: 26, offsetY: -6, w: 30, h: 24 }, canUseInAir: true,
      },
      lightSide: {
        damage: 4.5, baseKnockback: 3.2, knockbackScaling: 0.04, angle: 38,
        startup: 4, active: 3, recovery: 8,
        hitbox: { offsetX: 32, offsetY: 0, w: 36, h: 20 }, canUseInAir: true,
      },
      lightUp: {
        damage: 4, baseKnockback: 3.2, knockbackScaling: 0.04, angle: 88,
        startup: 4, active: 3, recovery: 7,
        hitbox: { offsetX: 4, offsetY: -42, w: 34, h: 26 }, canUseInAir: true,
      },
      lightDown: {
        damage: 4, baseKnockback: 2.8, knockbackScaling: 0.035, angle: 75,
        startup: 4, active: 3, recovery: 7,
        hitbox: { offsetX: 22, offsetY: 24, w: 34, h: 18 }, canUseInAir: true,
      },
      heavyNeutral: {
        damage: 8, baseKnockback: 5, knockbackScaling: 0.08, angle: 45,
        startup: 8, active: 4, recovery: 13,
        hitbox: { offsetX: 28, offsetY: -4, w: 36, h: 32 }, canUseInAir: true,
      },
      heavySide: {
        damage: 9.5, baseKnockback: 5.5, knockbackScaling: 0.09, angle: 35,
        startup: 10, active: 4, recovery: 15,
        hitbox: { offsetX: 36, offsetY: 0, w: 40, h: 26 }, canUseInAir: true,
      },
      heavyUp: {
        damage: 9, baseKnockback: 5.5, knockbackScaling: 0.085, angle: 88,
        startup: 9, active: 4, recovery: 14,
        hitbox: { offsetX: 4, offsetY: -48, w: 38, h: 32 }, canUseInAir: true,
      },
      heavyDown: {
        damage: 9, baseKnockback: 5, knockbackScaling: 0.085, angle: 30,
        startup: 10, active: 4, recovery: 15,
        hitbox: { offsetX: 26, offsetY: 26, w: 40, h: 22 }, canUseInAir: true,
      },
    },
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);

export const MOVE_KEYS = [
  'lightNeutral', 'lightSide', 'lightUp', 'lightDown',
  'heavyNeutral', 'heavySide', 'heavyUp', 'heavyDown',
];
