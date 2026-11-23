// Card motion: every change on the table is shown as cards flying from where
// they were to where they are now, glowing on the way and for a moment after.
import { cardSVG, backSVG } from './cards.js';

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let layer = null;
function fxLayer() {
  if (!layer) { layer = document.createElement('div'); layer.id = 'fx'; document.body.appendChild(layer); }
  return layer;
}

// Positions of everything a card can move between, keyed by:
// slot id, 'deck', 'discard', 'hand:<pid>' (the player's seat)
export function snapshot(root) {
  const r = {};
  root.querySelectorAll('[data-slot]').forEach((el) => { r[el.dataset.slot] = el.getBoundingClientRect(); });
  root.querySelectorAll('[data-pile]').forEach((el) => { r[el.dataset.pile] = el.getBoundingClientRect(); });
  root.querySelectorAll('[data-hand]').forEach((el) => { r['hand:' + el.dataset.hand] = el.getBoundingClientRect(); });
  return r;
}

const center = (rc) => ({ x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 });

// Fly one card from rect a to rect b. face: card name or null for a back.
// flipTo: card name (or 'back') to switch to half way.
export function fly(a, b, { face = null, flipTo, dur = 560, delay = 0 } = {}) {
  if (!a || !b || reduce) return Promise.resolve();
  const w = Math.max(28, Math.min(80, b.width > b.height ? b.height : b.width) || 60);
  const h = w * 1.4;
  const el = document.createElement('div');
  el.className = 'fly';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.innerHTML = face ? cardSVG(face) : backSVG();
  fxLayer().appendChild(el);
  const ca = center(a), cb = center(b);
  const at = (p, s, r) => `translate(${p.x - w / 2}px, ${p.y - h / 2}px) scale(${s}) rotate(${r}deg)`;
  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 - 30 };
  const anim = el.animate([
    { transform: at(ca, 0.9, 0), opacity: 0.2 },
    { transform: at(mid, 1.25, (cb.x - ca.x) > 0 ? 10 : -10), opacity: 1, offset: 0.5 },
    { transform: at(cb, 1, 0), opacity: 1 },
  ], { duration: dur, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
  if (flipTo !== undefined) setTimeout(() => { el.innerHTML = flipTo === 'back' || !flipTo ? backSVG() : cardSVG(flipTo); }, delay + dur / 2);
  return anim.finished.catch(() => {}).then(() => el.remove());
}

// A card everyone should see: it grows face-up where it is, travels face-up
// to its new slot, settles, then turns face-down.
export function flyShow(a, b, face, { dur = 1500 } = {}) {
  if (!a || !b || reduce) return Promise.resolve();
  const w = Math.max(28, Math.min(80, b.width > b.height ? b.height : b.width) || 60);
  const h = w * 1.4;
  const el = document.createElement('div');
  el.className = 'fly show';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.innerHTML = cardSVG(face);
  fxLayer().appendChild(el);
  const ca = center(a), cb = center(b);
  const at = (p, sc) => `translate(${p.x - w / 2}px, ${p.y - h / 2}px) scale(${sc})`;
  const anim = el.animate([
    { transform: at(ca, 1), offset: 0 },
    { transform: at(ca, 1.6), offset: 0.2 },
    { transform: at(ca, 1.6), offset: 0.32 },
    { transform: at(cb, 1.35), offset: 0.72 },
    { transform: at(cb, 1), offset: 0.82 },
    { transform: at(cb, 1) + ' scaleX(0)', offset: 0.91 },
    { transform: at(cb, 1), offset: 1 },
  ], { duration: dur, easing: 'ease-in-out', fill: 'both' });
  setTimeout(() => { el.innerHTML = backSVG(); }, dur * 0.91);
  return anim.finished.catch(() => {}).then(() => el.remove());
}

export function popCommand(name) {
  if (reduce) return Promise.resolve();
  const el = document.createElement('div');
  el.className = 'cmd-pop';
  el.innerHTML = cardSVG(name);
  fxLayer().appendChild(el);
  return new Promise((res) => setTimeout(() => { el.remove(); res(); }, 1100));
}

export const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

// Sequential queue so several moves in a row are each visible.
let chain = Promise.resolve();
let pending = 0;
export function enqueue(fn) {
  pending++;
  chain = chain.then(fn).catch((e) => console.error(e)).then(() => { pending--; });
  return chain;
}
export const busy = () => pending > 0;

// Big center announcement: the card, who played it on whom, and what it does.
export function announce({ html, title, desc, hot }) {
  const el = document.createElement('div');
  el.className = 'announce' + (hot ? ' hot' : '');
  el.innerHTML = `<div class="a-card">${html}</div><div class="a-title"></div><div class="a-desc"></div>`;
  el.querySelector('.a-title').textContent = title;
  el.querySelector('.a-desc').textContent = desc;
  fxLayer().appendChild(el);
  const ms = /[?&]fast/.test(location.search) ? 300 : 3000; // tests run fast
  return new Promise((res) => setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); res(); }, 250); }, ms));
}

