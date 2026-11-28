// Game sounds, made in code with the Web Audio API (no sound files).
// Phones only allow sound after the first touch, so the audio starts then.
let ctx = null;
let master = null;
const KEY = 'banana.sound';
let on = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();

export const soundOn = () => on;
export function setSound(v) { on = !!v; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// recorded sounds (decoded once, after the first touch)
const SAMPLES = { monkeyRec: 'sounds/monkey.mp3' };
const bufs = {};
function loadSamples() {
  for (const [k, url] of Object.entries(SAMPLES)) {
    if (bufs[k] !== undefined) continue;
    bufs[k] = null;
    fetch(url).then((r) => r.arrayBuffer()).then((a) => new Promise((res, rej) => ctx.decodeAudioData(a, res, rej))).then((b) => { bufs[k] = b; }).catch(() => {});
  }
}
function sample(k, vol = 1) {
  if (!bufs[k]) return false;
  const src = ctx.createBufferSource(); src.buffer = bufs[k];
  const g = ctx.createGain(); g.gain.value = vol; src.connect(g); g.connect(master); src.start();
  return true;
}
// unlock on the first touch
['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, () => { if (ac()) loadSamples(); }, { once: true, capture: true }));

const now = () => ctx.currentTime;

function tone({ f = 440, f2 = null, type = 'sine', at = 0, dur = 0.15, vol = 0.3, attack = 0.005 }) {
  const t = now() + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise({ at = 0, dur = 0.12, vol = 0.3, freq = 2000, q = 1, type = 'bandpass', sweep = null }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = now() + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

// A cartoon monkey: "ooh ooh aah aah" made of sliding, buzzy voices.
function monkey(at = 0) {
  const calls = [[520, 820, 0.13], [540, 860, 0.13], [700, 1250, 0.2], [720, 1300, 0.24]];
  let t = at;
  for (const [a, b, d] of calls) {
    const tt = now() + t;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(a, tt); o.frequency.exponentialRampToValueAtTime(b, tt + d * 0.6); o.frequency.exponentialRampToValueAtTime(b * 0.8, tt + d);
    o2.frequency.setValueAtTime(a * 1.01, tt); o2.frequency.exponentialRampToValueAtTime(b * 1.01, tt + d * 0.6);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 28; vg.gain.value = 40;
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.5, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
    o.connect(f); o2.connect(f); f.connect(g).connect(master);
    [o, o2, vib].forEach((x) => { x.start(tt); x.stop(tt + d + 0.05); });
    t += d + 0.04;
  }
}

const S = {
  tap: () => tone({ f: 900, type: 'triangle', dur: 0.05, vol: 0.18 }),
  draw: () => noise({ dur: 0.18, freq: 3000, sweep: 1200, vol: 0.25, q: 0.7 }),
  place: () => { noise({ dur: 0.07, freq: 900, vol: 0.4, q: 1.2 }); tone({ f: 160, f2: 90, dur: 0.08, vol: 0.25 }); },
  flip: () => noise({ dur: 0.09, freq: 4200, sweep: 2500, vol: 0.22, q: 1 }),
  swap: () => { noise({ dur: 0.25, freq: 600, sweep: 3500, vol: 0.25, q: 0.8 }); noise({ at: 0.18, dur: 0.07, freq: 900, vol: 0.3 }); },
  shuffle: () => { for (let i = 0; i < 9; i++) noise({ at: i * 0.045, dur: 0.05, freq: 2500 + Math.random() * 1500, vol: 0.2, q: 1.5 }); },
  deal: () => { for (let i = 0; i < 6; i++) noise({ at: i * 0.09, dur: 0.07, freq: 2800, sweep: 1500, vol: 0.2 }); },
  snapOk: () => { tone({ f: 880, type: 'triangle', dur: 0.12, vol: 0.3 }); tone({ f: 1320, type: 'triangle', at: 0.09, dur: 0.25, vol: 0.3 }); },
  snapBad: () => { tone({ f: 330, f2: 220, type: 'square', dur: 0.22, vol: 0.12 }); tone({ f: 260, f2: 150, type: 'square', at: 0.2, dur: 0.35, vol: 0.12 }); },
  magic: () => { [660, 880, 1100, 1320, 1760].forEach((f, i) => tone({ f, type: 'sine', at: i * 0.05, dur: 0.3, vol: 0.14 })); },
  freeze: () => { [2400, 3100, 2700, 3600].forEach((f, i) => tone({ f, type: 'triangle', at: i * 0.06, dur: 0.25, vol: 0.1 })); noise({ dur: 0.3, freq: 6000, vol: 0.12, type: 'highpass' }); },
  plus: () => tone({ f: 300, f2: 900, type: 'sine', dur: 0.12, vol: 0.35 }),
  guard: () => { tone({ f: 520, type: 'square', dur: 0.06, vol: 0.15 }); tone({ f: 1040, type: 'triangle', dur: 0.5, vol: 0.18 }); tone({ f: 1560, type: 'sine', dur: 0.4, vol: 0.1 }); },
  tornado: () => noise({ dur: 0.9, freq: 300, sweep: 2500, vol: 0.3, q: 3 }),
  golden: () => { [1320, 1760, 2093, 2637].forEach((f, i) => tone({ f, type: 'sine', at: i * 0.07, dur: 0.4, vol: 0.12 })); },
  alert: () => { tone({ f: 740, type: 'square', dur: 0.1, vol: 0.12 }); tone({ f: 740, type: 'square', at: 0.16, dur: 0.1, vol: 0.12 }); },
  turn: () => { tone({ f: 784, type: 'sine', dur: 0.15, vol: 0.25 }); tone({ f: 1047, type: 'sine', at: 0.12, dur: 0.3, vol: 0.25 }); },
  tick: () => tone({ f: 1800, type: 'square', dur: 0.03, vol: 0.08 }),
  banana: () => { if (!sample('monkeyRec', 1.4)) { tone({ f: 110, f2: 70, type: 'sine', dur: 0.3, vol: 0.6 }); monkey(0.12); } },
  drum: () => { for (let i = 0; i < 8; i++) tone({ f: 130, f2: 80, type: 'sine', at: i * 0.07, dur: 0.08, vol: 0.25 + i * 0.03 }); tone({ f: 90, f2: 50, at: 0.6, dur: 0.4, vol: 0.6 }); },
  win: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ f, type: 'triangle', at: i * 0.12, dur: i === 5 ? 0.6 : 0.14, vol: 0.25 })); },
  lose: () => { [392, 370, 349, 330].forEach((f, i) => tone({ f, type: 'triangle', at: i * 0.2, dur: i === 3 ? 0.6 : 0.2, vol: 0.2 })); },
  gift: () => { S.magic(); tone({ f: 1568, type: 'triangle', at: 0.3, dur: 0.5, vol: 0.2 }); },
  monkey: () => monkey(0),
  whoosh: () => noise({ dur: 0.35, freq: 500, sweep: 2600, vol: 0.28, q: 1.5 }),
  splat: () => { noise({ dur: 0.25, freq: 700, sweep: 200, vol: 0.6, q: 0.8, type: 'lowpass' }); tone({ f: 180, f2: 60, type: 'sine', dur: 0.2, vol: 0.5 }); noise({ at: 0.05, dur: 0.15, freq: 1800, vol: 0.2 }); },
};

let last = {};
export function play(name) {
  if (!on || !S[name]) return;
  if (!ac() || ctx.state !== 'running') return;
  const t = performance.now();
  if (last[name] && t - last[name] < 60) return; // no pile-ups
  last[name] = t;
  try { S[name](); } catch {}
}
