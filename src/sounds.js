// Every sound file the game plays, in one place. Paths are relative to assets/audio/,
// without extension; `formats` lists the encodings that exist (first playable one wins,
// falling back to the next if decoding fails). `gain` trims the volume (1 = as mastered).
// Credits/licences: assets/audio/CREDITS.md. Masters in assets/audio/masters/ are NOT
// used at runtime (and never cached by the service worker).
//
// Sounds with no file here (splash, ready) are synthesised in audio.js.

export const AUDIO_BASE = 'assets/audio/';

export const SOUNDS = {
  // effects
  hop: { file: 'sfx_hop', formats: ['ogg', 'mp3'], gain: 0.7 },
  land: { file: 'sfx_land', formats: ['ogg', 'mp3'], gain: 0.6 },
  coin: { file: 'sfx_coin', formats: ['ogg', 'mp3'], gain: 0.8 },
  correct: { file: 'sfx_correct', formats: ['ogg', 'mp3'], gain: 0.7 },
  tryAgain: { file: 'sfx_try_again', formats: ['ogg', 'mp3'], gain: 0.8 },
  levelComplete: { file: 'sfx_level_complete', formats: ['ogg', 'mp3'], gain: 0.8 },
  cheer: { file: 'sfx_cheer', formats: ['ogg', 'mp3'], gain: 0.5 },
  tap: { file: 'sfx_tap', formats: ['ogg', 'mp3'], gain: 0.6 },
  star: { file: 'sfx_star', formats: ['ogg', 'mp3'], gain: 0.7 },

  // voice lines (Envato AI VoiceGen "Sophie")
  one: { file: 'voice/one', formats: ['mp3'], gain: 1, kind: 'voice' },
  two: { file: 'voice/two', formats: ['mp3'], gain: 1, kind: 'voice' },
  three: { file: 'voice/three', formats: ['mp3'], gain: 1, kind: 'voice' },
  four: { file: 'voice/four', formats: ['mp3'], gain: 1, kind: 'voice' },
  five: { file: 'voice/five', formats: ['mp3'], gain: 1, kind: 'voice' },
  greatJob: { file: 'voice/great_job', formats: ['mp3'], gain: 1, kind: 'voice' },
  hopHop: { file: 'voice/hop_hop', formats: ['mp3'], gain: 1, kind: 'voice' },

  // music
  musicLoop: { file: 'music_loop', formats: ['ogg', 'mp3'], gain: 0.28, kind: 'music', loop: true },
  jingle: { file: 'music_theme_jingle', formats: ['mp3'], gain: 0.4, kind: 'music' },
};
