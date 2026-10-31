// App shell: boot, screens, level select, game wiring, camera + touch input, render loop.

import { loadLevels, progress } from './levels.js';
import { Scene, loadImages } from './render.js';
import { Game } from './game.js';
import { HandInput } from './hands.js';
import {
  unlockAudio,
  sleepAudio,
  preloadSounds,
  sfx,
  voice,
  say,
  playMusic,
  isMuted,
  setMuted,
  isMusicOn,
  setMusicOn,
  onAudioSettings,
} from './audio.js';
import { loadCharacters, look, sanitizeLook, paintAvatar, unlockedOutfits } from './characters.js';
import { createWardrobe } from './wardrobe.js';

const $ = (id) => document.getElementById(id);
const CAM_PREF = 'fingerhop.camera';
const RING_LEN = 2 * Math.PI * 46;
const IDLE_NUDGE_MS = 15000;

// ---------- service worker ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  // When an updated worker takes over, reload once so the new version is used, but only
  // from a menu screen, never in the middle of a level.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || $('screen-game').classList.contains('active')) return;
    location.reload();
  });
}

// ---------- sound settings ----------
preloadSounds();
// Every tap/click/key (re)unlocks audio + speech: iOS needs a gesture, and can
// suspend audio again after calls, Siri or backgrounding.
for (const ev of ['touchend', 'pointerdown', 'click', 'keydown']) {
  document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}
onAudioSettings(() => {
  const m = isMuted();
  document.querySelectorAll('.mute-btn').forEach((b) => {
    b.textContent = m ? '🔇' : '🔊';
    b.classList.toggle('muted', m);
    b.setAttribute('aria-pressed', String(m));
  });
  document.querySelectorAll('.music-btn').forEach((b) => {
    b.classList.toggle('muted', !isMusicOn());
    b.setAttribute('aria-pressed', String(!isMusicOn()));
  });
});
document.addEventListener('click', (e) => {
  if (e.target.closest?.('.mute-btn')) {
    e.stopPropagation();
    setMuted(!isMuted());
    if (!isMuted()) sfx.tap();
  } else if (e.target.closest?.('.music-btn')) {
    e.stopPropagation();
    setMusicOn(!isMusicOn());
    sfx.tap();
  }
});

// The start screen is one big "tap to play" target. Listen before loading finishes so an
// early tap isn't lost: it is remembered and acted on once everything is ready.
let enterFromStart = null;
let startTappedEarly = false;
$('screen-start').addEventListener('click', (e) => {
  if (e.target.closest('.mute-btn, .music-btn')) return;
  unlockAudio(); // must run inside this tap for iOS
  if (enterFromStart) enterFromStart();
  else startTappedEarly = true;
});

// ---------- data ----------
const [data] = await Promise.all([loadLevels(), loadCharacters()]);
const images = await loadImages();
const levels = data.levels;
const worlds = data.worlds || [{ id: 1, name: '', icon: '⭐' }];

/** Total stars + finished levels: what outfit unlocks are measured against. */
function stats() {
  const done = progress.done;
  return { done, stars: Object.values(done).reduce((a, d) => a + (d.stars || 0), 0) };
}
let currentLook = sanitizeLook(look.get(), stats());
look.set(currentLook);

// ---------- screens ----------
let screen = 'start';
function show(name) {
  screen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  if (name === 'game') {
    scene.resize();
    layoutStage();
    playMusic('musicLoop');
  } else if (name === 'start') {
    paintAvatar($('start-avatar'), images, currentLook, 'wave');
  }
}
const inGame = () => screen === 'game';

