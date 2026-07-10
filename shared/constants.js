// Every tunable number lives here. Units are pixels and frames at 60 fps
// unless noted. All values are starting points — tune by feel.

export const TICK_RATE = 60;              // sim steps per second
// One snapshot per tick: smoothest motion, ~2-4 Mbit/s total JSON on a full
// room — trivial for LAN. WAN play would want delta compression before this.
export const SNAPSHOT_RATE = 60;          // server broadcasts per second
export const DT = 1 / TICK_RATE;

// Online interpolation: the client renders this far in the past, adapting to
// measured snapshot arrival jitter (delay = GAP_MULT × p90 gap, clamped).
export const INTERP_MIN_MS = 33;          // floor: 2 snapshot intervals @60Hz
export const INTERP_MAX_MS = 120;         // ceiling under heavy jitter
export const INTERP_GAP_MULT = 2;
// Asymmetric easing: climb fast when jitter spikes (a starved buffer is
// visible chop), recover slowly (a lingering delay is invisible).
export const INTERP_EASE_UP = 0.4;        // per snapshot, toward a higher target
export const INTERP_EASE_DOWN = 0.015;    // per snapshot, toward a lower target

// Client-side prediction (own fighter online).
export const PREDICTION_SNAP_DIST = 80;      // divergence px that snaps instead of smoothing
export const PREDICTION_ERROR_DECAY = 0.85;  // per-frame decay of the render-error offset
export const PENDING_INPUT_MAX = 120;        // ~2s of unacked inputs kept for replay

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

// Dash: a committed horizontal burst; gravity is suspended while it lasts.
export const DASH_SPEED = 11;
export const DASH_FRAMES = 9;
export const DASH_COOLDOWN = 40;
export const AIR_DASHES = 1;              // air dashes per airtime (refreshed on landing)

// Wall slide / wall jump (hold a direction into a wall while airborne).
export const WALL_SLIDE_SPEED = 2.4;      // max fall speed while sliding
export const WALL_JUMP_VY = -11;
export const WALL_JUMP_KICK = 7.5;        // horizontal shove away from the wall

// STAGE is the fixed view/canvas resolution. World size is per-level
// (levels.js `width`/`height`, defaulting to STAGE) and the camera maps
// world → view. Blast zones sit BLAST_MARGIN outside each level's world.
export const STAGE = { width: 1280, height: 720 };
export const BLAST_MARGIN = { side: 300, top: 400, bottom: 300 };

// Stage geometry (solids, platforms, spawn points) lives per-level in
// shared/levels.js; the map rotates every round.

// Stick figures
export const FIGHTER_HURTBOX = { w: 30, h: 62 };   // head + body envelope
// Muzzle/hand height above the fighter's center (~shoulder line), so shots and
// thrown weapons leave from the gun (~3/4 up the body) rather than the middle.
// Matches the renderer's shoulder line (NECK_Y).
export const GUN_MOUNT_Y = -14;
export const MAX_HP = 100;
export const FIGHTER_COLORS = ['#4da6ff', '#ff6b4d', '#7dff7a', '#ffd24d'];
export const HIT_FLINCH_FRAMES = 6;       // brief control loss when shot

// Punch (unarmed)
export const PUNCH_DAMAGE = 12;
export const PUNCH_RANGE = 42;            // reach from fighter center
export const PUNCH_RADIUS = 22;           // hit circle at the fist
export const PUNCH_KNOCKBACK = 7;
export const PUNCH_COOLDOWN = 18;         // frames between punches

// Level hazards (static, data-driven per level in levels.js)
export const SAW_DAMAGE = 18;             // per contact with a saw blade
export const SAW_KNOCKBACK = 12;          // radial shove away from the saw center
export const HAZARD_HIT_COOLDOWN = 24;    // frames of hazard immunity after a hit
export const BOUNCE_POWER = 17;           // launch velocity off a bounce pad (> jump)

// Throwing the held gun (dedicated throw key). The gun becomes an arcing,
// spinning projectile: a hit sacrifices the weapon, a miss lands it as a
// recoverable drop.
export const THROW_SPEED = 15;            // launch speed of a thrown gun
export const THROW_DAMAGE = 22;           // contact damage of a thrown gun
export const THROW_KNOCKBACK = 9;         // shove along the throw direction
export const THROW_LIFE = 120;            // frames a thrown gun flies before it drops

// Weapons — per-gun numbers live in weapons.js; these are global.
export const WEAPON_SPAWN_INTERVAL = 240; // frames between sky drops (4 s)
export const WEAPON_SPAWN_MAX = 4;        // max un-picked-up guns on the map
export const WEAPON_DROP_FALL_SPEED = 3;  // drops fall gently (parachute feel)
export const PICKUP_RADIUS = 30;          // touch distance to grab a gun

// Respawning (modes with respawn: deathmatch, gun game)
export const RESPAWN_DELAY_FRAMES = 90;   // 1.5 s dead before coming back
export const SPAWN_INVULN_FRAMES = 60;    // 1 s of spawn protection

// Rounds
export const ROUND_WINS_TARGET = 5;       // first to N round wins takes the match
export const COUNTDOWN_FRAMES = 120;      // 2 s pre-round countdown
export const ROUND_END_LINGER = 110;      // banner time between rounds
export const ENDED_LINGER_FRAMES = 90;    // pause before final results
