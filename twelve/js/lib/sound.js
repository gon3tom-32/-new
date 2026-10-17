// Little festive sounds, made on the fly with the Web Audio API (no sound
// files). Sounds are on by default; each device can turn them off.
//
//   import { play } from "./sound.js";
//   play("door");
//
// Phones only allow sound after someone taps, so the first tap anywhere in the
// app quietly unlocks audio (see unlockAudio below).

const KEY = "twelve.sound";
const VOLUME = 0.35;

export function soundOn() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSoundOn(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
}

let ctx = null;
let master = null;
function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Call once at startup. The first tap anywhere unlocks audio for later sounds
// that don't come straight from a tap (like a reveal that loads after one).
export function unlockAudio() {
  const unlock = () => {
    if (!soundOn()) return;
    const c = audio();
    if (!c) return;
    // A silent blip is what iOS needs to really start the audio engine.
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(c.destination);
    const o = c.createOscillator();
    o.connect(g);
    o.start();
    o.stop(c.currentTime + 0.01);
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("touchend", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("touchend", unlock, true);
}

// ---------- Building blocks ----------

// One note with a quick attack and an exponential fade.
function tone(c, out, { freq, at = 0, dur = 0.3, vol = 0.5, type = "sine", attack = 0.005, slideTo }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// A bell: a few inharmonic partials, the high ones fading fastest.
function bell(c, out, freq, at = 0, vol = 0.35, dur = 1.2) {
  [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.25, 0.35], [8.93, 0.12, 0.2]].forEach(([ratio, v, d]) => {
    tone(c, out, { freq: freq * ratio, at, vol: vol * v, dur: dur * d });
  });
}

let noiseBuffer = null;
function noise(c, out, { at = 0, dur = 0.1, vol = 0.4, filter = "bandpass", freq = 3000, q = 1, attack = 0.002 }) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

// Sleigh-bell shimmer: lots of tiny bright jingles.
function jingle(c, out, at = 0, count = 14, spread = 0.5, vol = 0.18) {
  for (let i = 0; i < count; i++) {
    const when = at + (i / count) * spread + Math.random() * 0.03;
    noise(c, out, { at: when, dur: 0.07, vol: vol * (0.6 + Math.random() * 0.4), freq: 6500 + Math.random() * 3000, q: 8 });
    tone(c, out, { freq: 2600 + Math.random() * 1400, at: when, dur: 0.08, vol: vol * 0.25, type: "triangle" });
  }
}

// Note frequencies.
const N = { G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

// ---------- The sounds ----------

const SOUNDS = {
  // Advent door: the opening of "We Wish You a Merry Christmas" on a music box.
  door(c, out) {
    const box = (f, at) => {
      tone(c, out, { freq: f, at, dur: 0.9, vol: 0.24 });
      tone(c, out, { freq: f * 4, at, dur: 0.25, vol: 0.06 });
      tone(c, out, { freq: f * 2, at, dur: 0.5, vol: 0.08, type: "triangle" });
    };
    const e = 0.14; // one eighth note
    const D5 = 587.33, G5 = 783.99, A5 = 880, Fs5 = 739.99, E5 = 659.25;
    [[D5, 0], [G5, 2], [G5, 4], [A5, 5], [G5, 6], [Fs5, 7], [E5, 8], [E5, 10]].forEach(([f, i]) => box(f, i * e));
  },
  // Locked door: knock, knock.
  knock(c, out) {
    [0, 0.17].forEach((at) => {
      tone(c, out, { freq: 190, slideTo: 70, at, dur: 0.14, vol: 0.9, type: "sine" });
      noise(c, out, { at, dur: 0.05, vol: 0.5, filter: "lowpass", freq: 900 });
    });
  },
  // Scratch-off reveal: a rising sparkle, then a "ta-da!".
  reveal(c, out) {
    [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(c, out, f, i * 0.07, 0.18, 0.6));
    jingle(c, out, 0.05, 10, 0.35, 0.1);
    const brass = (f, at, dur) => {
      tone(c, out, { freq: f, at, dur, vol: 0.16, type: "sawtooth", attack: 0.02 });
      tone(c, out, { freq: f * 2, at, dur, vol: 0.05, type: "square", attack: 0.02 });
    };
    [N.C5, N.E5, N.G5].forEach((f) => brass(f, 0.38, 0.14));
    [N.C5, N.E5, N.G5, N.C6].forEach((f) => brass(f, 0.56, 0.75));
  },
  // A right answer: a bright two-note ding.
  right(c, out) {
    bell(c, out, N.E6, 0, 0.3, 0.5);
    bell(c, out, N.A5 * 2, 0.09, 0.3, 0.7);
  },
  // A wrong answer: a soft, friendly bonk.
  wrong(c, out) {
    tone(c, out, { freq: 260, slideTo: 120, dur: 0.28, vol: 0.5, type: "triangle" });
    tone(c, out, { freq: 130, slideTo: 70, dur: 0.3, vol: 0.4, type: "sine" });
  },
  // Champion reveal: a drumroll that builds, a cymbal, then a fanfare.
  champion(c, out) {
    const roll = 1.6;
    for (let t = 0; t < roll; t += 0.045) {
      const v = 0.08 + (t / roll) * 0.35;
      noise(c, out, { at: t, dur: 0.06, vol: v, filter: "bandpass", freq: 1800, q: 0.7 });
      tone(c, out, { freq: 180, at: t, dur: 0.05, vol: v * 0.5, type: "triangle" });
    }
    noise(c, out, { at: roll, dur: 1.6, vol: 0.35, filter: "highpass", freq: 5000, q: 0.5 });
    tone(c, out, { freq: 90, slideTo: 50, at: roll, dur: 0.4, vol: 0.8 });
    const brass = (f, at, dur, vol = 0.14) => {
      tone(c, out, { freq: f, at, dur, vol, type: "sawtooth", attack: 0.025 });
      tone(c, out, { freq: f / 2, at, dur, vol: vol * 0.6, type: "triangle", attack: 0.025 });
    };
    const s = roll + 0.05;
    brass(N.G4, s, 0.16);
    brass(N.C5, s + 0.17, 0.16);
    brass(N.E5, s + 0.34, 0.16);
    brass(N.G5, s + 0.51, 0.35);
    brass(N.E5, s + 0.88, 0.14);
    [N.C5, N.E5, N.G5, N.C6].forEach((f) => brass(f, s + 1.05, 1.3, 0.11));
    jingle(c, out, s + 1.05, 12, 0.8, 0.1);
  },
  // Finishing the questionnaire: a confetti pop and a sparkle.
  done(c, out) {
    noise(c, out, { dur: 0.09, vol: 0.6, filter: "bandpass", freq: 1200, q: 0.8 });
    tone(c, out, { freq: 300, slideTo: 900, dur: 0.12, vol: 0.4 });
    [N.G5, N.C6, N.E6, N.G6].forEach((f, i) => bell(c, out, f, 0.12 + i * 0.06, 0.16, 0.5));
    jingle(c, out, 0.15, 10, 0.5, 0.1);
  },
  // Chat reaction: a tiny, quiet pop.
  pop(c, out) {
    tone(c, out, { freq: 420, slideTo: 1100, dur: 0.08, vol: 0.35 });
    noise(c, out, { dur: 0.03, vol: 0.15, filter: "highpass", freq: 2000 });
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS);

export function play(name) {
  if (!soundOn()) return;
  const c = audio();
  if (!c || !SOUNDS[name]) return;
  try { SOUNDS[name](c, master); } catch { /* never let a sound break the app */ }
}
