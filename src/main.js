// Entry point: screens, UI wiring, camera + touch input, main render loop.

import { loadLevels, progress } from './levels.js';
import { Scene, loadImages } from './render.js';
import { Game } from './game.js';
import { HandInput } from './hands.js';
import { unlockAudio, sfx, say } from './audio.js';

const $ = (id) => document.getElementById(id);
const CAM_PREF = 'fingerhop.camera';
const RING_LEN = 2 * Math.PI * 46;
const IDLE_NUDGE_MS = 15000;

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  // When an updated worker takes over, reload once so the new version is used — but only
  // from the start/level screens, never in the middle of a level.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || $('screen-game').classList.contains('active')) return;
    location.reload();
  });
}

const [data, images] = await Promise.all([loadLevels(), loadImages()]);
const levels = data.levels;
const worlds = data.worlds || [{ id: 1, name: '', icon: '⭐' }];

// ---------- screens ----------
function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  if (name === 'game') {
    scene.resize();
    layoutStage();
  }
}
const inGame = () => $('screen-game').classList.contains('active');

// ---------- scene + game ----------
const stage = $('stage');
const scene = new Scene($('scene'), images);
let current = null; // level object
let lastAction = performance.now();
let turnInLevel = 0;

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
    if (ready) {
      lastAction = performance.now();
      startTurn();
    } else {
      hands.endTurn();
    }
  },
  win(got, total, stars) {
    progress.complete(current.id, got, stars);
    const st = $('win-stars');
    st.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.textContent = '⭐';
      s.style.animationDelay = `${0.3 + i * 0.35}s`;
      s.className = i < stars ? 'on' : 'off';
      st.appendChild(s);
      if (i < stars) setTimeout(() => sfx.star(i), 300 + i * 350);
    }
    $('win-berries').textContent = '🍓'.repeat(got);
    $('win').classList.remove('hidden');
  },
};
const game = new Game(scene, ui);

function startLevel(lv) {
  current = lv;
  turnInLevel = 0;
  $('win').classList.add('hidden');
  ui.showNumber(null);
  show('game');
  updatePadForLevel();
  game.start(lv, data.tileKey);
}

/** Each turn: calm "get ready" pause, then the camera listens for a steady count. */
function startTurn() {
  turnInLevel++;
  hands.beginTurn();
  if (hands.active && turnInLevel === 1) {
    // First turn of a level: explain once, after the level hint has been spoken.
    setTimeout(() => {
      if (hands.phase === 'ready') say('Hands down. Get ready to count!', { interrupt: false });
    }, 200);
  }
}

