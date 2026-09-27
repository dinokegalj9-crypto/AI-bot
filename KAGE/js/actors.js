'use strict';
/* ============================================================
   KAGE · World + Actors — level grid, collision, pathfinding,
   player controller, enemy AI, combat resolution.
   ============================================================ */

/* ------------------------------------------------------------ level */
class Level {
  constructor(idx) {
    const meta = LEVELS[idx];
    this.idx = idx; this.meta = meta;
    const rows = meta.map;
    this.h = rows.length; this.w = rows[0].length;
    this.tiles = []; this.spawns = []; this.exits = []; this.shrines = []; this.lamps = [];
    const floorDef = TILE[meta.floor];
    for (let y = 0; y < this.h; y++) {
      const row = [];
      for (let x = 0; x < this.w; x++) {
        let c = rows[y][x];
        if (SPAWN[c]) {
          this.spawns.push({ type: SPAWN[c], x: x + 0.5, y: y + 0.5, ch: c });
          c = this.groundFor(rows, x, y, meta.floor);
        }
        const d = TILE[c] || floorDef;
        const t = {
          c, g: d.g || floorDef.g, deco: d.deco, stone: !!d.stone, spike: !!d.spike, deadly: !!d.deadly,
          block: d.block || null, h: d.h || 0, opaque: !!d.opaque, gate: !!d.gate, open: 0, opening: false,
          torch: !!d.torch, obj: d.obj || null, rad: d.rad || 0, lit: false, ao: 0,
        };
        row.push(t);
        if (c === 'X') this.exits.push({ x, y });
        if (c === 'C') this.shrines.push({ x, y, t });
        if (c === 'L' || d.torch) this.lamps.push({ x, y, torch: !!d.torch });
      }
      this.tiles.push(row);
    }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const t = this.tiles[y][x];
      if (t.g === 'bridge') {
        const wx = this.isWaterish(x - 1, y) || this.isWaterish(x + 1, y);
        t.bridgeAxis = wx ? 'y' : 'x';
      }
      if (!t.block && !t.deadly) {
        const b1 = this.tile(x - 1, y), b2 = this.tile(x, y - 1), b3 = this.tile(x - 1, y - 1);
        t.ao = (b1 && b1.block && b1.h > 1 ? 0.14 : 0) + (b2 && b2.block && b2.h > 1 ? 0.14 : 0) + (b3 && b3.block && b3.h > 1 && !(b1 && b1.block) && !(b2 && b2.block) ? 0.08 : 0);
      }
    }
    this.explored = new Uint8Array(this.w * this.h);
    this.miniDirty = true;
  }
  groundFor(rows, x, y, floor) {
    const count = {};
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = rows[y + dy] && rows[y + dy][x + dx];
      if (c && '.,:=_b'.includes(c)) count[c] = (count[c] || 0) + 1;
    }
    let best = floor, n = 0;
    for (const k in count) if (count[k] > n) { n = count[k]; best = k; }
    return best === ',' ? '.' : best;
  }
  tile(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.tiles[y][x] : null; }
  isWaterish(x, y) { const t = this.tile(x, y); return t && t.g === 'water'; }
  bridgeAt(x, y) { const t = this.tile(x, y); return t && t.g === 'bridge'; }
  walkable(x, y) { const t = this.tile(x, y); return !!t && !this.isSolidTile(t) && !t.deadly; }
  isSolidTile(t) { return (t.block && !(t.gate && t.open >= 1)) || (t.rad > 0); }
  opaqueAt(x, y) {
    const t = this.tile(Math.floor(x), Math.floor(y));
    return !t || (t.opaque && !(t.gate && t.open >= 1));
  }
  los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.25);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.opaqueAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }
  // grid passability for AI pathing
  passable(x, y) {
    const t = this.tile(x, y);
    return !!t && !this.isSolidTile(t) && !t.deadly && !t.spike && !t.stone;
  }
  path(sx, sy, tx, ty, maxNodes = 1400) {
    sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
    if (sx === tx && sy === ty) return null;
    const W = this.w, key = (x, y) => y * W + x;
    const prev = new Map(); prev.set(key(sx, sy), -1);
    const q = [sx, sy]; let qi = 0, found = false, nodes = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (qi < q.length && nodes++ < maxNodes) {
      const x = q[qi++], y = q[qi++];
      if (x === tx && y === ty) { found = true; break; }
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (prev.has(k)) continue;
        if (!(nx === tx && ny === ty) && !this.passable(nx, ny)) continue;
        if (dx && dy && (!this.passable(x + dx, y) || !this.passable(x, y + dy))) continue;
        prev.set(k, key(x, y)); q.push(nx, ny);
      }
    }
    if (!found) return null;
    const out = [];
    let k = key(tx, ty);
    while (k !== -1 && k !== key(sx, sy)) { out.push([(k % W) + 0.5, Math.floor(k / W) + 0.5]); k = prev.get(k); }
    return out.reverse();
  }
}

/* ------------------------------------------------------------ collision */
function collide(G, a, isPlayer) {
  const L = G.level, r = a.r;
  for (let pass = 0; pass < 2; pass++) {
    const x0 = Math.floor(a.x - r) - 1, x1 = Math.floor(a.x + r) + 1;
    const y0 = Math.floor(a.y - r) - 1, y1 = Math.floor(a.y + r) + 1;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = L.tile(tx, ty);
      let boxSolid = !t || (t.block && !(t.gate && t.open >= 1));
      // nobody walks off a ledge by accident; water and pits only take failed jumps
      if (t && t.deadly && a.z <= 0.05) boxSolid = true;
      if (t && !boxSolid && t.block === 'hedge' && a.z > 0.9) boxSolid = false;
      if (boxSolid) {
        const nx = clamp(a.x, tx, tx + 1), ny = clamp(a.y, ty, ty + 1);
        let dx = a.x - nx, dy = a.y - ny; const d = Math.hypot(dx, dy);
        if (d < r) {
          if (t && t.gate && isPlayer && t.open === 0) G.touchGate(tx, ty, t);
          if (d > 1e-5) { a.x = nx + (dx / d) * r; a.y = ny + (dy / d) * r; }
          else {
            const pl = a.x - tx, pr = tx + 1 - a.x, pu = a.y - ty, pd = ty + 1 - a.y;
            const m = Math.min(pl, pr, pu, pd);
            if (m === pl) a.x = tx - r; else if (m === pr) a.x = tx + 1 + r; else if (m === pu) a.y = ty - r; else a.y = ty + 1 + r;
          }
          a.bumped = true;
        }
      } else if (t && t.rad > 0) {
        const cx = tx + 0.5, cy = ty + 0.5, rr = t.rad + r;
        const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy);
        if (d < rr && d > 1e-5) { a.x = cx + (dx / d) * rr; a.y = cy + (dy / d) * rr; a.bumped = true; }
      }
    }
  }
}

