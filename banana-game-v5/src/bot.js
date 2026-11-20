// Bots. A bot only sees what a human in its seat would see: its view and the
// events sent to it. It keeps its own memory of cards it has seen.
import { CARD_DEFS, NUM_EFFECT, viewFor, eventsFor } from './engine.js';

const val = (name) => CARD_DEFS[name].value;
const isCmd = (name) => CARD_DEFS[name].kind === 'cmd';
// Average value of an unknown card (approximate, both decks).
const EV = 8.6;
const HARMFUL = new Set(['swap', 'curse', 'buzz', 'tornado', 'plus', 'freeze', 'choose']);

export const LEVELS = {
  easy: { memory: 0.55, banana: 6, snap: 0.5, guard: 0, smart: false },
  medium: { memory: 0.9, banana: 9, snap: 0.9, guard: 0.7, smart: true },
  hard: { memory: 1, banana: 11, snap: 1, guard: 1, smart: true },
};

export class Bot {
  constructor(pid, level = 'medium', seed = 1) {
    this.pid = pid;
    this.level = level;
    this.cfg = LEVELS[level];
    this.known = {}; // slotId -> card name
    this.lastSeq = 0;
    this.lastTook = {};
    this.round = 0;
    this.r = seed >>> 0 || 1;
  }
  rnd() { this.r = (Math.imul(this.r, 1664525) + 1013904223) >>> 0; return this.r / 4294967296; }
  pick(a) { return a[Math.floor(this.rnd() * a.length)]; }
  remember(slotId, name) {
    if (this.rnd() <= this.cfg.memory) this.known[slotId] = name;
    else delete this.known[slotId];
  }

  observe(state) {
    for (const e of eventsFor(state, this.pid, this.lastSeq)) {
      this.lastSeq = e.seq;
      switch (e.type) {
        case 'roundStart': this.known = {}; this.lastTook = {}; break;
        case 'reveal': for (const it of e.items) if (it.slotId) this.remember(it.slotId, it.card); break;
        case 'took': this.lastTook[e.pid] = e.card; break;
        case 'discarded':
          if (e.replaced && e.pid !== this.pid) {
            if (this.lastTook[e.pid]) this.remember(e.slotId, this.lastTook[e.pid]);
            else delete this.known[e.slotId];
          }
          delete this.lastTook[e.pid];
          break;
        case 'filled': if (e.pid !== this.pid) { if (this.lastTook[e.pid]) this.remember(e.slotId, this.lastTook[e.pid]); delete this.lastTook[e.pid]; } break;
        case 'snap':
          if (e.ok) delete this.known[e.slotId];
          else { this.remember(e.slotId, e.card); this.remember(e.newSlot, e.penalty); }
          break;
        case 'gave': this.remember(e.slotId, e.card); break;
        case 'swapped': {
          const a = this.known[e.a], b = this.known[e.b];
          delete this.known[e.a]; delete this.known[e.b];
          if (b) this.known[e.a] = b;
          if (a) this.known[e.b] = a;
          break;
        }
        case 'shuffled': case 'tornado':
          this.forgetPlayer(state, e.pid); break;
        case 'replaced': delete this.known[e.slotId]; break;
        case 'activated': this.known[e.slotId] = 'choose'; break;
        case 'cleared': if (e.what === 'card') delete this.known[e.slotId]; break;
      }
    }
  }
  forgetPlayer(state, pid) {
    const p = state.players.find((x) => x.id === pid);
    for (const s of p.slots) delete this.known[s.id];
  }

  slotEst(s) { return s.has ? (this.known[s.id] ? val(this.known[s.id]) : EV) : 0; }
  mySlots(v) { return v.players.find((p) => p.id === this.pid).slots; }
  estSum(v, pid = this.pid) {
    return v.players.find((p) => p.id === pid).slots.reduce((a, s) => a + this.slotEst(s) + 5 * s.plus, 0);
  }
  opponents(v) {
    const me = v.players.find((p) => p.id === this.pid);
    return v.players.filter((p) => p.id !== this.pid && (v.mode !== 'team' || p.team !== me.team) && !p.finished && p.slots.some((s) => s.has));
  }
  // Worst own slot to replace: highest estimated card, ignoring frozen slots.
  worstSlot(v) {
    const free = this.mySlots(v).filter((s) => !s.frozen && !s.locked);
    if (!free.length) return null;
    return free.reduce((a, b) => (this.slotEst(b) > this.slotEst(a) ? b : a));
  }
  knownMatch(v, name) {
    if (this.rnd() > this.cfg.snap) return null;
    return this.mySlots(v).find((s) => s.has && !s.frozen && !s.locked && this.known[s.id] === name) || null;
  }
  // How much do we want to throw this drawn card for its effect?
  wantsEffect(name) {
    if (!this.cfg.smart) return isCmd(name) || !!NUM_EFFECT[name];
    return ['n7', 'n8', 'n9', 'n10', 'golden', 'swap', 'curse', 'clear', 'extra', 'choose', 'plus', 'buzz', 'tornado', 'copy', 'freeze', 'n5', 'n6'].includes(name);
  }

