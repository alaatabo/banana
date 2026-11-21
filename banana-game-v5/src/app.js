import { learnHTML, LEARN } from './learn.js';
import { pickBotNames } from './bot.js';
import { onSecretTap, unlockAll, ownedFrames, ownedTables, ownedAvatars, giftById } from './secret.js';
import { AVATAR_IDS, avatarInner, isPlayerAvatar, frameHTML } from './avatars.js';
import { Host } from './host.js';
import { cardSVG, backSVG, CARD_INFO, CARD_DESC } from './cards.js';
import { NUM_EFFECT } from './engine.js';
import * as Net from './net.js';
import { isLocalOnly } from './store.js';
import * as FX from './fx.js';

const $app = document.getElementById('app');
const APP_DATE = '٢١ نوفمبر ٢٠٢٦';
const APP_V = 21; // keep in step with the cache name in sw.js
const LS = {
  get(k, d) { try { const v = localStorage.getItem('banana.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('banana.' + k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  screen: 'home',
  setup: LS.get('setup', { mode: 'solo', count: 4, level: 'medium', timed: true }),
  name: LS.get('name', ''),
  conn: null, // { act(a), leave(), isHost, room }
  me: null,
  view: null,
  reveals: {}, // slotId -> { card, until }
  peek: null, // { card, until }
  logs: [],
  banner: null,
  sel: {},
  selKey: '',
  lastRoundEnd: null,
  sheet: null, // extra sheet: 'scores' | 'menu' | 'rules'
  lobby: null,
  error: '',
  lit: {}, // slotId -> until (glow after a move)
  ghost: {}, // slotId -> until (hidden while a card flies in)
};

// ------------------------------------------------------------ helpers
const cardName = (n) => (CARD_INFO[n].tier === 'cmd' ? CARD_INFO[n].label[0] + CARD_INFO[n].label.slice(1).toLowerCase() : CARD_INFO[n].num);
const pname = (pid) => {
  if (!ui.view) return '';
  if (pid === ui.me) return 'إنت';
  const p = ui.view.players.find((x) => x.id === pid);
  return p ? p.name : '';
};
const meP = () => ui.view.players.find((p) => p.id === ui.me);
const OPTION_AR = {
  observe: ['Observe', 'بُص على كارت واحد عند كل لاعب (وعندك)'],
  shuffle: ['Shuffle', 'اخلط كروت لاعب تختاره'],
  skip: ['Skip', 'خلّي لاعب يفوّت دوره الجاي'],
  peek: ['Peek', 'بُص على أول كارت في الكومة'],
  activate: ['Activate', 'فعّل أمر من كروتك — لو طلع مش أمر تلبس كارت'],
};
const PROMPT = {
  revealOwn: 'اختار كارت من كروتك تكشفه للكل',
  peekOwn: 'اختار كارت من كروتك تبُص عليه',
  peekOther: 'اختار كارت عند لاعب تاني تبُص عليه',
  buzz: 'اختار اللاعب اللي هتلبّسه الكارت',
  curse: 'اختار الكارت اللي هيتغيّر',
  plus: 'اختار الخانة اللي هتاخد +5',
  freeze: 'اختار الخانة اللي هتتجمّد ٣ أدوار',
  swap: 'اختار كارت من كروتك، وبعدين كارت عند لاعب تاني',
  tornado: 'اختار اللاعب اللي كل كروته هتتغيّر',
  choose_shuffle: 'اختار لاعب تخلط كروته',
  choose_skip: 'اختار لاعب يفوّت دوره',
  observe: 'اختار كارت واحد عند كل لاعب، وبعدين أكّد',
  activate: 'اختار الكارت اللي هتفعّله',
};

function log(text) {
  const id = Math.random();
  ui.logs.push({ id, text });
  if (ui.logs.length > 3) ui.logs.shift();
  setTimeout(() => {
    ui.logs = ui.logs.filter((l) => l.id !== id);
    const el = $app.querySelector(`.log [data-log="${id}"]`);
    if (el) el.remove();
  }, 3200);
}
function banner(text, ms = 1100) {
  ui.banner = text;
  setTimeout(() => { if (ui.banner === text) { ui.banner = null; render(); } }, ms);
}
function buzz() { try { navigator.vibrate && navigator.vibrate(40); } catch {} }

// ------------------------------------------------------------ incoming updates
// Updates are applied in order. When a card's power is played, the big
// announcement shows first (3s) and everything that follows waits for it.
const updQ = [];
function resetUpdates() { updQ.length = 0; ui.gated = false; ui.pumping = false; ui.gen = (ui.gen || 0) + 1; }
function onUpdate(view, events) { updQ.push([view, events]); pumpUpdates(); }
// What the choose option does, told to everyone after the choice.
const CHOSE_AR = {
  observe: ['هيبُص على كارت عند كل لاعب', 'هيختار كارت من عند كل لاعب ويبُص عليه لوحده — وكل لاعب يقدر يحمي كارته بـ Guard'],
  shuffle: ['هيخلط كروت لاعب', 'هيختار لاعب وكروته هتتلخبط أماكنها، ومش هيعرف فين كل كارت'],
  skip: ['هيخلّي لاعب يفوّت دوره', 'هيختار لاعب مش هيلعب الدور الجاي بتاعه'],
  peek: ['هيبُص على أول كارت في الكومة', 'هيعرف الكارت اللي هيتسحب بعد كده من الكومة'],
  activate: ['هيشغّل أمر من كروته', 'هيختار كارت من كروته — لو طلع أمر هيشتغل، ولو طلع مش أمر هيلبس كارت زيادة'],
};

// Events that stop the game for a big announcement before anything else.
// One box per command: "X هينفذ Y على A و B". Cards that pick a target are
// announced once the target is known; the target himself gets the same box
// with the Guard question instead (see guardBox).
const TARGETING = new Set(['swap', 'buzz', 'curse', 'tornado', 'plus', 'freeze', 'choose', 'copy']);
function gateOf(e) {
  const by = (pid) => (pid === ui.me ? 'إنت' : pname(pid));
  const will = (pid) => (pid === ui.me ? 'هتنفذ' : 'هينفذ');
  if (e.type === 'effect' && CARD_DESC[e.card] && !TARGETING.has(e.card)) {
    return { card: e.card, title: `${by(e.pid)} ${will(e.pid)} ${cardName(e.card)}`, desc: CARD_DESC[e.card] };
  }
  if (e.type === 'copied' && !TARGETING.has(e.card)) {
    return { card: e.card, title: `${by(e.pid)} ${will(e.pid)} ${cardName(e.card)} بـ Copy`, desc: CARD_DESC[e.card] };
  }
  if (e.type === 'chose' && (e.option === 'peek' || e.option === 'activate')) {
    return { card: 'choose', title: `${by(e.pid)} ${will(e.pid)} ${OPTION_AR[e.option][0]} من Choose`, desc: CHOSE_AR[e.option][1] };
  }
  if (e.type === 'targeted') {
    const targets = e.targets || [e.target];
    if (targets.includes(ui.me) && e.by !== ui.me) return null; // my own box asks about the Guard
    const name = e.option ? `${OPTION_AR[e.option][0]} من Choose` : cardName(e.card);
    const on = targets.length === 1 && targets[0] === e.by ? (e.by === ui.me ? 'على نفسك' : 'على نفسه') : 'على ' + targets.map(by).join(' و');
    return { card: e.card, title: `${by(e.by)} ${will(e.by)} ${name}${e.viaCopy ? ' بـ Copy' : ''} ${on}`, desc: e.option ? CHOSE_AR[e.option][1] : CARD_DESC[e.card] };
  }
  if (e.type === 'guarded' && e.self && e.ok) {
    return { card: 'guard', title: `${by(e.pid)} رفض ${cardName(e.card)} بالـ Guard`, desc: 'الأمر اتلغى، والـ Guard راح الأرض' };
  }
  // End of a round / the game: let the last move finish and be seen first.
  if (e.type === 'roundEnd' || e.type === 'gameOver') return { pause: /[?&]fast/.test(location.search) ? 200 : 1600 };
  return null;
}

const fxIdle = () => new Promise((res) => FX.enqueue(() => res()));

async function pumpUpdates() {
  if (ui.pumping) return;
  ui.pumping = true;
  const gen = ui.gen;
  try {
    while (updQ.length) {
      const [view, events] = updQ.shift();
      if (ui.screen !== 'game') { applyUpdate(view, events); continue; }
      let rest = events;
      for (;;) {
        const k = rest.findIndex(gateOf);
        if (k < 0) { applyUpdate(view, rest); break; }
        const g = gateOf(rest[k]);
        ui.gated = true;
        if (g.pause) {
          applyUpdate(view, rest.slice(0, k));
          await fxIdle();
          if (gen !== ui.gen) return;
          await FX.wait(g.pause);
          if (gen !== ui.gen) return;
          // apply the end-of-round event itself, then keep going after it
          applyUpdate(view, rest.slice(k, k + 1));
          rest = rest.slice(k + 1);
          continue;
        }
        applyUpdate(view, rest.slice(0, k + 1));
        await fxIdle();
        if (gen !== ui.gen) return;
        await announce(g.card, g.title, g.hot, g.desc);
        if (gen !== ui.gen) return;
        rest = rest.slice(k + 1);
      }
      // Let every card move of this step finish before the next one shows.
      ui.gated = true;
      await fxIdle();
      if (gen !== ui.gen) return;
    }
    ui.gated = false;
    if (ui.screen === 'game' && ui.view) render();
  } finally {
    if (gen === ui.gen) ui.pumping = false;
  }
}

function applyUpdate(view, events) {
  const wasMyTurn = ui.view && ui.view.current === ui.me && ui.view.waitingKind === 'turn';
  const before = ui.screen === 'game' && ui.view ? FX.snapshot($app) : null;
  const oldView = ui.view;
  ui.view = view;
  for (const e of events) handleEvent(e);
  const key = view.pending ? JSON.stringify([view.pending.kind, view.pending.step, view.pending.card, view.pending.spec, view.pending.cards && view.pending.cards.length]) : '';
  if (key !== ui.selKey) { ui.selKey = key; ui.sel = {}; }
  if (!wasMyTurn && view.pending && view.pending.kind === 'turn') buzz();
  if (view.pending && ['guard', 'snapWindow', 'delegate'].includes(view.pending.kind)) buzz();
  // Hide cards that are about to fly in, so they land instead of popping up.
  if (before) planGhosts(events);
  render();
  if (before && events.length) {
    const after = FX.snapshot($app);
    animate(events, before, after, oldView);
  }
}

const GHOST_MS = 4000;
function ghostSlot(id, ms = GHOST_MS) { if (id) ui.ghost[id] = Date.now() + ms; }
function planGhosts(events) {
  for (const e of events) {
    if (e.type === 'discarded' && e.slotId) ghostSlot(e.slotId);
    if (e.type === 'filled' || e.type === 'gave' || e.type === 'replaced') ghostSlot(e.slotId);
    if (e.type === 'snap' && !e.ok) ghostSlot(e.newSlot);
    if (e.type === 'guardUsed' && !e.ok) ghostSlot(e.newSlot);
    if (e.type === 'swapped') { ghostSlot(e.a); ghostSlot(e.b); }
    if (e.type === 'activated') ghostSlot(e.slotId);
  }
}
function lightUp(ids, cls = 'land') {
  const now = Date.now();
  for (const id of ids) {
    if (!id) continue;
    delete ui.ghost[id];
    ui.lit[id] = now + 1800;
  }
  render();
  for (const id of ids) {
    const el = id && $app.querySelector(`[data-slot="${id}"]`);
    if (el) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 600); }
  }
  setTimeout(render, 1850);
}
function slotsOf(view, pid) { const p = view && view.players.find((x) => x.id === pid); return p ? p.slots.map((s) => s.id) : []; }

function announce(card, title, onMe = false, desc = null) {
  return FX.announce({ html: cardSVG(card), title, desc: desc ?? (CARD_DESC[card] || ''), hot: onMe });
}

function animate(events, B, A, oldView) {
  const hand = (pid) => A['hand:' + pid] || B['hand:' + pid];
  const handB = (pid) => B['hand:' + pid] || A['hand:' + pid];
  for (const e of events) {
    switch (e.type) {
      case 'roundStart': {
        FX.enqueue(async () => {
          const ids = [];
          let i = 0;
          for (const p of ui.view.players) for (const sid of slotsOf(ui.view, p.id)) { ids.push(sid); FX.fly(A.deck, A[sid], { dur: 380, delay: 45 * i++ }); }
          await FX.wait(380 + 45 * i);
          for (const id of ids) delete ui.ghost[id];
          render();
        });
        break;
      }
      case 'drewHidden': case 'took':
        break; // the card stays lifted over its pile until the player decides
      case 'discarded': {
        const src = e.from === 'discard' ? 'discard' : 'deck';
        const from = B.held || B[src];
        const mine = e.pid === ui.me;
        const keptFace = mine && oldView && oldView.pending && oldView.pending.name ? oldView.pending.name : (e.from === 'discard' && ui.heldPublic ? ui.heldPublic.card : null);
        FX.enqueue(async () => {
          if (e.slotId && e.from === 'discard' && keptFace) {
            // a floor card everyone saw: it grows, travels face-up, then turns over
            await Promise.all([
              FX.flyShow(from, A[e.slotId], keptFace),
              FX.fly(B[e.slotId] || A[e.slotId], A.discard, { flipTo: e.card, dur: 750, delay: 650 }),
            ]);
            lightUp([e.slotId]);
          } else if (e.slotId) {
            await Promise.all([
              FX.fly(from, A[e.slotId], keptFace ? { face: keptFace, flipTo: 'back', dur: 750 } : { dur: 750 }),
              FX.fly(B[e.slotId] || A[e.slotId], A.discard, { flipTo: e.card, dur: 750, delay: 60 }),
            ]);
            lightUp([e.slotId]);
          } else {
            await FX.fly(from, A.discard, { face: e.card, dur: 650 });
          }
          ui.heldPublic = null;
        });
        break;
      }
      case 'filled':
        FX.enqueue(async () => { await FX.fly(B.held || B.deck, A[e.slotId], { dur: 650 }); lightUp([e.slotId]); });
        break;
      case 'peeked':
        FX.enqueue(async () => {
          const r0 = A[e.slotId] || B[e.slotId];
          const to = hand(e.pid);
          const known = e.pid === ui.me && ui.reveals[e.slotId] ? ui.reveals[e.slotId].card : null;
          ghostSlot(e.slotId, 2500); render();
          if (e.pid === e.owner) {
            // looking at your own card: it lifts and turns toward you, then goes back
            await FX.fly(r0, { left: r0.left, top: r0.top - 40, width: r0.width, height: r0.height }, known ? { face: known, dur: 450 } : { dur: 450 });
            await FX.wait(known ? 700 : 300);
            await FX.fly({ left: r0.left, top: r0.top - 40, width: r0.width, height: r0.height }, r0, known ? { face: known, flipTo: 'back', dur: 400 } : { dur: 400 });
          } else {
            await FX.fly(r0, to, known ? { face: known, dur: 550 } : { dur: 550 });
            await FX.wait(known ? 700 : 250);
            await FX.fly(to, r0, known ? { face: known, flipTo: 'back', dur: 500 } : { dur: 500 });
          }
          lightUp([e.slotId]);
        });
        break;
      case 'markerOff':
        FX.enqueue(() => FX.fly(B[e.slotId] || A[e.slotId], A.discard, { face: e.card, dur: 600 }));
        break;
      case 'snap':
        FX.enqueue(async () => {
          if (e.ok) { await FX.fly(B[e.slotId], A.discard, { flipTo: e.card, dur: 560 }); }
          else {
            const el = $app.querySelector(`[data-slot="${e.slotId}"]`);
            if (el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 520); }
            await FX.wait(450);
            if (e.newSlot) await FX.flyShow(B.discard, A[e.newSlot], e.penalty);
            lightUp([e.newSlot, e.slotId]);
          }
        });
        break;
      case 'gave':
        FX.enqueue(async () => { if (e.card) await FX.flyShow(B.discard, A[e.slotId], e.card); else await FX.fly(B.discard, A[e.slotId], { dur: 620 }); lightUp([e.slotId]); });
        break;
      case 'swapped':
        FX.enqueue(async () => {
          await Promise.all([FX.fly(B[e.a], A[e.b], { dur: 700 }), FX.fly(B[e.b], A[e.a], { dur: 700 })]);
          lightUp([e.a, e.b]);
        });
        break;
      case 'replaced':
        FX.enqueue(async () => { await FX.fly(B.deck, A[e.slotId], { dur: 520 }); lightUp([e.slotId]); });
        break;
      case 'tornado':
        FX.enqueue(async () => {
          const ids = slotsOf(ui.view, e.pid);
          await Promise.all(ids.map((id, i) => FX.fly(B[id] || A[id], A.discard, { dur: 520, delay: i * 60 })));
          await Promise.all(ids.map((id, i) => FX.fly(A.deck, A[id], { dur: 520, delay: i * 60 })));
          lightUp(ids);
        });
        break;
      case 'shuffled':
        FX.enqueue(async () => {
          const ids = slotsOf(ui.view, e.pid);
          for (const id of ids) { const el = $app.querySelector(`[data-slot="${id}"]`); if (el) { el.classList.add('shuffling'); setTimeout(() => el.classList.remove('shuffling'), 720); } }
          await FX.wait(720);
          lightUp(ids, 'none');
        });
        break;
      case 'plus': case 'freeze':
        FX.enqueue(async () => { await FX.fly(B.discard, A[e.slotId], { face: e.card, dur: 650 }); lightUp([e.slotId]); });
        break;
      case 'cleared':
        if (e.what === 'card') FX.enqueue(() => FX.fly(B[e.slotId], A.discard, { flipTo: ui.view.discardTop, dur: 520 }));
        break;
      case 'activated':
        FX.enqueue(async () => {
          await Promise.all([FX.fly(B[e.slotId], A.discard, { face: e.card, dur: 560 }), FX.fly(B.discard, A[e.slotId], { face: 'choose', flipTo: 'back', dur: 560, delay: 150 })]);
          lightUp([e.slotId]);
        });
        break;
      case 'guardUsed':
        FX.enqueue(async () => {
          if (e.ok) { await FX.fly(B[e.guardSlot], A.discard, { face: 'guard', dur: 560 }); lightUp([e.slotId]); }
          else if (e.newSlot) { await FX.flyShow(B.discard, A[e.newSlot], e.penalty); lightUp([e.newSlot]); }
        });
        break;
      case 'reveal':
        for (const it of e.items) if (it.slotId) lightUp([it.slotId], 'none');
        break;
    }
  }
}

