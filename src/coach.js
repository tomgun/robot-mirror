function makeBasePose() {
  const p = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  // Face
  p[0] = { x: 0.5, y: 0.2, z: 0, visibility: 1 };
  p[1] = { x: 0.47, y: 0.18, z: 0, visibility: 1 };
  p[2] = { x: 0.465, y: 0.19, z: 0, visibility: 1 };
  p[3] = { x: 0.46, y: 0.19, z: 0, visibility: 1 };
  p[4] = { x: 0.53, y: 0.18, z: 0, visibility: 1 };
  p[5] = { x: 0.535, y: 0.19, z: 0, visibility: 1 };
  p[6] = { x: 0.54, y: 0.19, z: 0, visibility: 1 };
  p[7] = { x: 0.44, y: 0.2, z: 0, visibility: 1 };
  p[8] = { x: 0.56, y: 0.2, z: 0, visibility: 1 };
  p[9] = { x: 0.47, y: 0.25, z: 0, visibility: 1 };
  p[10] = { x: 0.53, y: 0.25, z: 0, visibility: 1 };
  // Shoulders, elbows, wrists
  p[11] = { x: 0.4, y: 0.35, z: 0, visibility: 1 };
  p[12] = { x: 0.6, y: 0.35, z: 0, visibility: 1 };
  p[13] = { x: 0.33, y: 0.47, z: 0, visibility: 1 };
  p[14] = { x: 0.67, y: 0.47, z: 0, visibility: 1 };
  p[15] = { x: 0.27, y: 0.58, z: 0, visibility: 1 };
  p[16] = { x: 0.73, y: 0.58, z: 0, visibility: 1 };
  // Hands (reuse wrist positions)
  for (let i = 17; i <= 19; i++) p[i] = { x: 0.27, y: 0.6, z: 0, visibility: 1 };
  for (let i = 20; i <= 22; i++) p[i] = { x: 0.73, y: 0.6, z: 0, visibility: 1 };
  // Hips, knees, ankles, feet
  p[23] = { x: 0.45, y: 0.6, z: 0, visibility: 1 };
  p[24] = { x: 0.55, y: 0.6, z: 0, visibility: 1 };
  p[25] = { x: 0.45, y: 0.75, z: 0, visibility: 1 };
  p[26] = { x: 0.55, y: 0.75, z: 0, visibility: 1 };
  p[27] = { x: 0.45, y: 0.92, z: 0, visibility: 1 };
  p[28] = { x: 0.55, y: 0.92, z: 0, visibility: 1 };
  p[29] = { x: 0.45, y: 0.95, z: 0, visibility: 1 };
  p[30] = { x: 0.55, y: 0.95, z: 0, visibility: 1 };
  p[31] = { x: 0.42, y: 0.97, z: 0, visibility: 1 };
  p[32] = { x: 0.58, y: 0.97, z: 0, visibility: 1 };
  return p;
}

const EXERCISES = [
  { name: "Arm raises", durationMs: 15000, periodMs: 2000, fn: armRaises },
  { name: "Side bends", durationMs: 15000, periodMs: 2400, fn: sideBends },
  { name: "Reach up", durationMs: 15000, periodMs: 2400, fn: alternateReaches },
  { name: "Knee lifts", durationMs: 15000, periodMs: 1600, fn: kneeLifts },
];

function armRaises(pose, phase) {
  const lift = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  // wrist y from 0.58 (down) to 0.08 (up), x from 0.27 (side) to 0.42 (near shoulder)
  pose[15].x = 0.27 + (0.42 - 0.27) * lift;
  pose[15].y = 0.58 - 0.5 * lift;
  pose[16].x = 0.73 + (0.58 - 0.73) * lift;
  pose[16].y = 0.58 - 0.5 * lift;
  // elbows midway
  pose[13].x = 0.33 + (0.39 - 0.33) * lift;
  pose[13].y = 0.47 - 0.27 * lift;
  pose[14].x = 0.67 + (0.61 - 0.67) * lift;
  pose[14].y = 0.47 - 0.27 * lift;
}

function sideBends(pose, phase) {
  const sway = Math.sin(phase * 2 * Math.PI) * 0.08;
  // Shoulders and head shift sideways; opposite shoulder raises slightly
  pose[0].x += sway;
  pose[11].x += sway;
  pose[12].x += sway;
  pose[11].y += Math.abs(sway) * 0.25 * Math.sign(-sway);
  pose[12].y += Math.abs(sway) * 0.25 * Math.sign(sway);
  pose[13].x += sway;
  pose[14].x += sway;
  pose[15].x += sway;
  pose[16].x += sway;
  // elbows gently rise on opposite side
  pose[15].y += 0.06 * sway;
  pose[16].y -= 0.06 * sway;
}

