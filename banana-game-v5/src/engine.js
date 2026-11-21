// Banana card game — rules engine.
// Pure, deterministic (seeded RNG), no DOM. The host device runs this and
// sends each player a redacted view (see viewFor).
//
// Rules source: "قواعد لعبة Banana — المرجع الكامل".

// ---------------------------------------------------------------- cards
export const CARD_DEFS = {
  n0: { value: 0, kind: 'num' }, n1: { value: 1, kind: 'num' }, n2: { value: 2, kind: 'num' },
  n3: { value: 3, kind: 'num' }, n4: { value: 4, kind: 'num' }, n5: { value: 5, kind: 'num' },
  n6: { value: 6, kind: 'num' }, n7: { value: 7, kind: 'num' }, n8: { value: 8, kind: 'num' },
  n9: { value: 9, kind: 'num' }, n10: { value: 10, kind: 'num' }, n15: { value: 15, kind: 'num' },
  n20: { value: 20, kind: 'num' }, n25: { value: 25, kind: 'num' }, minus: { value: -1, kind: 'num' },
  buzz: { value: 10, kind: 'cmd' }, clear: { value: 10, kind: 'cmd' }, copy: { value: 10, kind: 'cmd' },
  curse: { value: 10, kind: 'cmd' }, extra: { value: 10, kind: 'cmd' }, golden: { value: 10, kind: 'cmd' },
  plus: { value: 10, kind: 'cmd' }, freeze: { value: 10, kind: 'cmd' }, swap: { value: 10, kind: 'cmd' },
  tornado: { value: 10, kind: 'cmd' }, guard: { value: 10, kind: 'cmd' }, choose: { value: 10, kind: 'cmd' },
};

export const NUM_EFFECT = {
  n5: 'revealOwn', n6: 'revealOwn', n7: 'peekOwn', n8: 'peekOwn',
  n9: 'peekOther', n10: 'peekOther', n15: 'revealAll', n20: 'shuffleOwn',
};

const COMMON = {
  n5: 4, n6: 4, n7: 4, n8: 4, n9: 4, n10: 4, n15: 4, n20: 4, n25: 8, minus: 1,
  swap: 6, choose: 6, buzz: 2, clear: 2, copy: 2, curse: 2, extra: 2, plus: 2, freeze: 2,
  guard: 2, golden: 1, tornado: 1,
};
export const DECK_COUNTS = {
  solo: { n0: 2, n1: 4, n2: 4, n3: 4, n4: 4, ...COMMON },
  team: { n0: 3, n1: 3, n2: 3, n3: 3, n4: 3, ...COMMON },
};

export const REVEAL_MS = 3000;
export const GOLDEN_MS = 5000;
export const ROUNDS = 5;

export const isCmd = (name) => CARD_DEFS[name].kind === 'cmd';
export const hasEffect = (name) => isCmd(name) || !!NUM_EFFECT[name];

// ---------------------------------------------------------------- rng
function rngNext(state) {
  // mulberry32
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(state, n) { return Math.floor(rngNext(state) * n); }
function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rint(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------- helpers
export class RuleError extends Error {}
function fail(msg) { throw new RuleError(msg); }

export const nameOf = (state, cardId) => state.cards[cardId];
const player = (state, pid) => state.players.find((p) => p.id === pid) || fail('no player ' + pid);
const pidx = (state, pid) => state.players.findIndex((p) => p.id === pid);

export function findSlot(state, slotId) {
  for (const p of state.players) {
    const s = p.slots.find((x) => x.id === slotId);
    if (s) return { p, s };
  }
  return null;
}
export const cardSlots = (p) => p.slots.filter((s) => s.card);
export const hasNoCards = (p) => p.slots.every((s) => !s.card);
export const partnerOf = (state, pid) => {
  if (state.mode !== 'team') return null;
  const i = pidx(state, pid);
  return state.players[(i + 2) % 4];
};
// Slots another effect may touch: has a card and is not frozen.
const touchable = (s) => s.card && !s.freeze && !s.locked;

function emit(state, ev) {
  ev.seq = ++state.seq;
  state.events.push(ev);
  if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
}

function removeCardFromSlot(p, s) {
  const c = s.card;
  if (s.plus > 0) s.card = null; // slot with +5 survives empty
  else p.slots.splice(p.slots.indexOf(s), 1);
  return c;
}

function giveCard(state, p, cardId) {
  const empty = p.slots.find((s) => !s.card && !s.freeze);
  if (empty) { empty.card = cardId; return empty; }
  const s = { id: 's' + ++state.slotSeq, card: cardId, plus: 0, plusCards: [], freeze: null };
  p.slots.push(s);
  return s;
}

function topDiscard(state) { return state.discard[state.discard.length - 1]; }

// The card directly under `triggerId` in the discard pile (null if none).
function cardUnder(state, triggerId) {
  const i = state.discard.lastIndexOf(triggerId);
  if (i <= 0) return null;
  return state.discard[i - 1];
}
function takeFromDiscard(state, cardId) {
  const i = state.discard.lastIndexOf(cardId);
  if (i < 0) fail('card not on discard');
  state.discard.splice(i, 1);
  return cardId;
}

// Draw from deck. Solo: reshuffle discard (keeping top) when empty.
// Team: deck running out ends the round after the current turn.
function drawCard(state) {
  if (state.deck.length === 0 && state.mode === 'solo') {
    if (state.discard.length > 1) {
      const top = state.discard.pop();
      state.deck = shuffle(state, state.discard);
      state.discard = [top];
      emit(state, { type: 'reshuffle', to: 'all' });
    }
  }
  if (state.deck.length === 0) return null;
  const c = state.deck.pop();
  if (state.mode === 'team' && state.deck.length === 0) state.deckOut = true;
  return c;
}
function canDraw(state) {
  return state.deck.length > 0 || (state.mode === 'solo' && state.discard.length > 1);
}

function reveal(state, to, items, dur = REVEAL_MS) {
  if (!items.length) return;
  emit(state, {
    type: 'reveal', to, dur,
    items: items.map(({ p, s }) => ({ owner: p.id, slotId: s.id, card: nameOf(state, s.card) })),
  });
}

// ---------------------------------------------------------------- setup
export function createGame({ mode, players, seed = Date.now() }) {
  if (mode === 'team' && players.length !== 4) fail('team mode needs 4 players');
  if (mode === 'solo' && (players.length < 3 || players.length > 4)) fail('solo mode needs 3-4 players');
  const state = {
    v: 1, mode, rng: seed | 0, seq: 0, slotSeq: 0, events: [],
    cards: {}, deck: [], discard: [], limbo: [],
    players: players.map((pl, i) => ({
      id: pl.id, name: pl.name, av: pl.av || null, bot: pl.bot || null, team: mode === 'team' ? i % 2 : i,
      slots: [], turnsPlayed: 0, skipNext: false, total: 0, roundScores: [],
    })),
    round: 0, tiebreak: 0, startIdx: -1, current: null,
    stack: [], pending: null, lastActivated: null,
    banana: null, finalQueue: null, teamFinisher: null, deckOut: false,
    over: false, winners: null,
  };
  let n = 0;
  for (const [name, count] of Object.entries(DECK_COUNTS[mode])) {
    for (let k = 0; k < count; k++) state.cards['c' + ++n] = name;
  }
  state.totalCards = n;
  startRound(state);
  run(state);
  return state;
}

export function roundType(state) {
  if (state.tiebreak > 0) return 'blind';
  if (state.round === 4) return 'double';
  if (state.round === 5) return 'blind';
  return 'normal';
}

function startRound(state) {
  if (state.tiebreak === 0) state.round++;
  state.deck = shuffle(state, Object.keys(state.cards));
  state.discard = [];
  state.limbo = [];
  state.stack = [];
  state.lastActivated = null;
  state.banana = null; state.finalQueue = null; state.teamFinisher = null; state.deckOut = false;
  for (const p of state.players) {
    p.slots = []; p.turnsPlayed = 0; p.skipNext = false; p.finished = false;
    for (let k = 0; k < 4; k++) giveCard(state, p, state.deck.pop());
  }
  const blind = roundType(state) === 'blind';
  if (!blind) state.discard.push(state.deck.pop());
  state.startIdx = state.startIdx < 0 ? rint(state, state.players.length) : (state.startIdx + 1) % state.players.length;
  emit(state, { type: 'roundStart', to: 'all', round: state.round, kind: roundType(state), tiebreak: state.tiebreak });
  state.current = null;
  if (!blind) {
    for (const p of state.players) {
      // slots[0] is the right-most card on the player's screen (RTL row).
      // dur 0 = stays face up until everyone is ready.
      reveal(state, [p.id], p.slots.slice(0, 2).map((s) => ({ p, s })), 0);
    }
    setPending(state, { kind: 'ready', pids: state.players.map((p) => p.id), answers: {} });
    return;
  }
  beginTurn(state, state.players[state.startIdx]);
}

function startPlay(state) {
  emit(state, { type: 'go', to: 'all' });
  beginTurn(state, state.players[state.startIdx]);
}

// ---------------------------------------------------------------- task runner
// state.stack is a LIFO of plain-object tasks. A task either finishes or sets
// state.pending and returns. run() keeps going while nothing is pending.
function schedule(state, ...tasks) {
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i]) state.stack.push(tasks[i]);
}

