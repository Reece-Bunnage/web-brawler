// WebSocket client (instructions §10 Phases 9–11): lobby actions, input
// sending (on change + ~30 Hz keepalive), and snapshot buffering for the
// renderer's interpolation.

import { MSG, encode, decode, join, ready, setMode, startMatch, inputMsg }
  from '/shared/protocol.js';
import { SNAPSHOT_RATE, TICK_RATE } from '/shared/constants.js';

const INPUT_SEND_MS = 1000 / 30;
// Render this far in the past so there are always two snapshots to
// interpolate between (~3 snapshot intervals at 30 Hz ≈ 100 ms, §11).
export const INTERP_DELAY_MS = 100;
const SNAPSHOT_BUFFER_MAX = 30;

export class NetClient {
  constructor() {
    this.ws = null;
    this.yourId = null;
    this.seq = 0;
    this.lastSentInput = null;
    this.lastSendTime = 0;
    this.snapshots = []; // [{ recvTime, tick, phase, fighters, ... }]
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
        this.seq = 0;
        this.lastSentInput = null;
        this.onMatchStart?.(msg);
        break;
      case MSG.SNAPSHOT:
        this.snapshots.push({ ...msg, recvTime: performance.now() });
        if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) this.snapshots.shift();
        break;
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

  // Call every render frame with the current local input; sends on change and
  // as a ~30 Hz keepalive so the server always has a recent input (§11).
  sendInput(input) {
    const now = performance.now();
    const serialized = JSON.stringify(input);
    if (serialized !== this.lastSentInput || now - this.lastSendTime >= INPUT_SEND_MS) {
      this.send(inputMsg(this.seq++, input));
      this.lastSentInput = serialized;
      this.lastSendTime = now;
    }
  }

  // Two snapshots bracketing (now - INTERP_DELAY_MS) plus the blend factor,
  // timed by receive time (steady at a fixed snapshot rate).
  getInterpolationPair() {
    const buf = this.snapshots;
    if (buf.length === 0) return null;
    const renderTime = performance.now() - INTERP_DELAY_MS;

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
