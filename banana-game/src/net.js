// Online rooms. The host's phone runs the game; other phones send actions
// to the host's inbox and read their own (private) view back.
//
// rooms/{code}/meta      { host, settings, status: lobby|playing|closed, created }
// rooms/{code}/seats     { 0: {id,name,host?,bot?}, ... }
// rooms/{code}/inbox     queue of { type: join|leave|act, from, ... } for the host
// rooms/{code}/replies/{pid}   host → joiner messages (e.g. room full)
// rooms/{code}/presence/{pid}  true while connected
// rooms/{code}/out/{pid}/view  JSON string of that player's view
// rooms/{code}/out/{pid}/ev    batches of events (JSON strings)
import { getStore, isLocalOnly } from './store.js';
import { Host } from './host.js';

const BOT_NAMES = ['موزو', 'بنبون', 'موزيكا'];
const maxSeats = (s) => (s.mode === 'team' ? 4 : s.count);

export function myId() {
  let id = null;
  try { id = localStorage.getItem('banana.pid'); } catch {}
  if (!id) {
    id = 'u' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('banana.pid', id); } catch {}
  }
  // Two tabs on one device (local testing) need different ids.
  if (isLocalOnly()) {
    let tab = sessionStorage.getItem('banana.tab');
    if (!tab) { tab = Math.random().toString(36).slice(2, 6); sessionStorage.setItem('banana.tab', tab); }
    id += '-' + tab;
  }
  return id;
}

const seatsArr = (obj) => [0, 1, 2, 3].map((i) => (obj && obj[i]) || null);
const seatsObj = (arr) => Object.fromEntries(arr.map((s, i) => [i, s]).filter(([, s]) => s));

function shareCode(code) {
  const url = location.origin + location.pathname;
  const text = `تعالى نلعب بانانا 🍌\nادخل على ${url}\nودوس "العب مع صحابك" واكتب الكود: ${code}`;
  const copy = () => navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
  if (navigator.share) navigator.share({ text }).catch(copy); else copy();
}