function alternateReaches(pose, phase) {
  // Two-count: first half left arm reaches up, second half right
  const leftReach = phase < 0.5 ? Math.sin((phase / 0.5) * Math.PI) : 0;
  const rightReach = phase >= 0.5 ? Math.sin(((phase - 0.5) / 0.5) * Math.PI) : 0;
  pose[15].x = 0.27 + (0.5 - 0.27) * leftReach;
  pose[15].y = 0.58 - 0.5 * leftReach;
  pose[13].x = 0.33 + (0.42 - 0.33) * leftReach;
  pose[13].y = 0.47 - 0.28 * leftReach;
  pose[16].x = 0.73 + (0.5 - 0.73) * rightReach;
  pose[16].y = 0.58 - 0.5 * rightReach;
  pose[14].x = 0.67 + (0.58 - 0.67) * rightReach;
  pose[14].y = 0.47 - 0.28 * rightReach;
}

function kneeLifts(pose, phase) {
  const leftLift = phase < 0.5 ? Math.sin((phase / 0.5) * Math.PI) : 0;
  const rightLift = phase >= 0.5 ? Math.sin(((phase - 0.5) / 0.5) * Math.PI) : 0;
  pose[25].y = 0.75 - 0.2 * leftLift;
  pose[27].y = 0.92 - 0.22 * leftLift;
  pose[26].y = 0.75 - 0.2 * rightLift;
  pose[28].y = 0.92 - 0.22 * rightLift;
  // arms bend slightly for balance
  pose[15].y = 0.58 - 0.1 * leftLift;
  pose[16].y = 0.58 - 0.1 * rightLift;
}

const MATCH_SEGMENTS = [
  [11, 15], [12, 16],
  [23, 27], [24, 28],
  [11, 13], [12, 14],
  [13, 15], [14, 16],
  [23, 25], [24, 26],
  [25, 27], [26, 28],
];

function matchPoses(coach, player) {
  let sum = 0, count = 0;
  for (const [a, b] of MATCH_SEGMENTS) {
    const ca = coach[a], cb = coach[b];
    const pa = player[a], pb = player[b];
    if (!ca || !cb || !pa || !pb) continue;
    if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
    // mirror coach X so both describe motion in the same screen direction
    const cdx = (1 - cb.x) - (1 - ca.x);
    const cdy = cb.y - ca.y;
    const pdx = pb.x - pa.x;
    const pdy = pb.y - pa.y;
    const clen = Math.hypot(cdx, cdy);
    const plen = Math.hypot(pdx, pdy);
    if (clen < 0.02 || plen < 0.02) continue;
    const cos = (cdx * pdx + cdy * pdy) / (clen * plen);
    sum += (cos + 1) / 2;
    count++;
  }
  if (count === 0) return 0.5;
  return sum / count;
}

export class CoachSession extends EventTarget {
  constructor({ stage }) {
    super();
    this.stage = stage;
    this.active = false;
    this.startTime = 0;
    this._handle = null;
    this.totalDuration = EXERCISES.reduce((s, e) => s + e.durationMs, 0);
    this.lastCoachPose = null;
    this.matchEMA = 0.5;
    this._matchSum = 0;
    this._matchSamples = 0;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.startTime = performance.now();
    this.stage.addCoachRobot();
    this._handle = setInterval(() => this._tick(), 33);
    this._tick();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this._handle) { clearInterval(this._handle); this._handle = null; }
    this.stage.removeCoachRobot();
    const avg = this._matchSamples > 0 ? this._matchSum / this._matchSamples : 0.5;
    this._emit("end", { avgMatch: avg });
  }

  scorePlayer(playerPose) {
    if (!this.active || !this.lastCoachPose || !playerPose) return;
    const m = matchPoses(this.lastCoachPose, playerPose);
    this.matchEMA = this.matchEMA * 0.75 + m * 0.25;
    this._matchSum += this.matchEMA;
    this._matchSamples++;
  }

  _currentExercise(elapsedMs) {
    let acc = 0;
    for (const ex of EXERCISES) {
      if (elapsedMs < acc + ex.durationMs) {
        return { ex, exStart: acc, exElapsed: elapsedMs - acc };
      }
      acc += ex.durationMs;
    }
    return null;
  }

  _tick() {
    const now = performance.now();
    const elapsed = now - this.startTime;
    if (elapsed >= this.totalDuration) {
      this.stop();
      return;
    }
    const info = this._currentExercise(elapsed);
    if (!info) return;
    const { ex, exElapsed } = info;
    const phase = (exElapsed / ex.periodMs) % 1;
    const pose = makeBasePose();
    ex.fn(pose, phase);
    this.stage.setCoachPose(pose, 1.0);
    this.lastCoachPose = pose;

    const rep = Math.floor(exElapsed / ex.periodMs);
    const timeLeft = this.totalDuration - elapsed;
    this._emit("update", {
      title: ex.name,
      rep,
      timeLeft,
      match: Math.round(this.matchEMA * 100),
    });
  }
}
