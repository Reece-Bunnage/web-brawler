# Web Brawler

A 2–4 player Smash-style platform brawler for the browser. One machine runs the
server, which both serves the game page and runs the authoritative simulation;
everyone else just opens a URL.

Rack up your opponents' damage percent — the higher it gets, the farther they
fly. Knock them past the edge of the screen to take a stock. Last fighter with
stocks wins.

## Prerequisites

- [Node.js](https://nodejs.org) LTS (v18 or newer).

## Host a game

```sh
git clone <this-repo-url>
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
- **Online** — 2–4 players connect to the host's URL. The server runs the one
  true simulation; clients send inputs and render what the server broadcasts.

## Starting an online match

1. Everyone opens the host URL, clicks **Online**, and enters a name.
2. Pick a character and click **Ready**.
3. The first person who joined is the host; once 2–4 players are all ready,
   the host's **Start Match** button lights up.

## Controls

| Action | Player 1 (and online) | Player 2 (local only) |
|---|---|---|
| Move | A / D | ← / → |
| Up / Down | W / S | ↑ / ↓ |
| Jump | Space | Enter |
| Light attack | F | . (period) |
| Heavy attack | G | / (slash) |
| Shield | Left Shift | Right Shift |
| Dodge | C | ' (quote) |

- Attacks combine with a held direction: neutral, side, up, or down variants.
- Dodge alone = spot dodge; dodge + direction = roll; dodge in the air = air
  dodge (once per airtime).
- Hold down on a thin platform to drop through it.
- F1 toggles the hitbox debug overlay.

## The fighters

- **Ranger** — balanced all-rounder.
- **Titan** — slow heavyweight; huge, hard-hitting attacks, hard to launch.
- **Sprite** — fast and floaty with a triple jump; hits softly and flies far.

## Development notes

- `npm test` runs the simulation test suite; `node test/online.test.js` runs a
  full lobby/match integration test against a real server process.
- The entire game simulation lives in `/shared` and runs identically in Node
  (online mode) and the browser (local mode). The server serves `/shared` to
  the browser directly — no build step, no bundler, only dependency is `ws`.
- Tunables (physics, knockback, timings) all live in `shared/constants.js`.
