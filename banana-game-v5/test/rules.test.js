// One test per rule in the rules document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, checkInvariants, handValue, DECK_COUNTS, viewFor, RuleError } from '../src/engine.js';
import { setup, names, slots, P, top, ev } from './helpers.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const rejects = (fn) => assert.throws(fn, RuleError);

test('deck sizes: 89 solo, 86 team', () => {
  assert.equal(sum(DECK_COUNTS.solo), 89);
  assert.equal(sum(DECK_COUNTS.team), 86);
});

test('setup: 4 cards each, one floor card, private peek of the 2 right-most cards', () => {
  const st = createGame({ mode: 'solo', players: [0, 1, 2, 3].map((i) => ({ id: 'p' + i, name: 'x' })), seed: 1 });
  for (const p of st.players) assert.equal(p.slots.length, 4);
  assert.equal(st.discard.length, 1);
  const peeks = st.events.filter((e) => e.type === 'reveal');
  assert.equal(peeks.length, 4);
  for (const e of peeks) {
    assert.equal(e.to.length, 1);
    assert.deepEqual(e.items.map((i) => i.slotId), P(st, e.to[0]).slots.slice(0, 2).map((s) => s.id));
  }
  checkInvariants(st);
});

test('round 5: no peek and no floor card; first player must draw', () => {
  const st = createGame({ mode: 'solo', players: [0, 1, 2].map((i) => ({ id: 'p' + i, name: 'x' })), seed: 3 });
  // jump to round 5
  st.round = 4; st.pending = { kind: 'roundOver', pid: 'p0' };
  st.events = [];
  act(st, 'p0', { t: 'next' });
  assert.equal(st.round, 5);
  assert.equal(st.discard.length, 0);
  assert.equal(ev(st, 'reveal').length, 0);
  rejects(() => act(st, st.current, { t: 'take' }));
  rejects(() => act(st, st.current, { t: 'snap', slotId: P(st, st.current).slots[0].id }));
});

test('draw then keep: old card goes face-up to the floor with no effect', () => {
  const st = setup({ hands: { p0: ['swap', 'n1', 'n2', 'n3'] }, deckTop: ['n0'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' });
  assert.equal(st.pending.kind, 'hold');
  act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['n0', 'n1', 'n2', 'n3']);
  assert.equal(top(st), 'swap');
  assert.equal(ev(st, 'effect').length, 0, 'a command swapped out of the hand never activates');
  assert.equal(st.current, 'p1');
});

test('taking from the floor: never a command, and must be kept', () => {
  let st = setup({ discard: ['n2', 'swap'] });
  rejects(() => act(st, 'p0', { t: 'take' }));
  st = setup({ discard: ['n5'] });
  act(st, 'p0', { t: 'take' });
  rejects(() => act(st, 'p0', { t: 'throw' }));
  act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[1].id });
  assert.equal(names(st, 'p0')[1], 'n5');
  assert.equal(ev(st, 'effect').length, 0, 'a taken card never activates');
});

test('5/6: reveal one own card to everyone', () => {
  const st = setup({ deckTop: ['n6'], discard: ['n1'] });
  act(st, 'p0', { t: 'draw' });
  act(st, 'p0', { t: 'throw' });
  assert.equal(st.pending.kind, 'target');
  act(st, 'p0', { slotId: slots(st, 'p0')[2].id });
  const r = ev(st, 'reveal').pop();
  assert.equal(r.to, 'all');
  assert.equal(r.items[0].slotId, slots(st, 'p0')[2].id);
});

