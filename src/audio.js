// Synthesised sound effects (WebAudio) + spoken words (Web Speech API).
// Everything is created lazily on the first user gesture (required by iOS/Chrome autoplay rules).

let ctx = null;
let master = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  // iOS needs one utterance inside a gesture before later ones are allowed.
  if ('speechSynthesis' in window && !unlockAudio.spoke) {
    unlockAudio.spoke = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone({ type = 'sine', f0, f1, f2, dur = 0.25, peak = 0.6, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, 0.01, peak, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, delay = 0) {
  const t = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(2500, t);
  bp.frequency.exponentialRampToValueAtTime(400, t + dur);
  const g = ctx.createGain();
  env(g, t, 0.02, 0.7, dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  boing(step = 0) {
    const base = 180 + step * 30;
    tone({ type: 'sine', f0: base, f1: base * 2.8, f2: base * 1.6, dur: 0.32, peak: 0.55 });
    tone({ type: 'triangle', f0: base * 2, f1: base * 4, dur: 0.12, peak: 0.12 });
  },
  land() {
    tone({ type: 'sine', f0: 140, f1: 70, dur: 0.12, peak: 0.5 });
  },
  collect() {
    [880, 1175, 1568, 2093].forEach((f, i) =>
      tone({ type: 'triangle', f0: f, dur: 0.18, peak: 0.35, delay: i * 0.07 }));
  },
  splash() {
    if (!ctx) return;
    noise(0.5);
    tone({ type: 'sine', f0: 600, f1: 180, dur: 0.3, peak: 0.4, delay: 0.02 });
    tone({ type: 'sine', f0: 900, f1: 300, dur: 0.2, peak: 0.25, delay: 0.15 });
  },
  lock() {
    tone({ type: 'sine', f0: 660, dur: 0.1, peak: 0.35 });
    tone({ type: 'sine', f0: 990, dur: 0.16, peak: 0.35, delay: 0.08 });
  },
  tap() {
    tone({ type: 'triangle', f0: 520, f1: 700, dur: 0.08, peak: 0.25 });
  },
  fanfare() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    const times = [0, 0.14, 0.28, 0.42, 0.62, 0.74];
    const lens = [0.14, 0.14, 0.14, 0.22, 0.12, 0.6];
    notes.forEach((f, i) => {
      tone({ type: 'square', f0: f, dur: lens[i], peak: 0.15, delay: times[i] });
      tone({ type: 'triangle', f0: f, dur: lens[i] + 0.05, peak: 0.35, delay: times[i] });
    });
  },
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
  // Prefer friendly-sounding, local voices.
  voice =
    en.find((v) => /samantha|karen|moira|tessa|google uk english female|female/i.test(v.name)) ||
    en.find((v) => v.localService) ||
    en[0] || vs[0];
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function say(text, { interrupt = true, rate = 0.95, pitch = 1.25 } = {}) {
  if (!('speechSynthesis' in window)) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
  u.rate = rate;
  u.pitch = pitch;
  speechSynthesis.speak(u);
}
