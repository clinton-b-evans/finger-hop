# Finger Hop 🦊✋

A toddler (age ~3) counting game for the phone browser. Inspired by Osmo Coding's Awbie — but instead of physical code blocks, the child **holds up 1–5 fingers** to the camera and a chubby fox hops that many tiles along an isometric path, collecting strawberries and reaching a star (or a treasure chest).

## Play loop
1. Fox stands on the path. Hint text + voice: "Show me fingers!"
2. Every turn starts with a calm **get-ready pause** (~1.5 s, ring drains, 🙌 + ⬇ "hands down"). Counting opens once the hands have gone down (or after 5 s). The child then holds up N fingers; the number shows big in the camera bubble and a ring fills — it only locks once the count has stayed the same for **~1.8 s** (brief in-between numbers while fingers move are ignored). A big green **GO** button can confirm the number shown right away. Input is ignored while the fox is hopping, until the next turn starts.
3. A big animated number pops up, fox hops N tiles; each hop plays a boing and speaks the count ("one… two… three!") via the Web Speech API.
4. Landing on a strawberry collects it (sparkle + sound). Landing on water = gentle splash, fox bounces back to where it started (no fail state, just "Try again!").
5. Reaching the goal (overshooting clamps to it) → celebration with 1–3 stars, next level. On **puzzle levels** (`goal.exact`) too many hops is a gentle "Too many! Count the tiles" and the fox stays put.
6. Stars: ⭐ finish, ⭐ all strawberries, ⭐ no splashes / "too many". Levels unlock one by one; best stars + strawberries are saved in localStorage.

## Tech plan
- Static site: plain JavaScript + HTML `<canvas>` (no build step needed; ES modules OK). Deploy on GitHub Pages / Netlify.
- Hand tracking: MediaPipe **tasks-vision `HandLandmarker`** (WASM + model loaded from CDN, cached by a service worker for offline-ish use). Front camera by default, toggle to back camera (`facingMode`).
- Finger count: per hand, a finger is "up" if tip is farther from wrist than its PIP joint; thumb uses x-distance from index MCP vs IP. Sum across hands, clamp 0–5.
- Debounce: same count for ≥1000 ms, then lock out until hand goes to 0 / away.
- Feedback: big number animation, WebAudio sfx (synthesised beeps OK), `speechSynthesis` counting.
- Fallback: big touch buttons 1–5 when camera denied/unavailable (always visible on desktop too).
- Isometric render: tile (row,col) → screen x=(col-row)*tileW/2, y=(col+row)*tileH/4; draw back-to-front.

## Assets (`assets/`)
Transparent PNGs: `fox_idle, fox_crouch, fox_jump, fox_land, fox_cheer, fox_wave`, tiles `tile_grass, tile_sand, tile_water, tile_stone, tile_number, tile_bridge`, items/decor `strawberry, star, chest, bush, tree, flowers`. Images are isometric-ish blocks with a slight shadow; scale to fit.

## Level schema (`levels/levels.json`)
```json
{
  "tileKey": { "G": "tile_grass", "W": "tile_water", ".": null },
  "levels": [{
    "id": 1, "name": "Strawberry Lane",
    "tiles": ["GGGGGG"],          // rows of tile codes; "." = empty
    "path": [[0,0],[0,1]],        // ordered [row,col]; fox starts at index 0
    "items": [{"type":"strawberry","index":2}],  // index into path
    "world": 1,                   // level-select group (see top-level "worlds")
    "goal": {"index":5, "item":"star", "exact": false}, // star or chest; exact = must land on it
    "decor": [{"type":"tree","row":1,"col":0}],   // non-path scenery
    "maxHop": 3,                  // counts above this are clamped
    "hint": "Show me fingers!"
  }]
}
```
Rule: a hop whose landing path tile is `W` (water) fails softly; water must be jumped over by choosing the exact count.

### Levels (15, in 4 worlds)
| World | Levels | Idea |
|---|---|---|
| 🌼 Meadow | 1–4 | 1–3 hops, straight lines, one corner, strawberries |
| 🌊 Turns & Water | 5–8 | zig-zags, U-turns, water to jump, a bridge; up to 5 hops |
| 🎯 Puzzles | 9–12 | `exact` goal — pick the right number to land on the star, stepping stones |
| 🏝️ Adventure | 13–15 | long winding paths, number plates over water, treasure chest |

Levels are authored in `tools/levels.py` (paths written as moves `R/L/D/U`), which checks every level is finishable while collecting everything and regenerates `levels.json`: `python3 tools/levels.py levels/levels.json`.

