# Web Brawler — Build Instructions for Claude Code

A 2–4 player Smash-style platform brawler. The repo lives on GitHub; a single
machine runs `node server.js`, which **both** serves the browser client **and**
runs the authoritative game server. Other players connect to that machine's
address over LAN or the internet.

Build the phases **in order**. Each phase has acceptance criteria — do not move
to the next phase until the current one meets them. Prefer many small, testable
commits over large ones.

---

## 1. Goals & Scope

**In scope for v1:**
- 2–4 players, online over WebSockets.
- Local same-keyboard mode (2 players, one browser, no server needed) for fast testing.
- "Core Smash feel": light + heavy attacks, each with neutral/side/up/down variants; shield; dodge (spot / roll / air); a couple of platforms.
- Percentage-based damage with knockback that scales with damage taken.
- Stocks (lives). Fall past the blast zone = lose a stock. Last player standing wins.
- 3 distinct characters with different stats and move properties.

**Explicitly OUT of scope for v1 (note as future work, do not build):**
- Client-side prediction / rollback netcode. (See §11 — v1 uses interpolation only.)
- Items, multiple stages, gamepad support, matchmaking, persistence/accounts, sound design beyond simple cues.
- Mobile/touch controls.

---

## 2. Core Design Decisions (the "why")

Read this before writing code; it explains the constraints behind the structure.

1. **Transport-agnostic simulation core.** The whole game lives in one pure
   function, `stepGame(state, inputs, dt) → newState`, in `/shared`. It imports
   nothing environment-specific (no `ws`, no `document`, no `fs`). Online mode
   runs it on the server; local mode runs it in the browser. This lets us build
   and test the entire game locally before any networking exists.

2. **Server-authoritative for online play.** Clients send only *inputs*. The
   server holds the one true simulation and broadcasts *snapshots* of state.
   Clients render what they're told. This prevents desync and cheating. The cost
   is input latency, which we accept for v1 (fine on LAN / good connections).

3. **No lockstep determinism required.** Because exactly one machine runs the sim
   per mode (server for online, browser for local), we never compare two
   independent simulations, so we don't need bit-exact determinism. Keep the sim
   clean anyway (all state in the state object, no hidden globals).

4. **Fixed timestep.** Physics steps at a fixed 60 Hz using an accumulator, so
   behavior is identical regardless of frame timing. Network broadcast is
   decoupled and slower (30 Hz).

5. **Local mode is the primary dev path, not an afterthought.** Movement and
   combat are fully playable and testable in local mode before networking is
   touched. Networking is added last as a transport layer over a proven sim.

---

## 3. Tech Stack

- **Runtime:** Node.js (LTS). `"type": "module"` in `package.json` so ES modules
  work identically in Node and the browser.
- **Server:** built-in `http` for static file serving + the `ws` library for
  WebSockets. (Chosen over Socket.IO for a smaller, more educational surface. If
  reconnection/rooms prove painful, note it — do not swap without flagging.)
- **Client:** plain HTML/CSS/JS, HTML5 Canvas 2D for rendering. No build step, no
  bundler, no framework. Browser loads modules via `<script type="module">`.
- **Dependencies:** keep to just `ws`. Avoid adding others unless necessary.

---

## 4. Architecture

```
Browser (client)                         Node process (host machine)
┌───────────────────────┐                ┌──────────────────────────────┐
│ input.js  → inputs     │  ── ws ──▶     │ gameServer.js                 │
│ net.js    ← snapshots  │  ◀── ws ──     │  ├ runs stepGame() @60Hz      │
│ renderer.js (canvas)   │                │  └ broadcasts snapshot @30Hz  │
│ localGame.js (local)   │                │ room.js (lobby, players)      │
│   └ runs stepGame()    │                │ http static server            │
└───────────────────────┘                └──────────────────────────────┘
          ▲                                          ▲
          └──────────── /shared/simulation.js ───────┘
                  (same code runs in both places)
```

