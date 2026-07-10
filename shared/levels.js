// Level definitions — data-driven; the sim and renderer share these.
//
// Level shape:
// {
//   id, name,
//   solids:    [ {x,y,w,h} ],   // full-collision ground blocks (land/bonk/side-push)
//   platforms: [ {x,y,w,h} ],   // thin pass-through platforms (drop through with down)
//   spawnPoints: [ {x,y} ],     // FEET positions (y = where the hurtbox bottom goes)
//   dropRange: { min, max },    // x-range where guns fall from the sky
//   accent,                     // ground fill color
// }
//
// Geometry rules of thumb (jumpVelocity -12, gravity 0.6): a single jump rises
// ~120px, jump + air jump ~240px. Keep vertical steps under those.

export const LEVELS = [
  {
    id: 'classic',
    name: 'Classic',
    solids: [{ x: 140, y: 600, w: 1000, h: 120 }],
    platforms: [
      { x: 280, y: 440, w: 220, h: 12 },
      { x: 780, y: 440, w: 220, h: 12 },
    ],
    spawnPoints: [
      { x: 340, y: 600 }, { x: 940, y: 600 }, { x: 540, y: 600 }, { x: 740, y: 600 },
    ],
    dropRange: { min: 200, max: 1080 },
    accent: '#3a3f55',
  },
  {
    id: 'towers',
    name: 'Twin Towers',
    solids: [
      { x: 160, y: 480, w: 340, h: 240 },
      { x: 780, y: 480, w: 340, h: 240 },
    ],
    platforms: [
      { x: 540, y: 360, w: 200, h: 12 }, // bridge over the deadly gap
    ],
    spawnPoints: [
      { x: 260, y: 480 }, { x: 1020, y: 480 }, { x: 420, y: 480 }, { x: 860, y: 480 },
    ],
    dropRange: { min: 200, max: 1080 },
    accent: '#4a3f55',
  },
  {
    id: 'islands',
    name: 'Islands',
    solids: [
      { x: 80, y: 560, w: 280, h: 60 },
      { x: 500, y: 480, w: 280, h: 60 },
      { x: 920, y: 560, w: 280, h: 60 },
    ],
    platforms: [
      { x: 390, y: 400, w: 100, h: 12 },
      { x: 790, y: 400, w: 100, h: 12 },
    ],
    spawnPoints: [
      { x: 160, y: 560 }, { x: 1060, y: 560 }, { x: 560, y: 480 }, { x: 720, y: 480 },
    ],
    dropRange: { min: 100, max: 1180 },
    accent: '#3f5546',
  },
  {
    id: 'pit',
    name: 'The Pit',
    solids: [
      { x: 100, y: 460, w: 280, h: 260 },
      { x: 900, y: 460, w: 280, h: 260 },
      { x: 380, y: 640, w: 520, h: 80 }, // sunken center floor
    ],
    platforms: [
      { x: 530, y: 480, w: 220, h: 12 },
    ],
    spawnPoints: [
      { x: 220, y: 460 }, { x: 1060, y: 460 }, { x: 500, y: 640 }, { x: 780, y: 640 },
    ],
    dropRange: { min: 150, max: 1130 },
    accent: '#55483f',
  },
  {
    id: 'skyline',
    name: 'Skyline',
    solids: [{ x: 490, y: 620, w: 300, h: 100 }],
    platforms: [
      { x: 280, y: 520, w: 180, h: 12 },
      { x: 820, y: 520, w: 180, h: 12 },
      { x: 140, y: 400, w: 180, h: 12 },
      { x: 960, y: 400, w: 180, h: 12 },
      { x: 540, y: 300, w: 200, h: 12 },
    ],
    spawnPoints: [
      { x: 560, y: 620 }, { x: 720, y: 620 }, { x: 360, y: 520 }, { x: 900, y: 520 },
    ],
    dropRange: { min: 150, max: 1130 },
    accent: '#3f4a5c',
  },
];

export function getLevel(index) {
  return LEVELS[index] ?? LEVELS[0];
}
