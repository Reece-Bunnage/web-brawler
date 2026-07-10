// Level definitions — data-driven; the sim and renderer share these.
//
// Level shape:
// {
//   id, name,
//   width, height,              // world size in px (optional; defaults to STAGE view size)
//   solids:    [ {x,y,w,h} ],   // full-collision ground blocks (land/bonk/side-push)
//   platforms: [ {x,y,w,h} ],   // thin pass-through platforms (drop through with down)
//   hazards:   [ ... ],         // optional static hazards (see below)
//   spawnPoints: [ {x,y} ],     // FEET positions (y = where the hurtbox bottom goes)
//   dropRange: { min, max },    // x-range where guns fall from the sky
//   accent,                     // ground fill color
// }
//
// Hazard shapes (all optional; a level with no `hazards` behaves as before):
//   { type: 'saw',    x, y, r }        // spinning blade: center + radius; contact
//                                      //   deals damage + knockback radially away.
//   { type: 'bounce', x, y, w, h }     // pad resting on a surface: `y` is the pad's
//                                      //   TOP (align with the surface top it sits on);
//                                      //   walking/landing on it launches you upward.
//                                      //   `h` is cosmetic thickness only.
//
// Geometry rules of thumb (jumpVelocity -12, gravity 0.6): a single jump rises
// ~120px, jump + air jump ~240px. Keep vertical steps under those.

import { STAGE, BLAST_MARGIN } from './constants.js';

