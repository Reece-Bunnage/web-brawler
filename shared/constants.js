// Every tunable number lives here. Units are pixels and frames at 60 fps
// unless noted. All values are starting points — tune by feel.

export const TICK_RATE = 60;              // sim steps per second
export const SNAPSHOT_RATE = 30;          // server broadcasts per second
export const DT = 1 / TICK_RATE;

// Physics
export const GRAVITY = 0.6;               // px/frame^2
export const TERMINAL_VY = 16;
export const GROUND_ACCEL = 1.2;
export const GROUND_FRICTION = 0.8;
export const AIR_ACCEL = 0.7;
export const AIR_DRAG = 0.95;
export const MOVE_SPEED = 5;              // max ground speed
export const JUMP_VELOCITY = -12;
export const AIR_JUMPS = 1;               // extra mid-air jumps

// Stage / blast zones (relative to stage coords)
export const STAGE = { width: 1280, height: 720 };
export const BLAST = { left: -300, right: 1580, top: -400, bottom: 1020 };

// Stage geometry (solids, platforms, spawn points) lives per-level in
// shared/levels.js; the map rotates every round.

// Stick figures
export const FIGHTER_HURTBOX = { w: 30, h: 62 };   // head + body envelope
export const MAX_HP = 100;
export const FIGHTER_COLORS = ['#4da6ff', '#ff6b4d', '#7dff7a', '#ffd24d'];
export const HIT_FLINCH_FRAMES = 6;       // brief control loss when shot

// Punch (unarmed)
export const PUNCH_DAMAGE = 12;
export const PUNCH_RANGE = 42;            // reach from fighter center
export const PUNCH_RADIUS = 22;           // hit circle at the fist
export const PUNCH_KNOCKBACK = 7;
export const PUNCH_COOLDOWN = 18;         // frames between punches

// Weapons — per-gun numbers live in weapons.js; these are global.
export const WEAPON_SPAWN_INTERVAL = 240; // frames between sky drops (4 s)
export const WEAPON_SPAWN_MAX = 4;        // max un-picked-up guns on the map
export const WEAPON_DROP_FALL_SPEED = 3;  // drops fall gently (parachute feel)
export const PICKUP_RADIUS = 30;          // touch distance to grab a gun

// Rounds
export const ROUND_WINS_TARGET = 5;       // first to N round wins takes the match
export const COUNTDOWN_FRAMES = 120;      // 2 s pre-round countdown
export const ROUND_END_LINGER = 110;      // banner time between rounds
export const ENDED_LINGER_FRAMES = 90;    // pause before final results
