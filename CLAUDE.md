# Instructions for the coding agent

Build the playable MVP described in README.md.

- Files: `index.html`, `src/*.js` (ES modules), `style.css`, `sw.js` (service worker caching assets + MediaPipe). No bundler.
- Load `levels/levels.json` and sprites from `assets/`. Don't regenerate art.
- Implement: isometric renderer, fox hop animation (crouch → jump arc → land → idle; cheer at goal; wave on level start), strawberry collect, water soft-fail, goal celebration, level select/progress in localStorage.
- Camera: MediaPipe tasks-vision HandLandmarker, front/back toggle, 1 s steady-count debounce with visual ring, touch buttons 1–5 fallback.
- Sounds: WebAudio synthesised boing/collect/splash/fanfare; Web Speech API for counting and hints.
- Toddler UX: huge targets, no text-only instructions, no fail screens, landscape + portrait.
- Must work served statically over HTTPS (GitHub Pages). Test locally with `npx serve` or `python3 -m http.server`.
- Add a short "How to run / deploy" section to README when done. Open a PR; don't merge.
