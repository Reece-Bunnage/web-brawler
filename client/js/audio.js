// Procedural sound effects (Web Audio). No asset files — every sound is
// synthesized from oscillators and filtered noise. Hybrid palette: retro
// melodic cues for pickups/countdown/round stings, punchy noise+boom for
// combat.
//
// It consumes the SAME event stream the renderer does (addEvent), plus a
// per-frame update(state) for continuous/stateful sounds (the sniper charge
// whine and the countdown beeps). Audio is client-only, so nothing here can
// affect the sim or desync online.

import { WEAPONS } from '/shared/weapons.js';
import { TICK_RATE } from '/shared/constants.js';

const SNIPER_CHARGE = WEAPONS.sniper.chargeFrames;
const STORE_KEY = 'brawler.audio';

export class AudioManager {
  constructor() {
    this.ctx = null;          // created lazily on first user gesture
    this.master = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.volume = 0.5;
    this._lastPlay = new Map(); // throttle key → ctx time
    this._whine = null;         // active sniper-charge oscillator
    this._lastCountSec = null;  // last countdown second beeped

    // Restore saved preferences.
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (typeof saved.muted === 'boolean') this.muted = saved.muted;
      if (typeof saved.volume === 'number') this.volume = saved.volume;
    } catch { /* ignore */ }
  }

  // Browsers block audio until a user gesture; call this from the first
  // keydown/pointerdown. Idempotent — also resumes a suspended context.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this._makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
    this._persist();
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
    this._persist();
  }

  _persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume })); }
    catch { /* ignore */ }
  }

  // --- Event → sound ---------------------------------------------------------

  addEvent(ev) {
    if (!this.ctx || this.muted) return;
    switch (ev.type) {
      case 'shot': this._shot(ev); break;
      case 'punch': this._punch(); break;
      case 'hit': this._hit(); break;
      case 'explosion': this._explosion(ev); break;
      case 'death': this._death(); break;
      case 'jump': this._jump(ev); break;
      case 'dash': this._dash(); break;
      case 'bounce': this._bounce(); break;
      case 'pickup': this._pickup(); break;
      case 'ladderUp': this._pickup(); break;
      case 'respawn': this._respawn(); break;
      case 'bombArm': this._bombPass(); break;
      case 'bombPass': this._bombPass(); break;
      case 'bombExplode': this._explosion({ radius: 90 }); break;
      case 'saberSwing': this._saberSwing(); break;
      case 'saberClash': this._saberClash(); break;
      case 'roundStart': this._go(); break;
      case 'roundEnd': this._roundEnd(); break;
      case 'matchEnd': this._matchEnd(); break;
    }
  }

  // Continuous / stateful sounds, driven each rendered frame.
  update(state) {
    if (!this.ctx || this.muted || !state) { this._stopWhine(); return; }
    this._updateWhine(state);
    this._updateCountdown(state);
  }

  // --- Combat ----------------------------------------------------------------

  _shot(ev) {
    switch (ev.weaponId) {
      case 'pistol':
        this._tone({ freq: 240, freqEnd: 90, type: 'square', decay: 0.09, gain: 0.28 });
        this._noise({ duration: 0.05, type: 'highpass', freq: 1800, gain: 0.18 });
        break;
      case 'uzi':
        if (!this._throttle('uzi', 0.045)) return;
        this._tone({ freq: 330, freqEnd: 160, type: 'square', decay: 0.05, gain: 0.16 });
        break;
      case 'shotgun':
        this._noise({ duration: 0.18, type: 'lowpass', freq: 2200, freqEnd: 400, gain: 0.4 });
        this._tone({ freq: 110, freqEnd: 50, type: 'sine', decay: 0.16, gain: 0.35 });
        break;
      case 'bazooka':
        this._noise({ duration: 0.28, type: 'bandpass', freq: 500, freqEnd: 1600, q: 1.2, gain: 0.3 });
        this._tone({ freq: 160, freqEnd: 70, type: 'sawtooth', decay: 0.25, gain: 0.22 });
        break;
      case 'grenade':
        this._tone({ freq: 520, freqEnd: 300, type: 'triangle', decay: 0.12, gain: 0.2 });
        break;
      case 'sniper':
        this._stopWhine();
        // Sharp crack; a full charge cracks harder and lower.
        this._noise({ duration: ev.charged ? 0.22 : 0.12, type: 'highpass', freq: 2600, gain: ev.charged ? 0.5 : 0.32 });
        this._tone({ freq: ev.charged ? 900 : 700, freqEnd: 120, type: 'square', decay: ev.charged ? 0.22 : 0.12, gain: ev.charged ? 0.4 : 0.28 });
        if (ev.charged) this._tone({ freq: 70, freqEnd: 40, type: 'sine', decay: 0.3, gain: 0.35 });
        break;
      default:
        this._tone({ freq: 220, freqEnd: 110, type: 'square', decay: 0.08, gain: 0.22 });
    }
  }

  _punch() {
    this._noise({ duration: 0.06, type: 'lowpass', freq: 900, gain: 0.22 });
    this._tone({ freq: 180, freqEnd: 90, type: 'triangle', decay: 0.07, gain: 0.18 });
  }

  _hit() {
    if (!this._throttle('hit', 0.03)) return;
    this._tone({ freq: 620, freqEnd: 300, type: 'square', decay: 0.045, gain: 0.2 });
    this._noise({ duration: 0.03, type: 'highpass', freq: 2000, gain: 0.14 });
  }

  _explosion(ev) {
    const power = Math.min(1.4, (ev.radius ?? 75) / 75);
    this._noise({ duration: 0.42, type: 'lowpass', freq: 1600, freqEnd: 200, gain: 0.5 * power });
    this._tone({ freq: 90, freqEnd: 38, type: 'sine', decay: 0.4, gain: 0.45 * power });
    this._tone({ freq: 150, freqEnd: 60, type: 'sawtooth', decay: 0.25, gain: 0.2 * power });
  }

  _death() {
    // Downward "wah" splat.
    this._tone({ freq: 400, freqEnd: 70, type: 'sawtooth', decay: 0.4, gain: 0.3 });
    this._noise({ duration: 0.22, type: 'lowpass', freq: 1200, freqEnd: 300, gain: 0.3 });
  }

  // --- Movement --------------------------------------------------------------

  _jump(ev) {
    this._tone({ freq: ev.air ? 420 : 300, freqEnd: ev.air ? 680 : 520, type: 'square', decay: 0.09, gain: 0.16 });
  }

  _dash() {
    this._noise({ duration: 0.12, type: 'bandpass', freq: 700, freqEnd: 2400, q: 1.5, gain: 0.22 });
  }

  _bounce() {
    // Springy boing: quick pitch up then settle.
    this._tone({ freq: 260, freqEnd: 720, type: 'triangle', attack: 0.005, decay: 0.14, gain: 0.28 });
  }

  // --- Pickups & flow (retro melodic cues) -----------------------------------

  _pickup() {
    this._tone({ freq: 523, type: 'square', decay: 0.08, gain: 0.2 });          // C5
    this._tone({ freq: 784, type: 'square', decay: 0.1, gain: 0.2, t: 0.07 });  // G5
  }

  _respawn() {
    // Rising shimmer: back in the fight.
    this._tone({ freq: 392, freqEnd: 784, type: 'triangle', decay: 0.16, gain: 0.2 });
  }

  _bombPass() {
    // Ominous low blip — the bomb changed hands (or just armed).
    this._tone({ freq: 220, freqEnd: 140, type: 'sawtooth', decay: 0.12, gain: 0.24 });
    this._tone({ freq: 660, type: 'square', decay: 0.05, gain: 0.14 });
  }

  _saberSwing() {
    // Rising whoosh with a faint harmonic hum under it.
    this._noise({ duration: 0.14, type: 'bandpass', freq: 320, freqEnd: 1300, q: 2.5, gain: 0.3 });
    this._tone({ freq: 110, freqEnd: 170, type: 'sawtooth', decay: 0.12, gain: 0.1 });
  }

  _saberClash() {
    // Electric crack: bright zap, sizzle, and a low body thump.
    this._tone({ freq: 1400, freqEnd: 200, type: 'sawtooth', decay: 0.22, gain: 0.32 });
    this._noise({ duration: 0.18, type: 'highpass', freq: 2800, gain: 0.3 });
    this._tone({ freq: 95, freqEnd: 50, type: 'sine', decay: 0.25, gain: 0.3 });
  }

  _go() {
    this._lastCountSec = null;
    this._tone({ freq: 880, type: 'square', decay: 0.28, gain: 0.3 });          // A5, longer
  }

  _roundEnd() {
    [523, 659, 784].forEach((f, i) => this._tone({ freq: f, type: 'square', decay: 0.16, gain: 0.22, t: i * 0.1 }));
  }

  _matchEnd() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone({ freq: f, type: 'square', decay: 0.22, gain: 0.24, t: i * 0.12 }));
  }

  // --- Continuous ------------------------------------------------------------

  _updateWhine(state) {
    let maxCharge = 0;
    for (const f of Object.values(state.fighters ?? {})) {
      if (f.weaponId === 'sniper') maxCharge = Math.max(maxCharge, f.chargeFrames ?? 0);
    }
    if (maxCharge > 0) {
      const ratio = Math.min(1, maxCharge / SNIPER_CHARGE);
      const freq = 300 + ratio * 700;
      const now = this.ctx.currentTime;
      if (!this._whine) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        g.gain.value = 0.0001;
        osc.connect(g).connect(this.master);
        osc.start();
        g.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
        this._whine = { osc, g };
      }
      this._whine.osc.frequency.setTargetAtTime(freq, now, 0.02);
    } else {
      this._stopWhine();
    }
  }

  _stopWhine() {
    if (!this._whine) return;
    const now = this.ctx.currentTime;
    const { osc, g } = this._whine;
    g.gain.setTargetAtTime(0.0001, now, 0.03);
    osc.stop(now + 0.12);
    this._whine = null;
  }

  _updateCountdown(state) {
    if (state.phase === 'countdown') {
      const sec = Math.ceil((state.countdownTimer ?? 0) / TICK_RATE);
      if (sec !== this._lastCountSec && sec > 0) {
        this._lastCountSec = sec;
        this._tone({ freq: 440, type: 'square', decay: 0.12, gain: 0.22 });
      }
    } else {
      this._lastCountSec = null;
    }
  }

  // --- Synthesis primitives --------------------------------------------------

  _tone({ freq, freqEnd, type = 'square', attack = 0.005, decay = 0.1, gain = 0.3, t = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const end = t0 + attack + decay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), end);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(end + 0.02);
  }

  _noise({ duration = 0.15, type = 'lowpass', freq = 1000, freqEnd, q = 1, gain = 0.3, t = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const end = t0 + duration;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), end);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(end + 0.02);
  }

  _makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _throttle(key, gapSec) {
    const now = this.ctx.currentTime;
    const last = this._lastPlay.get(key) ?? -1;
    if (now - last < gapSec) return false;
    this._lastPlay.set(key, now);
    return true;
  }
}