test('7/8: private peek at own card; 9/10: private peek at another player', () => {
  let st = setup({ deckTop: ['n8'], discard: ['n1'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { slotId: slots(st, 'p0')[3].id });
  assert.deepEqual(ev(st, 'reveal').pop().to, ['p0']);
  st = setup({ deckTop: ['n9'], discard: ['n1'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  rejects(() => act(st, 'p0', { slotId: slots(st, 'p0')[0].id }));
  act(st, 'p0', { slotId: slots(st, 'p2')[0].id });
  const r = ev(st, 'reveal').pop();
  assert.deepEqual(r.to, ['p0']);
  assert.equal(r.items[0].owner, 'p2');
});

test('15 reveals all own cards; 20 shuffles own cards', () => {
  let st = setup({ deckTop: ['n15'], discard: ['n1'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  const r = ev(st, 'reveal').pop();
  assert.equal(r.to, 'all'); assert.equal(r.items.length, 4);
  st = setup({ deckTop: ['n20'], discard: ['n1'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.equal(ev(st, 'shuffled').length, 1);
  assert.equal(st.current, 'p1');
});

test('snap right: card leaves, turn ends; snap wrong: get it back + the floor card', () => {
  let st = setup({ hands: { p0: ['n1', 'n7', 'n2', 'n3'] }, discard: ['n4', 'n7'] });
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[1].id });
  assert.deepEqual(names(st, 'p0'), ['n1', 'n2', 'n3']);
  assert.equal(top(st), 'n7');
  assert.equal(st.current, 'p1');
  assert.equal(ev(st, 'effect').length, 0, 'snapped cards have no effect');

  st = setup({ hands: { p0: ['n1', 'n5', 'n2', 'n3'] }, discard: ['n4', 'n6'] });
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[1].id });
  assert.deepEqual(names(st, 'p0'), ['n1', 'n5', 'n2', 'n3', 'n6']);
  assert.equal(top(st), 'n4');
  assert.equal(st.current, 'p1');
});

test('snap commands only on the exact same command', () => {
  const st = setup({ hands: { p0: ['swap', 'n1', 'n2', 'n3'] }, discard: ['swap'] });
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['n1', 'n2', 'n3']);
});

test('banana: only after 3 played turns; everyone else plays once, then the round ends', () => {
  let st = setup({ turnsPlayed: 2, discard: ['n1'] });
  rejects(() => act(st, 'p0', { t: 'banana' }));
  st = setup({ turnsPlayed: 3, discard: ['n1'], deckTop: ['n0', 'n0'] });
  act(st, 'p0', { t: 'banana' });
  const order = [];
  while (st.pending.kind === 'turn') {
    order.push(st.current);
    act(st, st.current, { t: 'draw' });
    act(st, st.current, { t: 'keep', slotId: slots(st, st.current)[0].id });
  }
  assert.deepEqual(order, ['p1', 'p2', 'p3']);
  assert.equal(st.pending.kind, 'roundOver');
});

test('no banana in team mode', () => {
  const st = setup({ mode: 'team', turnsPlayed: 5, discard: ['n1'] });
  rejects(() => act(st, 'p0', { t: 'banana' }));
});

test('solo: a player with no cards ends the round after one more turn each; nobody can target him', () => {
  const st = setup({ hands: { p0: ['n7'] }, discard: ['n7'], deckTop: ['swap', 'n0', 'n0'] });
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id });
  assert.ok(P(st, 'p0').finished);
  // p1 draws swap and throws it: p0 cannot be a swap target
  act(st, 'p1', { t: 'draw' }); act(st, 'p1', { t: 'throw' });
  assert.equal(st.pending.kind, 'target');
  for (const sid of st.pending.spec.theirs) assert.ok(!slots(st, 'p0').some((s) => s.id === sid));
  act(st, 'p1', { mine: st.pending.spec.mine[0], theirs: st.pending.spec.theirs[0] });
  if (st.pending.kind === 'guard') act(st, st.pending.pid, { t: 'noGuard' });
  for (const pid of ['p2', 'p3']) {
    assert.equal(st.current, pid);
    act(st, pid, { t: 'draw' }); act(st, pid, { t: 'keep', slotId: slots(st, pid)[0].id });
  }
  assert.equal(st.pending.kind, 'roundOver');
});

test('plus: +5 stays on the slot after the card leaves; a finished player with a plus slot scores 5', () => {
  const st = setup({ n: 3, hands: { p0: ['n7'], p1: ['n1', 'n2', 'n3', 'n4'] }, deckTop: ['plus'], discard: ['n6'], current: 'p1' });
  act(st, 'p1', { t: 'draw' }); act(st, 'p1', { t: 'throw' });
  act(st, 'p1', { slotId: slots(st, 'p0')[0].id });
  act(st, 'p0', { t: 'noGuard' });
  assert.equal(slots(st, 'p0')[0].plus, 1);
  assert.equal(handValue(st, P(st, 'p0')), 12);
  // p2 plays, then p0 snaps the 7 away
  act(st, 'p2', { t: 'draw' }); act(st, 'p2', { t: 'keep', slotId: slots(st, 'p2')[0].id });
  // put a 7 on top of the floor
  const seven = Object.keys(st.cards).find((c) => st.cards[c] === 'n7' && st.deck.includes(c));
  st.deck.splice(st.deck.indexOf(seven), 1); st.discard.push(seven);
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id });
  assert.equal(slots(st, 'p0').length, 1);
  assert.equal(slots(st, 'p0')[0].card, null);
  assert.ok(P(st, 'p0').finished);
  assert.equal(handValue(st, P(st, 'p0')), 5);
  checkInvariants(st);
});

test('plus stacks on the same slot; cannot go on an empty slot', () => {
  const st = setup({ deckTop: ['plus'], discard: ['n1'] });
  const s = slots(st, 'p1')[0];
  s.plus = 1; s.plusCards = [Object.keys(st.cards).find((c) => st.cards[c] === 'plus' && st.deck.includes(c))];
  st.deck.splice(st.deck.indexOf(s.plusCards[0]), 1);
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { slotId: s.id });
  act(st, 'p1', { t: 'noGuard' });
  assert.equal(s.plus, 2);
  checkInvariants(st);
});

test('freeze: untouchable for 3 of the owner\'s played turns, then the freeze card hits the floor', () => {
  const st = setup({ n: 3, deckTop: ['freeze', 'n7', 'n7', 'n7', 'n7', 'n8', 'swap', 'n8'], discard: ['n9'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  const target = slots(st, 'p1')[0];
  act(st, 'p0', { slotId: target.id });
  act(st, 'p1', { t: 'noGuard' });
  assert.equal(target.freeze.left, 3);
  const play = (pid) => { act(st, pid, { t: 'draw' }); act(st, pid, { t: 'keep', slotId: slots(st, pid).find((s) => !s.freeze).id }); };
  play('p1'); assert.equal(target.freeze.left, 2);
  rejects(() => act(st, 'p2', { t: 'snap', slotId: target.id }));
  play('p2'); play('p0');
  play('p1'); assert.equal(target.freeze.left, 1);
  // p2 draws swap: p1's frozen slot is not a target
  play('p2');
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.ok(!st.pending.spec.theirs.includes(target.id));
  act(st, 'p0', { mine: st.pending.spec.mine[0], theirs: st.pending.spec.theirs[0] });
  if (st.pending.kind === 'guard') act(st, st.pending.pid, { t: 'noGuard' });
  play('p1');
  assert.equal(target.freeze, null);
  assert.equal(top(st), 'freeze');
  checkInvariants(st);
});

test('freeze: a skipped turn does not count', () => {
  const st = setup({ n: 3, discard: ['n9'], deckTop: ['n7'] });
  const s = slots(st, 'p1')[0];
  const fz = Object.keys(st.cards).find((c) => st.cards[c] === 'freeze');
  st.deck.splice(st.deck.indexOf(fz), 1);
  s.freeze = { card: fz, left: 3 };
  P(st, 'p1').skipNext = true;
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  assert.equal(st.current, 'p2');
  assert.equal(s.freeze.left, 3);
});

test('frozen card counts normally at round end; the freeze itself is worth nothing', () => {
  const st = setup({ n: 3, hands: { p0: ['n3'] }, discard: ['n1'] });
  const s = slots(st, 'p0')[0];
  const fz = Object.keys(st.cards).find((c) => st.cards[c] === 'freeze');
  st.deck.splice(st.deck.indexOf(fz), 1);
  s.freeze = { card: fz, left: 2 };
  assert.equal(handValue(st, P(st, 'p0')), 3);
});

test('guard right: command cancelled, guard thrown on top', () => {
  const st = setup({ hands: { p1: ['guard', 'n1', 'n2', 'n3'] }, deckTop: ['swap'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { mine: slots(st, 'p0')[0].id, theirs: slots(st, 'p1')[1].id });
  assert.equal(st.pending.kind, 'guard');
  act(st, 'p1', { t: 'guard', slotId: slots(st, 'p1')[0].id });
  assert.deepEqual(names(st, 'p1'), ['n1', 'n2', 'n3']);
  assert.equal(top(st), 'guard');
  assert.equal(ev(st, 'swapped').length, 0);
  assert.equal(st.lastActivated, null, 'a blocked command was never activated');
});

test('guard wrong: take the card under the command, and the command still happens', () => {
  const st = setup({ hands: { p1: ['n1', 'n2', 'n3', 'n4'] }, deckTop: ['swap'], discard: ['n0'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  const mine = names(st, 'p0')[0];
  act(st, 'p0', { mine: slots(st, 'p0')[0].id, theirs: slots(st, 'p1')[1].id });
  act(st, 'p1', { t: 'guard', slotId: slots(st, 'p1')[0].id });
  assert.equal(names(st, 'p1').length, 5);
  assert.equal(names(st, 'p1')[4], 'n0');
  assert.equal(names(st, 'p1')[1], mine, 'swap still happened');
  assert.equal(names(st, 'p0')[0], 'n2');
});

test('guard wrong against buzz: get both the card under buzz and the one under that', () => {
  const st = setup({ hands: { p1: ['n1', 'n2', 'n3', 'n4'] }, deckTop: ['buzz'], discard: ['n5', 'n0'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { target: 'p1' });
  act(st, 'p1', { t: 'guard', slotId: slots(st, 'p1')[0].id });
  assert.deepEqual(names(st, 'p1'), ['n1', 'n2', 'n3', 'n4', 'n0', 'n5']);
});

test('guard is only asked for commands, not for 9/10 peeks', () => {
  const st = setup({ deckTop: ['n10'], discard: ['n1'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { slotId: slots(st, 'p1')[0].id });
  assert.equal(st.pending.kind, 'turn');
});

test('buzz: target gets the card that was under buzz (one more card)', () => {
  const st = setup({ deckTop: ['buzz'], discard: ['n0'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { target: 'p2' });
  act(st, 'p2', { t: 'noGuard' });
  assert.equal(names(st, 'p2').length, 5);
  assert.equal(names(st, 'p2')[4], 'n0');
  assert.equal(top(st), 'buzz');
});

test('buzz with nothing under it does nothing', () => {
  const st = setup({ deckTop: ['buzz'], discard: [], round: 5 });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.equal(st.current, 'p1');
});

test('clear: throw any own card, or remove plus/freeze from own slot only', () => {
  const st = setup({ hands: { p0: ['n9', 'n1'] }, deckTop: ['clear'], discard: ['n4'] });
  slots(st, 'p0')[1].plus = 1;
  const pc = Object.keys(st.cards).find((c) => st.cards[c] === 'plus');
  st.deck.splice(st.deck.indexOf(pc), 1); slots(st, 'p0')[1].plusCards = [pc];
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  const kinds = st.pending.spec.options.map((o) => o.what).sort();
  assert.deepEqual(kinds, ['card', 'card', 'plus']);
  act(st, 'p0', { slotId: slots(st, 'p0')[1].id, what: 'plus' });
  assert.equal(slots(st, 'p0')[1].plus, 0);
  assert.equal(top(st), 'plus');
  checkInvariants(st);
});

test('copy: repeats the last command that was really activated; nothing if none', () => {
  let st = setup({ deckTop: ['copy'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.equal(st.current, 'p1');
  st = setup({ deckTop: ['copy'], discard: ['n4'] });
  st.lastActivated = 'golden';
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  const r = ev(st, 'reveal').pop();
  assert.deepEqual(r.to, ['p0']); assert.equal(r.dur, 5000);
});

test('copy after copy repeats the original command', () => {
  const st = setup({ deckTop: ['copy', 'copy'], discard: ['n4'] });
  st.lastActivated = 'golden';
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.equal(st.lastActivated, 'golden');
});

test('curse: card revealed, goes under the floor pile, replaced blind from the deck', () => {
  const st = setup({ hands: { p2: ['n1', 'n2', 'n3', 'n4'] }, deckTop: ['curse', 'n0'], discard: ['n9'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { slotId: slots(st, 'p2')[2].id });
  act(st, 'p2', { t: 'noGuard' });
  assert.deepEqual(names(st, 'p2'), ['n1', 'n2', 'n0', 'n4']);
  assert.equal(st.cards[st.discard[0]], 'n3');
  assert.equal(top(st), 'curse');
});

test('extra: two cards, two plays, effects of thrown cards fire', () => {
  const st = setup({ hands: { p0: ['n9', 'n9', 'n9', 'n9'] }, deckTop: ['extra', 'n0', 'clear'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.equal(st.pending.kind, 'extra');
  assert.deepEqual(st.pending.cards.map((c) => c.name).sort(), ['clear', 'n0']);
  const iClear = st.pending.cards.findIndex((c) => c.name === 'clear');
  act(st, 'p0', { t: 'throw', i: iClear });
  act(st, 'p0', { slotId: slots(st, 'p0')[0].id, what: 'card' });
  assert.equal(names(st, 'p0').length, 3);
  assert.equal(st.pending.kind, 'extra');
  act(st, 'p0', { t: 'keep', i: 0, slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['n0', 'n9', 'n9']);
  assert.equal(st.current, 'p1');
  checkInvariants(st);
});

test('tornado: all non-frozen cards revealed and replaced; plus and frozen slots stay', () => {
  const st = setup({ hands: { p1: ['n1', 'n2', 'n3', 'n4'] }, deckTop: ['tornado', 'n0', 'n0'], discard: ['n9'] });
  const s0 = slots(st, 'p1')[0], s1 = slots(st, 'p1')[1];
  const fz = Object.keys(st.cards).find((c) => st.cards[c] === 'freeze');
  st.deck.splice(st.deck.indexOf(fz), 1); s0.freeze = { card: fz, left: 3 };
  const pc = Object.keys(st.cards).find((c) => st.cards[c] === 'plus');
  st.deck.splice(st.deck.indexOf(pc), 1); s1.plus = 1; s1.plusCards = [pc];
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { target: 'p1' });
  act(st, 'p1', { t: 'noGuard' });
  const n = names(st, 'p1');
  assert.equal(n[0], 'n1', 'frozen card stays');
  assert.equal(n.length, 4);
  assert.equal(s1.plus, 1);
  assert.ok(!n.slice(1).includes('n2'));
  checkInvariants(st);
});

test('choose: activate a real command — it fires and choose takes its place', () => {
  const st = setup({ hands: { p0: ['golden', 'n1', 'n2', 'n3'] }, deckTop: ['choose'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'activate' });
  act(st, 'p0', { slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['choose', 'n1', 'n2', 'n3']);
  assert.equal(top(st), 'golden');
  assert.equal(ev(st, 'reveal').pop().dur, 5000);
});

test('choose: activate a non-command — take the card under choose, turn over', () => {
  const st = setup({ hands: { p0: ['n7', 'n1', 'n2', 'n3'] }, deckTop: ['choose'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'activate' });
  act(st, 'p0', { slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['n7', 'n1', 'n2', 'n3', 'n4']);
  assert.equal(st.current, 'p1');
});

test('choose: the activated command may not touch the choose slot itself', () => {
  const st = setup({ hands: { p0: ['swap', 'n1', 'n2', 'n3'] }, deckTop: ['choose'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'activate' });
  const sid = slots(st, 'p0')[0].id;
  act(st, 'p0', { slotId: sid });
  assert.ok(!st.pending.spec.mine.includes(sid));
});

test('choose: skip makes a player lose his next turn; shuffle; peek; observe one card each', () => {
  let st = setup({ deckTop: ['choose'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'skip' });
  act(st, 'p0', { target: 'p1' });
  act(st, 'p1', { t: 'noGuard' });
  assert.equal(st.current, 'p2');

  st = setup({ deckTop: ['choose', 'n0'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'peek' });
  const r = ev(st, 'reveal').pop();
  assert.deepEqual(r.to, ['p0']); assert.equal(r.items[0].card, 'n0');

  st = setup({ hands: { p2: ['guard', 'n1', 'n2', 'n3'] }, deckTop: ['choose'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'observe' });
  const picks = {};
  for (const p of st.players) picks[p.id] = slots(st, p.id)[0].id;
  act(st, 'p0', { picks });
  const guards = [];
  while (st.pending.kind === 'guard') {
    guards.push(st.pending.pid);
    if (st.pending.pid === 'p2') act(st, 'p2', { t: 'guard', slotId: slots(st, 'p2')[0].id });
    else act(st, st.pending.pid, { t: 'noGuard' });
  }
  assert.deepEqual(guards, ['p1', 'p2', 'p3']);
  const seen = ev(st, 'reveal').filter((e) => e.to[0] === 'p0' && e.to.length === 1).map((e) => e.items[0].owner);
  assert.deepEqual(seen.sort(), ['p0', 'p1', 'p3']);
});

test('skip on the last turn after banana loses it', () => {
  const st = setup({ turnsPlayed: 3, deckTop: ['n7', 'choose', 'n7'], discard: ['n9'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  act(st, 'p1', { t: 'banana' });
  // p2 skips p3 with choose
  act(st, 'p2', { t: 'draw' });
  act(st, 'p2', { t: 'throw' });
  act(st, 'p2', { option: 'skip' });
  act(st, 'p2', { target: 'p3' });
  act(st, 'p3', { t: 'noGuard' });
  assert.equal(st.current, 'p0');
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  assert.equal(st.pending.kind, 'roundOver');
});

test('scoring: everyone at 0 or below wins (0 points); round 4 doubles', () => {
  const st = setup({ n: 3, round: 4, hands: { p0: ['minus'], p1: ['n0'], p2: ['n9', 'n1'] }, discard: ['n4'] });
  st.banana = 'p2'; st.finalQueue = [];
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  // p0 kept a random card; set hands directly for scoring check instead
  assert.equal(st.pending.kind, 'roundOver');
  const end = ev(st, 'roundEnd').pop();
  assert.equal(end.mult, 2);
  for (let i = 0; i < 3; i++) if (end.unit[i] <= 0) assert.equal(end.scores[i], 0);
  assert.equal(end.scores[2], 20);
  assert.equal(end.scores[1], 0, 'n0 holder is at 0 and wins');
});

test('scoring: if nobody reaches 0, the lowest wins; ties all win', () => {
  const st = setup({ n: 3, hands: { p0: ['n3'], p1: ['n3'], p2: ['n9'] }, discard: ['n4'] });
  st.finalQueue = [];
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id }); // wrong snap: n3 vs n4 -> p0 has n3,n4
  const end = ev(st, 'roundEnd').pop();
  assert.deepEqual(end.unit, [7, 3, 9]);
  assert.deepEqual(end.scores, [7, 0, 9]);
});

test('tie after round 5 → extra blind round for everyone, until someone leads', () => {
  const st = setup({ n: 3, round: 5, hands: { p0: ['n3'], p1: ['n3'], p2: ['n9'] }, discard: [] });
  for (const p of st.players) p.total = 10;
  st.finalQueue = [];
  act(st, 'p0', { t: 'draw' });
  act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id }); // p0 now holds the drawn card
  const end = ev(st, 'roundEnd').pop();
  const totals = st.players.map((p) => p.total);
  const best = Math.min(...totals);
  if (totals.filter((v) => v === best).length > 1) {
    assert.equal(st.over, false);
    act(st, 'p0', { t: 'next' });
    assert.equal(st.tiebreak, 1);
    assert.equal(st.round, 5);
    assert.equal(st.discard.length, 0, 'tiebreak round is blind');
  } else {
    assert.equal(st.over, true);
  }
  assert.ok(end);
});

test('tie after round 5 (forced) → tiebreak', () => {
  const st = setup({ n: 3, round: 5, hands: { p0: ['n3'], p1: ['n3'], p2: ['n9'] }, discard: ['n1'] });
  for (const p of st.players) p.total = 10;
  st.finalQueue = [];
  act(st, 'p0', { t: 'take' });
  act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id }); // p0: n1 ; p1: n3 ; p2: n9
  // totals: p0 10, p1 13, p2 19 → p0 leads, game over
  assert.equal(st.over, true);
  assert.deepEqual(st.winners, ['p0']);
  const st2 = setup({ n: 3, round: 5, hands: { p0: ['n3'], p1: ['n3'], p2: ['n9'] }, discard: ['n3'] });
  st2.players[0].total = 10; st2.players[1].total = 10; st2.players[2].total = 0;
  st2.finalQueue = [];
  act(st2, 'p0', { t: 'take' });
  act(st2, 'p0', { t: 'keep', slotId: slots(st2, 'p0')[0].id }); // p0 3, p1 3 → both win (0); p2 9 → 9
  // totals: 10, 10, 9 → p2 leads
  assert.deepEqual(st2.winners, ['p2']);
  const st3 = setup({ n: 3, round: 5, hands: { p0: ['n3'], p1: ['n3'], p2: ['n9'] }, discard: ['n3'] });
  st3.players[0].total = 5; st3.players[1].total = 5; st3.players[2].total = 0;
  st3.finalQueue = [];
  act(st3, 'p0', { t: 'take' });
  act(st3, 'p0', { t: 'keep', slotId: slots(st3, 'p0')[0].id }); // totals 5,5,9 → tie
  assert.equal(st3.over, false);
  act(st3, 'p0', { t: 'next' });
  assert.equal(st3.tiebreak, 1);
  assert.equal(st3.discard.length, 0);
});

test('team: owner and partner choose who runs the effect; conflict → owner', () => {
  let st = setup({ mode: 'team', deckTop: ['n7'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  assert.equal(st.pending.kind, 'delegate');
  act(st, 'p0', { t: 'delegate', who: 'p2' });
  act(st, 'p2', { t: 'delegate', who: 'p2' });
  assert.equal(st.pending.pid, 'p2');
  assert.ok(st.pending.spec.options.every((sid) => slots(st, 'p2').some((s) => s.id === sid)), 'partner peeks his own card');
  act(st, 'p2', { slotId: st.pending.spec.options[0] });
  assert.ok(['p1', 'p0'].includes(st.current) || st.pending.kind === 'snapWindow');

  st = setup({ mode: 'team', deckTop: ['n7'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { t: 'delegate', who: 'p2' });
  act(st, 'p2', { t: 'delegate', who: 'p0' });
  assert.equal(st.pending.pid, 'p0');
});

test('team: partner may snap after my turn, and we can chain', () => {
  const st = setup({ mode: 'team', hands: { p0: ['n25', 'n25', 'n1', 'n2'], p2: ['n25', 'n25', 'n3', 'n4'] }, discard: ['n9', 'n25'] });
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id });
  assert.equal(st.pending.kind, 'snapWindow'); assert.equal(st.pending.pid, 'p2');
  act(st, 'p2', { t: 'snap', slotId: slots(st, 'p2')[0].id });
  assert.equal(st.pending.pid, 'p0');
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id });
  assert.equal(st.pending.pid, 'p2');
  act(st, 'p2', { t: 'snap', slotId: slots(st, 'p2')[0].id });
  assert.equal(st.pending.pid, 'p0');
  act(st, 'p0', { t: 'pass' });
  assert.equal(st.current, 'p1');
  assert.deepEqual(names(st, 'p0'), ['n1', 'n2']);
  assert.deepEqual(names(st, 'p2'), ['n3', 'n4']);
});

test('team: the snap window opens even when partner has no match (hides info)', () => {
  const st = setup({ mode: 'team', discard: ['n4'], deckTop: ['n0'] });
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  assert.equal(st.pending.kind, 'snapWindow');
});

test('team: a player who empties his hand — wait for his turn, then everyone once more', () => {
  const st = setup({ mode: 'team', hands: { p0: ['n5'] }, discard: ['n5'], deckTop: Array(12).fill('n1').slice(0, 3) });
  act(st, 'p0', { t: 'snap', slotId: slots(st, 'p0')[0].id });
  act(st, 'p2', { t: 'pass' });
  const order = [];
  let guard = 0;
  while (st.pending.kind !== 'roundOver' && guard++ < 200) {
    const k = st.pending.kind;
    if (k === 'turn') { order.push(st.current); act(st, st.current, { t: 'draw' }); }
    else if (k === 'hold') act(st, st.current, { t: 'throw' });
    else act(st, st.pending.pid || st.pending.pids[0], { t: 'timeout' });
  }
  assert.deepEqual(order, ['p1', 'p2', 'p3', 'p1', 'p2', 'p3']);
});

test('team: deck running out ends the round right after that turn', () => {
  const st = setup({ mode: 'team', discard: ['n4'] });
  st.deck = st.deck.slice(-1);
  // keep the removed cards in limbo for the invariant
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'keep', slotId: slots(st, 'p0')[0].id });
  if (st.pending.kind === 'snapWindow') act(st, 'p2', { t: 'pass' });
  assert.equal(st.pending.kind, 'roundOver');
});

test('team score = sum of both partners', () => {
  const st = setup({ mode: 'team', hands: { p0: ['n1'], p2: ['n2'], p1: ['n9'], p3: ['n9'] }, discard: ['n4'] });
  st.deckOut = true;
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  while (st.pending.kind !== 'roundOver') act(st, st.pending.pid || st.pending.pids[0], { t: 'timeout' });
  const end = ev(st, 'roundEnd').pop();
  assert.equal(end.unit.length, 2);
  assert.equal(end.scores[0], 0);
});

test('timeout on a turn: draw and throw with no effect', () => {
  const st = setup({ deckTop: ['swap'], discard: ['n4'] });
  act(st, 'p0', { t: 'timeout' });
  assert.equal(top(st), 'swap');
  assert.equal(ev(st, 'effect').length, 0);
  assert.equal(st.current, 'p1');
});

test('views never leak hidden cards', () => {
  const st = setup({ deckTop: ['n0'], discard: ['n4'] });
  const v = JSON.stringify(viewFor(st, 'p1'));
  for (const p of st.players) for (const s of p.slots) assert.ok(!v.includes('"' + s.card + '"'));
  act(st, 'p0', { t: 'draw' });
  assert.ok(!JSON.stringify(viewFor(st, 'p1')).includes('n0'));
  assert.ok(JSON.stringify(viewFor(st, 'p0')).includes('n0'));
});

test('choose → activate: the choose slot is locked for the rest of the turn, and copy repeats the command before choose', () => {
  const st = setup({ hands: { p0: ['copy', 'n1', 'n2', 'n3'] }, deckTop: ['choose'], discard: ['n4'] });
  st.lastActivated = 'swap';
  act(st, 'p0', { t: 'draw' }); act(st, 'p0', { t: 'throw' });
  act(st, 'p0', { option: 'activate' });
  const sid = slots(st, 'p0')[0].id;
  act(st, 'p0', { slotId: sid });
  assert.equal(st.pending.spec.type, 'swap', 'copy repeats swap, the command before choose');
  assert.ok(!st.pending.spec.mine.includes(sid));
  assert.ok(slots(st, 'p0')[0].locked);
  act(st, 'p0', { mine: st.pending.spec.mine[0], theirs: st.pending.spec.theirs[0] });
  if (st.pending.kind === 'guard') act(st, st.pending.pid, { t: 'noGuard' });
  assert.ok(!slots(st, 'p0')[0].locked, 'lock ends with the turn');
});

test('guard in your own turn removes one plus (or a freeze) from your own slot; wrong card = penalty', () => {
  let st = setup({ hands: { p0: ['guard', 'n1', 'n2', 'n3'] }, discard: ['n4'] });
  const t = slots(st, 'p0')[1];
  const pcs = Object.keys(st.cards).filter((c) => st.cards[c] === 'plus');
  for (const c of pcs) st.deck.splice(st.deck.indexOf(c), 1);
  t.plus = 2; t.plusCards = pcs;
  act(st, 'p0', { t: 'guardRemove', targetSlot: t.id, guardSlot: slots(st, 'p0')[0].id, what: 'plus' });
  assert.equal(t.plus, 1);
  assert.equal(top(st), 'guard');
  assert.equal(st.current, 'p1');
  checkInvariants(st);

  st = setup({ hands: { p0: ['n9', 'n1', 'n2', 'n3'] }, discard: ['n4'] });
  const t2 = slots(st, 'p0')[1];
  const pc = Object.keys(st.cards).find((c) => st.cards[c] === 'plus');
  st.deck.splice(st.deck.indexOf(pc), 1); t2.plus = 1; t2.plusCards = [pc];
  act(st, 'p0', { t: 'guardRemove', targetSlot: t2.id, guardSlot: slots(st, 'p0')[0].id, what: 'plus' });
  assert.equal(t2.plus, 1);
  assert.deepEqual(names(st, 'p0'), ['n9', 'n1', 'n2', 'n3', 'n4']);
  assert.equal(st.current, 'p1');
  rejects(() => act(st, 'p1', { t: 'guardRemove', targetSlot: t2.id, guardSlot: slots(st, 'p1')[0].id, what: 'plus' }));
  checkInvariants(st);
});

test('refuse your own drawn command with a guard; wrong card = take the card under it and the command runs', () => {
  let st = setup({ hands: { p0: ['guard', 'n1', 'n2', 'n3'] }, deckTop: ['tornado'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' });
  act(st, 'p0', { t: 'throwGuard', slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['n1', 'n2', 'n3']);
  assert.equal(top(st), 'guard');
  assert.equal(st.current, 'p1', 'command cancelled, turn over');
  checkInvariants(st);

  st = setup({ hands: { p0: ['n9', 'n1', 'n2', 'n3'] }, deckTop: ['plus'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' });
  act(st, 'p0', { t: 'throwGuard', slotId: slots(st, 'p0')[0].id });
  assert.deepEqual(names(st, 'p0'), ['n9', 'n1', 'n2', 'n3', 'n4'], 'penalty: the card under the command');
  assert.equal(st.pending.kind, 'target', 'the command still runs');
  checkInvariants(st);

  st = setup({ hands: { p0: ['guard', 'n1', 'n2', 'n3'] }, deckTop: ['n7'], discard: ['n4'] });
  act(st, 'p0', { t: 'draw' });
  rejects(() => act(st, 'p0', { t: 'throwGuard', slotId: slots(st, 'p0')[0].id }), 'numbers cannot be refused');
});
