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
