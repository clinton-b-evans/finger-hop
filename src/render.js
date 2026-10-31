// Isometric canvas renderer: tiles, decor, items, the hero and particles.
// World coords are (row, col) floats; (col - row) goes right, (col + row) goes down.

import { tileAt, isBlocker } from './levels.js';
import { drawCharacter, characterImageNames } from './characters.js';

// Measured from the PNGs: opaque width, horizontal centre, and the y of the
// top-face centre (where an object standing on the tile should put its feet).
const TILE_META = {
  tile_grass: { w: 258, cx: 136, cy: 80 },
  tile_sand: { w: 250, cx: 132, cy: 78 },
  tile_water: { w: 253, cx: 133.5, cy: 76 },
  tile_bridge: { w: 253, cx: 133.5, cy: 62 },
  tile_number: { w: 244, cx: 129, cy: 66 },
  tile_stone: { w: 226, cx: 121, cy: 88 },
};
const ISO_Y = 0.29; // vertical step per (row + col), as a fraction of tile width

// Sprite heights relative to tile width.
const HERO_HEIGHT = 1.05; // a full-size (352 px) character sprite
const SIZE = {
  strawberry: 0.5,
  gem: 0.45,
  heart: 0.42,
  star: 0.55,
  star_alt: 0.55,
  chest: 0.6,
  rock: 0.5,
  tree: 1.05,
  bush: 0.6,
  flowers: 0.55,
  mushroom: 0.48,
  flower_tulip: 0.55,
};

/** Tiles, items and scenery (character + outfit images come from characters.json). */
export const WORLD_SPRITES = [
  'tile_grass', 'tile_sand', 'tile_water', 'tile_stone', 'tile_number', 'tile_bridge',
  'strawberry', 'gem', 'heart', 'star', 'star_alt', 'chest',
  'rock', 'bush', 'tree', 'flowers', 'mushroom', 'flower_tulip',
];

/** Load assets/<name>.png for every world sprite and character/outfit image. */
export function loadImages() {
  const names = [...new Set([...WORLD_SPRITES, ...characterImageNames()])];
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([name, img]);
          img.onerror = () => reject(new Error('missing sprite ' + name));
          img.src = `assets/${name}.png`;
        }),
    ),
  ).then((pairs) => Object.fromEntries(pairs));
}

