import { Host } from './host.js';
import { cardSVG, backSVG, CARD_INFO } from './cards.js';
import { NUM_EFFECT } from './engine.js';
import * as Net from './net.js';
import { isLocalOnly } from './store.js';

const $app = document.getElementById('app');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('banana.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('banana.' + k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  screen: 'home',
  setup: LS.get('setup', { mode: 'solo', count: 4, level: 'medium', timed: true }),
  name: LS.get('name', ''),
  conn: null, // { act(a), leave(), isHost, room }
  me: null,
  view: null,
  reveals: {}, // slotId -> { card, until }
  peek: null, // { card, until }
  logs: [],
  banner: null,
  sel: {},
  selKey: '',
  lastRoundEnd: null,
  sheet: null, // extra sheet: 'scores' | 'menu' | 'rules'
  lobby: null,
  error: '',
};

// ------------------------------------------------------------ helpers
const cardName = (n) => (CARD_INFO[n].tier === 'cmd' ? CARD_INFO[n].label[0] + CARD_INFO[n].label.slice(1).toLowerCase() : CARD_INFO[n].num);
const pname = (pid) => {
  if (!ui.view) return '';
  if (pid === ui.me) return 'إنت';
  const p = ui.view.players.find((x) => x.id === pid);
  return p ? p.name : '';
};
const meP = () => ui.view.players.find((p) => p.id === ui.me);
const OPTION_AR = {
  observe: ['Observe', 'بُص على كارت واحد عند كل لاعب (وعندك)'],
  shuffle: ['Shuffle', 'اخلط كروت لاعب تختاره'],
  skip: ['Skip', 'خلّي لاعب يفوّت دوره الجاي'],
  peek: ['Peek', 'بُص على أول كارت في الكومة'],
  activate: ['Activate', 'فعّل أمر من كروتك — لو طلع مش أمر تلبس كارت'],
};
const PROMPT = {
  revealOwn: 'اختار كارت من كروتك تكشفه للكل',
  peekOwn: 'اختار كارت من كروتك تبُص عليه',
  peekOther: 'اختار كارت عند لاعب تاني تبُص عليه',
  buzz: 'اختار اللاعب اللي هتلبّسه الكارت',
  curse: 'اختار الكارت اللي هيتغيّر',
  plus: 'اختار الخانة اللي هتاخد +5',
  freeze: 'اختار الخانة اللي هتتجمّد ٣ أدوار',
  swap: 'اختار كارت من كروتك، وبعدين كارت عند لاعب تاني',
  tornado: 'اختار اللاعب اللي كل كروته هتتغيّر',
  choose_shuffle: 'اختار لاعب تخلط كروته',
  choose_skip: 'اختار لاعب يفوّت دوره',
  observe: 'اختار كارت واحد عند كل لاعب، وبعدين أكّد',
  activate: 'اختار الكارت اللي هتفعّله',
};

function log(text) {
  const id = Math.random();
  ui.logs.push({ id, text });
  if (ui.logs.length > 3) ui.logs.shift();
  setTimeout(() => { ui.logs = ui.logs.filter((l) => l.id !== id); render(); }, 3200);
}
function banner(text, ms = 1100) {
  ui.banner = text;
  setTimeout(() => { if (ui.banner === text) { ui.banner = null; render(); } }, ms);
}
function buzz() { try { navigator.vibrate && navigator.vibrate(40); } catch {} }

// ------------------------------------------------------------ incoming updates
function onUpdate(view, events) {
  const wasMyTurn = ui.view && ui.view.current === ui.me && ui.view.waitingKind === 'turn';
  ui.view = view;
  for (const e of events) handleEvent(e);
  const key = view.pending ? JSON.stringify([view.pending.kind, view.pending.step, view.pending.card, view.pending.spec, view.pending.cards && view.pending.cards.length]) : '';
  if (key !== ui.selKey) { ui.selKey = key; ui.sel = {}; }
  if (!wasMyTurn && view.pending && view.pending.kind === 'turn') buzz();
  if (view.pending && ['guard', 'snapWindow', 'delegate'].includes(view.pending.kind)) buzz();
  render();
}

