// Level data + saved progress (localStorage).

const KEY = 'fingerhop.progress.v1';

export async function loadLevels() {
  const res = await fetch('levels/levels.json');
  if (!res.ok) throw new Error('levels.json ' + res.status);
  const data = await res.json();
  for (const lv of data.levels) {
    lv.decor ??= [];
    lv.items ??= [];
    lv.maxHop = Math.max(1, Math.min(5, lv.maxHop ?? 5));
  }
  return data;
}

/** Tile code at (row, col), or null when empty / out of range. */
export function tileAt(level, row, col) {
  const line = level.tiles[row];
  if (!line || col < 0 || col >= line.length) return null;
  const c = line[col];
  return c === '.' || c === ' ' ? null : c;
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export const progress = {
  /** { [levelId]: bestStrawberryCount } */
  get done() {
    return read().done || {};
  },
  complete(id, berries) {
    const p = read();
    p.done ??= {};
    p.done[id] = Math.max(p.done[id] ?? 0, berries);
    p.last = id;
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch { /* private mode: progress just isn't kept */ }
  },
};