/* ------------------------------------------------------------ definitions */
const WEAPONS = {
  fists: { name: 'Šake', kanji: '拳', dmg: 9, reach: 1.0, arc: 1.5, speed: 1.35 },
  katana: { name: 'Katana', kanji: '刀', dmg: 22, reach: 1.5, arc: 2.1, speed: 1.0 },
  nunchaku: { name: 'Nunčake', kanji: '双', dmg: 14, reach: 1.3, arc: 2.7, speed: 1.55 },
  bo: { name: 'Bo štap', kanji: '棒', dmg: 18, reach: 2.0, arc: 1.7, speed: 0.88 },
};
const ENEMY = {
  guard: { hp: 70, speed: 2.4, look: 'guard', weapon: 'katana', reach: 1.4, arc: 1.8, dmg: 14, wind: 0.5, act: 0.13, rec: 0.55, block: 0.3, dodge: 0, sight: 6.5, combo: 1 },
  spear: { hp: 80, speed: 2.1, look: 'spear', weapon: 'spear', reach: 2.05, arc: 0.8, dmg: 17, wind: 0.62, act: 0.14, rec: 0.6, block: 0.2, dodge: 0, sight: 6.5, combo: 1, thrust: true },
  archer: { hp: 45, speed: 2.3, look: 'archer', weapon: 'bow', reach: 1.0, arc: 1.4, dmg: 11, wind: 0.85, act: 0.1, rec: 0.7, block: 0, dodge: 0.1, sight: 8.5, ranged: true },
  ninja: { hp: 55, speed: 3.4, look: 'ninja', weapon: 'nkatana', reach: 1.3, arc: 2.0, dmg: 9, wind: 0.32, act: 0.1, rec: 0.35, block: 0.12, dodge: 0.4, sight: 7, combo: 2, throws: true },
  shogun: { hp: 700, speed: 2.7, look: 'shogun', weapon: 'ckatana', reach: 2.0, arc: 2.3, dmg: 20, wind: 0.55, act: 0.14, rec: 0.42, block: 0.28, dodge: 0, sight: 12, combo: 3, scale: 1.32, boss: true },
};
const DIFF = [
  { name: 'Lako', dmg: 0.6, hp: 0.8 },
  { name: 'Normalno', dmg: 1, hp: 1 },
  { name: 'Teško', dmg: 1.45, hp: 1.25 },
];

let actorSeed = 1;
class Actor {
  constructor(kind, x, y) {
    this.kind = kind; this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0; this.kvx = 0; this.kvy = 0;
    this.face = Math.PI / 4; this.r = 0.28; this.scale = 1;
    this.alive = true; this.fade = 1; this.flash = 0; this.inv = 0; this.showHp = 0;
    this.moveAmt = 0; this.walkPh = 0; this.pose = { kind: 'idle', p: 0 };
    this.atk = null; this.stun = 0; this.trail = []; this.tail = [];
    this.seed = actorSeed++ * 1.7; this.stepAcc = 0; this.grounded = true;
  }
}

/* ------------------------------------------------------------ attacks */
function startAttack(G, a, type, combo = 0) {
  const isP = a.team === 'player';
  let wind, act, rec, dmg, reach, arc, kb = 2.2, heavy = false, unblockable = false;
  if (isP) {
    const W = WEAPONS[a.weaponId];
    const sp = W.speed;
    reach = W.reach; arc = W.arc; dmg = W.dmg;
    if (type === 'heavy') { wind = 0.3; act = 0.22; rec = 0.32; dmg *= 2.1; arc = TAU; reach += 0.25; kb = 6; heavy = true; }
    else if (type === 'throw') { wind = 0.08; act = 0.08; rec = 0.16; }
    else {
      wind = 0.08 / sp; act = 0.11 / sp; rec = 0.2 / sp;
      if (combo === 2) { dmg *= 1.5; kb = 4.5; wind *= 1.4; }
    }
  } else {
    const C = a.cfg;
    wind = C.wind * (a.rage ? 0.75 : 1); act = C.act; rec = C.rec * (a.rage ? 0.7 : 1); dmg = C.dmg; reach = C.reach; arc = C.arc;
    if (type === 'bow' || type === 'throw') { wind = type === 'throw' ? 0.35 : C.wind; act = 0.1; rec = C.rec; }
    if (combo > 0) wind *= 0.6;
  }
  a.atk = { type, combo, stage: 'wind', t: 0, wind, act, rec, dmg, reach, arc, kb, heavy, unblockable, hit: new Set(), fired: false };
  a.trail = [];
  if (!isP && type !== 'throw') { a.telegraph = 1; a.telegraphUnblockable = unblockable; }
  if (isP && type === 'heavy') { a.stamina -= 30; a.stamRegenDelay = 0.8; }
}

function poseKindFor(a) {
  const t = a.atk.type;
  if (t === 'heavy') return 'heavy';
  if (t === 'bow') return 'bow';
  if (t === 'throw') return 'throw';
  if (t === 'thrust') return 'attack';
  return 'attack';
}

function updateAttack(G, a, dt) {
  const k = a.atk;
  k.t += dt;
  const dur = k[k.stage];
  const p = clamp(k.t / dur, 0, 1);
  a.pose = { kind: poseKindFor(a), stage: k.stage, p, combo: a.weaponId === 'spear' ? 0 : k.combo };
  if (a.weaponId === 'spear') a.pose.combo = 0;
  if (k.type === 'thrust' && a.weaponId !== 'spear') a.pose.combo = 1;
  if (k.stage === 'wind' && a.team !== 'player' && a.target && !a.cfg.boss) {
    a.face = turnToward(a.face, Math.atan2(a.target.y - a.y, a.target.x - a.x), dt * 3.2);
  }
  if (k.stage === 'act') {
    if (k.type === 'bow' || k.type === 'throw') {
      if (!k.fired) { k.fired = true; fireProjectile(G, a, k.type === 'bow' ? 'arrow' : 'shuriken'); }
    } else {
      meleeHits(G, a, k);
      recordTrail(a);
    }
  }
  if (k.t >= dur) {
    k.t = 0;
    if (k.stage === 'wind') {
      k.stage = 'act'; a.telegraph = 0;
      if (k.type !== 'bow' && k.type !== 'throw') {
        Sound.sfx(k.heavy ? 'heavy' : 'swing', a.team === 'player' ? 1 : 0.7);
        const lunge = k.heavy ? 2 : a.team === 'player' ? 3.2 : (a.cfg && a.cfg.thrust ? 3 : 2.4);
        let doLunge = true;
        if (a.team === 'player' && a.lockTarget) doLunge = dist(a.x, a.y, a.lockTarget.x, a.lockTarget.y) > k.reach * 0.6;
        if (a.team !== 'player' && a.target) doLunge = dist(a.x, a.y, a.target.x, a.target.y) > k.reach * 0.55;
        if (doLunge) { a.kvx += Math.cos(a.face) * lunge; a.kvy += Math.sin(a.face) * lunge; }
      }
    } else if (k.stage === 'act') k.stage = 'rec';
    else { const pc = k.combo; a.atk = null; a.pose = { kind: 'idle', p: 0 }; onAttackEnd(G, a, pc); return; }
  }
  // player combo chaining
  if (a.team === 'player' && k.stage === 'rec' && a.buffer && k.type === 'light' && k.combo < 2 && p > 0.25) {
    a.buffer = false; const c = k.combo + 1; aimAssist(G, a); startAttack(G, a, 'light', c);
  }
}
function onAttackEnd(G, a, prevCombo) {
  if (a.team === 'enemy') {
    if (a.comboLeft > 0 && a.alive && a.stun <= 0) { a.comboLeft--; startAttack(G, a, a.cfg.thrust ? 'thrust' : 'light', Math.min(2, prevCombo + 1)); return; }
    a.cool = rnd(0.7, 1.6) * (a.rage ? 0.6 : 1); releaseToken(G, a);
  }
}
function recordTrail(a) {
  const pose = computePose(a, R.t);
  const h = pose.J.rH, d = pose.wdir;
  const len = a.weaponId === 'fists' ? 0.15 : a.weaponId === 'bo' ? 0.95 : a.weaponId === 'spear' ? 1.05 : a.weaponId === 'ckatana' ? 1.25 : 0.95;
  const sc = a.scale, cf = Math.cos(a.face), sf = Math.sin(a.face);
  const W = (q) => [a.x + q[0] * sc * cf - q[1] * sc * sf, a.y + q[0] * sc * sf + q[1] * sc * cf, a.z + q[2] * sc];
  const hp = W([h[0] + d[0] * 0.15, h[1] + d[1] * 0.15, h[2] + d[2] * 0.15]);
  const tp = W([h[0] + d[0] * len, h[1] + d[1] * len, h[2] + d[2] * len]);
  a.trail.push({ hx: hp[0], hy: hp[1], hz: hp[2], tx: tp[0], ty: tp[1], tz: tp[2], t: R.t });
  if (a.trail.length > 9) a.trail.shift();
}