function handleEvent(e) {
  const n = (pid) => pname(pid);
  const now = Date.now();
  switch (e.type) {
    case 'roundStart': {
      ui.reveals = {}; ui.lastRoundEnd = null;
      const kind = e.tiebreak ? 'جولة فاصلة' : e.kind === 'double' ? 'السكور × ٢' : e.kind === 'blind' ? 'جولة عمياني' : '';
      banner(`الجولة ${e.round}${kind ? '<br><small style="font-size:.5em">' + kind + '</small>' : ''}`, 1400);
      break;
    }
    case 'reveal':
      for (const it of e.items) {
        if (it.deckTop) ui.peek = { card: it.card, until: now + e.dur };
        else ui.reveals[it.slotId] = { card: it.card, until: e.dur ? now + e.dur : Infinity, start: now };
      }
      if (e.dur) setTimeout(render, e.dur + 30);
      break;
    case 'go':
      for (const k of Object.keys(ui.reveals)) if (ui.reveals[k].until === Infinity) ui.reveals[k].until = now;
      banner('يلا!', 900);
      break;
    case 'ready': if (e.pid !== ui.me) log(`${n(e.pid)} جاهز`); break;
    case 'peeked': log(e.pid === e.owner ? `${n(e.pid)} بص على كارت من كروته` : `${n(e.pid)} بص على كارت عند ${n(e.owner)}`); break;
    case 'targeted': if (e.target !== e.by) log(`${n(e.by)} لعب ${cardName(e.card)} على ${n(e.target)}`); break;
    case 'discarded': if (!e.timeout) log(e.replaced ? `${n(e.pid)} بدّل ورمى ${cardName(e.card)}` : `${n(e.pid)} رمى ${cardName(e.card)}`); else log(`${n(e.pid)} خلص وقته`); break;
    case 'took': log(`${n(e.pid)} خد ${cardName(e.card)} من الأرض`); ui.heldPublic = { pid: e.pid, card: e.card }; break;
    case 'snap': log(e.ok ? `${n(e.pid)} بصّر ${cardName(e.card)} ✓` : e.penalty ? `${n(e.pid)} بصّر غلط (${cardName(e.card)}) ولبس ${cardName(e.penalty)}${e.under ? ' اللي كان تحت الأمر' : ''}` : `${n(e.pid)} بصّر غلط (${cardName(e.card)})`); break;
    case 'banana': banner('بانانا!', 1500); log(`${n(e.pid)} قال بانانا — كل واحد ليه دور أخير`); break;
    case 'effect': if (CARD_INFO[e.card].tier === 'cmd') log(`${n(e.pid)} شغّل ${cardName(e.card)}${e.viaCopy ? ' (Copy)' : ''}`); break;
    case 'gave': log(`${n(e.pid)} لبس ${cardName(e.card)}`); break;
    case 'swapped': log(`اتبدل كارت بين ${n(e.pa)} و${n(e.pb)}`); break;
    case 'shuffled': log(`كروت ${n(e.pid)} اتخلطت`); break;
    case 'tornado': log(`إعصار غيّر كروت ${n(e.pid)}`); break;
    case 'plus': log(`+5 على خانة عند ${n(e.owner)}`); break;
    case 'freeze': log(`خانة عند ${n(e.owner)} اتجمدت`); break;
    case 'unfreeze': log(`التجميد خلص عند ${n(e.owner)}`); break;
    case 'guardUsed': log(e.ok ? `${n(e.pid)} استخدم Guard وشال ${e.what === 'plus' ? '+5' : 'التجميد'}` : `${n(e.pid)} كشف كارت غلط ولبس ${cardName(e.penalty || 'n0')}`); break;
    case 'guarded':
      if (e.self) {
        log(e.ok ? `${n(e.pid)} رفض ${cardName(e.card)} بـ Guard` : `${n(e.pid)} كشف كارت غلط ولبس كارت — و${cardName(e.card)} هيتنفذ`);
      } else log(e.ok ? `${n(e.pid)} صدّ ${cardName(e.card)} بـ Guard!` : `${n(e.pid)} كشف كارت غلط ولبس كارت`);
      break;
    case 'skipped': log(`${n(e.pid)} فوّت دوره`); break;
    case 'willSkip': log(`${n(e.pid)} هيفوّت دوره الجاي`); break;
    case 'delegated': if (e.owner !== e.exec) log(`${n(e.exec)} هينفذ بدل ${n(e.owner)}`); break;
    case 'finished': log(`${n(e.pid)} خلّص كروته!`); break;
    case 'finalLap': log('آخر لفة!'); break;
    case 'reshuffle': log('الأرض اتخلطت وبقت كومة جديدة'); break;
    case 'activated': log(`${n(e.pid)} فعّل ${cardName(e.card)}`); break;
    case 'activateFailed': log(`${n(e.pid)} فعّل كارت مش أمر ولبس كارت`); break;
    case 'chose': log(`${n(e.pid)} اختار ${OPTION_AR[e.option][0]}`); break;
    case 'peekedDeck': if (e.pid !== ui.me) log(`${n(e.pid)} شاف أول كارت في الكومة`); break;
    case 'noEffect':
      if (e.taken) log(`${cardName(e.card)} اتاخد من الأرض — قوته راحت`);
      else if (e.card === 'guard') log('الـ Guard مالقاش +5 ولا تجميد يشيله');
      break;
    case 'cleared': log(e.card === 'guard' ? `${n(e.pid)} شال ${e.what === 'plus' ? '+5' : 'التجميد'} بالـ Guard` : `${n(e.pid)} استخدم Clear`); break;
    case 'roundEnd': ui.lastRoundEnd = e; break;
    case 'gameOver': ui.gameOver = e; break;
  }
}

