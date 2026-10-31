// Level data + saved progress (localStorage).

const KEY = 'fingerhop.progress.v2'; // v2: 15-level set (level ids changed meaning)

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

function write(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* private mode: progress just isn't kept */ }
}

export const progress = {
  /** { [levelId]: { stars: 1-3, berries: n } } (older saves stored just the berry count) */
  get done() {
    const done = read().done || {};
    for (const id in done) if (typeof done[id] === 'number') done[id] = { stars: 1, berries: done[id] };
    return done;
  },
  complete(id, berries, stars) {
    const p = read();
    const done = this.done;
    const prev = done[id] || { stars: 0, berries: 0 };
    done[id] = { stars: Math.max(prev.stars, stars), berries: Math.max(prev.berries, berries) };
    p.done = done;
    p.last = id;
    write(p);
  },
  /** A level is open when it's the first one or the one before it is finished. ?unlock=1 opens all. */
  unlocked(levels, lv) {
    if (new URLSearchParams(location.search).has('unlock')) return true;
    const i = levels.indexOf(lv);
    return i <= 0 || levels[i - 1].id in this.done;
  },
};