function meleeHits(G, a, k) {
  const foes = a.team === 'player' ? G.actors.filter((e) => e.team === 'enemy') : [G.player];
  for (const t of foes) {
    if (!t.alive || k.hit.has(t)) continue;
    const d = dist(a.x, a.y, t.x, t.y);
    if (d > k.reach * a.scale + t.r) continue;
    if (Math.abs(a.z - t.z) > 1.1) continue;
    const ang = Math.atan2(t.y - a.y, t.x - a.x);
    if (k.arc < TAU && Math.abs(angDiff(a.face, ang)) > k.arc / 2 + 0.15) continue;
    if (!G.level.los(a.x, a.y, t.x, t.y)) continue;
    k.hit.add(t);
    applyHit(G, a, t, { dmg: k.dmg, kb: k.kb, heavy: k.heavy, unblockable: k.unblockable, melee: true, dir: ang });
  }
  // player blades knock projectiles out of the air
  if (a.team === 'player') {
    for (const p of G.projectiles) {
      if (p.team !== 'enemy') continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d > k.reach + 0.2) continue;
      if (k.arc < TAU && Math.abs(angDiff(a.face, Math.atan2(p.y - a.y, p.x - a.x))) > k.arc / 2) continue;
      reflectProjectile(G, p);
    }
  }
}

function applyHit(G, src, tgt, info) {
  if (!tgt.alive || tgt.inv > 0) return 'miss';
  const toSrc = Math.atan2(src.y - tgt.y, src.x - tgt.x);
  const facing = Math.abs(angDiff(tgt.face, toSrc)) < 1.55;
  let dmg = info.dmg;

  if (tgt.team === 'player') {
    dmg *= DIFF[G.diff].dmg;
    if (tgt.blocking && facing && !info.unblockable) {
      if (tgt.blockT < 0.26) { // perfect parry
        G.fx.sparks(tgt.x + Math.cos(toSrc) * 0.5, tgt.y + Math.sin(toSrc) * 0.5, 1.1, 22);
        Sound.sfx('parry'); G.slowmo(0.35, 0.3); G.shake(5); G.popText(tgt.x, tgt.y, 2.2, 'PARIRANJE', '255,225,140');
        G.stats.parries++;
        if (info.melee && src.team === 'enemy') { staggerEnemy(G, src, src.cfg.boss ? 1.0 : 1.3); }
        tgt.stamina = Math.min(100, tgt.stamina + 15);
        return 'parry';
      }
      tgt.stamina -= 10 + dmg * 0.7; tgt.stamRegenDelay = 0.7;
      G.fx.sparks(tgt.x + Math.cos(toSrc) * 0.45, tgt.y + Math.sin(toSrc) * 0.45, 1.1, 10);
      Sound.sfx('clang'); G.shake(2);
      tgt.kvx -= Math.cos(toSrc) * 2.5; tgt.kvy -= Math.sin(toSrc) * 2.5;
      if (tgt.stamina <= 0) {
        tgt.stamina = 0; tgt.blocking = false; tgt.stun = 0.7; tgt.pose = { kind: 'stagger', p: 0 };
        G.popText(tgt.x, tgt.y, 2.2, 'GARDA SLOMLJENA', '255,120,100');
        dmg *= 0.5;
      } else return 'block';
    }
  } else {
    dmg *= src.team === 'player' ? 1 : 1;
    const unaware = tgt.state === 'patrol' || tgt.state === 'suspicious' || tgt.state === 'confused' || tgt.state === 'search';
    const behind = !facing;
    if (src.team === 'player' && info.melee && !tgt.cfg.boss && (tgt.state === 'confused' || (unaware && behind))) {
      dmg = tgt.hp + 1; G.stats.stealth++;
      Sound.sfx('stealth'); G.slowmo(0.7, 0.25); G.popText(tgt.x, tgt.y, 2.3, '暗殺 · TIHI UDARAC', '230,215,255');
    } else if (tgt.state === 'block' && facing && !info.heavy && src.team === 'player') {
      G.fx.sparks(tgt.x + Math.cos(toSrc) * 0.45, tgt.y + Math.sin(toSrc) * 0.45, 1.1, 10);
      Sound.sfx('clang');
      src.kvx -= Math.cos(toSrc) * -2; src.kvy -= Math.sin(toSrc) * -2;
      tgt.blockHits = (tgt.blockHits || 0) + 1;
      if (tgt.blockHits >= 3) { staggerEnemy(G, tgt, 0.9); tgt.blockHits = 0; }
      else if (Math.random() < 0.5) { tgt.stateT = 0; tgt.state = 'chase'; tgt.cool = 0; }
      return 'block';
    } else if (tgt.state === 'block' && info.heavy) {
      staggerEnemy(G, tgt, 1.0); G.popText(tgt.x, tgt.y, 2.2, 'PROBOJ', '255,200,120');
    }
    if (tgt.state === 'stagger' && dmg < tgt.hp) { dmg *= 1.6; G.popText(tgt.x, tgt.y, 2.0, 'KRITIČNO', '255,210,120'); }
    if (!info.melee && unaware) dmg *= 1.5;
  }

  tgt.hp -= dmg;
  tgt.flash = 0.09; tgt.showHp = 3;
  const dx = Math.cos(info.dir), dy = Math.sin(info.dir);
  G.fx.blood(tgt.x, tgt.y, 1.0, dx, dy, info.heavy ? 16 : 9);
  G.hitstop(info.heavy ? 0.1 : 0.055);
  G.shake(info.heavy ? 7 : 3.5);
  Sound.sfx(src.weaponId === 'fists' || src.weaponId === 'bo' || src.weaponId === 'nunchaku' ? 'hit' : 'slice', 1);
  if (tgt.team === 'player') { Sound.sfx('hurt'); tgt.inv = 0.45; G.damageFlash = 0.35; G.stats.damage += dmg; }
  const kbMul = tgt.cfg && tgt.cfg.boss ? 0.25 : 1;
  tgt.kvx += dx * info.kb * kbMul; tgt.kvy += dy * info.kb * kbMul;

  if (tgt.hp <= 0) { killActor(G, tgt, src); return 'kill'; }
  if (tgt.team === 'enemy') {
    alertEnemy(G, tgt, true);
    const armour = tgt.cfg.boss && !info.heavy && tgt.state !== 'stagger';
    if (!armour && tgt.state !== 'stagger') {
      tgt.atk = null; tgt.telegraph = 0; releaseToken(G, tgt);
      tgt.stun = info.heavy ? 0.55 : 0.28; tgt.pose = { kind: 'hurt', p: 0 };
      if (tgt.state !== 'stagger') tgt.state = 'hurt';
    }
  } else {
    if (!info.heavyArmor) { tgt.atk = null; tgt.stun = Math.max(tgt.stun, 0.25); tgt.pose = { kind: 'hurt', p: 0 }; tgt.state = 'free'; }
  }
  return 'hit';
}