// ------------------------------------------------------------ actions
function send(a) {
  if (!ui.conn) return;
  ui.conn.act(a);
}

function startBots() {
  const s = ui.setup;
  LS.set('setup', s);
  const n = s.mode === 'team' ? 4 : s.count;
  const botNames = pickBotNames(n - 1, LS.get('lastBots') || []);
  LS.set('lastBots', botNames);
  const players = [{ id: 'me', name: ui.name || 'أنا', av: myAvatar(), fr: myFrame() }];
  for (let i = 1; i < n; i++) players.push({ id: 'b' + i, name: botNames[i - 1], bot: s.level, av: 'bot' + (i - 1) });
  const host = new Host({ mode: s.mode, players, timed: s.timed, botDelay: /fast/.test(location.search) ? 40 : 900 });
  ui.me = 'me';
  ui.conn = { act: (a) => host.act('me', a), leave: () => host.destroy(), isHost: true, host, local: true };
  ui.screen = 'game';
  ui.view = null; ui.reveals = {}; ui.logs = []; ui.gameOver = null; ui.lastRoundEnd = null; resetUpdates();
  host.subscribe('me', onUpdate);
}

function leaveGame() {
  const c = ui.conn;
  ui.conn = null;
  if (c) c.leave(); resetUpdates(); ui.view = null; ui.screen = 'home'; ui.sheet = null; ui.lobby = null;
  render();
}

// ------------------------------------------------------------ rendering
function render() {
  if (ui.screen === 'home') return renderHome();
  if (ui.screen === 'bots') return renderBotSetup();
  if (ui.screen === 'online') return renderOnline();
  if (ui.screen === 'lobby') return renderLobby();
  if (ui.screen === 'rules') return renderRules();
  if (ui.screen === 'cards') return renderCards();
  if (ui.screen === 'game') return renderGame();
}

function seg(name, options, value) {
  return `<div class="seg" role="group">${options.map(([v, label]) => `<button data-seg="${name}" data-val="${esc(JSON.stringify(v))}" aria-pressed="${v === value}">${label}</button>`).join('')}</div>`;
}

const ICON = {
  book: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff8e1" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff8e1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  trophy: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff8e1" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/></svg>',
  menu: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff8e1" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4M8.6 13.3l6.8 4"/></svg>',
};
const BANANA_FACE = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 34 C 6 22, 12 10, 26 5 C 28 4, 30 6, 29 8 C 20 14, 18 24, 22 32 C 23 36, 12 38, 10 34 Z" fill="#ffd84d" stroke="#2a1608" stroke-width="2.5" stroke-linejoin="round"/><circle cx="17" cy="18" r="2" fill="#2a1608"/><circle cx="22" cy="17" r="2" fill="#2a1608"/><path d="M16 23 q4 3 7 -1" stroke="#2a1608" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
function leafSVG(cls, style) {
  return `<svg class="leaf ${cls}" style="${style}" width="260" height="190" viewBox="-10 -180 270 190" aria-hidden="true"><path d="M0 0 C 30 -70, 110 -150, 250 -170 C 200 -90, 110 -20, 0 0 Z" fill="#43a43b" stroke="#2a1608" stroke-width="5" stroke-linejoin="round"/><path d="M8 -6 C 80 -60, 160 -120, 240 -164" stroke="#2f7d2e" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M70 -40 l 30 -10 M120 -78 l 32 -6 M170 -112 l 30 -2" stroke="#2a1608" stroke-width="3" stroke-linecap="round"/></svg>`;
}
const LEAVES = leafSVG('', 'left:-70px;bottom:-30px;transform:rotate(-10deg)') + leafSVG('', 'right:-80px;bottom:60px;transform:scaleX(-1) rotate(-14deg)') + leafSVG('', 'left:-90px;top:-40px;transform:rotate(30deg) scale(.7)') + leafSVG('', 'right:-90px;top:-50px;transform:scaleX(-1) rotate(30deg) scale(.7)');

// The jungle picture, with the monkeys' heads and tails as separate layers
// so they can move. Placed exactly like the picture (cover, top-centred).
const LAYERS = [
  // id, monkey, x, y, w, h (in the 1024×1536 picture), pivot
  ['L_tail', 'L', 90, 304, 71, 132, '92% 80%'],
  ['L_head', 'L', 143, 187, 192, 143, '50% 98%'],
  ['R_tail', 'R', 910, 641, 83, 127, '2% 66%'],
  ['R_head', 'R', 744, 495, 191, 148, '53% 98%'],
];
const MONKEY_BODY = { L: [150, 300, 190, 190], R: [745, 620, 175, 180] };
const pct = (v, of) => `${(v / of * 100).toFixed(3)}%`;
function jungleStage(interactive) {
  const lay = LAYERS.map(([id, m, x, y, w, h, o]) => `<img class="lay ${id}" data-mk="${interactive ? m : ''}" src="cards/${id}.webp" alt="" draggable="false" style="left:${pct(x, 1024)};top:${pct(y, 1536)};width:${pct(w, 1024)};transform-origin:${o}">`).join('');
  const hits = interactive ? Object.entries(MONKEY_BODY).map(([m, [x, y, w, h]]) => `<i class="mk-hit" data-mk="${m}" style="left:${pct(x, 1024)};top:${pct(y, 1536)};width:${pct(w, 1024)};height:${pct(h, 1536)}"></i>`).join('') : '';
  return `<div class="stage" aria-hidden="true"><div class="stage-in"><img class="stage-bg" src="cards/bg-jungle-base.webp" alt="" draggable="false">${hits}${lay}</div></div>`;
}

function screen(inner, { photo = false, cls = '' } = {}) {
  if (photo) return `<div class="screen photo ${cls}">${jungleStage(cls === 'home')}<div class="screen-in">${inner}</div></div>`;
  return `<div class="screen jungle">${LEAVES}<div class="screen-in">${inner}</div></div>`;
}
const backBtn = (to) => `<button class="round" data-go="${to}" aria-label="رجوع" style="align-self:flex-start">${ICON.back}</button>`;

function avatarSheet() {
  const cur = myAvatar();
  return `<div class="sheet-bg" data-close="1"><div class="sheet"><h2>اختار صورتك</h2>
    <div class="av-grid">${AVATAR_IDS.concat(ownedAvatars().map((g) => g.id)).map((id) => `<button class="avatar av-opt ${id === cur ? 'on' : ''}" data-av="${id}" aria-label="صورة">${avatarInner(id)}</button>`).join('')}</div>
    ${ownedFrames().length ? `<h2 style="margin-top:14px">الإطار</h2><div class="av-grid">
      <button class="avatar av-opt ${!myFrame() ? 'on' : ''}" data-fr="" aria-label="من غير إطار">${avatarInner(cur)}</button>
      ${ownedFrames().map((g) => `<button class="avatar av-opt framed ${myFrame() === g.id ? 'on' : ''}" data-fr="${g.id}" aria-label="إطار">${avatarInner(cur)}${frameHTML(g.id)}</button>`).join('')}</div>` : ''}
    <button class="plank cream" data-close="1" style="width:100%;margin-top:12px">رجوع</button></div></div>`;
}

