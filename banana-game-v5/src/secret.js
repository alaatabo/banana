// Home screen: the monkeys and the logo react when touched, and a secret
// order of taps unlocks a gift. Nothing tells the player the order is wrong.
//
// Code: monkey (right), logo, parrot (left), monkey, parrot, logo.
// One random gift per visit; it lasts until the page is reloaded.
// Owner: tap the logo 7 times in a row, then type the owner number.
const CODE = ['R', 'logo', 'L', 'R', 'L', 'logo'];
const OWNER_TAPS = 7;
const OWNER_PIN = '159753';

import { FRAME_SCALE } from './avatars.js';

export const GIFTS = [
  ...FRAME_SCALE.map((_, i) => ({ id: 'f' + (i + 1), kind: 'frame', src: `gifts/frame${i + 1}.webp` })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 'gt' + n, kind: 'table', src: `gifts/table${n}.webp` })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: 'g' + n, kind: 'avatar', src: `gifts/av${n}.webp` })),
];
export const giftById = (id) => GIFTS.find((g) => g.id === id);

// Kept in memory only: a reload takes the gift away.
export const owned = [];
const ownedKinds = (kind) => owned.map(giftById).filter((g) => g && g.kind === kind);
export const ownedFrames = () => ownedKinds('frame');
export const ownedTables = () => ownedKinds('table');
export const ownedAvatars = () => ownedKinds('avatar');

let seq = [];
let lastTap = 0;
let logoRun = 0;

function poke(root, who) {
  const els = who === 'logo' ? root.querySelectorAll('.logo') : root.querySelectorAll(`.lay[data-mk="${who}"]`);
  els.forEach((el) => {
    el.classList.remove('poke'); void el.offsetWidth; el.classList.add('poke');
    el.addEventListener('animationend', () => el.classList.remove('poke'), { once: true });
  });
}

function unlockOne() {
  if (owned.length) return null; // one gift per visit
  const g = GIFTS[Math.floor(Math.random() * GIFTS.length)];
  owned.push(g.id);
  return g;
}

export function unlockAll(pin) {
  if (String(pin).trim() !== OWNER_PIN) return false;
  for (const g of GIFTS) if (!owned.includes(g.id)) owned.push(g.id);
  return true;
}

// onWin(gift) for the code; onOwner() after 7 logo taps in a row.
export function onSecretTap(root, who, onWin, onOwner) {
  poke(root, who);
  const now = Date.now();
  if (now - lastTap > 6000) seq = []; // too slow: start over quietly
  logoRun = who === 'logo' && now - lastTap < 2000 ? logoRun + 1 : who === 'logo' ? 1 : 0;
  lastTap = now;
  if (logoRun >= OWNER_TAPS) { logoRun = 0; seq = []; onOwner(); return; }
  seq.push(who);
  // keep only the longest tail of taps that still matches the start of the code
  while (seq.length && seq.some((x, i) => x !== CODE[i])) seq.shift();
  if (seq.length === CODE.length) {
    seq = [];
    const g = unlockOne();
    if (g) onWin(g);
  }
}
