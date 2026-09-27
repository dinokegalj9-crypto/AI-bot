'use strict';
/* ============================================================
   KAGE · Render — isometric world, cached tile art, skeletal
   characters, dynamic lighting, particles and weather.
   World units: 1 tile = 1. iso(x,y,z) → world pixels.
   ============================================================ */

const HW = 32, HH = 16, ZP = 32; // half tile width/height, pixels per z unit
const isoX = (x, y) => (x - y) * HW;
const isoY = (x, y, z = 0) => (x + y) * HH - z * ZP;

const R = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, zoom: 1, S: 1, res: 2,
  cam: { x: 0, y: 0, shake: 0, sx: 0, sy: 0, zoomMul: 1 },
  lcv: null, lctx: null, vig: null, scan: null,
  cache: new Map(), t: 0, crt: Store.get('crt', false),
};

function renderInit(cv) {
  R.cv = cv; R.ctx = cv.getContext('2d');
  R.lcv = document.createElement('canvas'); R.lctx = R.lcv.getContext('2d');
  addEventListener('resize', renderResize);
  renderResize();
}

function renderResize() {
  R.dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = innerWidth, ch = innerHeight;
  R.W = R.cv.width = Math.round(cw * R.dpr);
  R.H = R.cv.height = Math.round(ch * R.dpr);
  R.lcv.width = Math.ceil(R.W / 2); R.lcv.height = Math.ceil(R.H / 2);
  R.zoom = clamp(Math.min(cw, ch * 1.55) / 790, 0.66, 2.4);
  const res = clamp(Math.round(R.zoom * R.dpr * 4) / 4, 1.5, 3);
  if (res !== R.res) { R.res = res; R.cache.clear(); }
  // vignette
  R.vig = document.createElement('canvas'); R.vig.width = R.W; R.vig.height = R.H;
  const v = R.vig.getContext('2d');
  const g = v.createRadialGradient(R.W / 2, R.H / 2, Math.min(R.W, R.H) * 0.35, R.W / 2, R.H / 2, Math.hypot(R.W, R.H) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
  v.fillStyle = g; v.fillRect(0, 0, R.W, R.H);
  // scanlines
  R.scan = document.createElement('canvas'); R.scan.width = 4; R.scan.height = Math.max(3, Math.round(3 * R.dpr));
  const s = R.scan.getContext('2d'); s.fillStyle = 'rgba(0,0,0,0.28)'; s.fillRect(0, 0, 4, Math.max(1, Math.round(R.dpr)));
}

/* ------------------------------------------------------------ sprite cache */
function sprite(key, w, h, ax, ay, draw) {
  let s = R.cache.get(key);
  if (s) return s;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * R.res); cv.height = Math.ceil(h * R.res);
  const c = cv.getContext('2d');
  c.scale(R.res, R.res); c.translate(ax, ay);
  c.lineJoin = 'round'; c.lineCap = 'round';
  draw(c);
  s = { cv, w, h, ax, ay };
  R.cache.set(key, s);
  return s;
}
function blit(ctx, s, x, y, alpha = 1) {
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(s.cv, x - s.ax, y - s.ay, s.w, s.h);
  if (alpha < 1) ctx.globalAlpha = 1;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function diamond(c, z = 0, inset = 0) {
  const zz = z * ZP;
  c.beginPath();
  c.moveTo(0, inset - zz); c.lineTo(HW - inset * 2, HH - zz); c.lineTo(0, HH * 2 - inset - zz); c.lineTo(-HW + inset * 2, HH - zz);
  c.closePath();
}
function quad(c, pts, fill, stroke) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.stroke(); }
}

/* ------------------------------------------------------------ ground art */
const GROUND = {
  grass: '#62823f', dirt: '#7b6143', stone: '#6f6e75', wood: '#6a4a30', bridge: '#7a5634', pit: '#07070a',
};
function groundSprite(type, v) {
  return sprite('g_' + type + v, HW * 2 + 2, HH * 2 + 2, HW + 1, 1, (c) => {
    const rng = mulberry32(v * 977 + type.length * 131);
    diamond(c); c.save(); c.clip();
    const base = GROUND[type];
    c.fillStyle = shade(base, (rng() - 0.5) * 0.12); c.fillRect(-HW, 0, HW * 2, HH * 2);
    if (type === 'grass') {
      for (let i = 0; i < 26; i++) {
        const x = (rng() - 0.5) * 60, y = rng() * 32, l = 2 + rng() * 3;
        c.strokeStyle = rng() < 0.5 ? shade(base, -0.25) : shade(base, 0.2);
        c.lineWidth = 0.8; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rng() - 0.5) * 2, y - l); c.stroke();
      }
      for (let i = 0; i < 5; i++) { c.fillStyle = 'rgba(20,40,10,0.18)'; c.beginPath(); c.ellipse((rng() - 0.5) * 50, rng() * 30, 6, 3, 0, 0, TAU); c.fill(); }
    } else if (type === 'dirt') {
      for (let i = 0; i < 14; i++) {
        c.fillStyle = rng() < 0.5 ? shade(base, -0.25) : shade(base, 0.22);
        c.beginPath(); c.ellipse((rng() - 0.5) * 56, rng() * 30, 1 + rng() * 1.6, 0.8 + rng(), 0, 0, TAU); c.fill();
      }
    } else if (type === 'stone') {
      // four flagstones per tile
      c.strokeStyle = 'rgba(20,20,26,0.55)'; c.lineWidth = 1;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const x0 = i * 0.5, y0 = j * 0.5;
        const pts = [[x0, y0], [x0 + 0.5, y0], [x0 + 0.5, y0 + 0.5], [x0, y0 + 0.5]].map(([a, b]) => [(a - b) * HW, (a + b) * HH]);
        quad(c, pts, shade(base, (rng() - 0.5) * 0.22), 'rgba(22,22,28,0.6)');
      }
      for (let i = 0; i < 4; i++) {
        c.strokeStyle = 'rgba(15,15,20,0.4)'; c.lineWidth = 0.6; c.beginPath();
        let x = (rng() - 0.5) * 40, y = 6 + rng() * 20; c.moveTo(x, y);
        for (let k = 0; k < 3; k++) { x += (rng() - 0.5) * 8; y += (rng() - 0.5) * 4; c.lineTo(x, y); }
        c.stroke();
      }
    } else if (type === 'wood' || type === 'bridge') {
      for (let k = 0; k < 6; k++) {
        const a = k / 6, b = (k + 1) / 6;
        const pts = [[a, 0], [b, 0], [b, 1], [a, 1]].map(([x, y]) => [(x - y) * HW, (x + y) * HH]);
        quad(c, pts, shade(base, (rng() - 0.5) * 0.18 + (k % 2 ? -0.05 : 0.03)), 'rgba(25,14,8,0.55)');
      }
      for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(30,18,10,0.35)'; c.fillRect((rng() - 0.5) * 50, rng() * 30, 1.2, 1.2); }
    } else if (type === 'pit') {
      const g = c.createLinearGradient(0, 0, 0, 32); g.addColorStop(0, '#1b1a20'); g.addColorStop(0.45, '#050508'); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(-HW, 0, HW * 2, 32);
      c.fillStyle = '#2a2830'; quad(c, [[0, 0], [HW, HH], [HW, HH + 6], [0, 6]], '#26252c');
      quad(c, [[0, 0], [-HW, HH], [-HW, HH + 5], [0, 5]], '#1a1a20');
    }
    c.restore();
  });
}
function flowerSprite(v) {
  return sprite('fl' + v, HW * 2, HH * 2, HW, 0, (c) => {
    const rng = mulberry32(v * 71 + 5);
    const cols = ['#e8d36a', '#e87fa0', '#f1eee4', '#b48ce0'];
    for (let i = 0; i < 9; i++) {
      const x = (rng() - 0.5) * 40, y = 8 + rng() * 18;
      c.strokeStyle = '#3d5a2c'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 3); c.stroke();
      c.fillStyle = cols[Math.floor(rng() * cols.length)]; c.beginPath(); c.arc(x, y - 3.5, 1.3, 0, TAU); c.fill();
    }
  });
}