function handleEvent(e) {
  const n = (pid) => pname(pid);
  const now = Date.now();
  switch (e.type) {
    case 'roundStart': {
      ui.reveals = {}; ui.lastRoundEnd = null;
      const kind = e.tiebreak ? 'جولة فاصلة' : e.kind === 'double' ? 'السكور × ٢' : e.kind === 'blind' ? 'جولة عمياني' : '';
      banner(`الجولة ${e.round}${kind ? '<br><small style="font-size:.5em">' + kind + '</small>' : ''}`, 1400);
      break;
    }
    case 'reveal':
      for (const it of e.items) {
        if (it.deckTop) ui.peek = { card: it.card, until: now + e.dur };
        else ui.reveals[it.slotId] = { card: it.card, until: now + e.dur, start: now };
      }
      setTimeout(render, e.dur + 30);
      break;
    case 'discarded': if (!e.timeout) log(e.replaced ? `${n(e.pid)} بدّل ورمى ${cardName(e.card)}` : `${n(e.pid)} رمى ${cardName(e.card)}`); else log(`${n(e.pid)} خلص وقته`); break;
    case 'took': log(`${n(e.pid)} خد ${cardName(e.card)} من الأرض`); break;
    case 'snap': log(e.ok ? `${n(e.pid)} بصّر ${cardName(e.card)} ✓` : `${n(e.pid)} بصّر غلط (${cardName(e.card)}) ولبس ${cardName(e.penalty)}`); break;
    case 'banana': banner('بانانا!', 1500); log(`${n(e.pid)} قال بانانا — كل واحد ليه دور أخير`); break;
    case 'effect': if (CARD_INFO[e.card].tier === 'cmd') log(`${n(e.pid)} شغّل ${cardName(e.card)}${e.viaCopy ? ' (Copy)' : ''}`); break;
    case 'gave': log(`${n(e.pid)} لبس ${cardName(e.card)}`); break;
    case 'swapped': log(`اتبدل كارت بين ${n(e.pa)} و${n(e.pb)}`); break;
    case 'shuffled': log(`كروت ${n(e.pid)} اتخلطت`); break;
    case 'tornado': log(`إعصار غيّر كروت ${n(e.pid)}`); break;
    case 'plus': log(`+5 على خانة عند ${n(e.owner)}`); break;
    case 'freeze': log(`خانة عند ${n(e.owner)} اتجمدت`); break;
    case 'unfreeze': log(`التجميد خلص عند ${n(e.owner)}`); break;
    case 'guarded': log(e.ok ? `${n(e.pid)} صدّ ${cardName(e.card)} بـ Guard!` : `${n(e.pid)} كشف كارت غلط ولبس كارت`); break;
    case 'skipped': log(`${n(e.pid)} فوّت دوره`); break;
    case 'willSkip': log(`${n(e.pid)} هيفوّت دوره الجاي`); break;
    case 'delegated': if (e.owner !== e.exec) log(`${n(e.exec)} هينفذ بدل ${n(e.owner)}`); break;
    case 'finished': log(`${n(e.pid)} خلّص كروته!`); break;
    case 'finalLap': log('آخر لفة!'); break;
    case 'reshuffle': log('الأرض اتخلطت وبقت كومة جديدة'); break;
    case 'activated': log(`${n(e.pid)} فعّل ${cardName(e.card)}`); break;
    case 'activateFailed': log(`${n(e.pid)} فعّل كارت مش أمر ولبس كارت`); break;
    case 'chose': log(`${n(e.pid)} اختار ${OPTION_AR[e.option][0]}`); break;
    case 'peekedDeck': if (e.pid !== ui.me) log(`${n(e.pid)} شاف أول كارت في الكومة`); break;
    case 'cleared': log(`${n(e.pid)} استخدم Clear`); break;
    case 'roundEnd': ui.lastRoundEnd = e; break;
    case 'gameOver': ui.gameOver = e; break;
  }
}

// ------------------------------------------------------------ actions
function send(a) {
  if (!ui.conn) return;
  ui.conn.act(a);
}

function startBots() {
  const s = ui.setup;
  LS.set('setup', s);
  const n = s.mode === 'team' ? 4 : s.count;
  const botNames = ['موزو', 'بنبون', 'موزيكا'];
  const players = [{ id: 'me', name: ui.name || 'أنا' }];
  for (let i = 1; i < n; i++) players.push({ id: 'b' + i, name: botNames[i - 1] + ' 🤖', bot: s.level });
  const host = new Host({ mode: s.mode, players, timed: s.timed, botDelay: /fast/.test(location.search) ? 40 : 900 });
  ui.me = 'me';
  ui.conn = { act: (a) => host.act('me', a), leave: () => host.destroy(), isHost: true, host, local: true };
  ui.screen = 'game';
  ui.view = null; ui.reveals = {}; ui.logs = []; ui.gameOver = null; ui.lastRoundEnd = null;
  host.subscribe('me', onUpdate);
}

function leaveGame() {
  const c = ui.conn;
  ui.conn = null;
  if (c) c.leave(); ui.view = null; ui.screen = 'home'; ui.sheet = null; ui.lobby = null;
  render();
}

// ------------------------------------------------------------ rendering
function render() {
  if (ui.screen === 'home') return renderHome();
  if (ui.screen === 'bots') return renderBotSetup();
  if (ui.screen === 'online') return renderOnline();
  if (ui.screen === 'lobby') return renderLobby();
  if (ui.screen === 'rules') return renderRules();
  if (ui.screen === 'game') return renderGame();
}

function seg(name, options, value) {
  return `<div class="seg" role="group">${options.map(([v, label]) => `<button data-seg="${name}" data-val="${esc(JSON.stringify(v))}" aria-pressed="${v === value}">${label}</button>`).join('')}</div>`;
}

function renderHome() {
  $app.innerHTML = `<div class="screen">
    <h1 class="logo">بانانا</h1>
    <p class="logo-sub">لعبة الكروت بتاعتنا — على الموبايل</p>
    <div class="hero-card">${cardSVG('n0')}</div>
    <div class="field"><label for="nm">اسمك في اللعبة</label><input id="nm" maxlength="14" value="${esc(ui.name)}" placeholder="مثلاً: محمد"></div>
    <button class="big-btn" data-go="online">العب مع صحابك</button>
    <button class="big-btn alt" data-go="bots">العب ضد الروبوتات</button>
    <button class="link-btn" data-go="rules">الكروت والقواعد باختصار</button>
  </div>`;
}

