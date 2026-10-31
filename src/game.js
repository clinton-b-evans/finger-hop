// Game rules + fox animation sequencing.

import { tileAt } from './levels.js';
import { sfx, say, numberWord } from './audio.js';

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

const PRAISE = ['Yay!', 'Good hopping!', 'Nice!', 'Well done!'];

export class Game {
  /**
   * @param {import('./render.js').Scene} scene
   * @param {object} ui callbacks: showNumber(n, kind), setBerries(got, total, pop), setReady(bool), win(got, total)
   */
  constructor(scene, ui) {
    this.scene = scene;
    this.ui = ui;
    this.level = null;
    this.index = 0;
    this.busy = true;
    this.token = 0; // bumps on level change so stale animations stop
  }

  get berriesTotal() {
    return this.level.items.filter((i) => i.type === 'strawberry').length;
  }
  get berriesGot() {
    return this.scene.items.filter((i) => i.type === 'strawberry' && i.taken).length;
  }

  async start(level, tileKey) {
    const token = ++this.token;
    this.level = level;
    this.index = 0;
    this.misses = 0; // splashes + "too many" tries, for the star rating
    this.turns = 0;
    this.scene.setLevel(level, tileKey);
    this.ui.setBerries(0, this.berriesTotal);
    this.setBusy(true);
    this.scene.fox.sprite = 'fox_wave';
    say(level.hint || 'Show me fingers!');
    await sleep(1600);
    if (token !== this.token) return;
    this.scene.fox.sprite = 'fox_idle';
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

  /** Stars for the finished level: 1 for the goal, +1 all strawberries, +1 no splashes / overshoots. */
  get stars() {
    return 1 + (this.berriesGot === this.berriesTotal ? 1 : 0) + (this.misses === 0 ? 1 : 0);
  }

  /** Main action: hop n tiles forward. */
  async move(n) {
    if (this.busy || !this.level) return;
    const token = this.token;
    const lv = this.level;
    const start = this.index;
    const want = Math.max(1, Math.min(n, lv.maxHop));
    this.turns++;
    this.setBusy(true);

    // Puzzle levels: you must land exactly on the goal, so too many hops is a gentle "no".
    if (lv.goal.exact && start + want > lv.goal.index) {
      await this.tooMany(want, token);
      return;
    }
    const steps = Math.min(want, lv.goal.index - start);

    this.ui.showNumber(steps, 'show');
    say(numberWord(steps) + '!');
    await sleep(1000);

    for (let i = 1; i <= steps; i++) {
      if (token !== this.token) return;
      this.ui.showNumber(i, 'count');
      say(numberWord(i), { rate: 1.05 });
      await this.hop(start + i - 1, start + i, i, i === steps);
    }
    if (token !== this.token) return;
    this.index = start + steps;
    const [r, c] = lv.path[this.index];
    const code = tileAt(lv, r, c);

    if (code === 'W') {
      await this.splash(start, token);
      return;
    }

    const item = this.scene.items.find((it) => it.index === this.index && !it.taken);
    if (item) {
      item.taken = true;
      item.takenT = performance.now() / 1000;
      this.scene.burst(r, c, 'sparkle');
      sfx.collect();
      this.ui.setBerries(this.berriesGot, this.berriesTotal, true);
    }

    if (this.index === lv.goal.index) {
      await this.celebrate(token);
      return;
    }

    if (item) say('Yum! A strawberry!');
    else if (Math.random() < 0.5) say(PRAISE[(Math.random() * PRAISE.length) | 0]);
    await sleep(350);
    if (token !== this.token) return;
    this.ui.showNumber(null);
    this.scene.fox.sprite = 'fox_idle';
    this.setBusy(false);
  }

  async hop(fromIdx, toIdx, step, last, { height = 0.55, ms = 380 } = {}) {
    const fox = this.scene.fox;
    const [r0, c0] = this.level.path[fromIdx];
    const [r1, c1] = this.level.path[toIdx];
    const tileW = this.scene.fit.tileW;
    const dx = c1 - r1 - (c0 - r0);
    if (dx !== 0) fox.flip = dx < 0;

    fox.sprite = 'fox_crouch';
    await tween(130, (t) => (fox.squash = 1 - 0.12 * Math.sin(t * Math.PI)));
    fox.sprite = 'fox_jump';
    sfx.boing(step);
    await tween(ms, (t) => {
      const e = easeInOut(t);
      fox.r = r0 + (r1 - r0) * e;
      fox.c = c0 + (c1 - c0) * e;
      fox.z = Math.sin(t * Math.PI) * tileW * height;
      fox.squash = 1 + 0.08 * Math.sin(t * Math.PI);
    });
    fox.r = r1;
    fox.c = c1;
    fox.z = 0;
    fox.sprite = 'fox_land';
    sfx.land();
    await tween(last ? 220 : 120, (t) => (fox.squash = 1 - 0.1 * Math.sin(t * Math.PI)));
    fox.squash = 1;
  }

  async tooMany(n, token) {
    const fox = this.scene.fox;
    this.misses++;
    this.ui.showNumber(n, 'show');
    say(numberWord(n) + '?');
    await sleep(900);
    if (token !== this.token) return;
    sfx.oops();
    say('Too many! Count the tiles to the ' + (this.level.goal.item === 'chest' ? 'treasure.' : 'star.'));
    fox.sprite = 'fox_crouch';
    // head-shake wobble
    await tween(700, (t) => (fox.flip = Math.sin(t * Math.PI * 6) > 0));
    fox.flip = false;
    await sleep(600);
    if (token !== this.token) return;
    this.ui.showNumber(null);
    fox.sprite = 'fox_idle';
    this.setBusy(false);
  }

  async splash(backTo, token) {
    this.misses++;
    const fox = this.scene.fox;
    const lv = this.level;
    const [r, c] = lv.path[this.index];
    sfx.splash();
    this.scene.burst(r, c, 'splash');
    this.scene.shake = 0.35;
    this.ui.showNumber('💦', 'splash');
    fox.sprite = 'fox_crouch';
    await tween(260, (t) => (fox.z = -Math.sin(t * Math.PI) * this.scene.fit.tileW * 0.12));
    say('Splash! Try again!');
    await sleep(700);
    if (token !== this.token) return;
    // Bounce back to where this move started.
    await this.hop(this.index, backTo, 0, true, { height: 0.9, ms: 650 });
    if (token !== this.token) return;
    this.index = backTo;
    this.ui.showNumber(null);
    fox.sprite = 'fox_idle';
    this.setBusy(false);
  }

  async celebrate(token) {
    const fox = this.scene.fox;
    const { r, c } = this.scene.goal;
    fox.sprite = 'fox_cheer';
    fox.flip = false;
    sfx.fanfare();
    this.scene.burst(r, c, 'confetti');
    this.ui.showNumber('⭐', 'show');
    say(this.level.goal.item === 'chest' ? 'You found the treasure! Hooray!' : 'You got the star! Hooray!');
    // little victory bounces
    for (let i = 0; i < 3; i++) {
      await tween(320, (t) => (fox.z = Math.sin(t * Math.PI) * this.scene.fit.tileW * 0.25));
      if (token !== this.token) return;
    }
    await sleep(300);
    if (token !== this.token) return;
    this.ui.win(this.berriesGot, this.berriesTotal, this.stars);
  }
}