function run(state) {
  let guard = 0;
  while (!state.pending && !state.over) {
    if (++guard > 10000) fail('engine loop');
    const t = state.stack.pop();
    if (!t) fail('stack empty with no pending');
    TASKS[t.k](state, t);
  }
}

function setPending(state, pending) { state.pending = pending; }

// ---------------------------------------------------------------- turns
function beginTurn(state, p) {
  for (const q of state.players) for (const s of q.slots) delete s.locked;
  state.current = p.id;
  state.turnCtx = { pid: p.id, snaps: 0, frozenAtStart: p.slots.filter((s) => s.freeze).map((s) => s.id) };
  emit(state, { type: 'turn', to: 'all', pid: p.id });
  setPending(state, { kind: 'turn', pid: p.id });
}

function nextPlayer(state) {
  const n = state.players.length;
  let i = pidx(state, state.current);
  for (let step = 0; step < n * 3; step++) {
    let p;
    if (state.finalQueue) {
      if (!state.finalQueue.length) return null;
      p = player(state, state.finalQueue.shift());
      if (state.mode === 'solo' && hasNoCards(p)) continue;
    } else {
      i = (i + 1) % n;
      p = state.players[i];
      if (state.mode === 'team' && state.teamFinisher === p.id) {
        // The finisher's turn came round: everyone else plays once more.
        state.finalQueue = [1, 2, 3].map((d) => state.players[(i + d) % n].id);
        emit(state, { type: 'finalLap', to: 'all', pid: p.id });
        continue;
      }
    }
    if (p.skipNext) {
      p.skipNext = false;
      emit(state, { type: 'skipped', to: 'all', pid: p.id });
      continue;
    }
    return p;
  }
  return null;
}

const TASKS = {
    endTurn(state, t) {
      const p = player(state, t.pid);
      p.turnsPlayed++;
      // Freeze counts down only on turns the slot's owner actually plays.
      for (const s of p.slots) {
        if (s.freeze && state.turnCtx.frozenAtStart.includes(s.id)) {
          s.freeze.left--;
          if (s.freeze.left <= 0) {
            emit(state, { type: 'markerOff', to: 'all', slotId: s.id, card: nameOf(state, s.freeze.card) });
            state.discard.push(s.freeze.card);
            s.freeze = null;
            emit(state, { type: 'unfreeze', to: 'all', slotId: s.id, owner: p.id });
          }
        }
      }
      const tasks = [];
      const mate = partnerOf(state, p.id);
      // Partner gets a window for the floor card only if it's a new one
      // (e.g. a Freeze that just ended, or the card you swapped out).
      if (mate && !hasNoCards(mate) && state.discard.length && topDiscard(state) !== state.turnCtx.offeredTop) tasks.push({ k: 'snapWindow', pid: mate.id, other: p.id });
      tasks.push({ k: 'afterTurn' });
      schedule(state, ...tasks);
    },

    afterTurn(state) {
      // Detect players who got rid of all their cards.
      for (const p of state.players) {
        if (!p.finished && hasNoCards(p)) {
          p.finished = true;
          emit(state, { type: 'finished', to: 'all', pid: p.id });
          if (state.mode === 'solo' && !state.banana && !state.finalQueue) {
            const i = pidx(state, p.id), n = state.players.length;
            state.finalQueue = [];
            for (let d = 1; d < n; d++) state.finalQueue.push(state.players[(i + d) % n].id);
            // Players already passed this lap still get exactly one turn each.
            if (state.current !== p.id) {
              // finisher finished out of own turn (not possible in solo, kept for safety)
            }
          }
          if (state.mode === 'team' && !state.teamFinisher) state.teamFinisher = p.id;
        }
      }
      if (state.mode === 'team' && state.deckOut) { schedule(state, { k: 'roundEnd' }); return; }
      const nx = nextPlayer(state);
      if (!nx) { schedule(state, { k: 'roundEnd' }); return; }
      beginTurn(state, nx);
    },

    roundEnd(state) { roundEnd(state); },

    effect(state, t) {
      const name = nameOf(state, t.trigger);
      // A partner's wrong snap can take the thrown card off the floor; then its power is lost.
      if (!state.discard.includes(t.trigger)) { emit(state, { type: 'noEffect', to: 'all', card: name, taken: true }); return; }
      if (state.mode === 'team') {
        const mate = partnerOf(state, t.owner);
        setPending(state, { kind: 'delegate', pids: [t.owner, mate.id], owner: t.owner, answers: {}, card: name, trigger: t.trigger });
        return;
      }
      schedule(state, { k: 'exec', name, exec: t.owner, trigger: t.trigger });
    },

    exec(state, t) { execEffect(state, t); },

    snapWindow(state, t) {
      const p = player(state, t.pid);
      if (hasNoCards(p) || !state.discard.length) return;
      state.turnCtx.offeredTop = topDiscard(state);
      setPending(state, { kind: 'snapWindow', pid: t.pid, other: t.other, top: nameOf(state, topDiscard(state)) });
    },

    guardCheck(state, t) {
      const target = player(state, t.target);
      if (!t.announced) {
        t.announced = true;
        emit(state, { type: 'targeted', to: 'all', by: t.exec, target: t.target, card: t.card, slotId: t.then && (t.then.slotId || t.then.theirs) || t.observeSlot || null });
      }
      if (t.target === t.exec || hasNoCards(target)) { schedule(state, t.then); return; }
      setPending(state, { kind: 'guard', pid: t.target, card: t.card, by: t.exec, task: t });
    },

    // generic continuation helpers
    set(state, t) { state.lastActivated = t.name; },
    extraContinue(state, t) { pendExtra(state, t.pid, t.ctx); },
    observeReveal(state, t) {
      for (const it of t.picks) {
        const f = findSlot(state, it.slotId);
        if (f && touchable(f.s)) {
          emit(state, { type: 'peeked', to: 'all', pid: t.exec, owner: f.p.id, slotId: f.s.id });
          reveal(state, [t.exec], [f]);
        }
      }
      state.lastActivated = 'choose';
    },
    apply(state, t) { APPLY[t.what](state, t); },
    noop() {},
  };