function renderBotSetup() {
  const s = ui.setup;
  $app.innerHTML = `<div class="screen">
    <h2 class="logo" style="font-size:2.6rem">ضد الروبوتات</h2>
    <div class="field"><label>المود</label>${seg('mode', [['solo', 'فردي'], ['team', 'زوجي (٢ ضد ٢)']], s.mode)}</div>
    ${s.mode === 'solo' ? `<div class="field"><label>عدد اللاعبين</label>${seg('count', [[3, '٣ لاعبين'], [4, '٤ لاعبين']], s.count)}</div>` : '<p class="hint">إنت وروبوت شريكك، ضد روبوتين.</p>'}
    <div class="field"><label>مستوى الروبوتات</label>${seg('level', [['easy', 'سهل'], ['medium', 'متوسط'], ['hard', 'صعب']], s.level)}</div>
    <div class="field"><label>الوقت</label>${seg('timed', [[true, '١٥ ثانية للدور'], [false, 'مفتوح']], s.timed)}</div>
    <button class="big-btn" data-act-ui="start-bots">ابدأ</button>
    <button class="link-btn" data-go="home">رجوع</button>
  </div>`;
}

function renderRules() {
  const names = Object.keys(CARD_INFO);
  $app.innerHTML = `<div class="screen">
    <h2 class="logo" style="font-size:2.6rem">باختصار</h2>
    <p>الهدف: أقل مجموع كروت في آخر كل جولة. ٥ جولات، الرابعة سكورها × ٢، والخامسة عمياني.</p>
    <p>في دورك: اسحب من الكومة، أو خد آخر كارت من الأرض (مش أمر)، أو بصّر كارت زي اللي على الأرض. تأثير الكارت بيشتغل بس لو سحبته ورميته في نفس الدور. أي أمر قيمته ١٠.</p>
    <div class="glossary">${names.map((n) => `<div>${cardSVG(n)}</div>`).join('')}</div>
    <button class="link-btn" data-go="home">رجوع</button>
  </div>`;
}

function renderOnline() {
  if (isLocalOnly() && !/localnet/.test(location.search)) {
    $app.innerHTML = `<div class="screen">
      <h2 class="logo" style="font-size:2.6rem">مع صحابك</h2>
      <p>اللعب أونلاين هيشتغل أول ما نربط السيرفر المجاني. لحد كده جرّب اللعبة ضد الروبوتات.</p>
      <button class="big-btn alt" data-go="bots">العب ضد الروبوتات</button>
      <button class="link-btn" data-go="home">رجوع</button>
    </div>`;
    return;
  }
  $app.innerHTML = `<div class="screen">
    <h2 class="logo" style="font-size:2.6rem">مع صحابك</h2>
    <button class="big-btn" data-act-ui="create-room">اعمل أوضة</button>
    <div class="field"><label for="code">أو ادخل بكود أوضة</label><input id="code" inputmode="numeric" maxlength="6" placeholder="مثلاً 4821"></div>
    <button class="big-btn alt" data-act-ui="join-room">ادخل</button>
    ${ui.error ? `<p class="hint" style="color:var(--pink);opacity:1">${esc(ui.error)}</p>` : ''}
    <button class="link-btn" data-go="home">رجوع</button>
  </div>`;
}

function renderLobby() {
  const L = ui.lobby;
  if (!L) return;
  const s = L.settings;
  const isHost = L.isHost;
  const seats = L.seats;
  const max = s.mode === 'team' ? 4 : s.count;
  const list = [];
  for (let i = 0; i < max; i++) {
    const p = seats[i];
    const team = s.mode === 'team' ? (i % 2 === 0 ? ' — فريق أ' : ' — فريق ب') : '';
    list.push(`<div class="opt" style="display:flex;justify-content:space-between;align-items:center">
      <span><b style="display:inline">${p ? esc(p.name) : 'مكان فاضي'}</b>${p && p.bot ? ' 🤖' : ''}${p && p.host ? ' 👑' : ''}${team}</span>
      ${isHost && !p ? `<button class="btn-light" style="padding:6px 10px" data-lobby="bot" data-i="${i}">ضيف روبوت</button>` : ''}
      ${isHost && p && p.bot ? `<button class="btn-light" style="padding:6px 10px" data-lobby="kick" data-i="${i}">شيل</button>` : ''}
    </div>`);
  }
  const full = seats.filter(Boolean).length === max;
  $app.innerHTML = `<div class="screen">
    <h2 class="logo" style="font-size:2.4rem">كود الأوضة</h2>
    <div style="font-family:var(--display);font-size:3.4rem;text-align:center;letter-spacing:8px;color:var(--banana)">${esc(L.code)}</div>
    <button class="big-btn alt" data-lobby="share">ابعت الكود لصحابك</button>
    ${isHost ? `<div class="field"><label>المود</label>${seg('lmode', [['solo', 'فردي'], ['team', 'زوجي']], s.mode)}</div>
      ${s.mode === 'solo' ? `<div class="field"><label>عدد اللاعبين</label>${seg('lcount', [[3, '٣'], [4, '٤']], s.count)}</div>` : ''}
      <div class="field"><label>الوقت</label>${seg('ltimed', [[true, '١٥ ثانية'], [false, 'مفتوح']], s.timed)}</div>
      <div class="field"><label>مستوى الروبوتات</label>${seg('llevel', [['easy', 'سهل'], ['medium', 'متوسط'], ['hard', 'صعب']], s.level)}</div>` :
      `<p class="hint">${s.mode === 'team' ? 'زوجي' : 'فردي'} — ${s.timed ? '١٥ ثانية للدور' : 'وقت مفتوح'}. مستنيين صاحب الأوضة يبدأ.</p>`}
    <div class="sheet" style="border-radius:18px;animation:none"><div class="opts">${list.join('')}</div></div>
    ${isHost ? `<button class="big-btn" data-lobby="start" ${full ? '' : 'disabled style="opacity:.5"'}>ابدأ اللعب</button>` : ''}
    ${ui.error ? `<p class="hint" style="color:var(--pink);opacity:1">${esc(ui.error)}</p>` : ''}
    <button class="link-btn" data-lobby="leave">اخرج من الأوضة</button>
  </div>`;
}

