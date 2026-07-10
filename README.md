# Stick Fight Web

A 2–4 player Stick Fight-style arena game for the browser. Colored stick
figures, guns raining from the sky, and last-man-standing rounds. One machine
runs the server, which both serves the game page and runs the authoritative
simulation; everyone else just opens a URL.

Punch or shoot the other sticks until you're the only one left — that's a
round. First to **5 rounds** wins the match. Guns parachute in every few
seconds; walk over one to grab it. Watch the bazooka: the blast hurts you too.

## Prerequisites

- [Node.js](https://nodejs.org) LTS (v18 or newer).

## Host a game

```sh
git clone https://github.com/Reece-Bunnage/web-brawler.git
cd web-brawler
npm install
npm start
```

The server prints `listening on http://localhost:3000`. Open that URL to play
on the host machine.

**Playing over LAN:** other players open `http://<host-LAN-IP>:3000`, where
`<host-LAN-IP>` is the host's local address — find it with `ipconfig getifaddr
en0` (macOS), `hostname -I` (Linux), or `ipconfig` (Windows). Use `PORT=8080
npm start` to pick a different port.

**Playing over the internet:** either forward the port on your router
(NAT/port-forwarding to the host machine), or use a tunnel such as
[ngrok](https://ngrok.com) (`ngrok http 3000`) and share the URL it prints.
Either way you are exposing a server on your machine to the internet — only
share the address with people you trust, and stop the server when you're done.

## Modes

- **Local** — two players share one keyboard in one browser. No network
  involved at all (the sim runs in the page), so it's also the quickest way to
  try the game.
- **Online** — 2–4 players connect to the host's URL, ready up in the lobby
  (colors are auto-assigned), and the host starts. The server runs the one
  true simulation; clients send inputs and render what the server broadcasts.

## Controls

**Local (two players, one keyboard):**

| Action | Player 1 | Player 2 |
|---|---|---|
| Move | A / D | ← / → |
| Aim up / down | W / S | ↑ / ↓ |
| Jump / double jump | Space | Enter |
| Punch / fire | F | . (period) |
| Drop through platform | S (on a platform) | ↓ (on a platform) |

Aim is 8-way from held direction keys; with nothing held you aim where you
face.

**Online:** move with A/D, jump with Space, drop with S — and **aim with the
mouse, click to fire** (F also works).

- Unarmed you punch; with a gun you shoot. Uzis spray while held, everything
  else fires per click/press.
- Touching a gun picks it up (and swaps out the one you had).
- F1 toggles the debug overlay.

## The arsenal

- **Pistol** — dependable semi-auto.
- **Uzi** — hold to hose, wide spray.
- **Shotgun** — five pellets, huge kick (the recoil moves *you* too).
- **Bazooka** — slow rocket, big boom, no friends.

## Development notes

- `npm test` runs the simulation test suite; `node test/online.test.js` runs a
  full lobby/match integration test against a real server process.
- The entire game simulation lives in `/shared` and runs identically in Node
  (online mode) and the browser (local mode) — including the seeded RNG for
  weapon drops, so replays are deterministic. The server serves `/shared` to
  the browser directly — no build step, no bundler, only dependency is `ws`.
- Tunables (physics, HP, weapon stats, round count) live in
  `shared/constants.js` and `shared/weapons.js`.
- This repo previously held a Smash-style brawler; that game is intact in git
  history (tag/browse commits before the "Stick Fight pivot" series).
