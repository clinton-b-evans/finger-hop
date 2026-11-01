// Consistency check (no dependencies): node tools/check.mjs
// Verifies that every file the game references exists, that the service worker precaches
// all code + images, and that levels/outfits only use known sprites.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const errors = [];
const fail = (m) => errors.push(m);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sw = readFileSync('sw.js', 'utf8');
const listIn = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};

// images
const render = readFileSync('src/render.js', 'utf8');
const world = listIn(render, 'WORLD_SPRITES');
const chars = json('assets/characters.json');
const charImgs = [...Object.keys(chars.sprites), ...Object.values(chars.characters).flatMap((c) => Object.values(c.poses)), ...Object.keys(chars.outfits)];
const swImages = new Set(listIn(sw, 'IMAGES'));
for (const n of new Set([...world, ...charImgs])) {
  if (!existsSync(`assets/${n}.png`)) fail(`missing image assets/${n}.png`);
  if (!swImages.has(n)) fail(`sw.js IMAGES is missing ${n}`);
}
for (const [id, c] of Object.entries(chars.characters))
  for (const s of Object.values(c.poses)) if (!chars.sprites[s]) fail(`characters.json: no anchors for ${s} (${id})`);
for (const [id, o] of Object.entries(chars.outfits)) if (!chars.slots.includes(o.slot)) fail(`outfit ${id}: unknown slot ${o.slot}`);

// code
const swFiles = new Set(listIn(sw, 'APP_FILES'));
for (const f of readdirSync('src')) if (f.endsWith('.js') && !swFiles.has(`src/${f}`)) fail(`sw.js APP_FILES is missing src/${f}`);
for (const f of swFiles) if (!['./'].includes(f) && !f.startsWith('...') && !existsSync(f)) fail(`sw.js precaches missing file ${f}`);

// levels
const { levels } = json('levels/levels.json');
const known = new Set(world);
for (const lv of levels) {
  for (const it of lv.items) if (!known.has(it.type)) fail(`level ${lv.id}: unknown item ${it.type}`);
  for (const d of lv.decor) if (!known.has(d.type)) fail(`level ${lv.id}: unknown decor ${d.type}`);
  if (!known.has(lv.goal.item || 'star')) fail(`level ${lv.id}: unknown goal ${lv.goal.item}`);
  for (const o of Object.values(chars.outfits)) if (o.unlock?.level && !levels.some((l) => l.id === o.unlock.level)) fail(`outfit unlock level ${o.unlock.level} does not exist`);
}

// audio
const { SOUNDS, AUDIO_BASE } = await import('../src/sounds.js');
for (const [name, s] of Object.entries(SOUNDS))
  for (const f of s.formats) if (!existsSync(`${AUDIO_BASE}${s.file}.${f}`)) fail(`sound ${name}: missing ${AUDIO_BASE}${s.file}.${f}`);
if (/masters/.test(listIn(sw, 'APP_FILES').join())) fail('sw.js must not precache audio masters');

console.log(errors.length ? errors.join('\n') : 'check ok: images, code, levels, outfits, audio');
process.exit(errors.length ? 1 : 0);