// ---------------------------------------------------------------- host
export async function createRoom(ctx) {
  const st = getStore();
  const me = myId();
  let code = null;
  try {
    for (let i = 0; i < 12; i++) {
      const c = String(1000 + Math.floor(Math.random() * 9000));
      const m = await st.get(`rooms/${c}/meta`);
      if (!m || m.status === 'closed' || Date.now() - (m.created || 0) > 6 * 3600e3) { code = c; break; }
    }
  } catch (e) { return ctx.error('مش قادر أوصل للنت. اتأكد إنك متصل وجرّب تاني.'); }
  if (!code) return ctx.error('حاول تاني بعد شوية.');
  const s = ctx.setup();
  const settings = { mode: s.mode, count: s.count, timed: s.timed, level: s.level };
  const seats = [{ id: me, name: ctx.name(), host: true }, null, null, null];
  await st.set(`rooms/${code}`, { meta: { host: me, settings, status: 'lobby', created: Date.now() }, seats: seatsObj(seats) });
  st.set(`rooms/${code}/presence/${me}`, true);
  st.onDisconnectRemove(`rooms/${code}/presence/${me}`);

  const L = { code, isHost: true, settings, seats, game: null, unsubs: [] };
  const save = () => st.update(`rooms/${code}`, { 'meta/settings': L.settings, seats: seatsObj(L.seats) });
  const names = () => L.seats.filter(Boolean).map((x) => x.name);

  L.updateSettings = (obj) => {
    const next = { ...L.settings, ...obj };
    const max = maxSeats(next);
    if (L.seats.slice(max).some((x) => x && !x.bot)) { ctx.toast('فيه لاعب في مكان هيتشال — خلّيه يخرج الأول'); return; }
    L.settings = next;
    for (let i = max; i < 4; i++) L.seats[i] = null;
    save(); ctx.lobbyChanged();
  };
  L.handle = (cmd, i) => {
    if (cmd === 'share') return shareCode(code);
    if (cmd === 'bot' && !L.seats[i]) {
      const used = names();
      const nm = BOT_NAMES.find((b) => !used.includes(b + ' 🤖')) || 'روبوت';
      L.seats[i] = { id: 'bot' + i + Math.random().toString(36).slice(2, 5), name: nm + ' 🤖', bot: true };
      save(); return ctx.lobbyChanged();
    }
    if (cmd === 'kick' && L.seats[i] && L.seats[i].bot) { L.seats[i] = null; save(); return ctx.lobbyChanged(); }
    if (cmd === 'start') return start();
    if (cmd === 'leave') return close();
  };

  const onInbox = (key, msg) => {
    st.remove(`rooms/${code}/inbox/${key}`);
    if (!msg) return;
    if (msg.type === 'join') {
      if (L.seats.some((x) => x && x.id === msg.from)) return;
      if (L.game) { st.set(`rooms/${code}/replies/${msg.from}`, 'started'); return; }
      const max = maxSeats(L.settings);
      const free = L.seats.findIndex((x, i) => i < max && !x);
      if (free < 0) { st.set(`rooms/${code}/replies/${msg.from}`, 'full'); return; }
      L.seats[free] = { id: msg.from, name: String(msg.name || 'لاعب').slice(0, 14) };
      save(); ctx.lobbyChanged(); ctx.toast(`${L.seats[free].name} دخل الأوضة`);
    } else if (msg.type === 'leave') {
      const i = L.seats.findIndex((x) => x && x.id === msg.from);
      if (i < 0) return;
      if (L.game) { L.game.setAway(msg.from, true); return; }
      ctx.toast(`${L.seats[i].name} خرج`);
      L.seats[i] = null; save(); ctx.lobbyChanged();
    } else if (msg.type === 'act' && L.game) {
      if (!L.seats.some((x) => x && x.id === msg.from)) return;
      L.game.act(msg.from, msg.a);
    }
  };
  L.unsubs.push(st.onChildAdded(`rooms/${code}/inbox`, onInbox));

  // A player who drops for 8 s gets a bot until he's back.
  const awayTimers = {};
  L.unsubs.push(st.onValue(`rooms/${code}/presence`, (pres) => {
    pres = pres || {};
    if (!L.game) {
      // in the lobby a dropped player loses his seat
      for (let i = 1; i < 4; i++) {
        const x = L.seats[i];
        if (x && !x.bot && !pres[x.id]) {
          clearTimeout(awayTimers[x.id]);
          awayTimers[x.id] = setTimeout(async () => {
            const now = (await st.get(`rooms/${code}/presence`)) || {};
            if (!now[x.id] && !L.game && L.seats[i] && L.seats[i].id === x.id) { L.seats[i] = null; save(); ctx.lobbyChanged(); }
          }, 8000);
        }
      }
      return;
    }
    for (const x of L.seats) {
      if (!x || x.bot || x.id === me) continue;
      clearTimeout(awayTimers[x.id]);
      if (pres[x.id]) { if (L.game.away.has(x.id)) { L.game.setAway(x.id, false); ctx.toast(`${x.name} رجع`); } }
      else awayTimers[x.id] = setTimeout(() => { L.game.setAway(x.id, true); ctx.toast(`${x.name} فصل — روبوت بيلعب مكانه`); }, 8000);
    }
  }));

  async function start() {
    const max = maxSeats(L.settings);
    const seats = L.seats.slice(0, max);
    if (seats.some((x) => !x)) return ctx.toast('كمّل الأماكن الفاضية بروبوتات أو استنى صحابك');
    const players = seats.map((x) => ({ id: x.id, name: x.name, bot: x.bot ? L.settings.level : undefined }));
    const game = new Host({ mode: L.settings.mode, players, timed: L.settings.timed });
    L.game = game;
    await st.update(`rooms/${code}`, { 'meta/status': 'playing', 'meta/started': Date.now() });
    for (const x of seats) {
      if (x.bot || x.id === me) continue;
      game.subscribe(x.id, (view, events) => publish(x.id, view, events));
    }
    const conn = { act: (a) => game.act(me, a), leave: close, isHost: true, local: false, room: code };
    ctx.startGame(conn, me);
    game.subscribe(me, ctx.update);
  }

  function publish(pid, view, events) {
    const v = { ...view, deadlineIn: view.deadline ? view.deadline - Date.now() : null };
    delete v.deadline;
    if (events.length) st.push(`rooms/${code}/out/${pid}/ev`, JSON.stringify(events));
    st.set(`rooms/${code}/out/${pid}/view`, JSON.stringify(v));
  }

  async function close() {
    L.unsubs.forEach((u) => u());
    if (L.game) L.game.destroy();
    await st.update(`rooms/${code}`, { 'meta/status': 'closed' });
    st.remove(`rooms/${code}/presence/${me}`);
    setTimeout(() => st.remove(`rooms/${code}`), 3000);
    ctx.left();
  }

  ctx.showLobby(L);
}