/* ------------------------------------------------------------ block art */
function faces(H) {
  return {
    L: [[-HW, HH], [0, HH * 2], [0, HH * 2 - H], [-HW, HH - H]],
    Rr: [[0, HH * 2], [HW, HH], [HW, HH - H], [0, HH * 2 - H]],
    T: [[0, -H], [HW, HH - H], [0, HH * 2 - H], [-HW, HH - H]],
  };
}
// point on a vertical face: u along bottom edge 0..1, z height in units
function facePt(side, u, z) {
  const [a, b] = side === 'L' ? [[-HW, HH], [0, HH * 2]] : [[0, HH * 2], [HW, HH]];
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u) - z * ZP];
}
function blockSprite(kind, h, v) {
  const Hp = h * ZP;
  return sprite('b_' + kind + v + '_' + h, HW * 2 + 4, Hp + HH * 2 + 14, HW + 2, Hp + 12, (c) => {
    const rng = mulberry32(v * 313 + kind.length * 17);
    const F = faces(Hp);
    c.lineWidth = 1;
    if (kind === 'stone') {
      const base = shade('#7a7880', (rng() - 0.5) * 0.1);
      quad(c, F.L, shade(base, -0.18)); quad(c, F.Rr, shade(base, -0.42));
      const courses = 5;
      for (const side of ['L', 'Rr']) {
        const s = side === 'L' ? 'L' : 'R';
        for (let k = 0; k < courses; k++) {
          const z0 = (k / courses) * h, z1 = ((k + 1) / courses) * h;
          const n = 3; const off = k % 2 ? 0.5 / n : 0;
          for (let b = -1; b < n; b++) {
            const u0 = clamp(b / n + off, 0, 1), u1 = clamp((b + 1) / n + off, 0, 1);
            if (u1 - u0 < 0.02) continue;
            const pts = [facePt(s, u0, z0), facePt(s, u1, z0), facePt(s, u1, z1), facePt(s, u0, z1)];
            const tone = (side === 'L' ? -0.16 : -0.4) + (rng() - 0.5) * 0.14;
            quad(c, pts, shade(base, tone), 'rgba(18,18,24,0.7)');
          }
        }
        // moss creeping up from the ground
        for (let i = 0; i < 6; i++) {
          const [x, y] = facePt(s, rng(), rng() * 0.35);
          c.fillStyle = `rgba(70,100,50,${0.25 + rng() * 0.25})`;
          c.beginPath(); c.ellipse(x, y, 2 + rng() * 3, 1 + rng() * 1.5, 0, 0, TAU); c.fill();
        }
      }
      quad(c, F.T, shade(base, 0.12), 'rgba(20,20,26,0.6)');
      diamond(c, h, 3); c.strokeStyle = 'rgba(255,255,255,0.08)'; c.stroke();
    } else if (kind === 'house') {
      const plaster = '#cfc2a3', timber = '#3a2a1f';
      quad(c, F.L, shade(plaster, -0.08)); quad(c, F.Rr, shade(plaster, -0.32));
      for (const s of ['L', 'R']) {
        const dk = s === 'L' ? 0 : -0.3;
        const band = (z0, z1) => quad(c, [facePt(s, 0, z0), facePt(s, 1, z0), facePt(s, 1, z1), facePt(s, 0, z1)], shade(timber, dk));
        band(0, 0.22); band(h - 0.22, h); band(0.95, 1.05);
        for (const u of [0, 0.5, 1]) {
          const u0 = clamp(u - 0.04, 0, 1), u1 = clamp(u + 0.04, 0, 1);
          quad(c, [facePt(s, u0, 0), facePt(s, u1, 0), facePt(s, u1, h), facePt(s, u0, h)], shade(timber, dk));
        }
        // lattice window
        if (rng() < 0.6) {
          const u0 = 0.14, u1 = 0.38, z0 = 1.18, z1 = 1.55;
          quad(c, [facePt(s, u0, z0), facePt(s, u1, z0), facePt(s, u1, z1), facePt(s, u0, z1)], shade('#e9dcc0', dk - 0.1), shade(timber, dk));
          c.strokeStyle = shade(timber, dk); c.lineWidth = 0.6;
          for (let k = 1; k < 4; k++) {
            const u = lerp(u0, u1, k / 4); c.beginPath(); c.moveTo(...facePt(s, u, z0)); c.lineTo(...facePt(s, u, z1)); c.stroke();
          }
          const zm = (z0 + z1) / 2; c.beginPath(); c.moveTo(...facePt(s, u0, zm)); c.lineTo(...facePt(s, u1, zm)); c.stroke();
        }
      }
      // tiled roof cap with overhang
      c.save(); c.translate(0, -2);
      quad(c, F.T.map(([x, y]) => [x * 1.08, (y + Hp) * 1.08 - Hp - 1]), '#2d3240');
      c.strokeStyle = 'rgba(160,170,200,0.25)'; c.lineWidth = 0.8;
      for (let k = 1; k < 6; k++) {
        const a = k / 6; c.beginPath();
        c.moveTo((a - 0) * HW * 1.08, (a) * HH * 1.08 - Hp - 1); c.lineTo((a - 1) * HW * 1.08, (a + 1) * HH * 1.08 - Hp - 1); c.stroke();
      }
      c.restore();
    } else if (kind === 'hedge') {
      const base = '#3f6534';
      quad(c, F.L, shade(base, -0.12)); quad(c, F.Rr, shade(base, -0.38)); quad(c, F.T, shade(base, 0.08));
      for (let i = 0; i < 60; i++) {
        const side = rng();
        let x, y;
        if (side < 0.4) { const u = rng(); x = lerp(-HW, 0, u) * 0.96; y = lerp(HH, HH * 2, u) - rng() * Hp; }
        else if (side < 0.75) { const u = rng(); x = lerp(0, HW, u) * 0.96; y = lerp(HH * 2, HH, u) - rng() * Hp; }
        else { const a = rng(), b = rng(); x = (a - b) * HW * 0.9; y = (a + b) * HH * 0.9 - Hp + 2; }
        c.fillStyle = shade(base, (rng() - 0.5) * 0.5 + (side > 0.75 ? 0.15 : side > 0.4 ? -0.3 : -0.05));
        c.beginPath(); c.arc(x, y, 1.6 + rng() * 1.6, 0, TAU); c.fill();
      }
    } else if (kind === 'bars') {
      const iron = '#2b2d33';
      quad(c, [facePt('L', 0, 0), facePt('L', 1, 0), facePt('L', 1, 0.14), facePt('L', 0, 0.14)], '#4b4a50');
      quad(c, [facePt('R', 0, 0), facePt('R', 1, 0), facePt('R', 1, 0.14), facePt('R', 0, 0.14)], '#34343a');
      c.lineWidth = 2; c.strokeStyle = iron;
      for (const s of ['L', 'R']) {
        for (let k = 0; k <= 6; k++) { c.beginPath(); c.moveTo(...facePt(s, k / 6, 0.1)); c.lineTo(...facePt(s, k / 6, h)); c.stroke(); }
        for (const z of [0.9, h - 0.05]) { c.beginPath(); c.moveTo(...facePt(s, 0, z)); c.lineTo(...facePt(s, 1, z)); c.stroke(); }
      }
      c.strokeStyle = 'rgba(200,210,230,0.25)'; c.lineWidth = 0.6;
      for (let k = 0; k <= 6; k++) { const [x, y] = facePt('L', k / 6, 0.1); c.beginPath(); c.moveTo(x + 0.6, y); c.lineTo(x + 0.6, y - (h - 0.1) * ZP); c.stroke(); }
    } else if (kind === 'gate') {
      const wood = '#5a2c1f';
      quad(c, F.L, shade(wood, -0.05)); quad(c, F.Rr, shade(wood, -0.35));
      for (const s of ['L', 'R']) {
        const dk = s === 'L' ? 0 : -0.3;
        c.strokeStyle = shade('#2a120b', dk); c.lineWidth = 0.8;
        for (let k = 1; k < 7; k++) { c.beginPath(); c.moveTo(...facePt(s, k / 7, 0)); c.lineTo(...facePt(s, k / 7, h)); c.stroke(); }
        for (const z of [0.35, 1.35]) {
          quad(c, [facePt(s, 0, z), facePt(s, 1, z), facePt(s, 1, z + 0.14), facePt(s, 0, z + 0.14)], shade('#2c2c30', dk));
          for (let k = 1; k < 7; k++) { const [x, y] = facePt(s, k / 7, z + 0.07); c.fillStyle = '#b89a5a'; c.beginPath(); c.arc(x, y, 1, 0, TAU); c.fill(); }
        }
      }
      quad(c, F.T.map(([x, y]) => [x * 1.1, (y + Hp) * 1.1 - Hp - 3]), '#26222a');
      // lock plate
      const [lx, ly] = facePt('L', 0.5, 0.9); c.fillStyle = '#c9a24a'; c.fillRect(lx - 2.5, ly - 3, 5, 6);
      c.fillStyle = '#20150c'; c.fillRect(lx - 0.6, ly - 1, 1.2, 3);
    }
  });
}

/* ------------------------------------------------------------ prop art */
function treeSprite(kind, v) {
  const tall = kind === 'bamboo' ? 175 : kind === 'pine' ? 150 : 135;
  return sprite('t_' + kind + v, 150, tall + 30, 75, tall + 8, (c) => {
    const rng = mulberry32(v * 7919 + kind.length * 3);
    if (kind === 'pine') {
      // niwaki-style pine: crooked trunk, flat cloud pads
      c.strokeStyle = '#3b2a1f'; c.lineCap = 'round';
      const pts = [[0, 0]]; let x = 0, y = 0;
      for (let i = 0; i < 5; i++) { x += (rng() - 0.5) * 18; y -= 22 + rng() * 6; pts.push([x, y]); }
      for (let i = 0; i < pts.length - 1; i++) {
        c.lineWidth = 9 - i * 1.4; c.beginPath(); c.moveTo(...pts[i]); c.lineTo(...pts[i + 1]); c.stroke();
      }
      c.strokeStyle = 'rgba(255,220,180,0.12)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-2, 0); for (const p of pts) c.lineTo(p[0] - 2, p[1]); c.stroke();
      const pads = [];
      for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i];
        const dir = i % 2 ? 1 : -1;
        const bx = px + dir * (10 + rng() * 16), by = py + 6;
        c.strokeStyle = '#3b2a1f'; c.lineWidth = 3; c.beginPath(); c.moveTo(px, py + 6); c.lineTo(bx, by); c.stroke();
        pads.push([bx, by - 4, 18 + rng() * 10 - i * 1.5]);
      }
      pads.push([pts[pts.length - 1][0], pts[pts.length - 1][1] - 6, 16]);
      for (const [px, py, r] of pads) {
        for (let k = 0; k < 9; k++) {
          const a = rng() * TAU, d = rng() * r * 0.7;
          c.fillStyle = shade('#2c4a2a', (rng() - 0.6) * 0.3);
          c.beginPath(); c.ellipse(px + Math.cos(a) * d, py + Math.sin(a) * d * 0.35, r * 0.45, r * 0.22, 0, 0, TAU); c.fill();
        }
        c.fillStyle = 'rgba(150,190,110,0.28)';
        c.beginPath(); c.ellipse(px - r * 0.2, py - r * 0.16, r * 0.5, r * 0.13, 0, 0, TAU); c.fill();
      }
    } else if (kind === 'sakura') {
      c.strokeStyle = '#2e1f1c'; c.lineWidth = 7;
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-6, -30, 4, -58); c.stroke();
      c.lineWidth = 3.5;
      c.beginPath(); c.moveTo(2, -45); c.quadraticCurveTo(-18, -62, -28, -70); c.stroke();
      c.beginPath(); c.moveTo(3, -52); c.quadraticCurveTo(20, -68, 30, -72); c.stroke();
      for (let k = 0; k < 46; k++) {
        const a = rng() * TAU, d = Math.sqrt(rng()) * 38;
        const x = Math.cos(a) * d * 1.2, y = -82 + Math.sin(a) * d * 0.62;
        c.fillStyle = shade('#e59ab5', (rng() - 0.5) * 0.35 + (y < -90 ? 0.15 : -0.05));
        c.beginPath(); c.arc(x, y, 5 + rng() * 6, 0, TAU); c.fill();
      }
      for (let k = 0; k < 30; k++) {
        c.fillStyle = 'rgba(255,240,245,0.8)';
        const a = rng() * TAU, d = rng() * 40;
        c.beginPath(); c.arc(Math.cos(a) * d * 1.2, -85 + Math.sin(a) * d * 0.55, 1 + rng(), 0, TAU); c.fill();
      }
    } else if (kind === 'bamboo') {
      const n = 5 + Math.floor(rng() * 3);
      const culms = [];
      for (let i = 0; i < n; i++) culms.push([(rng() - 0.5) * 34, (rng() - 0.5) * 12, 110 + rng() * 60, (rng() - 0.5) * 0.12]);
      culms.sort((a, b) => a[1] - b[1]);
      for (const [x, y, hgt, lean] of culms) {
        const col = shade('#6d8f3c', (rng() - 0.5) * 0.3);
        c.strokeStyle = col; c.lineWidth = 3.4;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + lean * hgt, y - hgt); c.stroke();
        c.strokeStyle = 'rgba(230,255,190,0.25)'; c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(x - 0.8, y); c.lineTo(x - 0.8 + lean * hgt, y - hgt); c.stroke();
        for (let k = 18; k < hgt; k += 16 + rng() * 6) {
          const px = x + lean * k; c.strokeStyle = shade('#3d5423', 0); c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(px - 2, y - k); c.lineTo(px + 2, y - k); c.stroke();
        }
        for (let k = 0; k < 9; k++) {
          const t = 0.55 + rng() * 0.45; const px = x + lean * hgt * t, py = y - hgt * t;
          const a = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.8);
          c.strokeStyle = shade('#4d7a2e', (rng() - 0.4) * 0.4); c.lineWidth = 2.2;
          c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a) * 12 * Math.sign(a), py + Math.sin(Math.abs(a)) * 5); c.stroke();
        }
      }
    }
  });
}
function propSprite(kind) {
  return sprite('p_' + kind, 90, 150, 45, 128, (c) => {
    if (kind === 'rock') {
      const rng = mulberry32(55);
      c.beginPath();
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU, r = 15 + rng() * 6;
        pts.push([Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.62 - 10 - (Math.sin(a) < 0 ? 8 : 0)]);
      }
      c.moveTo(...pts[0]); for (const p of pts) c.lineTo(...p); c.closePath();
      const g = c.createLinearGradient(-15, -30, 15, 6); g.addColorStop(0, '#9a99a0'); g.addColorStop(1, '#3f3e45');
      c.fillStyle = g; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.4)'; c.stroke();
      c.fillStyle = 'rgba(90,120,70,0.45)'; c.beginPath(); c.ellipse(-4, -22, 9, 3, -0.2, 0, TAU); c.fill();
    } else if (kind === 'lantern') {
      const st = '#8d8a88';
      c.fillStyle = shade(st, -0.3); c.beginPath(); c.ellipse(0, -2, 13, 6, 0, 0, TAU); c.fill();
      c.fillStyle = shade(st, -0.1); c.fillRect(-11, -9, 22, 7);
      c.fillStyle = shade(st, -0.2); c.fillRect(-4, -36, 8, 28);
      c.fillStyle = st; c.fillRect(-11, -42, 22, 6);
      c.fillStyle = shade(st, -0.25); c.fillRect(-9, -58, 18, 16);
      c.fillStyle = '#1a1208'; c.fillRect(-5, -55, 10, 10);
      c.fillStyle = shade(st, 0.05);
      c.beginPath(); c.moveTo(-17, -58); c.lineTo(17, -58); c.lineTo(9, -68); c.lineTo(-9, -68); c.closePath(); c.fill();
      c.fillStyle = shade(st, -0.2); c.beginPath(); c.arc(0, -71, 3.5, 0, TAU); c.fill();
    } else if (kind === 'jizo') {
      c.fillStyle = '#6e6c70'; c.beginPath(); c.ellipse(0, -2, 10, 5, 0, 0, TAU); c.fill();
      const g = c.createLinearGradient(-8, -30, 8, 0); g.addColorStop(0, '#a3a1a3'); g.addColorStop(1, '#5a585d');
      c.fillStyle = g; c.beginPath(); c.moveTo(-9, -2); c.quadraticCurveTo(-10, -24, 0, -26); c.quadraticCurveTo(10, -24, 9, -2); c.closePath(); c.fill();
      c.beginPath(); c.arc(0, -31, 7, 0, TAU); c.fill();
      c.fillStyle = '#b8352a'; c.beginPath(); c.moveTo(-8, -22); c.lineTo(8, -22); c.lineTo(0, -12); c.closePath(); c.fill();
      c.beginPath(); c.arc(0, -35, 6.6, Math.PI, 0); c.fill();
      c.strokeStyle = 'rgba(30,30,30,0.6)'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(-3, -31); c.lineTo(-1, -31); c.moveTo(1, -31); c.lineTo(3, -31); c.stroke();
    } else if (kind === 'pillar') {
      c.fillStyle = '#1d1515'; c.beginPath(); c.ellipse(0, -2, 11, 5.5, 0, 0, TAU); c.fill(); c.fillRect(-11, -8, 22, 6);
      const g = c.createLinearGradient(-9, 0, 9, 0); g.addColorStop(0, '#6e1a12'); g.addColorStop(0.35, '#b83322'); g.addColorStop(1, '#4e120c');
      c.fillStyle = g; c.fillRect(-8, -84, 16, 78);
      c.fillStyle = '#c9a24a'; c.fillRect(-8.5, -60, 17, 2); c.fillRect(-8.5, -30, 17, 2);
      c.fillStyle = '#1d1515'; c.fillRect(-14, -92, 28, 8);
    } else if (kind === 'shrine') {
      c.fillStyle = '#58565c'; c.beginPath(); c.ellipse(0, -2, 13, 6, 0, 0, TAU); c.fill();
      c.fillStyle = '#7b7980'; c.fillRect(-11, -16, 22, 14);
      c.fillStyle = '#9a989e'; c.beginPath(); c.ellipse(0, -16, 11, 5, 0, 0, TAU); c.fill();
      c.fillStyle = '#2d2a26'; c.beginPath(); c.ellipse(0, -17, 6, 2.6, 0, 0, TAU); c.fill();
      c.strokeStyle = '#c8b27a'; c.lineWidth = 1;
      for (const dx of [-2, 0, 2]) { c.beginPath(); c.moveTo(dx, -17); c.lineTo(dx * 1.4, -27); c.stroke(); }
    }
  });
}

