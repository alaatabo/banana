// A tiny realtime-store interface with two backends:
//  - Firebase Realtime Database (real online play, free plan)
//  - LocalStore: tabs of one browser talking over BroadcastChannel (testing)
import { FIREBASE } from './config.js';

const split = (path) => path.split('/').filter(Boolean);
function getAt(obj, path) { let o = obj; for (const k of split(path)) { if (o == null) return null; o = o[k]; } return o ?? null; }
function setAt(obj, path, val) {
  const ks = split(path); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; }
  if (val === null || val === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = val;
}
let pushCounter = 0;
export const pushId = () => Date.now().toString(36).padStart(9, '0') + (pushCounter++).toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------- local
class LocalStore {
  constructor() {
    this.data = {};
    this.listeners = [];
    this.ch = new BroadcastChannel('banana-store');
    this.ch.onmessage = (m) => this.onMsg(m.data);
    this.ready = new Promise((res) => {
      this.ch.postMessage({ hello: true });
      setTimeout(res, 250);
    });
  }
  onMsg(m) {
    if (m.hello) { this.ch.postMessage({ snapshot: this.data }); return; }
    if (m.snapshot) { if (!Object.keys(this.data).length) { this.data = m.snapshot; this.fireAll(); } return; }
    this.apply(m, false);
  }
  apply(op, broadcast = true) {
    const before = JSON.stringify(getAt(this.data, op.path.split('/').slice(0, 3).join('/')));
    if (op.type === 'set') setAt(this.data, op.path, op.val);
    if (op.type === 'update') for (const [k, v] of Object.entries(op.val)) setAt(this.data, op.path + '/' + k, v);
    if (broadcast) this.ch.postMessage(op);
    this.fire(op.path, before);
  }
  fireAll() { for (const l of this.listeners) l.check(); }
  fire() { for (const l of [...this.listeners]) l.check(); }
  async get(path) { await this.ready; return structuredClone(getAt(this.data, path)); }
  async set(path, val) { this.apply({ type: 'set', path, val }); }
  async update(path, val) { this.apply({ type: 'update', path, val }); }
  async push(path, val) { const id = pushId(); this.apply({ type: 'set', path: path + '/' + id, val }); return id; }
  async remove(path) { this.apply({ type: 'set', path, val: null }); }
  onDisconnectRemove(path) { addEventListener('pagehide', () => this.apply({ type: 'set', path, val: null })); }
  onValue(path, cb) {
    let last;
    const l = { check: () => { const v = getAt(this.data, path); const s = JSON.stringify(v); if (s !== last) { last = s; cb(v == null ? null : JSON.parse(s)); } } };
    this.listeners.push(l);
    this.ready.then(() => l.check());
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }
  onChildAdded(path, cb) {
    const seen = new Set();
    const l = { check: () => { const v = getAt(this.data, path) || {}; for (const k of Object.keys(v).sort()) if (!seen.has(k)) { seen.add(k); cb(k, structuredClone(v[k])); } } };
    this.listeners.push(l);
    this.ready.then(() => l.check());
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }
}

// ---------------------------------------------------------------- firebase
class FireStore {
  constructor(cfg) {
    this.ready = (async () => {
      const app = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
      const db = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
      this.f = db;
      this.db = db.getDatabase(app.initializeApp(cfg));
    })();
  }
  r(path) { return this.f.ref(this.db, path); }
  async get(path) { await this.ready; const s = await this.f.get(this.r(path)); return s.exists() ? s.val() : null; }
  async set(path, val) { await this.ready; return this.f.set(this.r(path), val); }
  async update(path, val) { await this.ready; return this.f.update(this.r(path), val); }
  async push(path, val) { await this.ready; const ref = this.f.push(this.r(path)); await this.f.set(ref, val); return ref.key; }
  async remove(path) { await this.ready; return this.f.remove(this.r(path)); }
  async onDisconnectRemove(path) { await this.ready; this.f.onDisconnect(this.r(path)).remove(); }
  onValue(path, cb) {
    let un = null, dead = false;
    this.ready.then(() => { if (!dead) un = this.f.onValue(this.r(path), (s) => cb(s.exists() ? s.val() : null)); });
    return () => { dead = true; un && un(); };
  }
  onChildAdded(path, cb) {
    let un = null, dead = false;
    this.ready.then(() => { if (!dead) un = this.f.onChildAdded(this.r(path), (s) => cb(s.key, s.val())); });
    return () => { dead = true; un && un(); };
  }
}

let store = null;
export function getStore() {
  if (!store) store = FIREBASE ? new FireStore(FIREBASE) : new LocalStore();
  return store;
}
export const isLocalOnly = () => !FIREBASE;