- Online: server owns `stepGame`. Client sends inputs, renders interpolated snapshots.
- Local: browser owns `stepGame` via `localGame.js`. Renders sim output directly (no interpolation needed — it's the live state).

---

## 5. Project Structure

```
/
├─ package.json
├─ server.js                 # entry: http static server + ws + game loop wiring
├─ README.md                 # host & play instructions (see §13)
├─ /shared                   # runs in BOTH node and browser — no env-specific imports
│  ├─ constants.js           # all tunable numbers (see §7)
│  ├─ characters.js          # character + move definitions (see §8)
│  ├─ simulation.js          # stepGame(state, inputs, dt) and helpers
│  └─ protocol.js            # message type constants + factory helpers (see §6)
├─ /server
│  ├─ room.js                # lobby/session state, player list, host
│  └─ gameServer.js          # per-room sim loop + snapshot broadcast
├─ /client
│  ├─ index.html
│  ├─ /css/style.css
│  └─ /js
│     ├─ main.js             # entry; mode select (online / local); wires everything
│     ├─ ui.js              # menus, lobby, character select, HUD, results
│     ├─ input.js           # keyboard → input objects (2 local players supported)
│     ├─ renderer.js        # canvas draw + snapshot interpolation
│     ├─ net.js             # ws connect, send inputs, receive/buffer snapshots
│     └─ localGame.js       # local loop running shared stepGame directly
```

The client folder is served statically by `server.js`. `/shared` must be
reachable by the browser too (serve it, or copy it under the served path — pick
one approach and document it).

---

## 6. Data Shapes & Protocol

Plain JS, so these are documented shapes (no TS). Keep them in comments and honor them.

**Input object (per player, per frame):**
```js
{
  left: bool, right: bool, up: bool, down: bool,
  jump: bool,        // edge-triggered in sim (track prev to detect press)
  light: bool,       // "
  heavy: bool,       // "
  shield: bool,      // held
  dodge: bool        // edge-triggered
}
```
The sim receives a map `{ [playerId]: inputObject }`. Attacks/jumps trigger on
the rising edge; the sim tracks previous input per fighter to detect edges.

**Fighter state (inside game state):**
```js
{
  id, characterId, facing: 1|-1,
  x, y, vx, vy,
  percent,           // damage %, starts 0
  stocks,
  onGround: bool,
  jumpsRemaining,
  state: 'idle'|'run'|'air'|'attack'|'shield'|'dodge'|'hitstun'|'ko'|'respawning',
  stateTimer,        // frames remaining in current state (for attacks, hitstun, i-frames)
  currentMove,       // move key when attacking, else null
  invulnFrames,      // >0 = ignore hits (dodge / respawn)
  shieldHealth
}
```

**Game state:**
```js
{ tick, phase: 'countdown'|'playing'|'ended', fighters: {...}, hitboxes: [...], events: [...] }
```
`events` is a per-tick list of transient things for the client to react to
(`{type:'hit', ...}`, `{type:'ko', id}`) — drained each broadcast.

**Message protocol (`protocol.js` exports type constants + builders):**

Client → Server:
- `JOIN { name }`
- `SELECT_CHARACTER { characterId }`
- `READY { ready: bool }`
- `START_MATCH {}`            (host only)
- `INPUT { seq, input }`      (send on change and/or at ~30Hz)

Server → Client:
- `WELCOME { yourId }`
- `LOBBY_STATE { players:[{id,name,characterId,ready}], hostId }`
- `MATCH_START { stageId, fighters:[...], yourId }`
- `SNAPSHOT { tick, fighters:[...], events:[...] }`
- `MATCH_END { winnerId, standings:[...] }`
- `ERROR { message }`

All messages are JSON: `{ type, ...payload }`.

---

## 7. Starting Constants (`shared/constants.js`)

All tunable — these are starting points, expect to adjust by feel. Units are
pixels and frames (60 fps). Put EVERY magic number here.

```js
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

// Combat
export const HITSTUN_PER_KNOCKBACK = 0.4; // frames of hitstun per unit knockback
export const SHIELD_MAX = 100;
export const SHIELD_REGEN = 0.3;          // per frame not shielding
export const SHIELD_DRAIN_HELD = 0.15;    // per frame while shielding
export const DODGE_IFRAMES = 18;
export const ROLL_IFRAMES = 14;
export const RESPAWN_IFRAMES = 90;
export const STOCKS = 3;
export const COUNTDOWN_FRAMES = 180;      // 3 seconds
```

---

## 8. Characters (`shared/characters.js`)

Three distinct fighters, data-driven. Each has base stats + a move table. A move
is defined once; the four directions (neutral/side/up/down) and two strengths
(light/heavy) give up to 8 moves. Fill in all 8 per character.

**Stat schema:**
```js
{
  id, name, color,
  weight,          // higher = less knockback taken (divides knockback)
  moveSpeed,       // max ground speed
  jumpVelocity,    // initial jump vy (negative)
  airJumps,        // extra mid-air jumps
  hurtbox: { w, h },
  moves: { lightNeutral:{...}, lightSide:{...}, ... heavyDown:{...} }
}
```

**Move schema:**
```js
{
  damage,              // % added to victim
  baseKnockback,
  knockbackScaling,    // multiplied by victim's percent
  angle,               // degrees, relative to facing (0 = forward, 90 = up)
  startup,             // frames before hitbox active
  active,              // frames hitbox is live
  recovery,            // frames after, locked
  hitbox: { offsetX, offsetY, w, h }, // relative to fighter, mirrored by facing
  canUseInAir: bool
}
```

**The three characters (design intent — tune the numbers):**
1. **Ranger** — balanced all-rounder. weight 1.0, moveSpeed 5, jumpVelocity -12, airJumps 1. Medium everything.
2. **Titan** — heavyweight bruiser. weight 1.4, moveSpeed 3.5, jumpVelocity -10.5, airJumps 1, bigger hurtbox. Slow startup, high damage/knockback, longer range.
3. **Sprite** — lightweight speedster. weight 0.7, moveSpeed 6.5, jumpVelocity -13, airJumps 2, small hurtbox. Fast low-commitment attacks, low damage/knockback (and flies far when hit — that's the tradeoff of low weight).

---

## 9. Combat Math

**Knockback (Smash-inspired, simplified):**
```
knockback = (move.baseKnockback + victim.percent * move.knockbackScaling) / victim.weight
```
Apply as a velocity impulse in `move.angle` (rotated by attacker facing):
```
vx = cos(angle) * knockback * facing
vy = -sin(angle) * knockback        // negative = up
```
Then set victim `state = 'hitstun'`, `stateTimer = knockback * HITSTUN_PER_KNOCKBACK`.
Higher percent ⇒ larger knockback ⇒ eventually launched past blast zone. This is
the core Smash feel — verify it works before polishing anything.

**Hit resolution each tick:**
1. Advance every attacker's move timers; a hitbox is "live" during `active` frames.
2. For each live hitbox vs each other fighter's hurtbox: AABB overlap = hit,
   unless victim is invulnerable, KO'd, or successfully shielding.
3. On hit: add `damage` to victim percent, apply knockback, spawn a `hit` event.
   A fighter can be hit only once per move activation (track hit fighters per move).

**Shield:** while `shield` held and `shieldHealth > 0`, state = 'shield', movement
locked, incoming hits deal no damage/knockback and drain shield by the hit's
damage. Empty shield ⇒ short break stun. Regenerates when not shielding.

**Dodge (edge-triggered):**
- No direction held ⇒ **spot dodge**: `DODGE_IFRAMES` i-frames in place.
- Left/right held ⇒ **roll**: move that direction with `ROLL_IFRAMES` i-frames.
- In air ⇒ **air dodge**: i-frames + small directional burst, once per airtime.

**KO / stocks:** if a fighter's position passes any BLAST bound, decrement stocks,
spawn `ko` event. If stocks remain, respawn at a spawn point, percent → 0,
`RESPAWN_IFRAMES` of invulnerability. If stocks hit 0, they're out. Last fighter
with stocks wins ⇒ phase = 'ended'.

---

## 10. Build Phases (do in order)

### Phase 0 — Scaffold
- `package.json` (`type: module`, `ws` dependency, `start` script).
- `server.js`: serve `/client` statically over `http`; open a `ws` server on the
  same port; log connections and echo a test message.
- **Accept:** `node server.js` runs; opening the served page in a browser connects
  the socket and the server logs it.

### Phase 1 — Shared constants & characters
- Implement `constants.js` and `characters.js` per §7–§8 (all 3 characters, all moves).
- **Accept:** files import cleanly in both Node and browser; no missing move keys.

### Phase 2 — Simulation core: movement & platforms
- `simulation.js`: `createInitialState(fighters)`, `stepGame(state, inputs, dt)`.
- Implement gravity, ground/air accel + friction, jumping + air jumps, facing.
- Stage = a floor plus 2 pass-through platforms (jump up through, land on top,
  drop through by holding down). AABB collision against solid surfaces.
- No combat yet.
- **Accept:** unit-drivable — feeding inputs produces sensible position changes;
  fighters land on platforms and can drop through.

### Phase 3 — Input
- `input.js`: keyboard → input objects. Support **two local players** on one
  keyboard (P1 WASD + nearby keys, P2 arrows + nearby keys — see §12). Emit the
  input-object shape from §6. Track edges where the sim expects them.
- **Accept:** pressing keys toggles the right fields for both players.

### Phase 4 — Renderer
- `renderer.js`: draw stage, platforms, fighters (colored capsule/rect with a
  facing indicator), and a HUD (each player's %, stocks). Given a game state,
  draw it. Add a debug toggle to draw hitboxes/hurtboxes.
- **Accept:** a static/hand-made state renders correctly on canvas.

### Phase 5 — Local mode (movement playable)
- `localGame.js`: fixed-timestep loop (accumulator) running `stepGame` with local
  inputs; render each frame with `renderer.js`. `main.js`/`ui.js`: a start menu
  with "Local" that goes to character select then into a match.
- **Accept:** two players run, jump, double-jump, and traverse platforms locally,
  smoothly, at a stable 60 Hz sim.

### Phase 6 — Combat (still local)
- Add to `simulation.js`: attack states (startup/active/recovery), hitbox spawning
  per move, hit detection, damage %, knockback (§9), hitstun, KO/blast zones,
  stocks, respawn with i-frames.
- Render HUD % + stocks live; use hitbox debug overlay to verify.
- **Accept:** two players can damage each other; higher % launches farther;
  falling past blast zone costs a stock and respawns; running out ends the match.

### Phase 7 — Shield & dodge (still local)
- Implement shield (drain/regen/break) and the three dodge types with i-frames.
- **Accept:** shielding blocks hits and drains; dodges grant brief invulnerability;
  states feel distinct and can't be exploited to move-lock forever.

### Phase 8 — Match flow (still local)
- Countdown → playing → ended; results screen with winner/standings; rematch.
- **Accept:** a full local match plays start-to-finish and can be replayed.

> At this point the **entire game is playable and tuned in local mode with zero
> networking.** Only now add the network layer.

### Phase 9 — Rooms & lobby (server)
- `room.js`: one room per server instance (v1), tracks players (id, name,
  character, ready), assigns the first joiner as host, caps at 4.
- Handle `JOIN`, `SELECT_CHARACTER`, `READY`, `START_MATCH`; broadcast `LOBBY_STATE`.
- `net.js` + `ui.js`: "Online" menu path — connect, name, character select,
  ready-up, host sees a Start button.
- **Accept:** 2–4 browsers connect to one server, pick characters, ready up; host
  starts; everyone receives `MATCH_START`.

### Phase 10 — Online game loop (server)
- `gameServer.js`: on match start, build initial state and run `stepGame` at
  60 Hz (accumulator). Apply the latest `INPUT` per player each tick. Broadcast
  `SNAPSHOT` (fighters + drained events) at 30 Hz. Send `MATCH_END` on end.
- Client `net.js`: send `INPUT` on change / ~30 Hz; buffer incoming snapshots.
- **Accept:** server logs a running match; snapshots flow; inputs reach the server.

### Phase 11 — Client interpolation & online rendering
- Client renders ~100 ms behind the latest snapshot, interpolating fighter
  positions between the two bracketing snapshots for smoothness. Play `events`
  (hit/ko) as one-shot visual cues when they arrive.
- **Accept:** a full 2–4 player online match is smooth and playable across
  machines; percent/stocks/KOs display correctly for all clients.

### Phase 12 — Polish & README
- Respawn platform/effect, simple hit flash, disconnection handling (remove
  player / end match gracefully), and the README in §13.
- **Accept:** a stranger can clone the repo and get a game running from the README alone.

---

## 11. Networking Details & Rationale

- **Server-authoritative:** clients never move themselves; they display snapshots.
- **Interpolation, not prediction:** clients render slightly in the past and
  interpolate. This means your own inputs feel a touch delayed — acceptable for
  v1. Do NOT attempt rollback/prediction; leave a `// FUTURE:` note where it'd go.
- **Input handling:** server uses the most recent input per player each tick; if a
  packet is missed, the last known input persists (no stall). Include a `seq` so
  stale/out-of-order inputs can be dropped.
- **Snapshot size:** send only what the client needs to render (ids, x, y, facing,
  percent, stocks, state, plus events). Round floats if it helps.
- **One room per server for v1.** Structure `room.js` so multiple rooms could be
  added later, but don't build lobby codes/matchmaking now.

---

## 12. Controls (default; keep remappable-friendly)

Local 2-player on one keyboard:

| Action | Player 1 | Player 2 |
|---|---|---|
| Move | A / D | ← / → |
| Up / Down | W / S | ↑ / ↓ |
| Jump | Space | Enter |
| Light | F | . (period) |
| Heavy | G | / (slash) |
| Shield | Left Shift | Right Shift |
| Dodge | C | ' (quote) |

Online: each client uses the Player 1 layout for their own fighter.

---

## 13. README Requirements

The README must let a non-author host and play. Include:
- Prerequisites (Node LTS).
- `git clone`, `npm install`, `npm start`.
- How to find the host's play URL (`http://<host-LAN-IP>:<port>`).
- One paragraph on internet play: port-forwarding **or** a tunnel (e.g. ngrok),
  with the caveat that this exposes a local server.
- Controls table and how to start a match (host readies + Start).
- A short "Modes" note explaining Local vs Online.

---

## 14. Coding Conventions & Notes for Claude Code

- ES modules everywhere; `/shared` imports nothing from `/server` or `/client`
  and uses no Node- or browser-only APIs.
- All state lives in the state object passed through `stepGame`. No hidden module
  globals affecting simulation.
- Every tunable number lives in `constants.js`. No magic numbers scattered in logic.
- Keep functions small and named for what they do (`applyGravity`, `resolvePlatformCollision`, `spawnHitbox`, `applyKnockback`).
- Comment the *why* on any non-obvious physics/combat choice.
- Commit at each phase's acceptance checkpoint.
- If a design point here proves wrong in practice (e.g. `ws` rooms get painful,
  a constant feels bad), leave a clear `// NOTE:` and keep going — don't silently
  redesign the architecture.

---

## 15. Future Work (do NOT build in v1)

Rollback/prediction netcode · items · multiple stages · gamepad support · sound
design · matchmaking/room codes · accounts/persistence · mobile controls · more
characters. Leave the code open to these but out of scope now.
