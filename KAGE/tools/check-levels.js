// Offline sanity check: every level is rectangular and the player can reach
// every key, weapon and the exit (gates count as passable, 1-tile gaps jumpable).
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Math, localStorage: undefined };
vm.createContext(ctx);
for (const f of ['util.js', 'levels.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8') + ';this.LEVELS=typeof LEVELS!=="undefined"?LEVELS:this.LEVELS;this.TILE=typeof TILE!=="undefined"?TILE:this.TILE;', ctx);
let bad = 0;
ctx.LEVELS.forEach((L, li) => {
  const m = L.map, h = m.length, w = m[0].length;
  if (!m.every((r) => r.length === w)) { console.log('L' + li, 'ragged rows'); bad++; }
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '#' : m[y][x]);
  const solid = (c) => { const t = ctx.TILE[c]; return t && (t.block && !t.gate) || (t && t.obj && t.rad && c !== 'C'); };
  const deadly = (c) => c === '~' || c === 'V';
  const walk = (c) => !solid(c) && !deadly(c);
  let sx, sy; const targets = [];
  m.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'P') { sx = x; sy = y; } if ('kwX'.includes(c)) targets.push([c, x, y]); }));
  const seen = new Set([sx + ',' + sy]); const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cands = [[x + dx, y + dy]];
      if (deadly(at(x + dx, y + dy)) || at(x + dx, y + dy) === 'o') cands.push([x + 2 * dx, y + 2 * dy]);
      for (const [nx, ny] of cands) {
        const c = at(nx, ny), k = nx + ',' + ny;
        if (seen.has(k) || !walk(c)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
  }
  const miss = targets.filter(([c, x, y]) => !seen.has(x + ',' + y));
  console.log(`L${li + 1} ${L.name}: ${w}x${h}, reachable ${seen.size} tiles, targets ${targets.length}, unreachable: ${miss.map((t) => t.join('@')).join(' ') || 'none'}`);
  if (miss.length) bad++;
  if (process.argv.includes('--print')) console.log(m.map((r, y) => String(y).padStart(2) + ' ' + r).join('\n'));
});
process.exit(bad ? 1 : 0);
