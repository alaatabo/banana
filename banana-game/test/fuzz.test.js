// Plays thousands of random games and checks that the engine never breaks:
// every card always in exactly one place, no stuck states, games finish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, checkInvariants, RuleError } from '../src/engine.js';
import { randomAction, whoActs } from './random-agent.js';

function mulberry(seed) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function playRandomGame(mode, nPlayers, seed) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const state = createGame({ mode, players, seed });
  const rnd = mulberry(seed * 7 + 1);
  let steps = 0, rejected = 0;
  while (!state.over) {
    if (++steps > 20000) throw new Error('game did not finish, seed ' + seed);
    checkInvariants(state);
    const who = whoActs(state);
    const pid = who[Math.floor(rnd() * who.length)];
    const a = randomAction(state, pid, rnd);
    try {
      act(state, pid, a);
    } catch (e) {
      if (!(e instanceof RuleError)) throw new Error(`seed ${seed} step ${steps} ${JSON.stringify(a)}: ${e.stack}`);
      rejected++;
      if (rejected > 5000) throw new Error('too many rejected actions, seed ' + seed + ': ' + e.message);
      // A random action may be illegal (e.g. snapping with no floor card); retry.
    }
  }
  checkInvariants(state);
  return { state, steps };
}

for (const [mode, n] of [['solo', 3], ['solo', 4], ['team', 4]]) {
  test(`fuzz ${mode} ${n} players — 1500 random games`, () => {
    let rounds = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const { state } = playRandomGame(mode, n, seed);
      assert.ok(state.over);
      assert.ok(state.winners.length >= 1);
      rounds += state.round + state.tiebreak;
    }
    assert.ok(rounds >= 1500 * 5);
  });
}
