// Game rules + hero animation sequencing for one level.

import { tileAt, isCollectible } from './levels.js';
import { sfx, voice, say } from './audio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tween(ms, fn) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const COLLECT_LINES = { strawberry: 'Yum! A strawberry!', gem: 'A shiny gem!', heart: 'A heart! I love it!' };
const GOAL_NAMES = { chest: 'treasure', star: 'star', star_alt: 'star' };

/**
 * UI callbacks the game needs:
 *  showNumber(n|null, kind)       big animated number ('show' | 'count' | 'splash')
 *  setCollectibles(items, popType) collectible icons in the top bar
 *  setReady(bool)                 a turn may start (true) / the hero is busy (false)
 *  win(got, total, stars)         level finished
 */
export class Game {
  constructor(scene, ui) {
    this.scene = scene;
    this.ui = ui;
    this.level = null;
    this.index = 0;
    this.misses = 0;
    this.busy = true;
    this.token = 0; // bumps on level change so stale animations stop
  }

  get hero() {
    return this.scene.hero;
  }
  get collectibles() {
    return this.scene.items.filter((i) => isCollectible(i.type));
  }
  get gotAll() {
    return this.collectibles.every((i) => i.taken);
  }
  /** 1 for the goal, +1 for every collectible, +1 for no splashes / bumps / "too many". */
  get stars() {
    return 1 + (this.gotAll ? 1 : 0) + (this.misses === 0 ? 1 : 0);
  }

  async start(level, tileKey) {
    const token = ++this.token;
    this.level = level;
    this.index = 0;
    this.misses = 0;
    this.scene.setLevel(level, tileKey);
    this.ui.setCollectibles(this.collectibles);
    this.setBusy(true);
    this.hero.pose = 'wave';
    voice.hopHop();
    await sleep(900);
    if (token !== this.token) return;
    say(level.hint || 'Show me fingers!', { interrupt: false });
    await sleep(800);
    if (token !== this.token) return;
    this.hero.pose = 'idle';
    this.setBusy(false);
  }

  stop() {
    this.token++;
    this.busy = true;
  }

  setBusy(b) {
    this.busy = b;
    this.scene.badges = b ? [] : this.badgesAhead();
    this.ui.setReady(!b);
  }

  badgesAhead() {
    const lv = this.level;
    const out = [];
    for (let n = 1; n <= lv.maxHop && this.index + n <= lv.goal.index; n++) {
      const [r, c] = lv.path[this.index + n];
      out.push({ r, c, n });
    }
    return out;
  }

  sayHint() {
    say(this.level?.hint || 'Show me fingers!');
  }

  /** Main action: the child chose n (fingers or a button). */
  async move(n) {
    if (this.busy || !this.level) return;
    const token = this.token;
    const lv = this.level;
    const start = this.index;
    const want = Math.max(1, Math.min(n, lv.maxHop));
    this.setBusy(true);

    // Say the number the moment it's locked in.
    sfx.correct();
    voice.number(want);
    this.ui.showNumber(want, 'show');
    await sleep(1000);
    if (token !== this.token) return;

    // Puzzle levels: you must land exactly on the goal, so too many is a gentle "no".
    if (lv.goal.exact && start + want > lv.goal.index) {
      await this.tooMany(token);
      return;
    }

    const steps = Math.min(want, lv.goal.index - start);
    for (let i = 1; i <= steps; i++) {
      if (token !== this.token) return;
      this.ui.showNumber(i, 'count');
      voice.number(i);
      await this.hop(start + i - 1, start + i, i, i === steps);
    }
    if (token !== this.token) return;
    this.index = start + steps;
    const [r, c] = lv.path[this.index];

    if (tileAt(lv, r, c) === 'W') return this.bounceBack(start, 'splash', token);
    const here = this.scene.items.find((it) => it.index === this.index && !it.taken);
    if (here?.blocker) return this.bounceBack(start, 'bump', token);

    if (here && isCollectible(here.type)) {
      here.taken = true;
      here.takenT = performance.now() / 1000;
      this.scene.burst(r, c, 'sparkle');
      sfx.collect(here.type);
      this.ui.setCollectibles(this.collectibles, here.type);
    }

    if (this.index === lv.goal.index) return this.celebrate(token);

    if (here) say(COLLECT_LINES[here.type] ?? 'Yay!');
    else if (Math.random() < 0.4) voice.greatJob();
    await sleep(350);
    if (token !== this.token) return;
    this.endMove();
  }