function renderHome() {
  $app.innerHTML = screen(`
    <div class="spacer top"></div>
    <img class="logo" data-mk="logo" src="cards/logo.webp" alt="بانانا" draggable="false">
    <div class="spacer"></div>
    <div class="me-row"><button class="avatar pick-av ${myFrame() ? 'framed' : ''}" data-sheet="avatar" aria-label="غيّر صورتك">${avatarInner(myAvatar())}${frameHTML(myFrame())}<i class="pen">✎</i></button>
    <div class="field" style="flex:1"><span class="ribbon">اسمك في اللعبة</span><input id="nm" maxlength="14" value="${esc(ui.name)}" placeholder="مثلاً: محمد" aria-label="اسمك"></div></div>${ui.sheet === 'avatar' ? avatarSheet() : ui.sheet === 'gift' ? giftSheet() : ui.sheet === 'owner' ? ownerSheet() : ''}
    <button class="plank wood" data-go="online" style="transform:rotate(-1deg);min-height:72px;font-size:1.8rem">العب مع صحابك</button>
    <button class="plank teal" data-go="bots" style="transform:rotate(1deg);min-height:64px">العب ضد الروبوتات</button>
    <button class="plank cream ${LS.get('learned') ? '' : 'pulse'}" data-go="rules" style="min-height:58px">${LS.get('learned') ? 'ازاي ألعب؟' : 'أول مرة؟ اتعلم تلعب 🍌'}</button>
    <div class="ver">آخر تحديث: ${APP_DATE}</div>`, { photo: true, cls: 'home' });
}

function renderBotSetup() {
  const s = ui.setup;
  $app.innerHTML = screen(`
    ${backBtn('home')}
    <img class="wordmark" src="cards/wordmark.webp" alt="BANANA">
    <div class="board" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><span class="ribbon">المود</span>${seg('mode', [['solo', 'فردي'], ['team', 'زوجي ٢ ضد ٢']], s.mode)}</div>
      ${s.mode === 'solo' ? `<div class="field"><span class="ribbon">عدد اللاعبين</span>${seg('count', [[3, '٣ لاعبين'], [4, '٤ لاعبين']], s.count)}</div>` : '<p class="hint">إنت وروبوت شريكك، ضد روبوتين.</p>'}
      <div class="field"><span class="ribbon">مستوى الروبوتات</span>${seg('level', [['easy', 'سهل'], ['medium', 'متوسط'], ['hard', 'صعب']], s.level)}</div>
      <div class="field"><span class="ribbon">الوقت</span>${seg('timed', [[true, '١٥ ثانية للدور'], [false, 'مفتوح']], s.timed)}</div>
    </div>
    <button class="plank gold" data-act-ui="start-bots" style="min-height:72px;font-size:1.9rem">ابدأ</button>`);
}

function renderRules() {
  const i = Math.min(ui.learnPage || 0, LEARN.length - 1);
  $app.innerHTML = screen(`
    <div style="display:flex;justify-content:space-between;align-items:center;width:100%">${backBtn('home')}<button class="mini-btn" data-go="cards">كل الكروت</button></div>
    ${learnHTML(i)}`, { photo: true });
  LS.set('learned', 1);
}

function renderCards() {
  const names = Object.keys(CARD_INFO);
  $app.innerHTML = screen(`
    ${backBtn('rules')}
    <div class="glossary big">${names.map((n) => `<div class="gl">${cardSVG(n)}<p>${CARD_DESC[n] || ({ minus: 'سالب ١ — أحلى كارت' }[n] || 'رقم عادي')}</p></div>`).join('')}</div>`, { photo: true });
}

function renderOnline() {
  if (isLocalOnly() && !/localnet/.test(location.search)) {
    $app.innerHTML = screen(`${backBtn('home')}<div class="board"><p style="margin:0">اللعب أونلاين هيشتغل أول ما نربط السيرفر. جرّب ضد الروبوتات.</p></div><button class="plank teal" data-go="bots">العب ضد الروبوتات</button>`);
    return;
  }
  $app.innerHTML = screen(`
    ${backBtn('home')}
    <img class="wordmark" src="cards/wordmark.webp" alt="BANANA">
    <button class="plank wood" data-act-ui="create-room" style="min-height:70px;font-size:1.8rem">اعمل أوضة</button>
    <div class="board" style="display:flex;flex-direction:column;gap:10px">
      <div class="field"><span class="ribbon">أو ادخل بكود أوضة</span><input id="code" inputmode="numeric" maxlength="6" placeholder="مثلاً 4821" aria-label="كود الأوضة"></div>
      <button class="plank teal" data-act-ui="join-room">ادخل</button>
    </div>
    ${ui.error ? `<p class="err">${esc(ui.error)}</p>` : ''}`);
}

function myAvatar() {
  if (ui.avSel && ownedAvatars().some((g) => g.id === ui.avSel)) return ui.avSel;
  const a = LS.get('avatar'); return isPlayerAvatar(a) ? a : 'p1';
}
function myFrame() { return ui.frame && ownedFrames().some((g) => g.id === ui.frame) ? ui.frame : null; }

function avatarHTML(pid, opts = {}, av = null, fr = null) {
  const cls = ['avatar'];
  if (fr) cls.push('framed');
  if (opts.active) cls.push('active');
  if (opts.small) cls.push('small');
  return `<div class="${cls.join(' ')}">${(av && avatarInner(av)) || BANANA_FACE}${frameHTML(fr)}${opts.ring ? `<i class="ring" id="ring-${pid}"></i>` : ''}</div>`;
}

function renderLobby() {
  const L = ui.lobby;
  if (!L) return;
  const s = L.settings;
  const isHost = L.isHost;
  const max = s.mode === 'team' ? 4 : s.count;
  const list = [];
  for (let i = 0; i < max; i++) {
    const p = L.seats[i];
    const team = s.mode === 'team' ? (i % 2 === 0 ? 'فريق أ' : 'فريق ب') : '';
    if (!p) {
      list.push(`<div class="seat-row empty"><div class="avatar" style="opacity:.4"></div><span class="nm">مكان فاضي</span>${team ? `<span class="ribbon">${team}</span>` : ''}${isHost ? `<button class="mini-btn" data-lobby="bot" data-i="${i}">+ روبوت</button>` : ''}</div>`);
    } else {
      list.push(`<div class="seat-row">${avatarHTML('l' + i, {}, p.av, p.fr)}<span class="nm">${esc(p.name)}</span>${p.host ? '<span class="ribbon gold">صاحب الأوضة</span>' : ''}${team ? `<span class="ribbon">${team}</span>` : ''}${isHost && p.bot ? `<button class="mini-btn" style="background:var(--pink)" data-lobby="kick" data-i="${i}">شيل</button>` : ''}</div>`);
    }
  }
  const full = L.seats.slice(0, max).filter(Boolean).length === max;
  $app.innerHTML = screen(`
    <button class="round" data-lobby="leave" aria-label="اخرج من الأوضة" style="align-self:flex-start">${ICON.back}</button>
    <div class="plank wood" style="flex-direction:column;gap:6px;padding:16px">
      <span style="font-size:1.3rem">كود الأوضة</span>
      <div class="code-big">${esc(L.code)}</div>
      <button class="mini-btn" data-lobby="share" style="display:flex;gap:6px;align-items:center;font-family:var(--body);text-shadow:none">${ICON.share} ابعته لصحابك</button>
    </div>
    ${isHost ? `<div class="board" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><span class="ribbon">المود</span>${seg('lmode', [['solo', 'فردي'], ['team', 'زوجي']], s.mode)}</div>
      ${s.mode === 'solo' ? `<div class="field"><span class="ribbon">عدد اللاعبين</span>${seg('lcount', [[3, '٣'], [4, '٤']], s.count)}</div>` : ''}
      <div class="field"><span class="ribbon">الوقت</span>${seg('ltimed', [[true, '١٥ ثانية'], [false, 'مفتوح']], s.timed)}</div>
      <div class="field"><span class="ribbon">مستوى الروبوتات</span>${seg('llevel', [['easy', 'سهل'], ['medium', 'متوسط'], ['hard', 'صعب']], s.level)}</div>
    </div>` : `<p class="board hint" style="margin:0">${s.mode === 'team' ? 'زوجي' : 'فردي'} — ${s.timed ? '١٥ ثانية للدور' : 'وقت مفتوح'}. مستنيين صاحب الأوضة يبدأ.</p>`}
    <div style="display:flex;flex-direction:column;gap:10px">${list.join('')}</div>
    ${isHost ? `<button class="plank gold" data-lobby="start" ${full ? '' : 'disabled'} style="min-height:72px;font-size:1.8rem">ابدأ اللعب</button>` : ''}
    ${ui.error ? `<p class="err">${esc(ui.error)}</p>` : ''}`);
}

// ---------- game table
function slotHTML(s, owner, opts = {}) {
  const now = Date.now();
  const rv = ui.reveals[s.id];
  const showing = rv && rv.until > now;
  const cls = ['slot'];
  if (!s.has) cls.push('empty');
  if (s.frozen || s.locked) cls.push('frozen');
  if (showing && now - rv.start < 350) cls.push('revealed');
  if (showing) cls.push('known');
  if (opts.pickable) cls.push('pickable');
  if (opts.picked) cls.push('picked');
  if (ui.lit[s.id] > now) cls.push('lit');
  if (ui.ghost[s.id] > now) cls.push('ghost');
  const face = s.has ? (showing ? cardSVG(rv.card) : backSVG()) : '';
  return `<div class="${cls.join(' ')}" data-slot="${s.id}" data-owner="${owner}" ${opts.pickable ? 'role="button" tabindex="0"' : ''}>
    ${face}
    ${(s.markers || []).map((m, i) => `<span class="mk" style="--i:${i}">${cardSVG(m)}</span>`).join('')}
    ${s.freezeCard ? `<span class="mk fz">${cardSVG(s.freezeCard)}<b>${s.frozen}</b></span>` : ''}
    ${s.locked ? '<span class="badge freeze-b">مقفول</span>' : ''}
    ${opts.pos ? `<span class="pos">${opts.pos}</span>` : ''}
  </div>`;
}

