// The host runs the engine: bots, timers, and pushing views to seats.
// Used as-is for offline games; online play wraps it with a network layer.
import { createGame, act, viewFor, eventsFor, RuleError } from './engine.js';
import { Bot } from './bot.js';

// Seconds per decision. `turn` applies to the player whose turn it is
// (every step of his turn); the short prompts give everyone 5 s.
export const TIMERS = { turn: 15, quick: 8 };
const QUICK = new Set(['guard', 'snapWindow', 'delegate']);

// How long the players' screens need to show what just happened (card moves,
// command announcements). Nobody — bot or timer — moves on before that.
const ANNOUNCE_MS = 3700;
function paceOf(e) {
  switch (e.type) {
    case 'effect': return ANNOUNCE_MS;
    case 'targeted': return e.target !== e.by ? ANNOUNCE_MS : 0;
    case 'chose': return ANNOUNCE_MS;
    case 'guarded': return e.self && e.ok ? ANNOUNCE_MS : 1000;
    case 'discarded': return e.replaced ? 1400 : 900;
    case 'filled': case 'gave': case 'swapped': case 'snap': case 'markerOff': case 'plus': case 'freeze': case 'peeked': case 'guardUsed': return 1000;
    case 'shuffled': case 'tornado': return 1300;
    default: return 0;
  }
}

export class Host {
  constructor({ mode, players, timed = true, seed = Date.now() & 0x7fffffff, botDelay = 900, onError, rounds }) {
    this.state = createGame({ mode, players, seed, rounds });
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
    this.pacing = botDelay >= 300; // real play (tests run fast)
    this.busyUntil = 0;
    this.paceSeq = this.state.seq;
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
    const game = eventsFor(this.state, pid, this.seen[pid]);
    if (game.length) this.seen[pid] = game[game.length - 1].seq;
    // fun extras (thrown bananas) ride along with the game events
    const extra = (this.extra && this.extra[pid]) || [];
    if (this.extra) this.extra[pid] = [];
    const events = extra.concat(game);
    const view = viewFor(this.state, pid);
    view.deadline = this.deadline;
    view.timed = this.timed;
    cb(view, events);
  }
  pushAll() { for (const pid of Object.keys(this.subs)) this.push(pid); }

  act(pid, action) {
    if (action && action.t === 'emote') return this.emote(pid, action);
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

  // A banana thrown at another player's face. Not part of the game rules.
  emote(pid, a) {
    const to = a && a.to;
    if (!this.state.players.some((p) => p.id === to) || to === pid) return { ok: false };
    this.lastEmote = this.lastEmote || {};
    const now = Date.now();
    if (now - (this.lastEmote[pid] || 0) < 1200) return { ok: false };
    this.lastEmote[pid] = now;
    this.extra = this.extra || {};
    for (const id of Object.keys(this.subs)) (this.extra[id] = this.extra[id] || []).push({ type: 'emote', kind: 'banana', from: pid, to });
    this.pushAll();
    return { ok: true };
  }

  afterChange() {
    if (this.pacing) {
      const now = Date.now();
      let ms = 0;
      for (const e of this.state.events) if (e.seq > this.paceSeq) ms += paceOf(e);
      this.paceSeq = this.state.seq;
      if (ms) this.busyUntil = Math.max(this.busyUntil, now) + ms;
    }
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
      const delay = p.kind === 'roundOver' ? Math.max(this.botDelay, 4000 * (this.botDelay >= 300)) : p.kind === 'ready' ? 300 : QUICK.has(p.kind) ? Math.min(600, this.botDelay) : this.botDelay;
      this.timer = setTimeout(() => this.botMove(bot), delay + this.slack());
      return;
    }
    if (p.kind === 'roundOver') return; // host taps "next round"
    if (p.kind === 'ready') {
      // everyone looks at their 2 cards until they press start (30 s cap when timed)
      if (!this.timed) return;
      this.deadline = Date.now() + 30000;
      this.timer = setTimeout(() => { for (const q of this.waitingOn()) { try { act(this.state, q, { t: 'ready' }); } catch (e) {} } this.afterChange(); }, 30300);
      this.pushAll();
      return;
    }
    // The partner's chance to snap is short and never waits for an answer.
    const snapOnly = p.kind === 'snapWindow';
    if (!this.timed && !snapOnly) return;
    const secs = snapOnly ? (this.pacing ? 2.5 : 0.2) : QUICK.has(p.kind) ? TIMERS.quick : TIMERS.turn;
    const slack = this.slack();
    this.deadline = Date.now() + slack + secs * 1000;
    this.timer = setTimeout(() => {
      for (const q of this.waitingOn()) {
        try { act(this.state, q, { t: 'timeout' }); } catch (e) { if (!(e instanceof RuleError)) this.onError(e); }
        if (!this.state.pending || !this.waitingOn().includes(q)) break;
      }
      this.afterChange();
    }, slack + secs * 1000 + 300);
    this.pushAll();
  }

  slack() { return this.pacing ? Math.max(0, this.busyUntil - Date.now()) : 0; }

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
