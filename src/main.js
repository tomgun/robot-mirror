import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { createDetectors, startCamera } from "./detector.js";
import { Robot, landmarkToVec } from "./robot.js";
import { Fireworks, Shockwaves, Lightning, WarpShader } from "./effects.js";

const MAX_PEOPLE = 4;
const GESTURE_COOLDOWN_MS = 700;

const video = document.getElementById("video");
const canvas = document.getElementById("scene");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const gestureLabel = document.getElementById("gesture-label");

// --- Three.js core ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x05070d, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.1, 3.2);
camera.lookAt(0, 0, 0);

// background gradient plane with subtle star field
{
  const bgGeom = new THREE.PlaneGeometry(40, 40);
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 1.3;
        vec3 a = vec3(0.04, 0.07, 0.14);
        vec3 b = vec3(0.01, 0.02, 0.04);
        vec3 col = mix(a, b, smoothstep(0.1, 0.9, r));
        float stars = step(0.998, fract(sin(dot(floor(vUv*320.0+uTime*0.2), vec2(12.9898,78.233)))*43758.5453));
        col += vec3(stars) * 0.35;
        gl_FragColor = vec4(col, 1.);
      }`,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(bgGeom, bgMat);
  mesh.position.z = -8;
  scene.add(mesh);
  scene.userData.bgMat = bgMat;
}

// lights
scene.add(new THREE.AmbientLight(0x404a60, 0.7));
const key = new THREE.DirectionalLight(0xbfd4ff, 1.4);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0xff88aa, 0.9);
rim.position.set(-4, 2, -3);
scene.add(rim);
const fill = new THREE.PointLight(0x66ddff, 1.0, 20);
fill.position.set(0, 0, 2);
scene.add(fill);

// --- post-processing ---
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85,
  0.7,
  0.2,
);
composer.addPass(bloom);

const warpPass = new ShaderPass(WarpShader);
composer.addPass(warpPass);

// --- managers ---
const fireworks = new Fireworks(scene);
const shockwaves = new Shockwaves(scene);
const lightning = new Lightning(scene);
const robots = Array.from({ length: MAX_PEOPLE }, () => new Robot(scene));

// --- state ---
let detectors = null;
let running = false;
let lastPoseMs = -1;
let lastGestureMs = -1;
let lastFrameTime = performance.now();
let warpStrength = 0;
const gestureCooldowns = new Map();

// --- interactions ---
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Loading models…";
  try {
    detectors = await createDetectors({ maxPeople: MAX_PEOPLE });
    startBtn.textContent = "Requesting camera…";
    await startCamera(video);
    startOverlay.classList.add("hidden");
    running = true;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "Retry";
    const p = startOverlay.querySelector("p");
    p.textContent = "Error: " + (err.message || err);
    p.style.color = "#ff8a8a";
  }
});

window.addEventListener("resize", () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  bloom.setSize(w, h);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "v" || e.key === "V") video.classList.toggle("visible");
  if (e.key === "f" || e.key === "F") {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
});

function triggerGesture(name, handIndex, handLandmarks, videoAspect) {
  const cooldownKey = `${handIndex}:${name}`;
  const now = performance.now();
  const last = gestureCooldowns.get(cooldownKey) || 0;
  if (now - last < GESTURE_COOLDOWN_MS) return;
  gestureCooldowns.set(cooldownKey, now);

  const wrist = handLandmarks && handLandmarks[0];
  if (!wrist) return;
  const world = landmarkToVec(wrist, videoAspect, new THREE.Vector3());

  flashLabel(name);

  switch (name) {
    case "Open_Palm":
      fireworks.burst(world);
      break;
    case "Closed_Fist":
      warpStrength = Math.min(warpStrength + 1.0, 1.5);
      shockwaves.spawn(world, 0x6688ff);
      break;
    case "Victory":
      shockwaves.spawn(world, 0xffbb66);
      fireworks.burst(world, new THREE.Color(0xffbb66));
      break;
    case "Thumb_Up":
      for (const r of robots) if (r.group.visible) r.setTint(0xffffff, 1200);
      break;
    case "Pointing_Up":
      lightning.strike(world);
      break;
  }
}

function flashLabel(text) {
  gestureLabel.textContent = text.replace(/_/g, " ");
  gestureLabel.classList.add("active");
  clearTimeout(flashLabel._t);
  flashLabel._t = setTimeout(() => gestureLabel.classList.remove("active"), 550);
}

const debugEl = document.createElement("div");
debugEl.id = "debug";
debugEl.style.cssText = "position:absolute;top:50px;left:24px;z-index:5;font:12px ui-monospace,monospace;background:rgba(0,0,0,0.55);padding:8px 10px;border-radius:6px;color:#9ecbff;white-space:pre;pointer-events:none;";
document.body.appendChild(debugEl);

let frameCount = 0;
let fpsLastTick = performance.now();
let fps = 0;
let lastPoseCount = 0;
let lastGestureInfo = "";
let loopError = null;

window.addEventListener("error", (e) => {
  loopError = e.message;
});

function loop() {
  if (!running) return;
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  frameCount++;
  if (now - fpsLastTick > 500) {
    fps = Math.round((frameCount * 1000) / (now - fpsLastTick));
    frameCount = 0;
    fpsLastTick = now;
  }

  try {
    if (video.readyState >= 2 && detectors && video.videoWidth > 0) {
      const videoAspect = video.videoWidth / video.videoHeight;

      const poseTs = Math.floor(now);
      if (poseTs > lastPoseMs) {
        const poseResult = detectors.pose.detectForVideo(video, poseTs);
        lastPoseMs = poseTs;
        const peoplePoses = poseResult.landmarks || [];
        lastPoseCount = peoplePoses.length;
        for (let i = 0; i < robots.length; i++) {
          if (i < peoplePoses.length) {
            robots[i].update(peoplePoses[i], videoAspect, dt);
          } else {
            robots[i].hide();
          }
        }
      }

      const gTs = Math.floor(now) + 1;
      if (gTs > lastGestureMs) {
        const gResult = detectors.gesture.recognizeForVideo(video, gTs);
        lastGestureMs = gTs;
        const gestures = gResult.gestures || [];
        const handLms = gResult.landmarks || [];
        lastGestureInfo = gestures
          .map((g, i) => (g[0] ? `${g[0].categoryName}:${g[0].score.toFixed(2)}` : "—"))
          .join(" ");
        for (let i = 0; i < gestures.length; i++) {
          const top = gestures[i][0];
          if (!top) continue;
          if (top.score < 0.65) continue;
          if (top.categoryName === "None") continue;
          triggerGesture(top.categoryName, i, handLms[i], videoAspect);
        }
      }
    }

    fireworks.update(dt);
    shockwaves.update(dt);
    lightning.update(dt);

    warpStrength = Math.max(warpStrength - dt * 1.1, 0);
    warpPass.uniforms.uTime.value = now * 0.001;
    warpPass.uniforms.uStrength.value = warpStrength;

    scene.userData.bgMat.uniforms.uTime.value = now * 0.001;

    composer.render();
  } catch (err) {
    loopError = err && err.message ? err.message : String(err);
    console.error(err);
  }

  debugEl.textContent =
    `fps: ${fps}\n` +
    `video: ${video.videoWidth}x${video.videoHeight} ready=${video.readyState}\n` +
    `poses: ${lastPoseCount}\n` +
    `hands: ${lastGestureInfo || "—"}\n` +
    `canvas: ${renderer.domElement.width}x${renderer.domElement.height}\n` +
    (loopError ? `ERROR: ${loopError}` : "");

  requestAnimationFrame(loop);
}