/* ------------------------------------------------------------ world drawing */
function worldToScreen(x, y, z = 0) {
  return [(isoX(x, y) - R.cam.x) * R.S + R.W / 2, (isoY(x, y, z) - R.cam.y) * R.S + R.H / 2];
}

const CHUNK = 8;
R.chunks = new Map(); R.chunkLevel = null; R.chunkScale = 0;
function getChunk(L, cx, cy, sc) {
  if (R.chunkLevel !== L || R.chunkScale !== sc) { R.chunks.clear(); R.chunkLevel = L; R.chunkScale = sc; }
  const key = cx + ',' + cy;
  let ch = R.chunks.get(key);
  if (ch) { R.chunks.delete(key); R.chunks.set(key, ch); return ch; }
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const left = (x0 - y0 - CHUNK) * HW - 2, right = (x0 + CHUNK - y0) * HW + 2;
  const top = (x0 + y0) * HH - 20, bottom = (x0 + y0 + 2 * CHUNK) * HH + 4;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((right - left) * sc); cv.height = Math.ceil((bottom - top) * sc);
  const c = cv.getContext('2d');
  c.scale(sc, sc); c.translate(-left, -top); c.lineCap = 'round'; c.lineJoin = 'round';
  for (let y = y0; y < y0 + CHUNK && y < L.h; y++) for (let x = x0; x < x0 + CHUNK && x < L.w; x++) {
    const tl = L.tiles[y][x];
    if (tl.g === 'water') continue;
    const sx = isoX(x, y), sy = isoY(x, y);
    blit(c, groundSprite(tl.g, Math.floor(hash2(x, y) * 4)), sx, sy);
    if (tl.g === 'bridge') drawBridgeRails(c, L, x, y, sx, sy);
    if (tl.deco === 'flowers') blit(c, flowerSprite(Math.floor(hash2(x, y, 9) * 3)), sx, sy);
    if (tl.ao) { c.fillStyle = 'rgba(0,0,0,' + tl.ao + ')'; c.save(); c.translate(sx, sy); diamond(c); c.fill(); c.restore(); }
  }
  ch = { cv, left, top, w: right - left, h: bottom - top };
  R.chunks.set(key, ch);
  if (R.chunks.size > 30) R.chunks.delete(R.chunks.keys().next().value);
  return ch;
}

function drawWorld(G) {
  const { ctx } = R;
  const L = G.level;
  R.S = R.zoom * R.dpr * R.cam.zoomMul;
  const S = R.S;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = L.meta.sky; ctx.fillRect(0, 0, R.W, R.H);
  const cx = R.cam.x + R.cam.sx, cy = R.cam.y + R.cam.sy;
  ctx.setTransform(S, 0, 0, S, R.W / 2 - cx * S, R.H / 2 - cy * S);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // visible tile bounds
  const hw = R.W / 2 / S, hh = R.H / 2 / S;
  const corners = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx - hw, cy + hh], [cx + hw, cy + hh]]
    .map(([sx, sy]) => [(sx / HW + sy / HH) / 2, (sy / HH - sx / HW) / 2]);
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 2);
  const x1 = Math.min(L.w - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 5);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 2);
  const y1 = Math.min(L.h - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 5);
  const t = R.t;

  // ---- pass 1: ground (static layer cached in chunks, animated tiles drawn live)
  const sc0 = Math.min(R.zoom * R.dpr, 2.5);
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++)
    for (let cxk = Math.floor(x0 / CHUNK); cxk <= Math.floor(x1 / CHUNK); cxk++) {
      const ch = getChunk(L, cxk, cy, sc0);
      ctx.drawImage(ch.cv, ch.left, ch.top, ch.w, ch.h);
    }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const tl = L.tiles[y][x];
    if (tl.g !== 'water' && !tl.spike) continue;
    const sx = isoX(x, y), sy = isoY(x, y);
    if (sx < cx - hw - HW || sx > cx + hw + HW || sy < cy - hh - HH * 2 || sy > cy + hh + ZP * 4) continue;
    if (tl.g === 'water') drawWater(ctx, L, x, y, sx, sy, t);
    if (tl.stone) drawSteppingStone(ctx, sx, sy + HH, x, y);
    if (tl.spike) drawSpikes(ctx, G, x, y, sx, sy);
  }
  // decals (blood)
  for (const d of G.decals) {
    const sx = isoX(d.x, d.y), sy = isoY(d.x, d.y);
    ctx.fillStyle = `rgba(90,8,10,${d.a})`;
    ctx.beginPath(); ctx.ellipse(sx, sy, d.r * 1.4, d.r * 0.7, 0, 0, TAU); ctx.fill();
  }
  // exit glyph on floor
  for (const e of L.exits) {
    const sx = isoX(e.x + 0.5, e.y + 0.5), sy = isoY(e.x + 0.5, e.y + 0.5);
    const on = G.exitOpen();
    ctx.strokeStyle = on ? `rgba(240,210,140,${0.55 + 0.25 * Math.sin(t * 3)})` : 'rgba(120,110,100,0.35)';
    ctx.lineWidth = 1.5;
    for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.ellipse(sx, sy, 10 + r * 7 + (on ? Math.sin(t * 2 + r) * 1.5 : 0), (10 + r * 7) / 2, 0, 0, TAU); ctx.stroke(); }
  }

  // ---- pass 2: sorted drawables
  const list = [];
  const P = G.player;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const tl = L.tiles[y][x];
    if (tl.block || tl.obj) list.push({ d: x + y + 1, k: 0, x, y, tl });
  }
  for (const a of G.actors) if (a.visible !== false && a.fade > 0) list.push({ d: a.x + a.y, k: 1, a });
  for (const it of G.items) if (!it.taken) list.push({ d: it.x + it.y, k: 2, it });
  for (const p of G.projectiles) list.push({ d: p.x + p.y, k: 3, p });
  list.sort((a, b) => a.d - b.d || a.k - b.k);

  const px = P ? P.x : -99, py = P ? P.y : -99, pd = px + py;
  for (const o of list) {
    if (o.k === 0) {
      const { x, y, tl } = o;
      let alpha = 1;
      // fade tall things standing between camera and player
      if (P && P.visible !== false && o.d > pd + 0.2) {
        const dx = x + 0.5 - px, dy = y + 0.5 - py;
        if (dx > -1.2 && dy > -1.2 && dx < 2.6 && dy < 2.6 && Math.abs(dx - dy) < 2.2 && (tl.block ? tl.h > 0.9 : tl.obj !== 'rock' && tl.obj !== 'exit')) alpha = 0.32;
      }
      drawTileThing(ctx, G, x, y, tl, alpha);
    } else if (o.k === 1) drawActor(ctx, o.a, t);
    else if (o.k === 2) drawItem(ctx, o.it, t);
    else drawProjectile(ctx, o.p);
  }

  // ---- particles
  drawParticles(ctx, G.particles);
  // awareness marks + enemy health above everything
  for (const a of G.actors) if (a.alive && a.team === 'enemy') drawOverhead(ctx, a, t);
}

