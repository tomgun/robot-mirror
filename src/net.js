import Peer from "peerjs";

const PREFIX = "rm_v1_";
const POSE_SEND_INTERVAL_MS = 50; // 20Hz

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export class Net extends EventTarget {
  constructor({ role, roomCode }) {
    super();
    this.role = role; // "host" | "join"
    this.roomCode = roomCode || makeRoomCode();
    this.peerId = PREFIX + this.roomCode + (role === "join" ? "_" + Math.random().toString(36).slice(2, 8) : "");
    this.peer = null;
    this.connections = new Map(); // remotePeerId (short form) -> DataConnection
    this.lastPoseSend = 0;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _shortId(fullId) {
    return fullId.startsWith(PREFIX) ? fullId.slice(PREFIX.length) : fullId;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(this.peerId, { debug: 1 });
      this.peer.on("open", (id) => {
        this._emit("ready", { peerId: id, roomCode: this.roomCode });
        if (this.role === "join") {
          const hostFullId = PREFIX + this.roomCode;
          const conn = this.peer.connect(hostFullId, { reliable: false });
          this._registerConn(conn);
          conn.on("open", () => resolve());
          conn.on("error", (e) => reject(e));
          setTimeout(() => reject(new Error("Room not found or timed out")), 8000);
        } else {
          resolve();
        }
      });
      this.peer.on("error", (err) => {
        if (!this._hasResolved) {
          this._hasResolved = true;
          reject(err);
        } else {
          this._emit("error", err);
        }
      });
      this.peer.on("connection", (conn) => this._registerConn(conn));
    });
  }

  _registerConn(conn) {
    const shortId = this._shortId(conn.peer);
    if (this.connections.has(shortId)) return;
    this.connections.set(shortId, conn);

    conn.on("open", () => {
      this._emit("peer-added", { peerId: shortId });
      if (this.role === "host") {
        const others = Array.from(this.connections.keys())
          .filter((id) => id !== shortId)
          .map((id) => PREFIX + id);
        try {
          conn.send({ t: "peers", ids: others });
        } catch {}
      }
    });

    conn.on("data", (data) => this._handleData(shortId, data));

    conn.on("close", () => this._onConnClosed(shortId));
    conn.on("error", () => this._onConnClosed(shortId));
  }

  _onConnClosed(shortId) {
    if (!this.connections.has(shortId)) return;
    this.connections.delete(shortId);
    this._emit("peer-removed", { peerId: shortId });
  }

  _handleData(fromShortId, msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "peers":
        for (const fullId of msg.ids || []) {
          const short = this._shortId(fullId);
          if (this.connections.has(short) || short === this._shortId(this.peerId)) continue;
          const c = this.peer.connect(fullId, { reliable: false });
          this._registerConn(c);
        }
        break;
      case "pose":
        this._emit("pose", {
          peerId: fromShortId,
          landmarks: msg.landmarks,
          aspect: msg.aspect,
        });
        break;
      case "gesture":
        this._emit("gesture", {
          peerId: fromShortId,
          name: msg.name,
          wrist: msg.wrist,
          aspect: msg.aspect,
        });
        break;
      case "face":
        this._emit("face", { peerId: fromShortId, img: msg.img });
        break;
    }
  }

  broadcastFace(img) {
    if (!img) return;
    this._sendAll({ t: "face", img });
  }

  broadcastPose(landmarks, aspect) {
    if (!landmarks) return;
    const now = performance.now();
    if (now - this.lastPoseSend < POSE_SEND_INTERVAL_MS) return;
    this.lastPoseSend = now;

    // Compact landmarks — keep only x,y,z,visibility
    const compact = landmarks.map((lm) => ({
      x: +lm.x.toFixed(4),
      y: +lm.y.toFixed(4),
      z: +lm.z.toFixed(4),
      visibility: +(lm.visibility ?? 1).toFixed(2),
    }));
    const payload = { t: "pose", landmarks: compact, aspect };
    this._sendAll(payload);
  }

  broadcastGesture(name, wrist, aspect) {
    if (!wrist) return;
    const payload = {
      t: "gesture",
      name,
      wrist: {
        x: +wrist.x.toFixed(4),
        y: +wrist.y.toFixed(4),
        z: +(wrist.z ?? 0).toFixed(4),
        visibility: wrist.visibility ?? 1,
      },
      aspect,
    };
    this._sendAll(payload);
  }

  _sendAll(payload) {
    for (const conn of this.connections.values()) {
      if (conn.open) {
        try { conn.send(payload); } catch {}
      }
    }
  }

  get peerCount() {
    return this.connections.size + 1; // self included
  }

  shortSelfId() {
    return this._shortId(this.peerId);
  }

  disconnect() {
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch {}
    }
    this.connections.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch {}
    }
  }
}

export { makeRoomCode };