// A banana thrown from one player's picture into another's face: it spins
// along an arc, squashes on impact and leaves a splat for a moment.
export function bananaThrow(fromEl, toEl, { onHit } = {}) {
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2, by = b.top + b.height / 2;
  const size = Math.max(44, Math.min(70, b.width * 1.1));
  const el = document.createElement('img');
  el.src = 'cards/banana-throw.webp';
  el.className = 'ban-fly';
  el.style.width = size + 'px';
  fxLayer().appendChild(el);
  const dur = reduce ? 10 : 750;
  const lift = Math.min(160, Math.hypot(bx - ax, by - ay) * 0.45);
  const frames = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t - lift * 4 * t * (1 - t);
    const sc = 0.7 + 0.5 * Math.sin(Math.PI * t) + 0.2 * t;
    frames.push({ transform: `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${t * 720}deg) scale(${sc})`, offset: t });
  }
  el.animate(frames, { duration: dur, easing: 'cubic-bezier(.35,.1,.6,1)', fill: 'forwards' }).finished.catch(() => {}).then(() => {
    // squash on the face
    el.animate([
      { transform: `translate(${bx - size / 2}px, ${by - size / 2}px) rotate(20deg) scale(1.1)` },
      { transform: `translate(${bx - size / 2}px, ${by - size / 2 + size * 0.15}px) rotate(20deg) scale(1.7, .45)`, offset: 0.25 },
      { transform: `translate(${bx - size / 2}px, ${by - size / 2 + size * 0.3}px) rotate(20deg) scale(1.6, .35)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${bx - size / 2}px, ${by - size / 2 + size * 0.6}px) rotate(20deg) scale(1.5, .3)`, opacity: 0 },
    ], { duration: 1700, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove());
    const sp = document.createElement('div');
    sp.className = 'ban-splat';
    const w = Math.max(b.width, 40) * 1.25;
    sp.style.cssText = `left:${bx - w / 2}px;top:${by - w / 2}px;width:${w}px;height:${w}px`;
    sp.innerHTML = `<svg viewBox="0 0 100 100"><path d="M50 14c7 0 9 9 15 9 6 0 11-6 15-2 4 5-3 10 0 15 3 6 12 6 12 13 0 6-9 6-10 12-1 7 7 13 2 18-5 4-11-3-17 0-6 3-6 12-14 12-7 0-8-9-14-11-6-2-13 4-17-1-4-6 3-11 1-17-2-6-12-8-12-14 0-7 10-6 12-12 2-7-5-13 0-17 5-4 11 3 16 0 5-4 4-15 11-15z" fill="#ffe79a" stroke="#c99a1b" stroke-width="2"/><circle cx="18" cy="20" r="4" fill="#ffe79a"/><circle cx="86" cy="84" r="5" fill="#ffe79a"/><circle cx="12" cy="74" r="3" fill="#ffe79a"/><path d="M40 70c0 8 3 18 6 22" stroke="#ffe79a" stroke-width="6" stroke-linecap="round"/></svg>`;
    fxLayer().appendChild(sp);
    sp.animate([{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.12 }, { transform: 'scale(1)', opacity: 1, offset: 0.2 }, { transform: 'scale(1) translateY(6px)', opacity: 1, offset: 0.8 }, { transform: 'scale(1) translateY(14px)', opacity: 0 }], { duration: 2000, fill: 'forwards' }).finished.catch(() => {}).then(() => sp.remove());
    toEl.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px) rotate(-6deg)' }, { transform: 'translateX(5px) rotate(5deg)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 400 });
    if (onHit) onHit();
  });
}

// A command card that everyone should follow: it rises from the floor, grows
// with its name under it, then flies to whoever it is played on.
export function cmdFly(fromEl, toEls, face, label, { hot = false } = {}) {
  if (!fromEl || reduce) return wait(reduce ? 400 : 0);
  const a = fromEl.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const w = 64, h = w * 1.4;
  const targets = (toEls || []).filter(Boolean);
  const mk = () => {
    const el = document.createElement('div');
    el.className = 'cmdfly' + (hot ? ' hot' : '');
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.innerHTML = cardSVG(face) + (label ? `<span class="cf-lbl">${label}</span>` : '');
    fxLayer().appendChild(el);
    return el;
  };
  const at = (x, y, sc) => `translate(${x - w / 2}px, ${y - h / 2}px) scale(${sc})`;
  const cx = window.innerWidth / 2, cy = Math.min(window.innerHeight * 0.42, ay);
  const runs = (targets.length ? targets : [null]).map((t) => {
    const el = mk();
    const frames = [{ transform: at(ax, ay, 0.8), opacity: 0.6, offset: 0 }, { transform: at(cx, cy, 1.7), opacity: 1, offset: 0.25 }, { transform: at(cx, cy, 1.7), opacity: 1, offset: 0.55 }];
    if (t) {
      const b = t.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      frames.push({ transform: at(bx, by, 0.9), opacity: 1, offset: 0.88 }, { transform: at(bx, by, 0.5), opacity: 0, offset: 1 });
    } else frames.push({ transform: at(cx, cy, 1.4), opacity: 0, offset: 1 });
    return el.animate(frames, { duration: 1500, easing: 'ease-in-out', fill: 'forwards' }).finished.catch(() => {}).then(() => {
      el.remove();
      if (t) t.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 350 });
    });
  });
  return Promise.all(runs);
}
