// Sound-effect files. To swap a sound (e.g. for one from Envato Elements), drop the new
// file into assets/sfx/ and change its path here — mp3, m4a/aac or wav all work on
// iOS and Android. Remember to list new files in sw.js and bump its VERSION.
// If a file is missing or fails to decode, the game falls back to a synthesised sound.
//
// `gain` is a per-sound volume trim (1 = as recorded).

export const SOUNDS = {
  boing: { src: 'assets/sfx/boing.wav', gain: 1 }, // each hop (pitch rises per hop)
  land: { src: 'assets/sfx/land.wav', gain: 1 }, // feet touch down
  collect: { src: 'assets/sfx/collect.wav', gain: 1 }, // strawberry picked up
  splash: { src: 'assets/sfx/splash.wav', gain: 1 }, // landed in water
  fanfare: { src: 'assets/sfx/fanfare.wav', gain: 1 }, // reached the goal
  oops: { src: 'assets/sfx/oops.wav', gain: 1 }, // too many hops / locked level
  ready: { src: 'assets/sfx/ready.wav', gain: 1 }, // counting opens ("your turn")
  lock: { src: 'assets/sfx/lock.wav', gain: 1 }, // finger count locked in
  tap: { src: 'assets/sfx/tap.wav', gain: 1 }, // UI button
  star: { src: 'assets/sfx/star.wav', gain: 1 }, // each star on the win screen (pitch rises)
};
