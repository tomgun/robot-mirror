import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { Robot, landmarkToVec } from "./robot.js";
import { Fireworks, Shockwaves, Lightning, WarpShader } from "./effects.js";

const MAX_PLAYERS = 4;
const SLOT_SPACING = 1.6;

const CUE_INFO = {
  Open_Palm:   { emoji: "✋", color: "#ffe066" },
  Closed_Fist: { emoji: "✊", color: "#6688ff" },
  Victory:     { emoji: "✌", color: "#ffbb66" },
  Thumb_Up:    { emoji: "👍", color: "#88ff88" },
  Pointing_Up: { emoji: "☝", color: "#cc88ff" },
};

function buildCueCanvas(gestureName) {
  const info = CUE_INFO[gestureName] || { emoji: "?", color: "#ffffff" };
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");

  const grad = ctx.createRadialGradient(size / 2, size / 2, 30, size / 2, size / 2, size / 2);
  grad.addColorStop(0, info.color + "99");
  grad.addColorStop(0.55, info.color + "44");
  grad.addColorStop(1, info.color + "00");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "rgba(10, 16, 30, 0.85)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 32, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = info.color;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 32, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = "bold 130px 'Apple Color Emoji', 'Segoe UI Emoji', system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(info.emoji, size / 2, size / 2 + 8);

  return c;
}