// ---------- game table
function slotHTML(s, owner, opts = {}) {
  const rv = ui.reveals[s.id];
  const showing = rv && rv.until > Date.now();
  const cls = ['slot'];
  if (!s.has) cls.push('empty');
  if (s.frozen) cls.push('frozen');
  if (showing && Date.now() - rv.start < 350) cls.push('revealed');
  if (opts.pickable) cls.push('pickable');
  if (opts.picked) cls.push('picked');
  const face = s.has ? (showing ? cardSVG(rv.card) : backSVG()) : '';
  return `<div class="${cls.join(' ')}" data-slot="${s.id}" data-owner="${owner}" ${opts.pickable ? 'role="button" tabindex="0"' : ''}>
    ${face}
    ${s.plus ? `<span class="badge plus-b">+${5 * s.plus}</span>` : ''}
    ${s.frozen ? `<span class="badge freeze-b">❄ ${s.frozen}</span>` : ''}
    ${opts.pos ? `<span class="pos">${opts.pos}</span>` : ''}
  </div>`;
}

function pickableSlots() {
  const v = ui.view, p = v.pending, sel = ui.sel;
  const set = new Set();
  if (!p) return set;
  const mine = meP().slots;
  const add = (ids) => ids.forEach((i) => set.add(i));
  if (sel.mode === 'snap' || sel.mode === 'guard') add(mine.filter((s) => s.has && !s.frozen).map((s) => s.id));
  else if (p.kind === 'hold' || (p.kind === 'extra' && sel.extraIdx != null)) add(mine.filter((s) => !s.frozen).map((s) => s.id));
  else if (p.kind === 'target') {
    const sp = p.spec;
    if (sp.type === 'ownSlot' || sp.type === 'slot') add(sp.options);
    if (sp.type === 'swap') add(sel.mine ? sp.theirs : sp.mine);
    if (sp.type === 'observe') for (const ids of Object.values(sp.groups)) add(ids);
    if (sp.type === 'multiSlot') add(sp.options);
    if (sp.type === 'clear') add(sp.options.filter((o) => o.what === 'card').map((o) => o.slotId));
  }
  return set;
}
function pickedSlots() {
  const s = new Set();
  if (ui.sel.mine) s.add(ui.sel.mine);
  if (ui.sel.picks) Object.values(ui.sel.picks).forEach((x) => s.add(x));
  if (ui.sel.multi) ui.sel.multi.forEach((x) => s.add(x));
  return s;
}
function pickablePlayers() {
  const p = ui.view.pending;
  if (p && p.kind === 'target' && p.spec.type === 'player') return new Set(p.spec.options);
  return new Set();
}

function statusText() {
  const v = ui.view, p = v.pending;
  if (!p) {
    const w = v.waitingOn[0];
    if (!w) return '';
    const who = `<b>${esc(pname(w))}</b>`;
    switch (v.waitingKind) {
      case 'turn': return `دور ${who}`;
      case 'guard': return `${who} بيقرر يستخدم Guard ولا لأ`;
      case 'snapWindow': return `${who} ممكن يبصّر دلوقتي`;
      case 'delegate': return 'الفريق بيختار مين ينفذ';
      case 'target': return `${who} بيختار…`;
      case 'roundOver': return 'مستنيين الجولة الجاية';
      default: return `${who} بيلعب…`;
    }
  }
  const sel = ui.sel;
  if (sel.mode === 'snap') return 'اضغط على الكارت اللي هتبصّره';
  if (sel.mode === 'guard') return 'اضغط على كارت الـ Guard بتاعك';
  switch (p.kind) {
    case 'turn': return 'دورك! اسحب، أو خد من الأرض، أو بصّر';
    case 'hold': return p.from === 'deck' ? 'بدّله بكارت من كروتك، أو ارميه' : 'اختار الكارت اللي هتبدّله';
    case 'extra': return sel.extraIdx == null ? 'Extra: اختار كارت من الاتنين' : 'اضغط على كارت تبدّله، أو ارمي';
    case 'snapWindow': return `شريكك رمى <b>${cardName(p.top)}</b> — تبصّر عليه؟`;
    case 'target': {
      if (p.step === 'tornadoPick') return `الكومة فيها ${p.spec.n} بس — اختار ${p.spec.n} كروت تتغيّر`;
      if (p.spec.type === 'swap' && sel.mine) return 'دلوقتي اختار كارت عند لاعب تاني';
      return PROMPT[p.step] || 'اختار';
    }
    default: return '';
  }
}

