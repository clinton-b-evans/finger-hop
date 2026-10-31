"""Authoring tool (not needed at runtime): renders the placeholder sound effects
into assets/sfx/*.wav. Replace any of those files (or point src/sounds.js at new
ones, e.g. from Envato Elements) to change a sound; no code changes needed.
Run: python3 tools/make_sfx.py"""
import numpy as np, wave, os, sys

SR = 24000
OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/sfx'

def env(n, a, d, peak):
    t = np.arange(n) / SR
    e = np.where(t < a, (t / a), np.exp(-(t - a) / (d / 5)))
    return e * peak

def sweep(f0, f1=None, f2=None, dur=0.25):
    n = int(SR * dur); t = np.arange(n) / SR
    if f1 is None: f = np.full(n, f0)
    else:
        k = 0.45 * dur
        f = np.where(t < k, f0 * (f1 / f0) ** (t / k), f1 * ((f2 or f1) / f1) ** ((t - k) / (dur - k)))
    return 2 * np.pi * np.cumsum(f) / SR

def osc(kind, ph):
    if kind == 'sine': return np.sin(ph)
    if kind == 'triangle': return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == 'square': return np.sign(np.sin(ph)) * 0.6
    raise ValueError(kind)

def tone(kind, f0, f1=None, f2=None, dur=0.25, peak=0.6, delay=0.0):
    ph = sweep(f0, f1, f2, dur + 0.05)
    s = osc(kind, ph) * env(len(ph), 0.01, dur, peak)
    return np.concatenate([np.zeros(int(SR * delay)), s])

def noise(dur, peak=0.7):
    n = int(SR * dur); x = np.random.default_rng(1).uniform(-1, 1, n)
    # crude falling band-pass: smooth more as time goes on
    out = np.zeros(n); y = 0
    for i in range(n):
        a = 0.6 - 0.55 * i / n
        y = y + a * (x[i] - y); out[i] = y
    out = out - np.convolve(out, np.ones(30) / 30, 'same')
    return out / (np.abs(out).max() + 1e-9) * env(n, 0.02, dur, peak)

def mix(*parts):
    n = max(len(p) for p in parts); o = np.zeros(n)
    for p in parts: o[:len(p)] += p
    return o

def save(name, x):
    x = x / max(1.0, np.abs(x).max() / 0.9)
    tail = int(SR * 0.02); x = np.concatenate([x, np.zeros(tail)])
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())

os.makedirs(OUT, exist_ok=True)
save('boing', mix(tone('sine', 180, 504, 288, 0.32, 0.55), tone('triangle', 360, 720, None, 0.12, 0.12)))
save('land', tone('sine', 140, 70, None, 0.12, 0.5))
save('collect', mix(*[tone('triangle', f, dur=0.18, peak=0.35, delay=i * 0.07) for i, f in enumerate([880, 1175, 1568, 2093])]))
save('splash', mix(noise(0.5), tone('sine', 600, 180, None, 0.3, 0.4, 0.02), tone('sine', 900, 300, None, 0.2, 0.25, 0.15)))
notes = [(523, 0, .14), (659, .14, .14), (784, .28, .14), (1047, .42, .22), (784, .62, .12), (1047, .74, .6)]
save('fanfare', mix(*[tone('square', f, dur=l, peak=0.15, delay=t) for f, t, l in notes],
                    *[tone('triangle', f, dur=l + 0.05, peak=0.35, delay=t) for f, t, l in notes]))
save('oops', mix(tone('triangle', 440, 330, None, 0.18, 0.35), tone('triangle', 330, 220, None, 0.3, 0.35, 0.18)))
save('ready', mix(tone('sine', 784, dur=0.18, peak=0.25), tone('sine', 1175, dur=0.3, peak=0.25, delay=0.14)))
save('lock', mix(tone('sine', 660, dur=0.1, peak=0.35), tone('sine', 990, dur=0.16, peak=0.35, delay=0.08)))
save('tap', tone('triangle', 520, 700, None, 0.08, 0.25))
save('star', tone('triangle', 1047, dur=0.25, peak=0.35))
print('wrote', sorted(os.listdir(OUT)))
