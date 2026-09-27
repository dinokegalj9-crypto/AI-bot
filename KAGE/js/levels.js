'use strict';
/* ============================================================
   KAGE · Levels — tile legend + four hand-built maps
   Map coordinates: x = column, y = row. In the isometric view
   +x runs down-right and +y runs down-left on screen.
   ============================================================ */

// ground: how the floor looks.  block: solid box (h = height).  obj: solid round prop.
const TILE = {
  '.': { g: 'grass' }, ',': { g: 'grass', deco: 'flowers' }, ':': { g: 'dirt' },
  '=': { g: 'stone' }, '_': { g: 'wood' },
  '~': { g: 'water', deadly: true }, 'o': { g: 'water', stone: true },
  'b': { g: 'bridge' }, 'V': { g: 'pit', deadly: true }, '^': { g: 'stone', spike: true },
  '#': { g: 'stone', block: 'stone', h: 1.7, opaque: true },
  'F': { g: 'stone', block: 'stone', h: 1.7, opaque: true, torch: true },
  'W': { g: 'wood', block: 'house', h: 1.9, opaque: true },
  'H': { g: 'grass', block: 'hedge', h: 0.75 },
  'J': { g: 'stone', block: 'bars', h: 1.7 },
  'G': { g: 'stone', block: 'gate', h: 1.9, opaque: true, gate: true },
  'T': { obj: 'pine', rad: 0.32 }, 'Y': { obj: 'sakura', rad: 0.3 }, 'B': { obj: 'bamboo', rad: 0.38 },
  'R': { obj: 'rock', rad: 0.4 }, 'L': { obj: 'lantern', rad: 0.26, light: true },
  'S': { obj: 'jizo', rad: 0.26 }, 'Q': { obj: 'pillar', rad: 0.3 },
  'I': { obj: 'torii' }, 'C': { obj: 'shrine', rad: 0.28 }, 'X': { obj: 'exit' },
};
// characters that are spawns rather than terrain
const SPAWN = {
  P: 'player', g: 'guard', s: 'spear', a: 'archer', n: 'ninja', Z: 'shogun',
  k: 'key', h: 'health', '*': 'shuriken', m: 'smoke', w: 'weapon', '?': 'scroll',
};

function makeMap(w, h, fill) {
  const g = [];
  for (let y = 0; y < h; y++) g.push(new Array(w).fill(fill));
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const M = {
    w, h, g,
    set(x, y, c) { if (inb(x, y)) g[y][x] = c; return M; },
    get(x, y) { return inb(x, y) ? g[y][x] : null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) M.set(x, y, c); return M; },
    frame(x0, y0, x1, y1, c) {
      for (let x = x0; x <= x1; x++) { M.set(x, y0, c); M.set(x, y1, c); }
      for (let y = y0; y <= y1; y++) { M.set(x0, y, c); M.set(x1, y, c); }
      return M;
    },
    ellipse(cx, cy, rx, ry, c) {
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / (rx + 0.5), dy = (y - cy) / (ry + 0.5);
        if (dx * dx + dy * dy <= 1) M.set(x, y, c);
      }
      return M;
    },
    // walk a path of waypoints with L-shaped legs
    path(pts, c, onlyOn) {
      for (let i = 0; i < pts.length - 1; i++) {
        let [x, y] = pts[i]; const [tx, ty] = pts[i + 1];
        const put = () => { if (!onlyOn || onlyOn.includes(M.get(x, y))) M.set(x, y, c); };
        put();
        while (x !== tx) { x += Math.sign(tx - x); put(); }
        while (y !== ty) { y += Math.sign(ty - y); put(); }
      }
      return M;
    },
    // scatter props only on open tiles whose neighbours are also plain ground
    scatter(c, n, x0, y0, x1, y1, seed, on = '.') {
      const r = mulberry32(seed);
      let tries = 0;
      while (n > 0 && tries++ < n * 60) {
        const x = x0 + Math.floor(r() * (x1 - x0 + 1)), y = y0 + Math.floor(r() * (y1 - y0 + 1));
        if (M.get(x, y) !== on) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = M.get(x + dx, y + dy);
          if (q === null || !('.,TBYR#WHL' + on).includes(q)) { ok = false; break; }
        }
        if (!ok) continue;
        M.set(x, y, c); n--;
      }
      return M;
    },
    rows() { return g.map((r) => r.join('')); },
  };
  return M;
}

