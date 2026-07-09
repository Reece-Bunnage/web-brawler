// Weapon definitions — data-driven; the sim has no per-gun logic.
//
// Weapon shape:
// {
//   id, name,
//   auto,               // true = fires repeatedly while shoot held
//   fireCooldown,       // frames between shots
//   damage,             // per projectile
//   knockback,          // velocity impulse applied to the victim along the shot
//   recoil,             // velocity impulse applied to the shooter, opposite aim
//   projectileSpeed,    // px/frame
//   projectileCount,    // pellets per trigger pull
//   spread,             // max aim deviation in radians (uniform, symmetric)
//   projectileLife,     // frames before a projectile despawns
//   gravityFactor,      // fraction of GRAVITY applied to the projectile
//   explosive,          // rockets: explode on any contact
//   explosionRadius, explosionDamage, explosionKnockback,  // explosive only
//   barrel,             // muzzle distance from fighter center (render + spawn)
// }

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Pistol',
    auto: false, fireCooldown: 14,
    damage: 15, knockback: 3, recoil: 0.8,
    projectileSpeed: 18, projectileCount: 1, spread: 0.015,
    projectileLife: 90, gravityFactor: 0,
    explosive: false, barrel: 26,
  },
  uzi: {
    id: 'uzi', name: 'Uzi',
    auto: true, fireCooldown: 5,
    damage: 6, knockback: 1.6, recoil: 0.5,
    projectileSpeed: 16, projectileCount: 1, spread: 0.09,
    projectileLife: 80, gravityFactor: 0,
    explosive: false, barrel: 24,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun',
    auto: false, fireCooldown: 38,
    damage: 8, knockback: 4.5, recoil: 4,
    projectileSpeed: 14, projectileCount: 5, spread: 0.22,
    projectileLife: 26, gravityFactor: 0,
    explosive: false, barrel: 30,
  },
  bazooka: {
    id: 'bazooka', name: 'Bazooka',
    auto: false, fireCooldown: 55,
    damage: 0,               // rocket damage is all in the explosion
    knockback: 0, recoil: 3,
    projectileSpeed: 9, projectileCount: 1, spread: 0,
    projectileLife: 180, gravityFactor: 0.12,
    explosive: true, explosionRadius: 85, explosionDamage: 55, explosionKnockback: 11,
    barrel: 34,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);
