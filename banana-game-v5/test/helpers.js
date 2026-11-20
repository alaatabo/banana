import { createGame, act, nameOf, __test, checkInvariants } from '../src/engine.js';

// Build a game in an exact position.
// hands: { p0: ['n5','swap',...], ... } (slot order = index 0 is right-most)
// deckTop: cards drawn next, first element drawn first.
// discard: bottom..top
export function setup({ mode = 'solo', n = 4, hands = {}, deckTop = [], discard = [], current = 'p0', round = 1, turnsPlayed = 0 }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const st = createGame({ mode, players, seed: 42 });
  const pool = {};
  for (const [id, name] of Object.entries(st.cards)) (pool[name] ||= []).push(id);
  const take = (name) => {
    const id = pool[name]?.pop();
    if (!id) throw new Error('no more ' + name);
    return id;
  };
  st.round = round;
  st.events = [];
  st.stack = [];
  st.limbo = [];
  st.lastActivated = null;
  st.slotSeq = 100;
  for (const p of st.players) {
    p.slots = [];
    p.turnsPlayed = turnsPlayed;
    for (const name of hands[p.id] || []) __test.giveCard(st, p, take(name));
  }
  st.discard = discard.map(take);
  const top = deckTop.map(take);
  // Players without a given hand get 4 plain high cards (no effects).
  const fillers = ['n25', 'n4', 'n3', 'n2', 'n1', 'n25'];
  for (const p of st.players) {
    if (hands[p.id]) continue;
    while (p.slots.length < 4) {
      const name = fillers.find((f) => pool[f] && pool[f].length);
      __test.giveCard(st, p, take(name));
    }
  }
  const rest = Object.values(pool).flat();
  st.deck = [...rest, ...top.reverse()];
  st.pending = null;
  __test.beginTurn(st, __test.player(st, current));
  checkInvariants(st);
  return st;
}

export const names = (st, pid) => st.players.find((p) => p.id === pid).slots.map((s) => (s.card ? nameOf(st, s.card) : null));
export const slots = (st, pid) => st.players.find((p) => p.id === pid).slots;
export const P = (st, pid) => st.players.find((p) => p.id === pid);
export const top = (st) => nameOf(st, st.discard[st.discard.length - 1]);
export const ev = (st, type) => st.events.filter((e) => e.type === type);
export { act };