/* ------------------------------------------------------------ Level 1 */
function levelForest() {
  const M = makeMap(40, 36, '.');
  M.frame(0, 0, 39, 35, 'T');
  for (let i = 1; i < 39; i++) for (const [x, y] of [[i, 1], [i, 34], [1, i], [38, i]]) if (y < 35 && hash2(x, y, 7) < 0.45) M.set(x, y, hash2(x, y, 8) < 0.5 ? 'B' : 'T');
  // main trails
  M.path([[3, 2], [6, 2], [6, 4], [27, 4]], ':');
  M.path([[15, 4], [15, 9], [12, 9], [12, 11], [7, 11]], ':');
  M.path([[27, 4], [33, 4], [33, 11]], ':');
  // river, stepping stones, island, bridge
  M.rect(1, 12, 38, 16, '~');
  [[6, 13], [6, 15], [8, 15], [10, 15], [12, 15], [14, 15]].forEach(([x, y]) => M.set(x, y, 'o'));
  M.rect(16, 13, 19, 15, '.');
  M.rect(33, 12, 34, 16, 'b');
  // shrine
  M.frame(29, 2, 35, 6, 'W'); M.rect(30, 3, 34, 5, '_'); M.set(29, 4, '_');
  M.set(27, 4, 'I');
  M.set(28, 2, 'L'); M.set(28, 6, 'L');
  // south trails
  M.path([[6, 17], [6, 19], [33, 19], [33, 17]], ':');
  M.path([[15, 19], [15, 25], [26, 25], [26, 28], [20, 28]], ':');
  // wall + gate + exit court
  M.rect(1, 29, 38, 29, '#'); M.set(20, 29, 'G');
  M.rect(1, 30, 38, 33, '.');
  M.path([[20, 30], [20, 33]], ':');
  M.set(20, 32, 'X'); M.set(18, 31, 'L'); M.set(22, 31, 'L'); M.set(20, 31, 'I');
  M.set(19, 28, 'L'); M.set(21, 28, 'L');
  // woodland dressing
  M.scatter('T', 13, 2, 2, 37, 11, 101);
  M.scatter('B', 7, 2, 2, 25, 11, 102);
  M.scatter('R', 8, 2, 2, 37, 11, 103);
  M.scatter(',', 30, 2, 2, 37, 11, 104);
  M.scatter('T', 14, 2, 17, 37, 28, 105);
  M.scatter('B', 6, 2, 17, 37, 28, 106);
  M.scatter('R', 8, 2, 17, 37, 28, 107);
  M.scatter(',', 30, 2, 17, 37, 28, 108);
  M.scatter('Y', 4, 2, 30, 37, 33, 109);
  M.set(31, 11, 'L'); M.set(35, 17, 'L');
  M.set(3, 20, 'S'); M.set(4, 20, 'S');
  // spawns
  M.set(3, 3, 'P');
  M.set(9, 3, '?');
  M.set(33, 4, 'w');
  M.set(24, 3, 'g'); M.set(36, 7, 'g');
  M.set(31, 9, 's');
  M.set(33, 18, 'g');
  M.set(22, 23, 'a');
  M.set(14, 26, 'g');
  M.set(17, 14, 'k'); M.set(18, 14, 'h'); M.set(17, 15, '?');
  M.set(7, 8, '*'); M.set(30, 24, '*'); M.set(4, 25, 'h');
  M.set(8, 18, 'C');
  M.set(26, 21, 'C');
  return M.rows();
}