// ---------------------------------------------------------------- effect execution
function eligibleOwn(state, pid, exclude) {
  return player(state, pid).slots.filter((s) => touchable(s) && s.id !== exclude);
}
function eligibleAny(state, exclude, filterOwner = () => true) {
  const out = [];
  for (const p of state.players) {
    if (p.finished || hasNoCards(p) || !filterOwner(p)) continue;
    for (const s of p.slots) if (touchable(s) && s.id !== exclude) out.push(s.id);
  }
  return out;
}
function targetablePlayers(state, filter = () => true) {
  return state.players.filter((p) => !p.finished && !hasNoCards(p) && filter(p)).map((p) => p.id);
}

function pendTarget(state, t, spec) {
  setPending(state, { kind: 'target', pid: t.exec, card: t.name, spec, task: t });
}

function execEffect(state, t) {
  const { name, exec } = t;
  const me = player(state, exec);
  if (name === 'tornadoPick') {
    const tp = player(state, t.target);
    const opts = tp.slots.filter((s) => touchable(s) && s.id !== t.exclude).map((s) => s.id);
    if (t.n <= 0 || !opts.length) return;
    return pendTarget(state, { ...t, step: 'tornadoPick' }, { type: 'multiSlot', options: opts, n: Math.min(t.n, opts.length) });
  }
  emit(state, { type: 'effect', to: 'all', card: name, pid: exec, viaCopy: !!t.viaCopy });
  switch (name) {
    // ----- number effects
    case 'n5': case 'n6': {
      const opts = eligibleOwn(state, exec).map((s) => s.id);
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: 'revealOwn' }, { type: 'ownSlot', options: opts });
    }
    case 'n7': case 'n8': {
      const opts = eligibleOwn(state, exec).map((s) => s.id);
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: 'peekOwn' }, { type: 'ownSlot', options: opts });
    }
    case 'n9': case 'n10': {
      const opts = eligibleAny(state, null, (p) => p.id !== exec);
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: 'peekOther' }, { type: 'slot', options: opts });
    }
    case 'n15':
      reveal(state, 'all', me.slots.filter(touchable).map((s) => ({ p: me, s })));
      return;
    case 'n20':
      shuffleCards(state, me);
      return;
    // ----- commands
    case 'golden':
      for (const s of me.slots.filter(touchable)) emit(state, { type: 'peeked', to: 'all', pid: exec, owner: exec, slotId: s.id });
      reveal(state, [exec], me.slots.filter(touchable).map((s) => ({ p: me, s })), GOLDEN_MS);
      return done(state, t);
    case 'buzz': {
      const under = cardUnder(state, t.trigger);
      if (!under) { emit(state, { type: 'noEffect', to: 'all', card: 'buzz' }); return; }
      return pendTarget(state, { ...t, step: 'buzz' }, { type: 'player', options: targetablePlayers(state) });
    }
    case 'clear': {
      const opts = [];
      for (const s of me.slots) {
        if (s.id === t.exclude) continue;
        if (touchable(s)) opts.push({ slotId: s.id, what: 'card' });
        if (s.plus > 0 && !s.freeze) opts.push({ slotId: s.id, what: 'plus' });
        if (s.freeze) opts.push({ slotId: s.id, what: 'freeze' });
      }
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: 'clear' }, { type: 'clear', options: opts });
    }
    case 'guard': {
      // A thrown Guard takes one Plus or the Freeze off one of your own slots.
      const opts = [];
      for (const s of me.slots) {
        if (s.plus > 0 && !s.freeze) opts.push({ slotId: s.id, what: 'plus' });
        if (s.freeze) opts.push({ slotId: s.id, what: 'freeze' });
      }
      if (!opts.length) { emit(state, { type: 'noEffect', to: 'all', card: 'guard' }); return; }
      return pendTarget(state, { ...t, step: 'guardFix' }, { type: 'clear', options: opts });
    }
    case 'copy': {
      const last = state.lastActivated;
      if (!last) { emit(state, { type: 'noEffect', to: 'all', card: 'copy' }); return; }
      schedule(state, { ...t, k: 'exec', name: last, viaCopy: true });
      return;
    }
    case 'curse': {
      const opts = eligibleAny(state, t.exclude);
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: 'curse' }, { type: 'slot', options: opts });
    }
    case 'extra': {
      const cards = [];
      for (let k = 0; k < 2; k++) { const c = drawCard(state); if (c) cards.push(c); }
      state.limbo.push(...cards);
      for (const c of cards) emit(state, { type: 'drew', to: [exec], card: nameOf(state, c), cardId: c });
      emit(state, { type: 'drewHidden', to: 'all', pid: exec, n: cards.length });
      state.lastActivated = 'extra';
      return pendExtra(state, exec, { cards, snaps: 0 });
    }
    case 'plus': case 'freeze': {
      const opts = eligibleAny(state, t.exclude);
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: name }, { type: 'slot', options: opts });
    }
    case 'swap': {
      const mine = eligibleOwn(state, exec, t.exclude).map((s) => s.id);
      const theirs = eligibleAny(state, null, (p) => p.id !== exec);
      if (!mine.length || !theirs.length) return;
      return pendTarget(state, { ...t, step: 'swap' }, { type: 'swap', mine, theirs });
    }
    case 'tornado': {
      const opts = targetablePlayers(state, (p) => p.slots.some(touchable));
      if (!opts.length) return;
      return pendTarget(state, { ...t, step: 'tornado' }, { type: 'player', options: opts });
    }
    case 'guard':
      return;
    case 'choose':
      return pendTarget(state, { ...t, step: 'choose' }, { type: 'option', options: ['observe', 'shuffle', 'skip', 'peek', 'activate'] });
    default:
      fail('unknown effect ' + name);
  }
}

function done(state, t) {
  // Record "last command actually activated" for copy. Number effects never count.
  if (isCmd(t.name) && t.name !== 'guard') state.lastActivated = t.name;
}

function shuffleCards(state, p) {
  const slots = p.slots.filter(touchable);
  const cards = shuffle(state, slots.map((s) => s.card));
  slots.forEach((s, i) => (s.card = cards[i]));
  emit(state, { type: 'shuffled', to: 'all', pid: p.id });
}

