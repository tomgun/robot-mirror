import * as THREE from "three";

const BONES = [
  { a: "mid_shoulder", b: 0, width: 0.12 },
  { a: "mid_shoulder", b: "mid_hip", width: 0.14 },
  { a: 11, b: 12, width: 0.08 },
  { a: 23, b: 24, width: 0.09 },
  { a: 11, b: 13, width: 0.07 },
  { a: 13, b: 15, width: 0.06 },
  { a: 12, b: 14, width: 0.07 },
  { a: 14, b: 16, width: 0.06 },
  { a: 23, b: 25, width: 0.085 },
  { a: 25, b: 27, width: 0.075 },
  { a: 24, b: 26, width: 0.085 },
  { a: 26, b: 28, width: 0.075 },
];

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function makeMetalMaterial(baseColor = 0x9fb3c8) {
  return new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.2,
    roughness: 0.7,
    emissive: 0x050a14,
  });
}

function makeGlowMaterial(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}

export class Robot {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.material = makeMetalMaterial();
    this.accentMaterial = makeMetalMaterial(0x5d78a8);
    this.tintTarget = new THREE.Color(0x9fb3c8);
    this.tintTimer = 0;

    this.bones = BONES.map((def) => {
      const geom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      const mesh = new THREE.Mesh(geom, this.material);
      mesh.castShadow = false;
      this.group.add(mesh);
      return { def, mesh };
    });

    this.joints = new Map();
    for (const idx of JOINTS) {
      const geom = new THREE.SphereGeometry(0.5, 16, 12);
      const mesh = new THREE.Mesh(geom, this.accentMaterial);
      this.group.add(mesh);
      this.joints.set(idx, mesh);
    }