function drawWater(ctx, L, x, y, sx, sy, t) {
  const w = Math.sin(t * 1.3 + x * 0.7 + y * 0.45) * 0.5 + 0.5;
  const deep = L.meta.water || ['#1c3a4f', '#2b5670'];
  ctx.fillStyle = w > 0.5 ? deep[1] : deep[0];
  ctx.beginPath(); ctx.moveTo(sx, sy - 0.5); ctx.lineTo(sx + HW + 0.5, sy + HH); ctx.lineTo(sx, sy + HH * 2 + 0.5); ctx.lineTo(sx - HW - 0.5, sy + HH); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = `rgba(170,210,235,${0.12 + 0.1 * w})`; ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const o = ((t * 6 + k * 13 + hash2(x, y) * 30) % 22) + 5;
    const hx = (k ? 6 : -10) * (1 - Math.abs(o - 16) / 16);
    ctx.moveTo(sx + hx - 6, sy + o); ctx.lineTo(sx + hx + 6, sy + o - 1.5);
  }
  ctx.stroke();
  const tl = L.tiles;
  const land = (xx, yy) => { const q = tl[yy] && tl[yy][xx]; return q && q.g !== 'water' && q.g !== 'bridge'; };
  const a = land(x, y - 1), b = land(x - 1, y), c = land(x + 1, y), d = land(x, y + 1);
  if (a || b || c || d) {
    ctx.strokeStyle = `rgba(220,235,245,${0.28 + 0.14 * Math.sin(t * 2 + x + y)})`; ctx.lineWidth = 2;
    ctx.beginPath();
    if (a) { ctx.moveTo(sx, sy + 1); ctx.lineTo(sx + HW - 2, sy + HH); }
    if (b) { ctx.moveTo(sx, sy + 1); ctx.lineTo(sx - HW + 2, sy + HH); }
    if (c) { ctx.moveTo(sx + HW - 2, sy + HH); ctx.lineTo(sx, sy + HH * 2 - 1); }
    if (d) { ctx.moveTo(sx - HW + 2, sy + HH); ctx.lineTo(sx, sy + HH * 2 - 1); }
    ctx.stroke();
  }
}
function drawBridgeRails(ctx, L, x, y, sx, sy) {
  const along = L.tiles[y][x].bridgeAxis;
  ctx.strokeStyle = '#3b2616'; ctx.lineWidth = 2.2;
  const rail = (ax, ay, bx, by) => {
    const [p, q] = [[isoX(ax, ay) - isoX(x, y) + sx, isoY(ax, ay, 0.4) - isoY(x, y) + sy], [isoX(bx, by) - isoX(x, y) + sx, isoY(bx, by, 0.4) - isoY(x, y) + sy]];
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    ctx.lineWidth = 1.6;
    for (const [px, py] of [p]) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 0.4 * ZP); ctx.stroke(); }
    ctx.lineWidth = 2.2;
  };
  if (along === 'y') {
    if (!L.bridgeAt(x - 1, y)) rail(x + 0.05, y, x + 0.05, y + 1);
    if (!L.bridgeAt(x + 1, y)) rail(x + 0.95, y, x + 0.95, y + 1);
  } else {
    if (!L.bridgeAt(x, y - 1)) rail(x, y + 0.05, x + 1, y + 0.05);
    if (!L.bridgeAt(x, y + 1)) rail(x, y + 0.95, x + 1, y + 0.95);
  }
}
function drawSteppingStone(ctx, sx, sy, x, y) {
  const bob = Math.sin(R.t * 1.5 + x + y) * 0.6;
  ctx.fillStyle = 'rgba(10,25,35,0.5)'; ctx.beginPath(); ctx.ellipse(sx, sy + 3, 16, 8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#4f4d52'; ctx.beginPath(); ctx.ellipse(sx, sy + bob, 15, 7.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#76747a'; ctx.beginPath(); ctx.ellipse(sx, sy - 3 + bob, 14, 7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(110,140,90,0.5)'; ctx.beginPath(); ctx.ellipse(sx - 4, sy - 4 + bob, 5, 2, 0, 0, TAU); ctx.fill();
}
function spikeState(G, x, y) {
  const ph = (G.time * 0.42 + (x + y) * 0.06) % 1;
  if (ph > 0.62 && ph < 0.9) return 1;           // up
  if (ph > 0.52 && ph <= 0.62) return (ph - 0.52) / 0.1 * 0.3; // warning rattle
  return 0;
}
function drawSpikes(ctx, G, x, y, sx, sy) {
  const s = spikeState(G, x, y);
  ctx.save(); ctx.translate(sx, sy);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const a = (i + 0.5) / 3, b = (j + 0.5) / 3;
    const px = (a - b) * HW, py = (a + b) * HH;
    ctx.fillStyle = '#1a1a1e'; ctx.beginPath(); ctx.ellipse(px, py, 3, 1.5, 0, 0, TAU); ctx.fill();
    if (s > 0) {
      const hgt = s >= 1 ? 16 : s * 12 + Math.sin(G.time * 60) * 1;
      ctx.fillStyle = '#b9bcc4';
      ctx.beginPath(); ctx.moveTo(px - 2.5, py); ctx.lineTo(px, py - hgt); ctx.lineTo(px + 2.5, py); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(px - 0.6, py); ctx.lineTo(px, py - hgt); ctx.lineTo(px + 0.4, py); ctx.fill();
    }
  }
  ctx.restore();
}

