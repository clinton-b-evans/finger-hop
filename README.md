# Finger Hop 🦊✋

A toddler (age ~3) counting game for the phone browser. Inspired by Osmo Coding's Awbie — but instead of physical code blocks, the child **holds up 1–5 fingers** to the camera and a chubby fox hops that many tiles along an isometric path, collecting strawberries and reaching a star (or a treasure chest).

## Play loop
1. Fox stands on the path. Hint text + voice: "Show me fingers!"
2. Child holds up N fingers. Count must be **steady for ~1 s** (debounce) before it acts; a ring fills up to show progress.
3. A big animated number pops up, fox hops N tiles; each hop plays a boing and speaks the count ("one… two… three!") via the Web Speech API.
4. Landing on a strawberry collects it (sparkle + sound). Landing on water = gentle splash, fox bounces back to where it started (no fail state, just "Try again!").
5. Reaching the goal exactly or overshooting clamps to the goal → celebration, next level.

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
    "goal": {"index":5, "item":"star"},           // star or chest
    "decor": [{"type":"tree","row":1,"col":0}],   // non-path scenery
    "maxHop": 3,                  // counts above this are clamped
    "hint": "Show me fingers!"
  }]
}
```
Rule: a hop whose landing path tile is `W` (water) fails softly; water must be jumped over by choosing the exact count.

## How to run / deploy

No build step: it's static files (`index.html`, `style.css`, `src/*.js` ES modules, `sw.js`).

**Run locally**
```bash
python3 -m http.server 8000      # or: npx serve .
```
Open http://localhost:8000. Camera access needs a secure context: `localhost` works, but a phone on your LAN needs HTTPS. For a quick phone test, use a tunnel (e.g. `npx localtunnel --port 8000` or `cloudflared tunnel --url http://localhost:8000`) or deploy.

**Deploy to GitHub Pages**: Settings → Pages → *Deploy from a branch* → `main` / root. Every file path is relative, so it works under `https://<user>.github.io/finger-hop/`. Netlify also works: drag the folder in, no build command.

**Notes**
- MediaPipe `tasks-vision@0.10.21` (bundle + WASM) loads from jsDelivr, and the `hand_landmarker.task` model (~7.8 MB) from Google Storage. `sw.js` caches them after the first load, together with the app and sprites, so later visits work offline. Bump `VERSION` in `sw.js` when you change app files.
- If the camera is denied or unavailable, the game hides the camera bubble and the 1–5 buttons still work. 📷 turns the camera on/off (remembered); 🔄 switches front/back.
- Desktop: keys `1`–`5` also hop.
- Progress (completed levels + strawberries) is saved in `localStorage` under `fingerhop.progress.v1`.
- Code map: `src/main.js` (screens, UI, input wiring), `src/game.js` (rules + hop sequencing), `src/render.js` (isometric canvas), `src/hands.js` (camera, finger counting, 1 s debounce), `src/audio.js` (WebAudio sfx + speech), `src/levels.js` (level loading + progress).
