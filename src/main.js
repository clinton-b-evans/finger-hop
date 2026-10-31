// Entry point: screens, UI wiring, camera + touch input, main render loop.

import { loadLevels, progress } from './levels.js';
import { Scene, loadImages } from './render.js';
import { Game } from './game.js';
import { HandInput } from './hands.js';
import { unlockAudio, sfx, say } from './audio.js';

const $ = (id) => document.getElementById(id);
const CAM_PREF = 'fingerhop.camera';
const RING_LEN = 2 * Math.PI * 46;
const IDLE_NUDGE_MS = 14000;

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}

const [data, images] = await Promise.all([loadLevels(), loadImages()]);
const levels = data.levels;

// ---------- screens ----------
function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  if (name === 'game') scene.resize();
}

// ---------- scene + game ----------
const scene = new Scene($('scene'), images);
let current = null; // level object
let lastAction = performance.now();

const bigNum = $('big-num');
const ui = {
  showNumber(n, kind = 'show') {
    bigNum.className = 'big-num';
    if (n === null || n === undefined) return;
    bigNum.textContent = n;
    void bigNum.offsetWidth; // restart the CSS animation
    bigNum.classList.add(kind === 'count' ? 'count' : 'show');
    if (kind === 'splash') bigNum.classList.add('splash');
  },
  setBerries(got, total, pop = false) {
    const el = $('berry-count');
    el.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const s = document.createElement('span');
      s.textContent = '🍓';
      s.className = i < got ? (pop && i === got - 1 ? 'got' : '') : 'miss';
      el.appendChild(s);
    }
  },
  setReady(ready) {
    $('pad').classList.toggle('busy', !ready);
    hands.accepting = ready;
    if (ready) lastAction = performance.now();
  },
  win(got, total) {
    progress.complete(current.id, got);
    $('win-berries').textContent = '🍓'.repeat(got) || '⭐';
    $('win').classList.remove('hidden');
    renderLevelGrid();
  },
};
const game = new Game(scene, ui);

function startLevel(lv) {
  current = lv;
  $('win').classList.add('hidden');
  ui.showNumber(null);
  show('game');
  updatePadForLevel();
  game.start(lv, data.tileKey);
}

// ---------- level select ----------
function renderLevelGrid() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  const done = progress.done;
  const next = levels.find((l) => !(l.id in done));
  for (const lv of levels) {
    const b = document.createElement('button');
    b.className = 'level-btn' + (lv === next ? ' next' : '');
    b.setAttribute('aria-label', 'Level ' + lv.id);
    const goalImg = lv.goal.item === 'chest' ? 'chest' : 'star';
    const berries = lv.id in done ? '🍓'.repeat(done[lv.id]) : '';
    b.innerHTML = `
      <span class="lv-num">${lv.id}</span>
      ${lv.id in done ? '<span class="lv-done">✅</span>' : ''}
      <img src="assets/${goalImg}.png" alt="">
      <span class="lv-berries">${berries}</span>`;
    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startLevel(lv);
    });
    grid.appendChild(b);
  }
}

// ---------- touch pad ----------
const pad = $('pad');
for (let n = 1; n <= 5; n++) {
  const b = document.createElement('button');
  b.dataset.n = n;
  b.setAttribute('aria-label', `Hop ${n}`);
  b.innerHTML = `<span class="n">${n}</span><span class="dots">${'<i></i>'.repeat(n)}</span>`;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    act(n);
  });
  pad.appendChild(b);
}
function updatePadForLevel() {
  pad.querySelectorAll('button').forEach((b) => b.classList.toggle('dim', +b.dataset.n > current.maxHop));
}
function flashPad(n) {
  const b = pad.querySelector(`[data-n="${n}"]`);
  if (!b) return;
  b.classList.add('hit');
  setTimeout(() => b.classList.remove('hit'), 300);
}
function act(n) {
  if (game.busy) return;
  lastAction = performance.now();
  flashPad(Math.min(n, current?.maxHop ?? 5));
  game.move(n);
}
window.addEventListener('keydown', (e) => {
  const n = +e.key;
  if (n >= 1 && n <= 5 && $('screen-game').classList.contains('active')) act(n);
});

// ---------- camera ----------
const cam = $('cam');
const ringFg = $('ring-fg');
ringFg.style.strokeDasharray = RING_LEN;
const hands = new HandInput({
  video: $('cam-video'),
  overlay: $('cam-overlay'),
  onUpdate({ count, progress: p, locked, hand }) {
    ringFg.style.strokeDashoffset = RING_LEN * (1 - p);
    $('cam-count').textContent = hand && count > 0 ? count : '';
    cam.classList.toggle('locked', locked);
    if (hand) lastAction = performance.now();
  },
  onCount(n) {
    sfx.lock();
    act(n);
  },
});

let wantCamera = localStorage.getItem(CAM_PREF) !== 'off';
async function startCamera() {
  try {
    await hands.start();
    cam.classList.remove('hidden');
    cam.classList.toggle('mirror', hands.facing === 'user');
    $('btn-cam').classList.remove('off');
  } catch (e) {
    console.warn('camera unavailable, touch buttons only', e);
    stopCamera(false);
  }
}
function stopCamera(remember = true) {
  hands.stop();
  cam.classList.add('hidden');
  $('btn-cam').classList.add('off');
  if (remember) {
    wantCamera = false;
    try { localStorage.setItem(CAM_PREF, 'off'); } catch {}
  }
}
$('btn-cam').addEventListener('click', () => {
  unlockAudio();
  if (hands.active) {
    stopCamera();
  } else {
    wantCamera = true;
    try { localStorage.removeItem(CAM_PREF); } catch {}
    startCamera();
  }
});
$('btn-flip').addEventListener('click', async () => {
  try {
    await hands.flip();
    cam.classList.toggle('mirror', hands.facing === 'user');
  } catch (e) {
    console.warn(e);
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (hands.active) hands.stop();
    speechSynthesis?.cancel();
  } else if (wantCamera && !hands.active && !$('screen-start').classList.contains('active')) {
    startCamera();
  }
});

// ---------- buttons ----------
$('btn-play').addEventListener('click', () => {
  unlockAudio();
  sfx.tap();
  say('Hi! Let’s hop!');
  renderLevelGrid();
  show('levels');
  if (wantCamera && !hands.active) startCamera();
});
$('btn-home').addEventListener('click', () => {
  sfx.tap();
  game.stop();
  hands.accepting = false;
  renderLevelGrid();
  show('levels');
});
$('btn-hint').addEventListener('click', () => {
  unlockAudio();
  game.sayHint();
});
$('btn-win-home').addEventListener('click', () => {
  sfx.tap();
  $('win').classList.add('hidden');
  renderLevelGrid();
  show('levels');
});
$('btn-next').addEventListener('click', () => {
  sfx.tap();
  const i = levels.indexOf(current);
  if (i < levels.length - 1) startLevel(levels[i + 1]);
  else {
    $('win').classList.add('hidden');
    renderLevelGrid();
    show('levels');
  }
});

// ---------- main loop ----------
let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  if ($('screen-game').classList.contains('active')) {
    scene.draw(now, dt);
    // Gentle voice nudge when nothing has happened for a while.
    if (!game.busy && now - lastAction > IDLE_NUDGE_MS && $('win').classList.contains('hidden')) {
      lastAction = now;
      say(hands.active ? 'Show me fingers!' : 'Tap a number!');
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.fingerHop = { game, hands, scene, levels };