function renderGame() {
  const v = ui.view;
  if (!v) { $app.innerHTML = '<div class="screen"><p class="logo-sub" style="margin-top:40vh">بنوزّع الكروت…</p></div>'; return; }
  const me = meP();
  const n = v.players.length;
  const myIdx = v.players.findIndex((p) => p.id === ui.me);
  const others = [];
  for (let d = 1; d < n; d++) others.push(v.players[(myIdx + d) % n]);
  const pick = pickableSlots(), picked = pickedSlots(), pplayers = pickablePlayers();
  const p = v.pending;

  const oppHTML = others.map((o) => {
    const tags = [];
    if (v.banana === o.id) tags.push('<span class="tag banana">بانانا</span>');
    if (o.finished) tags.push('<span class="tag done">خلّص</span>');
    if (o.skipNext) tags.push('<span class="tag">هيفوّت</span>');
    const partner = v.mode === 'team' && o.team === me.team;
    const cls = ['opp'];
    if (partner) cls.push('partner');
    if (v.current === o.id) cls.push('active');
    if (pplayers.has(o.id)) cls.push('pickable');
    return `<div class="${cls.join(' ')}" data-player="${o.id}">
      <div class="opp-head"><b>${esc(o.name)}</b>${partner ? '<span class="tag">شريكك</span>' : ''}${tags.join('')}<span class="tag">${o.total}</span></div>
      <div class="hand">${o.slots.map((s) => slotHTML(s, o.id, { pickable: pick.has(s.id), picked: picked.has(s.id) })).join('') || '<span class="hint">مفيش كروت</span>'}</div>
    </div>`;
  }).join('');

  const top = v.discardTop;
  const canTake = p && p.kind === 'turn' && top && CARD_INFO[top].tier !== 'cmd';
  const canDraw = p && p.kind === 'turn';
  const typeChip = v.tiebreak ? 'فاصلة' : v.roundType === 'double' ? '× ٢' : v.roundType === 'blind' ? 'عمياني' : '';

  let timer = '';
  if (v.deadline && v.timed) timer = `<div class="timer" id="timer"><i></i></div>`;

  $app.innerHTML = `
  <div class="topbar">
    <span class="round-chip">الجولة ${v.round}/5${typeChip ? `<small>${typeChip}</small>` : ''}</span>
    <span class="row">
      <button class="icon-btn" data-sheet="scores">السكور</button>
      <button class="icon-btn" data-sheet="menu" aria-label="القائمة">☰</button>
    </span>
  </div>
  <div class="opponents">${oppHTML}</div>
  <div class="center">
    <div class="piles">
      <div class="pile ${canDraw ? 'pickable' : ''}" data-pile="deck" ${canDraw ? 'role="button" tabindex="0" aria-label="اسحب"' : ''}>${v.deckCount ? backSVG() : ''}<span class="count">الكومة ${v.deckCount}</span></div>
      <div class="pile ${top ? '' : 'none'} ${canTake ? 'pickable' : ''}" data-pile="discard" ${canTake ? 'role="button" tabindex="0" aria-label="خد من الأرض"' : ''}>${top ? cardSVG(top) : ''}<span class="count">الأرض</span></div>
    </div>
    <div class="status" aria-live="polite">${statusText()}</div>
    <div class="log">${ui.logs.map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>
  </div>
  ${timer}
  <div class="me-bar ${v.current === ui.me ? 'active' : ''}">
    <div class="me-head"><span>${esc(me.name)} ${v.banana === ui.me ? '<span class="tag banana">بانانا</span>' : ''}</span><span>مجموعك: ${me.total}</span></div>
    <div class="hand">${me.slots.map((s, i) => slotHTML(s, me.id, { pickable: pick.has(s.id), picked: picked.has(s.id), pos: i + 1 })).join('') || '<span class="hint">خلّصت كروتك!</span>'}</div>
  </div>
  <div class="actions">${actionsHTML()}</div>
  ${ui.peek && ui.peek.until > Date.now() ? `<div class="peek-toast">${cardSVG(ui.peek.card)}</div>` : ''}
  ${ui.banner ? `<div class="banner"><span>${ui.banner}</span></div>` : ''}
  ${sheetHTML()}`;
  startTimerBar();
}

function actionsHTML() {
  const v = ui.view, p = v.pending, sel = ui.sel, me = meP();
  if (!p) return '';
  const snapBtn = (label = 'بصّر') => `<button class="act ${sel.mode === 'snap' ? 'on' : ''}" data-ui="snap-mode" ${v.discardTop ? '' : 'disabled'}>${label}</button>`;
  switch (p.kind) {
    case 'turn': {
      const canBanana = v.mode === 'solo' && !v.banana && me.turnsPlayed >= 3;
      const top = v.discardTop;
      return `<button class="act" data-a="draw">اسحب</button>
        <button class="act" data-a="take" ${top && CARD_INFO[top].tier !== 'cmd' ? '' : 'disabled'}>خد من الأرض</button>
        ${snapBtn()}
        ${v.mode === 'solo' ? `<button class="act banana-btn" data-a="banana" ${canBanana ? '' : 'disabled'}>${canBanana ? 'بانانا!' : `بانانا بعد ${3 - me.turnsPlayed} أدوار`}</button>` : ''}`;
    }
    case 'hold':
      return p.from === 'deck' ? `<button class="act" data-a="throw">ارمي${effectNote(p.name)}</button>` : '';
    case 'extra':
      return `${sel.extraIdx != null ? `<button class="act" data-ui="extra-throw">ارمي${effectNote(p.cards[sel.extraIdx].name)}</button>` : ''}
        ${p.snapsLeft > 0 ? snapBtn() : ''}`;
    case 'snapWindow':
      return `<button class="act quiet" data-a="pass">مش هبصّر</button>${snapBtn('بصّر')}`;
    case 'target': {
      const sp = p.spec;
      if (sp.type === 'player') {
        return sp.options.map((id) => `<button class="act" data-target="${id}">${esc(pname(id))}</button>`).join('');
      }
      if (sp.type === 'observe') {
        const done = Object.keys(sp.groups).every((pid) => sel.picks && sel.picks[pid]);
        return `<button class="act" data-ui="observe-ok" ${done ? '' : 'disabled'}>تمام، وريني</button>`;
      }
      if (sp.type === 'multiSlot') {
        const done = (sel.multi || []).length === sp.n;
        return `<button class="act" data-ui="multi-ok" ${done ? '' : 'disabled'}>تمام</button>`;
      }
      if (sp.type === 'swap' && sel.mine) return '<button class="act quiet" data-ui="unpick">غيّر اختيارك</button>';
      return '';
    }
    default: return '';
  }
}
function effectNote(name) {
  if (CARD_INFO[name].tier === 'cmd' || NUM_EFFECT[name]) return ' وشغّله';
  return '';
}