/* ------------------------------------------------------------ Level 2 */
function levelGarden() {
  const M = makeMap(40, 40, '.');
  M.frame(0, 0, 39, 39, '#');
  // courtyard dividers
  M.rect(1, 13, 38, 13, '#'); M.set(10, 13, 'G');
  M.rect(1, 27, 38, 27, '#'); M.set(30, 27, 'G');
  // --- court A
  M.path([[2, 2], [3, 2], [3, 10], [10, 10], [10, 12]], '=');
  M.path([[3, 6], [18, 6]], '=');
  M.ellipse(25, 6, 6, 3, '~');
  M.rect(18, 6, 32, 6, 'b');
  M.path([[33, 6], [36, 6], [36, 11]], '=');
  M.frame(6, 1, 13, 4, 'H'); M.set(9, 4, '.'); M.set(10, 4, '.');
  M.set(9, 2, 'k');
  [[5, 9], [15, 9], [17, 3], [31, 10], [37, 2]].forEach(([x, y]) => M.set(x, y, 'L'));
  M.scatter('Y', 10, 2, 1, 37, 12, 201);
  M.scatter('H', 5, 14, 8, 36, 12, 202);
  M.scatter(',', 16, 2, 1, 37, 12, 203);
  M.set(2, 2, 'P');
  M.set(16, 4, 'g'); M.set(14, 10, 'g'); M.set(33, 3, 'a'); M.set(28, 10, 's');
  M.set(37, 11, 'm'); M.set(4, 11, 'h');
  M.set(6, 7, '?');
  // --- court B
  M.path([[10, 14], [10, 16], [4, 16], [4, 25], [29, 25], [29, 26], [30, 26]], '=');
  M.path([[10, 16], [34, 16], [34, 25]], '=');
  M.ellipse(20, 20, 8, 3, '~');
  M.rect(16, 18, 24, 22, '=');
  M.frame(18, 18, 22, 22, 'W'); M.rect(19, 19, 21, 21, '_'); M.set(20, 22, '_');
  M.rect(20, 23, 20, 24, 'b');
  M.rect(11, 20, 15, 20, 'b'); M.rect(25, 20, 28, 20, 'b');
  M.set(20, 20, 'w');
  M.set(16, 18, 'L'); M.set(24, 18, 'L'); M.set(16, 22, 'L'); M.set(24, 22, 'L');
  M.scatter('Y', 9, 2, 14, 37, 26, 211);
  M.scatter('H', 6, 2, 14, 37, 26, 212);
  M.scatter(',', 14, 2, 14, 37, 26, 213);
  M.set(5, 15, 'C');
  M.set(14, 24, 's'); M.set(30, 17, 's'); M.set(35, 21, 'a'); M.set(6, 21, 'a');
  M.set(26, 24, 'g'); M.set(31, 22, 'n');
  M.set(36, 24, 'k'); M.set(2, 22, 'm'); M.set(36, 15, 'h'); M.set(3, 17, '*');
  M.set(12, 23, '?');
  // --- court C: palace forecourt
  M.rect(10, 29, 30, 37, '=');
  M.path([[30, 28], [30, 29]], '=');
  M.set(20, 30, 'I');
  for (let y = 31; y <= 37; y += 3) { M.set(12, y, 'L'); M.set(28, y, 'L'); }
  M.set(16, 33, 'S'); M.set(24, 33, 'S');
  M.scatter('Y', 8, 2, 28, 37, 38, 221);
  M.set(20, 37, 'X');
  M.set(32, 29, 'C');
  M.set(14, 34, 'g'); M.set(26, 34, 'g'); M.set(20, 35, 'n'); M.set(6, 32, 'a');
  M.set(35, 36, 'h'); M.set(4, 37, '*');
  return M.rows();
}