// ---------- level select ----------
function renderLevels() {
  const list = $('level-list');
  list.innerHTML = '';
  const done = progress.done;
  const next = levels.find((l) => !(l.id in done));
  const totalStars = Object.values(done).reduce((a, d) => a + (d.stars || 0), 0);
  $('levels-total').textContent = `⭐ ${totalStars} / ${levels.length * 3}`;
  for (const w of worlds) {
    const lvls = levels.filter((l) => (l.world ?? 1) === w.id);
    if (!lvls.length) continue;
    const sec = document.createElement('section');
    sec.className = 'world';
    sec.innerHTML = `<div class="world-head"><span class="icon">${w.icon || ''}</span><span>${w.name || ''}</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const lv of lvls) {
      const open = progress.unlocked(levels, lv);
      const d = done[lv.id];
      const b = document.createElement('button');
      b.className = 'level-btn' + (lv === next && open ? ' next' : '') + (open ? '' : ' locked');
      b.setAttribute('aria-label', `Level ${lv.id}` + (open ? '' : ' (locked)'));
      const goalImg = lv.goal.item === 'chest' ? 'chest' : 'star';
      const stars = d
        ? [0, 1, 2].map((i) => `<span class="${i < d.stars ? '' : 'off'}">⭐</span>`).join('')
        : '';
      b.innerHTML = `
        <span class="lv-num">${lv.id}</span>
        <img src="assets/${goalImg}.png" alt="">
        <span class="lv-stars">${stars}</span>
        ${open ? '' : '<span class="lock">🔒</span>'}`;
      b.addEventListener('click', () => {
        unlockAudio();
        if (!open) {
          sfx.oops();
          return;
        }
        sfx.tap();
        startLevel(lv);
      });
      grid.appendChild(b);
    }
    sec.appendChild(grid);
    list.appendChild(sec);
  }
  // Scroll the next level into view.
  requestAnimationFrame(() => list.querySelector('.next')?.scrollIntoView({ block: 'center' }));
}
function goLevels() {
  game.stop();
  hands.endTurn();
  $('win').classList.add('hidden');
  renderLevels();
  show('levels');
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
  if (game.busy) return; // ignore everything until the fox has landed and the next turn starts
  lastAction = performance.now();
  hands.endTurn();
  flashPad(Math.min(n, current?.maxHop ?? 5));
  game.move(n);
}
window.addEventListener('keydown', (e) => {
  const n = +e.key;
  if (n >= 1 && n <= 5 && inGame()) act(n);
  if ((e.key === 'Enter' || e.key === ' ') && inGame()) hands.confirm();
});

// ---------- camera ----------
const cam = $('cam');
const camNum = $('cam-num');
const ringFg = $('ring-fg');
ringFg.style.strokeDasharray = RING_LEN;
let shownNum = '';
const hands = new HandInput({
  video: $('cam-video'),
  overlay: $('cam-overlay'),
  onUpdate({ phase, count, hand, progress: p, readyLeft, needDown }) {
    // During the calm pause the ring drains; while counting it fills as the number holds steady.
    const fill = phase === 'ready' ? readyLeft : p;
    ringFg.style.strokeDashoffset = RING_LEN * (1 - fill);
    cam.classList.toggle('phase-ready', phase === 'ready');
    cam.classList.toggle('phase-off', phase === 'off');
    cam.classList.toggle('need-down', needDown);
    cam.classList.toggle('full', phase === 'ready');
    cam.classList.toggle('can-go', phase === 'count' && count > 0 && !game.busy);
    const txt = phase === 'count' && count > 0 ? String(count) : '';
    if (txt !== shownNum) {
      shownNum = txt;
      camNum.textContent = txt;
      camNum.classList.remove('pop');
      if (txt) {
        void camNum.offsetWidth;
        camNum.classList.add('pop');
      }
    }
    if (hand) lastAction = performance.now();
  },
  onPhase(phase) {
    if (phase === 'count' && inGame() && !game.busy) sfx.ready();
  },
  onCount(n) {
    sfx.lock();
    act(n);
  },
});
$('btn-go').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  unlockAudio();
  hands.confirm();
});

/** Tell the scene where the camera bubble is so the board doesn't sit under it. */
function layoutStage() {
  const sr = stage.getBoundingClientRect();
  const wide = sr.width > sr.height * 1.25;
  let top = 0, left = 0;
  if (!cam.classList.contains('hidden')) {
    const cr = cam.getBoundingClientRect();
    if (wide) left = cr.right - sr.left + 4;
    else top = cr.bottom - sr.top + 6;
  } else if (!wide) {
    top = Math.min(sr.height * 0.12, 90); // room for the big number
  }
  scene.setInsets({ top, left });
  // Big hop number goes over the board, not over the camera.
  bigNum.style.left = `${left + (sr.width - left) / 2}px`;
  bigNum.style.top = `${top + (sr.height - top) * 0.3}px`;
}
new ResizeObserver(layoutStage).observe(stage);

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
  layoutStage();
}
function stopCamera(remember = true) {
  hands.stop();
  cam.classList.add('hidden');
  $('btn-cam').classList.add('off');
  if (remember) {
    wantCamera = false;
    try { localStorage.setItem(CAM_PREF, 'off'); } catch {}
  }
  layoutStage();
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
  renderLevels();
  show('levels');
  if (wantCamera && !hands.active) startCamera();
});
$('btn-levels-back').addEventListener('click', () => {
  sfx.tap();
  show('start');
});
$('btn-home').addEventListener('click', () => {
  sfx.tap();
  goLevels();
});
$('btn-hint').addEventListener('click', () => {
  unlockAudio();
  game.sayHint();
});
$('btn-win-home').addEventListener('click', () => {
  sfx.tap();
  goLevels();
});
$('btn-next').addEventListener('click', () => {
  sfx.tap();
  const i = levels.indexOf(current);
  if (i < levels.length - 1) startLevel(levels[i + 1]);
  else goLevels();
});

// ---------- main loop ----------
let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  if (inGame()) {
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
