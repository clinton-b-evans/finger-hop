// Audio: sound effects, voice lines and music (files listed in sounds.js, played through
// Web Audio), spoken sentences (Web Speech API), mute + music toggles.
//
// iOS notes — why this file looks the way it does:
// - An AudioContext starts "suspended" and may only be resumed inside a user gesture, and
//   iOS can "interrupt" it again after calls/Siri/backgrounding. So unlockAudio() runs on
//   EVERY tap (cheap) and resumes whatever is needed. The start screen is one big tap target.
// - With the ring/silent switch on, Web Audio is muted unless the page's audio session is
//   "playback": iOS 17+ exposes navigator.audioSession; older iOS gets there by playing an
//   <audio> element (we loop a silent clip).
// - speechSynthesis only works after one speak() inside a gesture; speak() right after
//   cancel() can be dropped; utterances need a live reference or WebKit may GC them.
// - Safari can't reliably decode Ogg Vorbis, so mp3 is preferred unless the browser says it
//   "probably" plays Ogg; a failed decode falls back to the next listed format.

import { SOUNDS, AUDIO_BASE } from './sounds.js';

const MUTE_KEY = 'fingerhop.muted';
const MUSIC_KEY = 'fingerhop.music';
const MASTER = 0.9;
const DUCK = 0.35; // music level while a voice line / sentence plays

const stored = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const store = (k, v) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {}
};

let ctx = null;
let master = null; // everything
let musicBus = null; // music only (for the music toggle + ducking)
let keepAlive = null; // <audio> playing silence (older iOS silent-switch workaround)
let speechPrimed = false;
let muted = stored(MUTE_KEY, false);
let musicOn = stored(MUSIC_KEY, true);
const listeners = new Set();

// ---------- loading ----------
const oggFirst =
  typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"') === 'probably';
const order = (formats) => (oggFirst ? formats : [...formats].sort((a, b) => (a === 'mp3' ? -1 : b === 'mp3' ? 1 : 0)));
const urlOf = (name, fmt) => `${AUDIO_BASE}${SOUNDS[name].file}.${fmt}`;

const bytes = {}; // name -> Promise<ArrayBuffer|null> for the preferred format
const buffers = {}; // name -> AudioBuffer
const decoding = {}; // name -> Promise<AudioBuffer|null>

const fetchBytes = (url) =>
  fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);

/** Start downloading effects + voice right away (music loads when first played). */
export function preloadSounds() {
  for (const [name, s] of Object.entries(SOUNDS)) {
    if (s.kind !== 'music') bytes[name] ??= fetchBytes(urlOf(name, order(s.formats)[0]));
  }
}

function decode(ab) {
  // Older Safari only has the callback form of decodeAudioData.
  return new Promise((res, rej) => ctx.decodeAudioData(ab.slice(0), res, rej));
}

/** Decode a sound, trying each listed format until one works. */
function load(name) {
  if (decoding[name]) return decoding[name];
  const formats = order(SOUNDS[name].formats);
  decoding[name] = (async () => {
    for (const [i, fmt] of formats.entries()) {
      const ab = i === 0 && bytes[name] ? await bytes[name] : await fetchBytes(urlOf(name, fmt));
      if (!ab) continue;
      try {
        return (buffers[name] = await decode(ab));
      } catch {
        /* try the next format */
      }
    }
    console.warn(`sound "${name}" unavailable`);
    return null;
  })();
  return decoding[name];
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: 'interactive' });
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = musicOn ? 1 : 0;
  musicBus.connect(master);
  preloadSounds();
  for (const [name, s] of Object.entries(SOUNDS)) if (s.kind !== 'music') load(name);
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

/** Call from inside a user gesture (main.js hooks every tap). Safe to call repeatedly. */
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

  // 3) Prime speech with an empty utterance inside this gesture.
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

/** Page hidden: pause music + speech, release the silent clip. */
export function sleepAudio() {
  keepAlive?.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  ctx?.suspend().catch(() => {});
}

// ---------- settings ----------
export const isMuted = () => muted;
export const isMusicOn = () => musicOn;
function ramp(node, v) {
  if (node && ctx) node.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
}
export function setMuted(m) {
  muted = !!m;
  store(MUTE_KEY, muted);
  ramp(master, muted ? 0 : MASTER);
  if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
  listeners.forEach((f) => f());
}
export function setMusicOn(on) {
  musicOn = !!on;
  store(MUSIC_KEY, musicOn);
  ramp(musicBus, musicOn ? 1 : 0);
  listeners.forEach((f) => f());
}
/** Called now and whenever mute / music settings change. */
export function onAudioSettings(f) {
  listeners.add(f);
  f();
}

// ---------- playback ----------
let duckUntil = 0;
function duck(seconds) {
  if (!ctx || !musicOn) return;
  duckUntil = Math.max(duckUntil, ctx.currentTime + seconds);
  musicBus.gain.setTargetAtTime(DUCK, ctx.currentTime, 0.05);
  setTimeout(() => {
    if (ctx.currentTime >= duckUntil - 0.05 && musicOn) ramp(musicBus, 1);
  }, seconds * 1000 + 60);
}

