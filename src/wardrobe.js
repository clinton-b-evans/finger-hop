// Dress-up screen: pick a character and outfits (one per slot). Locked items show what
// unlocks them (total stars or a finished level). Choices are saved via characters.look.

import {
  characterIds,
  outfitIds,
  outfit,
  isUnlocked,
  look,
  toggleOutfit,
  paintAvatar,
} from './characters.js';
import { sfx, voice, say } from './audio.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {object} o
 * @param {Record<string, HTMLImageElement>} o.images
 * @param {() => {stars:number, done:Object}} o.stats current progress
 * @param {(look) => void} o.onChange called after the look changes (already saved)
 */
export function createWardrobe({ images, stats, onChange }) {
  const preview = $('wardrobe-preview');
  const charRow = $('char-row');
  const grid = $('outfit-grid');
  let current = look.get();
  let poseTimer = 0;

  function paintPreview(pose = 'idle') {
    paintAvatar(preview, images, current, pose);
  }
  /** Little jump in the preview whenever something changes. */
  function bounce() {
    clearTimeout(poseTimer);
    paintPreview('jump');
    poseTimer = setTimeout(() => paintPreview('idle'), 450);
  }

  function apply(next) {
    current = next;
    look.set(current);
    onChange(current);
    render();
    bounce();
  }

  function render() {
    const st = stats();
    $('wardrobe-stars').textContent = `⭐ ${st.stars}`;

    charRow.innerHTML = '';
    for (const id of characterIds()) {
      const b = document.createElement('button');
      b.className = 'char-btn' + (current.character === id ? ' on' : '');
      b.setAttribute('aria-label', id);
      const cv = document.createElement('canvas');
      b.appendChild(cv);
      b.addEventListener('click', () => {
        if (current.character === id) return;
        sfx.tap();
        voice.hopHop();
        apply({ ...current, character: id });
      });
      charRow.appendChild(b);
      // paint once laid out (canvas needs its CSS size)
      requestAnimationFrame(() => paintAvatar(cv, images, { character: id, outfits: {} }, 'idle'));
    }

    grid.innerHTML = '';
    for (const id of outfitIds()) {
      const o = outfit(id);
      const open = isUnlocked(id, st);
      const worn = current.outfits[o.slot] === id;
      const b = document.createElement('button');
      b.className = 'outfit-btn' + (worn ? ' on' : '') + (open ? '' : ' locked');
      b.setAttribute('aria-label', id.replace(/^(hat|wear)_/, '') + (open ? '' : ' (locked)'));
      const req = o.unlock?.level !== undefined ? `🏁${o.unlock.level}` : `⭐${o.unlock?.stars ?? 0}`;
      b.innerHTML = `<img src="assets/${id}.png" alt="">${open ? '' : `<span class="req">🔒 ${req}</span>`}`;
      b.addEventListener('click', () => {
        if (!open) {
          sfx.tryAgain();
          say(
            o.unlock?.level !== undefined
              ? `Finish level ${o.unlock.level} to get this!`
              : `Get ${o.unlock.stars} stars to get this!`,
          );
          return;
        }
        sfx.tap();
        apply(toggleOutfit(current, id));
      });
      grid.appendChild(b);
    }
  }

  return {
    open() {
      current = look.get();
      render();
      requestAnimationFrame(() => paintPreview('wave'));
      poseTimer = setTimeout(() => paintPreview('idle'), 900);
    },
    /** Tap the big preview: a happy jump. */
    poke() {
      sfx.hop(2);
      bounce();
    },
  };
}
