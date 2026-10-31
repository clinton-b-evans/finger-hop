// Playable characters, dress-up outfits and their unlocks.
// All art data (poses, anchors, sizes, unlock rules) lives in assets/characters.json;
// tools/outfit_preview.py renders the same data for tuning anchors by eye.

const LOOK_KEY = 'fingerhop.look.v1';
const REF_HEIGHT = 352; // source height of a full-size character sprite (fox_idle, wolf_idle, ...)

let data = null;

export async function loadCharacters() {
  const res = await fetch('assets/characters.json');
  if (!res.ok) throw new Error('characters.json ' + res.status);
  data = await res.json();
  return data;
}

export const characterIds = () => Object.keys(data.characters);
export const outfitIds = () => Object.keys(data.outfits);
export const outfit = (id) => data.outfits[id];
export const character = (id) => data.characters[id] ?? data.characters.fox;

/** Every image name the characters and outfits need (for the image loader). */
export function characterImageNames() {
  const names = new Set(Object.keys(data.sprites));
  for (const c of Object.values(data.characters)) Object.values(c.poses).forEach((n) => names.add(n));
  outfitIds().forEach((n) => names.add(n));
  return [...names];
}

// ---------- the saved look ----------
const DEFAULT_LOOK = { character: 'fox', outfits: {} }; // outfits: { slot: outfitId }

export const look = {
  get() {
    try {
      const l = JSON.parse(localStorage.getItem(LOOK_KEY));
      if (l && data.characters[l.character]) return { character: l.character, outfits: { ...l.outfits } };
    } catch {}
    return structuredClone(DEFAULT_LOOK);
  },
  set(l) {
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(l));
    } catch {}
  },
};

/** Put on (or take off, if already worn) an outfit; one item per slot. */
export function toggleOutfit(l, id) {
  const slot = outfit(id).slot;
  const next = { character: l.character, outfits: { ...l.outfits } };
  if (next.outfits[slot] === id) delete next.outfits[slot];
  else next.outfits[slot] = id;
  return next;
}

/** Drop items that are no longer unlocked (e.g. after progress was reset). */
export function sanitizeLook(l, stats) {
  const outfits = {};
  for (const [slot, id] of Object.entries(l.outfits)) if (data.outfits[id] && isUnlocked(id, stats)) outfits[slot] = id;
  return { character: data.characters[l.character] ? l.character : 'fox', outfits };
}

// ---------- unlocks ----------
/** @param {{stars:number, done:Object}} stats total stars + finished levels (from progress) */
export function isUnlocked(id, stats) {
  const u = data.outfits[id]?.unlock ?? {};
  if (u.stars !== undefined && stats.stars < u.stars) return false;
  if (u.level !== undefined && !(u.level in stats.done)) return false;
  return true;
}
export const unlockedOutfits = (stats) => outfitIds().filter((id) => isUnlocked(id, stats));

// ---------- drawing ----------
/**
 * Draw a character (with outfits) so its feet land on (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Record<string, HTMLImageElement>} images
 * @param {{character:string, outfits:Object}} l look
 * @param {string} pose idle | crouch | jump | land | cheer | wave
 * @param {number} height drawn height of a full-size (352 px) sprite
 */
export function drawCharacter(ctx, images, l, pose, x, y, height, { flip = false, scaleX = 1, scaleY = 1, alpha = 1 } = {}) {
  const ch = character(l.character);
  const name = ch.poses[pose] ?? ch.poses.idle;
  const img = images[name];
  const a = data.sprites[name];
  if (!img || !a) return;
  const s = height / REF_HEIGHT;
  const w = img.width * s;
  const h = img.height * s;
  // Sprite space: origin at the feet anchor.
  const left = -a.feet[0] * w;
  const top = -a.feet[1] * h;
  const at = (k) => [left + a[k][0] * w, top + a[k][1] * h];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale((flip ? -1 : 1) * scaleX, scaleY);
  const drawItem = (slot) => {
    const id = l.outfits[slot];
    const o = id && data.outfits[id];
    const oi = o && images[id];
    if (!oi) return;
    const [tx, ty] = at(slot === 'back' ? 'neck' : slot);
    const grow = slot === 'head' || slot === 'eyes' ? ch.headScale ?? 1 : 1;
    const ow = o.width * height * grow;
    const oh = (oi.height / oi.width) * ow;
    const [dx, dy] = o.offset ?? [0, 0];
    ctx.drawImage(oi, tx + dx * height - o.anchor[0] * ow, ty + dy * height - o.anchor[1] * oh, ow, oh);
  };
  drawItem('back'); // capes go behind the body
  ctx.drawImage(img, left, top, w, h);
  for (const slot of data.slots) if (slot !== 'back') drawItem(slot);
  ctx.restore();
}

/** Render a character into a <canvas> element (menus, win screen, wardrobe). */
export function paintAvatar(canvas, images, l, pose = 'idle') {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cw = canvas.clientWidth || canvas.width;
  const chh = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(chh * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, chh);
  // Leave headroom for hats: the character fills ~78% of the height.
  const h = Math.min(chh * 0.78, cw * 0.95);
  drawCharacter(ctx, images, l, pose, cw / 2, chh * 0.97, h);
}
