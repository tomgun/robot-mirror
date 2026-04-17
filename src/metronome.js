export class Metronome {
  constructor({ bpm = 100, subdivision = 4 } = {}) {
    this.bpm = bpm;
    this.subdivision = subdivision; // accent every Nth beat
    this.ctx = null;
    this.master = null;
    this.handle = null;
    this.beatIndex = 0;
    this.volume = 0.2;
  }

  start() {
    if (this.handle) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.beatIndex = 0;
    const intervalMs = 60000 / this.bpm;
    // Fire first beat immediately so the start aligns cleanly
    this._tick();
    this.handle = setInterval(() => this._tick(), intervalMs);
  }

  stop() {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      this.master = null;
      setTimeout(() => { try { ctx.close(); } catch {} }, 200);
    }
  }

  _tick() {
    if (!this.ctx) return;
    const accent = this.beatIndex % this.subdivision === 0;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(accent ? 1200 : 700, t);
    osc.frequency.exponentialRampToValueAtTime(accent ? 550 : 400, t + 0.08);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(accent ? 1.0 : 0.55, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.15);

    this.beatIndex++;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
}