function drawTileThing(ctx, G, x, y, tl, alpha) {
  const sx = isoX(x, y), sy = isoY(x, y);
  const cxp = isoX(x + 0.5, y + 0.5), cyp = isoY(x + 0.5, y + 0.5);
  const t = R.t;
  if (tl.block) {
    if (tl.gate && tl.open >= 1) return;
    const v = Math.floor(hash2(x, y, 2) * 3);
    const spr = blockSprite(tl.block, tl.h, v);
    if (tl.gate && tl.open > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(sx - HW - 4, sy - 200, HW * 2 + 8, 200 + HH * 2 + 2); ctx.clip();
      blit(ctx, spr, sx, sy + tl.open * tl.h * ZP, alpha); ctx.restore();
    } else blit(ctx, spr, sx, sy, alpha);
    if (tl.torch) drawTorch(ctx, G, x, y, t);
    return;
  }
  const o = tl.obj;
  if (o === 'pine' || o === 'sakura' || o === 'bamboo') {
    const v = Math.floor(hash2(x, y, 4) * 4);
    const spr = treeSprite(o, v);
    const sway = Math.sin(t * (o === 'bamboo' ? 1.4 : 0.9) + x * 0.6 + y * 0.3) * (o === 'bamboo' ? 0.05 : 0.025) * (G.level.meta.weather === 'rain' ? 1.8 : 1);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(cxp, cyp, 20, 10, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(cxp, cyp); ctx.transform(1, 0, -sway, 1, 0, 0);
    blit(ctx, spr, 0, 0, alpha); ctx.restore();
  } else if (o === 'rock' || o === 'lantern' || o === 'jizo' || o === 'pillar' || o === 'shrine') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cxp, cyp, 16, 8, 0, 0, TAU); ctx.fill();
    blit(ctx, propSprite(o), cxp, cyp, alpha);
    if (o === 'lantern') {
      const f = 0.75 + Math.sin(t * 9 + x * 3) * 0.1 + Math.sin(t * 23 + y) * 0.06;
      ctx.fillStyle = `rgba(255,190,90,${f})`; ctx.fillRect(cxp - 5, cyp - 55, 10, 10);
    } else if (o === 'shrine' && tl.lit) {
      const f = Math.sin(t * 11 + x) * 1.2;
      ctx.fillStyle = 'rgba(255,170,60,0.9)';
      ctx.beginPath(); ctx.ellipse(cxp, cyp - 30 + f * 0.3, 2.5, 5 + f, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,200,0.95)'; ctx.beginPath(); ctx.ellipse(cxp, cyp - 29, 1.2, 2.6, 0, 0, TAU); ctx.fill();
    }
  } else if (o === 'torii') {
    drawTorii(ctx, x, y, alpha);
  } else if (o === 'exit') {
    if (G.exitOpen()) {
      const g = ctx.createLinearGradient(0, cyp - 150, 0, cyp);
      g.addColorStop(0, 'rgba(255,230,170,0)'); g.addColorStop(1, `rgba(255,225,160,${0.28 + 0.08 * Math.sin(t * 3)})`);
      ctx.fillStyle = g; ctx.fillRect(cxp - 14, cyp - 150, 28, 150);
    }
  }
}
function drawTorch(ctx, G, x, y, t) {
  const L = G.level;
  const floorX = L.walkable(x + 1, y);
  const side = floorX ? 'R' : 'L';
  const [fx, fy] = facePt(side, 0.5, 1.15);
  const px = isoX(x, y) + fx, py = isoY(x, y) + fy;
  ctx.strokeStyle = '#2a2320'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py + 6); ctx.lineTo(px + (side === 'R' ? 4 : -4), py); ctx.stroke();
  const f = Math.sin(t * 13 + x * 7) * 1.5 + Math.sin(t * 29 + y) * 0.8;
  const tx = px + (side === 'R' ? 4 : -4);
  ctx.fillStyle = 'rgba(255,120,30,0.9)'; ctx.beginPath(); ctx.ellipse(tx, py - 4, 3.2, 6 + f, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,230,150,0.95)'; ctx.beginPath(); ctx.ellipse(tx, py - 3, 1.5, 3 + f * 0.4, 0, 0, TAU); ctx.fill();
}
function drawTorii(ctx, x, y, alpha) {
  ctx.globalAlpha = alpha;
  const P = (a, b, z) => [isoX(x + a, y + b), isoY(x + a, y + b, z)];
  const red = '#b2301f', dark = '#1a1414';
  const pill = (b) => {
    const [bx, by] = P(0.5, b, 0), [tx, ty] = P(0.5, b, 2.7);
    ctx.strokeStyle = dark; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 8); ctx.stroke();
    ctx.strokeStyle = red; ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,190,160,0.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx - 1.5, by - 6); ctx.lineTo(tx - 1.5, ty); ctx.stroke();
  };
  pill(0.12);
  const beam = (z, a0, a1, col, w) => {
    const [ax, ay] = P(0.5, a0, z), [bx, by] = P(0.5, a1, z);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  };
  beam(2.15, -0.1, 1.1, red, 3.5);
  pill(0.88);
  beam(2.62, -0.3, 1.3, red, 5);
  const [ax, ay] = P(0.5, -0.42, 2.95), [bx, by] = P(0.5, 1.42, 2.95), [mx, my] = P(0.5, 0.5, 2.8);
  ctx.strokeStyle = dark; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my + 4, bx, by); ctx.stroke();
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------ items & projectiles */
const ITEM_ICON = {
  key: (c) => {
    c.strokeStyle = '#e6c56a'; c.lineWidth = 2.2;
    c.beginPath(); c.arc(-4, 0, 3.5, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(-0.5, 0); c.lineTo(8, 0); c.moveTo(5, 0); c.lineTo(5, 3); c.moveTo(8, 0); c.lineTo(8, 3); c.stroke();
  },
  health: (c) => {
    c.fillStyle = '#f2efe6'; c.beginPath(); c.moveTo(0, -7); c.lineTo(7, 5); c.lineTo(-7, 5); c.closePath(); c.fill();
    c.fillStyle = '#1b2a1d'; c.fillRect(-4, 1.5, 8, 4);
  },
  shuriken: (c) => {
    c.fillStyle = '#c9ced6';
    for (let i = 0; i < 4; i++) { c.rotate(TAU / 4); c.beginPath(); c.moveTo(0, -8); c.lineTo(2.2, -2); c.lineTo(-2.2, -2); c.closePath(); c.fill(); }
    c.fillStyle = '#333'; c.beginPath(); c.arc(0, 0, 1.5, 0, TAU); c.fill();
  },
  smoke: (c) => {
    c.fillStyle = '#2a2a30'; c.beginPath(); c.arc(0, 1, 6, 0, TAU); c.fill();
    c.strokeStyle = '#c8b27a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(2, -4); c.quadraticCurveTo(5, -9, 8, -7); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(-2, -1, 2, 0, TAU); c.fill();
  },
  scroll: (c) => {
    c.fillStyle = '#e8dcbc'; c.fillRect(-7, -4, 14, 8);
    c.fillStyle = '#6a3a22'; c.fillRect(-9, -5, 3, 10); c.fillRect(6, -5, 3, 10);
    c.strokeStyle = '#b8352a'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -4); c.lineTo(0, 4); c.stroke();
  },
  weapon: (c, it) => {
    if (it.wid === 'katana') {
      c.strokeStyle = '#dfe5ec'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(-8, 8); c.quadraticCurveTo(0, -2, 10, -10); c.stroke();
      c.strokeStyle = '#2a1a14'; c.lineWidth = 3; c.beginPath(); c.moveTo(-8, 8); c.lineTo(-12, 12); c.stroke();
      c.fillStyle = '#c9a24a'; c.fillRect(-9, 6, 3, 3);
    } else if (it.wid === 'nunchaku') {
      c.strokeStyle = '#6b3d22'; c.lineWidth = 3; c.beginPath(); c.moveTo(-8, -6); c.lineTo(-2, 4); c.moveTo(3, 4); c.lineTo(9, -6); c.stroke();
      c.strokeStyle = '#aaa'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-2, 4); c.quadraticCurveTo(0, 8, 3, 4); c.stroke();
    } else {
      c.strokeStyle = '#7a5231'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(-12, 10); c.lineTo(12, -10); c.stroke();
      c.strokeStyle = '#c9a24a'; c.lineWidth = 2.8; c.beginPath(); c.moveTo(-10, 8.3); c.lineTo(-8, 6.6); c.moveTo(8, -6.6); c.lineTo(10, -8.3); c.stroke();
    }
  },
};
function drawItem(ctx, it, t) {
  const bob = Math.sin(t * 2.5 + it.x * 3) * 3;
  const sx = isoX(it.x, it.y), sy = isoY(it.x, it.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx, sy, 8, 4, 0, 0, TAU); ctx.fill();
  const glow = it.kind === 'key' || it.kind === 'weapon' ? 'rgba(255,215,120,' : 'rgba(200,220,255,';
  const g = ctx.createRadialGradient(sx, sy - 16 + bob, 0, sx, sy - 16 + bob, 18);
  g.addColorStop(0, glow + '0.45)'); g.addColorStop(1, glow + '0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - 16 + bob, 18, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(sx, sy - 16 + bob);
  if (it.kind === 'shuriken') ctx.rotate(t * 2);
  ITEM_ICON[it.kind](ctx, it);
  ctx.restore();
}
function drawProjectile(ctx, p) {
  const sx = isoX(p.x, p.y), sy = isoY(p.x, p.y, p.z);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, isoY(p.x, p.y), 4, 2, 0, 0, TAU); ctx.fill();
  if (p.kind === 'arrow') {
    const dx = isoX(p.vx, p.vy), dy = isoY(p.vx, p.vy);
    const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx - ux * 14, sy - uy * 14); ctx.lineTo(sx + ux * 8, sy + uy * 8); ctx.stroke();
    ctx.strokeStyle = '#d7d9de'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(sx + ux * 6, sy + uy * 6); ctx.lineTo(sx + ux * 10, sy + uy * 10); ctx.stroke();
    ctx.strokeStyle = '#e6e0d0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx - ux * 14 - uy * 3, sy - uy * 14 + ux * 3); ctx.lineTo(sx - ux * 10, sy - uy * 10); ctx.stroke();
  } else {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rot); ctx.scale(0.8, 0.8);
    ITEM_ICON.shuriken(ctx); ctx.restore();
    if (p.team === 'enemy') { ctx.fillStyle = 'rgba(255,80,60,0.35)'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, TAU); ctx.fill(); }
  }
}

/* ------------------------------------------------------------ characters */
const LOOKS = {
  player: { gi: '#222a45', gi2: '#2e3860', skin: '#d8ad88', band: '#c8321f', belt: '#c8321f', mask: true },
  guard: { gi: '#5c2820', gi2: '#7e3a2b', skin: '#c99a74', belt: '#2a1d16', hat: '#8a7045', armor: '#3a2a22' },
  spear: { gi: '#2d3c50', gi2: '#43607c', skin: '#c99a74', belt: '#1c1c22', hat: '#8a7045', armor: '#2a303a' },
  archer: { gi: '#4a4a2a', gi2: '#626238', skin: '#c99a74', belt: '#2a2016', hood: '#3a3a22' },
  ninja: { gi: '#26192b', gi2: '#3a2742', skin: '#c99a74', band: '#6d1a2a', belt: '#6d1a2a', mask: true, eyes: '#ff4a3a' },
  shogun: { gi: '#191316', gi2: '#2d2226', skin: '#b58a66', belt: '#c9a24a', armor: '#1e1a1c', gold: '#c9a24a', cape: '#6e1414', kabuto: true, eyes: '#ff3a2a' },
};