function staggerEnemy(G, e, t) {
  e.atk = null; e.telegraph = 0; releaseToken(G, e);
  e.state = 'stagger'; e.stun = t; e.pose = { kind: 'stagger', p: 0 };
  e.comboLeft = 0;
}

function killActor(G, a, src) {
  a.alive = false; a.hp = 0; a.atk = null; a.telegraph = 0; a.pose = { kind: 'dead', p: 0 }; a.deadT = 0;
  a.mark = null;
  if (a.team === 'enemy') {
    releaseToken(G, a);
    G.stats.kills++;
    G.fx.blood(a.x, a.y, 0.9, Math.cos(a.face + Math.PI), Math.sin(a.face + Math.PI), 22);
    G.decal(a.x, a.y, 7 + Math.random() * 4);
    Sound.sfx('death', 0.6);
    if (a.cfg.boss) { G.onBossDown(a); return; }
    const r = Math.random();
    if (r < 0.28) G.dropItem(a.x, a.y, 'health');
    else if (r < 0.46) G.dropItem(a.x, a.y, 'shuriken');
    if (G.actors.every((e) => e.team !== 'enemy' || !e.alive || e.state === 'patrol')) G.slowmo(0.5, 0.35);
  } else {
    Sound.sfx('death'); G.slowmo(1.2, 0.3);
    G.onPlayerDown();
  }
}

/* ------------------------------------------------------------ projectiles */
function fireProjectile(G, a, kind) {
  let ang = a.face;
  const tgt = a.team === 'player' ? a.lockTarget : a.target;
  if (tgt && tgt.alive) {
    // lead the target a little
    const d = dist(a.x, a.y, tgt.x, tgt.y), tt = d / (kind === 'arrow' ? 10 : 14);
    ang = Math.atan2(tgt.y + (tgt.vy || 0) * tt * 0.6 - a.y, tgt.x + (tgt.vx || 0) * tt * 0.6 - a.x);
  }
  const sp = kind === 'arrow' ? 10 : 14;
  const dmg = a.team === 'player' ? 16 : kind === 'arrow' ? a.cfg.dmg : 8;
  G.projectiles.push({
    kind, team: a.team, owner: a, x: a.x + Math.cos(ang) * 0.4, y: a.y + Math.sin(ang) * 0.4, z: a.z + 1.05 * a.scale,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, dmg, life: 1.4, rot: 0,
  });
  Sound.sfx(kind === 'arrow' ? 'bow' : 'throw');
}
function reflectProjectile(G, p) {
  p.team = 'player';
  const o = p.owner;
  let ang = Math.atan2(-p.vy, -p.vx);
  if (o && o.alive) ang = Math.atan2(o.y - p.y, o.x - p.x);
  const sp = Math.hypot(p.vx, p.vy) * 1.2;
  p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp; p.dmg *= 2.5; p.life = 1.4;
  G.fx.sparks(p.x, p.y, p.z, 8); Sound.sfx('clang', 0.7);
  G.popText(p.x, p.y, 1.8, 'ODBIJENO', '200,230,255');
}
function updateProjectiles(G, dt) {
  const L = G.level;
  for (const p of G.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.rot += dt * 25;
    const t = L.tile(Math.floor(p.x), Math.floor(p.y));
    if (!t || (t.block && !(t.gate && t.open >= 1) && t.block !== 'bars' && t.block !== 'hedge') || (t.rad > 0.3 && dist(p.x, p.y, Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5) < t.rad)) {
      p.life = 0; G.fx.sparks(p.x, p.y, p.z, 5); Sound.sfx('tink', 0.6); continue;
    }
    const foes = p.team === 'player' ? G.actors.filter((e) => e.team === 'enemy') : [G.player];
    for (const a of foes) {
      if (!a.alive) continue;
      if (dist(p.x, p.y, a.x, a.y) < a.r + 0.18 && Math.abs(p.z - (a.z + 0.9 * a.scale)) < 0.9 * a.scale) {
        const src = { x: p.x - p.vx * 0.05, y: p.y - p.vy * 0.05, team: p.team, weaponId: 'katana', kvx: 0, kvy: 0 };
        const res = applyHit(G, src, a, { dmg: p.dmg, kb: 1.4, melee: false, dir: Math.atan2(p.vy, p.vx) });
        if (res === 'parry' && p.team === 'enemy') { reflectProjectile(G, p); break; }
        if (res === 'block') { G.fx.sparks(p.x, p.y, p.z, 6); }
        if (res !== 'miss') p.life = 0;
        break;
      }
    }
  }
  G.projectiles = G.projectiles.filter((p) => p.life > 0);
}

/* ------------------------------------------------------------ player */
function makePlayer(x, y, save) {
  const p = new Actor('player', x, y);
  p.team = 'player'; p.look = 'player';
  p.maxHp = 100; p.hp = 100; p.stamina = 100; p.stamRegenDelay = 0;
  p.weapons = save.weapons.slice(); p.weaponId = save.weaponId && p.weapons.includes(save.weaponId) ? save.weaponId : p.weapons[p.weapons.length - 1];
  p.shuriken = save.shuriken; p.smoke = save.smoke; p.keys = 0;
  p.state = 'free'; p.blocking = false; p.blockT = 9; p.buffer = false;
  p.lastSafe = { x, y }; p.safeT = 0; p.falling = 0;
  return p;
}

function aimAssist(G, p, range = 2.6, cone = 1.25) {
  let best = null, bs = 1e9;
  for (const e of G.actors) {
    if (e.team !== 'enemy' || !e.alive) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > range) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    const off = Math.abs(angDiff(p.face, a));
    if (off > cone) continue;
    if (!G.level.los(p.x, p.y, e.x, e.y)) continue;
    const s = d + off * 1.5;
    if (s < bs) { bs = s; best = e; }
  }
  p.lockTarget = best;
  if (best) p.face = Math.atan2(best.y - p.y, best.x - p.x);
  return best;
}

