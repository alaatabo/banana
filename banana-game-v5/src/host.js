// The host runs the engine: bots, timers, and pushing views to seats.
// Used as-is for offline games; online play wraps it with a network layer.
import { createGame, act, viewFor, eventsFor, RuleError } from './engine.js';
import { Bot } from './bot.js';

// Seconds per decision. `turn` applies to the player whose turn it is
// (every step of his turn); the short prompts give everyone 5 s.
export const TIMERS = { turn: 15, quick: 5 };
const QUICK = new Set(['guard', 'snapWindow', 'delegate']);

export class Host {
  constructor({ mode, players, timed = true, seed = Date.now() & 0x7fffffff, botDelay = 900, onError }) {
    this.state = createGame({ mode, players, seed });
    this.timed = timed;
    this.botDelay = botDelay;
    this.onError = onError || ((e) => console.error(e));
    this.bots = {};
    players.forEach((p, i) => { if (p.bot) this.bots[p.id] = new Bot(p.id, p.bot, seed + i * 7919); });
    this.subs = {}; // pid -> callback(view, events)
    this.seen = {}; // pid -> last event seq delivered
    this.away = new Set(); // seats whose human dropped (a bot plays for them)
    this.timer = null;
    this.deadline = null;
    this.paused = false;
  }

  subscribe(pid, cb) {
    this.subs[pid] = cb;
    this.seen[pid] = this.seen[pid] || 0;
    this.push(pid);
    this.schedule();
  }
  unsubscribe(pid) { delete this.subs[pid]; }

  // A human left: a bot takes the seat until he's back.
  setAway(pid, away) {
    if (away) { this.away.add(pid); if (!this.bots[pid]) this.bots[pid] = new Bot(pid, 'medium', 99); this.bots[pid].lastSeq = this.state.seq; this.bots[pid].known = {}; }
    else { this.away.delete(pid); if (!this.state.players.find((p) => p.id === pid).bot) delete this.bots[pid]; }
    this.schedule();
  }

  isBot(pid) { return !!this.bots[pid] && (this.away.has(pid) || !!this.state.players.find((p) => p.id === pid).bot); }

  push(pid) {
    const cb = this.subs[pid];
    if (!cb) return;
    const events = eventsFor(this.state, pid, this.seen[pid]);
    if (events.length) this.seen[pid] = events[events.length - 1].seq;
    const view = viewFor(this.state, pid);
    view.deadline = this.deadline;
    view.timed = this.timed;
    cb(view, events);
  }
  pushAll() { for (const pid of Object.keys(this.subs)) this.push(pid); }

  act(pid, action) {
    try {
      act(this.state, pid, action);
    } catch (e) {
      if (e instanceof RuleError) { this.push(pid); return { ok: false, error: e.message }; }
      this.onError(e);
      return { ok: false, error: 'internal' };
    }
    this.afterChange();
    return { ok: true };
  }

  afterChange() {
    this.deadline = null;
    clearTimeout(this.timer);
    this.schedule();
    this.pushAll();
  }

  waitingOn() {
    const p = this.state.pending;
    if (!p) return [];
    if (p.pids) return p.pids.filter((q) => !(p.answers && q in p.answers));
    return p.pid ? [p.pid] : [];
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.paused || this.state.over) return;
    const p = this.state.pending;
    if (!p) return;
    const who = this.waitingOn();
    const bot = who.find((q) => this.isBot(q));
    if (bot) {
      const delay = p.kind === 'roundOver' ? Math.max(this.botDelay, 4000 * (this.botDelay >= 300)) : QUICK.has(p.kind) ? Math.min(600, this.botDelay) : this.botDelay;
      this.timer = setTimeout(() => this.botMove(bot), delay);
      return;
    }
    if (p.kind === 'roundOver') return; // host taps "next round"
    if (!this.timed) return;
    const secs = QUICK.has(p.kind) ? TIMERS.quick : TIMERS.turn;
    this.deadline = Date.now() + secs * 1000;
    this.timer = setTimeout(() => {
      for (const q of this.waitingOn()) {
        try { act(this.state, q, { t: 'timeout' }); } catch (e) { if (!(e instanceof RuleError)) this.onError(e); }
        if (!this.state.pending || !this.waitingOn().includes(q)) break;
      }
      this.afterChange();
    }, secs * 1000 + 300);
    this.pushAll();
  }

  botMove(pid) {
    let a;
    try { a = this.bots[pid].decide(this.state); } catch (e) { this.onError(e); a = { t: 'timeout' }; }
    try {
      act(this.state, pid, a || { t: 'timeout' });
    } catch (e) {
      if (!(e instanceof RuleError)) this.onError(e);
      try { act(this.state, pid, { t: 'timeout' }); } catch (e2) { this.onError(e2); }
    }
    this.afterChange();
  }

  destroy() { clearTimeout(this.timer); this.subs = {}; }
}
