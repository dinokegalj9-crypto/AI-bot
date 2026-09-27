'use strict';
/* ============================================================
   KAGE · Put sjene — util: math, RNG, storage, input
   ============================================================ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
function approach(v, t, s) { return v < t ? Math.min(v + s, t) : Math.max(v - s, t); }
function turnToward(a, target, maxStep) {
  const d = angDiff(a, target);
  return a + clamp(d, -maxStep, maxStep);
}
function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function v3norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/* ---------- persistent storage (never trusted to exist) ---------- */
const Store = {
  get(k, d) {
    try { const v = localStorage.getItem('kage_' + k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem('kage_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem('kage_' + k); } catch (e) { /* ignore */ } },
};

/* ---------- input: keyboard, mouse, gamepad, touch ---------- */
const Input = {
  keys: new Set(),
  hits: new Set(),
  gpPrev: [],
  gpNow: [],
  gpAxis: [0, 0],
  touchAxis: [0, 0],
  touchHeld: new Set(),
  lastDevice: 'kb',
  binds: {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    attack: ['KeyJ', 'Mouse0'], heavy: ['KeyK', 'Mouse2'],
    block: ['KeyL', 'ShiftLeft', 'ShiftRight'], jump: ['Space'],
    roll: ['KeyC', 'ControlLeft', 'KeyI'], throw: ['KeyQ', 'KeyU'],
    smoke: ['KeyF', 'KeyO'], weapon: ['Tab', 'KeyR'],
    w1: ['Digit1'], w2: ['Digit2'], w3: ['Digit3'], w4: ['Digit4'],
    pause: ['Escape', 'KeyP'], map: ['KeyM'],
    confirm: ['Enter', 'Space', 'KeyJ', 'NumpadEnter'], back: ['Escape', 'Backspace'],
  },
  // standard gamepad mapping
  gpBinds: {
    attack: [2], heavy: [3], jump: [0], roll: [1], block: [5, 7], throw: [4], smoke: [6],
    weapon: [11, 10], pause: [9], map: [8], confirm: [0], back: [1],
    up: [12], down: [13], left: [14], right: [15],
  },
  init(canvas) {
    const gameKeys = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    addEventListener('keydown', (e) => {
      if (gameKeys.has(e.code) && !(e.target && /^(INPUT|BUTTON|SELECT)$/.test(e.target.tagName))) e.preventDefault();
      this.lastDevice = 'kb';
      if (e.repeat) return;
      this.keys.add(e.code); this.hits.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchHeld.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      const c = 'Mouse' + e.button; this.keys.add(c); this.hits.add(c); this.lastDevice = 'kb';
    });
    addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  pollGamepad() {
    this.gpPrev = this.gpNow;
    this.gpNow = [];
    this.gpAxis = [0, 0];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) this.gpNow[i] = true; });
      let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) < 0.22) { ax = 0; ay = 0; }
      this.gpAxis = [ax, ay];
      if (ax || ay || this.gpNow.some(Boolean)) this.lastDevice = 'gp';
      break;
    }
  },
  held(a) {
    for (const k of this.binds[a] || []) if (this.keys.has(k)) return true;
    for (const b of this.gpBinds[a] || []) if (this.gpNow[b]) return true;
    return this.touchHeld.has(a);
  },
  hit(a) {
    for (const k of this.binds[a] || []) if (this.hits.has(k)) return true;
    for (const b of this.gpBinds[a] || []) if (this.gpNow[b] && !this.gpPrev[b]) return true;
    return this.hits.has('T:' + a);
  },
  touchPress(a) { this.touchHeld.add(a); this.hits.add('T:' + a); this.lastDevice = 'touch'; },
  touchRelease(a) { this.touchHeld.delete(a); },
  axis() {
    let x = 0, y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    x += this.gpAxis[0] + this.touchAxis[0];
    y += this.gpAxis[1] + this.touchAxis[1];
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return [x, y];
  },
  anyHit() { return this.hits.size > 0 || this.gpNow.some((b, i) => b && !this.gpPrev[i]); },
  endFrame() { this.hits.clear(); },
};