/** Play a sound by name; returns false if no file is ready (callers may fall back). */
function play(name, { rate = 1, gain = 1, bus = master } = {}) {
  if (muted) return true;
  const c = ensureContext();
  if (!c) return false;
  if (c.state !== 'running') c.resume().catch(() => {});
  const buf = buffers[name];
  if (!buf) {
    load(name);
    return false;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = gain * (SOUNDS[name]?.gain ?? 1);
  src.connect(g).connect(bus);
  src.start();
  if (SOUNDS[name]?.kind === 'voice') duck(buf.duration / rate);
  return true;
}

export const sfx = {
  hop: (step = 0) => play('hop', { rate: 1 + Math.min(step, 5) * 0.04 }) || synth.hop(),
  land: () => play('land') || synth.land(),
  collect: (type) => play(type === 'gem' ? 'star' : 'coin') || synth.collect(),
  correct: () => play('correct') || synth.ready(),
  tryAgain: () => play('tryAgain') || synth.oops(),
  splash: () => synth.splash(),
  ready: () => synth.ready(), // soft "your turn" chime when counting opens
  levelComplete: () => play('levelComplete') || synth.fanfare(),
  cheer: () => play('cheer'),
  tap: () => play('tap') || synth.tap(),
  star: (i = 0) => play('star', { rate: 2 ** ((i * 3) / 12) }) || synth.star(i),
};

const NUMBER_VOICES = [null, 'one', 'two', 'three', 'four', 'five'];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numberWord = (n) => WORDS[n] ?? String(n);

/** Recorded voice lines, with speech-synthesis fallback. */
export const voice = {
  number(n) {
    const name = NUMBER_VOICES[n];
    if (!(name && play(name))) say(numberWord(n), { rate: 1.05 });
  },
  // Flourishes: skipped (not replaced by robot speech) if the file isn't decoded yet.
  greatJob: () => play('greatJob'),
  hopHop: () => play('hopHop'),
};

// ---------- music ----------
let musicSrc = null;
let musicWanted = null;
/** Play a music track ('musicLoop' | 'jingle'); null stops. Respects mute + music toggle. */
export async function playMusic(name) {
  if (musicWanted === name && musicSrc) return;
  musicWanted = name;
  try {
    musicSrc?.stop();
  } catch {}
  musicSrc = null;
  if (!name || !ensureContext()) return;
  const buf = await load(name);
  if (!buf || musicWanted !== name || musicSrc) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = !!SOUNDS[name].loop;
  const g = ctx.createGain();
  g.gain.value = SOUNDS[name].gain;
  src.connect(g).connect(musicBus);
  src.onended = () => {
    if (musicSrc === src) {
      musicSrc = null;
      if (musicWanted === name) musicWanted = null;
    }
  };
  src.start();
  musicSrc = src;
}

// ---------- synth fallback ----------
function tone({ type = 'sine', f0, f1, f2, dur = 0.25, peak = 0.6, delay = 0 }) {
  if (!ctx || muted) return;
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
function noise(dur) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2500, t);
  bp.frequency.exponentialRampToValueAtTime(400, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}
const synth = {
  hop: () => tone({ f0: 180, f1: 504, f2: 288, dur: 0.32, peak: 0.55 }),
  land: () => tone({ f0: 140, f1: 70, dur: 0.12, peak: 0.5 }),
  collect: () => [880, 1175, 1568, 2093].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.18, peak: 0.35, delay: i * 0.07 })),
  splash: () => {
    noise(0.5);
    tone({ f0: 600, f1: 180, dur: 0.3, peak: 0.4, delay: 0.02 });
    tone({ f0: 900, f1: 300, dur: 0.2, peak: 0.25, delay: 0.15 });
  },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: i === 3 ? 0.6 : 0.14, peak: 0.35, delay: i * 0.14 })),
  oops: () => {
    tone({ type: 'triangle', f0: 440, f1: 330, dur: 0.18, peak: 0.35 });
    tone({ type: 'triangle', f0: 330, f1: 220, dur: 0.3, peak: 0.35, delay: 0.18 });
  },
  ready: () => {
    tone({ f0: 784, dur: 0.18, peak: 0.22 });
    tone({ f0: 1175, dur: 0.3, peak: 0.22, delay: 0.14 });
  },
  tap: () => tone({ type: 'triangle', f0: 520, f1: 700, dur: 0.08, peak: 0.25 }),
  star: (i) => tone({ type: 'triangle', f0: 1047 * 2 ** ((i * 4) / 12), dur: 0.25, peak: 0.35 }),
};

// ---------- speech (sentences; numbers + praise use the recorded voice) ----------
let ttsVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  const en = vs.filter((v) => /^en/i.test(v.lang));
  ttsVoice =
    en.find((v) => /samantha|karen|moira|tessa|google uk english female|female/i.test(v.name)) ||
    en.find((v) => v.localService) ||
    en[0] ||
    vs[0];
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

const live = new Set(); // keep utterances referenced until they finish (WebKit GC bug)
let sayToken = 0;

export function say(text, { interrupt = true, rate = 0.95, pitch = 1.25 } = {}) {
  if (muted || !('speechSynthesis' in window)) return true;
  const token = ++sayToken;
  const speak = () => {
    if (interrupt && token !== sayToken) return; // a newer line replaced this one
    const u = new SpeechSynthesisUtterance(text);
    if (ttsVoice) u.voice = ttsVoice;
    u.lang = ttsVoice?.lang || 'en-US';
    u.rate = rate;
    u.pitch = pitch;
    const done = () => live.delete(u);
    u.onend = done;
    u.onerror = done;
    live.add(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
    duck(Math.max(1, text.length * 0.07));
  };
  if (interrupt && (speechSynthesis.speaking || speechSynthesis.pending)) {
    speechSynthesis.cancel();
    setTimeout(speak, 60); // speaking right after cancel() gets dropped on iOS
  } else {
    speak();
  }
  return true;
}