function pendExtra(state, pid, ctx) {
  if (!ctx.cards.length) return; // finished; turn continues to endTurn already scheduled
  setPending(state, { kind: 'extra', pid, cards: ctx.cards.map((c) => ({ id: c, name: nameOf(state, c) })), ctx });
}

// Applying resolved targets (after guard checks).
const APPLY = {
  buzz(state, t) {
    const under = cardUnder(state, t.trigger);
    if (!under) return;
    takeFromDiscard(state, under);
    const s = giveCard(state, player(state, t.target), under);
    emit(state, { type: 'gave', to: 'all', pid: t.target, slotId: s.id, card: nameOf(state, under) });
    done(state, { name: 'buzz' });
  },
  curse(state, t) {
    const f = findSlot(state, t.slotId);
    if (!f || !touchable(f.s)) return;
    reveal(state, 'all', [f]);
    const old = f.s.card;
    state.discard.unshift(old);
    const nw = drawCard(state);
    if (nw) { f.s.card = nw; emit(state, { type: 'replaced', to: 'all', slotId: f.s.id }); }
    else removeCardFromSlot(f.p, f.s);
    done(state, { name: 'curse' });
  },
  plus(state, t) {
    const f = findSlot(state, t.slotId);
    if (!f || !touchable(f.s)) return;
    takeFromDiscard(state, t.trigger);
    f.s.plus++; f.s.plusCards.push(t.trigger);
    emit(state, { type: 'plus', to: 'all', slotId: f.s.id, owner: f.p.id, card: nameOf(state, t.trigger) });
    done(state, { name: 'plus' });
  },
  freeze(state, t) {
    const f = findSlot(state, t.slotId);
    if (!f || !touchable(f.s)) return;
    takeFromDiscard(state, t.trigger);
    f.s.freeze = { card: t.trigger, left: 3 };
    emit(state, { type: 'freeze', to: 'all', slotId: f.s.id, owner: f.p.id, card: nameOf(state, t.trigger) });
    done(state, { name: 'freeze' });
  },
  swap(state, t) {
    const a = findSlot(state, t.mine), b = findSlot(state, t.theirs);
    if (!a || !b || !touchable(a.s) || !touchable(b.s)) return;
    [a.s.card, b.s.card] = [b.s.card, a.s.card];
    emit(state, { type: 'swapped', to: 'all', a: a.s.id, b: b.s.id, pa: a.p.id, pb: b.p.id });
    done(state, { name: 'swap' });
  },
  tornado(state, t) {
    const p = player(state, t.target);
    const all = p.slots.filter((s) => touchable(s) && s.id !== t.exclude);
    reveal(state, 'all', all.map((s) => ({ p, s })));
    // Normally every card is replaced. With a short deck (team) only the
    // slots the tornado player picked are replaced; the rest stay.
    const replace = t.only ? all.filter((s) => t.only.includes(s.id)) : all;
    for (const s of replace) state.discard.unshift(s.card), (s.card = null);
    for (const s of replace) { const c = drawCard(state); if (c) s.card = c; }
    for (const s of replace) if (!s.card) removeCardFromSlot(p, s);
    emit(state, { type: 'tornado', to: 'all', pid: p.id });
    done(state, { name: 'tornado' });
  },
  shuffle(state, t) {
    shuffleCards(state, player(state, t.target));
    state.lastActivated = 'choose';
  },
  skip(state, t) {
    const p = player(state, t.target);
    if (state.banana === p.id) return;
    p.skipNext = true;
    emit(state, { type: 'willSkip', to: 'all', pid: p.id });
    state.lastActivated = 'choose';
  },
};

