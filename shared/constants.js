// Every tunable number lives here (instructions §7). Units are pixels and
// frames at 60 fps unless noted. All values are starting points — tune by feel.

export const TICK_RATE = 60;              // sim steps per second
export const SNAPSHOT_RATE = 30;          // server broadcasts per second
export const DT = 1 / TICK_RATE;

// Physics
export const GRAVITY = 0.6;               // px/frame^2
export const TERMINAL_VY = 16;
export const GROUND_ACCEL = 1.2;
export const GROUND_FRICTION = 0.8;
export const AIR_ACCEL = 0.5;
export const AIR_DRAG = 0.95;

// Stage / blast zones (relative to stage coords)
export const STAGE = { width: 1280, height: 720 };
export const BLAST = { left: -300, right: 1580, top: -400, bottom: 1020 };

// Stage geometry: one solid floor plus two pass-through platforms.
// Fighters land on platform tops when falling, pass up through from below,
// and drop through by holding down.
export const FLOOR = { x: 140, y: 600, w: 1000, h: 120 };
export const PLATFORMS = [
  { x: 280, y: 440, w: 220, h: 12 },
  { x: 780, y: 440, w: 220, h: 12 },
];
// Spawn/respawn coords are FEET positions (y = where the hurtbox bottom goes),
// so characters of any height spawn standing on, not inside, the surface.
export const SPAWN_POINTS = [
  { x: 340, y: 600 },
  { x: 940, y: 600 },
  { x: 540, y: 600 },
  { x: 740, y: 600 },
];
export const RESPAWN_POINT = { x: 640, y: 300 };

// Combat
export const HITSTUN_PER_KNOCKBACK = 0.4; // frames of hitstun per unit knockback
export const SHIELD_MAX = 100;
export const SHIELD_REGEN = 0.3;          // per frame not shielding
export const SHIELD_DRAIN_HELD = 0.15;    // per frame while shielding
export const SHIELD_BREAK_STUN = 120;     // frames stunned when shield empties
export const DODGE_IFRAMES = 18;
export const ROLL_IFRAMES = 14;
export const ROLL_SPEED = 7;              // horizontal speed during a roll
export const ROLL_DURATION = 22;          // total roll frames (i-frames end earlier)
export const SPOT_DODGE_DURATION = 24;    // total spot-dodge frames
export const AIR_DODGE_DURATION = 26;     // total air-dodge frames
export const AIR_DODGE_BURST = 6;         // directional burst speed for air dodge
export const RESPAWN_IFRAMES = 90;
export const STOCKS = 3;
export const COUNTDOWN_FRAMES = 180;      // 3 seconds
export const ENDED_LINGER_FRAMES = 90;    // pause on the final KO before results
