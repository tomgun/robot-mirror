import * as THREE from "three";

// -----------------------------------------------------------
// Fireworks particle burst
// -----------------------------------------------------------
export class Fireworks {
  constructor(scene, maxBursts = 24, particlesPerBurst = 180) {
    this.scene = scene;
    this.maxBursts = maxBursts;
    this.particlesPerBurst = particlesPerBurst;
    this.bursts = [];

    const geometry = new THREE.BufferGeometry();
    this.capacity = maxBursts * particlesPerBurst;
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);

    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.nextIndex = 0;
  }

  burst(position, color = new THREE.Color().setHSL(Math.random(), 0.9, 0.6)) {
    const start = this.nextIndex;
    for (let i = 0; i < this.particlesPerBurst; i++) {
      const idx = (this.nextIndex + i) % this.capacity;
      const p = idx * 3;

      this.positions[p] = position.x;
      this.positions[p + 1] = position.y;
      this.positions[p + 2] = position.z;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.5 + Math.random() * 1.5;
      this.velocities[p] = Math.sin(phi) * Math.cos(theta) * speed;
      this.velocities[p + 1] = Math.cos(phi) * speed;
      this.velocities[p + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      const c = color.clone();
      c.offsetHSL((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.15);
      this.colors[p] = c.r;
      this.colors[p + 1] = c.g;
      this.colors[p + 2] = c.b;

      const life = 0.9 + Math.random() * 0.8;
      this.life[idx] = life;
      this.maxLife[idx] = life;
    }
    this.nextIndex = (start + this.particlesPerBurst) % this.capacity;
  }

  update(dt) {
    const g = -1.2;
    const drag = Math.pow(0.6, dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        const p = i * 3;
        this.positions[p + 1] = -9999;
        continue;
      }
      this.life[i] -= dt;
      const p = i * 3;
      this.velocities[p] *= drag;
      this.velocities[p + 1] = this.velocities[p + 1] * drag + g * dt;
      this.velocities[p + 2] *= drag;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;

      const fade = Math.max(this.life[i] / this.maxLife[i], 0);
      this.colors[p] *= 0.995;
      this.colors[p + 1] *= 0.995;
      this.colors[p + 2] *= 0.995;
      // keep color visible; fade via alpha is tough with vertexColors — use size instead
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// -----------------------------------------------------------
// Warp shader pass
// -----------------------------------------------------------
export const WarpShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);
      float ripple = sin(d * 28.0 - uTime * 10.0) * uStrength * 0.03;
      uv += normalize(c + 1e-6) * ripple;

      float ca = uStrength * 0.012;
      vec4 r = texture2D(tDiffuse, uv + vec2(ca, 0.0));
      vec4 g = texture2D(tDiffuse, uv);
      vec4 b = texture2D(tDiffuse, uv - vec2(ca, 0.0));
      vec3 col = vec3(r.r, g.g, b.b);

      col += uStrength * 0.25 * vec3(0.4, 0.6, 1.0) * (1.0 - d);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// -----------------------------------------------------------
// Shockwave: expanding ring + flash
// -----------------------------------------------------------
export class Shockwaves {
  constructor(scene, maxRings = 8) {
    this.scene = scene;
    this.rings = [];
    this.maxRings = maxRings;
  }

  spawn(position, color = 0xaaffff) {
    const geom = new THREE.RingGeometry(0.05, 0.08, 64);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0, max: 0.9 });
    if (this.rings.length > this.maxRings) {
      const oldest = this.rings.shift();
      this.scene.remove(oldest.mesh);
      oldest.mesh.geometry.dispose();
      oldest.mesh.material.dispose();
    }
  }

  update(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      const t = r.life / r.max;
      const scale = 0.1 + t * 3.5;
      r.mesh.scale.setScalar(scale);
      r.mesh.material.opacity = Math.max(1 - t, 0);
      if (r.life >= r.max) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}

// -----------------------------------------------------------
// Lightning: animated zigzag line going upward
// -----------------------------------------------------------
export class Lightning {
  constructor(scene, maxBolts = 6) {
    this.scene = scene;
    this.bolts = [];
    this.maxBolts = maxBolts;
  }

  strike(origin) {
    const segments = 14;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const jitter = (Math.random() - 0.5) * 0.15 * (1 - Math.abs(t - 0.5) * 2 + 0.1);
      points.push(new THREE.Vector3(
        origin.x + jitter,
        origin.y + t * 2.5,
        origin.z + (Math.random() - 0.5) * 0.1,
      ));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xbbeeff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.bolts.push({ line, life: 0, max: 0.25 });
    if (this.bolts.length > this.maxBolts) {
      const old = this.bolts.shift();
      this.scene.remove(old.line);
      old.line.geometry.dispose();
      old.line.material.dispose();
    }
  }

  update(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life += dt;
      const t = b.life / b.max;
      b.line.material.opacity = Math.max(1 - t, 0) * (0.6 + 0.4 * Math.random());
      if (b.life >= b.max) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        b.line.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }
}
