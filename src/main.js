import { Stage } from "./stage.js";
import { LocalPlayer } from "./local_player.js";
import { Net } from "./net.js";
import { GestureGame } from "./game_mode.js";
import { CoachSession } from "./coach.js";
import { DrumMachine, playHitChime, playComboStab, playMissThud, speak } from "./sounds.js";

const video = document.getElementById("video");
const canvas = document.getElementById("scene");
const lobby = document.getElementById("lobby");
const hostBtn = document.getElementById("host-btn");
const joinForm = document.getElementById("join-form");
const joinInput = document.getElementById("join-code");
const nameInput = document.getElementById("name-input");
const statusEl = document.getElementById("lobby-status");
const roomInfo = document.getElementById("room-info");
const roomCodeEl = document.getElementById("room-code");
const copyLinkBtn = document.getElementById("copy-link");
const micToggleBtn = document.getElementById("mic-toggle");
const faceToggleBtn = document.getElementById("face-toggle");
const peerCountEl = document.getElementById("peer-count");
const leaderboardEl = document.getElementById("leaderboard");
const leaderboardList = document.getElementById("leaderboard-list");
const gestureLabel = document.getElementById("gesture-label");
const gameBtn = document.getElementById("game-btn");
const aixerciseBtn = document.getElementById("aixercise-btn");
const countdownEl = document.getElementById("countdown");
const gameHud = document.getElementById("game-hud");
const gameScoreEl = document.getElementById("game-score");
const gameComboEl = document.getElementById("game-combo");
const gameTimerEl = document.getElementById("game-timer");
const gameEndEl = document.getElementById("game-end");
const endScoreVal = document.getElementById("end-score-val");
const endComboVal = document.getElementById("end-combo-val");
const endCloseBtn = document.getElementById("end-close");
const coachHud = document.getElementById("coach-hud");
const coachTitle = document.getElementById("coach-title");
const coachReps = document.getElementById("coach-reps");
const coachMatch = document.getElementById("coach-match");
const coachTimer = document.getElementById("coach-timer");
const coachStop = document.getElementById("coach-stop");

let stage = null;
let net = null;
let localPlayer = null;
let localId = null;
let game = null;
let coach = null;
let drums = null;
let myName = "";
const peerNames = new Map();
const peerScores = new Map();
let currentMode = null;
let lastScoreBroadcast = 0;