function pickableSlots() {
  if (ui.gated) return new Set();
  const v = ui.view, p = v.pending, sel = ui.sel;
  const set = new Set();
  if (!p) return set;
  const mine = meP().slots;
  const add = (ids) => ids.forEach((i) => set.add(i));
  if (sel.mode === 'snap' || sel.mode === 'guard' || sel.mode === 'gr2' || sel.mode === 'selfg') add(mine.filter((s) => s.has && !s.frozen && !s.locked).map((s) => s.id));
  else if (p.kind === 'hold' || (p.kind === 'extra' && sel.extraIdx != null)) add(mine.filter((s) => !s.frozen && !s.locked).map((s) => s.id));
  else if (p.kind === 'target') {
    const sp = p.spec;
    if (sp.type === 'ownSlot' || sp.type === 'slot') add(sp.options);
    if (sp.type === 'swap') add(sel.mine ? sp.theirs : sp.mine);
    if (sp.type === 'observe') for (const ids of Object.values(sp.groups)) add(ids);
    if (sp.type === 'multiSlot') add(sp.options);
    if (sp.type === 'clear') add(sp.options.filter((o) => o.what === 'card').map((o) => o.slotId));
  }
  return set;
}
function pickedSlots() {
  const s = new Set();
  if (ui.sel.mine) s.add(ui.sel.mine);
  if (ui.sel.picks) Object.values(ui.sel.picks).forEach((x) => s.add(x));
  if (ui.sel.multi) ui.sel.multi.forEach((x) => s.add(x));
  return s;
}
function pickablePlayers() {
  const p = ui.view.pending;
  if (p && p.kind === 'target' && p.spec.type === 'player') return new Set(p.spec.options);
  return new Set();
}

function statusText() {
  const v = ui.view, p = v.pending;
  if (!p) {
    const w = v.waitingOn[0];
    if (!w) return '';
    const who = `<b>${esc(pname(w))}</b>`;
    switch (v.waitingKind) {
      case 'turn': return `دور ${who}`;
      case 'guard': return `${who} بيقرر يستخدم Guard ولا لأ`;
      case 'snapWindow': return `${who} ممكن يبصّر دلوقتي`;
      case 'delegate': return 'الفريق بيختار مين ينفذ';
      case 'target': return `${who} بيختار…`;
      case 'roundOver': return 'مستنيين الجولة الجاية';
      case 'ready': return `مستنيين: ${v.waitingOn.map((q) => esc(pname(q))).join('، ')}`;
      default: return `${who} بيلعب…`;
    }
  }
  const sel = ui.sel;
  if (sel.mode === 'snap') return 'اضغط على الكارت اللي هتبصّره';
  if (sel.mode === 'guard') return 'اضغط على كارت الـ Guard بتاعك';
  if (sel.mode === 'selfg') return 'اضغط على كارت الـ Guard بتاعك عشان تلغي الأمر — لو طلع غلط هتاخد كارت والأمر هيتنفذ';
  if (sel.mode === 'gr2') return 'اضغط على كارت الـ Guard بتاعك — لو طلع غلط هتلبس آخر كارت على الأرض';
  switch (p.kind) {
    case 'ready': return p.answered ? `مستنيين: ${v.waitingOn.map((q) => esc(pname(q))).join('، ')}` : '<b>بُص على أول كارتين عندك واحفظهم!</b><br>اللعب هيبدأ لما الكل يدوس جاهز';
    case 'turn': return '<b>دورك!</b> اسحب، أو خد من الأرض، أو بصّر';
    case 'hold': return p.from === 'deck' ? 'بدّله بكارت من كروتك، أو ارميه' : 'اختار الكارت اللي هتبدّله';
    case 'extra': return sel.extraIdx == null ? 'Extra: اختار كارت من الاتنين' : 'اضغط على كارت تبدّله، أو ارمي';
    case 'snapWindow': return `شريكك رمى <b>${cardName(p.top)}</b> — تبصّر عليه؟`;
    case 'target': {
      if (p.step === 'tornadoPick') return `الكومة فيها ${p.spec.n} بس — اختار ${p.spec.n} كروت تتغيّر`;
      if (p.spec.type === 'swap' && sel.mine) return 'دلوقتي اختار كارت عند لاعب تاني';
      return PROMPT[p.step] || 'اختار';
    }
    default: return '';
  }
}

// Seat positions around the table: me at the bottom, then in turn order.
function seatLayout(n) {
  if (n === 3) return ['bottom', 'right', 'left'];
  return ['bottom', 'right', 'top', 'left'];
}

function seatHTML(o, pos, pick, picked, pplayers) {
  const v = ui.view, me = meP();
  const tags = [];
  if (v.banana === o.id) tags.push('<span class="ribbon gold">بانانا</span>');
  if (o.finished) tags.push('<span class="ribbon sky">خلّص</span>');
  if (o.skipNext) tags.push('<span class="ribbon pink">هيفوّت</span>');
  const partner = v.mode === 'team' && o.team === me.team && o.id !== ui.me;
  if (partner) tags.push('<span class="ribbon sky">شريكك</span>');
  const waiting = v.waitingOn.includes(o.id);
  const cls = ['seat', pos];
  if (partner) cls.push('partner');
  if (pplayers.has(o.id)) cls.push('pickable');
  if (o.slots.length > 5) cls.push('many');
  const isMe = o.id === ui.me;
  const slots = o.slots.map((s, i) => slotHTML(s, o.id, { pickable: pick.has(s.id), picked: picked.has(s.id), pos: isMe ? i + 1 : 0 })).join('');
  const name = isMe ? 'إنت' : esc(o.name);
  return `<div class="${cls.join(' ')}" data-player="${o.id}">
    <div class="who">${avatarHTML(o.id, { active: v.current === o.id, ring: waiting && v.deadline, small: isMe }, o.av, o.fr)}<span class="nmr wood ${v.current === o.id ? 'turn' : ''}"><span class="pn">${name}</span><span class="ps">${o.total}</span></span>${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}</div>
    <div class="hand" data-hand="${o.id}">${slots || '<span class="ribbon">مفيش كروت</span>'}</div>
  </div>`;
}