// Resolve a `target` pending with the chosen value.
function resolveTarget(state, pend, a) {
  const t = pend.task;
  const spec = pend.spec;
  const exec = t.exec;
  const check = (target, then) => ({ k: 'guardCheck', target, exec, card: t.name, trigger: t.trigger, then });
  switch (t.step) {
    case 'revealOwn': {
      if (!spec.options.includes(a.slotId)) fail('bad slot');
      reveal(state, 'all', [findSlot(state, a.slotId)]);
      return;
    }
    case 'peekOwn': case 'peekOther': {
      if (!spec.options.includes(a.slotId)) fail('bad slot');
      const f = findSlot(state, a.slotId);
      emit(state, { type: 'peeked', to: 'all', pid: exec, owner: f.p.id, slotId: a.slotId });
      reveal(state, [exec], [f]);
      return;
    }
    case 'buzz': {
      if (!spec.options.includes(a.target)) fail('bad target');
      schedule(state, check(a.target, { k: 'apply', what: 'buzz', target: a.target, trigger: t.trigger }));
      return;
    }
    case 'clear': case 'guardFix': {
      const o = spec.options.find((x) => x.slotId === a.slotId && x.what === a.what);
      if (!o) fail('bad clear');
      const f = findSlot(state, a.slotId);
      if (a.what === 'card') {
        reveal(state, 'all', [f]);
        state.discard.push(removeCardFromSlot(f.p, f.s));
      } else if (a.what === 'plus') {
        emit(state, { type: 'markerOff', to: 'all', slotId: f.s.id, card: nameOf(state, f.s.plusCards[f.s.plusCards.length - 1]) });
        state.discard.push(f.s.plusCards.pop());
        f.s.plus--;
        if (f.s.plus === 0 && !f.s.card) f.p.slots.splice(f.p.slots.indexOf(f.s), 1);
      } else {
        emit(state, { type: 'markerOff', to: 'all', slotId: f.s.id, card: nameOf(state, f.s.freeze.card) });
        state.discard.push(f.s.freeze.card);
        f.s.freeze = null;
      }
      emit(state, { type: 'cleared', to: 'all', pid: exec, slotId: a.slotId, what: a.what, card: t.step === 'clear' ? 'clear' : 'guard' });
      done(state, { name: t.step === 'clear' ? 'clear' : 'guard' });
      return;
    }
    case 'curse': {
      if (!spec.options.includes(a.slotId)) fail('bad slot');
      const f = findSlot(state, a.slotId);
      schedule(state, check(f.p.id, { k: 'apply', what: 'curse', slotId: a.slotId }));
      return;
    }
    case 'plus': case 'freeze': {
      if (!spec.options.includes(a.slotId)) fail('bad slot');
      const f = findSlot(state, a.slotId);
      schedule(state, check(f.p.id, { k: 'apply', what: t.step, slotId: a.slotId, trigger: t.trigger }));
      return;
    }
    case 'swap': {
      if (!spec.mine.includes(a.mine) || !spec.theirs.includes(a.theirs)) fail('bad swap');
      const f = findSlot(state, a.theirs);
      schedule(state, check(f.p.id, { k: 'apply', what: 'swap', mine: a.mine, theirs: a.theirs }));
      return;
    }
    case 'tornado': {
      if (!spec.options.includes(a.target)) fail('bad target');
      const tp = player(state, a.target);
      const need = tp.slots.filter((s) => touchable(s) && s.id !== t.exclude).length;
      if (state.mode === 'team' && state.deck.length < need) {
        // Short deck: the tornado player picks which slots get the new cards.
        schedule(state, check(a.target, { k: 'exec', name: 'tornadoPick', exec, target: a.target, n: state.deck.length, trigger: t.trigger, exclude: t.exclude }));
        return;
      }
      schedule(state, check(a.target, { k: 'apply', what: 'tornado', target: a.target, exclude: t.exclude }));
      return;
    }
    case 'tornadoPick': {
      const picks = a.slotIds || [];
      if (picks.length !== spec.n || picks.some((x) => !spec.options.includes(x)) || new Set(picks).size !== picks.length) fail('bad picks');
      APPLY.tornado(state, { target: t.target, only: picks, exclude: t.exclude });
      return;
    }
    case 'choose': {
      if (!spec.options.includes(a.option)) fail('bad option');
      emit(state, { type: 'chose', to: 'all', pid: exec, option: a.option });
      const base = { ...t, k: 'exec', name: 'choose' };
      if (a.option === 'peek') {
        const top = state.deck[state.deck.length - 1];
        if (top) emit(state, { type: 'reveal', to: [exec], dur: REVEAL_MS, items: [{ deckTop: true, card: nameOf(state, top) }] });
        emit(state, { type: 'peekedDeck', to: 'all', pid: exec });
        state.lastActivated = 'choose';
        return;
      }
      if (a.option === 'shuffle' || a.option === 'skip') {
        const opts = targetablePlayers(state, (p) => a.option === 'shuffle' ? p.slots.some(touchable) : p.id !== exec && state.banana !== p.id);
        if (!opts.length) return;
        return pendTarget(state, { ...base, step: 'choose_' + a.option }, { type: 'player', options: opts });
      }
      if (a.option === 'observe') {
        const groups = {};
        for (const p of state.players) {
          if (p.finished) continue;
          const ok = p.slots.filter(touchable).map((s) => s.id);
          if (ok.length) groups[p.id] = ok;
        }
        if (!Object.keys(groups).length) return;
        return pendTarget(state, { ...base, step: 'observe' }, { type: 'observe', groups });
      }
      if (a.option === 'activate') {
        // Safety cap: chains of choose→activate→choose can't go on forever.
        state.turnCtx.activations = (state.turnCtx.activations || 0) + 1;
        if (state.turnCtx.activations > 8) return;
        const opts = eligibleOwn(state, exec, t.exclude).map((s) => s.id);
        if (!opts.length) return;
        return pendTarget(state, { ...base, step: 'activate' }, { type: 'ownSlot', options: opts });
      }
      return;
    }
    case 'choose_shuffle': case 'choose_skip': {
      if (!spec.options.includes(a.target)) fail('bad target');
      schedule(state, check(a.target, { k: 'apply', what: t.step === 'choose_shuffle' ? 'shuffle' : 'skip', target: a.target }));
      return;
    }
    case 'observe': {
      const picks = [];
      for (const [pid, opts] of Object.entries(spec.groups)) {
        const sid = a.picks && a.picks[pid];
        if (!opts.includes(sid)) fail('observe needs one card per player');
        picks.push({ pid, slotId: sid });
      }
      // Each other player may guard his own card; then the executor sees what's left.
      const tasks = [];
      const kept = [];
      for (const pk of picks) {
        if (pk.pid === exec) { kept.push(pk); continue; }
        kept.push(pk);
        tasks.push({ k: 'guardCheck', target: pk.pid, exec, card: 'choose', trigger: t.trigger, observeSlot: pk.slotId, then: { k: 'noop' } });
      }
      const holder = { k: 'observeReveal', exec, picks: kept };
      schedule(state, ...tasks, holder);
      return;
    }
    case 'activate': {
      if (!spec.options.includes(a.slotId)) fail('bad slot');
      const f = findSlot(state, a.slotId);
      reveal(state, 'all', [f]);
      const cname = nameOf(state, f.s.card);
      if (isCmd(cname)) {
        const cmdCard = f.s.card;
        takeFromDiscard(state, t.trigger); // the choose card moves into the slot
        f.s.card = t.trigger;
        f.s.locked = true; // the choose card can't be touched for the rest of this turn
        state.discard.push(cmdCard);
        emit(state, { type: 'activated', to: 'all', pid: exec, card: cname, slotId: f.s.id });
        schedule(state, { k: 'exec', name: cname, exec, trigger: cmdCard, exclude: f.s.id });
      } else {
        const under = cardUnder(state, t.trigger);
        emit(state, { type: 'activateFailed', to: 'all', pid: exec });
        if (under) {
          takeFromDiscard(state, under);
          const ns = giveCard(state, f.p, under);
          emit(state, { type: 'gave', to: 'all', pid: f.p.id, slotId: ns.id, card: nameOf(state, under), penalty: true });
        }
        state.lastActivated = 'choose';
      }
      return;
    }
    default:
      fail('unknown step ' + t.step);
  }
}


// ---------------------------------------------------------------- actions
// act(state, pid, action) — validates and applies one player decision.
export function act(state, pid, a) {
  const pend = state.pending;
  const stackLen = state.stack.length;
  try {
    return actInner(state, pid, a, pend);
  } catch (e) {
    // Validation failures must leave the game exactly where it was.
    if (e instanceof RuleError && !state.pending) { state.pending = pend; state.stack.length = Math.min(state.stack.length, stackLen); }
    throw e;
  }
}

function actInner(state, pid, a, pend) {
  if (!pend) fail('nothing pending');
  const isFor = pend.pid === pid || (pend.pids && pend.pids.includes(pid));
  if (!isFor) fail('not your decision');
  if (a.t === 'timeout') return autoAct(state, pid);

  switch (pend.kind) {
    case 'turn': turnAction(state, pid, a); break;
    case 'hold': holdAction(state, pid, a, pend); break;
    case 'extra': extraAction(state, pid, a, pend); break;
    case 'target': state.pending = null; try { resolveTarget(state, pend, a); } catch (e) { state.pending = pend; throw e; } break;
    case 'guard': guardAction(state, pid, a, pend); break;
    case 'delegate': {
      if (!pend.pids.includes(a.who)) fail('bad delegate');
      pend.answers[pid] = a.who;
      if (Object.keys(pend.answers).length < 2) return state; // wait for the other
      const [x, y] = pend.pids.map((q) => pend.answers[q]);
      const who = x === y ? x : pend.owner;
      state.pending = null;
      emit(state, { type: 'delegated', to: 'all', owner: pend.owner, exec: who });
      schedule(state, { k: 'exec', name: pend.card, exec: who, trigger: pend.trigger });
      break;
    }
    case 'snapWindow': {
      state.pending = null;
      if (a.t === 'pass') break;
      if (a.t !== 'snap') fail('bad action');
      const ok = doSnap(state, pid, a.slotId);
      if (ok) {
        const other = player(state, pend.other);
        if (!hasNoCards(other)) schedule(state, { k: 'snapWindow', pid: other.id, other: pid });
      }
      break;
    }
    case 'roundOver':
      state.pending = null;
      if (state.over) return state;
      startRound(state);
      break;
    case 'ready': {
      pend.answers[pid] = true;
      emit(state, { type: 'ready', to: 'all', pid });
      if (pend.pids.some((q) => !pend.answers[q])) return state;
      state.pending = null;
      startPlay(state);
      break;
    }
    default:
      fail('bad pending');
  }
  run(state);
  return state;
}

