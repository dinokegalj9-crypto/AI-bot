'use strict';
/* ============================================================
   KAGE · Game — state machine, level flow, effects, HUD, UI
   ============================================================ */

const $ = (s) => document.querySelector(s);
const DEFAULT_SAVE = () => ({ level: 0, weapons: ['fists'], weaponId: 'fists', shuriken: 3, smoke: 1, cp: null, stats: freshStats() });
function freshStats() { return { kills: 0, stealth: 0, parries: 0, deaths: 0, time: 0, damage: 0 }; }

const G = {
  mode: 'boot', level: null, player: null, actors: [], items: [], projectiles: [], particles: [], decals: [],
  weather: [], smokes: [], shocks: [], time: 0, tokens: 0, diff: Store.get('diff', 1),
  hitstopT: 0, slowT: 0, slowScale: 1, damageFlash: 0, boss: null, bossHpShown: 0, deadTimer: 0,
  save: null, stats: freshStats(), shakeOn: Store.get('shake', true), mapBig: false,
  checkpoint: null, gateMsgT: 0, levelT: 0, hpGhost: 100, lastCam: null,
  mm: null, mmVis: null,

  /* ---------------- level lifecycle ---------------- */
  loadLevel(idx, save, attract = false) {
    const L = new Level(idx);
    this.level = L; this.actors = []; this.items = []; this.projectiles = []; this.particles = []; this.decals = [];
    this.smokes = []; this.shocks = []; this.tokens = 0; this.boss = null; this.levelT = 0; this.bossHpShown = 0;
    this.save = save;
    let scrollIdx = 0;
    for (const s of L.spawns) {
      if (s.type === 'player') { this.player = makePlayer(s.x, s.y, save); this.actors.push(this.player); }
      else if (ENEMY[s.type]) this.actors.push(makeEnemy(s.type, s.x, s.y, this.diff));
      else {
        const it = { kind: s.type, x: s.x, y: s.y, taken: false };
        if (s.type === 'weapon') { it.wid = L.meta.weapon; if (!it.wid || save.weapons.includes(it.wid)) continue; }
        if (s.type === 'scroll') it.text = L.meta.scrolls[scrollIdx++] || L.meta.scrolls[0];
        this.items.push(it);
      }
    }
    const P = this.player;
    this.checkpoint = { x: P.x, y: P.y };
    if (save.cp && save.level === idx) {
      P.x = save.cp.x; P.y = save.cp.y; this.checkpoint = { ...save.cp };
      let best = null, bd = 9;
      for (const s of L.shrines) { const d = dist(s.x + 0.5, s.y + 0.5, P.x, P.y); if (d < bd) { bd = d; best = s; } }
      if (best) best.t.lit = true;
    }
    P.lastSafe = { x: P.x, y: P.y };
    if (attract) { P.visible = false; P.alive = true; }
    this.hpGhost = P.hp;
    this.buildMinimap();
    this.initWeather();
    const [cx, cy] = [isoX(P.x, P.y), isoY(P.x, P.y, 0.9)];
    R.cam.x = cx; R.cam.y = cy; R.cam.zoomMul = 1; this.lastCam = [cx, cy];
    Sound.play(L.meta.music);
  },
  startLevel(idx) {
    const s = this.save;
    s.level = idx; s.cp = null;
    this.persist();
    this.loadLevel(idx, s);
    this.showCard(idx);
  },
  persist() {
    const P = this.player;
    const s = this.save;
    if (P && P.visible !== false) { s.weapons = P.weapons.slice(); s.weaponId = P.weaponId; s.shuriken = P.shuriken; s.smoke = P.smoke; }
    s.stats = this.stats;
    Store.set('save', s);
  },
  showCard(idx) {
    const m = LEVELS[idx];
    $('#cardNum').textContent = `RAZINA ${idx + 1} / ${LEVELS.length}`;
    $('#cardKanji').textContent = m.kanji; $('#cardName').textContent = m.name; $('#cardSub').textContent = m.sub;
    const card = $('#card');
    card.hidden = true; void card.offsetWidth; // restart CSS animations
    UI.show('card');
    this.mode = 'card'; this.cardT = 2.6;
    Sound.sfx('gong', 0.7);
  },
  respawn() {
    const P = this.player;
    P.alive = true; P.hp = P.maxHp; P.stamina = 100; P.x = this.checkpoint.x; P.y = this.checkpoint.y; P.z = 0;
    P.vx = P.vy = P.kvx = P.kvy = P.vz = 0; P.atk = null; P.stun = 0; P.state = 'free'; P.pose = { kind: 'idle', p: 0 };
    P.inv = 1.5; P.falling = 0; P.deadT = 0; P.lastSafe = { x: P.x, y: P.y };
    this.hpGhost = P.hp;
    this.projectiles = []; this.shocks = []; this.tokens = 0;
    this.actors = this.actors.filter((e) => !e.summon);
    for (const e of this.actors) {
      if (e.team !== 'enemy' || !e.alive) continue;
      e.x = e.home.x; e.y = e.home.y; e.hp = e.maxHp; e.state = e.cfg.boss ? 'dormant' : 'patrol'; e.aware = 0; e.atk = null;
      e.mark = null; e.stun = 0; e.hasToken = false; e.telegraph = 0; e.vx = e.vy = e.kvx = e.kvy = 0; e.z = 0;
      if (e.cfg.boss) { e.summoned = false; e.phase = 1; e.rage = false; }
    }
    if (this.boss) { this.boss = null; $('#bossName').classList.remove('show'); R.cam.zoomMul = 1; Sound.play(this.level.meta.music); }
    this.mode = 'play'; UI.show(null);
  },
  exitOpen() { return !this.actors.some((e) => e.cfg && e.cfg.boss && e.alive); },
  completeLevel() {
    if (this.mode !== 'play') return;
    this.mode = 'transition';
    Sound.sfx('bell');
    $('#fade').classList.add('on');
    setTimeout(() => {
      const next = this.level.idx + 1;
      if (next >= LEVELS.length) { this.finishGame(); $('#fade').classList.remove('on'); return; }
      this.persist();
      this.startLevel(next);
      $('#fade').classList.remove('on');
    }, 900);
  },
  finishGame() {
    const s = this.stats;
    const mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60);
    const cells = [
      ['Vrijeme', `${mins}:${String(secs).padStart(2, '0')}`], ['Poraženi', s.kills], ['Tihi udarci', s.stealth],
      ['Pariranja', s.parries], ['Padovi', s.deaths],
    ];
    $('#endStats').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    const score = s.stealth * 3 + s.parries * 2 - s.deaths * 4 - Math.floor(s.time / 90);
    $('#endRank').textContent = score > 30 ? '影 · Sjena' : score > 15 ? '忍 · Nindža' : score > 0 ? '侍 · Samuraj' : '農 · Seljak';
    Store.del('save');
    this.mode = 'ending'; UI.show('ending'); Sound.play('ending');
  },
  onPlayerDown() { this.stats.deaths++; this.deadTimer = 2.2; },
  onBossWake(e) {
    this.boss = e; Sound.play('boss'); Sound.sfx('gong');
    $('#bossName').classList.add('show');
    setTimeout(() => $('#bossName').classList.remove('show'), 3500);
  },
  onBossDown(e) {
    this.slowmo(2.2, 0.18); this.shake(14);
    Sound.play('ending');
    this.toast('Kuroda je pao. Put do zrcala je slobodan.', 4);
    this.popText(e.x, e.y, 3, '終 · KRAJ', '255,225,150');
    for (const a of this.actors) if (a.summon && a.alive) killActor(this, a, e);
  },
  summonAdds(boss) {
    const L = this.level;
    let n = 0;
    for (const [dx, dy] of [[-5, -3], [5, -3], [-5, 3], [5, 3], [0, -6], [0, 6]]) {
      if (n >= 2) break;
      const x = Math.floor(boss.x + dx), y = Math.floor(boss.y + dy);
      if (!L.passable(x, y)) continue;
      const e = makeEnemy('ninja', x + 0.5, y + 0.5, this.diff);
      e.summon = true; e.state = 'chase'; e.aware = 1; e.mark = '!'; e.markT = 0.5;
      this.actors.push(e); n++;
      this.fx.smoke(e.x, e.y, 18);
    }
    Sound.sfx('smoke'); this.toast('Kuroda doziva svoje sjene!', 2);
  },

  /* ---------------- world events ---------------- */
  touchGate(x, y, t) {
    if (t.opening || this.gateMsgT > 0) return;
    const P = this.player;
    if (P.keys > 0) {
      P.keys--; t.opening = true; Sound.sfx('gate'); this.shake(3);
      this.toast('Vrata se otvaraju.', 1.6);
    } else {
      this.gateMsgT = 2; Sound.sfx('locked');
      this.toast('Zaključano. Treba ti ključ.', 1.8);
    }
  },
  smokeBomb(x, y) {
    this.smokes.push({ x, y, r: 2.5, t: 4.5 });
    this.fx.smoke(x, y, 46);
    Sound.sfx('smoke');
    for (const e of this.actors) {
      if (e.team !== 'enemy' || !e.alive || dist(e.x, e.y, x, y) > 3.4) continue;
      if (e.cfg.boss) { if (e.state !== 'dormant') staggerEnemy(this, e, 0.9); continue; }
      e.atk = null; e.telegraph = 0; releaseToken(this, e);
      e.state = 'confused'; e.confT = 3.6; e.aware = 0; e.mark = '?';
    }
  },
  inSmoke(x, y) { return this.smokes.some((s) => s.t > 0.6 && dist(s.x, s.y, x, y) < s.r); },
  shockwave(x, y, src) {
    this.shocks.push({ x, y, t: 0, hit: false, src });
    this.particles.push({ type: 'ring', x, y, z: 0.05, vx: 0, vy: 0, vz: 0, life: 0.55, max: 0.55, size: 3.8, c: '255,180,120' });
    this.fx.dust(x, y, 18);
  },
  dropItem(x, y, kind) { this.items.push({ kind, x, y, taken: false, dropped: true }); },
  decal(x, y, r) {
    this.decals.push({ x: x + rnd(-0.2, 0.2), y: y + rnd(-0.2, 0.2), r, a: 0.5 });
    if (this.decals.length > 170) this.decals.shift();
  },
  popText(x, y, z, text, c) {
    this.particles.push({ type: 'text', x, y, z, vx: 0, vy: 0, vz: 0.9, life: 1.2, max: 1.2, size: 13, text, c, nograv: true });
  },
  onPlayerSwing(p) { enemyReact(this, p); },
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); },
  slowmo(t, s) { this.slowT = Math.max(this.slowT, t); this.slowScale = s; },
  shake(n) { if (this.shakeOn) R.cam.shake = Math.max(R.cam.shake, n); },
  toast(msg, dur = 2) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(this.toastTO); this.toastTO = setTimeout(() => el.classList.remove('show'), dur * 1000);
  },
  showScroll(text) {
    const el = $('#scrollMsg');
    el.innerHTML = ''; el.append(text); const sm = document.createElement('small'); sm.textContent = 'Svitak · nestaje sam'; el.append(sm);
    el.hidden = false; this.scrollT = 9;
  },

  fx: {
    sparks(x, y, z, n) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), s = rnd(2, 7);
        G.particles.push({ type: 'spark', x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(1, 5), life: rnd(0.2, 0.45), max: 0.45, g: 12 });
      }
      G.flashes.push({ x, y, z, r: 3, i: 0.9, c: '255,220,150', life: 0.12 });
    },
    blood(x, y, z, dx, dy, n) {
      for (let i = 0; i < n; i++) {
        const s = rnd(1.5, 4.5), a = Math.atan2(dy, dx) + rnd(-0.8, 0.8);
        G.particles.push({ type: 'blood', x, y, z: z + rnd(-0.2, 0.3), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(0.5, 3.5), life: 1.2, max: 1.2, size: rnd(1, 2.4), g: 14, stain: true });
      }
    },
    dust(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU);
        G.particles.push({ type: 'dust', x: x + rnd(-0.15, 0.15), y: y + rnd(-0.15, 0.15), z: 0.05, vx: Math.cos(a) * rnd(0.3, 1.2), vy: Math.sin(a) * rnd(0.3, 1.2), vz: rnd(0.2, 0.8), life: rnd(0.4, 0.8), max: 0.8, size: rnd(2, 4), g: 0 });
      }
    },
    smoke(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), d = rnd(0, 2.2);
        G.particles.push({ type: 'smoke', x: x + Math.cos(a) * d * 0.4, y: y + Math.sin(a) * d * 0.4, z: rnd(0, 0.8), vx: Math.cos(a) * rnd(0.4, 1.8), vy: Math.sin(a) * rnd(0.4, 1.8), vz: rnd(0.05, 0.3), life: rnd(2.8, 4.6), max: 4.6, size: rnd(9, 18), g: 0, drag: 1.8 });
      }
    },
    splash(x, y) {
      for (let i = 0; i < 18; i++) {
        const a = rnd(0, TAU), s = rnd(0.5, 2.5);
        G.particles.push({ type: 'splash', x, y, z: 0.05, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(2, 5), life: 0.7, max: 0.7, size: rnd(1.2, 2.6), g: 14 });
      }
      G.particles.push({ type: 'ring', x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0.6, max: 0.6, size: 1.4, c: '200,230,250' });
    },
  },
  flashes: [],

  /* ---------------- lights ---------------- */
  collectLights() {
    const L = this.level, out = [];
    const t = R.t;
    for (const l of L.lamps) {
      const fl = 0.88 + Math.sin(t * 7 + l.x * 3) * 0.06 + Math.sin(t * 17 + l.y) * 0.04;
      if (l.torch) {
        const side = L.walkable(l.x + 1, l.y) ? 1 : 0;
        out.push({ x: l.x + (side ? 1.1 : 0.5), y: l.y + (side ? 0.5 : 1.1), z: 1.2, r: 5.2, i: fl, c: '255,140,60' });
      } else out.push({ x: l.x + 0.5, y: l.y + 0.5, z: 1.6, r: 4.6, i: fl, c: '255,175,90' });
    }
    for (const s of L.shrines) if (s.t.lit) out.push({ x: s.x + 0.5, y: s.y + 0.5, z: 0.9, r: 3.6, i: 0.9, c: '255,160,70' });
    const P = this.player;
    if (P && P.visible !== false) out.push({ x: P.x, y: P.y, z: 0.9, r: L.idx === 2 ? 4.2 : 3.3, i: 0.6 });
    if (this.exitOpen()) for (const e of L.exits) out.push({ x: e.x + 0.5, y: e.y + 0.5, z: 1, r: 4.2, i: 0.8 + Math.sin(t * 3) * 0.1, c: '255,225,160' });
    for (const it of this.items) if (!it.taken && (it.kind === 'key' || it.kind === 'weapon')) out.push({ x: it.x, y: it.y, z: 0.6, r: 1.8, i: 0.7, c: '255,215,120' });
    for (const f of this.flashes) out.push(f);
    for (const e of this.actors) if (e.cfg && e.cfg.boss && e.alive && e.state !== 'dormant') out.push({ x: e.x, y: e.y, z: 1.6, r: 2.2, i: 0.5, c: '255,60,40' });
    return out;
  },

  /* ---------------- weather ---------------- */
  initWeather() {
    const k = this.level.meta.weather;
    const n = { rain: 240, petals: 70, leaves: 55, embers: 80 }[k] || 0;
    this.weather = [];
    for (let i = 0; i < n; i++) this.weather.push(this.newWeather(k, true));
  },
  newWeather(k, anywhere) {
    const W = R.W, H = R.H, d = R.dpr;
    const p = { x: rnd(-40, W + 40), y: anywhere ? rnd(-40, H) : -30, r: rnd(0, TAU), a: rnd(0.3, 0.8) };
    if (k === 'rain') { p.vx = -180 * d; p.vy = rnd(900, 1300) * d; p.a = rnd(0.15, 0.4); }
    else if (k === 'petals') { p.vx = rnd(-30, 40) * d; p.vy = rnd(25, 60) * d; p.vr = rnd(-2, 2); }
    else if (k === 'leaves') { p.vx = rnd(20, 70) * d; p.vy = rnd(30, 70) * d; p.vr = rnd(-3, 3); p.c = pick(['196,120,50', '170,70,40', '210,160,70', '120,90,40']); }
    else { p.vx = rnd(-10, 10) * d; p.vy = -rnd(15, 45) * d; p.vr = rnd(1, 3); p.c = rnd(0, 80); if (!anywhere) p.y = H + 20; }
    return p;
  },
  updateWeather(dt, camDX, camDY) {
    const k = this.level.meta.weather, W = R.W, H = R.H;
    for (let i = 0; i < this.weather.length; i++) {
      const p = this.weather[i];
      p.x += p.vx * dt - camDX * 0.9; p.y += p.vy * dt - camDY * 0.9;
      if (p.vr) { p.r += p.vr * dt; if (k !== 'embers') p.x += Math.sin(p.r) * 20 * dt * R.dpr; }
      if (p.y > H + 40 || p.y < -60 || p.x < -80 || p.x > W + 80) {
        const n = this.newWeather(k, false);
        if (p.x < -80) n.x = W + 40; else if (p.x > W + 80) n.x = -40;
        if (k !== 'embers' && (p.x < -80 || p.x > W + 80)) n.y = rnd(0, H);
        this.weather[i] = n;
      }
    }
  },

  /* ---------------- minimap ---------------- */
  buildMinimap() {
    const L = this.level;
    const mm = document.createElement('canvas'); mm.width = L.w; mm.height = L.h;
    const c = mm.getContext('2d');
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const t = L.tiles[y][x];
      let col = '#4a5a3c';
      if (t.block) col = t.gate ? '#b8352a' : t.block === 'hedge' ? '#2f4a2a' : '#1b1b22';
      else if (t.obj === 'pine' || t.obj === 'bamboo' || t.obj === 'sakura') col = '#27402a';
      else if (t.g === 'water') col = t.stone ? '#8a8a90' : '#2a5470';
      else if (t.g === 'pit') col = '#000';
      else if (t.g === 'stone') col = t.spike ? '#8a5a5a' : '#6a6970';
      else if (t.g === 'wood' || t.g === 'bridge') col = '#7a5634';
      else if (t.g === 'dirt') col = '#8a6d48';
      c.fillStyle = col; c.fillRect(x, y, 1, 1);
    }
    this.mm = mm;
    this.mmVis = document.createElement('canvas'); this.mmVis.width = L.w; this.mmVis.height = L.h;
  },
  explore() {
    const L = this.level, P = this.player, c = this.mmVis.getContext('2d');
    const r = 7, px = Math.floor(P.x), py = Math.floor(P.y);
    for (let y = py - r; y <= py + r; y++) for (let x = px - r; x <= px + r; x++) {
      if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
      const i = y * L.w + x;
      if (L.explored[i]) continue;
      if ((x - px) ** 2 + (y - py) ** 2 > r * r) continue;
      L.explored[i] = 1;
      c.drawImage(this.mm, x, y, 1, 1, x, y, 1, 1);
    }
  },

  /* ---------------- update ---------------- */
  update(rdt) {
    let dt = rdt;
    if (this.hitstopT > 0) { this.hitstopT -= rdt; dt = 0; }
    if (this.slowT > 0) { this.slowT -= rdt; dt *= this.slowScale; }
    const L = this.level, P = this.player;
    this.time += dt; this.levelT += rdt;
    if (this.mode === 'play') this.stats.time += rdt;
    this.gateMsgT -= rdt;
    this.damageFlash = Math.max(0, this.damageFlash - rdt);
    if (this.scrollT > 0) { this.scrollT -= rdt; if (this.scrollT <= 0) $('#scrollMsg').hidden = true; }

    const attract = this.mode === 'title';
    if (dt > 0) {
      if (!attract) updatePlayer(this, P, dt);
      for (const e of this.actors) if (e.team === 'enemy') updateEnemy(this, e, dt);
      // soft separation so crowds don't stack
      const act = this.actors.filter((a) => a.alive && a.visible !== false);
      for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
        if (d < m && d > 1e-4) {
          const push = (m - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
      updateProjectiles(this, dt);
      this.updateParticles(dt);
      for (const s of this.smokes) s.t -= dt;
      this.smokes = this.smokes.filter((s) => s.t > 0);
      for (const f of this.flashes) f.life -= dt;
      this.flashes = this.flashes.filter((f) => f.life > 0);
      for (const s of this.shocks) {
        s.t += dt; const r = 3.6 * (s.t / 0.5);
        if (!s.hit && P.alive && Math.abs(dist(s.x, s.y, P.x, P.y) - r) < 0.5 && P.z < 0.25 && P.inv <= 0) {
          s.hit = true; applyHit(this, s.src, P, { dmg: 18, kb: 6, unblockable: true, melee: false, dir: Math.atan2(P.y - s.y, P.x - s.x) });
        }
      }
      this.shocks = this.shocks.filter((s) => s.t < 0.5);
      // gates
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const t = L.tiles[y][x];
        if (t.gate && t.opening && t.open < 1) {
          t.open = Math.min(1, t.open + dt * 0.75);
          if (Math.random() < 0.4) this.fx.dust(x + 0.5 + rnd(-0.4, 0.4), y + 0.5 + rnd(-0.4, 0.4), 1);
        }
      }
    }

    if (!attract && P.alive) {
      // items
      for (const it of this.items) {
        if (it.taken || dist(it.x, it.y, P.x, P.y) > 0.65 || P.z > 0.7) continue;
        this.pickup(it);
      }
      // shrines = checkpoints
      for (const s of L.shrines) {
        if (s.t.lit || dist(s.x + 0.5, s.y + 0.5, P.x, P.y) > 1.3) continue;
        s.t.lit = true;
        this.checkpoint = { x: P.x, y: P.y };
        P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.5);
        this.save.cp = { ...this.checkpoint }; this.save.level = L.idx; this.persist();
        Sound.sfx('bell'); this.toast('Kontrolna točka · napredak spremljen', 2.4);
        this.fx.smoke(s.x + 0.5, s.y + 0.5, 6);
      }
      // exit
      if (this.exitOpen()) for (const e of L.exits) if (dist(e.x + 0.5, e.y + 0.5, P.x, P.y) < 0.7) this.completeLevel();
      this.explore();
    }
    if (!attract && !P.alive && this.deadTimer > 0) {
      this.deadTimer -= rdt;
      if (this.deadTimer <= 0 && this.mode === 'play') { this.mode = 'dead'; UI.show('dead'); }
    }
    // adaptive music: drums swell while anything hunts you
    const hunting = this.actors.some((e) => e.team === 'enemy' && e.alive && (e.state === 'chase' || (e.cfg.boss && e.state !== 'dormant')));
    Sound.setIntensity(hunting && !attract ? 1 : 0);
    this.updateCamera(rdt, attract);
  },
  pickup(it) {
    const P = this.player;
    if (it.kind === 'health' && P.hp >= P.maxHp) return;
    it.taken = true;
    const glint = () => { for (let i = 0; i < 10; i++) this.particles.push({ type: 'glint', x: it.x + rnd(-0.3, 0.3), y: it.y + rnd(-0.3, 0.3), z: rnd(0.3, 1.2), vx: 0, vy: 0, vz: rnd(0.5, 1.5), life: 0.6, max: 0.6, size: 3, nograv: true }); };
    glint();
    if (it.kind === 'key') { P.keys++; Sound.sfx('key'); this.toast('鍵 · Ključ', 1.8); }
    else if (it.kind === 'health') { P.hp = Math.min(P.maxHp, P.hp + 40); Sound.sfx('pickup'); this.toast('Onigiri · +40 zdravlja', 1.4); }
    else if (it.kind === 'shuriken') { P.shuriken += 5; Sound.sfx('pickup'); this.toast('Shuriken ×5', 1.4); }
    else if (it.kind === 'smoke') { P.smoke += 2; Sound.sfx('pickup'); this.toast('Bomba dima ×2', 1.4); }
    else if (it.kind === 'weapon') {
      P.weapons.push(it.wid); P.weaponId = it.wid; Sound.sfx('key'); Sound.sfx('gong', 0.5);
      this.slowmo(0.8, 0.35);
      const W = WEAPONS[it.wid];
      this.toast(`${W.kanji} · ${W.name} — Tab mijenja oružje`, 3);
      this.persist();
    } else if (it.kind === 'scroll') { Sound.sfx('pickup'); this.showScroll(it.text); }
  },
  updateParticles(dt) {
    const out = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.drag) { const k = Math.exp(-dt * p.drag); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (!p.nograv) p.vz -= (p.g || 0) * dt;
      p.z += p.vz * dt;
      if (p.z < 0 && !p.nograv) {
        p.z = 0;
        if (p.stain) { if (Math.random() < 0.25) this.decal(p.x, p.y, rnd(1.2, 2.6)); continue; }
        p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5;
      }
      out.push(p);
    }
    if (this.level.meta.weather === 'embers' && Math.random() < 0.3 && this.player) {
      const P = this.player;
      out.push({ type: 'ember', x: P.x + rnd(-6, 6), y: P.y + rnd(-6, 6), z: 0, vx: rnd(-0.2, 0.2), vy: rnd(-0.2, 0.2), vz: rnd(0.3, 0.9), life: 3, max: 3, nograv: true });
    }
    this.particles = out.length > 900 ? out.slice(out.length - 900) : out;
  },
  updateCamera(dt, attract) {
    const P = this.player;
    let tx, ty;
    if (attract) {
      const L = this.level, t = R.t * 0.06;
      const wx = L.w / 2 + Math.sin(t) * L.w * 0.3, wy = L.h / 2 + Math.cos(t * 0.73) * L.h * 0.3;
      tx = isoX(wx, wy) - (R.W / R.S) * 0.18; ty = isoY(wx, wy, 0);
    } else {
      const la = 0.35;
      tx = isoX(P.x + P.vx * la, P.y + P.vy * la); ty = isoY(P.x + P.vx * la, P.y + P.vy * la, 0.9);
      if (this.boss && this.boss.alive) {
        const bx = isoX(this.boss.x, this.boss.y), by = isoY(this.boss.x, this.boss.y, 1);
        tx = lerp(tx, bx, 0.3); ty = lerp(ty, by, 0.3);
      }
    }
    const k = 1 - Math.exp(-dt * (attract ? 1.2 : 5.5));
    R.cam.x += (tx - R.cam.x) * k; R.cam.y += (ty - R.cam.y) * k;
    R.cam.zoomMul = lerp(R.cam.zoomMul, this.boss && this.boss.alive ? 0.84 : 1, 1 - Math.exp(-dt * 2));
    R.cam.shake *= Math.exp(-dt * 11);
    R.cam.sx = (Math.random() - 0.5) * R.cam.shake; R.cam.sy = (Math.random() - 0.5) * R.cam.shake;
    const dx = (R.cam.x - this.lastCam[0]) * R.S, dy = (R.cam.y - this.lastCam[1]) * R.S;
    this.lastCam = [R.cam.x, R.cam.y];
    this.updateWeather(dt, dx, dy);
  },

  /* ---------------- HUD ---------------- */
  drawHUD() {
    const c = R.ctx, d = R.dpr, P = this.player;
    const W = R.W / d, H = R.H / d;
    c.setTransform(d, 0, 0, d, 0, 0);
    // damage vignette
    if (this.damageFlash > 0) {
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, `rgba(160,10,10,${this.damageFlash * 0.9})`);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    if (P.hp < P.maxHp * 0.25 && P.alive) {
      const a = 0.18 + Math.sin(R.t * 5) * 0.08;
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, `rgba(120,0,0,${a})`); c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    const x = 22, y = 20, narrow = W < 620, hpW = narrow ? 150 : 210, stW = narrow ? 110 : 150;
    this.hpGhost = this.hpGhost > P.hp ? Math.max(P.hp, this.hpGhost - 30 * (1 / 60)) : P.hp;
    c.font = '700 20px "Shippori Mincho B1", serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillStyle = 'rgba(236,227,207,0.9)'; c.fillText('命', x, y + 7);
    bar(c, x + 28, y, hpW, 12, 1, 'rgba(10,10,18,0.65)');
    bar(c, x + 28, y, hpW, 12, this.hpGhost / P.maxHp, 'rgba(236,227,207,0.55)');
    bar(c, x + 28, y, hpW, 12, P.hp / P.maxHp, P.hp < P.maxHp * 0.25 ? '#e0452c' : '#c23b26');
    c.font = '700 14px "Shippori Mincho B1", serif'; c.fillStyle = 'rgba(236,227,207,0.75)'; c.fillText('気', x + 3, y + 26);
    bar(c, x + 28, y + 21, stW, 6, 1, 'rgba(10,10,18,0.6)');
    bar(c, x + 28, y + 21, stW, 6, P.stamina / 100, P.stamina < 25 ? '#8a7a55' : '#d6a64e');
    // stealth status
    let st = null, sc = '';
    if (this.inSmoke(P.x, P.y)) { st = '隠 SKRIVEN'; sc = '151,161,192'; }
    else if (this.actors.some((e) => e.alive && e.team === 'enemy' && e.state === 'chase')) { st = '! OTKRIVEN'; sc = '232,90,60'; }
    else if (this.actors.some((e) => e.alive && e.team === 'enemy' && (e.state === 'suspicious' || e.state === 'search'))) { st = '? SUMNJA'; sc = '230,200,110'; }
    else if (P.sneaking) { st = '忍 ŠULJANJE'; sc = '151,161,192'; }
    if (st) { c.font = '14px "DotGothic16", monospace'; c.fillStyle = `rgba(${sc},0.95)`; c.fillText(st, x + 28, y + 44); }
    // objective
    const objA = clamp(1 - (this.levelT - 12) / 2, 0, 1);
    if (objA > 0) {
      c.font = '500 13px "Zen Kaku Gothic New", sans-serif'; c.fillStyle = `rgba(236,227,207,${0.8 * objA})`;
      c.fillText(this.level.meta.objective, x, y + (narrow ? 96 : st ? 66 : 48));
    }

    // inventory (top right)
    const rx = W - 22;
    const Wp = WEAPONS[P.weaponId];
    c.textAlign = 'right';
    c.font = '40px "Yuji Syuku", "Shippori Mincho B1", serif'; c.fillStyle = 'rgba(236,227,207,0.92)'; c.fillText(Wp.kanji, rx, y + 16);
    c.font = '700 14px "Shippori Mincho B1", serif'; c.fillStyle = 'rgba(236,227,207,0.8)'; c.fillText(Wp.name, rx - 50, y + 6);
    c.font = '11px "Zen Kaku Gothic New", sans-serif'; c.fillStyle = 'rgba(151,161,192,0.9)';
    c.fillText(P.weapons.length > 1 ? `${P.weapons.indexOf(P.weaponId) + 1}/${P.weapons.length} · Tab` : 'jedino oružje', rx - 50, y + 24);
    const inv = [['shuriken', P.shuriken], ['smoke', P.smoke], ['key', P.keys]];
    let ix = rx - 8;
    c.font = '15px "DotGothic16", monospace';
    for (const [k, n] of inv.reverse()) {
      c.save(); c.globalAlpha = n > 0 ? 1 : 0.35; c.translate(ix - 34, y + 54); c.scale(0.9, 0.9); ITEM_ICON[k](c, {}); c.restore();
      c.fillStyle = n > 0 ? 'rgba(236,227,207,0.95)' : 'rgba(236,227,207,0.35)'; c.fillText('×' + n, ix, y + 55);
      ix -= 62;
    }

    // boss bar
    const B = this.boss;
    if (B && (B.alive || this.bossHpShown > 0)) {
      this.bossHpShown = lerp(this.bossHpShown, B.hp / B.maxHp, 0.08);
      const bw = Math.min(520, W - 60), bx = (W - bw) / 2, by = H - 44;
      c.textAlign = 'center'; c.font = '700 13px "Shippori Mincho B1", serif'; c.fillStyle = 'rgba(236,227,207,0.85)';
      c.fillText('黒田  ŠOGUN KURODA', W / 2, by - 12);
      bar(c, bx, by, bw, 10, 1, 'rgba(10,10,18,0.7)');
      bar(c, bx, by, bw, 10, this.bossHpShown, '#d6a64e');
      bar(c, bx, by, bw, 10, B.hp / B.maxHp, '#c23b26');
      for (const f of [0.66, 0.33]) { c.fillStyle = 'rgba(10,10,18,0.9)'; c.fillRect(bx + bw * f - 1, by - 2, 2, 14); }
      if (!B.alive && this.bossHpShown < 0.01) this.boss = null;
    }

    // minimap
    const big = this.mapBig;
    const k = big ? Math.min(7, (Math.min(W, H) * 0.8) / (this.level.w + this.level.h)) : 2.1;
    const L = this.level;
    const mw = (L.w + L.h) * k, mh = (L.w + L.h) * k / 2;
    const ox = big ? W / 2 : W - 22 - mw / 2, oy = big ? H / 2 - mh / 2 : UI.touch ? 124 : H - 22 - mh;
    const topX = ox - (L.w - L.h) * k / 2, topY = oy;
    c.save();
    if (big) { c.fillStyle = 'rgba(6,8,16,0.7)'; c.fillRect(0, 0, W, H); }
    c.setTransform(k * d, (k / 2) * d, -k * d, (k / 2) * d, topX * d, topY * d);
    c.globalAlpha = big ? 0.95 : 0.8;
    c.fillStyle = 'rgba(6,8,16,0.6)'; c.fillRect(-1, -1, L.w + 2, L.h + 2);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.mmVis, 0, 0);
    c.globalAlpha = 1;
    const dot = (wx, wy, col, r) => { c.fillStyle = col; c.beginPath(); c.arc(wx, wy, r, 0, TAU); c.fill(); };
    const seen = (wx, wy) => L.explored[Math.floor(wy) * L.w + Math.floor(wx)];
    for (const e of L.exits) if (seen(e.x, e.y)) dot(e.x + 0.5, e.y + 0.5, '#f0d48a', 1);
    for (const it of this.items) if (!it.taken && (it.kind === 'key' || it.kind === 'weapon') && seen(it.x, it.y)) dot(it.x, it.y, '#e6c56a', 0.7);
    for (const e of this.actors) if (e.team === 'enemy' && e.alive && e.state === 'chase') dot(e.x, e.y, '#e85a3c', 0.7);
    dot(P.x, P.y, '#ffffff', 0.9);
    c.restore();
    if (big) { c.textAlign = 'center'; c.font = '500 13px "Zen Kaku Gothic New", sans-serif'; c.fillStyle = 'rgba(236,227,207,0.8)'; c.fillText(this.level.meta.objective, W / 2, H - 30); }
  },
};