// ---------- scene + game ----------
const stage = $('stage');
const scene = new Scene($('scene'), images);
scene.look = currentLook;
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
  setCollectibles(items, popType) {
    const el = $('collect-bar');
    // pop the one just collected
    const latest = popType ? items.filter((i) => i.taken).sort((a, b) => b.takenT - a.takenT)[0] : null;
    el.innerHTML = '';
    for (const it of items) {
      const img = document.createElement('img');
      img.src = `assets/${it.type}.png`;
      img.alt = '';
      img.className = it.taken ? (it === latest ? 'got' : '') : 'miss';
      el.appendChild(img);
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
    const before = new Set(unlockedOutfits(stats()));
    progress.complete(current.id, got, stars);
    const fresh = unlockedOutfits(stats()).filter((id) => !before.has(id));
    playMusic(null);

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
    $('win-unlock').innerHTML = fresh.map((id) => `<img src="assets/${id}.png" alt="">`).join('');
    $('win-unlock').classList.toggle('hidden', !fresh.length);
    if (fresh.length) setTimeout(() => say('You got something new to wear!'), 1500);
    $('win').classList.remove('hidden');
    paintAvatar($('win-avatar'), images, currentLook, 'cheer');
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
    setTimeout(() => {
      if (hands.phase === 'ready') say('Hands down. Get ready to count!', { interrupt: false });
    }, 200);
  }
}

// ---------- level select ----------
function renderLevels() {
  const list = $('level-list');
  list.innerHTML = '';
  const { done, stars } = stats();
  const next = levels.find((l) => !(l.id in done));
  $('levels-total').textContent = `⭐ ${stars} / ${levels.length * 3}`;
  paintAvatar($('dressup-avatar'), images, currentLook, 'idle');
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
      const starsHtml = d ? [0, 1, 2].map((i) => `<span class="${i < d.stars ? '' : 'off'}">⭐</span>`).join('') : '';
      b.innerHTML = `
        <span class="lv-num">${lv.id}</span>
        <img src="assets/${lv.goal.item || 'star'}.png" alt="">
        <span class="lv-stars">${starsHtml}</span>
        ${open ? '' : '<span class="lock">🔒</span>'}`;
      b.addEventListener('click', () => {
        if (!open) return sfx.tryAgain();
        sfx.tap();
        startLevel(lv);
      });
      grid.appendChild(b);
    }
    sec.appendChild(grid);
    list.appendChild(sec);
  }
  requestAnimationFrame(() => list.querySelector('.next')?.scrollIntoView({ block: 'center' }));
}
function goLevels() {
  game.stop();
  hands.endTurn();
  $('win').classList.add('hidden');
  renderLevels();
  show('levels');
}

// ---------- dress-up ----------
const wardrobe = createWardrobe({
  images,
  stats,
  onChange(l) {
    currentLook = l;
    scene.look = l;
  },
});
$('btn-dressup').addEventListener('click', () => {
  sfx.tap();
  show('wardrobe');
  wardrobe.open();
});
$('btn-wardrobe-back').addEventListener('click', () => {
  sfx.tap();
  renderLevels();
  show('levels');
});
$('wardrobe-preview').addEventListener('click', () => wardrobe.poke());

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
/** A number was chosen (fingers, GO, button or key). Ignored until the hero is ready. */
function act(n) {
  if (game.busy) return;
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
  onCount: act, // game.move() plays the "correct" chime and says the number
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
    sleepAudio();
  } else if (wantCamera && !hands.active && screen !== 'start') {
    startCamera();
  }
});

// ---------- buttons ----------
enterFromStart = () => {
  sfx.tap();
  voice.hopHop();
  playMusic('jingle');
  renderLevels();
  show('levels');
  if (wantCamera && !hands.active) startCamera();
};
$('btn-levels-back').addEventListener('click', () => {
  sfx.tap();
  playMusic(null);
  show('start');
});
$('btn-home').addEventListener('click', () => {
  sfx.tap();
  playMusic(null);
  goLevels();
});
$('btn-hint').addEventListener('click', () => game.sayHint());
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
show('start');
if (startTappedEarly) enterFromStart();

// Handy for debugging in the console.
window.fingerHop = { game, hands, scene, levels };
