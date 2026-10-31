// Sound effects (files from src/sounds.js, synth fallback) + spoken words (Web Speech API).
//
// iOS notes — why this file looks the way it does:
// - An AudioContext starts "suspended" and may only be resumed inside a user gesture
//   (touchend / click). After a phone call or backgrounding it can become "interrupted".
//   So unlockAudio() runs on EVERY tap (cheap) and resumes whatever is needed.
// - With the ring/silent switch on, Web Audio is muted unless the page's audio session is
//   "playback": iOS 17+ exposes navigator.audioSession; older iOS gets there by playing an
//   <audio> element (we loop a silent clip).
// - speechSynthesis only works after one speak() call inside a user gesture, and calling
//   cancel() immediately followed by speak() can silently drop the new utterance. Utterances
//   also need a live reference or WebKit may garbage-collect them mid-sentence.

import { SOUNDS } from './sounds.js';

const MUTE_KEY = 'fingerhop.muted';

let ctx = null;
let master = null;
const raw = {}; // name -> Promise<ArrayBuffer>
const buffers = {}; // name -> AudioBuffer
let keepAlive = null; // <audio> playing silence (older iOS silent-switch workaround)
let speechPrimed = false;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {}
const muteListeners = new Set();

/** Start downloading the sound files right away (decoded once an AudioContext exists). */
export function preloadSounds() {
  for (const [name, s] of Object.entries(SOUNDS)) {
    raw[name] ??= fetch(s.src)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .catch((e) => {
        console.warn(`sound "${name}" unavailable, using synth`, e);
        return null;
      });
  }
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: 'interactive' });
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);
  preloadSounds();
  for (const [name, p] of Object.entries(raw)) {
    p.then((ab) => {
      if (!ab) return;
      // Older Safari only has the callback form of decodeAudioData.
      return new Promise((res, rej) => ctx.decodeAudioData(ab.slice(0), res, rej));
    })
      .then((buf) => buf && (buffers[name] = buf))
      .catch((e) => console.warn(`sound "${name}" failed to decode, using synth`, e));
  }
  return ctx;
}

function silentWavUrl() {
  // 0.5 s of 8 kHz 8-bit silence.
  const n = 4000;
  const b = new ArrayBuffer(44 + n);
  const v = new DataView(b);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

/** Call from inside a user gesture (we hook every tap). Safe to call repeatedly. */
export function unlockAudio() {
  // 1) Ignore the iOS silent switch.
  let sessionSet = false;
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = 'playback';
      sessionSet = true;
    }
  } catch {}
  if (!sessionSet && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    if (!keepAlive) {
      keepAlive = new Audio(silentWavUrl());
      keepAlive.loop = true;
      keepAlive.setAttribute('playsinline', '');
      keepAlive.preload = 'auto';
    }
    if (keepAlive.paused && !document.hidden) keepAlive.play().catch(() => {});
  }

  // 2) Create / resume the AudioContext and push one silent sample through it.
  const c = ensureContext();
  if (c) {
    if (c.state !== 'running') c.resume().catch(() => {});
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch {}
  }

  // 3) Prime speech with an (empty) utterance inside this gesture.
  if ('speechSynthesis' in window) {
    if (!speechPrimed) {
      speechPrimed = true;
      try {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {}
    }
    if (speechSynthesis.paused) speechSynthesis.resume();
  }
}

/** Page hidden: stop the keep-alive clip so iOS doesn't show it as "now playing". */
export function sleepAudio() {
  keepAlive?.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ---------- mute ----------
export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {}
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.02);
  if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
  muteListeners.forEach((f) => f(muted));
}
export function onMuteChange(f) {
  muteListeners.add(f);
  f(muted);
}

// ---------- playback ----------
function play(name, { rate = 1, gain = 1 } = {}) {
  if (muted) return;
  const c = ensureContext();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {});
  const buf = buffers[name];
  if (!buf) {
    SYNTH[name]?.(rate);
    return;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = gain * (SOUNDS[name]?.gain ?? 1);
  src.connect(g).connect(master);
  src.start();
}

export const sfx = {
  boing: (step = 0) => play('boing', { rate: 1 + step * 0.08 }),
  land: () => play('land'),
  collect: () => play('collect'),
  splash: () => play('splash'),
  fanfare: () => play('fanfare'),
  oops: () => play('oops'),
  ready: () => play('ready'),
  lock: () => play('lock'),
  tap: () => play('tap'),
  star: (i = 0) => play('star', { rate: 2 ** ((i * 4) / 12) }),
};

// ---------- synth fallback (used only if a sound file is missing) ----------
function tone({ type = 'sine', f0, f1, f2, dur = 0.25, peak = 0.6, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.01 + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}
const SYNTH = {
  boing: (r) => tone({ f0: 180 * r, f1: 504 * r, f2: 288 * r, dur: 0.32, peak: 0.55 }),
  land: () => tone({ f0: 140, f1: 70, dur: 0.12, peak: 0.5 }),
  collect: () => [880, 1175, 1568, 2093].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.18, peak: 0.35, delay: i * 0.07 })),
  splash: () => {
    tone({ f0: 600, f1: 180, dur: 0.3, peak: 0.4 });
    tone({ f0: 900, f1: 300, dur: 0.2, peak: 0.25, delay: 0.15 });
  },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: i === 3 ? 0.6 : 0.14, peak: 0.35, delay: i * 0.14 })),
  oops: () => {
    tone({ type: 'triangle', f0: 440, f1: 330, dur: 0.18, peak: 0.35 });
    tone({ type: 'triangle', f0: 330, f1: 220, dur: 0.3, peak: 0.35, delay: 0.18 });
  },
  ready: () => {
    tone({ f0: 784, dur: 0.18, peak: 0.25 });
    tone({ f0: 1175, dur: 0.3, peak: 0.25, delay: 0.14 });
  },
  lock: () => {
    tone({ f0: 660, dur: 0.1, peak: 0.35 });
    tone({ f0: 990, dur: 0.16, peak: 0.35, delay: 0.08 });
  },
  tap: () => tone({ type: 'triangle', f0: 520, f1: 700, dur: 0.08, peak: 0.25 }),
  star: (r) => tone({ type: 'triangle', f0: 1047 * r, dur: 0.25, peak: 0.35 }),
};

// ---------- speech ----------
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numberWord = (n) => WORDS[n] ?? String(n);

let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  const en = vs.filter((v) => /^en/i.test(v.lang));
  voice =
    en.find((v) => /samantha|karen|moira|tessa|google uk english female|female/i.test(v.name)) ||
    en.find((v) => v.localService) ||
    en[0] ||
    vs[0];
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

const live = new Set(); // keep utterances referenced until they finish (WebKit GC bug)
let sayToken = 0;

export function say(text, { interrupt = true, rate = 0.95, pitch = 1.25 } = {}) {
  if (muted || !('speechSynthesis' in window)) return;
  const token = ++sayToken;
  const speak = () => {
    if (interrupt && token !== sayToken) return; // a newer line replaced this one
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-US';
    u.rate = rate;
    u.pitch = pitch;
    const done = () => live.delete(u);
    u.onend = done;
    u.onerror = done;
    live.add(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  };
  if (interrupt && (speechSynthesis.speaking || speechSynthesis.pending)) {
    speechSynthesis.cancel();
    setTimeout(speak, 60); // speaking right after cancel() gets dropped on iOS
  } else {
    speak();
  }
}