function sheetHTML() {
  const v = ui.view, p = v.pending;
  if (ui.sheet === 'scores') return scoresSheet();
  if (ui.sheet === 'menu') {
    return `<div class="sheet-bg" data-close="1"><div class="sheet">
      <h2>القائمة</h2>
      <div class="opts">
        <button class="opt" data-sheet="rules-mini"><b>الكروت</b><span>شوف كل كارت بيعمل إيه</span></button>
        <button class="opt" data-ui="leave"><b>اخرج من الجيم</b><span>${ui.conn && ui.conn.local ? 'الجيم هيتقفل' : 'روبوت هيلعب مكانك'}</span></button>
        <button class="btn-light" data-close="1">رجوع</button>
      </div></div></div>`;
  }
  if (ui.sheet === 'rules-mini') {
    return `<div class="sheet-bg" data-close="1"><div class="sheet"><h2>الكروت</h2><div class="glossary">${Object.keys(CARD_INFO).map((n) => `<div>${cardSVG(n)}</div>`).join('')}</div><button class="btn-light" data-close="1" style="width:100%;margin-top:10px">رجوع</button></div></div>`;
  }
  if (v.over || (p && p.kind === 'gameOver') || ui.gameOver) return gameOverSheet();
  if (ui.lastRoundEnd && (v.waitingKind === 'roundOver')) return roundSheet();
  if (!p) return '';
  if (p.kind === 'hold') {
    return `<div class="sheet-bg" style="background:transparent;pointer-events:none;align-items:flex-start;padding-top:22vh"><div style="margin:0 auto;pointer-events:none"><div class="float-card">${cardSVG(p.name)}</div></div></div>`;
  }
  if (p.kind === 'extra') {
    return `<div class="sheet-bg" style="background:transparent;pointer-events:none;align-items:flex-start;padding-top:20vh"><div class="float-wrap" style="margin:0 auto;pointer-events:auto">${p.cards.map((c, i) => `<div class="float-card small ${ui.sel.extraIdx === i ? 'sel' : ''}" data-extra="${i}" role="button" tabindex="0">${cardSVG(c.name)}</div>`).join('')}</div></div>`;
  }
  if (p.kind === 'guard' && ui.sel.mode !== 'guard') {
    return `<div class="sheet-bg"><div class="sheet">
      <h2>${esc(pname(p.by))} لعب عليك ${cardName(p.card)}</h2>
      <p>معاك Guard؟ لو كشفت كارت غلط هتلبس كارت زيادة والأمر هيتنفذ.</p>
      <div class="float-wrap"><div class="float-card small">${cardSVG(p.card)}</div></div>
      <div class="row"><button class="btn-light" data-a="noGuard">لأ، كمّل</button><button class="btn-pink" data-ui="guard-mode">آه، هكشف الـ Guard</button></div>
    </div></div>`;
  }
  if (p.kind === 'delegate') {
    if (p.answered) return '';
    const mate = v.players.find((x) => x.id !== ui.me && x.team === meP().team);
    const owner = p.owner === ui.me;
    return `<div class="sheet-bg"><div class="sheet">
      <h2>${cardName(p.card)}: مين ينفذ؟</h2>
      <p>${owner ? 'إنت رميت الكارت.' : `${esc(pname(p.owner))} رمى الكارت.`} اللي ينفذ بينفذه على كروته هو. لو اختلفتوا، صاحب الكارت هو اللي ينفذ.</p>
      <div class="float-wrap"><div class="float-card small">${cardSVG(p.card)}</div></div>
      <div class="row"><button class="btn-dark" data-delegate="${ui.me}">أنا</button><button class="btn-light" data-delegate="${mate.id}">${esc(mate.name)}</button></div>
    </div></div>`;
  }
  if (p.kind === 'target' && p.spec.type === 'option') {
    return `<div class="sheet-bg"><div class="sheet"><h2>Choose: اختار أمر</h2><div class="opts">
      ${p.spec.options.map((o) => `<button class="opt" data-option="${o}"><b>${OPTION_AR[o][0]}</b><span>${OPTION_AR[o][1]}</span></button>`).join('')}
    </div></div></div>`;
  }
  if (p.kind === 'target' && p.spec.type === 'clear') {
    const me = meP();
    const pos = (sid) => me.slots.findIndex((s) => s.id === sid) + 1;
    const label = { card: (o) => `ارمي الكارت رقم ${pos(o.slotId)}`, plus: (o) => `شيل +5 من الخانة ${pos(o.slotId)}`, freeze: (o) => `فك التجميد من الخانة ${pos(o.slotId)}` };
    return `<div class="sheet-bg"><div class="sheet"><h2>Clear</h2><p>ارمي أي كارت من كروتك، أو شيل +5 أو تجميد من خاناتك.</p><div class="opts">
      ${p.spec.options.map((o) => `<button class="opt" data-clear="${o.slotId}|${o.what}"><b>${label[o.what](o)}</b></button>`).join('')}
    </div></div></div>`;
  }
  return '';
}

