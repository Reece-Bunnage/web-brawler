// WebSocket client (instructions §10 Phases 9–11): lobby actions, input
// sending (on change + ~30 Hz keepalive), and snapshot buffering for the
// renderer's interpolation.

import { MSG, encode, decode, join, ready, setMode, startMatch, inputMsg }
  from '/shared/protocol.js';
import {
  SNAPSHOT_RATE, TICK_RATE, INTERP_MIN_MS, INTERP_MAX_MS, INTERP_GAP_MULT,
  INTERP_EASE_UP, INTERP_EASE_DOWN,
} from '/shared/constants.js';

// Seed for the adaptive interpolation delay before any gaps are measured
// (also the behavior of old builds: render a fixed 100 ms in the past).
export const INTERP_DELAY_MS = 100;
const SNAPSHOT_BUFFER_MAX = 60;
const GAP_WINDOW = 32;        // inter-arrival gaps kept for the p90 estimate
const GAP_CLAMP_MS = 250;     // one-off stalls don't poison the window

export class NetClient {
  constructor() {
    this.ws = null;
    this.yourId = null;
    this.snapshots = []; // [{ recvTime, tick, phase, fighters, ... }]
    this.interpDelay = INTERP_DELAY_MS; // adapts to measured snapshot jitter
    this._gaps = [];
    this._sizes = []; // recent snapshot payload sizes (bytes) for the overlay
    this._lastSnapTime = null;
    // Callbacks assigned by main.js.
    this.onLobby = null;
    this.onMatchStart = null;
    this.onMatchEnd = null;
    this.onError = null;
    this.onClose = null;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.addEventListener('message', (e) => this.handleMessage(e.data));
    this.ws.addEventListener('close', () => this.onClose?.());
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(e), { once: true });
    });
  }

  handleMessage(raw) {
    const msg = decode(raw);
    if (!msg) return;
    switch (msg.type) {
      case MSG.WELCOME:
        this.yourId = msg.yourId;
        break;
      case MSG.LOBBY_STATE:
        this.onLobby?.(msg);
        break;
      case MSG.MATCH_START:
        this.snapshots = [];
        this._gaps = [];
        this._sizes = [];
        this._lastSnapTime = null;
        this.interpDelay = INTERP_DELAY_MS;
        this.onMatchStart?.(msg);
        break;
      case MSG.SNAPSHOT: {
        const now = performance.now();
        this._sizes.push(raw.length ?? 0);
        if (this._sizes.length > GAP_WINDOW) this._sizes.shift();
        if (this._lastSnapTime != null) {
          this._gaps.push(Math.min(now - this._lastSnapTime, GAP_CLAMP_MS));
          if (this._gaps.length > GAP_WINDOW) this._gaps.shift();
          // Ease toward 2× the p90 arrival gap: tight (≈33 ms) on a clean
          // LAN, widening under jitter so the buffer never starves.
          // Asymmetric: a jitter spike raises the delay within ~100 ms
          // (starvation is visible chop), but recovery takes seconds
          // (a slightly stale view is invisible; oscillation is not).
          const target = Math.max(INTERP_MIN_MS,
            Math.min(INTERP_MAX_MS, INTERP_GAP_MULT * p90(this._gaps)));
          const ease = target > this.interpDelay ? INTERP_EASE_UP : INTERP_EASE_DOWN;
          this.interpDelay += (target - this.interpDelay) * ease;
        }
        this._lastSnapTime = now;
        this.snapshots.push({ ...msg, recvTime: now });
        if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) this.snapshots.shift();
        break;
      }
      case MSG.MATCH_END:
        this.onMatchEnd?.(msg);
        break;
      case MSG.ERROR:
        this.onError?.(msg.message);
        break;
    }
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  join(name) { this.send(join(name)); }
  setReady(isReady) { this.send(ready(isReady)); }
  setMode(modeId) { this.send(setMode(modeId)); }
  startMatch() { this.send(startMatch()); }

  // One seq-stamped input per local sim tick (60 Hz), driven by main.js's
  // accumulator. The seq is the prediction tick — the server echoes the last
  // one it applied back in snapshots as ackSeq.
  sendInputTick(seq, input) {
    this.send(inputMsg(seq, input));
  }

  // Arrival-rate + payload stats for the F2 overlay.
  getNetStats() {
    const gaps = this._gaps;
    const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const meanSize = this._sizes.length
      ? this._sizes.reduce((a, b) => a + b, 0) / this._sizes.length : 0;
    const rate = mean > 0 ? 1000 / mean : 0;
    return {
      snapRate: rate,
      meanGap: mean,
      p90Gap: gaps.length ? p90(gaps) : 0,
      interpDelay: this.interpDelay,
      snapKB: meanSize / 1024,
      netKBs: (meanSize * rate) / 1024,
    };
  }

  // Two snapshots bracketing (now - interpDelay) plus the blend factor,
  // timed by receive time (steady at a fixed snapshot rate).
  getInterpolationPair() {
    const buf = this.snapshots;
    if (buf.length === 0) return null;
    const renderTime = performance.now() - this.interpDelay;

    for (let i = buf.length - 1; i >= 1; i--) {
      const a = buf[i - 1];
      const b = buf[i];
      if (a.recvTime <= renderTime && renderTime <= b.recvTime) {
        const span = b.recvTime - a.recvTime;
        return { a, b, t: span > 0 ? (renderTime - a.recvTime) / span : 1 };
      }
    }
    // Behind the whole buffer (startup) → oldest; ahead (stall) → newest.
    const newest = buf[buf.length - 1];
    if (renderTime > newest.recvTime) return { a: newest, b: newest, t: 1 };
    return { a: buf[0], b: buf[0], t: 0 };
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}

function p90(sorted) {
  const s = [...sorted].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}