  decide(state) {
    this.observe(state);
    const v = viewFor(state, this.pid);
    const p = v.pending;
    if (!p) return null;
    switch (p.kind) {
      case 'turn': return this.turn(v);
      case 'hold': return this.hold(v, p);
      case 'extra': return this.extra(v, p);
      case 'target': return this.target(v, p);
      case 'guard': return this.guard(v, p);
      case 'delegate': return { t: 'delegate', who: this.pid };
      case 'snapWindow': {
        const s = v.discardTop && this.knownMatch(v, v.discardTop);
        return s ? { t: 'snap', slotId: s.id } : { t: 'pass' };
      }
      case 'roundOver': return { t: 'next' };
      default: return { t: 'timeout' };
    }
  }

  turn(v) {
    const me = v.players.find((x) => x.id === this.pid);
    if (v.mode === 'solo' && !v.banana && me.turnsPlayed >= 3) {
      const mine = this.estSum(v);
      const others = Math.min(...v.players.filter((x) => x.id !== this.pid).map((x) => this.estSum(v, x.id)));
      // Get bolder the longer the round runs.
      const limit = this.cfg.banana + 2 * Math.max(0, me.turnsPlayed - 4);
      if (mine <= limit && (!this.cfg.smart || mine <= others + 2 || me.turnsPlayed > 10)) return { t: 'banana' };
    }
    if (this.cfg.smart) {
      const g = this.mySlots(v).find((x) => x.has && !x.frozen && !x.locked && this.known[x.id] === 'guard');
      const t = this.mySlots(v).find((x) => x.plus > 0) || this.mySlots(v).find((x) => x.frozen && x.has && this.known[x.id] && val(this.known[x.id]) >= 10);
      if (g && t) return { t: 'guardRemove', guardSlot: g.id, targetSlot: t.id, what: t.plus > 0 ? 'plus' : 'freeze' };
    }
    if (v.discardTop) {
      const s = this.knownMatch(v, v.discardTop);
      if (s) return { t: 'snap', slotId: s.id };
      if (!isCmd(v.discardTop)) {
        const w = this.worstSlot(v);
        if (w && val(v.discardTop) <= this.slotEst(w) - 3) return { t: 'take' };
      }
    }
    return { t: 'draw' };
  }

  keepOrThrow(v, name, fromFloor) {
    const w = this.worstSlot(v);
    if (fromFloor) return { keep: w };
    if (!w) return { throw: true };
    const value = val(name);
    if (value <= 2) return { keep: w };
    if (this.wantsEffect(name) && this.rnd() < 0.85) return { throw: true };
    if (value < this.slotEst(w)) return { keep: w };
    return { throw: true };
  }

  hold(v, p) {
    const d = this.keepOrThrow(v, p.name, p.from === 'discard');
    if (d.keep) { this.known[d.keep.id] = p.name; return { t: 'keep', slotId: d.keep.id }; }
    return { t: 'throw' };
  }

  extra(v, p) {
    if (v.discardTop && p.snapsLeft > 0) {
      const s = this.knownMatch(v, v.discardTop);
      if (s) return { t: 'snap', slotId: s.id };
    }
    const i = 0;
    const d = this.keepOrThrow(v, p.cards[i].name, false);
    if (d.keep) { this.known[d.keep.id] = p.cards[i].name; return { t: 'keep', i, slotId: d.keep.id }; }
    return { t: 'throw', i };
  }

  guard(v, p) {
    if (!HARMFUL.has(p.card) || this.rnd() > this.cfg.guard) return { t: 'noGuard' };
    const s = this.mySlots(v).find((x) => x.has && !x.frozen && !x.locked && this.known[x.id] === 'guard');
    return s ? { t: 'guard', slotId: s.id } : { t: 'noGuard' };
  }

  ownerOf(v, slotId) { return v.players.find((p) => p.slots.some((s) => s.id === slotId)); }
  isOpp(v, pid) {
    const me = v.players.find((p) => p.id === this.pid), o = v.players.find((p) => p.id === pid);
    return pid !== this.pid && (v.mode !== 'team' || o.team !== me.team);
  }
  leader(v, ids) {
    // the opponent doing best (lowest estimated hand) among ids
    let best = null, bv = Infinity;
    for (const id of ids) { const e = this.estSum(v, id); if (e < bv) { bv = e; best = id; } }
    return best;
  }