  endMove() {
    this.ui.showNumber(null);
    this.hero.pose = 'idle';
    this.setBusy(false);
  }

  async hop(fromIdx, toIdx, step, last, { height = 0.55, ms = 380 } = {}) {
    const hero = this.hero;
    const [r0, c0] = this.level.path[fromIdx];
    const [r1, c1] = this.level.path[toIdx];
    const tileW = this.scene.fit.tileW;
    const dx = c1 - r1 - (c0 - r0);
    if (dx !== 0) hero.flip = dx < 0;

    hero.pose = 'crouch';
    await tween(130, (t) => (hero.squash = 1 - 0.12 * Math.sin(t * Math.PI)));
    hero.pose = 'jump';
    sfx.hop(step);
    await tween(ms, (t) => {
      const e = easeInOut(t);
      hero.r = r0 + (r1 - r0) * e;
      hero.c = c0 + (c1 - c0) * e;
      hero.z = Math.sin(t * Math.PI) * tileW * height;
      hero.squash = 1 + 0.08 * Math.sin(t * Math.PI);
    });
    Object.assign(hero, { r: r1, c: c1, z: 0, pose: 'land' });
    sfx.land();
    await tween(last ? 220 : 120, (t) => (hero.squash = 1 - 0.1 * Math.sin(t * Math.PI)));
    hero.squash = 1;
  }

  async tooMany(token) {
    const hero = this.hero;
    this.misses++;
    sfx.tryAgain();
    say(`Too many! Count the tiles to the ${GOAL_NAMES[this.level.goal.item] ?? 'star'}.`);
    hero.pose = 'crouch';
    await tween(700, (t) => (hero.flip = Math.sin(t * Math.PI * 6) > 0)); // head-shake wobble
    hero.flip = false;
    await sleep(600);
    if (token !== this.token) return;
    this.endMove();
  }

  /** Landed in water ('splash') or on a rock ('bump'): no fail, just hop back and try again. */
  async bounceBack(backTo, kind, token) {
    this.misses++;
    const hero = this.hero;
    const [r, c] = this.level.path[this.index];
    if (kind === 'splash') {
      sfx.splash();
      this.scene.burst(r, c, 'splash');
      this.ui.showNumber('💦', 'splash');
    } else {
      this.ui.showNumber('💥', 'splash');
    }
    sfx.tryAgain();
    this.scene.shake = 0.35;
    hero.pose = 'crouch';
    await tween(260, (t) => (hero.z = -Math.sin(t * Math.PI) * this.scene.fit.tileW * (kind === 'splash' ? 0.12 : -0.08)));
    say(kind === 'splash' ? 'Splash! Try again!' : 'Bonk! Hop over the rock!');
    await sleep(700);
    if (token !== this.token) return;
    await this.hop(this.index, backTo, 0, true, { height: 0.9, ms: 650 });
    if (token !== this.token) return;
    this.index = backTo;
    this.endMove();
  }

  async celebrate(token) {
    const hero = this.hero;
    const { r, c } = this.scene.goal;
    hero.pose = 'cheer';
    hero.flip = false;
    sfx.levelComplete();
    sfx.cheer();
    this.scene.burst(r, c, 'confetti');
    this.ui.showNumber('⭐', 'show');
    voice.greatJob();
    for (let i = 0; i < 3; i++) {
      await tween(320, (t) => (hero.z = Math.sin(t * Math.PI) * this.scene.fit.tileW * 0.25));
      if (token !== this.token) return;
    }
    await sleep(400);
    if (token !== this.token) return;
    const got = this.collectibles.filter((i) => i.taken).length;
    this.ui.win(got, this.collectibles.length, this.stars);
  }
}
