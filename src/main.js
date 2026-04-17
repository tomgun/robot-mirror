import { Stage } from "./stage.js";
import { LocalPlayer } from "./local_player.js";
import { Net } from "./net.js";

const video = document.getElementById("video");
const canvas = document.getElementById("scene");
const lobby = document.getElementById("lobby");
const hostBtn = document.getElementById("host-btn");
const joinForm = document.getElementById("join-form");
const joinInput = document.getElementById("join-code");
const statusEl = document.getElementById("lobby-status");
const roomInfo = document.getElementById("room-info");
const roomCodeEl = document.getElementById("room-code");
const copyLinkBtn = document.getElementById("copy-link");
const micToggleBtn = document.getElementById("mic-toggle");
const faceToggleBtn = document.getElementById("face-toggle");
const peerCountEl = document.getElementById("peer-count");
const gestureLabel = document.getElementById("gesture-label");

let stage = null;
let net = null;
let localPlayer = null;
let localId = null;

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

function flashLabel(name) {
  gestureLabel.textContent = name.replace(/_/g, " ");
  gestureLabel.classList.add("active");
  clearTimeout(flashLabel._t);
  flashLabel._t = setTimeout(() => gestureLabel.classList.remove("active"), 550);
}

async function startSession({ role, roomCode }) {
  setButtonsDisabled(true);
  setStatus(role === "host" ? "Creating room…" : `Joining ${roomCode}…`);

  try {
    net = new Net({ role, roomCode });
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
    };
    localPlayer.onGesture = (name, handLms, aspect) => {
      const wrist = handLms?.[0];
      if (!wrist) return;
      stage.triggerEffect(localId, name, wrist, aspect);
      net.broadcastGesture(name, wrist, aspect);
      flashLabel(name);
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