const ANIMALS = ["Fox", "Owl", "Lynx", "Bear", "Wolf", "Hare", "Otter", "Hawk", "Moth", "Ibex"];
const COLORS = ["Neon", "Amber", "Azure", "Crimson", "Violet", "Jade", "Cobalt", "Coral", "Mint", "Pearl"];
function generateName() {
  const a = COLORS[Math.floor(Math.random() * COLORS.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${b}`;
}

(function initName() {
  const stored = localStorage.getItem("robot-mirror:name") || "";
  myName = stored || generateName();
  nameInput.value = myName;
})();

nameInput.addEventListener("input", () => {
  myName = nameInput.value.trim() || generateName();
  localStorage.setItem("robot-mirror:name", nameInput.value.trim());
  if (net) net.broadcastName(myName);
});

// Prefill join code from URL hash
const hashMatch = window.location.hash.match(/room=([A-Z0-9]+)/i);
if (hashMatch) joinInput.value = hashMatch[1].toUpperCase();

hostBtn.addEventListener("click", () => startSession({ role: "host" }));
joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = joinInput.value.trim().toUpperCase();
  if (!code) return;
  startSession({ role: "join", roomCode: code });
});

micToggleBtn.addEventListener("click", async () => {
  if (!net) return;
  const on = micToggleBtn.getAttribute("aria-pressed") !== "true";
  if (on) {
    micToggleBtn.disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      net.enableMic(stream);
      micToggleBtn.setAttribute("aria-pressed", "true");
      micToggleBtn.textContent = "mic: on";
    } catch (err) {
      console.error(err);
      alert("Microphone error: " + (err?.message || err));
    } finally {
      micToggleBtn.disabled = false;
    }
  } else {
    net.disableMic();
    micToggleBtn.setAttribute("aria-pressed", "false");
    micToggleBtn.textContent = "mic: off";
  }
});

function setFaceMode(on) {
  if (!localPlayer) return;
  localPlayer.faceEnabled = on;
  faceToggleBtn.setAttribute("aria-pressed", String(on));
  faceToggleBtn.querySelector(".left").classList.toggle("active", !on);
  faceToggleBtn.querySelector(".right").classList.toggle("active", on);
  if (!on) {
    stage.clearFace(localId);
    net.broadcastFace("");
  }
}

faceToggleBtn.addEventListener("click", (e) => {
  if (!localPlayer) return;
  const target = e.target.closest(".opt");
  if (target) {
    setFaceMode(target.classList.contains("right"));
  } else {
    setFaceMode(!localPlayer.faceEnabled);
  }
});
faceToggleBtn.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (localPlayer) setFaceMode(!localPlayer.faceEnabled);
  }
});

copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copyLinkBtn.textContent = "copied!";
    setTimeout(() => (copyLinkBtn.textContent = "copy link"), 1500);
  } catch {
    copyLinkBtn.textContent = "failed";
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "v" || e.key === "V") video.classList.toggle("visible");
  if (e.key === "f" || e.key === "F") {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
});

function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
}

function setButtonsDisabled(disabled) {
  hostBtn.disabled = disabled;
  joinInput.disabled = disabled;
  joinForm.querySelector("button[type=submit]").disabled = disabled;
}

function updatePeerCount() {
  const n = net ? net.peerCount : 1;
  peerCountEl.textContent = n === 1 ? "1 player" : `${n} players`;
}

function displayName(peerId) {
  if (peerId === localId) return myName;
  return peerNames.get(peerId) || peerId;
}

function renderLeaderboard() {
  if (!currentMode) {
    leaderboardEl.classList.add("hidden");
    leaderboardList.innerHTML = "";
    return;
  }
  const entries = [];
  for (const [pid, s] of peerScores) {
    entries.push({ pid, score: s.score, label: s.label });
  }
  entries.sort((a, b) => b.score - a.score);
  leaderboardList.innerHTML = "";
  entries.forEach((e, i) => {
    const li = document.createElement("li");
    if (e.pid === localId) li.classList.add("self");
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `${i + 1}.`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = displayName(e.pid);
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = e.label || String(e.score);
    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(val);
    leaderboardList.appendChild(li);
  });
  leaderboardEl.classList.remove("hidden");
}

function setLocalScore(score, label) {
  peerScores.set(localId, { score, label });
  renderLeaderboard();
  // throttle broadcast
  const now = performance.now();
  if (now - lastScoreBroadcast > 500 && net) {
    lastScoreBroadcast = now;
    net.broadcastScore(currentMode, score, label);
  }
}

function beginLeaderboard(mode) {
  currentMode = mode;
  peerScores.clear();
  setLocalScore(0, mode === "coach" ? "0%" : "0");
}

function endLeaderboard() {
  currentMode = null;
  peerScores.clear();
  leaderboardEl.classList.add("hidden");
}

function flashLabel(name) {
  gestureLabel.textContent = name.replace(/_/g, " ");
  gestureLabel.classList.add("active");
  clearTimeout(flashLabel._t);
  flashLabel._t = setTimeout(() => gestureLabel.classList.remove("active"), 550);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runCountdown() {
  countdownEl.classList.remove("hidden");
  for (let i = 3; i >= 1; i--) {
    countdownEl.textContent = String(i);
    countdownEl.classList.remove("pop");
    void countdownEl.offsetWidth;
    countdownEl.classList.add("pop");
    await sleep(800);
  }
  countdownEl.textContent = "GO";
  countdownEl.classList.remove("pop");
  void countdownEl.offsetWidth;
  countdownEl.classList.add("pop");
  await sleep(600);
  countdownEl.classList.add("hidden");
}

function setModeButtonsDisabled(disabled) {
  gameBtn.disabled = disabled;
  aixerciseBtn.disabled = disabled;
}

function startDrums(bpm, groove = "house") {
  stopDrums();
  drums = new DrumMachine({ bpm, groove });
  drums.start();
}

function stopDrums() {
  if (drums) {
    drums.stop();
    drums = null;
  }
}

const ENCOURAGEMENT_PHRASES = [
  "Keep it up",
  "Great form",
  "Looking good",
  "Nice work",
  "You got this",
  "Stay with it",
  "Strong",
  "Almost there",
  "Beautiful",
  "Don't stop",
];
let lastPhraseIndex = -1;
function randomEncouragement() {
  let i;
  do {
    i = Math.floor(Math.random() * ENCOURAGEMENT_PHRASES.length);
  } while (i === lastPhraseIndex && ENCOURAGEMENT_PHRASES.length > 1);
  lastPhraseIndex = i;
  return ENCOURAGEMENT_PHRASES[i];
}

async function beginGestureGame({ seed, duration }) {
  if (!stage || !localId) return;
  if (game?.active || coach?.active) return;
  setModeButtonsDisabled(true);
  gameEndEl.classList.add("hidden");

  const localRobot = stage.robotsByPeer.get(localId);
  const laneX = localRobot?.group.position.x ?? 0;
  game = new GestureGame({ stage, laneX });
  game.addEventListener("update", (e) => {
    gameScoreEl.textContent = e.detail.score;
    gameComboEl.textContent = "×" + e.detail.combo;
    gameTimerEl.textContent = Math.ceil(e.detail.timeLeft / 1000);
    setLocalScore(e.detail.score, String(e.detail.score));
  });
  game.addEventListener("hit", (e) => {
    const { combo } = e.detail;
    if (combo > 0 && combo % 5 === 0) {
      playComboStab(combo);
      flashLabel(`${combo} combo!`);
    } else {
      playHitChime(Math.min(combo, 5));
    }
  });
  game.addEventListener("wrong", () => playMissThud());
  game.addEventListener("miss", () => playMissThud());
  game.addEventListener("tick", (e) => {
    gameTimerEl.textContent = Math.ceil(e.detail.timeLeft / 1000);
  });
  game.addEventListener("end", (e) => {
    gameHud.classList.add("hidden");
    stopDrums();
    endScoreVal.textContent = e.detail.score;
    endComboVal.textContent = "max combo " + e.detail.maxCombo;
    document.querySelector("#game-end .end-title").textContent = "ROUND COMPLETE";
    gameEndEl.classList.remove("hidden");
    setModeButtonsDisabled(false);
    setTimeout(() => endLeaderboard(), 6000);
  });

  await runCountdown();
  gameHud.classList.remove("hidden");
  gameScoreEl.textContent = "0";
  gameComboEl.textContent = "×0";
  gameTimerEl.textContent = Math.ceil(duration / 1000);
  startDrums(100, "house");
  beginLeaderboard("gesture");
  game.start({ seed, duration });
}

async function beginCoachSession() {
  if (!stage || !localId) return;
  if (game?.active || coach?.active) return;
  setModeButtonsDisabled(true);

  coach = new CoachSession({ stage });
  coach.addEventListener("update", (e) => {
    coachTitle.textContent = e.detail.title;
    coachReps.textContent = e.detail.rep;
    coachTimer.textContent = Math.ceil(e.detail.timeLeft / 1000);
    const m = e.detail.match;
    coachMatch.textContent = m + "%";
    coachMatch.classList.toggle("great", m >= 75);
    coachMatch.classList.toggle("good", m >= 50 && m < 75);
    coachMatch.classList.toggle("off", m < 50);
    setLocalScore(m, m + "%");
  });
  coach.addEventListener("encourage", (e) => {
    const phrase = e.detail.match >= 70
      ? (Math.random() < 0.5 ? "Perfect!" : "Looking great!")
      : randomEncouragement();
    speak(phrase);
  });
  coach.addEventListener("exercise-change", (e) => {
    speak(e.detail.title);
  });
  coach.addEventListener("end", (e) => {
    coachHud.classList.add("hidden");
    stopDrums();
    setModeButtonsDisabled(false);
    const avg = Math.round((e.detail?.avgMatch ?? 0) * 100);
    endScoreVal.textContent = avg + "%";
    endComboVal.textContent = "session match";
    document.querySelector("#game-end .end-title").textContent = "AIXERCISE COMPLETE";
    gameEndEl.classList.remove("hidden");
    speak(avg >= 70 ? "Awesome session!" : avg >= 50 ? "Good work!" : "Well done, keep going!");
    setTimeout(() => endLeaderboard(), 6000);
  });

  await runCountdown();
  coachHud.classList.remove("hidden");
  coachTitle.textContent = "Get ready";
  coachReps.textContent = "0";
  coachTimer.textContent = "60";
  startDrums(84, "chill");
  beginLeaderboard("coach");
  speak("Let's go!");
  coach.start();
}

gameBtn.addEventListener("click", () => {
  const seed = Date.now() & 0xffffffff;
  const duration = 45000;
  if (net) net.broadcastGameStart(seed, duration, "gesture");
  beginGestureGame({ seed, duration });
});

aixerciseBtn.addEventListener("click", () => {
  const seed = Date.now() & 0xffffffff;
  if (net) net.broadcastGameStart(seed, 60000, "coach");
  beginCoachSession();
});

coachStop.addEventListener("click", () => {
  if (coach?.active) coach.stop();
});

endCloseBtn.addEventListener("click", () => gameEndEl.classList.add("hidden"));

async function startSession({ role, roomCode }) {
  setButtonsDisabled(true);
  setStatus(role === "host" ? "Creating room…" : `Joining ${roomCode}…`);

  try {
    net = new Net({ role, roomCode });
    net.myName = myName;
    await net.connect();
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Connection failed", true);
    setButtonsDisabled(false);
    net = null;
    return;
  }

  localId = net.shortSelfId();
  window.history.replaceState(null, "", `#room=${net.roomCode}`);
  roomCodeEl.textContent = net.roomCode;
  roomInfo.classList.remove("hidden");

  stage = new Stage({ canvas });
  stage.addRobot(localId);

  net.addEventListener("peer-added", (e) => {
    stage.addRobot(e.detail.peerId);
    updatePeerCount();
  });
  net.addEventListener("peer-removed", (e) => {
    stage.removeRobot(e.detail.peerId);
    updatePeerCount();
  });
  net.addEventListener("pose", (e) => {
    const { peerId, landmarks, aspect } = e.detail;
    stage.setPose(peerId, landmarks, aspect);
  });
  net.addEventListener("gesture", (e) => {
    const { peerId, name, wrist, aspect } = e.detail;
    stage.triggerEffect(peerId, name, wrist, aspect);
    flashLabel(name);
  });
  net.addEventListener("face", (e) => {
    const { peerId, img } = e.detail;
    if (!img) stage.clearFace(peerId);
    else stage.setFace(peerId, img);
  });
  net.addEventListener("game-start", (e) => {
    const { mode, seed, duration } = e.detail;
    if (mode === "coach") beginCoachSession();
    else beginGestureGame({ seed, duration });
  });
  net.addEventListener("name", (e) => {
    peerNames.set(e.detail.peerId, e.detail.name);
    renderLeaderboard();
  });
  net.addEventListener("score", (e) => {
    if (e.detail.mode !== currentMode) return;
    peerScores.set(e.detail.peerId, { score: e.detail.score, label: e.detail.label });
    renderLeaderboard();
  });
  net.addEventListener("peer-added", (e) => {
    // Send our name to new peer
    if (myName && net) net.broadcastName(myName);
  });

  setStatus("Starting camera…");
  try {
    localPlayer = new LocalPlayer({ video });
    localPlayer.onPose = (landmarks, aspect) => {
      if (!landmarks) {
        stage.hidePeer(localId);
        return;
      }
      stage.setPose(localId, landmarks, aspect);
      net.broadcastPose(landmarks, aspect);
      if (coach?.active) coach.scorePlayer(landmarks);
    };
    localPlayer.onGesture = (name, handLms, aspect) => {
      const wrist = handLms?.[0];
      if (!wrist) return;
      stage.triggerEffect(localId, name, wrist, aspect);
      net.broadcastGesture(name, wrist, aspect);
      flashLabel(name);
      if (game?.active) game.onLocalGesture(name);
    };
    localPlayer.onFace = (img) => {
      stage.setFace(localId, img);
      net.broadcastFace(img);
    };
    await localPlayer.start();
  } catch (err) {
    console.error(err);
    setStatus("Camera error: " + (err?.message || err), true);
    setButtonsDisabled(false);
    return;
  }

  stage.start();
  lobby.classList.add("hidden");
  updatePeerCount();
}
