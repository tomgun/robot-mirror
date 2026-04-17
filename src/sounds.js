// Shared AudioContext + synthesized drums, stabs, and speech encouragement.

let sharedCtx = null;
let sharedMaster = null;

function ensureCtx() {
  if (sharedCtx) return sharedCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  sharedCtx = new Ctor();
  sharedMaster = sharedCtx.createGain();
  sharedMaster.gain.value = 0.5;
  sharedMaster.connect(sharedCtx.destination);
  return sharedCtx;
}

function makeNoiseBuffer(ctx, durationSec) {
  const len = Math.floor(ctx.sampleRate * durationSec);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// --- Drum voices ---------------------------------------------------
function kick(ctx, master, t, gain = 0.9) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.35);
}

function snare(ctx, master, t, gain = 0.5) {
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 0.18);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  noise.connect(filter).connect(g).connect(master);
  noise.start(t);
  noise.stop(t + 0.2);

  const tone = ctx.createOscillator();
  const tg = ctx.createGain();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(220, t);
  tone.frequency.exponentialRampToValueAtTime(160, t + 0.1);
  tg.gain.setValueAtTime(0.35, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  tone.connect(tg).connect(master);
  tone.start(t);
  tone.stop(t + 0.14);
}

function hat(ctx, master, t, accent = false, open = false) {
  const dur = open ? 0.22 : 0.045;
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, dur);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = open ? 6000 : 7500;
  const g = ctx.createGain();
  const peak = accent ? 0.22 : 0.1;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  noise.connect(filter).connect(g).connect(master);
  noise.start(t);
  noise.stop(t + dur + 0.02);
}

function clap(ctx, master, t) {
  const mk = (offset, gain) => {
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 0.08);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1500;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t + offset);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.1);
    noise.connect(filter).connect(g).connect(master);
    noise.start(t + offset);
    noise.stop(t + offset + 0.12);
  };
  mk(0, 0.3);
  mk(0.015, 0.35);
  mk(0.03, 0.4);
}

// --- Drum machine --------------------------------------------------
export class DrumMachine {
  constructor({ bpm = 100, groove = "house" } = {}) {
    this.bpm = bpm;
    this.groove = groove;
    this.running = false;
    this.step = 0;
    this.nextStepTime = 0;
    this._tickHandle = null;
  }

  start() {
    if (this.running) return;
    const ctx = ensureCtx();
    try { ctx.resume(); } catch {}
    this.running = true;
    this.step = 0;
    this.nextStepTime = ctx.currentTime + 0.08;
    this._tickHandle = setInterval(() => this._scheduler(), 25);
    this._scheduler();
  }

  stop() {
    this.running = false;
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }

  _scheduler() {
    if (!sharedCtx) return;
    const stepDur = 60 / this.bpm / 4; // 16th notes
    const lookahead = 0.12;
    while (this.nextStepTime < sharedCtx.currentTime + lookahead) {
      this._scheduleStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % 16;
      this.nextStepTime += stepDur;
    }
  }

  _scheduleStep(step, t) {
    if (!sharedCtx) return;
    const beat = Math.floor(step / 4);
    const sub = step % 4;

    if (this.groove === "chill") {
      // Slower backbeat, soft hats on odd 8ths
      if (sub === 0 && (beat === 0 || beat === 2)) kick(sharedCtx, sharedMaster, t, 0.75);
      if (sub === 0 && (beat === 1 || beat === 3)) snare(sharedCtx, sharedMaster, t, 0.4);
      if (sub === 0 || sub === 2) hat(sharedCtx, sharedMaster, t, sub === 0, false);
      if (step === 14) hat(sharedCtx, sharedMaster, t, false, true);
      return;
    }

    // default "house"
    // Four-on-the-floor kick (downbeat of each beat)
    if (sub === 0) kick(sharedCtx, sharedMaster, t);
    // Clap on beats 2 and 4
    if (sub === 0 && (beat === 1 || beat === 3)) clap(sharedCtx, sharedMaster, t);
    // Hats on every 8th note, accent on downbeat
    if (sub === 0 || sub === 2) hat(sharedCtx, sharedMaster, t, sub === 0, false);
    // Open hat off-beat in bar 2
    if (step === 14) hat(sharedCtx, sharedMaster, t, false, true);
  }
}

// --- Accent sounds -------------------------------------------------
export function playHitChime(level = 1) {
  const ctx = ensureCtx();
  try { ctx.resume(); } catch {}
  const t = ctx.currentTime;
  const base = [523.25, 659.25, 783.99, 1046.5, 1318.5][Math.min(level - 1, 4)] || 523.25;
  const chord = [base, base * 1.25, base * 1.5];
  for (let i = 0; i < chord.length; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(chord[i], t);
    g.gain.setValueAtTime(0.0001, t + i * 0.01);
    g.gain.exponentialRampToValueAtTime(0.2, t + i * 0.01 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(sharedMaster);
    osc.start(t + i * 0.01);
    osc.stop(t + 0.3);
  }
}

export function playComboStab(combo) {
  const ctx = ensureCtx();
  try { ctx.resume(); } catch {}
  const t = ctx.currentTime;
  const root = 440 * Math.pow(2, Math.min(combo, 12) / 12);
  const chord = [root, root * 5 / 4, root * 3 / 2, root * 2];
  for (let i = 0; i < chord.length; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = i === 0 ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(chord[i], t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(g).connect(sharedMaster);
    osc.start(t);
    osc.stop(t + 0.8);
  }
  // whoosh sweep
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 0.4);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(600, t);
  filter.frequency.exponentialRampToValueAtTime(5000, t + 0.35);
  filter.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  noise.connect(filter).connect(g).connect(sharedMaster);
  noise.start(t);
  noise.stop(t + 0.45);
}

export function playMissThud() {
  const ctx = ensureCtx();
  try { ctx.resume(); } catch {}
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  osc.connect(g).connect(sharedMaster);
  osc.start(t);
  osc.stop(t + 0.3);
}

// --- Speech encouragement -----------------------------------------
let cachedVoices = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  if (cachedVoices === voices) return cachedVoices.picked;
  const preferred = voices.find((v) => /samantha|victoria|karen|susan|serena|allison|ava/i.test(v.name))
    || voices.find((v) => /female/i.test(v.name))
    || voices.find((v) => v.lang.startsWith("en"))
    || voices[0];
  cachedVoices = voices;
  cachedVoices.picked = preferred;
  return preferred;
}

export function speak(text, { rate = 1.05, pitch = 1.15, volume = 0.95 } = {}) {
  if (!("speechSynthesis" in window)) return;
  try { window.speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.pitch = pitch;
  u.volume = volume;
  const v = pickVoice();
  if (v) u.voice = v;
  try { window.speechSynthesis.speak(u); } catch {}
}

// Ensure voices are populated early on some browsers
if ("speechSynthesis" in window) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => { cachedVoices = null; };
  } catch {}
}