function ik(a, b, L, bend) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dl = Math.hypot(d[0], d[1], d[2]) || 1e-6;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  if (dl >= 2 * L) return m;
  const h = Math.sqrt(L * L - (dl / 2) * (dl / 2));
  const u = [d[0] / dl, d[1] / dl, d[2] / dl];
  const dot = bend[0] * u[0] + bend[1] * u[1] + bend[2] * u[2];
  let p = [bend[0] - u[0] * dot, bend[1] - u[1] * dot, bend[2] - u[2] * dot];
  p = v3norm(p);
  return [m[0] + p[0] * h, m[1] + p[1] * h, m[2] + p[2] * h];
}
function rotU(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
function rotPitch(p, a, pivotU) { const c = Math.cos(a), s = Math.sin(a); const f = p[0], u = p[2] - pivotU; return [f * c - u * s, p[1], pivotU + f * s + u * c]; }

// Build a posed skeleton in the actor's local frame (f = forward, r = right, u = up)
function computePose(a, t) {
  const P = a.pose || { kind: 'idle', p: 0 };
  const k = P.kind, p = clamp(P.p || 0, 0, 1);
  const mv = a.moveAmt || 0, ph = a.walkPh || 0;
  const wid = a.weaponId || 'fists';
  let crouch = 0.05, lean = 0.12 * mv, back = 0, spin = 0, pitch = 0, pitchPivot = 0.45, twist = 0;
  const A = 0.36 * mv;
  let lf = [Math.sin(ph) * A, -0.12, Math.max(0, Math.cos(ph)) * A * 0.5];
  let rf = [-Math.sin(ph) * A, 0.12, Math.max(0, -Math.cos(ph)) * A * 0.5];
  let bob = Math.abs(Math.cos(ph)) * 0.05 * mv;
  if (mv < 0.08) { lf = [0.13, -0.15, 0]; rf = [-0.11, 0.14, 0]; crouch = 0.08 + Math.sin(t * 2.3 + a.seed) * 0.012; }
  // default hands + weapon
  let rH, lH, wdir;
  const armed = wid !== 'fists';
  const swingR = [-Math.sin(ph) * 0.3 * mv, 0.24, 0.78], swingL = [Math.sin(ph) * 0.3 * mv, -0.24, 0.78];
  if (wid === 'fists') { rH = [0.26, 0.12, 1.12]; lH = [0.22, -0.13, 1.08]; wdir = [1, 0, 0]; }
  else if (wid === 'bo') { rH = [0.2, 0.14, 0.98]; lH = [0.14, -0.14, 0.92]; wdir = v3norm([0.35, -0.9, 0.28]); }
  else if (wid === 'spear') { rH = [0.15, 0.2, 0.95]; lH = [0.35, 0.05, 1.0]; wdir = v3norm([0.95, -0.05, 0.3]); }
  else if (wid === 'nunchaku') { rH = [0.2, 0.24, 0.95]; lH = [0.22, -0.13, 1.08]; wdir = v3norm([0.2, 0.2, -1]); }
  else if (wid === 'bow') { rH = swingR; lH = [0.2, -0.22, 0.95]; wdir = [0, 0, 1]; }
  else { rH = [0.27, 0.16, 0.95]; lH = null; wdir = v3norm([0.55, -0.12, 0.82]); }
  // running: arms pump, blade trails behind
  if (mv > 0.55 && k === 'idle') {
    const m = (mv - 0.55) / 0.45;
    if (wid === 'katana' || wid === 'nkatana' || wid === 'ckatana') { rH = lerpV(rH, [-0.08, 0.26, 0.82], m); wdir = v3norm(lerpV(wdir, [-0.85, 0.25, -0.2], m)); }
    else if (wid === 'fists') { rH = lerpV(rH, swingR, m); lH = lerpV(lH, swingL, m); }
    lean += 0.08 * m;
  }
  if (armed && lH === null) lH = null; // one hand unless two-handed grip set below
  let bowDraw = 0;

  if (k === 'attack') {
    const c = P.combo || 0, st = P.stage;
    if (wid === 'spear' || (wid === 'bo' && c === 1)) {
      const back_ = [-0.12, 0.18, 1.0], fwd = [0.62, 0.08, 1.02];
      rH = st === 'wind' ? lerpV(rH, back_, easeOut(p)) : st === 'act' ? lerpV(back_, fwd, easeOut(p)) : lerpV(fwd, rH, smooth(p));
      lH = [rH[0] + 0.25, rH[1] - 0.1, rH[2] + 0.02];
      wdir = v3norm([1, -0.05, 0.08]);
      lean = st === 'act' ? 0.2 : lean;
      lf = [0.28, -0.15, 0]; rf = [-0.18, 0.14, 0];
    } else if (c === 2 || wid === 'club') {
      // overhead cut
      const f0 = 0.35, f1 = 2.0, f2 = -0.65;
      const phi = st === 'wind' ? lerp(f0 + 0.6, f1, easeOut(p)) : st === 'act' ? lerp(f1, f2, easeIn(p) * 0.4 + easeOut(p) * 0.6) : lerp(f2, f0 + 0.6, smooth(p));
      rH = [Math.cos(phi) * 0.36 + 0.12, 0.08, 1.12 + Math.sin(phi) * 0.36];
      wdir = v3norm([Math.cos(phi), -0.04, Math.sin(phi)]);
      if (wid === 'fists') { wdir = [1, 0, 0]; rH = [0.3 + (st === 'act' ? p * 0.3 : 0), 0.1, 1.1]; }
      crouch = st === 'act' ? 0.08 + p * 0.1 : 0.08;
      lean = st === 'act' ? 0.1 + p * 0.15 : 0.05;
      lf = [0.3, -0.15, 0]; rf = [-0.2, 0.14, 0];
    } else {
      // horizontal cuts: combo 0 right→left, combo 1 left→right
      const th0 = c === 0 ? 1.9 : -1.8, th1 = c === 0 ? -1.5 : 1.7, rest = 0.3;
      const th = st === 'wind' ? lerp(rest, th0, easeOut(p)) : st === 'act' ? lerp(th0, th1, easeOut(p)) : lerp(th1, rest, smooth(p));
      const rr = wid === 'fists' ? 0.45 : 0.42;
      rH = [Math.cos(th) * rr, Math.sin(th) * rr, 1.02 + (c === 1 ? 0.1 : 0)];
      wdir = v3norm([Math.cos(th), Math.sin(th), -0.12]);
      if (wid === 'fists') { rH = c === 0 ? [0.28 + (st === 'act' ? p * 0.28 : 0), 0.12, 1.12] : rH; lH = c === 1 ? [0.28 + (st === 'act' ? p * 0.28 : 0), -0.12, 1.12] : lH; if (c === 1) rH = [0.2, 0.14, 1.08]; }
      if (wid === 'nunchaku') wdir = v3norm([Math.cos(th), Math.sin(th), 0.1]);
      twist = th * 0.35;
      lf = [0.26, -0.15, 0]; rf = [-0.16, 0.15, 0];
      lean = 0.12;
    }
  } else if (k === 'heavy') {
    const st = P.stage;
    if (st === 'wind') {
      crouch = 0.16 * easeOut(p); twist = 0.9 * easeOut(p);
      rH = [-0.2, 0.34, 1.0]; wdir = v3norm([-0.6, 0.8, 0.1]);
    } else if (st === 'act') {
      spin = -TAU * easeInOut(p); crouch = 0.12;
      rH = [0.1, 0.42, 1.0]; wdir = v3norm([0.3, 1, -0.08]);
    } else {
      crouch = 0.12 * (1 - p); rH = lerpV([0.1, 0.42, 1.0], rH, smooth(p)); wdir = v3norm(lerpV([0.3, 1, -0.08], wdir, smooth(p)));
    }
    if (wid === 'bo') { lH = null; }
    lf = [0.25, -0.2, 0]; rf = [-0.2, 0.2, 0];
  } else if (k === 'block') {
    crouch = 0.12; lean = 0.02;
    if (wid === 'fists') { rH = [0.22, 0.08, 1.28]; lH = [0.24, -0.1, 1.22]; }
    else if (wid === 'bo') { rH = [0.28, 0.18, 1.1]; lH = [0.28, -0.2, 1.1]; wdir = v3norm([0.05, -1, 0.35]); }
    else { rH = [0.3, 0.1, 1.12]; wdir = v3norm([0.2, -0.8, 0.55]); }
    lf = [0.18, -0.18, 0]; rf = [-0.14, 0.17, 0];
  } else if (k === 'throw') {
    const st = P.stage;
    const back_ = [-0.18, 0.26, 1.42], fwd = [0.5, 0.12, 1.05];
    rH = st === 'wind' ? lerpV(rH, back_, p) : st === 'act' ? lerpV(back_, fwd, easeOut(p)) : lerpV(fwd, rH, p);
    if (armed && wid !== 'bow') { wdir = v3norm([-0.2, 0.6, -0.8]); }
    twist = st === 'act' ? -0.5 * p : 0.3;
  } else if (k === 'bow') {
    const st = P.stage;
    lH = [0.5, -0.04, 1.12];
    bowDraw = st === 'wind' ? easeOut(p) : st === 'act' ? 1 - p : 0;
    rH = [lerp(0.46, 0.02, bowDraw), 0.1, 1.14];
    twist = -0.25;
    lf = [0.2, -0.18, 0]; rf = [-0.2, 0.14, 0];
  } else if (k === 'roll') {
    pitch = p * TAU; crouch = 0.35; pitchPivot = 0.35;
    lf = [0.12, -0.1, 0.3]; rf = [0.1, 0.1, 0.32];
    rH = [0.3, 0.15, 0.7]; lH = [0.3, -0.15, 0.7];
  } else if (k === 'jump') {
    lf = [0.16, -0.12, 0.3]; rf = [-0.06, 0.12, 0.22]; crouch = 0.1;
    if (!armed) { rH = [0.1, 0.34, 1.2]; lH = [0.1, -0.34, 1.2]; }
  } else if (k === 'hurt' || k === 'stagger') {
    const w = k === 'stagger' ? Math.sin(t * 18) * 0.1 : 0;
    back = -0.22 * (1 - p * 0.5) + w; crouch = 0.1;
    rH = [0.05, 0.36, 0.95]; lH = [0.05, -0.36, 1.0];
    if (armed) wdir = v3norm([0.2, 0.5, -0.8]);
  } else if (k === 'dash') {
    lean = 0.38; crouch = 0.15; rH = [-0.1, 0.3, 0.85]; wdir = v3norm([-0.8, 0.3, -0.2]);
    lf = [0.34, -0.14, 0]; rf = [-0.3, 0.14, 0.15];
  } else if (k === 'charge') {
    crouch = 0.2 + Math.sin(t * 30) * 0.01; lean = 0.25; rH = [-0.15, 0.32, 0.9]; wdir = v3norm([-0.7, 0.4, 0.3]);
    lf = [0.3, -0.18, 0]; rf = [-0.25, 0.16, 0];
  } else if (k === 'dead') {
    pitch = -Math.PI / 2 * easeIn(Math.min(1, p * 1.4)); pitchPivot = 0;
    rH = [0.05, 0.4, 0.9]; lH = [0.05, -0.4, 0.9];
  }

  // skeleton
  const hipU = 0.84 - crouch + bob;
  const lHip = [0, -0.1, hipU], rHip = [0, 0.1, hipU];
  const chest = [lean + back * 0.5, 0, hipU + 0.44];
  const neck = [lean * 1.1 + back * 0.8, 0, hipU + 0.54];
  const head = [lean * 1.15 + back, 0, hipU + 0.68];
  let lSh = rotU([chest[0], -0.19, chest[2] + 0.02], twist), rSh = rotU([chest[0], 0.19, chest[2] + 0.02], twist);
  const clampReach = (sh, h) => {
    const d = [h[0] - sh[0], h[1] - sh[1], h[2] - sh[2]], l = Math.hypot(...d);
    return l > 0.58 ? [sh[0] + d[0] / l * 0.58, sh[1] + d[1] / l * 0.58, sh[2] + d[2] / l * 0.58] : h;
  };
  rH = clampReach(rSh, rH);
  // two-handed grips follow the weapon
  if (lH === null) {
    if (wid === 'katana' || wid === 'nkatana' || wid === 'ckatana') lH = [rH[0] - wdir[0] * 0.13, rH[1] - wdir[1] * 0.13, rH[2] - wdir[2] * 0.13];
    else if (wid === 'bo') lH = [rH[0] - wdir[0] * 0.42, rH[1] - wdir[1] * 0.42, rH[2] - wdir[2] * 0.42];
    else lH = [0.1, -0.26, 0.8];
  }
  lH = clampReach(lSh, lH);
  const lKn = ik(lHip, lf, 0.44, [1, 0, 0]), rKn = ik(rHip, rf, 0.44, [1, 0, 0]);
  const lEl = ik(lSh, lH, 0.3, [-0.4, -0.7, -0.6]), rEl = ik(rSh, rH, 0.3, [-0.4, 0.7, -0.6]);
  const J = { lf, rf, lKn, rKn, lHip, rHip, pel: [0, 0, hipU], chest, neck, head, lSh, rSh, lEl, rEl, lH, rH };
  const tf = (q) => { let v = spin ? rotU(q, spin) : q; if (pitch) v = rotPitch(v, pitch, pitchPivot); return v; };
  for (const key in J) J[key] = tf(J[key]);
  return { J, wdir: tf(wdir), wid, bowDraw, pitch };
}
function lerpV(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

function drawActor(ctx, a, t) {
  const pose = computePose(a, t);
  const { J } = pose;
  const sc = a.scale || 1;
  const cf = Math.cos(a.face), sf = Math.sin(a.face);
  const W = (q) => {
    const f = q[0] * sc, r = q[1] * sc, u = q[2] * sc;
    const wx = a.x + f * cf - r * sf, wy = a.y + f * sf + r * cf;
    return { x: isoX(wx, wy), y: isoY(wx, wy, a.z + u), d: wx + wy };
  };
  const look = LOOKS[a.look] || LOOKS.guard;
  const flash = a.flash > 0;
  const col = (c) => (flash ? '#ffffff' : c);
  ctx.globalAlpha = a.fade !== undefined ? clamp(a.fade, 0, 1) : 1;

  // ground shadow
  const gs = W([0, 0, -a.z / sc]);
  const sh = clamp(1 - a.z * 0.35, 0.4, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.32 * sh})`; ctx.beginPath(); ctx.ellipse(gs.x, isoY(a.x, a.y), 13 * sc * sh, 6.5 * sc * sh, 0, 0, TAU); ctx.fill();

  const P = {}; for (const k in J) P[k] = W(J[k]);
  const segs = [];
  const seg = (a_, b_, w, c, extra) => segs.push({ a: a_, b: b_, w: w * sc, c, d: (a_.d + b_.d) / 2, extra });
  seg(P.lHip, P.lKn, 6.5, look.gi2); seg(P.lKn, P.lf, 5.2, look.gi2);
  seg(P.rHip, P.rKn, 6.5, look.gi2); seg(P.rKn, P.rf, 5.2, look.gi2);
  seg(P.pel, P.chest, 11.5, look.gi, 'torso');
  seg(P.lSh, P.lEl, 4.6, look.gi); seg(P.lEl, P.lH, 4, look.gi);
  seg(P.rSh, P.rEl, 4.6, look.gi); seg(P.rEl, P.rH, 4, look.gi);
  segs.sort((p, q) => p.d - q.d);

  // weapon geometry
  const wd = pose.wdir;
  const wpts = weaponPoints(a, pose, J, W);

  // outline pass then colour pass for a cohesive silhouette
  ctx.strokeStyle = 'rgba(6,6,12,0.85)';
  for (const s of segs) { ctx.lineWidth = s.w + 2.4; ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(6,6,12,0.85)'; ctx.beginPath(); ctx.arc(P.head.x, P.head.y, 6.4 * sc + 1.2, 0, TAU); ctx.fill();

  const weaponBehind = wpts && wpts.d < P.chest.d;
  if (look.band && a.tail && a.tail.length) {
    const [hfx, hfy] = headFacing(a, W);
    if (hfy > -0.15) drawRibbon(ctx, a, P.head, hfx, hfy, 6.4 * sc, sc, flash ? '#fff' : look.band);
  }
  if (weaponBehind) drawWeapon(ctx, wpts, a, flash);
  drawTrail(ctx, a);
  for (const s of segs) {
    ctx.strokeStyle = col(s.c); ctx.lineWidth = s.w;
    ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
    if (s.extra === 'torso') {
      // belt / armour plates
      const m = { x: lerp(s.a.x, s.b.x, 0.12), y: lerp(s.a.y, s.b.y, 0.12) };
      ctx.fillStyle = col(look.belt); ctx.beginPath(); ctx.ellipse(m.x, m.y, 6 * sc, 3 * sc, 0, 0, TAU); ctx.fill();
      if (look.armor) {
        ctx.strokeStyle = col(look.armor); ctx.lineWidth = 7 * sc;
        const q = { x: lerp(s.a.x, s.b.x, 0.62), y: lerp(s.a.y, s.b.y, 0.62) };
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
        if (look.gold) { ctx.strokeStyle = col(look.gold); ctx.lineWidth = 1.2 * sc; ctx.beginPath(); ctx.moveTo(q.x - 4 * sc, q.y); ctx.lineTo(q.x + 4 * sc, q.y); ctx.stroke(); }
      }
      // rim light
      ctx.strokeStyle = 'rgba(170,190,255,0.16)'; ctx.lineWidth = 2 * sc;
      ctx.beginPath(); ctx.moveTo(s.a.x - 3 * sc, s.a.y); ctx.lineTo(s.b.x - 3 * sc, s.b.y); ctx.stroke();
    }
  }
  // hands
  for (const h of [P.lH, P.rH]) { ctx.fillStyle = col(look.mask ? look.gi : look.skin); ctx.beginPath(); ctx.arc(h.x, h.y, 2.4 * sc, 0, TAU); ctx.fill(); }
  // shogun cape
  if (look.cape && pose.pitch === 0) {
    const bk = W([-0.3, 0, 0.5]), s1 = W([-0.05, -0.22, 1.3]), s2 = W([-0.05, 0.22, 1.3]);
    const wave = Math.sin(t * 4) * 3;
    ctx.fillStyle = col(look.cape); ctx.globalAlpha *= 0.92;
    if (bk.d < P.chest.d) {
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.lineTo(bk.x + 10 + wave, bk.y + 10); ctx.lineTo(bk.x - 10 + wave, bk.y + 12); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = a.fade !== undefined ? clamp(a.fade, 0, 1) : 1;
  }
  // head
  drawHead(ctx, a, P, W, look, sc, flash, t);
  if (!weaponBehind) drawWeapon(ctx, wpts, a, flash);
  // telegraph glint
  if (a.telegraph > 0 && wpts) {
    const g = wpts.tip || wpts.b;
    const r = 6 + Math.sin(t * 40) * 2;
    ctx.fillStyle = `rgba(255,${a.telegraphUnblockable ? 60 : 230},${a.telegraphUnblockable ? 40 : 170},${0.7 * a.telegraph})`;
    ctx.beginPath(); ctx.moveTo(g.x, g.y - r * 2); ctx.lineTo(g.x + r * 0.4, g.y); ctx.lineTo(g.x, g.y + r * 2); ctx.lineTo(g.x - r * 0.4, g.y); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(g.x - r * 2, g.y); ctx.lineTo(g.x, g.y + r * 0.4); ctx.lineTo(g.x + r * 2, g.y); ctx.lineTo(g.x, g.y - r * 0.4); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRibbon(ctx, a, h, fx, fy, r, sc, color) {
  if (!a.tail || !a.tail.length) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1.6 * sc; ctx.beginPath();
  ctx.moveTo(h.x - fx * r * 0.9, h.y - r * 0.45 - fy * r * 0.4);
  for (const q of a.tail) ctx.lineTo(isoX(q[0], q[1]), isoY(q[0], q[1], q[2]));
  ctx.stroke();
}
function headFacing(a, W) {
  const fwd = W([0.5, 0, 0]), base = W([0, 0, 0]);
  let fx = fwd.x - base.x, fy = fwd.y - base.y; const fl = Math.hypot(fx, fy) || 1;
  return [fx / fl, fy / fl];
}
function drawHead(ctx, a, P, W, look, sc, flash, t) {
  const h = P.head, col = (c) => (flash ? '#fff' : c);
  const fwd = W([a.pose && a.pose.kind === 'dead' ? 0 : 0.5, 0, 0]);
  const base = W([0, 0, 0]);
  let fx = fwd.x - base.x, fy = fwd.y - base.y; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
  const facingCam = fy > -0.15;
  const r = 6.4 * sc;
  ctx.fillStyle = col(look.mask ? look.gi : look.hood || look.skin);
  ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
  if (look.mask) {
    // eye slit
    if (facingCam) {
      ctx.fillStyle = col(look.skin); const ex = h.x + fx * r * 0.45, ey = h.y - 0.6 * sc;
      ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.62, 1.7 * sc, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = look.eyes || '#111';
      ctx.fillRect(ex - 2.4 * sc + fx * 1.5, ey - 0.6 * sc, 1.2 * sc, 1.2 * sc); ctx.fillRect(ex + 1.2 * sc + fx * 1.5, ey - 0.6 * sc, 1.2 * sc, 1.2 * sc);
    }
    // headband + trailing ribbon
    if (look.band) {
      ctx.strokeStyle = col(look.band); ctx.lineWidth = 1.8 * sc;
      ctx.beginPath(); ctx.ellipse(h.x, h.y - r * 0.45, r * 0.98, r * 0.35, 0, facingCam ? 0 : Math.PI, facingCam ? Math.PI : TAU); ctx.stroke();
      if (!facingCam) drawRibbon(ctx, a, h, fx, fy, r, sc, col(look.band));
    }
  } else {
    if (facingCam) {
      ctx.fillStyle = '#1b1210';
      const ex = h.x + fx * r * 0.45, ey = h.y + 0.5 * sc;
      ctx.fillRect(ex - 2.6 * sc, ey - 0.6 * sc, 1.4 * sc, 1.2 * sc); ctx.fillRect(ex + 1.2 * sc, ey - 0.6 * sc, 1.4 * sc, 1.2 * sc);
    }
    if (look.hat) {
      // jingasa: shallow cone hat
      const hb = { x: h.x, y: h.y - r * 0.55 };
      ctx.fillStyle = col(shade(look.hat, -0.3)); ctx.beginPath(); ctx.ellipse(hb.x, hb.y + 1, r * 2, r * 0.75, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = col(look.hat); ctx.beginPath(); ctx.moveTo(hb.x - r * 2, hb.y); ctx.quadraticCurveTo(hb.x, hb.y - r * 1.6, hb.x + r * 2, hb.y); ctx.quadraticCurveTo(hb.x, hb.y + r * 0.6, hb.x - r * 2, hb.y); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(hb.x, hb.y - r * 0.8); ctx.lineTo(hb.x - r, hb.y + 0.3); ctx.moveTo(hb.x, hb.y - r * 0.8); ctx.lineTo(hb.x + r, hb.y + 0.3); ctx.stroke();
    }
    if (look.hood) { ctx.fillStyle = col(look.hood); ctx.beginPath(); ctx.arc(h.x, h.y - 1.5 * sc, r * 1.05, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); }
  }
  if (look.kabuto) {
    ctx.fillStyle = col('#141012'); ctx.beginPath(); ctx.arc(h.x, h.y - 1, r * 1.1, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = col('#2a2226'); ctx.beginPath(); ctx.ellipse(h.x, h.y + 1, r * 1.6, r * 0.5, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = col(look.gold); ctx.lineWidth = 2.2 * sc;
    ctx.beginPath(); ctx.arc(h.x, h.y - r * 1.5, r * 1.3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    if (facingCam) {
      ctx.fillStyle = look.eyes; ctx.shadowColor = look.eyes; ctx.shadowBlur = 8;
      const ex = h.x + fx * r * 0.45, ey = h.y + 0.4 * sc;
      ctx.fillRect(ex - 3 * sc, ey - 0.7 * sc, 1.8 * sc, 1.3 * sc); ctx.fillRect(ex + 1.2 * sc, ey - 0.7 * sc, 1.8 * sc, 1.3 * sc);
      ctx.shadowBlur = 0;
    }
  }
}

function weaponPoints(a, pose, J, W) {
  const wid = pose.wid, d = pose.wdir, h = J.rH;
  const at = (s, base = h) => W([base[0] + d[0] * s, base[1] + d[1] * s, base[2] + d[2] * s]);
  if (wid === 'fists') return null;
  if (wid === 'katana' || wid === 'nkatana' || wid === 'ckatana') {
    const len = wid === 'ckatana' ? 1.25 : 0.95;
    const tip = at(len);
    return { kind: 'blade', a: at(-0.2), g: at(0.02), b: at(0.08), tip, d: at(len * 0.5).d, len };
  }
  if (wid === 'spear') return { kind: 'spear', a: at(-0.9), b: at(0.8), tip: at(1.05), d: at(0).d };
  if (wid === 'bo') return { kind: 'bo', a: at(-0.75), b: at(0.95), tip: at(0.95), d: at(0).d };
  if (wid === 'nunchaku') {
    const k = a.pose && (a.pose.kind === 'attack' || a.pose.kind === 'heavy') && a.pose.stage === 'act';
    const s1 = at(0.3);
    const d2 = k ? d : v3norm([0.1, 0.1, -1]);
    const e = W([h[0] + d[0] * 0.3 + d2[0] * 0.34, h[1] + d[1] * 0.3 + d2[1] * 0.34, h[2] + d[2] * 0.3 + d2[2] * 0.34]);
    const e2 = W([h[0] + d[0] * 0.34 + d2[0] * 0.66, h[1] + d[1] * 0.34 + d2[1] * 0.66, h[2] + d[2] * 0.34 + d2[2] * 0.66]);
    return { kind: 'nun', a: W(h), b: s1, c: e, e: e2, tip: e2, d: s1.d };
  }
  if (wid === 'bow') {
    const lh = W(J.lH);
    return { kind: 'bow', a: lh, rh: W(J.rH), draw: pose.bowDraw, tip: lh, d: lh.d, face: a.face, J, W };
  }
  return null;
}
function drawWeapon(ctx, w, a, flash) {
  if (!w) return;
  const sc = a.scale || 1;
  if (w.kind === 'blade') {
    ctx.strokeStyle = '#1b120e'; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.g.x, w.g.y); ctx.stroke();
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 4 * sc; ctx.beginPath(); ctx.moveTo(w.g.x, w.g.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke();
    ctx.strokeStyle = flash ? '#fff' : '#cdd5df'; ctx.lineWidth = 2.2 * sc; ctx.beginPath(); ctx.moveTo(w.b.x, w.b.y); ctx.lineTo(w.tip.x, w.tip.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.7 * sc; ctx.beginPath(); ctx.moveTo(w.b.x, w.b.y - 0.8); ctx.lineTo(w.tip.x, w.tip.y - 0.8); ctx.stroke();
  } else if (w.kind === 'spear' || w.kind === 'bo') {
    ctx.strokeStyle = w.kind === 'bo' ? '#7a5231' : '#5a3a22'; ctx.lineWidth = 2.4 * sc;
    ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke();
    if (w.kind === 'spear') {
      ctx.strokeStyle = '#d4d9e0'; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.moveTo(w.b.x, w.b.y); ctx.lineTo(w.tip.x, w.tip.y); ctx.stroke();
      ctx.fillStyle = '#9a2a1e'; ctx.beginPath(); ctx.arc(w.b.x, w.b.y, 2.2 * sc, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2.8 * sc;
      for (const [p, q] of [[w.a, w.b], [w.b, w.a]]) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(lerp(p.x, q.x, 0.06), lerp(p.y, q.y, 0.06)); ctx.stroke(); }
    }
  } else if (w.kind === 'nun') {
    ctx.strokeStyle = '#6b3d22'; ctx.lineWidth = 3 * sc;
    ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w.c.x, w.c.y); ctx.lineTo(w.e.x, w.e.y); ctx.stroke();
    ctx.strokeStyle = '#a8a8ae'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(w.b.x, w.b.y); ctx.lineTo(w.c.x, w.c.y); ctx.stroke();
  } else if (w.kind === 'bow') {
    // bow drawn in the plane containing up and the actor's side axis
    const { J, W } = w;
    const lh = J.lH;
    const top = W([lh[0], lh[1], lh[2] + 0.45]), bot = W([lh[0], lh[1], lh[2] - 0.45]);
    const bend = W([lh[0] + 0.14, lh[1], lh[2]]);
    ctx.strokeStyle = '#4a2a18'; ctx.lineWidth = 2 * sc;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.quadraticCurveTo(bend.x * 2 - (top.x + bot.x) / 2, bend.y * 2 - (top.y + bot.y) / 2, bot.x, bot.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(230,225,210,0.8)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(w.rh.x, w.rh.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
  }
}
function drawTrail(ctx, a) {
  const tr = a.trail;
  if (!tr || tr.length < 2) return;
  const now = R.t;
  ctx.beginPath();
  let first = true;
  for (const q of tr) { const x = isoX(q.tx, q.ty), y = isoY(q.tx, q.ty, q.tz); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
  for (let i = tr.length - 1; i >= 0; i--) { const q = tr[i]; ctx.lineTo(isoX(q.hx, q.hy), isoY(q.hx, q.hy, q.hz)); }
  ctx.closePath();
  const age = now - tr[tr.length - 1].t;
  const al = clamp(0.55 - age * 3.5, 0, 0.55);
  ctx.fillStyle = a.team === 'player' ? `rgba(200,225,255,${al})` : `rgba(255,120,90,${al * 0.8})`;
  ctx.fill();
}

function drawOverhead(ctx, a, t) {
  const hx = isoX(a.x, a.y), hy = isoY(a.x, a.y, a.z + 2.0 * (a.scale || 1));
  if (a.showHp > 0 && a.kind !== 'shogun') {
    const w = 26, al = clamp(a.showHp, 0, 1);
    ctx.fillStyle = `rgba(10,8,12,${0.7 * al})`; ctx.fillRect(hx - w / 2 - 1, hy - 1, w + 2, 4);
    ctx.fillStyle = `rgba(200,50,40,${al})`; ctx.fillRect(hx - w / 2, hy, w * (a.hp / a.maxHp), 2);
  }
  if (a.mark) {
    const m = a.mark;
    ctx.font = `700 ${m === '!' ? 15 : 12}px "Zen Kaku Gothic New", sans-serif`;
    ctx.textAlign = 'center';
    const pop = a.markT > 0 ? 1 + a.markT * 0.8 : 1;
    ctx.save(); ctx.translate(hx, hy - 8); ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(m, 1, 1);
    ctx.fillStyle = m === '!' ? '#ff5a3a' : `rgba(255,220,120,${0.5 + a.aware * 0.5})`;
    ctx.fillText(m, 0, 0);
    ctx.restore();
  }
}

/* ------------------------------------------------------------ particles */
function drawParticles(ctx, parts) {
  for (const p of parts) {
    const sx = isoX(p.x, p.y), sy = isoY(p.x, p.y, p.z);
    const lf = p.life / p.max;
    if (p.type === 'spark') {
      ctx.strokeStyle = `rgba(255,${200 + 55 * lf | 0},${120 * lf | 0},${lf})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - isoX(p.vx, p.vy) * 0.03, sy - (isoY(p.vx, p.vy, p.vz)) * 0.03); ctx.stroke();
    } else if (p.type === 'blood') {
      ctx.fillStyle = `rgba(140,14,18,${Math.min(1, lf * 1.5)})`; ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, TAU); ctx.fill();
    } else if (p.type === 'smoke') {
      const r = p.size * (1.6 - lf * 0.6);
      ctx.fillStyle = `rgba(${p.c || '170,170,180'},${0.5 * lf})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    } else if (p.type === 'dust') {
      ctx.fillStyle = `rgba(190,170,140,${0.35 * lf})`; ctx.beginPath(); ctx.arc(sx, sy, p.size * (1.5 - lf * 0.5), 0, TAU); ctx.fill();
    } else if (p.type === 'splash') {
      ctx.fillStyle = `rgba(190,220,240,${lf})`; ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, TAU); ctx.fill();
    } else if (p.type === 'ring') {
      const r = (1 - lf) * p.size;
      ctx.strokeStyle = `rgba(${p.c || '255,200,120'},${lf * 0.9})`; ctx.lineWidth = 3 * lf + 1;
      ctx.beginPath(); ctx.ellipse(sx, sy, r * HW, r * HH, 0, 0, TAU); ctx.stroke();
    } else if (p.type === 'glint') {
      ctx.fillStyle = `rgba(255,240,200,${lf})`; ctx.beginPath(); ctx.arc(sx, sy, p.size * lf, 0, TAU); ctx.fill();
    } else if (p.type === 'text') {
      ctx.font = `700 ${p.size}px "DotGothic16", monospace`; ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(0,0,0,${lf})`; ctx.fillText(p.text, sx + 1, sy + 1);
      ctx.fillStyle = p.c ? `rgba(${p.c},${lf})` : `rgba(255,240,210,${lf})`; ctx.fillText(p.text, sx, sy);
    } else if (p.type === 'ember') {
      ctx.fillStyle = `rgba(255,${140 + 80 * lf | 0},60,${lf})`; ctx.fillRect(sx, sy, 1.6, 1.6);
    }
  }
}

