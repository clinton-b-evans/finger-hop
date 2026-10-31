// Camera + MediaPipe HandLandmarker finger counting with a steady-hold debounce.

const MP_VERSION = '0.10.21';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const MP_URLS = {
  bundle: `${MP_BASE}/vision_bundle.mjs`,
  wasm: `${MP_BASE}/wasm`,
  model:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

export const HOLD_MS = 1000; // count must be steady this long before it acts
const DETECT_EVERY_MS = 66; // ~15 fps is plenty and saves battery
const SMOOTH_FRAMES = 5;

// Landmark indices
const WRIST = 0, THUMB_IP = 3, THUMB_TIP = 4, INDEX_MCP = 5, MIDDLE_MCP = 9, PINKY_MCP = 17;
const FINGERS = [
  [8, 6], // index tip, pip
  [12, 10], // middle
  [16, 14], // ring
  [20, 18], // pinky
];

/**
 * Count raised fingers on one hand.
 * @param {{x:number,y:number}[]} lm 21 normalised landmarks
 * @param {number} aspect video width / height, so x and y distances are comparable
 */
export function countFingers(lm, aspect = 1) {
  const d = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
  const palm = d(WRIST, MIDDLE_MCP) || 1e-6;
  let n = 0;
  // Four fingers: tip farther from the wrist than the PIP joint (with margin).
  for (const [tip, pip] of FINGERS) if (d(tip, WRIST) > d(pip, WRIST) * 1.15) n++;
  // Thumb: tip clearly away from the index knuckle, and farther from the pinky
  // side than its own IP joint (i.e. sticking out, not tucked across the palm).
  const thumbOut =
    d(THUMB_TIP, INDEX_MCP) > d(THUMB_IP, INDEX_MCP) * 1.2 &&
    d(THUMB_TIP, INDEX_MCP) > palm * 0.55 &&
    d(THUMB_TIP, PINKY_MCP) > d(THUMB_IP, PINKY_MCP);
  if (thumbOut) n++;
  return n;
}

function mode(arr) {
  const counts = new Map();
  let best = 0, bestN = -1;
  for (const v of arr) {
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (c > bestN || (c === bestN && v === arr[arr.length - 1])) { best = v; bestN = c; }
  }
  return best;
}

export class HandInput {
  /**
   * @param {object} o
   * @param {HTMLVideoElement} o.video
   * @param {HTMLCanvasElement} o.overlay
   * @param {(s:{count:number, progress:number, locked:boolean, hand:boolean})=>void} o.onUpdate
   * @param {(n:number)=>void} o.onCount fired once per steady count
   */
  constructor({ video, overlay, onUpdate, onCount }) {
    Object.assign(this, { video, overlay, onUpdate, onCount });
    this.facing = 'user';
    this.stream = null;
    this.landmarker = null;
    this.accepting = false; // the game sets this when the fox is ready
    this.history = [];
    this.candidate = 0;
    this.since = 0;
    this.locked = false;
    this.lockedCount = 0;
    this.zeroSince = 0;
    this.lastDetect = 0;
    this.running = false;
    this.loop = this.loop.bind(this);
  }

  get active() {
    return !!this.stream;
  }

  async start(facing = this.facing) {
    this.facing = facing;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
    this.stopStream();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if (!this.landmarker) this.landmarker = await this.createLandmarker();
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.loop);
    }
  }

  async createLandmarker() {
    const { FilesetResolver, HandLandmarker } = await import(MP_URLS.bundle);
    const fileset = await FilesetResolver.forVisionTasks(MP_URLS.wasm);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MP_URLS.model, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('GPU delegate failed, using CPU', e);
      return HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  async flip() {
    await this.start(this.facing === 'user' ? 'environment' : 'user');
  }

  stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  stop() {
    this.stopStream();
    this.running = false;
    this.reset();
    this.onUpdate({ count: 0, progress: 0, locked: false, hand: false });
  }

  reset() {
    this.history = [];
    this.candidate = 0;
    this.since = performance.now();
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const v = this.video;
    if (!this.landmarker || !this.stream || v.readyState < 2 || now - this.lastDetect < DETECT_EVERY_MS) return;
    this.lastDetect = now;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, now);
    } catch (e) {
      console.warn(e);
      return;
    }
    const aspect = (v.videoWidth || 4) / (v.videoHeight || 3);
    const hands = res.landmarks || [];
    let raw = 0;
    for (const lm of hands) raw += countFingers(lm, aspect);
    raw = Math.min(5, raw);
    this.drawOverlay(hands);
    this.step(raw, hands.length > 0, now);
  }

  /** Debounce state machine; separated out so it can be driven without a camera. */
  step(raw, hand, now) {
    this.history.push(raw);
    if (this.history.length > SMOOTH_FRAMES) this.history.shift();
    const count = mode(this.history);

    // Unlock once the hand goes away / makes a fist, or shows a different number.
    if (this.locked) {
      if (count === 0) {
        this.zeroSince ||= now;
        if (now - this.zeroSince > 250) this.locked = false;
      } else {
        this.zeroSince = 0;
        if (count !== this.lockedCount) this.locked = false;
      }
    }

    if (count !== this.candidate || !this.accepting || this.locked) {
      if (count !== this.candidate) this.candidate = count;
      this.since = now;
    }
    const progress = count > 0 && this.accepting && !this.locked ? Math.min(1, (now - this.since) / HOLD_MS) : 0;
    this.onUpdate({ count, progress, locked: this.locked, hand });

    if (progress >= 1) {
      this.locked = true;
      this.lockedCount = count;
      this.zeroSince = 0;
      this.onCount(count);
    }
  }

  drawOverlay(hands) {
    const c = this.overlay;
    const w = (c.width = c.clientWidth * 2 || 200);
    const h = (c.height = c.clientHeight * 2 || 200);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // The video uses object-fit: cover inside a square; map normalised coords the same way.
    const vw = this.video.videoWidth || 4, vh = this.video.videoHeight || 3;
    const s = Math.max(w / vw, h / vh);
    const ox = (w - vw * s) / 2, oy = (h - vh * s) / 2;
    for (const lm of hands) {
      for (const i of [4, 8, 12, 16, 20]) {
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath();
        ctx.arc(ox + lm[i].x * vw * s, oy + lm[i].y * vh * s, w * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
