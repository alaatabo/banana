import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, checkInvariants, RuleError } from '../src/engine.js';
import { Bot } from '../src/bot.js';

export function botGame(mode, levels, seed) {
  const players = levels.map((lv, i) => ({ id: 'p' + i, name: lv, bot: lv }));
  const st = createGame({ mode, players, seed });
  const bots = Object.fromEntries(players.map((p, i) => [p.id, new Bot(p.id, p.bot, seed * 13 + i)]));
  let errors = 0, steps = 0;
  while (!st.over) {
    if (++steps > 20000) throw new Error('stuck ' + seed);
    const pend = st.pending;
    const who = pend.pids ? pend.pids.filter((q) => !(pend.answers && q in pend.answers)) : [pend.pid];
    const pid = who[0];
    const a = bots[pid].decide(st);
    try { act(st, pid, a); } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      errors++;
      if (errors < 4) console.log('bot error', pend.kind, pend.task?.step, JSON.stringify(a), e.message);
      act(st, pid, { t: 'timeout' });
    }
    checkInvariants(st);
  }
  return { st, errors };
}

test('bots play complete games with no illegal moves', () => {
  let errors = 0;
  for (let seed = 1; seed <= 150; seed++) {
    errors += botGame('solo', ['easy', 'medium', 'hard'], seed).errors;
    errors += botGame('solo', ['hard', 'hard', 'medium', 'easy'], seed).errors;
    errors += botGame('team', ['hard', 'easy', 'medium', 'easy'], seed).errors;
  }
  assert.equal(errors, 0);
});

test('hard bots beat easy bots most of the time', () => {
  let hardWins = 0, games = 200;
  for (let seed = 1; seed <= games; seed++) {
    const { st } = botGame('solo', ['hard', 'easy', 'easy'], seed);
    if (st.winners.includes('p0')) hardWins++;
  }
  console.log('hard win rate vs 2 easy:', hardWins / games);
  assert.ok(hardWins / games > 0.45);
});