/* ------------------------------------------------------------ light + post */
function drawLighting(G) {
  const { lctx, lcv, ctx } = R;
  const L = G.level;
  const S = R.S, k = lcv.width / R.W;
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, lcv.width, lcv.height);
  lctx.fillStyle = L.meta.ambient; lctx.fillRect(0, 0, lcv.width, lcv.height);
  lctx.globalCompositeOperation = 'destination-out';
  const lights = G.collectLights();
  const cx = R.cam.x + R.cam.sx, cy = R.cam.y + R.cam.sy;
  for (const l of lights) {
    const sx = ((isoX(l.x, l.y) - cx) * S + R.W / 2) * k, sy = ((isoY(l.x, l.y, l.z || 0) - cy) * S + R.H / 2) * k;
    const r = l.r * HW * S * k;
    if (sx < -r || sy < -r || sx > lcv.width + r || sy > lcv.height + r) continue;
    const g = lctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(0,0,0,${l.i})`); g.addColorStop(0.5, `rgba(0,0,0,${l.i * 0.55})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g; lctx.beginPath(); lctx.ellipse(sx, sy, r, r * 0.62, 0, 0, TAU); lctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lcv, 0, 0, R.W, R.H);
  // warm additive glow
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (!l.c) continue;
    const sx = (isoX(l.x, l.y) - cx) * S + R.W / 2, sy = (isoY(l.x, l.y, l.z || 0) - cy) * S + R.H / 2;
    const r = l.r * HW * S * 0.55;
    if (sx < -r || sy < -r || sx > R.W + r || sy > R.H + r) continue;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(${l.c},${0.22 * l.i})`); g.addColorStop(1, `rgba(${l.c},0)`);
    ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // colour grade
  const gr = ctx.createLinearGradient(0, 0, 0, R.H);
  gr.addColorStop(0, L.meta.tintTop); gr.addColorStop(1, L.meta.tintBot);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, R.W, R.H);
}

function drawWeather(G, dt) {
  const { ctx } = R;
  const w = G.weather;
  const kind = G.level.meta.weather;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const p of w) {
    if (kind === 'rain') {
      ctx.strokeStyle = `rgba(170,190,230,${p.a})`; ctx.lineWidth = R.dpr;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 4 * R.dpr, p.y + 18 * R.dpr); ctx.stroke();
    } else if (kind === 'petals') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.abs(Math.sin(p.r * 2)) + 0.2);
      ctx.fillStyle = `rgba(245,180,200,${p.a})`; ctx.beginPath(); ctx.ellipse(0, 0, 3.5 * R.dpr, 2 * R.dpr, 0, 0, TAU); ctx.fill(); ctx.restore();
    } else if (kind === 'leaves') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.abs(Math.sin(p.r * 1.5)) + 0.2);
      ctx.fillStyle = `rgba(${p.c},${p.a})`; ctx.beginPath(); ctx.ellipse(0, 0, 4 * R.dpr, 2 * R.dpr, 0, 0, TAU); ctx.fill(); ctx.restore();
    } else {
      ctx.fillStyle = `rgba(255,${150 + (p.c | 0)},70,${p.a * (0.6 + 0.4 * Math.sin(p.r * 5))})`;
      ctx.fillRect(p.x, p.y, 2 * R.dpr, 2 * R.dpr);
    }
  }
}

function drawPost() {
  const { ctx } = R;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(R.vig, 0, 0);
  if (R.crt) {
    ctx.fillStyle = ctx.createPattern(R.scan, 'repeat'); ctx.fillRect(0, 0, R.W, R.H);
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(255,200,150,0.05)'; ctx.fillRect(0, 0, R.W, R.H);
    ctx.globalCompositeOperation = 'source-over';
  }
}