function scoresSheet() {
  const v = ui.view;
  const rows = v.mode === 'team'
    ? [0, 1].map((t) => {
      const ps = v.players.filter((p) => p.team === t);
      return `<tr><td>${ps.map((p) => esc(p.name)).join(' + ')}</td>${[0, 1, 2, 3, 4].map((r) => `<td>${ps[0].roundScores[r] ?? ''}</td>`).join('')}<td><b>${ps[0].total}</b></td></tr>`;
    }).join('')
    : v.players.map((p) => `<tr><td>${esc(p.name)}</td>${[0, 1, 2, 3, 4].map((r) => `<td>${p.roundScores[r] ?? ''}</td>`).join('')}<td><b>${p.total}</b></td></tr>`).join('');
  return `<div class="sheet-bg" data-close="1"><div class="sheet"><h2>السكور</h2>
    <table class="scores"><tr><th></th><th>١</th><th>٢</th><th>٣</th><th>٤×٢</th><th>٥</th><th>المجموع</th></tr>${rows}</table>
    <p class="hint">الأقل هو الأحسن.</p>
    <button class="btn-light" data-close="1" style="width:100%">رجوع</button></div></div>`;
}

function miniHand(slots) {
  return `<div class="mini-hand">${slots.map((s) => `<div class="m">${s.card ? cardSVG(s.card) : ''}${s.plus ? `<small>+${5 * s.plus}</small>` : ''}</div>`).join('')}</div>`;
}

function roundSheet() {
  const e = ui.lastRoundEnd, v = ui.view;
  const isHost = v.pending && v.pending.kind === 'roundOver';
  const rows = e.detail.map((d, i) => {
    const p = v.players.find((x) => x.id === d.pid);
    const unitIdx = v.mode === 'team' ? p.team : i;
    return `<tr class="${e.wins[unitIdx] ? 'win' : ''}"><td>${esc(p.name)}${miniHand(d.slots)}</td><td>${d.sum}</td><td>${e.scores[unitIdx]}</td><td>${p.total}</td></tr>`;
  }).join('');
  return `<div class="sheet-bg"><div class="sheet">
    <h2>${e.tiebreak ? 'الجولة الفاصلة' : `آخر الجولة ${e.round}`}${e.mult === 2 ? ' (× ٢)' : ''}</h2>
    <table class="scores"><tr><th>اللاعب</th><th>كروته</th><th>السكور</th><th>المجموع</th></tr>${rows}</table>
    ${v.mode === 'team' ? '<p class="hint">سكور الفريق = مجموع الشريكين.</p>' : ''}
    ${isHost ? '<button class="btn-dark" data-a="next" style="width:100%">الجولة الجاية</button>' : '<p class="hint">مستنيين صاحب الأوضة يبدأ الجولة الجاية.</p>'}
  </div></div>`;
}

function gameOverSheet() {
  const v = ui.view;
  const winners = v.winners || (ui.gameOver && ui.gameOver.winners) || [];
  const iWon = winners.includes(ui.me);
  const e = ui.lastRoundEnd;
  return `<div class="sheet-bg"><div class="sheet">
    <h2>${iWon ? 'كسبت! 🍌' : `الكسبان: ${winners.map((w) => esc(pname(w))).join(' و')}`}</h2>
    ${e ? `<table class="scores"><tr><th>اللاعب</th><th>آخر جولة</th><th>المجموع</th></tr>${v.players.map((p) => `<tr class="${winners.includes(p.id) ? 'win' : ''}"><td>${esc(p.name)}</td><td>${p.roundScores[p.roundScores.length - 1] ?? ''}</td><td>${p.total}</td></tr>`).join('')}</table>` : ''}
    <div class="row">
      ${ui.conn && ui.conn.local ? '<button class="btn-dark" data-ui="again">العب تاني</button>' : ''}
      <button class="btn-light" data-ui="leave">الرئيسية</button>
    </div>
  </div></div>`;
}

let timerRAF = null;
function startTimerBar() {
  cancelAnimationFrame(timerRAF);
  const el = document.getElementById('timer');
  if (!el || !ui.view.deadline) return;
  const total = ui.view.pending && ['guard', 'snapWindow', 'delegate'].includes(ui.view.waitingKind) ? 5000 : 15000;
  const tick = () => {
    const left = Math.max(0, ui.view.deadline - Date.now());
    const i = el.querySelector('i');
    if (!i) return;
    i.style.transform = `scaleX(${Math.min(1, left / total)})`;
    el.classList.toggle('low', left < 4000);
    if (left > 0) timerRAF = requestAnimationFrame(tick);
  };
  tick();
}

