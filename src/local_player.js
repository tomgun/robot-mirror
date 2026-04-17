import { createDetectors, startCamera } from "./detector.js";

const GESTURE_COOLDOWN_MS = 700;
const FACE_INTERVAL_MS = 250;
const FACE_SIZE = 96;

export class LocalPlayer {
  constructor({ video }) {
    this.video = video;
    this.detectors = null;
    this.stream = null;
    this.running = false;

    this.onPose = null;
    this.onGesture = null;
    this.onFace = null;

    this.lastPoseMs = -1;
    this.lastGestureMs = -1;
    this.gestureCooldowns = new Map();

    this.faceEnabled = false;
    this._lastFaceSend = 0;
    this._faceCanvas = document.createElement("canvas");
    this._faceCanvas.width = FACE_SIZE;
    this._faceCanvas.height = FACE_SIZE;
    this._faceCtx = this._faceCanvas.getContext("2d", { willReadFrequently: false });
  }

  async start() {
    this.detectors = await createDetectors({ maxPeople: 1 });
    this.stream = await startCamera(this.video);
    this.running = true;
    requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  get videoAspect() {
    if (!this.video.videoWidth) return 16 / 9;
    return this.video.videoWidth / this.video.videoHeight;
  }

  _loop() {
    if (!this.running) return;
    if (this.video.readyState >= 2 && this.detectors && this.video.videoWidth > 0) {
      const now = performance.now();
      const videoAspect = this.videoAspect;

      const poseTs = Math.floor(now);
      let first = null;
      if (poseTs > this.lastPoseMs) {
        const result = this.detectors.pose.detectForVideo(this.video, poseTs);
        this.lastPoseMs = poseTs;
        first = (result.landmarks && result.landmarks[0]) || null;
        if (this.onPose) this.onPose(first, videoAspect);
      }

      if (this.faceEnabled && first && now - this._lastFaceSend > FACE_INTERVAL_MS) {
        this._lastFaceSend = now;
        const img = this._captureFace(first);
        if (img && this.onFace) this.onFace(img);
      }

      const gTs = poseTs + 1;
      if (gTs > this.lastGestureMs) {
        const g = this.detectors.gesture.recognizeForVideo(this.video, gTs);
        this.lastGestureMs = gTs;
        const gestures = g.gestures || [];
        const handLms = g.landmarks || [];
        for (let i = 0; i < gestures.length; i++) {
          const top = gestures[i][0];
          if (!top || top.score < 0.65 || top.categoryName === "None") continue;
          const key = `${i}:${top.categoryName}`;
          const last = this.gestureCooldowns.get(key) || 0;
          if (now - last < GESTURE_COOLDOWN_MS) continue;
          this.gestureCooldowns.set(key, now);
          if (this.onGesture) this.onGesture(top.categoryName, handLms[i], videoAspect);
        }
      }
    }
    requestAnimationFrame(() => this._loop());
  }

  _captureFace(landmarks) {
    const faceIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    let any = false;
    for (const i of faceIndices) {
      const lm = landmarks[i];
      if (!lm || (lm.visibility ?? 1) < 0.3) continue;
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
      any = true;
    }
    if (!any || maxX <= minX || maxY <= minY) return null;

    // Square up and pad
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const half = Math.max(maxX - minX, maxY - minY) * 0.85;
    minX = cx - half; maxX = cx + half;
    minY = cy - half; maxY = cy + half;
    minX = Math.max(0, minX); maxX = Math.min(1, maxX);
    minY = Math.max(0, minY); maxY = Math.min(1, maxY);

    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const sx = minX * vw, sy = minY * vh;
    const sw = (maxX - minX) * vw, sh = (maxY - minY) * vh;
    if (sw <= 0 || sh <= 0) return null;

    const size = FACE_SIZE;
    const ctx = this._faceCtx;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    try {
      ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, size, size);
    } catch {
      ctx.restore();
      return null;
    }
    ctx.restore();

    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    return this._faceCanvas.toDataURL("image/jpeg", 0.55);
  }
}
