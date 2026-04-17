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

  render() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    this.fireworks.update(dt);
    this.shockwaves.update(dt);
    this.lightning.update(dt);

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