// ------------------------------------------------------------ input
function onSlotTap(slotId, owner) {
  const v = ui.view, p = v.pending, sel = ui.sel;
  if (!p) return;
  const pick = pickableSlots();
  if (!pick.has(slotId)) return;
  if (sel.mode === 'snap') { send({ t: 'snap', slotId }); ui.sel = {}; return; }
  if (sel.mode === 'guard') { send({ t: 'guard', slotId }); ui.sel = {}; return; }
  if (p.kind === 'hold') return send({ t: 'keep', slotId });
  if (p.kind === 'extra') { const i = sel.extraIdx; ui.sel = {}; return send({ t: 'keep', i, slotId }); }
  if (p.kind === 'target') {
    const sp = p.spec;
    if (sp.type === 'ownSlot' || sp.type === 'slot') return send({ slotId });
    if (sp.type === 'clear') return send({ slotId, what: 'card' });
    if (sp.type === 'swap') {
      if (!sel.mine) { sel.mine = slotId; return render(); }
      return send({ mine: sel.mine, theirs: slotId });
    }
    if (sp.type === 'observe') {
      sel.picks = sel.picks || {};
      for (const [pid, ids] of Object.entries(sp.groups)) if (ids.includes(slotId)) sel.picks[pid] = slotId;
      return render();
    }
    if (sp.type === 'multiSlot') {
      sel.multi = sel.multi || [];
      if (sel.multi.includes(slotId)) sel.multi = sel.multi.filter((x) => x !== slotId);
      else if (sel.multi.length < sp.n) sel.multi.push(slotId);
      return render();
    }
  }
}

$app.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-go],[data-seg],[data-act-ui],[data-a],[data-ui],[data-slot],[data-pile],[data-target],[data-player],[data-option],[data-clear],[data-delegate],[data-extra],[data-sheet],[data-close],[data-lobby]');
  if (!t) return;
  const d = t.dataset;
  const nm = document.getElementById('nm');
  if (nm) { ui.name = nm.value.trim().slice(0, 14); LS.set('name', ui.name); }
  if (d.close && ev.target === t) { ui.sheet = null; return render(); }
  if (d.close) { if (t.tagName === 'BUTTON') { ui.sheet = null; render(); } return; }
  if (d.go) { ui.error = ''; ui.screen = d.go; return render(); }
  if (d.seg) {
    const val = JSON.parse(d.val);
    if (d.seg.startsWith('l') && ui.lobby) { ui.lobby.updateSettings({ [d.seg.slice(1)]: val }); return; }
    ui.setup[d.seg] = val; LS.set('setup', ui.setup); return render();
  }
  if (d.actUi === 'start-bots') return startBots();
  if (d.actUi === 'create-room') return Net.createRoom(netCtx());
  if (d.actUi === 'join-room') {
    const code = (document.getElementById('code').value || '').replace(/\D/g, '');
    if (code.length < 4) { ui.error = 'اكتب الكود اللي صاحبك بعته (٤ أرقام).'; return render(); }
    return Net.joinRoom(netCtx(), code);
  }
  if (d.lobby) return ui.lobby && ui.lobby.handle(d.lobby, +d.i);
  if (d.sheet) { ui.sheet = d.sheet; return render(); }
  if (d.a) {
    if (d.a === 'next') ui.lastRoundEnd = null;
    return send({ t: d.a });
  }
  if (d.ui === 'snap-mode') { ui.sel = ui.sel.mode === 'snap' ? {} : { ...ui.sel, mode: 'snap' }; return render(); }
  if (d.ui === 'guard-mode') { ui.sel = { mode: 'guard' }; return render(); }
  if (d.ui === 'extra-throw') { const i = ui.sel.extraIdx; ui.sel = {}; return send({ t: 'throw', i }); }
  if (d.ui === 'observe-ok') return send({ picks: ui.sel.picks });
  if (d.ui === 'multi-ok') return send({ slotIds: ui.sel.multi });
  if (d.ui === 'unpick') { ui.sel = {}; return render(); }
  if (d.ui === 'leave') return leaveGame();
  if (d.ui === 'again') { leaveGame(); ui.screen = 'bots'; return startBots(); }
  if (d.extra != null) { ui.sel = { extraIdx: +d.extra }; return render(); }
  if (d.option) return send({ option: d.option });
  if (d.clear) { const [slotId, what] = d.clear.split('|'); return send({ slotId, what }); }
  if (d.delegate) return send({ t: 'delegate', who: d.delegate });
  if (d.target) return send({ target: d.target });
  if (d.player) { if (pickablePlayers().has(d.player)) send({ target: d.player }); return; }
  if (d.pile === 'deck') { if (ui.view?.pending?.kind === 'turn') send({ t: 'draw' }); return; }
  if (d.pile === 'discard') { if (ui.view?.pending?.kind === 'turn') send({ t: 'take' }); return; }
  if (d.slot) { ev.stopPropagation(); return onSlotTap(d.slot, d.owner); }
});
$app.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role=button]')) { ev.preventDefault(); ev.target.click(); }
});

// The network layer talks to the UI through this small context.
function netCtx() {
  return {
    name: () => ui.name || 'لاعب',
    setup: () => ui.setup,
    showLobby(lobby) { ui.lobby = lobby; ui.screen = 'lobby'; ui.error = ''; render(); },
    lobbyChanged() { if (ui.screen === 'lobby') render(); },
    startGame(conn, pid) {
      ui.conn = conn; ui.me = pid; ui.screen = 'game';
      ui.view = null; ui.reveals = {}; ui.logs = []; ui.gameOver = null; ui.lastRoundEnd = null;
      render();
    },
    update: onUpdate,
    error(msg) { ui.error = msg; if (ui.screen !== 'game') ui.screen = 'online'; render(); },
    toast(msg) { log(msg); render(); },
    left() { leaveGame(); },
  };
}

render();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