function turnAction(state, pid, a) {
  const p = player(state, pid);
  switch (a.t) {
    case 'draw': {
      const c = drawCard(state);
      if (!c) { state.pending = null; schedule(state, { k: 'roundEnd' }); return; }
      state.limbo.push(c);
      emit(state, { type: 'drew', to: [pid], card: nameOf(state, c), cardId: c });
      emit(state, { type: 'drewHidden', to: 'all', pid, n: 1 });
      state.pending = { kind: 'hold', pid, card: c, name: nameOf(state, c), from: 'deck' };
      return;
    }
    case 'take': {
      const top = topDiscard(state);
      if (!top) fail('discard empty');
      if (isCmd(nameOf(state, top))) fail('cannot take a command card');
      state.discard.pop();
      state.limbo.push(top);
      emit(state, { type: 'took', to: 'all', pid, card: nameOf(state, top) });
      state.pending = { kind: 'hold', pid, card: top, name: nameOf(state, top), from: 'discard' };
      return;
    }
    case 'snap': {
      if (!state.discard.length) fail('nothing to snap on');
      state.pending = null;
      doSnap(state, pid, a.slotId);
      schedule(state, { k: 'endTurn', pid });
      return;
    }
    case 'guardRemove': {
      // Use a guard from your own cards, in your turn, to take one plus (or a
      // freeze) off one of your own slots. It is your whole turn.
      const target = p.slots.find((x) => x.id === a.targetSlot);
      const gs = p.slots.find((x) => x.id === a.guardSlot);
      if (!target || !gs) fail('bad slot');
      if (a.what === 'plus' ? !(target.plus > 0) : a.what === 'freeze' ? !target.freeze : true) fail('nothing to remove');
      if (!gs.card || gs.freeze || gs.locked) fail('bad guard slot');
      state.pending = null;
      const name = nameOf(state, gs.card);
      emit(state, { type: 'reveal', to: 'all', dur: REVEAL_MS, items: [{ owner: pid, slotId: gs.id, card: name }] });
      if (name === 'guard') {
        const mk = a.what === 'plus' ? target.plusCards[target.plusCards.length - 1] : target.freeze.card;
        emit(state, { type: 'markerOff', to: 'all', slotId: target.id, card: nameOf(state, mk) });
        if (a.what === 'plus') { state.discard.push(target.plusCards.pop()); target.plus--; }
        else { state.discard.push(target.freeze.card); target.freeze = null; }
        state.discard.push(removeCardFromSlot(p, gs));
        if (target.plus === 0 && !target.card && p.slots.includes(target)) p.slots.splice(p.slots.indexOf(target), 1);
        emit(state, { type: 'guardUsed', to: 'all', pid, ok: true, what: a.what, slotId: target.id, guardSlot: gs.id });
      } else {
        const top = state.discard.length ? state.discard.pop() : null;
        let ns = null;
        if (top) ns = giveCard(state, p, top);
        emit(state, { type: 'guardUsed', to: 'all', pid, ok: false, what: a.what, slotId: target.id, guardSlot: gs.id, newSlot: ns && ns.id, penalty: top && nameOf(state, top) });
      }
      schedule(state, { k: 'endTurn', pid });
      return;
    }
    case 'banana': {
      if (state.mode !== 'solo') fail('no banana in team mode');
      if (state.banana) fail('banana already called');
      if (p.turnsPlayed < 3) fail('banana needs 3 played turns');
      state.pending = null;
      state.banana = pid;
      const i = pidx(state, pid), n = state.players.length;
      state.finalQueue = [];
      for (let d = 1; d < n; d++) state.finalQueue.push(state.players[(i + d) % n].id);
      emit(state, { type: 'banana', to: 'all', pid });
      schedule(state, { k: 'endTurn', pid });
      return;
    }
    default: fail('bad turn action');
  }
}

function keepCard(state, p, slotId, cardId, from = 'deck') {
  const s = p.slots.find((x) => x.id === slotId);
  if (!s || s.freeze || s.locked) fail('bad slot');
  state.limbo.splice(state.limbo.indexOf(cardId), 1);
  const old = s.card;
  s.card = cardId;
  if (old) {
    state.discard.push(old);
    emit(state, { type: 'discarded', to: 'all', pid: p.id, card: nameOf(state, old), slotId, replaced: true, from });
  } else {
    emit(state, { type: 'filled', to: 'all', pid: p.id, slotId, from });
  }
}

// Team mode: whenever a new card lands on the floor during your turn, your
// partner may snap on it right away — before any power on it is played.
function mateSnap(state, pid) {
  if (state.mode !== 'team') return null;
  const mate = partnerOf(state, pid);
  if (!mate || hasNoCards(mate) || !state.discard.length) return null;
  return { k: 'snapWindow', pid: mate.id, other: pid, offer: topDiscard(state) };
}

function throwCard(state, p, cardId, withEffect) {
  state.limbo.splice(state.limbo.indexOf(cardId), 1);
  state.discard.push(cardId);
  const name = nameOf(state, cardId);
  emit(state, { type: 'discarded', to: 'all', pid: p.id, card: name, from: 'deck' });
  if (withEffect && hasEffect(name)) return { k: 'effect', owner: p.id, trigger: cardId };
  return null;
}

function holdAction(state, pid, a, pend) {
  const p = player(state, pid);
  if (a.t === 'keep') {
    state.pending = null;
    try { keepCard(state, p, a.slotId, pend.card, pend.from); } catch (e) { state.pending = pend; throw e; }
    schedule(state, { k: 'endTurn', pid });
  } else if (a.t === 'throw') {
    if (pend.from !== 'deck') fail('a card taken from the floor must be kept');
    state.pending = null;
    const eff = throwCard(state, p, pend.card, true);
    schedule(state, mateSnap(state, pid), eff, { k: 'endTurn', pid });
  } else if (a.t === 'throwGuard') {
    // Refuse your own drawn command: throw it and show a Guard from your cards.
    // Right guard: command cancelled, guard goes to the floor too.
    // Wrong card: you take the card under the command, and the command still runs.
    if (pend.from !== 'deck') fail('a card taken from the floor must be kept');
    const cname = nameOf(state, pend.card);
    if (CARD_DEFS[cname].kind !== 'cmd' || cname === 'guard') fail('only a command can be refused');
    const gs = p.slots.find((x) => x.id === a.slotId);
    if (!gs || !gs.card || gs.freeze || gs.locked) fail('bad slot');
    state.pending = null;
    throwCard(state, p, pend.card, false);
    const gname = nameOf(state, gs.card);
    emit(state, { type: 'reveal', to: 'all', dur: REVEAL_MS, items: [{ owner: pid, slotId: gs.id, card: gname }] });
    if (gname === 'guard') {
      state.discard.push(removeCardFromSlot(p, gs));
      emit(state, { type: 'guarded', to: 'all', pid, card: cname, ok: true, self: true, slotId: gs.id });
      schedule(state, { k: 'endTurn', pid });
      return;
    }
    emit(state, { type: 'guarded', to: 'all', pid, card: cname, ok: false, self: true });
    const under = cardUnder(state, pend.card);
    if (under) {
      takeFromDiscard(state, under);
      const ns = giveCard(state, p, under);
      emit(state, { type: 'gave', to: 'all', pid, slotId: ns.id, card: nameOf(state, under), penalty: true });
    }
    schedule(state, { k: 'effect', owner: pid, trigger: pend.card }, { k: 'endTurn', pid });
  } else fail('bad hold action');
}