export const LEVELS = [
  {
    id: 'classic',
    name: 'Classic',
    solids: [{ x: 140, y: 600, w: 1000, h: 120 }],
    platforms: [
      { x: 280, y: 440, w: 220, h: 12 },
      { x: 780, y: 440, w: 220, h: 12 },
      { x: 540, y: 340, w: 200, h: 12 }, // center step up
      { x: 290, y: 250, w: 160, h: 12 }, // high corners
      { x: 830, y: 250, w: 160, h: 12 },
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
    height: 1080, // taller than the view — the camera pans vertically
    solids: [
      { x: 160, y: 700, w: 300, h: 380 }, // left tower (deadly gap between)
      { x: 820, y: 700, w: 300, h: 380 }, // right tower
    ],
    platforms: [
      { x: 540, y: 860, w: 200, h: 12 }, // stepping stone over the pit
      { x: 540, y: 580, w: 200, h: 12 }, // climb up the middle from the tops
      { x: 560, y: 440, w: 180, h: 12 },
      { x: 540, y: 300, w: 200, h: 12 }, // high perch
    ],
    spawnPoints: [
      { x: 260, y: 700 }, { x: 1020, y: 700 }, { x: 380, y: 700 }, { x: 900, y: 700 },
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
      { x: 240, y: 300, w: 120, h: 12 }, // upper ring
      { x: 920, y: 300, w: 120, h: 12 },
      { x: 590, y: 220, w: 120, h: 12 }, // top island
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
      { x: 230, y: 320, w: 180, h: 12 }, // rim climbs above the walls
      { x: 870, y: 320, w: 180, h: 12 },
      { x: 540, y: 300, w: 200, h: 12 }, // high center span
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
    height: 1080, // vertical cityscape — the camera pans up the towers
    solids: [
      { x: 120, y: 900, w: 220, h: 180 }, // left rooftop
      { x: 520, y: 820, w: 240, h: 260 }, // taller center building
      { x: 940, y: 900, w: 220, h: 180 }, // right rooftop
    ],
    platforms: [
      { x: 360, y: 760, w: 160, h: 12 }, // ledges between the buildings
      { x: 760, y: 760, w: 160, h: 12 },
      { x: 240, y: 620, w: 180, h: 12 },
      { x: 860, y: 620, w: 180, h: 12 },
      { x: 520, y: 540, w: 200, h: 12 },
      { x: 320, y: 400, w: 160, h: 12 },
      { x: 800, y: 400, w: 160, h: 12 },
      { x: 540, y: 280, w: 200, h: 12 }, // penthouse perch
    ],
    spawnPoints: [
      { x: 230, y: 900 }, { x: 1050, y: 900 }, { x: 560, y: 820 }, { x: 720, y: 820 },
    ],
    dropRange: { min: 150, max: 1130 },
    accent: '#3f4a5c',
  },
  {
    id: 'canyon',
    name: 'The Canyon',
    width: 2560,
    solids: [
      { x: 120, y: 560, w: 500, h: 160 },   // left mesa
      { x: 800, y: 640, w: 960, h: 80 },    // sunken canyon floor
      { x: 1230, y: 460, w: 100, h: 180 },  // center pillar (wall-jump post)
      { x: 1940, y: 560, w: 500, h: 160 },  // right mesa
    ],
    platforms: [
      { x: 640, y: 480, w: 140, h: 12 },    // bridges over the side gaps
      { x: 1780, y: 480, w: 140, h: 12 },
      { x: 1150, y: 330, w: 260, h: 12 },   // crow's nest above the pillar
      { x: 360, y: 360, w: 140, h: 12 },    // climb up the mesas
      { x: 2060, y: 360, w: 140, h: 12 },
      { x: 1200, y: 170, w: 160, h: 12 },   // lookout above the nest
    ],
    spawnPoints: [
      { x: 300, y: 560 }, { x: 2260, y: 560 }, { x: 1000, y: 640 }, { x: 1560, y: 640 },
    ],
    dropRange: { min: 200, max: 2360 },
    accent: '#54452f',
  },
  {
    id: 'sawmill',
    name: 'Sawmill',
    // Standard-size hazard arena: two floor saws flank a central bounce pad
    // that launches you to the high perch.
    solids: [{ x: 120, y: 620, w: 1040, h: 100 }],
    platforms: [
      { x: 250, y: 470, w: 200, h: 12 },
      { x: 830, y: 470, w: 200, h: 12 },
      { x: 540, y: 340, w: 200, h: 12 }, // high center (reach via bounce pad)
      { x: 300, y: 240, w: 160, h: 12 }, // upper catwalks
      { x: 820, y: 240, w: 160, h: 12 },
    ],
    hazards: [
      { type: 'saw', x: 470, y: 600, r: 32 },
      { type: 'saw', x: 810, y: 600, r: 32 },
      { type: 'bounce', x: 600, y: 620, w: 80, h: 14 },
    ],
    spawnPoints: [
      { x: 200, y: 620 }, { x: 1080, y: 620 }, { x: 340, y: 620 }, { x: 940, y: 620 },
    ],
    dropRange: { min: 200, max: 1080 },
    accent: '#4a4038',
  },
  {
    id: 'foundry',
    name: 'The Foundry',
    width: 2200,
    // Wide industrial floor split by two saw-topped divider walls; side bounce
    // pads fling you up onto the flanking platforms, a floor saw guards the
    // sunken middle.
    solids: [
      { x: 80, y: 600, w: 520, h: 120 },   // left ground
      { x: 900, y: 640, w: 400, h: 80 },   // sunken middle
      { x: 1600, y: 600, w: 520, h: 120 }, // right ground
      { x: 720, y: 460, w: 60, h: 260 },   // left divider wall
      { x: 1420, y: 460, w: 60, h: 260 },  // right divider wall
    ],
    platforms: [
      { x: 560, y: 470, w: 180, h: 12 },
      { x: 1460, y: 470, w: 180, h: 12 },
      { x: 980, y: 440, w: 240, h: 12 }, // center overpass
      { x: 300, y: 400, w: 160, h: 12 }, // side ascents
      { x: 1740, y: 400, w: 160, h: 12 },
      { x: 980, y: 250, w: 200, h: 12 }, // high gantry over the middle
    ],
    hazards: [
      { type: 'saw', x: 1100, y: 620, r: 34 }, // sunken-middle gate
      { type: 'saw', x: 750, y: 430, r: 30 },  // atop left wall
      { type: 'saw', x: 1450, y: 430, r: 30 }, // atop right wall
      { type: 'bounce', x: 300, y: 600, w: 90, h: 14 },
      { type: 'bounce', x: 1810, y: 600, w: 90, h: 14 },
    ],
    spawnPoints: [
      { x: 200, y: 600 }, { x: 2000, y: 600 }, { x: 960, y: 640 }, { x: 1240, y: 640 },
    ],
    dropRange: { min: 150, max: 2050 },
    accent: '#4a4038',
  },
  {
    id: 'gauntlet',
    name: 'The Gauntlet',
    width: 2560,
    // Longest map: a run of ledges across two pits, traversed by bounce pads,
    // with saws gating the approaches and the high central perch.
    solids: [
      { x: 60, y: 600, w: 420, h: 120 },    // left start
      { x: 700, y: 640, w: 300, h: 80 },    // pit ledge 1
      { x: 1180, y: 600, w: 240, h: 120 },  // central pillar
      { x: 1620, y: 640, w: 300, h: 80 },   // pit ledge 2
      { x: 2100, y: 600, w: 400, h: 120 },  // right end
    ],
    platforms: [
      { x: 500, y: 460, w: 160, h: 12 },
      { x: 1000, y: 420, w: 180, h: 12 },
      { x: 1440, y: 420, w: 180, h: 12 },
      { x: 1940, y: 460, w: 160, h: 12 },
      { x: 1180, y: 300, w: 240, h: 12 }, // high center perch
      { x: 300, y: 320, w: 150, h: 12 },  // tall end climbs
      { x: 2110, y: 320, w: 150, h: 12 },
      { x: 1200, y: 160, w: 200, h: 12 }, // summit above the perch
    ],
    hazards: [
      { type: 'bounce', x: 780, y: 640, w: 90, h: 14 },
      { type: 'bounce', x: 1700, y: 640, w: 90, h: 14 },
      { type: 'bounce', x: 1250, y: 600, w: 100, h: 14 }, // pillar → perch
      { type: 'saw', x: 600, y: 580, r: 30 },   // over pit 1
      { type: 'saw', x: 2000, y: 580, r: 30 },  // over pit 2
      { type: 'saw', x: 1180, y: 570, r: 32 },  // guards the pillar top
    ],
    spawnPoints: [
      { x: 160, y: 600 }, { x: 2400, y: 600 }, { x: 720, y: 640 }, { x: 1830, y: 640 },
    ],
    dropRange: { min: 150, max: 2400 },
    accent: '#3c4a4a',
  },
];

export function getLevel(index) {
  return LEVELS[index] ?? LEVELS[0];
}

// World size of a level; older levels omit width/height and get the view size.
export function worldSize(level) {
  return { width: level.width ?? STAGE.width, height: level.height ?? STAGE.height };
}

// Kill boundaries sit a fixed margin outside the level's world.
export function blastBounds(level) {
  const { width, height } = worldSize(level);
  return {
    left: -BLAST_MARGIN.side,
    right: width + BLAST_MARGIN.side,
    top: -BLAST_MARGIN.top,
    bottom: height + BLAST_MARGIN.bottom,
  };
}