/* ------------------------------------------------------------ Level 3 */
function levelDungeon() {
  const M = makeMap(40, 40, '#');
  // start room
  M.rect(2, 2, 8, 8, '=');
  // corridor with pit
  M.rect(8, 5, 16, 6, '='); M.set(12, 5, 'V'); M.set(12, 6, 'V');
  // spike hall
  M.rect(16, 2, 28, 11, '=');
  for (const x of [19, 22, 25]) M.rect(x, 2, x, 11, '^');
  M.set(18, 2, 'Q'); M.set(18, 11, 'Q');
  // descent to cell block
  M.rect(21, 11, 22, 15, '=');
  // cell hall
  M.rect(8, 15, 34, 19, '=');
  M.rect(8, 20, 34, 20, '#');
  for (const x of [11, 16, 21, 26, 31]) {
    M.rect(x - 1, 21, x + 1, 24, '=');
    M.set(x, 20, x === 21 ? 'G' : x === 11 ? '=' : 'J');
  }
  M.rect(9, 21, 9, 24, '#');
  // east passage to pit field
  M.rect(34, 17, 37, 18, '=');
  M.rect(35, 18, 37, 34, '=');
  M.rect(35, 25, 37, 25, 'V'); M.rect(35, 29, 37, 29, 'V');
  // final vault
  M.rect(12, 28, 34, 35, '=');
  M.rect(12, 31, 12, 32, '#');
  M.rect(3, 28, 11, 37, '=');
  M.rect(11, 28, 11, 37, '#'); M.set(11, 33, 'G');
  M.rect(16, 30, 17, 30, 'V'); M.rect(24, 32, 25, 33, 'V');
  for (const [x, y] of [[15, 29], [22, 29], [29, 29], [15, 34], [22, 34], [29, 34]]) M.set(x, y, 'Q');
  // torches on walls touching floor
  for (let y = 1; y < 39; y++) for (let x = 1; x < 39; x++) {
    if (M.get(x, y) !== '#') continue;
    const touch = ['=', '^'].includes(M.get(x + 1, y)) || ['=', '^'].includes(M.get(x, y + 1));
    if (touch && hash2(x, y, 3) < 0.13) M.set(x, y, 'F');
  }
  // spawns
  M.set(4, 4, 'P'); M.set(6, 7, '?'); M.set(7, 3, 'h');
  M.set(27, 3, 'g'); M.set(20, 9, 'n'); M.set(27, 10, 'k'); M.set(17, 10, '*');
  M.set(12, 17, 'C');
  M.set(16, 16, 'g'); M.set(27, 17, 's'); M.set(11, 23, 'n'); M.set(31, 18, 'g');
  M.set(21, 23, 'w'); M.set(10, 22, '?');
  M.set(36, 21, 'n'); M.set(36, 32, 'k'); M.set(36, 27, 'm');
  M.set(33, 29, 'C');
  M.set(20, 31, 'g'); M.set(28, 32, 's'); M.set(18, 34, 'n'); M.set(14, 29, 'a');
  M.set(30, 35, 'h'); M.set(13, 35, '*');
  M.set(6, 35, 'X'); M.set(5, 30, 'S'); M.set(8, 30, 'S');
  return M.rows();
}

/* ------------------------------------------------------------ Level 4 */
function levelKeep() {
  const M = makeMap(40, 40, 'W');
  // moonlit forecourt
  M.rect(1, 1, 38, 9, '=');
  M.scatter('Y', 8, 2, 1, 37, 8, 401, '=');
  for (const x of [8, 14, 26, 32]) M.set(x, 5, 'L');
  M.set(20, 3, 'I');
  // main door into keep
  M.rect(19, 9, 21, 10, '_');
  // entrance hall
  M.rect(4, 11, 36, 18, '_');
  for (const x of [8, 13, 27, 32]) { M.set(x, 12, 'Q'); M.set(x, 17, 'Q'); }
  M.set(4, 11, 'L'); M.set(36, 11, 'L'); M.set(4, 18, 'L'); M.set(36, 18, 'L');
  // side armoury (key)
  M.rect(1, 13, 3, 16, '_');
  M.rect(1, 12, 3, 12, 'W'); M.rect(1, 17, 3, 17, 'W');
  M.rect(37, 13, 38, 16, '_');
  // gate to throne hall
  M.rect(4, 19, 36, 19, 'W'); M.set(20, 19, 'G');
  // throne hall
  M.rect(6, 20, 34, 37, '_');
  for (let y = 23; y <= 35; y += 4) { M.set(10, y, 'Q'); M.set(30, y, 'Q'); }
  M.set(8, 21, 'L'); M.set(32, 21, 'L'); M.set(8, 36, 'L'); M.set(32, 36, 'L');
  M.rect(17, 37, 23, 37, '=');
  M.set(20, 37, 'X');
  // spawns
  M.set(20, 2, 'P'); M.set(22, 2, '?');
  M.set(12, 7, 'g'); M.set(28, 7, 'g'); M.set(34, 3, 'a'); M.set(5, 3, 'a');
  M.set(20, 8, 'C');
  M.set(10, 15, 's'); M.set(30, 15, 's'); M.set(20, 13, 'n'); M.set(24, 16, 'g');
  M.set(2, 14, 'k'); M.set(2, 15, 'n'); M.set(38, 14, 'h'); M.set(38, 15, 'm'); M.set(37, 13, '*');
  M.set(20, 17, 'C');
  M.set(20, 28, 'Z');
  M.set(7, 30, 'h'); M.set(33, 30, 'h');
  return M.rows();
}