function updatePlayer(G, p, dt) {
  const L = G.level;
  p.flash = Math.max(0, p.flash - dt); p.inv = Math.max(0, p.inv - dt); p.showHp = 0;
  if (!p.alive) {
    p.vx = p.vy = 0;
    p.pose = { kind: 'dead', p: Math.min(1, (p.deadT = (p.deadT || 0) + dt) / 0.8) };
    p.moveAmt = 0; physics(G, p, dt, true); return;
  }
  // falling into water / pit
  if (p.falling > 0) {
    p.falling -= dt;
    p.z -= dt * 3; p.moveAmt = 0;
    if (p.falling <= 0) {
      p.z = 0; p.x = p.lastSafe.x; p.y = p.lastSafe.y; p.vx = p.vy = p.kvx = p.kvy = 0;
      p.inv = 1.4; p.fallFade = 0.6;
      p.hp -= 15 * DIFF[G.diff].dmg;
      if (p.hp <= 0) { p.hp = 0; killActor(G, p, p); }
    }
    return;
  }
  // stamina
  p.stamRegenDelay -= dt;
  if (p.stamRegenDelay <= 0 && !p.blocking) p.stamina = Math.min(100, p.stamina + dt * 32);
  else if (p.blocking) p.stamina = Math.min(100, p.stamina + dt * 6);

  // input → world direction (screen-relative)
  const [ix, iy] = Input.axis();
  let dx = ix + iy, dy = iy - ix;
  const il = Math.hypot(dx, dy);
  const mag = Math.min(1, Math.hypot(ix, iy));
  if (il > 0.01) { dx /= il; dy /= il; }

  if (p.stun > 0) { p.stun -= dt; if (p.stun <= 0 && p.pose.kind !== 'idle') p.pose = { kind: 'idle', p: 0 }; else p.pose.p = clamp(1 - p.stun / 0.5, 0, 1); }
  const free = !p.atk && p.stun <= 0 && p.state !== 'roll';
  const grounded = p.z <= 0.001;

  // weapon switching
  if (Input.hit('weapon')) cycleWeapon(G, p, 1);
  ['w1', 'w2', 'w3', 'w4'].forEach((k, i) => { if (Input.hit(k) && p.weapons[i]) { p.weaponId = p.weapons[i]; G.toast(WEAPONS[p.weaponId].name, 1.2); } });

  // block / sneak
  const wantBlock = Input.held('block') && p.stamina > 0 && !p.atk && p.state !== 'roll';
  if (wantBlock && !p.blocking) p.blockT = 0;
  p.blocking = wantBlock && grounded && p.stun <= 0;
  p.blockT += dt;
  p.sneaking = p.blocking && il > 0.01;

  // roll
  if (p.state === 'roll') {
    p.rollT += dt;
    const k = p.rollT / 0.42;
    p.pose = { kind: 'roll', p: clamp(k, 0, 1) };
    const sp = lerp(8.2, 2.5, k);
    p.vx = Math.cos(p.rollDir) * sp; p.vy = Math.sin(p.rollDir) * sp;
    p.inv = Math.max(p.inv, k < 0.75 ? 0.05 : 0);
    if (Math.random() < 0.5) G.fx.dust(p.x, p.y, 1);
    if (k >= 1) { p.state = 'free'; p.pose = { kind: 'idle', p: 0 }; }
  } else if (free) {
    if (Input.hit('roll') && p.stamina >= 18 && grounded) {
      p.state = 'roll'; p.rollT = 0; p.rollDir = il > 0.01 ? Math.atan2(dy, dx) : p.face; p.face = p.rollDir;
      p.stamina -= 18; p.stamRegenDelay = 0.6; Sound.sfx('roll'); G.fx.dust(p.x, p.y, 5);
    } else if (Input.hit('jump') && grounded && !p.blocking) {
      p.vz = 5.0; p.z = 0.01; Sound.sfx('jump'); G.fx.dust(p.x, p.y, 4);
    } else if (Input.hit('attack')) {
      aimAssist(G, p); startAttack(G, p, 'light', 0); p.buffer = false; G.onPlayerSwing(p);
    } else if (Input.hit('heavy') && p.stamina >= 30 && grounded) {
      aimAssist(G, p, 3, 3); startAttack(G, p, 'heavy'); G.onPlayerSwing(p);
    } else if (Input.hit('throw') && p.shuriken > 0) {
      aimAssist(G, p, 9, 0.7); p.shuriken--; startAttack(G, p, 'throw');
    } else if (Input.hit('smoke') && p.smoke > 0) {
      p.smoke--; G.smokeBomb(p.x, p.y);
    }
  } else if (p.atk && Input.hit('attack')) p.buffer = true;

  // locomotion
  let speed = 3.7;
  if (p.blocking) speed = 1.6;
  if (p.atk) speed = p.atk.type === 'throw' ? 1.5 : 0.35;
  if (p.stun > 0) speed = 0;
  if (p.state !== 'roll') {
    const tvx = dx * speed * mag, tvy = dy * speed * mag;
    const acc = grounded ? 22 : 8;
    p.vx = approach(p.vx, tvx, acc * dt); p.vy = approach(p.vy, tvy, acc * dt);
    if (il > 0.01 && !p.atk && p.stun <= 0) p.face = turnToward(p.face, Math.atan2(dy, dx), dt * (grounded ? 16 : 6));
  }
  const spd = Math.hypot(p.vx, p.vy);
  p.moveAmt = clamp(spd / 3.7, 0, 1);
  p.walkPh += dt * (4 + spd * 2.4);
  if (grounded && spd > 0.5) {
    p.stepAcc += dt * spd;
    if (p.stepAcc > 0.9) { p.stepAcc = 0; if (!p.sneaking) Sound.sfx('step', 0.7); if (spd > 3) G.fx.dust(p.x, p.y, 1); }
  }
  if (!p.atk && p.state !== 'roll' && p.stun <= 0) {
    p.pose = p.blocking ? { kind: 'block', p: 0 } : grounded ? { kind: 'idle', p: 0 } : { kind: 'jump', p: 0 };
  }
  if (p.atk) updateAttack(G, p, dt);
  if (p.atk && p.atk.type === 'throw' && Input.hit('throw') && p.shuriken > 0 && p.atk.stage === 'rec') { p.shuriken--; startAttack(G, p, 'throw'); }

  const wasAir = p.z > 0.001;
  physics(G, p, dt, true);
  const landed = wasAir && p.z <= 0;
  if (landed) { Sound.sfx('land', 0.7); G.fx.dust(p.x, p.y, 4); }

  // ground hazards
  if (p.z <= 0) {
    let t = L.tile(Math.floor(p.x), Math.floor(p.y));
    let drown = t && t.deadly;
    // forgiving landings: a jump that ends just short of a stone or the shore snaps onto it
    if (drown && landed) {
      let best = null, bd = 0.5;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.floor(p.x) + dx, ty = Math.floor(p.y) + dy, q = L.tile(tx, ty);
        if (!q || q.deadly || L.isSolidTile(q)) continue;
        const nx = clamp(p.x, tx + 0.12, tx + 0.88), ny = clamp(p.y, ty + 0.12, ty + 0.88), d = dist(p.x, p.y, nx, ny);
        if (d < bd) { bd = d; best = [nx, ny]; }
      }
      if (best) { p.x = best[0]; p.y = best[1]; t = L.tile(Math.floor(p.x), Math.floor(p.y)); drown = false; }
    }
    if (drown && p.inv <= 1.3) {
      p.falling = 0.45; p.state = 'free'; p.atk = null;
      if (t.g === 'water') { Sound.sfx('splash'); G.fx.splash(p.x, p.y); }
      else Sound.sfx('death', 0.4);
      G.toast(t.g === 'water' ? 'Voda te odnijela natrag na obalu.' : 'Pad u tamu…', 2);
      return;
    }
    if (t && t.spike && spikeState(G, Math.floor(p.x), Math.floor(p.y)) >= 1 && p.inv <= 0) {
      applyHit(G, { x: p.x + 0.01, y: p.y, team: 'trap', weaponId: 'spear', alive: true }, p, { dmg: 18, kb: 0, melee: false, unblockable: true, dir: 0 });
      p.vz = 3; p.z = 0.01; Sound.sfx('spike'); p.inv = 1.0;
    }
    if (t && !t.deadly && !t.stone && !t.spike) { p.safeT += dt; if (p.safeT > 0.15) { p.lastSafe = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 }; } }
    else p.safeT = 0;
    if (t && t.stone && !drown) p.lastSafe = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
  }
  // headband ribbon physics
  updateTail(p, dt);
}

