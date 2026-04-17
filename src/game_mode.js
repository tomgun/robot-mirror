const GESTURES = [
  "Open_Palm",
  "Closed_Fist",
  "Victory",
  "Thumb_Up",
  "Pointing_Up",
];

const HIT_WINDOW_MS = 250;
const TRAVEL_MS = 2500;
const SPAWN_INTERVAL_MS = 1400;
const DURATION_MS = 45000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GestureGame extends EventTarget {
  constructor({ stage, laneX = 0 } = {}) {
    super();
    this.stage = stage;
    this.laneX = laneX;
    this.active = false;
    this.cues = []; // { id, gesture, hitAt, scored, result }
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.duration = DURATION_MS;
    this._tickHandle = null;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  start({ seed, startAt, duration = DURATION_MS } = {}) {
    if (this.active) return;
    this.active = true;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.cues = [];
    this.duration = duration;
    this.t0 = startAt || performance.now();
    this.rng = mulberry32(seed ?? Math.floor(Math.random() * 0xffffffff));
    this.nextSpawnAt = this.t0 + 1500;

    this.stage.showHitLine(true);
    this._tickHandle = setInterval(() => this._tick(), 40);
    this._emit("update", { score: 0, combo: 0, timeLeft: this.duration });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearInterval(this._tickHandle);
    this._tickHandle = null;
    this.stage.showHitLine(false);
    for (const cue of this.cues) {
      this.stage.destroyCue(cue.id);
    }
    this.cues = [];
    this._emit("end", { score: this.score, maxCombo: this.maxCombo });
  }

  _tick() {
    const now = performance.now();
    const elapsed = now - this.t0;
    const timeLeft = Math.max(0, this.duration - elapsed);

    if (elapsed > this.duration) {
      this.stop();
      return;
    }

    // Spawn cues whose spawn time has come — but only if enough time left for travel
    while (this.nextSpawnAt <= now && this.nextSpawnAt + TRAVEL_MS <= this.t0 + this.duration) {
      const gesture = GESTURES[Math.floor(this.rng() * GESTURES.length)];
      const hitAt = this.nextSpawnAt + TRAVEL_MS;
      const id = this.stage.spawnCue(gesture, this.nextSpawnAt, hitAt, this.laneX);
      this.cues.push({ id, gesture, hitAt, scored: false, result: null });
      this.nextSpawnAt += SPAWN_INTERVAL_MS * (0.9 + this.rng() * 0.35);
    }

    // Mark misses
    for (const cue of this.cues) {
      if (!cue.scored && now > cue.hitAt + HIT_WINDOW_MS) {
        cue.scored = true;
        cue.result = "miss";
        const hadCombo = this.combo;
        this.combo = 0;
        this.stage.markCue(cue.id, "miss");
        if (hadCombo >= 3) this._emit("miss", { lostCombo: hadCombo });
        this._emit("update", { score: this.score, combo: this.combo, timeLeft });
      }
    }

    // Prune old cues (results already displayed)
    this.cues = this.cues.filter((c) => !c.scored || now < c.hitAt + 900);

    this._emit("tick", { timeLeft });
  }

  onLocalGesture(name) {
    if (!this.active) return;
    const now = performance.now();
    let best = null;
    let bestDt = Infinity;
    for (const cue of this.cues) {
      if (cue.scored) continue;
      const dt = Math.abs(now - cue.hitAt);
      if (dt > HIT_WINDOW_MS) continue;
      if (dt < bestDt) {
        best = cue;
        bestDt = dt;
      }
    }
    if (!best) return;
    best.scored = true;
    if (best.gesture === name) {
      best.result = "hit";
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const comboBonus = Math.min(this.combo, 8) * 10;
      this.score += 100 + comboBonus;
      this.stage.markCue(best.id, "hit");
      this._emit("hit", { combo: this.combo, score: this.score });
    } else {
      best.result = "wrong";
      this.combo = 0;
      this.score = Math.max(0, this.score - 20);
      this.stage.markCue(best.id, "wrong");
      this._emit("wrong", { score: this.score });
    }
    this._emit("update", {
      score: this.score,
      combo: this.combo,
      timeLeft: Math.max(0, this.duration - (now - this.t0)),
    });
  }
}