const TABLES = [['wood', 'خشب'], ['purple', 'بنفسجي'], ['blue', 'أزرق'], ['black', 'أسود'], ['green', 'أخضر'], ['teal', 'تركواز'], ['palestine', 'فلسطين']];
function myTable() {
  if (ui.tableSel && ownedTables().some((g) => g.id === ui.tableSel)) return ui.tableSel;
  const t = LS.get('table'); return TABLES.some((x) => x[0] === t) ? t : 'wood';
}
const tableSrc = (id) => (giftById(id) ? giftById(id).src : `cards/table-${id}.webp`);
function tableSheet() {
  const cur = myTable();
  return `<div class="sheet-bg" data-close="1"><div class="sheet"><h2>لون الترابيزة</h2><p>اختار اللون اللي يريحك — تقدر تغيّره في أي وقت.</p>
    <div class="tb-grid">${TABLES.concat(ownedTables().map((g) => [g.id, 'هدية 🎁'])).map(([id, nm]) => `<button class="tb-opt ${id === cur ? 'on' : ''}" data-tb="${id}"><span style="background-image:url('${tableSrc(id)}')"></span><b>${nm}</b></button>`).join('')}</div>
    <button class="plank cream" data-close="1" style="width:100%;margin-top:12px">رجوع</button></div></div>`;
}
const PROPS = `<svg class="prop" style="left:22%;top:63%;transform:rotate(-14deg)" width="96" height="62" viewBox="0 0 110 70" aria-hidden="true"><path d="M8 40 C 20 62, 70 66, 100 34 C 104 30, 100 26, 96 28 C 70 48, 36 48, 16 32 C 10 28, 4 34, 8 40 Z" fill="#ffd84d" stroke="#2a1608" stroke-width="4" stroke-linejoin="round"/><path d="M14 22 C 26 44, 72 46, 98 16 C 102 12, 98 8, 94 10 C 70 30, 38 30, 20 14 C 14 10, 10 16, 14 22 Z" fill="#ffe680" stroke="#2a1608" stroke-width="4" stroke-linejoin="round"/><path d="M94 10 l8 -6 M96 28 l8 -4" stroke="#6d4c1d" stroke-width="5" stroke-linecap="round"/></svg>
<svg class="prop" style="right:16%;top:9%;transform:rotate(10deg)" width="58" height="58" viewBox="0 0 74 74" aria-hidden="true"><circle cx="12" cy="34" r="10" fill="#a0612d" stroke="#2a1608" stroke-width="4"/><circle cx="62" cy="34" r="10" fill="#a0612d" stroke="#2a1608" stroke-width="4"/><circle cx="37" cy="36" r="27" fill="#a0612d" stroke="#2a1608" stroke-width="4"/><path d="M18 40 C 18 26, 30 22, 37 30 C 44 22, 56 26, 56 40 C 56 54, 46 60, 37 60 C 28 60, 18 54, 18 40 Z" fill="#f2c59a" stroke="#2a1608" stroke-width="3"/><circle cx="30" cy="36" r="3.4" fill="#2a1608"/><circle cx="44" cy="36" r="3.4" fill="#2a1608"/><path d="M30 48 q7 6 14 0" stroke="#2a1608" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;

function renderGame() {
  const v = ui.view;
  if (!v) { $app.innerHTML = '<div class="game"><p class="status" style="margin:40vh auto 0">بنوزّع الكروت…</p></div>'; return; }
  const n = v.players.length;
  const myIdx = v.players.findIndex((p) => p.id === ui.me);
  const layout = seatLayout(n);
  const pick = pickableSlots(), picked = pickedSlots(), pplayers = pickablePlayers();
  const p = v.pending;
  const seats = [];
  for (let d = 0; d < n; d++) seats.push(seatHTML(v.players[(myIdx + d) % n], layout[d], pick, picked, pplayers));

  const top = v.discardTop;
  const canTake = p && p.kind === 'turn' && top && CARD_INFO[top].tier !== 'cmd';
  const canDraw = p && p.kind === 'turn';
  const typeChip = v.tiebreak ? 'فاصلة' : v.roundType === 'double' ? '×2' : v.roundType === 'blind' ? 'عمياني' : '';
  const deck = v.deckCount ? `<span class="stack">${backSVG()}</span><span class="stack">${backSVG()}</span><span class="stack">${backSVG()}</span>` : '';
  let heldDeck = '', heldFloor = '';
  if (v.holding && !(v.holding.pid === ui.me && p && p.kind === 'extra')) {
    const mine = v.holding.pid === ui.me;
    const fromFloor = v.holding.from === 'discard';
    const face = mine && p && p.kind === 'hold' ? p.name : fromFloor && ui.heldPublic ? ui.heldPublic.card : null;
    const el = `<div class="held ${mine ? 'mine' : ''}" data-pile="held">${face ? cardSVG(face) : backSVG()}${v.holding.n > 1 ? `<span class="ribbon">×${v.holding.n}</span>` : ''}</div>`;
    if (fromFloor) heldFloor = el; else heldDeck = el;
  }

  $app.innerHTML = `<div class="game" style="background-image:url('${tableSrc(myTable())}')${myTable() === 'palestine' || giftById(myTable()) ? ';background-position:center' : ''}">
  <div class="topbar">
    <span class="round-chip wood">الجولة ${v.round}/5${typeChip ? `<small>${typeChip}</small>` : ''}</span>
    <span class="row">
      <button class="round" data-sheet="scores" aria-label="السكور">${ICON.trophy}</button>
      <button class="round" data-sheet="menu" aria-label="القائمة">${ICON.menu}</button>
    </span>
  </div>
  <div class="table-area">
    ${seats.join('')}
    <div class="center">
      <div class="piles">
        <div class="pile ${canDraw ? 'pickable' : ''}" data-pile="deck" ${canDraw ? 'role="button" tabindex="0" aria-label="اسحب"' : ''}>${deck}${heldDeck}<span class="ribbon lbl">الكومة ${v.deckCount}</span></div>
        <div class="pile ${top ? '' : 'none'} ${canTake ? 'pickable' : ''}" data-pile="discard" ${canTake ? 'role="button" tabindex="0" aria-label="خد من الأرض"' : ''}>${top ? cardSVG(top) : ''}${heldFloor}<span class="ribbon lbl">الأرض</span></div>
      </div>
      <div class="status" aria-live="polite">${statusText() || '&nbsp;'}</div>
      <div class="log">${ui.logs.map((l) => `<div data-log="${l.id}">${esc(l.text)}</div>`).join('')}</div>
    </div>
  </div>
  ${v.deadline && v.timed && v.waitingOn.includes(ui.me) ? '<div class="timer-line" id="timer"><i></i></div>' : ''}
  <div class="actions">${actionsHTML()}</div>
  ${ui.peek && ui.peek.until > Date.now() ? `<div class="peek-toast">${cardSVG(ui.peek.card)}</div>` : ''}
  ${ui.banner ? `<div class="banner"><span class="ink-text">${ui.banner}</span></div>` : ''}
  ${boardOrSheet()}
  </div>`;
  startTimerBar();
}

function actionsHTML() {
  if (ui.gated) return '';
  const v = ui.view, p = v.pending, sel = ui.sel, me = meP();
  if (!p) return '';
  const snapBtn = (label = 'بصّر') => `<button class="plank teal ${sel.mode === 'snap' ? 'on' : ''}" data-ui="snap-mode" ${v.discardTop ? '' : 'disabled'}>${label}</button>`;
  switch (p.kind) {
    case 'ready':
      return p.answered ? '' : '<button class="plank gold banana-btn" data-a="ready">حفظتهم — جاهز</button>';
    case 'turn': {
      const canBanana = v.mode === 'solo' && !v.banana && me.turnsPlayed >= 3;
      const top = v.discardTop;
      return `<button class="plank wood" data-a="draw">اسحب</button>
        <button class="plank wood" data-a="take" ${top && CARD_INFO[top].tier !== 'cmd' ? '' : 'disabled'}>خد من الأرض</button>
        ${snapBtn()}
        ${me.slots.some((x) => x.plus > 0 || x.frozen) ? `<button class="plank" style="background:var(--pink);color:#fff" data-ui="gr1">Guard</button>` : ''}
        ${v.mode === 'solo' ? `<button class="plank gold banana-btn" data-a="banana" ${canBanana ? '' : 'disabled'}>${canBanana ? 'بانانا!' : `بانانا بعد ${3 - me.turnsPlayed} أدوار`}</button>` : ''}`;
    }
    case 'hold':
      return p.from === 'deck' ? `<button class="plank wood" data-a="throw">ارمي${effectNote(p.name)}</button>${CARD_INFO[p.name].tier === 'cmd' && p.name !== 'guard' ? `<button class="plank" style="background:var(--pink);color:#fff" data-ui="selfg">${sel.mode === 'selfg' ? 'إلغاء' : 'ارفضه بالـ Guard'}</button>` : ''}` : '';
    case 'extra':
      return `${sel.extraIdx != null ? `<button class="plank wood" data-ui="extra-throw">ارمي${effectNote(p.cards[sel.extraIdx].name)}</button>` : ''}
        ${p.snapsLeft > 0 ? snapBtn() : ''}`;
    case 'snapWindow':
      return `<button class="plank cream" data-a="pass">مش هبصّر</button>${snapBtn('بصّر')}`;
    case 'target': {
      const sp = p.spec;
      if (sp.type === 'player') return sp.options.map((id) => `<button class="plank wood" data-target="${id}">${esc(pname(id))}</button>`).join('');
      if (sp.type === 'observe') {
        const done = Object.keys(sp.groups).every((pid) => sel.picks && sel.picks[pid]);
        return `<button class="plank gold" data-ui="observe-ok" ${done ? '' : 'disabled'}>تمام، وريني</button>`;
      }
      if (sp.type === 'multiSlot') return `<button class="plank gold" data-ui="multi-ok" ${(sel.multi || []).length === sp.n ? '' : 'disabled'}>تمام</button>`;
      if (sp.type === 'swap' && sel.mine) return '<button class="plank cream" data-ui="unpick">غيّر اختيارك</button>';
      return '';
    }
    default: return '';
  }
}
function effectNote(name) {
  if (CARD_INFO[name].tier === 'cmd' || NUM_EFFECT[name]) return ' وشغّله';
  return '';
}

function boardOrSheet() {
  if (ui.gated && !['menu', 'scores', 'rules-mini', 'learn', 'table'].includes(ui.sheet)) return '';
  const h = sheetHTML();
  if (!h.includes('woodboard')) ui.boardShown = null;
  return h;
}

function sheetHTML() {
  const v = ui.view, p = v.pending;
  if (ui.sheet === 'scores') return scoresSheet();
  if (ui.sheet === 'menu') {
    return `<div class="sheet-bg" data-close="1"><div class="sheet">
      <h2>القائمة</h2>
      ${ui.conn && ui.conn.room ? `<div class="room-code"><span>كود الأوضة</span><b>${esc(ui.conn.room)}</b><button class="plank teal" data-ui="share-code">ابعته</button><small>لو حد خرج، يدخل "العب مع صحابك" ويكتب الكود ده ويرجع مكانه</small></div>` : ''}
      <div class="opts">
        <button class="opt" data-sheet="learn"><b>ازاي ألعب؟</b><span>شرح بسيط للعبة خطوة بخطوة</span></button>
        <button class="opt" data-sheet="table"><b>لون الترابيزة</b><span>خشب، بنفسجي، أزرق، أسود…</span></button>
        <button class="opt" data-sheet="rules-mini"><b>الكروت</b><span>شوف كل كارت بيعمل إيه</span></button>
        <button class="opt" data-ui="leave"><b>اخرج من الجيم</b><span>${ui.conn && ui.conn.local ? 'الجيم هيتقفل' : ui.conn && ui.conn.isHost ? 'إنت صاحب الأوضة — لو خرجت الجيم هيتقفل للكل' : 'روبوت هيلعب مكانك لحد ما ترجع بالكود'}</span></button>
        <button class="plank cream" data-close="1">رجوع</button>
      </div></div></div>`;
  }
  if (ui.sheet === 'learn') {
    return `<div class="sheet-bg" data-close="1"><div class="sheet">${learnHTML(Math.min(ui.learnPage || 0, LEARN.length - 1), { inGame: true })}</div></div>`;
  }
  if (ui.sheet === 'table') return tableSheet();
  if (ui.sheet === 'rules-mini') {
    return `<div class="sheet-bg" data-close="1"><div class="sheet"><h2>الكروت</h2><div class="glossary">${Object.keys(CARD_INFO).map((n) => `<div>${cardSVG(n)}</div>`).join('')}</div><button class="plank cream" data-close="1" style="width:100%;margin-top:10px">رجوع</button></div></div>`;
  }
  if (ui.gameOver || ((v.over || (p && p.kind === 'gameOver')) && !updQ.length)) return gameOverSheet();
  if (ui.lastRoundEnd && (v.waitingKind === 'roundOver')) return roundSheet();
  if (!p) return '';
  if (ui.sel.mode === 'gr1' && p.kind === 'turn') {
    const me = meP();
    const pos = (sid) => me.slots.findIndex((x) => x.id === sid) + 1;
    const opts = [];
    for (const x of me.slots) {
      if (x.plus > 0) opts.push(`<button class="opt" data-gr="${x.id}|plus"><b>شيل +5 من الخانة ${pos(x.id)}</b></button>`);
      if (x.frozen) opts.push(`<button class="opt" data-gr="${x.id}|freeze"><b>فك التجميد من الخانة ${pos(x.id)}</b></button>`);
    }
    return `<div class="sheet-bg"><div class="sheet"><h2>استخدم Guard</h2><p>ده هيبقى دورك كله. بعدها هتضغط على كارت الـ Guard بتاعك، ولو طلع مش Guard هتلبس آخر كارت على الأرض.</p><div class="opts">${opts.join('')}<button class="plank cream" data-ui="gr1">رجوع</button></div></div></div>`;
  }
  if (p.kind === 'hold') return '';
  if (p.kind === 'extra') {
    return `<div class="hold-show">${p.cards.map((c, i) => `<div class="float-card small ${ui.sel.extraIdx === i ? 'sel' : ''}" data-extra="${i}" role="button" tabindex="0">${cardSVG(c.name)}</div>`).join('')}</div>`;
  }
  if (p.kind === 'guard' && ui.sel.mode !== 'guard') {
    // Same box as the announcement, with the Guard question under it.
    const name = p.option ? `${OPTION_AR[p.option][0]} من Choose` : cardName(p.card);
    const desc = p.option ? CHOSE_AR[p.option][1] : (CARD_DESC[p.card] || '');
    return `<div class="sheet-bg guardbox-bg"><div class="announce hot guardbox">
      <div class="a-card">${cardSVG(p.card)}</div>
      <div class="a-title">${esc(pname(p.by))} هينفذ ${name}${p.viaCopy ? ' بـ Copy' : ''} عليك!</div>
      <div class="a-desc">${esc(desc)}</div>
      <div class="gb-q">معاك <b>Guard</b> توقفه؟ <small>لو كشفت كارت غلط هتلبس كارت والأمر هيتنفذ</small></div>
      <div class="gb-row"><button class="plank cream" data-a="noGuard">لا — كمّل</button><button class="plank" style="background:var(--pink);color:#fff" data-ui="guard-mode">آه، أوقفه</button></div>
    </div></div>`;
  }
  if (p.kind === 'delegate') {
    if (p.answered) return '';
    const mate = v.players.find((x) => x.id !== ui.me && x.team === meP().team);
    const owner = p.owner === ui.me;
    return `<div class="sheet-bg"><div class="sheet">
      <h2>${cardName(p.card)}: مين ينفذ؟</h2>
      <p>${owner ? 'إنت رميت الكارت.' : `${esc(pname(p.owner))} رمى الكارت.`} اللي ينفذ بينفذه على كروته هو. لو اختلفتوا، صاحب الكارت هو اللي ينفذ.</p>
      <div class="float-wrap"><div class="float-card small">${cardSVG(p.card)}</div></div>
      <div class="row"><button class="plank gold" data-delegate="${ui.me}">أنا</button><button class="plank cream" data-delegate="${mate.id}">${esc(mate.name)}</button></div>
    </div></div>`;
  }
  if (p.kind === 'target' && p.spec.type === 'option') {
    return `<div class="sheet-bg"><div class="sheet"><h2>Choose: اختار أمر</h2><div class="opts">
      ${p.spec.options.map((o) => `<button class="opt" data-option="${o}"><b>${OPTION_AR[o][0]}</b><span>${OPTION_AR[o][1]}</span></button>`).join('')}
    </div></div></div>`;
  }
  if (p.kind === 'target' && p.spec.type === 'clear') {
    const me = meP();
    const pos = (sid) => me.slots.findIndex((s) => s.id === sid) + 1;
    const label = { card: (o) => `ارمي الكارت رقم ${pos(o.slotId)}`, plus: (o) => `شيل +5 من الخانة ${pos(o.slotId)}`, freeze: (o) => `فك التجميد من الخانة ${pos(o.slotId)}` };
    const isGuard = p.step === 'guardFix';
    return `<div class="sheet-bg"><div class="sheet"><h2>${isGuard ? 'Guard' : 'Clear'}</h2><p>${isGuard ? 'اختار تشيل +5 أو التجميد من واحدة من خاناتك.' : 'ارمي أي كارت من كروتك، أو شيل +5 أو تجميد من خاناتك.'}</p><div class="opts">
      ${p.spec.options.map((o) => `<button class="opt" data-clear="${o.slotId}|${o.what}"><b>${label[o.what](o)}</b></button>`).join('')}
    </div></div></div>`;
  }
  return '';
}

const RN = ['١', '٢', '٣', '٤', '٥'];

function boardWrap(title, body, { close = false, sub = '' } = {}) {
  const fresh = ui.boardShown !== title;
  ui.boardShown = title;
  return `<div class="sheet-bg wbg" ${close ? 'data-close="1"' : ''}><div class="woodboard ${fresh ? 'pop' : ''}">
    ${leafSVG('wb-leaf', 'left:-60px;top:-50px;transform:rotate(25deg) scale(.55)')}${leafSVG('wb-leaf', 'right:-60px;top:-55px;transform:scaleX(-1) rotate(25deg) scale(.55)')}
    <div class="wb-title">${title}</div>${sub ? `<div class="wb-sub">${sub}</div>` : ''}
    <div class="wb-body">${body}</div></div></div>`;
}

function teamTag(v, p) { return v.mode === 'team' ? `<span class="ribbon ${p.team === 0 ? 'sky' : 'pink'}">${p.team === 0 ? 'فريق أ' : 'فريق ب'}</span>` : ''; }

// One player's whole game: score and cards of every round.
function playerRounds(p) {
  const v = ui.view;
  const hands = p.roundHands || [];
  const rows = p.roundScores.map((sc, r) => {
    const h = hands[r] || {};
    const label = r < 5 ? `الجولة ${RN[r]}${r === 3 ? ' (×٢)' : r === 4 ? ' (عمياني)' : ''}` : 'جولة فاصلة';
    return `<div class="pr-row ${h.win ? 'win' : ''}">
      <div class="pr-top"><b>${label}</b>${h.win ? '<span class="chip gold">كسب 👑</span>' : ''}<span class="chip">كروته <b>${h.sum ?? '·'}</b></span><span class="chip dark">السكور <b>${sc}</b></span></div>
      ${h.slots ? miniHand(h.slots) : ''}
    </div>`;
  }).join('') || '<p class="wb-hint">لسه مفيش جولات خلصت</p>';
  return `<div class="pr-head">${avatarHTML(p.id, {}, p.av, p.fr)}<div class="rs-name"><b>${p.id === ui.me ? 'إنت' : esc(p.name)}</b>${teamTag(v, p)}</div><span class="chip dark">المجموع <b>${p.total}</b></span></div>
    <div class="pr-list">${rows}</div>
    <button class="plank cream" data-ph="">رجوع للسكور</button>`;
}

function scoresSheet() {
  const v = ui.view;
  const sel = ui.scorePid && v.players.find((x) => x.id === ui.scorePid);
  if (sel) return boardWrap('السكور', playerRounds(sel), { close: true });
  const head = `<tr><th></th>${RN.map((r, i) => `<th>${r}${i === 3 ? '<small>×٢</small>' : ''}</th>`).join('')}<th>المجموع</th></tr>`;
  const rows = v.players.map((p) => `<tr class="tap" data-ph="${p.id}"><td><div class="wb-who">${avatarHTML(p.id, { small: true }, p.av, p.fr)}<span>${p.id === ui.me ? 'إنت' : esc(p.name)}</span><i class="more">‹</i></div></td>${[0, 1, 2, 3, 4].map((r) => `<td>${p.roundScores[r] ?? '·'}</td>`).join('')}<td><b class="tot">${p.total}</b></td></tr>`).join('');
  return boardWrap('السكور', `<div class="parch"><table class="wb-table">${head}${rows}</table></div>
    <p class="wb-hint">دوس على أي لاعب تشوف كروته في كل جولة 🍌</p>
    <button class="plank cream" data-close="1">رجوع</button>`, { close: true });
}

function miniHand(slots) {
  return `<div class="mini-hand">${slots.map((s) => `<div class="m ${s.frozen ? 'fz' : ''}">${s.card ? cardSVG(s.card) : ''}${s.plus ? `<small>+${5 * s.plus}</small>` : ''}</div>`).join('')}</div>`;
}

function roundSheet() {
  const e = ui.lastRoundEnd, v = ui.view;
  const isHost = v.pending && v.pending.kind === 'roundOver';
  const rows = e.detail.map((d, i) => {
    const p = v.players.find((x) => x.id === d.pid);
    const u = v.mode === 'team' ? p.team : i;
    const win = e.wins[u];
    return `<div class="rs-row ${win ? 'win' : ''}">
      <div class="rs-top">${avatarHTML(p.id, {}, p.av, p.fr)}${win ? '<span class="crown">👑</span>' : ''}
        <div class="rs-name"><b>${p.id === ui.me ? 'إنت' : esc(p.name)}</b>${teamTag(v, p)}</div>
        <div class="rs-nums"><span class="chip">كروته <b>${d.sum}</b></span><span class="chip ${win ? 'gold' : ''}">${win ? 'كسب الجولة' : 'السكور'} <b>${e.scores[u]}</b></span><span class="chip dark">المجموع <b>${p.total}</b></span></div>
      </div>
      ${miniHand(d.slots)}
    </div>`;
  }).join('');
  const title = e.tiebreak ? 'الجولة الفاصلة' : `آخر الجولة ${RN[e.round - 1] || e.round}`;
  const sub = [e.mult === 2 ? 'الجولة دي النقط فيها × ٢' : '', v.mode === 'team' ? 'سكور الفريق = مجموع كروت الشريكين' : '', 'اللي كسب الجولة بياخد صفر'].filter(Boolean).join(' · ');
  return boardWrap(title, `<div class="rs-list">${rows}</div>
    ${isHost ? '<button class="plank gold" data-a="next">الجولة الجاية</button>' : '<p class="wb-hint">مستنيين صاحب الأوضة يبدأ الجولة الجاية…</p>'}`, { sub });
}

function gameOverSheet() {
  const v = ui.view;
  const winners = v.winners || (ui.gameOver && ui.gameOver.winners) || [];
  const iWon = winners.includes(ui.me);
  const ranked = v.players.slice().sort((a, b) => a.total - b.total);
  const medal = ['🥇', '🥈', '🥉', '4'];
  let rank = 0;
  const rows = ranked.map((p, k) => {
    if (k > 0 && p.total !== ranked[k - 1].total) rank = k;
    const w = winners.includes(p.id);
    return `<div class="go-row tap ${w ? 'win' : ''}" data-ph="${p.id}"><span class="medal">${medal[rank]}</span>${avatarHTML(p.id, {}, p.av, p.fr)}
      <div class="rs-name"><b>${p.id === ui.me ? 'إنت' : esc(p.name)}</b>${teamTag(v, p)}<div class="go-rounds">${p.roundScores.map((x, r) => `<i title="الجولة ${r + 1}">${x}</i>`).join('')}</div></div>
      <span class="chip ${w ? 'gold' : 'dark'}"><b>${p.total}</b></span></div>`;
  }).join('');
  const champ = winners.map((w) => esc(w === ui.me ? 'إنت' : pname(w))).join(' و');
  const sel = ui.scorePid && v.players.find((x) => x.id === ui.scorePid);
  if (sel) return boardWrap(iWon ? 'كسبت! 🍌👑' : 'خلصت اللعبة!', playerRounds(sel));
  return boardWrap(iWon ? 'كسبت! 🍌👑' : 'خلصت اللعبة!', `
    <div class="go-champ">${winners.slice(0, 2).map((w) => { const p = v.players.find((x) => x.id === w); return p ? avatarHTML(p.id, {}, p.av, p.fr) : ''; }).join('')}<div>بطل البنانا: <b>${champ}</b></div></div>
    <div class="go-list">${rows}</div>
    <p class="wb-hint">دوس على أي لاعب تشوف كروته في كل جولة</p>
    <div class="row">
      ${ui.conn && ui.conn.local ? '<button class="plank gold" data-ui="again">العب تاني</button>' : ''}
      <button class="plank cream" data-ui="leave">الرئيسية</button>
    </div>`);
}

let timerRAF = null;
function startTimerBar() {
  cancelAnimationFrame(timerRAF);
  const v = ui.view;
  if (!v || !v.deadline) return;
  const total = ['guard', 'snapWindow', 'delegate'].includes(v.waitingKind) ? 8000 : 15000;
  const tick = () => {
    const left = Math.max(0, ui.view.deadline - Date.now());
    const f = Math.min(1, left / total);
    const bar = document.querySelector('#timer i');
    if (bar) { bar.style.transform = `scaleX(${f})`; bar.parentElement.classList.toggle('low', left < 4000); }
    for (const r of document.querySelectorAll('.ring')) {
      const c = left < 4000 ? '#ff4f8b' : '#ffd84d';
      r.style.background = `conic-gradient(${c} ${f * 360}deg, rgba(42,22,8,.35) 0)`;
    }
    if (left > 0) timerRAF = requestAnimationFrame(tick);
  };
  tick();
}

// ------------------------------------------------------------ input
function onSlotTap(slotId, owner) {
  const v = ui.view, p = v.pending, sel = ui.sel;
  if (!p) return;
  const pick = pickableSlots();
  if (!pick.has(slotId)) return;
  if (sel.mode === 'snap') { send({ t: 'snap', slotId }); ui.sel = {}; return; }
  if (sel.mode === 'guard') { send({ t: 'guard', slotId }); ui.sel = {}; return; }
  if (sel.mode === 'selfg') { ui.sel = {}; return send({ t: 'throwGuard', slotId }); }
  if (sel.mode === 'gr2') { send({ t: 'guardRemove', guardSlot: slotId, targetSlot: sel.target, what: sel.what }); ui.sel = {}; return; }
  if (p.kind === 'hold') return send({ t: 'keep', slotId });
  if (p.kind === 'extra') { const i = sel.extraIdx; ui.sel = {}; return send({ t: 'keep', i, slotId }); }
  if (p.kind === 'target') {
    const sp = p.spec;
    if (sp.type === 'ownSlot' || sp.type === 'slot') return send({ slotId });
    if (sp.type === 'clear') return send({ slotId, what: 'card' });
    if (sp.type === 'swap') {
      if (!sel.mine) { sel.mine = slotId; return render(); }
      return send({ mine: sel.mine, theirs: slotId });
    }
    if (sp.type === 'observe') {
      sel.picks = sel.picks || {};
      for (const [pid, ids] of Object.entries(sp.groups)) if (ids.includes(slotId)) sel.picks[pid] = slotId;
      return render();
    }
    if (sp.type === 'multiSlot') {
      sel.multi = sel.multi || [];
      if (sel.multi.includes(slotId)) sel.multi = sel.multi.filter((x) => x !== slotId);
      else if (sel.multi.length < sp.n) sel.multi.push(slotId);
      return render();
    }
  }
}

// Touching the monkeys or the logo on the home screen (and the secret code).
$app.addEventListener('pointerdown', (ev) => {
  const t = ev.target.closest('[data-mk]');
  if (!t || !t.dataset.mk || ui.screen !== 'home' || ui.sheet) return;
  onSecretTap($app, t.dataset.mk, (gift) => {
    // the gift becomes yours right away (you can still change it)
    if (gift.kind === 'frame') ui.frame = gift.id;
    if (gift.kind === 'table') ui.tableSel = gift.id;
    if (gift.kind === 'avatar') ui.avSel = gift.id;
    ui.gift = gift; ui.sheet = 'gift'; render();
  }, () => { ui.sheet = 'owner'; ui.sheetAt = Date.now(); ui.gift = null; render(); setTimeout(() => { const i = document.getElementById('pin'); if (i) i.focus(); }, 50); });
});

function giftSheet() {
  const g = ui.gift;
  let body;
  if (ui.ownerWelcome) body = '<p class="gift-title">أهلاً بيك يا صاحب اللعبة 👑</p><p>كل الهدايا اتفتحتلك: الإطارات في صورتك، والترابيزات في لون الترابيزة.</p>';
  else if (g) {
    const prev = g.kind === 'frame' ? `<div class="avatar framed gift-av">${avatarInner(myAvatar())}${frameHTML(g.id)}</div>`
      : g.kind === 'avatar' ? `<div class="avatar gift-av">${avatarInner(g.id)}</div>`
      : `<div class="gift-table" style="background-image:url('${g.src}')"></div>`;
    body = `<p class="gift-title">مبروك عليك الهدية دي 🎉</p>${prev}`;
  } else body = '';
  return `<div class="sheet-bg wbg" data-close="1"><div class="woodboard pop">
    <div class="wb-title">🎁 هدية!</div>
    <div class="wb-body"><div class="parch gift-body">${body}</div><button class="plank gold" data-close="1">تمام</button></div></div></div>`;
}

function ownerSheet() {
  return `<div class="sheet-bg wbg" data-close="1"><div class="woodboard pop">
    <div class="wb-title">🔒</div>
    <div class="wb-body"><div class="parch gift-body"><input id="pin" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="الرقم"></div>
    <button class="plank gold" data-pin="1">تمام</button></div></div></div>`;
}

$app.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-fr],[data-pin],[data-ph],[data-tb],[data-av],[data-lp],[data-gr],[data-go],[data-seg],[data-act-ui],[data-a],[data-ui],[data-slot],[data-pile],[data-target],[data-player],[data-option],[data-clear],[data-delegate],[data-extra],[data-sheet],[data-close],[data-lobby]');
  if (!t) return;
  const d = t.dataset;
  const nm = document.getElementById('nm');
  if (nm) { ui.name = nm.value.trim().slice(0, 14); LS.set('name', ui.name); }
  if (d.close && ev.target === t) { if (ui.sheet === 'owner' && Date.now() - (ui.sheetAt || 0) < 800) return; ui.sheet = null; ui.ownerWelcome = false; return render(); }
  if (d.close) { if (t.tagName === 'BUTTON') { ui.sheet = null; ui.ownerWelcome = false; render(); } return; }
  if (d.lp != null) { ui.learnPage = +d.lp; return render(); }
  if (d.go === 'rules') ui.learnPage = 0;
  if (d.go) { ui.error = ''; ui.screen = d.go; return render(); }
  if (d.seg) {
    const val = JSON.parse(d.val);
    if (d.seg.startsWith('l') && ui.lobby) { ui.lobby.updateSettings({ [d.seg.slice(1)]: val }); return; }
    ui.setup[d.seg] = val; LS.set('setup', ui.setup); return render();
  }
  if (d.actUi === 'start-bots') return startBots();
  if (d.actUi === 'create-room') return Net.createRoom(netCtx());
  if (d.actUi === 'join-room') {
    const code = (document.getElementById('code').value || '').replace(/\D/g, '');
    if (code.length < 4) { ui.error = 'اكتب الكود اللي صاحبك بعته (٤ أرقام).'; return render(); }
    return Net.joinRoom(netCtx(), code);
  }
  if (d.lobby) return ui.lobby && ui.lobby.handle(d.lobby, +d.i);
  if (d.pin) {
    const v = (document.getElementById('pin') || {}).value || '';
    if (unlockAll(v)) { ui.ownerWelcome = true; ui.sheet = 'gift'; } else ui.sheet = null;
    return render();
  }
  if (d.ph != null) { ui.scorePid = d.ph || null; return render(); }
  if (d.tb) { if (giftById(d.tb)) ui.tableSel = d.tb; else { ui.tableSel = null; LS.set('table', d.tb); } return render(); }
  if (d.av) { if (/^g\d$/.test(d.av)) ui.avSel = d.av; else { ui.avSel = null; LS.set('avatar', d.av); } ui.sheet = null; return render(); }
  if (d.fr != null) { ui.frame = d.fr || null; return render(); }
  if (d.sheet) { ui.scorePid = null; if (d.sheet === 'learn') ui.learnPage = 0; ui.sheet = d.sheet; return render(); }
  if (d.a) {
    if (d.a === 'next') ui.lastRoundEnd = null;
    return send({ t: d.a });
  }
  if (d.ui === 'snap-mode') { ui.sel = ui.sel.mode === 'snap' ? {} : { ...ui.sel, mode: 'snap' }; return render(); }
  if (d.ui === 'guard-mode') { ui.sel = { mode: 'guard' }; return render(); }
  if (d.ui === 'share-code') { const c = ui.conn && ui.conn.room; if (c) { const t = `تعالى العب بنانا معايا 🍌 كود الأوضة: ${c}\n${location.href.split('?')[0]}`; if (navigator.share) navigator.share({ text: t }).catch(() => {}); else if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { log('الكود اتنسخ'); render(); }).catch(() => {}); } return; }
  if (d.ui === 'selfg') { ui.sel = ui.sel.mode === 'selfg' ? {} : { mode: 'selfg' }; return render(); }
  if (d.ui === 'gr1') { ui.sel = ui.sel.mode === 'gr1' ? {} : { mode: 'gr1' }; return render(); }
  if (d.gr) { const [target, what] = d.gr.split('|'); ui.sel = { mode: 'gr2', target, what }; return render(); }
  if (d.ui === 'extra-throw') { const i = ui.sel.extraIdx; ui.sel = {}; return send({ t: 'throw', i }); }
  if (d.ui === 'observe-ok') return send({ picks: ui.sel.picks });
  if (d.ui === 'multi-ok') return send({ slotIds: ui.sel.multi });
  if (d.ui === 'unpick') { ui.sel = {}; return render(); }
  if (d.ui === 'leave') return leaveGame();
  if (d.ui === 'again') { leaveGame(); ui.screen = 'bots'; return startBots(); }
  if (d.extra != null) { ui.sel = { extraIdx: +d.extra }; return render(); }
  if (d.option) return send({ option: d.option });
  if (d.clear) { const [slotId, what] = d.clear.split('|'); return send({ slotId, what }); }
  if (d.delegate) return send({ t: 'delegate', who: d.delegate });
  if (d.target) return send({ target: d.target });
  if (d.player) { if (pickablePlayers().has(d.player)) send({ target: d.player }); return; }
  if (d.pile === 'deck') { if (ui.view?.pending?.kind === 'turn') send({ t: 'draw' }); return; }
  if (d.pile === 'discard') { if (ui.view?.pending?.kind === 'turn') send({ t: 'take' }); return; }
  if (d.slot) { ev.stopPropagation(); return onSlotTap(d.slot, d.owner); }
});
$app.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role=button]')) { ev.preventDefault(); ev.target.click(); }
});

// The network layer talks to the UI through this small context.
function netCtx() {
  return {
    name: () => ui.name || 'لاعب',
    avatar: () => myAvatar(),
    frame: () => myFrame(),
    setup: () => ui.setup,
    showLobby(lobby) { ui.lobby = lobby; ui.screen = 'lobby'; ui.error = ''; render(); },
    lobbyChanged() { if (ui.screen === 'lobby') render(); },
    startGame(conn, pid) {
      ui.conn = conn; ui.me = pid; ui.screen = 'game';
      ui.view = null; ui.reveals = {}; ui.logs = []; ui.gameOver = null; ui.lastRoundEnd = null; resetUpdates();
      render();
    },
    update: onUpdate,
    error(msg) { ui.error = msg; if (ui.screen !== 'game') ui.screen = 'online'; render(); },
    toast(msg) { log(msg); render(); },
    left() { leaveGame(); },
  };
}

render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // A new version takes over at once; reload so the player sees it (not mid-game).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && ui.screen !== 'game' && ui.screen !== 'lobby') location.reload(); });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}