function cycleWeapon(G, p, dir) {
  if (p.weapons.length < 2) return;
  const i = p.weapons.indexOf(p.weaponId);
  p.weaponId = p.weapons[(i + dir + p.weapons.length) % p.weapons.length];
  G.toast(WEAPONS[p.weaponId].kanji + '  ' + WEAPONS[p.weaponId].name, 1.2);
  Sound.sfx('ui');
}

function updateTail(a, dt) {
  const hz = a.z + 1.34 * a.scale;
  const bx = a.x - Math.cos(a.face) * 0.12, by = a.y - Math.sin(a.face) * 0.12;
  if (!a.tail.length) for (let i = 0; i < 5; i++) a.tail.push([bx, by, hz]);
  let prev = [bx, by, hz];
  const seg = 0.11;
  for (let i = 0; i < a.tail.length; i++) {
    const q = a.tail[i];
    q[2] -= dt * 0.6; // droop
    q[0] -= Math.cos(R.t * 3 + i) * dt * 0.08;
    const d = [q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    q[0] = prev[0] + (d[0] / l) * seg; q[1] = prev[1] + (d[1] / l) * seg; q[2] = Math.max(a.z + 0.3, prev[2] + (d[2] / l) * seg);
    prev = q;
  }
}

function physics(G, a, dt, isPlayer) {
  // knockback impulse decays with friction
  a.kvx *= Math.exp(-dt * 9); a.kvy *= Math.exp(-dt * 9);
  a.bumped = false;
  a.x += (a.vx + a.kvx) * dt; a.y += (a.vy + a.kvy) * dt;
  collide(G, a, isPlayer);
  if (a.z > 0 || a.vz > 0) {
    a.vz -= 17 * dt; a.z += a.vz * dt;
    if (a.z <= 0) { a.z = 0; a.vz = 0; }
  }
}

/* ------------------------------------------------------------ enemies */
function makeEnemy(kind, x, y, diff) {
  const C = ENEMY[kind];
  const e = new Actor(kind, x, y);
  e.team = 'enemy'; e.cfg = C; e.look = C.look; e.weaponId = C.weapon;
  e.maxHp = e.hp = Math.round(C.hp * DIFF[diff].hp);
  e.scale = C.scale || 1; e.r = 0.28 * e.scale;
  e.home = { x, y }; e.state = 'patrol'; e.stateT = 0; e.aware = 0;
  e.face = hash2(Math.floor(x), Math.floor(y)) * TAU;
  e.cool = rnd(0.3, 1); e.throwCd = rnd(2, 4); e.path = null; e.pathT = 0; e.strafe = Math.random() < 0.5 ? 1 : -1;
  e.patrolT = rnd(1, 4); e.dest = null; e.lostT = 0; e.comboLeft = 0; e.hasToken = false;
  if (C.boss) { e.state = 'dormant'; e.phase = 1; e.summoned = false; e.special = 3; }
  return e;
}
function takeToken(G, e) {
  if (e.hasToken) return true;
  if (e.cfg.boss || e.cfg.ranged) return true;
  if (G.tokens >= 2) return false;
  G.tokens++; e.hasToken = true; return true;
}
function releaseToken(G, e) { if (e.hasToken) { e.hasToken = false; G.tokens = Math.max(0, G.tokens - 1); } }

function alertEnemy(G, e, loud) {
  if (!e.alive) return;
  const was = e.state;
  if (e.state === 'dormant') return;
  e.aware = 1;
  if (['patrol', 'suspicious', 'search'].includes(was) || (was === 'confused' && loud)) {
    e.state = 'chase'; e.stateT = 0; e.mark = '!'; e.markT = 0.5; e.lostT = 0; e.cool = rnd(0.3, 0.9);
    if (was !== 'chase') Sound.sfx('alert', 0.8);
    // shout to allies
    for (const o of G.actors) {
      if (o === e || o.team !== 'enemy' || !o.alive || o.state === 'dormant') continue;
      if (dist(o.x, o.y, e.x, e.y) < 7 && ['patrol', 'suspicious', 'search'].includes(o.state)) {
        o.aware = Math.max(o.aware, 0.99); o.suspX = G.player.x; o.suspY = G.player.y; o.state = 'suspicious'; o.shoutT = rnd(0.2, 0.6);
      }
    }
  }
}

function enemySees(G, e, p) {
  if (!p.alive || p.visible === false || G.inSmoke(p.x, p.y)) return false;
  const d = dist(e.x, e.y, p.x, p.y);
  if (d > e.cfg.sight) return false;
  const a = Math.atan2(p.y - e.y, p.x - e.x);
  const inCone = Math.abs(angDiff(e.face, a)) < 1.05;
  const near = d < (p.sneaking ? 0.9 : 1.7);
  if (!inCone && !near) return false;
  return G.level.los(e.x, e.y, p.x, p.y);
}

function moveToward(G, e, tx, ty, speed, dt) {
  let gx = tx, gy = ty;
  const L = G.level;
  const direct = L.los(e.x, e.y, tx, ty) && dist(e.x, e.y, tx, ty) < 12;
  if (!direct || e.bumped) {
    e.pathT -= dt;
    if (!e.path || e.pathT <= 0) { e.path = L.path(e.x, e.y, tx, ty); e.pathT = 0.45 + Math.random() * 0.2; }
    if (e.path && e.path.length) {
      const [wx, wy] = e.path[0];
      if (dist(e.x, e.y, wx, wy) < 0.35) e.path.shift();
      if (e.path.length) { gx = e.path[0][0]; gy = e.path[0][1]; }
    }
  } else e.path = null;
  const a = Math.atan2(gy - e.y, gx - e.x);
  e.vx = approach(e.vx, Math.cos(a) * speed, 18 * dt); e.vy = approach(e.vy, Math.sin(a) * speed, 18 * dt);
  e.face = turnToward(e.face, a, dt * 8);
}

function updateEnemy(G, e, dt) {
  const p = G.player;
  e.flash = Math.max(0, e.flash - dt); e.showHp = Math.max(0, e.showHp - dt); e.inv = Math.max(0, e.inv - dt);
  e.markT = Math.max(0, (e.markT || 0) - dt);
  if (!e.alive) {
    e.deadT += dt; e.pose = { kind: 'dead', p: Math.min(1, e.deadT / 0.7) };
    e.vx = e.vy = 0; physics(G, e, dt, false);
    if (e.deadT > 7) e.fade = Math.max(0, 1 - (e.deadT - 7) / 1.5);
    return;
  }
  e.target = p;
  e.stateT += dt;
  e.telegraph = e.atk && e.atk.stage === 'wind' ? 1 : 0;
  const d = dist(e.x, e.y, p.x, p.y);
  const toP = Math.atan2(p.y - e.y, p.x - e.x);
  const C = e.cfg;
  let speed = C.speed * (e.rage ? 1.2 : 1);
  e.vx = approach(e.vx, 0, 10 * dt); e.vy = approach(e.vy, 0, 10 * dt);

  // stun-type states
  if (e.state === 'hurt' || e.state === 'stagger') {
    e.stun -= dt; e.pose = { kind: e.state === 'stagger' ? 'stagger' : 'hurt', p: clamp(1 - e.stun / 0.5, 0, 1) };
    if (e.stun <= 0) { e.state = 'chase'; e.pose = { kind: 'idle', p: 0 }; e.cool = rnd(0.1, 0.5); }
    physics(G, e, dt, false); animateEnemy(e, dt); return;
  }
  if (e.state === 'confused') {
    e.confT -= dt; e.mark = '?';
    e.face += Math.sin(R.t * 3 + e.seed) * dt * 2;
    if (e.confT <= 0) { e.state = 'search'; e.aware = 0.6; e.dest = { x: p.x, y: p.y }; }
    physics(G, e, dt, false); animateEnemy(e, dt); return;
  }
  if (e.state === 'dodge') {
    e.dodgeT -= dt; e.pose = { kind: 'roll', p: 1 - e.dodgeT / 0.35 };
    e.vx = Math.cos(e.dodgeDir) * 6.5; e.vy = Math.sin(e.dodgeDir) * 6.5; e.inv = 0.05;
    if (e.dodgeT <= 0) { e.state = 'chase'; e.pose = { kind: 'idle', p: 0 }; e.cool = 0.15; }
    physics(G, e, dt, false); animateEnemy(e, dt); return;
  }
  if (e.state === 'block') {
    e.blockT -= dt; e.pose = { kind: 'block', p: 0 }; e.face = turnToward(e.face, toP, dt * 10);
    if (e.blockT <= 0) { e.state = 'chase'; e.cool = rnd(0, 0.25); }
    physics(G, e, dt, false); animateEnemy(e, dt); return;
  }
  if (e.cfg.boss) { updateBoss(G, e, dt, d, toP); return; }

  // perception
  const sees = enemySees(G, e, p);
  if (e.shoutT > 0) { e.shoutT -= dt; if (e.shoutT <= 0) alertEnemy(G, e, true); }
  if (['patrol', 'suspicious', 'search'].includes(e.state)) {
    if (sees) {
      const rate = (p.sneaking ? 0.55 : 1.35) * clamp(3 / Math.max(d, 0.5), 0.45, 3.5);
      e.aware = Math.min(1, e.aware + dt * rate);
      e.suspX = p.x; e.suspY = p.y;
    } else e.aware = Math.max(0, e.aware - dt * 0.18);
    // noise: running close by
    if (d < 3.2 && p.moveAmt > 0.8 && !p.sneaking && p.z === 0 && p.visible !== false) { e.aware = Math.min(1, e.aware + dt * 0.5); e.suspX = p.x; e.suspY = p.y; }
    if (e.aware >= 1) alertEnemy(G, e, true);
    else if (e.aware > 0.3 && e.state !== 'suspicious') { e.state = 'suspicious'; e.stateT = 0; }
    else if (e.aware <= 0.05 && e.state === 'suspicious') { e.state = 'patrol'; }
    e.mark = e.state === 'suspicious' || e.state === 'search' ? '?' : null;
  }

  if (e.atk) {
    updateAttack(G, e, dt);
  } else if (e.state === 'patrol') {
    e.patrolT -= dt;
    if (!e.dest && e.patrolT <= 0) {
      for (let i = 0; i < 6; i++) {
        const tx = e.home.x + rnd(-3, 3), ty = e.home.y + rnd(-3, 3);
        if (G.level.passable(Math.floor(tx), Math.floor(ty)) && G.level.los(e.x, e.y, tx, ty)) { e.dest = { x: tx, y: ty }; break; }
      }
      e.patrolT = rnd(2.5, 5.5);
    }
    if (e.dest) {
      moveToward(G, e, e.dest.x, e.dest.y, speed * 0.4, dt);
      if (dist(e.x, e.y, e.dest.x, e.dest.y) < 0.3 || e.stateT > 8) { e.dest = null; e.stateT = 0; }
    } else e.face += Math.sin(R.t * 0.7 + e.seed) * dt * 0.8;
  } else if (e.state === 'suspicious' || e.state === 'search') {
    const tx = e.suspX !== undefined ? e.suspX : e.home.x, ty = e.suspY !== undefined ? e.suspY : e.home.y;
    const a = Math.atan2(ty - e.y, tx - e.x);
    e.face = turnToward(e.face, a, dt * 3);
    if (e.aware > 0.55 || e.state === 'search') {
      if (dist(e.x, e.y, tx, ty) > 0.6) moveToward(G, e, tx, ty, speed * 0.45, dt);
      else if (e.state === 'search' && e.stateT > 4) { e.state = 'patrol'; e.aware = 0.2; }
    }
    if (e.state === 'search' && e.stateT > 9) { e.state = 'patrol'; e.aware = 0; }
  } else if (e.state === 'chase') {
    e.mark = e.markT > 0 ? '!' : null;
    if (sees || d < 2) { e.lostT = 0; e.suspX = p.x; e.suspY = p.y; } else e.lostT += dt;
    if (!p.alive) { e.state = 'patrol'; e.aware = 0; }
    else if (e.lostT > 5) { e.state = 'search'; e.stateT = 0; e.aware = 0.7; releaseToken(G, e); }
    else {
      e.cool -= dt; e.throwCd -= dt;
      const tx = e.lostT > 0 ? e.suspX : p.x, ty = e.lostT > 0 ? e.suspY : p.y;
      if (C.ranged) {
        if (d < 3 && sees) { // back away
          const a = toP + Math.PI;
          const bx = e.x + Math.cos(a), by = e.y + Math.sin(a);
          if (G.level.passable(Math.floor(bx), Math.floor(by))) { e.vx = Math.cos(a) * speed * 0.8; e.vy = Math.sin(a) * speed * 0.8; }
          e.face = turnToward(e.face, toP, dt * 8);
          if (d < 1.3 && e.cool <= 0) { startAttack(G, e, 'light'); }
        } else if (d < 8 && sees && e.cool <= 0) { e.face = toP; startAttack(G, e, 'bow'); }
        else if (d > 6 || !sees) moveToward(G, e, tx, ty, speed, dt);
        else e.face = turnToward(e.face, toP, dt * 6);
      } else if (C.throws && sees && d > 3 && d < 6.5 && e.throwCd <= 0) {
        e.face = toP; startAttack(G, e, 'throw'); e.throwCd = rnd(3, 5);
      } else {
        const engage = C.reach * 0.92 + 0.15;
        if (d > engage + 0.9 || !sees) { moveToward(G, e, tx, ty, speed, dt); }
        else if (e.cool <= 0 && takeToken(G, e) && d <= engage + 0.35) {
          e.face = toP; e.comboLeft = (C.combo || 1) - 1 + (Math.random() < 0.3 ? 0 : 0);
          startAttack(G, e, C.thrust ? 'thrust' : 'light');
        } else if (d <= engage + 0.9) {
          // circle and wait for an opening
          const hold = e.hasToken ? engage * 0.9 : 2.3;
          const radial = d > hold ? 1 : d < hold - 0.4 ? -1 : 0;
          if (e.stateT > 1.5 + e.seed % 1) { e.strafe *= -1; e.stateT = 0; }
          const a = toP + (Math.PI / 2) * e.strafe;
          const sx = Math.cos(a) * 0.9 + Math.cos(toP) * radial, sy = Math.sin(a) * 0.9 + Math.sin(toP) * radial;
          const l = Math.hypot(sx, sy) || 1;
          e.vx = approach(e.vx, (sx / l) * speed * 0.5, 12 * dt); e.vy = approach(e.vy, (sy / l) * speed * 0.5, 12 * dt);
          e.face = turnToward(e.face, toP, dt * 9);
          if (!e.hasToken) e.cool = Math.max(e.cool, 0.2);
        } else moveToward(G, e, tx, ty, speed, dt);
      }
    }
  }
  if (!e.atk && e.state !== 'hurt') e.pose = { kind: 'idle', p: 0 };
  physics(G, e, dt, false);
  // spikes hurt everyone
  const t = G.level.tile(Math.floor(e.x), Math.floor(e.y));
  if (t && t.spike && spikeState(G, Math.floor(e.x), Math.floor(e.y)) >= 1 && e.inv <= 0) {
    e.inv = 1; applyHit(G, { x: e.x + 0.01, y: e.y, team: 'trap', weaponId: 'spear' }, e, { dmg: 25, kb: 0, melee: false, dir: 0 });
  }
  animateEnemy(e, dt);
}

function animateEnemy(e, dt) {
  const spd = Math.hypot(e.vx, e.vy);
  e.moveAmt = clamp(spd / 3.4, 0, 1);
  e.walkPh += dt * (4 + spd * 2.6);
}

// Player swing gives nearby alert enemies a chance to block or dodge
function enemyReact(G, p) {
  for (const e of G.actors) {
    if (e.team !== 'enemy' || !e.alive || e.state !== 'chase' || e.atk) continue;
    const d = dist(e.x, e.y, p.x, p.y);
    if (d > (p.atk ? p.atk.reach : 1.5) + 0.6) continue;
    const facing = Math.abs(angDiff(e.face, Math.atan2(p.y - e.y, p.x - e.x))) < 1.2;
    if (!facing) continue;
    const r = Math.random();
    const heavy = p.atk && p.atk.heavy;
    if (r < e.cfg.dodge) {
      e.state = 'dodge'; e.dodgeT = 0.35; e.dodgeDir = Math.atan2(e.y - p.y, e.x - p.x) + rnd(-0.9, 0.9);
      Sound.sfx('roll', 0.6);
    } else if (!heavy && r < e.cfg.dodge + e.cfg.block * (e.cfg.boss ? 1 : 1)) {
      e.state = 'block'; e.blockT = 0.5;
    }
  }
}

/* ------------------------------------------------------------ boss */
function updateBoss(G, e, dt, d, toP) {
  const p = G.player;
  if (e.state === 'dormant') {
    e.pose = { kind: 'idle', p: 0 }; e.face = turnToward(e.face, toP, dt * 2);
    if (p.alive && d < 7.5 && G.level.los(e.x, e.y, p.x, p.y)) { e.state = 'chase'; e.stateT = 0; G.onBossWake(e); }
    animateEnemy(e, dt); return;
  }
  const frac = e.hp / e.maxHp;
  const phase = frac < 0.33 ? 3 : frac < 0.66 ? 2 : 1;
  if (phase > e.phase) {
    e.phase = phase; e.rage = phase === 3;
    G.popText(e.x, e.y, 3, phase === 3 ? '怒 · BIJES' : '構え · NOVI STAV', '255,120,90'); G.shake(8); Sound.sfx('gong', 0.8);
    staggerEnemy(G, e, 0.6);
    return;
  }
  if (!e.summoned && frac < 0.5) {
    e.summoned = true; G.summonAdds(e);
  }
  e.cool -= dt;
  if (e.state === 'charge') {
    e.stateT += dt; e.pose = { kind: 'charge', p: e.stateT / 0.7 }; e.telegraph = 1; e.telegraphUnblockable = true;
    e.face = turnToward(e.face, toP, dt * 4); e.vx = e.vy = 0;
    if (e.stateT > 0.7) { e.state = 'dash'; e.stateT = 0; e.hitDash = false; Sound.sfx('heavy', 1.2); e.telegraph = 0; }
    physics(G, e, dt, false); animateEnemy(e, dt); return;
  }
  if (e.state === 'dash') {
    e.stateT += dt; e.pose = { kind: 'dash', p: 0 };
    e.vx = Math.cos(e.face) * 10.5; e.vy = Math.sin(e.face) * 10.5;
    if (Math.random() < 0.7) G.fx.dust(e.x, e.y, 1);
    if (!e.hitDash && dist(e.x, e.y, p.x, p.y) < 1.0 && Math.abs(p.z) < 0.8) {
      e.hitDash = true;
      applyHit(G, e, p, { dmg: 24, kb: 7, heavy: true, unblockable: true, melee: true, dir: e.face });
    }
    physics(G, e, dt, false);
    if (e.bumped && e.stateT > 0.08) {
      Sound.sfx('slam', 0.8); G.shake(9); G.fx.sparks(e.x + Math.cos(e.face) * 0.6, e.y + Math.sin(e.face) * 0.6, 1.2, 18);
      staggerEnemy(G, e, 1.6); G.popText(e.x, e.y, 3, 'OMAMLJEN', '255,220,140');
    } else if (e.stateT > 0.5) { e.state = 'chase'; e.stateT = 0; e.cool = 0.6; }
    animateEnemy(e, dt); return;
  }
  if (e.state === 'leap') {
    e.stateT += dt; e.pose = { kind: e.vz > 0 ? 'jump' : 'attack', stage: 'act', p: 0.3, combo: 2 };
    const a = Math.atan2(e.leapY - e.y, e.leapX - e.x), dd = dist(e.x, e.y, e.leapX, e.leapY);
    e.vx = Math.cos(a) * Math.min(dd * 2.2, 7); e.vy = Math.sin(a) * Math.min(dd * 2.2, 7);
    const wasAir = e.z > 0;
    physics(G, e, dt, false);
    if (wasAir && e.z <= 0) {
      e.state = 'recover'; e.stateT = 0; Sound.sfx('slam'); G.shake(12);
      G.shockwave(e.x, e.y, e);
    }
    animateEnemy(e, dt); return;
  }
  if (e.state === 'recover') {
    e.stateT += dt; e.pose = { kind: 'attack', stage: 'rec', p: e.stateT / 0.8, combo: 2 };
    if (e.stateT > 0.8) { e.state = 'chase'; e.cool = 0.4; }
    e.vx = e.vy = 0; physics(G, e, dt, false); animateEnemy(e, dt); return;
  }
  if (e.atk) { updateAttack(G, e, dt); physics(G, e, dt, false); animateEnemy(e, dt); return; }
  // choose next move
  if (!p.alive) { e.vx = e.vy = 0; e.pose = { kind: 'idle', p: 0 }; animateEnemy(e, dt); return; }
  const r = Math.random();
  if (e.cool <= 0 && phase >= 3 && d > 2.5 && d < 7 && r < 0.35) {
    e.state = 'leap'; e.stateT = 0; e.vz = 7.5; e.z = 0.01; e.leapX = p.x; e.leapY = p.y; Sound.sfx('jump', 1.5);
    e.cool = 1.2;
  } else if (e.cool <= 0 && phase >= 2 && d > 3 && d < 9 && r < 0.6) {
    e.state = 'charge'; e.stateT = 0; e.face = toP;
  } else if (e.cool <= 0 && d < C_REACH(e) + 0.4) {
    e.face = toP; e.comboLeft = phase === 1 ? 1 : 2; startAttack(G, e, 'light');
  } else {
    moveToward(G, e, p.x, p.y, e.cfg.speed * (e.rage ? 1.25 : 1) * (d < 3 ? 0.6 : 1), dt);
    e.pose = { kind: 'idle', p: 0 };
  }
  physics(G, e, dt, false); animateEnemy(e, dt);
}
function C_REACH(e) { return e.cfg.reach * e.scale * 0.85; }