  target(v, p) {
    const spec = p.spec;
    const smart = this.cfg.smart;
    const unknown = (ids) => ids.filter((id) => !this.known[id]);
    const est = (id) => (this.known[id] ? val(this.known[id]) : EV);
    switch (spec.type) {
      case 'ownSlot': {
        if (p.step === 'activate') {
          const k = spec.options.find((id) => this.known[id] && isCmd(this.known[id]) && !['guard', 'choose', 'copy'].includes(this.known[id]));
          return { slotId: k || this.pick(spec.options) };
        }
        if (p.step === 'peekOwn') return { slotId: this.pick(unknown(spec.options).length ? unknown(spec.options) : spec.options) };
        // revealOwn: show a card I already know (less useful to others than a mystery? all the same) — prefer unknown to learn it
        return { slotId: this.pick(unknown(spec.options).length ? unknown(spec.options) : spec.options) };
      }
      case 'slot': {
        const opp = spec.options.filter((id) => this.isOpp(v, this.ownerOf(v, id).id));
        const mine = spec.options.filter((id) => this.ownerOf(v, id).id === this.pid);
        if (p.step === 'peekOther') {
          const u = unknown(opp.length ? opp : spec.options);
          return { slotId: this.pick(u.length ? u : spec.options) };
        }
        if (p.step === 'curse' && smart) {
          const hi = mine.filter((id) => est(id) > 12);
          if (hi.length) return { slotId: hi[0] };
          const lo = opp.filter((id) => this.known[id] && est(id) <= 3);
          if (lo.length) return { slotId: lo[0] };
        }
        if (p.step === 'freeze' && smart) {
          const good = mine.filter((id) => this.known[id] && est(id) <= 1);
          if (good.length) return { slotId: good[0] };
        }
        if (p.step === 'plus' || p.step === 'freeze' || p.step === 'curse') {
          if (smart && opp.length) {
            const lead = this.leader(v, [...new Set(opp.map((id) => this.ownerOf(v, id).id))]);
            const ls = opp.filter((id) => this.ownerOf(v, id).id === lead);
            return { slotId: this.pick(ls) };
          }
          return { slotId: this.pick(opp.length ? opp : spec.options) };
        }
        return { slotId: this.pick(spec.options) };
      }
      case 'player': {
        const opps = spec.options.filter((id) => this.isOpp(v, id));
        if (p.step === 'tornado' && smart && spec.options.includes(this.pid) && this.estSum(v) > 30) return { target: this.pid };
        if (opps.length) return { target: smart ? this.leader(v, opps) : this.pick(opps) };
        return { target: this.pick(spec.options) };
      }
      case 'clear': {
        const plus = spec.options.find((o) => o.what === 'plus');
        if (plus) return { slotId: plus.slotId, what: 'plus' };
        const cards = spec.options.filter((o) => o.what === 'card');
        if (cards.length) {
          const best = cards.reduce((a, b) => (est(b.slotId) > est(a.slotId) ? b : a));
          return { slotId: best.slotId, what: 'card' };
        }
        return spec.options[0];
      }
      case 'swap': {
        const mine = spec.mine.reduce((a, b) => (est(b) > est(a) ? b : a));
        const opp = spec.theirs.filter((id) => this.isOpp(v, this.ownerOf(v, id).id));
        const pool = opp.length ? opp : spec.theirs;
        const theirs = smart ? pool.reduce((a, b) => (est(b) < est(a) ? b : a)) : this.pick(pool);
        if (smart && est(theirs) >= est(mine)) {
          // nothing better known: still swap my worst for a random card
        }
        const a = this.known[mine], b = this.known[theirs];
        delete this.known[mine]; delete this.known[theirs];
        if (b) this.known[mine] = b;
        if (a) this.known[theirs] = a;
        return { mine, theirs };
      }
      case 'option': {
        const cmdKnown = this.mySlots(v).some((s) => s.has && !s.frozen && this.known[s.id] && isCmd(this.known[s.id]) && !['guard', 'choose', 'copy'].includes(this.known[s.id]));
        if (cmdKnown && smart) return { option: 'activate' };
        if (!smart) return { option: this.pick(['observe', 'shuffle', 'skip', 'peek']) };
        return { option: this.pick(['observe', 'observe', 'skip']) };
      }
      case 'observe': {
        const picks = {};
        for (const [pid, opts] of Object.entries(spec.groups)) {
          const u = unknown(opts);
          picks[pid] = this.pick(u.length ? u : opts);
        }
        return { picks };
      }
      case 'multiSlot': {
        const sorted = [...spec.options].sort((a, b) => est(b) - est(a));
        return { slotIds: sorted.slice(0, spec.n) };
      }
      default: return { t: 'timeout' };
    }
  }
}