/* ------------------------------------------------------------ metadata */
const LEVELS = [
  {
    kanji: '竹林', name: 'Bambusova šuma', sub: 'Sumrak nad rijekom Kiso',
    floor: '.', map: levelForest(), music: 'forest', weather: 'leaves',
    weapon: 'katana', sky: '#1d1424',
    ambient: 'rgba(40,16,48,0.26)', tintTop: 'rgba(255,120,60,0.16)', tintBot: 'rgba(60,20,90,0.20)',
    objective: 'Pronađi ključ na otoku i otključaj južna vrata.',
    scrolls: [
      'Klan Kage pao je u jednoj noći. Šogun Kuroda spalio je selo i odnio Mjesečevo zrcalo. Ti si jedini preživjeli.',
      'Kamenje u rijeci stari je put ribara. Skoči (RAZMAK) s kamena na kamen — tko promaši, voda ga vraća na obalu.',
    ],
  },
  {
    kanji: '庭園', name: 'Vrtovi palače', sub: 'Noć punog mjeseca',
    floor: '.', map: levelGarden(), music: 'garden', weather: 'petals',
    weapon: 'nunchaku', sky: '#0a0f1f',
    ambient: 'rgba(6,12,38,0.62)', tintTop: 'rgba(120,150,255,0.10)', tintBot: 'rgba(10,10,40,0.25)',
    objective: 'Dva ključa otvaraju dvoja vrata. Stražari u paviljonu čuvaju nunčake.',
    scrolls: [
      'Strijelci ne vide kroz dim. Bomba dima (F) slijepi sve u blizini — tada napadni s leđa.',
      'Drži BLOK dok hodaš i šuljaš se: sporije, ali tiho. Neoprezni stražar pada od jednog udarca.',
    ],
  },
  {
    kanji: '牢獄', name: 'Tamnica', sub: 'Ispod zidina',
    floor: '=', map: levelDungeon(), music: 'dungeon', weather: 'embers',
    weapon: 'bo', sky: '#050507',
    ambient: 'rgba(3,3,9,0.86)', tintTop: 'rgba(255,90,30,0.06)', tintBot: 'rgba(0,0,0,0.3)',
    objective: 'Šiljci se dižu u valovima. Prati ritam, nađi oba ključa.',
    scrolls: [
      'Ovdje je Kuroda držao sljedbenike našeg klana. Njihov bo štap još čeka u ćeliji.',
      'Savršen blok, pritisnut tik prije udarca, ruši protivnika i vraća strijele natrag.',
    ],
  },
  {
    kanji: '天守', name: 'Šogunova utvrda', sub: 'Posljednja noć',
    floor: '_', map: levelKeep(), music: 'keep', weather: 'rain',
    weapon: null, sky: '#12060c',
    ambient: 'rgba(22,6,14,0.6)', tintTop: 'rgba(200,40,40,0.10)', tintBot: 'rgba(10,0,20,0.3)',
    objective: 'Ključ je u oružarnici. Iza vrata čeka Šogun Kuroda.',
    scrolls: [
      'Kuroda nosi oklop koji lagani udarci ne probijaju. Jaki udarac, savršen blok i strpljenje.',
    ],
  },
];