function bar(c, x, y, w, h, f, col) {
  const s = h * 0.6; // slanted brush-cut ends
  c.fillStyle = col;
  c.beginPath();
  const fw = Math.max(0, w * clamp(f, 0, 1));
  if (fw <= 0) return;
  c.moveTo(x + s, y); c.lineTo(x + fw, y); c.lineTo(x + fw - s * (fw > s ? 1 : 0), y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
}

/* ============================================================
   UI: screens, menus, touch
   ============================================================ */
const UI = {
  current: null, stack: [],
  screens: ['title', 'intro', 'controls', 'settings', 'pause', 'dead', 'ending', 'card'],
  show(name, push = false) {
    if (push && this.current) this.stack.push(this.current); else if (!push) this.stack = [];
    this.current = name;
    for (const s of this.screens) $('#' + s).hidden = s !== name;
    const t = $('#touch');
    t.hidden = !(this.touch && (G.mode === 'play') && !name);
    if (name && name !== 'card') {
      const first = $('#' + name).querySelector('button:not([hidden]):not([disabled])');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    } else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  },
  back() {
    const prev = this.stack.pop();
    if (prev) { this.show(prev); }
    else if (G.mode === 'pause') { resume(); }
  },
  focusables() {
    if (!this.current || this.current === 'card') return [];
    return [...$('#' + this.current).querySelectorAll('button, input')].filter((b) => !b.hidden && b.offsetParent !== null);
  },
  nav() {
    const list = this.focusables();
    if (!list.length) return;
    let i = list.indexOf(document.activeElement);
    const move = (d) => { i = (i + d + list.length) % list.length; list[i].focus({ preventScroll: true }); Sound.sfx('ui'); };
    const el = document.activeElement;
    const isRange = el && el.type === 'range';
    if (Input.hit('down')) move(1);
    if (Input.hit('up')) move(-1);
    if (isRange && (Input.hit('left') || Input.hit('right'))) {
      el.value = clamp(parseFloat(el.value) + (Input.hit('right') ? 0.1 : -0.1), 0, 1); el.dispatchEvent(new Event('input'));
    } else if (!isRange) {
      if (Input.hit('right')) move(1);
      if (Input.hit('left')) move(-1);
    }
    // gamepad A = click, B = back (keyboard Enter/Space click natively)
    if (Input.gpNow[0] && !Input.gpPrev[0] && el && el.click) el.click();
    if ((Input.gpNow[1] && !Input.gpPrev[1]) || Input.hits.has('Escape') || Input.hits.has('Backspace')) {
      if (this.current === 'controls' || this.current === 'settings') this.back();
      else if (this.current === 'pause') resume();
    }
  },
};

function resume() { G.mode = 'play'; UI.show(null); }
function pauseGame() {
  if (G.mode !== 'play' || !G.player.alive) return;
  G.mode = 'pause';
  $('#pauseInfo').textContent = `${LEVELS[G.level.idx].name} · ${DIFF[G.diff].name}`;
  UI.show('pause');
}
function toTitle() {
  G.mode = 'title'; $('#scrollMsg').hidden = true;
  $('#bossName').classList.remove('show');
  const save = Store.get('save', null);
  const cont = $('#btnContinue');
  cont.hidden = !save;
  if (save) $('#continueInfo').textContent = `${LEVELS[save.level].name}${save.cp ? ' · kontrolna točka' : ''}`;
  G.loadLevel(0, DEFAULT_SAVE(), true);
  Sound.play('title');
  UI.show('title');
}
function newGame() {
  G.save = DEFAULT_SAVE(); G.stats = G.save.stats;
  UI.show('intro'); G.mode = 'intro'; G.introT = 0;
}
function beginGame() {
  G.startLevel(0);
}
function continueGame() {
  const save = Store.get('save', null);
  if (!save) return newGame();
  G.save = save; G.stats = save.stats || freshStats(); G.save.stats = G.stats;
  G.loadLevel(save.level, save);
  G.showCard(save.level);
}

function wireUI() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    Sound.init(); Sound.sfx('ui');
    const act = b.dataset.act;
    if (act === 'new') newGame();
    else if (act === 'continue') continueGame();
    else if (act === 'controls') UI.show('controls', true);
    else if (act === 'settings') { syncSettings(); UI.show('settings', true); }
    else if (act === 'back') UI.back();
    else if (act === 'begin') beginGame();
    else if (act === 'resume') resume();
    else if (act === 'respawn') G.respawn();
    else if (act === 'quit') { if (G.mode !== 'ending') G.persist(); toTitle(); }
  });
  const vm = $('#volMusic'), vs = $('#volSfx');
  vm.addEventListener('input', () => { Sound.init(); Sound.setVolume('music', parseFloat(vm.value)); });
  vs.addEventListener('input', () => { Sound.init(); Sound.setVolume('sfx', parseFloat(vs.value)); Sound.sfx('clang', 0.5); });
  $('#diffSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-diff]'); if (!b) return;
    G.diff = +b.dataset.diff; Store.set('diff', G.diff); syncSettings();
  });
  $('#optCrt').addEventListener('click', () => { R.crt = !R.crt; Store.set('crt', R.crt); syncSettings(); });
  $('#optShake').addEventListener('click', () => { G.shakeOn = !G.shakeOn; Store.set('shake', G.shakeOn); syncSettings(); });
  $('#tPause').addEventListener('click', () => pauseGame());
  // leaving the window pauses the fight instead of letting it play out unattended
  addEventListener('blur', () => pauseGame());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  // touch controls
  UI.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const zone = $('#stickZone'), stick = $('#stick'), knob = $('#knob');
  let sid = null, cx = 0, cy = 0;
  zone.addEventListener('pointerdown', (e) => {
    Sound.init();
    sid = e.pointerId; zone.setPointerCapture(sid);
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    if (Math.hypot(e.clientX - cx, e.clientY - cy) > 90) { cx = e.clientX; cy = e.clientY; stick.style.left = (cx - 62) + 'px'; stick.style.bottom = (innerHeight - cy - 62) + 'px'; }
    moveStick(e);
  });
  const moveStick = (e) => {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy), m = 46;
    if (l > m) { dx = dx / l * m; dy = dy / l * m; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    Input.touchAxis = [dx / m, dy / m];
  };
  zone.addEventListener('pointermove', moveStick);
  const endStick = (e) => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; Input.touchAxis = [0, 0]; };
  zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
  document.querySelectorAll('[data-t]').forEach((b) => {
    const a = b.dataset.t;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); Sound.init(); b.setPointerCapture(e.pointerId); Input.touchPress(a); });
    const up = () => Input.touchRelease(a);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });
  // first interaction unlocks audio
  const unlock = () => Sound.init();
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
}
function syncSettings() {
  $('#volMusic').value = Sound.vol.music; $('#volSfx').value = Sound.vol.sfx;
  document.querySelectorAll('#diffSeg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.diff === G.diff)));
  $('#optCrt').textContent = R.crt ? 'Uključen' : 'Isključen'; $('#optCrt').setAttribute('aria-pressed', String(R.crt));
  $('#optShake').textContent = G.shakeOn ? 'Uključena' : 'Isključena'; $('#optShake').setAttribute('aria-pressed', String(G.shakeOn));
}

/* ============================================================
   main loop
   ============================================================ */
let lastT = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  R.t += rdt;
  Input.pollGamepad();
  try { step(rdt); } catch (err) { console.error(err); }
  Input.endFrame();
  requestAnimationFrame(frame);
}
function step(rdt) {
  const m = G.mode;
  if (m === 'play') {
    if (Input.hit('pause')) { pauseGame(); }
    else {
      if (Input.hit('map')) G.mapBig = !G.mapBig;
      G.update(rdt);
      if (G.scrollT > 0 && G.scrollT < 8 && (Input.hit('confirm') && !Input.hit('jump'))) { G.scrollT = 0; $('#scrollMsg').hidden = true; }
    }
  } else if (m === 'title') {
    G.update(rdt); UI.nav();
  } else if (m === 'card') {
    G.cardT -= rdt;
    G.updateCamera(rdt, false); G.updateParticles(rdt);
    for (const e of G.actors) if (e.team === 'enemy') { e.pose = { kind: 'idle', p: 0 }; }
    if (G.cardT <= 0 || (G.cardT < 2.2 && Input.anyHit())) { G.mode = 'play'; UI.show(null); G.levelT = 0; }
  } else if (m === 'intro') {
    G.introT += rdt; G.update(rdt);
    if (G.introT > 0.5 && Input.anyHit() && !(document.activeElement && document.activeElement.dataset.act === 'begin' && (Input.hits.has('Enter') || Input.hits.has('Space')))) beginGame();
  } else if (m === 'pause' || m === 'dead' || m === 'ending') {
    UI.nav();
    if (m === 'pause' && Input.hits.has('KeyP')) resume();
  } else if (m === 'transition') {
    G.updateCamera(rdt, false);
  }
  render();
}
function render() {
  if (!G.level) return;
  drawWorld(G);
  drawLighting(G);
  drawWeather(G);
  if (G.player && G.player.fallFade > 0) {
    G.player.fallFade -= 1 / 60;
    R.ctx.setTransform(1, 0, 0, 1, 0, 0); R.ctx.fillStyle = `rgba(0,0,0,${clamp(G.player.fallFade * 1.4, 0, 1)})`; R.ctx.fillRect(0, 0, R.W, R.H);
  }
  drawPost();
  if (G.mode === 'play' || G.mode === 'pause' || G.mode === 'dead') G.drawHUD();
}

function boot() {
  renderInit($('#game'));
  Input.init($('#game'));
  wireUI();
  syncSettings();
  toTitle();
  requestAnimationFrame(frame);
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => R.cache.clear());
boot();