export class Stage {
  constructor({ canvas }) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x05070d, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0.1, 3.2);
    this.camera.lookAt(0, 0, 0);

    // background plane
    {
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
            float stars = step(0.9985, fract(sin(dot(floor(vUv*320.0), vec2(12.9898,78.233)))*43758.5453));
            col += vec3(stars) * 0.15;
            gl_FragColor = vec4(col, 1.);
          }`,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), bgMat);
      mesh.position.z = -8;
      this.scene.add(mesh);
      this.bgMat = bgMat;
    }

    this.scene.add(new THREE.AmbientLight(0x404a60, 0.7));
    const key = new THREE.DirectionalLight(0xbfd4ff, 1.4);
    key.position.set(3, 4, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff88aa, 0.9);
    rim.position.set(-4, 2, -3);
    this.scene.add(rim);
    const fill = new THREE.PointLight(0x66ddff, 1.0, 20);
    fill.position.set(0, 0, 2);
    this.scene.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.35,
      0.6,
      0.85,
    );
    this.composer.addPass(this.bloom);

    this.warpPass = new ShaderPass(WarpShader);
    this.composer.addPass(this.warpPass);

    this.fireworks = new Fireworks(this.scene);
    this.shockwaves = new Shockwaves(this.scene);
    this.lightning = new Lightning(this.scene);

    this.robotsByPeer = new Map();
    this.slotByPeer = new Map();
    this.slotsInUse = new Array(MAX_PLAYERS).fill(null);

    this.warpStrength = 0;
    this.lastFrameTime = performance.now();

    this.cues = new Map(); // id -> { sprite, spawnAt, hitAt, laneX, result, resultAt }
    this._cueIdCounter = 0;
    this.hitLineMesh = null;

    window.addEventListener("resize", () => this.handleResize());
  }

  handleResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bloom.setSize(w, h);
  }

  _nextFreeSlot() {
    for (let i = 0; i < this.slotsInUse.length; i++) {
      if (!this.slotsInUse[i]) return i;
    }
    return -1;
  }

  _slotOffset(slot, totalSlots) {
    const n = Math.max(totalSlots, 1);
    return (slot - (n - 1) / 2) * SLOT_SPACING;
  }

  _repositionAll() {
    const occupied = this.slotsInUse.filter(Boolean);
    for (let i = 0; i < this.slotsInUse.length; i++) {
      const peerId = this.slotsInUse[i];
      if (!peerId) continue;
      const robot = this.robotsByPeer.get(peerId);
      if (!robot) continue;
      const idxAmongOccupied = occupied.indexOf(peerId);
      const offset = this._slotOffset(idxAmongOccupied, occupied.length);
      robot.group.position.x = offset;
    }
  }

  addRobot(peerId) {
    if (this.robotsByPeer.has(peerId)) return this.robotsByPeer.get(peerId);
    const slot = this._nextFreeSlot();
    if (slot < 0) return null;
    const robot = new Robot(this.scene);
    this.robotsByPeer.set(peerId, robot);
    this.slotsInUse[slot] = peerId;
    this.slotByPeer.set(peerId, slot);
    this._repositionAll();
    return robot;
  }

  removeRobot(peerId) {
    const robot = this.robotsByPeer.get(peerId);
    if (!robot) return;
    robot.dispose();
    this.robotsByPeer.delete(peerId);
    const slot = this.slotByPeer.get(peerId);
    if (slot !== undefined) {
      this.slotsInUse[slot] = null;
      this.slotByPeer.delete(peerId);
    }
    this._repositionAll();
  }

  setPose(peerId, landmarks, videoAspect) {
    let robot = this.robotsByPeer.get(peerId);
    if (!robot) robot = this.addRobot(peerId);
    if (!robot) return;
    const dt = Math.min((performance.now() - this.lastFrameTime) / 1000, 0.05);
    robot.update(landmarks, videoAspect, dt);
  }

  hidePeer(peerId) {
    const robot = this.robotsByPeer.get(peerId);
    if (robot) robot.hide();
  }

  setFace(peerId, dataUrl) {
    const robot = this.robotsByPeer.get(peerId);
    if (robot) robot.setFaceTexture(dataUrl);
  }

  clearFace(peerId) {
    const robot = this.robotsByPeer.get(peerId);
    if (robot) robot.clearFaceTexture();
  }

  clearAllFaces() {
    for (const r of this.robotsByPeer.values()) r.clearFaceTexture();
  }

  triggerEffect(peerId, name, wristLm, videoAspect) {
    const offset = this.robotsByPeer.get(peerId)?.group.position.x || 0;
    const world = landmarkToVec(wristLm, videoAspect, new THREE.Vector3());
    world.x += offset;

    switch (name) {
      case "Open_Palm":
        this.fireworks.burst(world);
        break;
      case "Closed_Fist":
        this.warpStrength = Math.min(this.warpStrength + 1.0, 1.5);
        this.shockwaves.spawn(world, 0x6688ff);
        break;
      case "Victory":
        this.shockwaves.spawn(world, 0xffbb66);
        this.fireworks.burst(world, new THREE.Color(0xffbb66));
        break;
      case "Thumb_Up":
        for (const r of this.robotsByPeer.values()) r.setTint(0xffffff, 1200);
        break;
      case "Pointing_Up":
        this.lightning.strike(world);
        break;
    }
  }

  showHitLine(show) {
    if (show && !this.hitLineMesh) {
      const geom = new THREE.PlaneGeometry(6, 0.05);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9ecbff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      this.hitLineMesh = new THREE.Mesh(geom, mat);
      this.hitLineMesh.position.set(0, 0, 0.2);
      this.scene.add(this.hitLineMesh);
    } else if (!show && this.hitLineMesh) {
      this.scene.remove(this.hitLineMesh);
      this.hitLineMesh.geometry.dispose();
      this.hitLineMesh.material.dispose();
      this.hitLineMesh = null;
    }
  }

  spawnCue(gestureName, spawnAt, hitAt, laneX = 0) {
    const id = ++this._cueIdCounter;
    const canvas = buildCueCanvas(gestureName);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.45, 0.45, 1);
    sprite.position.set(laneX, 1.8, 0.25);
    sprite.renderOrder = 8;
    this.scene.add(sprite);

    this.cues.set(id, {
      sprite, tex, spawnAt, hitAt, laneX,
      gesture: gestureName,
      result: null,
      resultAt: 0,
    });
    return id;
  }

  markCue(id, result) {
    const cue = this.cues.get(id);
    if (!cue || cue.result) return;
    cue.result = result;
    cue.resultAt = performance.now();
    const flashColor = result === "hit" ? 0x99ffaa : result === "wrong" ? 0xff7788 : 0x888899;
    cue.sprite.material.color = new THREE.Color(flashColor);
  }

  destroyCue(id) {
    const cue = this.cues.get(id);
    if (!cue) return;
    this.scene.remove(cue.sprite);
    cue.sprite.material.map.dispose();
    cue.sprite.material.dispose();
    this.cues.delete(id);
  }

  clearAllCues() {
    for (const id of Array.from(this.cues.keys())) this.destroyCue(id);
  }

  _updateCues(now) {
    for (const [id, cue] of this.cues) {
      const t = (now - cue.spawnAt) / (cue.hitAt - cue.spawnAt);
      const y = 1.8 + (0 - 1.8) * t;
      cue.sprite.position.y = y;
      const dt = Math.abs(now - cue.hitAt);
      const pulse = dt < 250 ? 1 + 0.15 * Math.cos((dt / 250) * Math.PI) : 1;
      cue.sprite.scale.set(0.45 * pulse, 0.45 * pulse, 1);

      if (cue.result) {
        const age = now - cue.resultAt;
        cue.sprite.material.opacity = Math.max(1 - age / 500, 0);
        if (cue.result === "hit") {
          cue.sprite.position.y += age * 0.002;
        }
        if (age > 600) this.destroyCue(id);
      } else if (t > 1.4) {
        this.markCue(id, "miss");
      }
    }
  }

  render() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    this.fireworks.update(dt);
    this.shockwaves.update(dt);
    this.lightning.update(dt);
    this._updateCues(now);

    this.warpStrength = Math.max(this.warpStrength - dt * 1.1, 0);
    this.warpPass.uniforms.uTime.value = now * 0.001;
    this.warpPass.uniforms.uStrength.value = this.warpStrength;

    this.bgMat.uniforms.uTime.value = now * 0.001;

    this.composer.render();
  }

  start() {
    const tick = () => {
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