export class Scene {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = images;
    this.level = null;
    this.tileKey = {};
    this.particles = [];
    this.hero = { r: 0, c: 0, z: 0, pose: 'idle', squash: 1, flip: false, scale: 1 };
    this.look = { character: 'fox', outfits: {} };
    this.items = [];
    this.goal = null;
    this.badges = []; // [{r, c, n}] numbered hints on the tiles ahead
    this.insets = { top: 0, left: 0 };
    this.shake = 0;
    this.fit = { tileW: 100, ox: 0, oy: 0 };
    this.dpr = 1;
    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(canvas.parentElement);
    this.resize();
  }

  setLevel(level, tileKey) {
    this.level = level;
    this.tileKey = tileKey;
    this.items = level.items.map((it) => {
      const [r, c] = level.path[it.index];
      return { type: it.type, index: it.index, r, c, taken: false, takenT: 0, blocker: isBlocker(it.type) };
    });
    const [gr, gc] = level.path[level.goal.index];
    this.goal = { type: level.goal.item || 'star', r: gr, c: gc };
    const [r0, c0] = level.path[0];
    Object.assign(this.hero, { r: r0, c: c0, z: 0, pose: 'wave', squash: 1, scale: 1, flip: false });
    this.particles = [];
    this.badges = [];
    this.resize();
  }

  // ---------- layout ----------
  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cssW = w;
    this.cssH = h;
    if (this.level) this.computeFit();
  }

  computeFit() {
    const lv = this.level;
    // Bounds in "tile width = 1" units.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const add = (r, c) => {
      const x = (c - r) / 2;
      const y = (c + r) * ISO_Y;
      minX = Math.min(minX, x - 0.5);
      maxX = Math.max(maxX, x + 0.5);
      minY = Math.min(minY, y - 1.15); // room for the hero / trees above
      maxY = Math.max(maxY, y + 0.55); // tile body below the top face
    };
    lv.tiles.forEach((line, r) => [...line].forEach((_, c) => tileAt(lv, r, c) && add(r, c)));
    lv.decor.forEach((d) => add(d.row, d.col));
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    // Keep clear of the camera bubble: main.js reports it as a top or left inset.
    const { top = 0, left = 0 } = this.insets;
    const W = this.cssW - left;
    const H = this.cssH - top;
    const availW = W * 0.94;
    const availH = H * 0.92;
    const tileW = Math.min(availW / spanX, availH / spanY, Math.min(W * 0.42, H * 0.6), 260);
    const ox = left + (W - spanX * tileW) / 2 - minX * tileW;
    const oy = top + (H - spanY * tileW) / 2 - minY * tileW;
    this.fit = { tileW, ox, oy };
  }

  setInsets(insets) {
    if (insets.top === this.insets.top && insets.left === this.insets.left) return;
    this.insets = insets;
    if (this.level) this.computeFit();
  }

  /** Screen position (CSS px) of the top-face centre of tile (r, c). */
  toScreen(r, c) {
    const { tileW, ox, oy } = this.fit;
    return { x: ox + ((c - r) / 2) * tileW, y: oy + (c + r) * ISO_Y * tileW };
  }

  // ---------- effects ----------
  burst(r, c, kind) {
    const { tileW } = this.fit;
    const p = this.toScreen(r, c);
    const n = kind === 'confetti' ? 70 : kind === 'splash' ? 26 : 18;
    const colors = {
      sparkle: ['#fff7a8', '#ffd84a', '#ff6b8a', '#ffffff'],
      splash: ['#bfe9ff', '#7fd0ff', '#ffffff', '#4fb3f0'],
      confetti: ['#ff6b6b', '#ffd84a', '#4cc26a', '#4fb3f0', '#b57bff', '#ff8a1f'],
    }[kind];
    for (let i = 0; i < n; i++) {
      const a = kind === 'splash' ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const sp = (kind === 'confetti' ? 0.9 : 0.55) * tileW * (0.5 + Math.random());
      this.particles.push({
        x: p.x,
        y: p.y - (kind === 'splash' ? 0 : tileW * 0.3),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (kind === 'confetti' ? tileW * 0.8 : 0),
        g: kind === 'sparkle' ? tileW * 0.6 : tileW * 2.2,
        life: kind === 'confetti' ? 2.2 : 0.9,
        age: 0,
        size: tileW * (kind === 'confetti' ? 0.05 : 0.04) * (0.6 + Math.random()),
        color: colors[(Math.random() * colors.length) | 0],
        star: kind === 'sparkle',
        spin: Math.random() * 6,
      });
    }
  }

  // ---------- drawing ----------
  draw(time, dt) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (!this.level) return;
    const { tileW } = this.fit;
    const t = time / 1000;

    ctx.save();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      ctx.translate(Math.sin(t * 60) * tileW * 0.03 * this.shake * 3, 0);
    }

    // Tiles, back to front.
    const lv = this.level;
    const tiles = [];
    lv.tiles.forEach((line, r) =>
      [...line].forEach((ch, c) => {
        const name = this.tileKey[ch];
        if (name && this.img[name]) tiles.push({ r, c, name });
      }),
    );
    // Decor placed on an empty cell gets a patch of grass so it doesn't float.
    for (const d of lv.decor) {
      if (!tileAt(lv, d.row, d.col)) tiles.push({ r: d.row, c: d.col, name: 'tile_grass' });
    }
    tiles.sort((a, b) => a.r + a.c - (b.r + b.c) || a.c - b.c);
    for (const tl of tiles) this.drawTile(tl, t);

    // Numbered hint badges on the next tiles.
    for (const b of this.badges) this.drawBadge(b, t);

    // Standing things, sorted by depth.
    const things = [];
    for (const d of lv.decor) things.push({ kind: 'decor', type: d.type, r: d.row, c: d.col });
    for (const it of this.items) if (!it.taken || t - it.takenT < 0.6) things.push({ kind: 'item', it, r: it.r, c: it.c });
    if (this.goal) things.push({ kind: 'goal', r: this.goal.r, c: this.goal.c });
    things.push({ kind: 'hero', r: this.hero.r, c: this.hero.c, d: 1000 }); // always on top so scenery never hides it
    things.sort((a, b) => a.r + a.c + (a.d || 0) - (b.r + b.c + (b.d || 0)));
    for (const th of things) {
      if (th.kind === 'decor') this.drawSprite(th.type, th.r, th.c, SIZE[th.type] || 0.7, { sway: t });
      else if (th.kind === 'item') this.drawItem(th.it, t);
      else if (th.kind === 'goal') this.drawGoal(t);
      else this.drawHero(t);
    }

    this.drawParticles(dt);
    ctx.restore();
  }

  drawTile({ r, c, name }, t) {
    const img = this.img[name];
    const m = TILE_META[name];
    const { tileW } = this.fit;
    const s = tileW / m.w;
    const p = this.toScreen(r, c);
    let bobY = 0;
    if (name === 'tile_water') bobY = Math.sin(t * 2 + r + c) * tileW * 0.008;
    this.ctx.drawImage(img, p.x - m.cx * s, p.y - m.cy * s + bobY, img.width * s, img.height * s);
  }

  drawBadge({ r, c, n }, t) {
    const ctx = this.ctx;
    const { tileW } = this.fit;
    const p = this.toScreen(r, c);
    const rad = tileW * 0.13;
    const pulse = 1 + Math.sin(t * 4 - n * 0.6) * 0.06;
    ctx.save();
    ctx.translate(p.x, p.y + tileW * 0.02);
    ctx.scale(pulse, pulse * 0.62); // flatten onto the tile face
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = rad * 0.18;
    ctx.strokeStyle = '#ff8a1f';
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff8a1f';
    ctx.font = `900 ${rad * 1.4}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, rad * 0.08);
    ctx.restore();
  }

  /** Draw a sprite with its bottom centre on the tile face. */
  drawSprite(name, r, c, heightK, { lift = 0, scaleX = 1, scaleY = 1, alpha = 1, flip = false, rot = 0, sway } = {}) {
    const img = this.img[name];
    if (!img) return;
    const ctx = this.ctx;
    const { tileW } = this.fit;
    const p = this.toScreen(r, c);
    const h = tileW * heightK;
    const w = (img.width / img.height) * h;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y + tileW * 0.04 - lift);
    if (sway !== undefined) ctx.rotate(Math.sin(sway * 1.3 + r * 2 + c) * 0.025);
    if (rot) ctx.rotate(rot);
    ctx.scale((flip ? -1 : 1) * scaleX, scaleY);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  drawShadow(r, c, k, alpha = 0.22) {
    const ctx = this.ctx;
    const { tileW } = this.fit;
    const p = this.toScreen(r, c);
    ctx.save();
    ctx.fillStyle = `rgba(40, 30, 10, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + tileW * 0.03, tileW * 0.22 * k, tileW * 0.09 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawItem(it, t) {
    const { tileW } = this.fit;
    if (it.blocker) {
      // Obstacles sit still; landing on one bumps you back.
      this.drawShadow(it.r, it.c, 0.9, 0.18);
      this.drawSprite(it.type, it.r, it.c, SIZE[it.type] ?? 0.5, { lift: -tileW * 0.02 });
      return;
    }
    if (it.taken) {
      const a = (t - it.takenT) / 0.6;
      this.drawSprite(it.type, it.r, it.c, SIZE[it.type] * (1 + a * 0.6), {
        lift: tileW * (0.1 + a * 0.9),
        alpha: 1 - a,
      });
      return;
    }
    const bob = (Math.sin(t * 3 + it.index) * 0.5 + 0.5) * tileW * 0.06;
    this.drawShadow(it.r, it.c, 0.7);
    this.drawSprite(it.type, it.r, it.c, SIZE[it.type], { lift: tileW * 0.04 + bob });
  }

  drawGoal(t) {
    const g = this.goal;
    const { tileW } = this.fit;
    const ctx = this.ctx;
    const p = this.toScreen(g.r, g.c);
    // soft glow
    const grd = ctx.createRadialGradient(p.x, p.y - tileW * 0.3, 0, p.x, p.y - tileW * 0.3, tileW * 0.55);
    grd.addColorStop(0, `rgba(255, 240, 150, ${0.55 + Math.sin(t * 3) * 0.15})`);
    grd.addColorStop(1, 'rgba(255, 240, 150, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(p.x - tileW, p.y - tileW, tileW * 2, tileW * 1.4);
    this.drawShadow(g.r, g.c, 0.9);
    const floaty = g.type !== 'chest';
    const bob = floaty ? (Math.sin(t * 2.5) * 0.5 + 0.5) * tileW * 0.1 : 0;
    this.drawSprite(g.type, g.r, g.c, SIZE[g.type] || 0.6, {
      lift: tileW * 0.05 + bob,
      rot: floaty ? Math.sin(t * 2) * 0.12 : 0,
    });
  }

  drawHero(t) {
    const h = this.hero;
    const { tileW } = this.fit;
    const breathe = h.pose === 'idle' ? 1 + Math.sin(t * 3) * 0.02 : 1;
    this.drawShadow(h.r, h.c, Math.max(0.4, 1 - h.z / (tileW * 1.2)));
    const p = this.toScreen(h.r, h.c);
    drawCharacter(this.ctx, this.img, this.look, h.pose, p.x, p.y + tileW * 0.04 - h.z, tileW * HERO_HEIGHT * h.scale, {
      flip: h.flip,
      scaleX: (1 / h.squash) * (2 - breathe),
      scaleY: h.squash * breathe,
    });
  }

  drawParticles(dt) {
    const ctx = this.ctx;
    this.particles = this.particles.filter((p) => (p.age += dt) < p.life);
    for (const p of this.particles) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      const a = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin + p.age * 6);
      if (p.star) {
        const s = p.size * 1.6;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const rr = i % 2 ? s * 0.35 : s;
          const an = (i * Math.PI) / 4;
          ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
        }
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      }
      ctx.restore();
    }
  }
}