// ---------------------------------------------------------------- guest
export async function joinRoom(ctx, code) {
  const st = getStore();
  const me = myId();
  let meta, seatsNow;
  try {
    meta = await st.get(`rooms/${code}/meta`);
    seatsNow = seatsArr(await st.get(`rooms/${code}/seats`));
  } catch (e) { return ctx.error('مش قادر أوصل للنت. اتأكد إنك متصل وجرّب تاني.'); }
  if (!meta || meta.status === 'closed') return ctx.error(`مفيش أوضة بالكود ${code}. اتأكد من الكود.`);
  const seated = seatsNow.some((x) => x && x.id === me);
  if (meta.status === 'playing' && !seated) return ctx.error('الجيم ده بدأ خلاص.');

  st.set(`rooms/${code}/presence/${me}`, true);
  st.onDisconnectRemove(`rooms/${code}/presence/${me}`);
  if (!seated) st.push(`rooms/${code}/inbox`, { type: 'join', from: me, name: ctx.name() });

  const L = { code, isHost: false, settings: meta.settings, seats: seatsNow, unsubs: [], started: false };
  const cleanup = () => L.unsubs.forEach((u) => u());
  L.updateSettings = () => {};
  L.handle = (cmd) => {
    if (cmd === 'share') return shareCode(code);
    if (cmd === 'leave') {
      st.push(`rooms/${code}/inbox`, { type: 'leave', from: me });
      st.remove(`rooms/${code}/presence/${me}`);
      cleanup(); ctx.left();
    }
  };

  L.unsubs.push(st.onValue(`rooms/${code}/replies/${me}`, (r) => {
    if (!r) return;
    st.remove(`rooms/${code}/replies/${me}`);
    cleanup(); ctx.left();
    ctx.error(r === 'full' ? 'الأوضة مليانة.' : 'الجيم ده بدأ خلاص.');
  }));
  L.unsubs.push(st.onValue(`rooms/${code}/seats`, (s) => { L.seats = seatsArr(s); ctx.lobbyChanged(); }));
  L.unsubs.push(st.onValue(`rooms/${code}/meta`, (m) => {
    if (!m || m.status === 'closed') {
      cleanup(); ctx.left(); ctx.error('صاحب الأوضة قفلها.');
      return;
    }
    L.settings = m.settings;
    ctx.lobbyChanged();
    if (m.status === 'playing' && !L.started) { L.started = true; startGuest(); }
  }));

  function startGuest() {
    const lastKeyName = `banana.ev.${code}.${me}`;
    let lastKey = sessionStorage.getItem(lastKeyName) || '';
    let view = null;
    const conn = {
      act: (a) => st.push(`rooms/${code}/inbox`, { type: 'act', from: me, a }),
      leave: () => L.handle('leave'),
      isHost: false, local: false, room: code,
    };
    ctx.startGame(conn, me);
    let queued = [];
    const deliver = (events) => {
      if (!view) { queued.push(...events); return; }
      const all = queued.concat(events); queued = [];
      ctx.update(view, all);
    };
    L.unsubs.push(st.onValue(`rooms/${code}/out/${me}/view`, (s) => {
      if (!s) return;
      view = JSON.parse(s);
      view.deadline = view.deadlineIn != null ? Date.now() + view.deadlineIn : null;
      deliver([]);
    }));
    L.unsubs.push(st.onChildAdded(`rooms/${code}/out/${me}/ev`, (key, s) => {
      if (key <= lastKey) return;
      lastKey = key; sessionStorage.setItem(lastKeyName, key);
      deliver(JSON.parse(s));
    }));
  }

  if (seated && meta.status === 'playing') { L.started = true; startGuest(); return; }
  ctx.showLobby(L);
}