function extraAction(state, pid, a, pend) {
  const p = player(state, pid);
  const ctx = pend.ctx;
  if (a.t === 'keep' || a.t === 'throw') {
    const cardId = ctx.cards[a.i];
    if (!cardId) fail('bad card');
    state.pending = null;
    const rest = ctx.cards.filter((_, k) => k !== a.i);
    if (a.t === 'keep') {
      try { keepCard(state, p, a.slotId, cardId); } catch (e) { state.pending = pend; throw e; }
      schedule(state, mateSnap(state, pid), { k: 'extraContinue', pid, ctx: { ...ctx, cards: rest } });
    } else {
      const eff = throwCard(state, p, cardId, true);
      // A thrown effect resolves first (a thrown "extra" opens its own 2-card hand).
      schedule(state, mateSnap(state, pid), eff, { k: 'extraContinue', pid, ctx: { ...ctx, cards: rest } });
    }
    return;
  }
  if (a.t === 'snap') {
    if (ctx.snaps >= 2) fail('no more snaps');
    state.pending = null;
    const ok = doSnap(state, pid, a.slotId);
    if (ok) {
      schedule(state, { k: 'extraContinue', pid, ctx: { ...ctx, snaps: ctx.snaps + 1 } });
    } else {
      // Wrong snap ends the turn: every remaining drawn card (also from an
      // outer extra) is thrown without effect.
      for (const c of ctx.cards) throwCard(state, p, c, false);
      dropExtraTasks(state, p);
    }
    return;
  }
  fail('bad extra action');
}

function dropExtraTasks(state, p) {
  for (const x of state.stack.filter((x) => x.k === 'extraContinue' && x.pid === p.id)) {
    for (const c of x.ctx.cards) throwCard(state, p, c, false);
  }
  state.stack = state.stack.filter((x) => !(x.k === 'extraContinue' && x.pid === p.id));
}

// Returns true when the snap matched.
function doSnap(state, pid, slotId) {
  const p = player(state, pid);
  const s = p.slots.find((x) => x.id === slotId);
  if (!s || !s.card || s.freeze || s.locked) fail('bad slot');
  const top = topDiscard(state);
  if (!top) fail('nothing to snap on');
  const mine = nameOf(state, s.card), want = nameOf(state, top);
  if (mine === want) {
    state.discard.push(removeCardFromSlot(p, s));
    emit(state, { type: 'snap', to: 'all', pid, card: mine, ok: true, slotId });
    return true;
  }
  emit(state, { type: 'reveal', to: 'all', dur: REVEAL_MS, items: [{ owner: pid, slotId, card: mine }] });
  // Penalty is the floor card. But if that card is a power still waiting to be
  // played, it stays (the power runs as usual) and the card under it is taken.
  const waiting = state.stack.some((x) => x.k === 'effect' && x.trigger === top);
  const i = waiting ? state.discard.length - 2 : state.discard.length - 1;
  if (i < 0) { emit(state, { type: 'snap', to: 'all', pid, card: mine, ok: false, slotId, penalty: null }); return false; }
  const pen = state.discard.splice(i, 1)[0];
  const ns = giveCard(state, p, pen);
  emit(state, { type: 'snap', to: 'all', pid, card: mine, ok: false, slotId, penalty: nameOf(state, pen), newSlot: ns.id, under: waiting });
  return false;
}

function guardAction(state, pid, a, pend) {
  const t = pend.task;
  const p = player(state, pid);
  state.pending = null;
  if (a.t === 'noGuard') { schedule(state, t.then); return; }
  if (a.t !== 'guard') { state.pending = pend; fail('bad guard action'); }
  const s = p.slots.find((x) => x.id === a.slotId);
  if (!s || !s.card || s.freeze || s.locked) { state.pending = pend; fail('bad slot'); }
  const name = nameOf(state, s.card);
  emit(state, { type: 'reveal', to: 'all', dur: REVEAL_MS, items: [{ owner: pid, slotId: s.id, card: name }] });
  if (name === 'guard') {
    state.discard.push(removeCardFromSlot(p, s));
    emit(state, { type: 'guarded', to: 'all', pid, card: t.card, ok: true });
    // Blocked: the command does not happen (for observe only this player's peek).
    if (t.observeSlot) {
      const holder = state.stack.find((x) => x.k === 'observeReveal');
      if (holder) holder.picks = holder.picks.filter((x) => x.slotId !== t.observeSlot);
    }
    return;
  }
  emit(state, { type: 'guarded', to: 'all', pid, card: t.card, ok: false });
  const under = cardUnder(state, t.trigger);
  if (under) {
    takeFromDiscard(state, under);
    const ns = giveCard(state, p, under);
    emit(state, { type: 'gave', to: 'all', pid, slotId: ns.id, card: nameOf(state, under), penalty: true });
  }
  schedule(state, t.then);
}

// ---------------------------------------------------------------- timeouts
// Default decision when the timer runs out (also used for disconnected seats
// before a bot takes over).
export function autoAct(state, pid) {
  const pend = state.pending;
  const pick = (arr) => arr[rint(state, arr.length)];
  switch (pend.kind) {
    case 'turn': {
      const c = drawCard(state);
      state.pending = null;
      if (!c) { schedule(state, { k: 'roundEnd' }); break; }
      state.discard.push(c);
      emit(state, { type: 'discarded', to: 'all', pid, card: nameOf(state, c), timeout: true, from: 'deck' });
      schedule(state, { k: 'endTurn', pid });
      break;
    }
    case 'hold': {
      const p = player(state, pid);
      if (pend.from === 'deck') {
        state.pending = null;
        throwCard(state, p, pend.card, false);
        schedule(state, { k: 'endTurn', pid });
        break;
      }
      return act(state, pid, { t: 'keep', slotId: pick(p.slots.filter((s) => !s.freeze)).id });
    }
    case 'extra': {
      const p = player(state, pid);
      state.pending = null;
      for (const c of pend.ctx.cards) throwCard(state, p, c, false);
      dropExtraTasks(state, p);
      break;
    }
    case 'target': return act(state, pid, randomTarget(state, pend.spec, pick));
    case 'guard': return act(state, pid, { t: 'noGuard' });
    case 'delegate': {
      for (const q of pend.pids) if (!(q in pend.answers)) pend.answers[q] = pend.owner;
      return act(state, pid, { t: 'delegate', who: pend.owner });
    }
    case 'snapWindow': return act(state, pid, { t: 'pass' });
    case 'roundOver': return act(state, pid, { t: 'next' });
    case 'ready': return act(state, pid, { t: 'ready' });
    default: fail('bad pending');
  }
  run(state);
  return state;
}

