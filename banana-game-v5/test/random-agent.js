// A random but legal player, used to fuzz the engine.
import { nameOf, isCmd, randomTarget } from '../src/engine.js';

export function randomAction(state, pid, rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pend = state.pending;
  const me = state.players.find((p) => p.id === pid);
  const mySlots = me.slots.filter((s) => s.card && !s.freeze && !s.locked);
  const top = state.discard[state.discard.length - 1];
  switch (pend.kind) {
    case 'turn': {
      const opts = [{ t: 'draw' }];
      if (top && !isCmd(nameOf(state, top)) && me.slots.some((s) => !s.freeze)) opts.push({ t: 'take' });
      if (top && mySlots.length) opts.push({ t: 'snap', slotId: pick(mySlots).id });
      if (state.mode === 'solo' && !state.banana && me.turnsPlayed >= 3 && rnd() < 0.15) return { t: 'banana' };
      if (rnd() < 0.03) return { t: 'timeout' };
      const ps = me.slots.find((x) => x.plus > 0 || x.freeze);
      if (ps && mySlots.length && rnd() < 0.3) return { t: 'guardRemove', targetSlot: ps.id, guardSlot: pick(mySlots).id, what: ps.plus > 0 ? 'plus' : 'freeze' };
      return pick(opts);
    }
    case 'hold': {
      const free = me.slots.filter((s) => !s.freeze && !s.locked);
      if (pend.from === 'discard' || (rnd() < 0.5 && free.length)) return { t: 'keep', slotId: pick(free).id };
      return { t: 'throw' };
    }
    case 'extra': {
      const free = me.slots.filter((s) => !s.freeze && !s.locked);
      const i = Math.floor(rnd() * pend.cards.length);
      const r = rnd();
      if (r < 0.15 && mySlots.length && top && pend.ctx.snaps < 2) return { t: 'snap', slotId: pick(mySlots).id };
      if (r < 0.5 && free.length) return { t: 'keep', i, slotId: pick(free).id };
      return { t: 'throw', i };
    }
    case 'target': return randomTarget(state, pend.spec, pick);
    case 'guard': {
      if (rnd() < 0.5 && mySlots.length) return { t: 'guard', slotId: pick(mySlots).id };
      return { t: 'noGuard' };
    }
    case 'delegate': return { t: 'delegate', who: pick(pend.pids) };
    case 'snapWindow': {
      if (rnd() < 0.3 && mySlots.length) return { t: 'snap', slotId: pick(mySlots).id };
      return { t: 'pass' };
    }
    case 'roundOver': return { t: 'next' };
    default: throw new Error('no action for ' + pend.kind);
  }
}

export function whoActs(state) {
  const p = state.pending;
  if (p.pids) return p.pids.filter((q) => !(p.answers && q in p.answers));
  return [p.pid];
}
