// Game mode definitions — data-driven, like weapons.js. The sim branches on
// these flags rather than on mode ids, so adding a mode is (mostly) adding an
// entry here.
//
// Mode shape:
// {
//   id, name, description,
//   weaponSpawns,     // guns fall from the sky
//   pickups,          // touching a drop equips it
//   throwEnabled,     // the throw key hurls the held gun
//   respawn,          // dead fighters come back after RESPAWN_DELAY_FRAMES
//   rounds,           // round-based (last man standing, first to N round wins);
//                     // false = one continuous round ended by timer/ladder
//   winCondition,     // 'roundWins' | 'kills' | 'ladder' — drives standings + results UI
//   matchTimeFrames,  // (timed modes) total match length in frames
//   ladder,           // (gun game) weaponId per kill rung; null = fists (final rung)
//   bomb,             // (hot potato) { initialFuse, rearmFuse, passImmunity } in frames
//   equip,            // weaponId everyone holds at round start (saber duel)
// }

export const MODES = {
  classic: {
    id: 'classic', name: 'Classic',
    description: 'Last one standing wins the round. First to 5 rounds. Guns rain from the sky.',
    weaponSpawns: true, pickups: true, throwEnabled: true,
    respawn: false, rounds: true, winCondition: 'roundWins',
  },
  melee: {
    id: 'melee', name: 'Melee Only',
    description: 'Classic rules, no guns — settle it with your fists.',
    weaponSpawns: false, pickups: false, throwEnabled: true,
    respawn: false, rounds: true, winCondition: 'roundWins',
  },
  deathmatch: {
    id: 'deathmatch', name: 'Deathmatch',
    description: '3 minutes, endless respawns. Most kills at the buzzer wins.',
    weaponSpawns: true, pickups: true, throwEnabled: true,
    respawn: true, rounds: false, winCondition: 'kills',
    matchTimeFrames: 3 * 60 * 60, // 3 minutes at 60 fps
  },
  gungame: {
    id: 'gungame', name: 'Gun Game',
    description: 'Every kill advances your weapon. First kill with bare fists wins.',
    weaponSpawns: false, pickups: false, throwEnabled: false,
    respawn: true, rounds: false, winCondition: 'ladder',
    ladder: ['pistol', 'uzi', 'shotgun', 'bazooka', 'sniper', null], // null = fists
  },
  saber: {
    id: 'saber', name: 'Saber Duel',
    description: 'Everyone gets a lightsaber. One hit kills — unless both are swinging and the blades clash.',
    weaponSpawns: false, pickups: false, throwEnabled: false,
    respawn: false, rounds: true, winCondition: 'roundWins',
    equip: 'saber', // everyone starts each round holding this weapon
  },
  hotpotato: {
    id: 'hotpotato', name: 'Hot Potato',
    description: 'A ticking bomb sticks to someone — touch or punch to pass it. Outlive the blasts.',
    weaponSpawns: false, pickups: false, throwEnabled: true,
    respawn: false, rounds: true, winCondition: 'roundWins',
    bomb: {
      initialFuse: 600,  // 10 s first fuse of the round
      rearmFuse: 360,    // 6 s after each explosion
      passImmunity: 45,  // frames the previous carrier can't be handed it back
    },
  },
};

export const MODE_IDS = Object.keys(MODES);

export function getMode(id) {
  return MODES[id] ?? MODES.classic;
}

// Shared standings sort used by the client results screen (local) and the
// server's MATCH_END (online), so both agree on placement.
export function standingsForMode(fighters, modeId, winnerId) {
  const mode = getMode(modeId);
  const list = Object.values(fighters).map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    roundWins: f.roundWins,
    kills: f.kills ?? 0,
    deaths: f.deaths ?? 0,
    ladderLevel: f.ladderLevel ?? 0,
    winner: f.id === winnerId,
  }));
  list.sort((a, b) => {
    if (mode.winCondition === 'kills') return b.kills - a.kills || a.deaths - b.deaths;
    if (mode.winCondition === 'ladder') return b.ladderLevel - a.ladderLevel || a.deaths - b.deaths;
    return b.roundWins - a.roundWins;
  });
  return list;
}