    this.head = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 24, 16),
      this.material,
    );
    this.group.add(this.head);

    const eyeGeom = new THREE.SphereGeometry(0.5, 10, 8);
    this.leftEye = new THREE.Mesh(eyeGeom, makeGlowMaterial(0x66ddff));
    this.rightEye = new THREE.Mesh(eyeGeom, makeGlowMaterial(0x66ddff));
    this.group.add(this.leftEye);
    this.group.add(this.rightEye);

    this.antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      this.accentMaterial,
    );
    this.group.add(this.antenna);
    this.antennaTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      makeGlowMaterial(0xff66aa),
    );
    this.group.add(this.antennaTip);

    this.leftHand = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 14, 10),
      this.accentMaterial,
    );
    this.rightHand = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 14, 10),
      this.accentMaterial,
    );
    this.group.add(this.leftHand);
    this.group.add(this.rightHand);

    this._v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._mid = new THREE.Vector3();

    this.filters = null;
    this.smoothed = null;

    this._faceImage = null;
    this._facePlane = null;
    this._faceTexture = null;
    this._lastHeadCenter = new THREE.Vector3();
    this._lastHeadSize = 0.15;
  }

  setFaceTexture(dataUrl) {
    if (!dataUrl) return;
    if (!this._faceImage) {
      this._faceImage = new Image();
      this._faceImage.onload = () => {
        if (!this._facePlane) {
          const tex = new THREE.Texture(this._faceImage);
          tex.colorSpace = THREE.SRGBColorSpace;
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          });
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
          plane.renderOrder = 5;
          this._facePlane = plane;
          this._faceTexture = tex;
          this.group.add(plane);
        }
        this._faceTexture.needsUpdate = true;
      };
    }
    this._faceImage.src = dataUrl;
  }

  clearFaceTexture() {
    if (this._facePlane) {
      this.group.remove(this._facePlane);
      this._facePlane.geometry.dispose();
      this._facePlane.material.dispose();
      if (this._faceTexture) this._faceTexture.dispose();
      this._facePlane = null;
      this._faceTexture = null;
      this._faceImage = null;
    }
  }

  smoothLandmarks(raw) {
    const t = performance.now();
    if (!this.filters || this.filters.length !== raw.length) {
      this.filters = raw.map(() => [
        new OneEuro(), new OneEuro(), new OneEuro(),
      ]);
      this.smoothed = raw.map((lm) => ({
        x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility,
      }));
    }
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const f = this.filters[i];
      const s = this.smoothed[i];
      s.x = f[0].filter(r.x, t);
      s.y = f[1].filter(r.y, t);
      s.z = f[2].filter(r.z, t);
      s.visibility = r.visibility;
    }
    return this.smoothed;
  }

  setTint(color, durationMs = 600) {
    this.tintTarget.setHex(color);
    this.tintTimer = durationMs;
  }

  getLandmarkWorld(landmarks, key, aspect, out = this._v) {
    if (key === "mid_shoulder") return midOf(landmarks[11], landmarks[12], aspect, out);
    if (key === "mid_hip") return midOf(landmarks[23], landmarks[24], aspect, out);
    return landmarkToVec(landmarks[key], aspect, out);
  }

  update(rawLandmarks, aspect, dt) {
    if (!rawLandmarks || rawLandmarks.length < 33) {
      this.group.visible = false;
      this.smoothed = null;
      this.filters = null;
      return;
    }
    const landmarks = this.smoothLandmarks(rawLandmarks);
    this.group.visible = true;

    for (const { def, mesh } of this.bones) {
      const a = this.getLandmarkWorld(landmarks, def.a, aspect, this._a);
      const b = this.getLandmarkWorld(landmarks, def.b, aspect, this._b);
      alignBone(mesh, a, b, def.width);
    }

    for (const [idx, mesh] of this.joints) {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < 0.3) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      landmarkToVec(lm, aspect, mesh.position);
      const width = idx >= 15 && idx <= 16 ? 0 : 0.06;
      mesh.scale.setScalar(width || 0.06);
    }

    const nose = landmarkToVec(landmarks[0], aspect, this._a);
    const midShoulder = midOf(landmarks[11], landmarks[12], aspect, this._b);
    const shoulderWidth = landmarkToVec(landmarks[11], aspect, this._v).distanceTo(
      landmarkToVec(landmarks[12], aspect, new THREE.Vector3()),
    );
    const headCenter = nose.clone().lerp(midShoulder, -0.25);
    const headSize = Math.max(shoulderWidth * 0.55, 0.08);
    this.head.position.copy(headCenter);
    this.head.scale.setScalar(headSize);

    const eyeOffset = midShoulder.clone().sub(nose).normalize().multiplyScalar(0);
    const right = new THREE.Vector3(1, 0, 0);
    const headFwd = new THREE.Vector3(0, 0, 1);
    this.leftEye.position.copy(headCenter)
      .addScaledVector(right, -headSize * 0.35)
      .addScaledVector(headFwd, headSize * 0.7)
      .add(eyeOffset);
    this.rightEye.position.copy(headCenter)
      .addScaledVector(right, headSize * 0.35)
      .addScaledVector(headFwd, headSize * 0.7)
      .add(eyeOffset);
    this.leftEye.scale.setScalar(headSize * 0.18);
    this.rightEye.scale.setScalar(headSize * 0.18);
    const faceOn = !!this._facePlane;
    this.leftEye.visible = !faceOn;
    this.rightEye.visible = !faceOn;

    this._lastHeadCenter.copy(headCenter);
    this._lastHeadSize = headSize;

    if (this._facePlane) {
      this._facePlane.position.copy(headCenter);
      this._facePlane.position.z += headSize * 0.55;
      this._facePlane.scale.setScalar(headSize * 1.27);
    }

    const antennaBase = headCenter.clone().addScaledVector(new THREE.Vector3(0, 1, 0), headSize * 0.85);
    const antennaTop = antennaBase.clone().addScaledVector(new THREE.Vector3(0, 1, 0), headSize * 0.9);
    alignBone(this.antenna, antennaBase, antennaTop, 0.02);
    this.antennaTip.position.copy(antennaTop);
    this.antennaTip.scale.setScalar(0.05);

    if (landmarks[15] && landmarks[15].visibility > 0.3) {
      landmarkToVec(landmarks[15], aspect, this.leftHand.position);
      this.leftHand.scale.setScalar(0.09);
      this.leftHand.visible = true;
    } else this.leftHand.visible = false;
    if (landmarks[16] && landmarks[16].visibility > 0.3) {
      landmarkToVec(landmarks[16], aspect, this.rightHand.position);
      this.rightHand.scale.setScalar(0.09);
      this.rightHand.visible = true;
    } else this.rightHand.visible = false;

    if (this.tintTimer > 0) {
      this.tintTimer -= dt;
      const hue = (performance.now() * 0.001) % 1;
      this.material.color.setHSL(hue, 0.7, 0.55);
      this.accentMaterial.color.setHSL((hue + 0.15) % 1, 0.7, 0.45);
      if (this.tintTimer <= 0) {
        this.material.color.setHex(0x9fb3c8);
        this.accentMaterial.color.setHex(0x5d78a8);
      }
    }
  }

  hide() {
    this.group.visible = false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
}

class OneEuro {
  constructor(minCutoff = 0.6, beta = 0.004, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  _alpha(cutoff, dt) {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  }

  filter(x, t) {
    if (this.tPrev === null) {
      this.tPrev = t;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max((t - this.tPrev) / 1000, 1e-4);
    const dxRaw = (x - this.xPrev) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dx = aD * dxRaw + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dx);
    const a = this._alpha(cutoff, dt);
    const y = a * x + (1 - a) * this.xPrev;
    this.xPrev = y;
    this.dxPrev = dx;
    this.tPrev = t;
    return y;
  }
}

export function landmarkToVec(lm, aspect, out = new THREE.Vector3()) {
  const x = (0.5 - lm.x) * 2 * aspect;
  const y = (0.5 - lm.y) * 2;
  const z = -lm.z * 2;
  return out.set(x, y, z);
}

function midOf(a, b, aspect, out) {
  const av = landmarkToVec(a, aspect, new THREE.Vector3());
  const bv = landmarkToVec(b, aspect, out);
  return bv.add(av).multiplyScalar(0.5);
}

function alignBone(mesh, a, b, width) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const len = dir.length();
  mesh.position.copy(mid);
  mesh.scale.set(width, Math.max(len, 0.001), width);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
}