export function randomTarget(state, spec, pick) {
  switch (spec.type) {
    case 'ownSlot': case 'slot': return { slotId: pick(spec.options) };
    case 'player': return { target: pick(spec.options) };
    case 'clear': { const o = pick(spec.options); return { slotId: o.slotId, what: o.what }; }
    case 'swap': return { mine: pick(spec.mine), theirs: pick(spec.theirs) };
    case 'option': return { option: pick(spec.options) };
    case 'observe': { const picks = {}; for (const [pid, o] of Object.entries(spec.groups)) picks[pid] = pick(o); return { picks }; }
    case 'multiSlot': return { slotIds: spec.options.slice(0, spec.n) };
    default: fail('bad spec');
  }
}

// ---------------------------------------------------------------- scoring
export function slotValue(state, s) {
  return (s.card ? CARD_DEFS[nameOf(state, s.card)].value : 0) + 5 * s.plus;
}
export function handValue(state, p) {
  return p.slots.reduce((a, s) => a + slotValue(state, s), 0);
}

function roundEnd(state) {
  state.pending = null;
  // Cards still "in hand" (extra) at round end go back to the discard.
  state.discard.push(...state.limbo.splice(0));
  const sums = state.players.map((p) => handValue(state, p));
  const mult = roundType(state) === 'double' ? 2 : 1;
  let unit; // per side (player in solo, team in team)
  if (state.mode === 'team') {
    unit = [0, 1].map((tm) => state.players.filter((p) => p.team === tm).reduce((a, p) => a + handValue(state, p), 0));
  } else unit = sums.slice();
  const anyZero = unit.some((v) => v <= 0);
  const min = Math.min(...unit);
  const wins = unit.map((v) => (anyZero ? v <= 0 : v === min));
  const scores = unit.map((v, i) => (wins[i] ? 0 : v * mult));
  const detail = state.players.map((p) => ({
    pid: p.id,
    slots: p.slots.map((s) => ({ card: s.card ? nameOf(state, s.card) : null, plus: s.plus, frozen: !!s.freeze })),
    sum: handValue(state, p),
  }));
  if (state.mode === 'team') {
    for (const p of state.players) p.roundScores.push(scores[p.team]);
    state.teamTotals = state.teamTotals || [0, 0];
    state.teamTotals[0] += scores[0]; state.teamTotals[1] += scores[1];
    for (const p of state.players) p.total = state.teamTotals[p.team];
  } else {
    state.players.forEach((p, i) => { p.roundScores.push(scores[i]); p.total += scores[i]; });
  }
  emit(state, { type: 'roundEnd', to: 'all', round: state.round, tiebreak: state.tiebreak, detail, unit, scores, wins, mult });

  const finished = state.round >= ROUNDS;
  if (finished) {
    const totals = state.mode === 'team' ? state.teamTotals : state.players.map((p) => p.total);
    const best = Math.min(...totals);
    const leaders = totals.map((v, i) => i).filter((i) => totals[i] === best);
    if (leaders.length === 1) {
      state.over = true;
      state.winners = state.mode === 'team'
        ? state.players.filter((p) => p.team === leaders[0]).map((p) => p.id)
        : [state.players[leaders[0]].id];
      emit(state, { type: 'gameOver', to: 'all', winners: state.winners, totals });
      state.pending = { kind: 'gameOver' };
      return;
    }
    state.tiebreak++;
  }
  // Host (seat 0) moves everyone to the next round.
  state.pending = { kind: 'roundOver', pid: state.players[0].id };
}

// ---------------------------------------------------------------- views
// What one player is allowed to know. Never send full state to clients.
export function viewFor(state, pid) {
  const pend = state.pending;
  let myPending = null;
  if (pend && (pend.pid === pid || (pend.pids && pend.pids.includes(pid)))) {
    myPending = { ...pend };
    if (pend.task) myPending.step = pend.task.step;
    if (pend.ctx) myPending.snapsLeft = 2 - pend.ctx.snaps;
    delete myPending.task; delete myPending.ctx;
    if (pend.kind === 'extra') myPending.cards = pend.cards;
    if (pend.answers && pend.answers[pid]) myPending.answered = true;
    delete myPending.answers;
  }
  const top = topDiscard(state);
  return {
    mode: state.mode, me: pid, round: state.round, roundType: roundType(state), tiebreak: state.tiebreak,
    current: state.current, banana: state.banana, over: state.over, winners: state.winners,
    deckCount: state.deck.length,
    discardTop: top ? nameOf(state, top) : null,
    discardCount: state.discard.length,
    lastActivated: state.lastActivated,
    players: state.players.map((p) => ({
      id: p.id, name: p.name, av: p.av || null, team: p.team, bot: !!p.bot, total: p.total, roundScores: p.roundScores,
      turnsPlayed: p.turnsPlayed, finished: !!p.finished, skipNext: p.skipNext,
      slots: p.slots.map((s) => ({ id: s.id, has: !!s.card, plus: s.plus, frozen: s.freeze ? s.freeze.left : 0, locked: !!s.locked,
        markers: s.plusCards.map((c) => nameOf(state, c)), freezeCard: s.freeze ? nameOf(state, s.freeze.card) : null })),
    })),
    teamTotals: state.teamTotals || null,
    pending: myPending,
    waitingOn: pend ? (pend.pids ? pend.pids.filter((q) => !(pend.answers && q in pend.answers)) : pend.pid ? [pend.pid] : []) : [],
    waitingKind: pend ? pend.kind : null,
    holding: pend && (pend.kind === 'hold' || pend.kind === 'extra') ? { pid: pend.pid, from: pend.from || 'deck', n: pend.kind === 'extra' ? pend.cards.length : 1 } : null,
    readyDone: pend && pend.kind === 'ready' ? Object.keys(pend.answers) : null,
  };
}

export function eventsFor(state, pid, sinceSeq = 0) {
  return state.events.filter((e) => e.seq > sinceSeq && (e.to === 'all' || e.to.includes(pid)));
}

// Every card must be in exactly one place. Used by tests.
export function checkInvariants(state) {
  const seen = new Map();
  const add = (c, where) => {
    if (!c) return;
    if (seen.has(c)) throw new Error(`card ${c} in ${where} and ${seen.get(c)}`);
    seen.set(c, where);
  };
  state.deck.forEach((c) => add(c, 'deck'));
  state.discard.forEach((c) => add(c, 'discard'));
  state.limbo.forEach((c) => add(c, 'limbo'));
  for (const p of state.players) for (const s of p.slots) {
    add(s.card, 'slot ' + s.id);
    s.plusCards.forEach((c) => add(c, 'plus ' + s.id));
    if (s.freeze) add(s.freeze.card, 'freeze ' + s.id);
    if (s.plus !== s.plusCards.length) throw new Error('plus count mismatch');
    if (!s.card && s.plus === 0) throw new Error('empty slot without plus ' + s.id);
    if (s.freeze && !s.card) throw new Error('frozen empty slot');
  }
  if (seen.size !== state.totalCards) throw new Error(`card count ${seen.size} != ${state.totalCards}`);
}

// Test hooks (not used by the app).
export const __test = { beginTurn, giveCard, player };