Item types on the path (`items`): **collectibles** `strawberry`, `gem`, `heart` (all of them = the second ⭐), and **blockers** `rock` (landing on it bumps you back, like water). Goals: `star`, `star_alt`, `chest`. Scenery (`decor`, off the path): `tree`, `bush`, `flowers`, `mushroom`, `flower_tulip`, `rock`.

## Characters & dress-up
- Fox, wolf and bear, picked on the 👕 dress-up screen (button with your character on the level screen). Wolf and bear only have idle/jump art, so those stand in for crouch/land/cheer/wave.
- Outfits (one per slot: head, eyes, neck, back): party hat (free), sunglasses (3⭐), scarf (finish level 4), crown (9⭐), mask (finish level 8), pirate hat (18⭐), cape (finish level 12), wizard hat (finish level 15). New unlocks pop up on the win screen with 🎁. The chosen look is saved in localStorage (`fingerhop.look.v1`).
- All of it is data in `assets/characters.json`: the pose → sprite map per character, per-sprite anchors (feet, head, eyes, neck), outfit anchors, sizes, optional offsets and unlock rules. Anchors started from `assets/manifest-outfits.md` and were tuned by eye. The fox anchors were measured, the sunglasses moved up (they sat low), the scarf was raised, and the cape was enlarged so it shows behind the shoulders. To tune: `python3 tools/outfit_preview.py out.png [outfit ...]` renders every pose with the same data.

## How to run / deploy

No build step: it's static files (`index.html`, `style.css`, `src/*.js` ES modules, `sw.js`).

**Run locally**
```bash
python3 -m http.server 8000      # or: npx serve .
```
Open http://localhost:8000. Camera access needs a secure context: `localhost` works, but a phone on your LAN needs HTTPS. For a quick phone test, use a tunnel (e.g. `npx localtunnel --port 8000` or `cloudflared tunnel --url http://localhost:8000`) or deploy.

**Deploy to GitHub Pages**: Settings → Pages → *Deploy from a branch* → `main` / root. Every file path is relative, so it works under `https://<user>.github.io/finger-hop/`. Netlify also works: drag the folder in, no build command.

**Notes**
- After an update, phones get the new version on the next reload (the service worker re-fetches everything when `VERSION` changes and reloads once from the start/level screen).
- MediaPipe `tasks-vision@0.10.21` (bundle + WASM) loads from jsDelivr, and the `hand_landmarker.task` model (~7.8 MB) from Google Storage. `sw.js` caches them after the first load, together with the app and sprites, so later visits work offline. Bump `VERSION` in `sw.js` when you change app files.
- If the camera is denied or unavailable, the game hides the camera bubble and the 1–5 buttons still work. 📷 turns the camera on/off (remembered); 🔄 switches front/back.
- **Sound**: every file is listed once in `src/sounds.js` (effects, voice lines, music; credits in `assets/audio/CREDITS.md`). Ogg is used where the browser "probably" plays it, mp3 otherwise (Safari/iOS); a failed decode falls back to the next format, and a missing effect falls back to a small synth. The number is spoken (recorded voice) the moment a count locks in, and each hop is counted aloud. Music: the theme jingle plays after the first tap, the loop in levels; it ducks under voice lines. 🎵 toggles music, 🔊/🔇 mutes everything (both remembered). `assets/audio/masters/` (full-quality WAVs for a future App Store build) is never loaded or cached.
- **iPhone audio**: sound and speech unlock on the first tap (the start screen is one big "tap to play" target) and re-unlock on every later tap, so audio comes back after calls or backgrounding. The page asks iOS for a "playback" audio session (`navigator.audioSession` on iOS 17+, or a looping silent `<audio>` on older iOS), so effects play even with the silent switch on. 🔊/🔇 on every screen mutes sound and speech (remembered); 💬 repeats the level hint.
- Desktop: keys `1`–`5` also hop; Enter/Space = GO.
- Tuning via URL params (handy on the phone): `?hold=2000` (ms a count must stay steady, default 1800), `?ready=2000` (calm pause per turn, default 1500), `?unlock=1` (open every level). Combine with `&`.
- Progress (completed levels + strawberries) is saved in `localStorage` under `fingerhop.progress.v1`.
- Code map: `src/main.js` (app shell: screens, level select, input wiring), `src/game.js` (rules + hop sequencing), `src/render.js` (isometric canvas), `src/characters.js` (characters, outfits, unlocks, avatar drawing), `src/wardrobe.js` (dress-up screen), `src/hands.js` (camera, finger counting, debounce), `src/audio.js` (iOS unlock, effects/voice/music playback, mute, speech), `src/sounds.js` (sound file list), `src/levels.js` (level loading, item kinds, progress).
- **Consistency check**: `node tools/check.mjs` verifies every referenced image/sound exists, the service worker precaches all code and images, and levels/outfits only use known sprites. Run it after adding assets.
