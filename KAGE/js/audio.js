'use strict';
/* ============================================================
   KAGE · Sound — procedural WebAudio synth: adaptive score + sfx
   Everything is synthesised at runtime; no sample files.
   ============================================================ */

const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, musicVerb, sfxVerb, delay, noiseBuf;
  const vol = { music: Store.get('vmusic', 0.6), sfx: Store.get('vsfx', 0.8) };
  let pendingTrack = null;

  // Miyako-bushi ("In") scale, the classic koto tuning
  const IN = [0, 1, 5, 7, 8];
  const HIRA = [0, 2, 3, 7, 8];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function makeIR(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);

    musicBus = ctx.createGain(); musicBus.gain.value = vol.music * 0.5; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(master);

    const ir = makeIR(3.2, 2.4);
    musicVerb = ctx.createConvolver(); musicVerb.buffer = ir; musicVerb.connect(musicBus);
    sfxVerb = ctx.createConvolver(); sfxVerb.buffer = ir;
    const sv = ctx.createGain(); sv.gain.value = 0.6; sfxVerb.connect(sv); sv.connect(sfxBus);

    // dotted-eighth tape echo for the lead (a nod to 8-bit SID echo arps)
    delay = ctx.createDelay(1.5);
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(musicBus);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    setInterval(schedule, 25);
    if (pendingTrack) { const p = pendingTrack; pendingTrack = null; play(p); }
  }

  function setVolume(kind, v) {
    vol[kind] = v; Store.set(kind === 'music' ? 'vmusic' : 'vsfx', v);
    if (!ctx) return;
    if (kind === 'music') musicBus.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.05);
    else sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  /* ------------------------------------------------------------ helpers */
  function gainEnv(t, a, peak, d, sustain = 0, hold = 0, rel = 0.08) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    if (hold > 0) {
      g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0002), t + a + d);
      g.gain.setValueAtTime(Math.max(sustain, 0.0002), t + a + d + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + rel);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    return g;
  }
  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    s.start(t, Math.random() * 1.2, dur + 0.05);
    return s;
  }
  function filt(type, f, q = 1) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
  }
  function out(node, bus, verb, amt) {
    node.connect(bus);
    if (verb && amt > 0) { const s = ctx.createGain(); s.gain.value = amt; node.connect(s); s.connect(verb); }
  }

  /* ------------------------------------------------------------ instruments */
  function koto(dest, f, t, vel = 0.5, decay = 1.4) {
    const o1 = ctx.createOscillator(); o1.type = 'triangle';
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
    o1.frequency.setValueAtTime(f * 1.012, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    o2.frequency.setValueAtTime(f * 1.012, t); o2.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const lp = filt('lowpass', 4200, 2);
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g = gainEnv(t, 0.003, vel * 0.32, decay);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
    dest(g, 0.45, 0.25);
    o1.start(t); o2.start(t); o1.stop(t + decay + 0.1); o2.stop(t + decay + 0.1);
  }
  function flute(dest, f, t, dur, vel = 0.5) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const o2 = ctx.createOscillator(); o2.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.985, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    o2.frequency.value = f * 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(dur, 0.5));
    lfo.connect(lg); lg.connect(o.frequency);
    const g2 = ctx.createGain(); g2.gain.value = 0.08;
    const n = noiseSrc(t, dur + 0.2);
    const bp = filt('bandpass', f * 2, 3); const ng = ctx.createGain(); ng.gain.value = 0.18;
    const g = gainEnv(t, 0.07, vel * 0.26, 0.12, vel * 0.2, Math.max(0.02, dur - 0.2), 0.25);
    o.connect(g); o2.connect(g2); g2.connect(g); n.connect(bp); bp.connect(ng); ng.connect(g);
    dest(g, 0.6, 0.35);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur + 0.6); });
  }
  function pulse(dest, f, t, dur, vel = 0.5) {
    const g = gainEnv(t, 0.005, vel * 0.13, 0.08, vel * 0.08, Math.max(0.01, dur - 0.1), 0.08);
    const lp = filt('lowpass', 2600, 4);
    [-7, 7].forEach((c) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.detune.value = c;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.2);
    });
    lp.connect(g);
    dest(g, 0.2, 0.5);
  }
  function bass(dest, f, t, dur, vel = 0.6) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f;
    const lp = filt('lowpass', 380, 3);
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    const g = gainEnv(t, 0.006, vel * 0.3, 0.1, vel * 0.22, Math.max(0.01, dur - 0.12), 0.08);
    const sg = ctx.createGain(); sg.gain.value = 0.9;
    o.connect(lp); lp.connect(g); s.connect(sg); sg.connect(g);
    dest(g, 0.05, 0);
    o.start(t); s.start(t); o.stop(t + dur + 0.2); s.stop(t + dur + 0.2);
  }
  function pad(dest, freqs, t, dur, vel = 0.4) {
    const g = gainEnv(t, 0.9, vel * 0.07, 0.4, vel * 0.06, Math.max(0.1, dur - 1.2), 1.4);
    const lp = filt('lowpass', 1100, 0.7);
    freqs.forEach((f) => {
      [-9, 9].forEach((c) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c;
        o.connect(lp); o.start(t); o.stop(t + dur + 1.6);
      });
    });
    lp.connect(g);
    dest(g, 0.7, 0);
  }
  function taiko(dest, t, vel = 1) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    const g = gainEnv(t, 0.003, vel * 0.9, 0.7);
    o.connect(g); o.start(t); o.stop(t + 0.8);
    const n = noiseSrc(t, 0.12); const lp = filt('lowpass', 380); const ng = gainEnv(t, 0.002, vel * 0.5, 0.1);
    n.connect(lp); lp.connect(ng);
    dest(g, 0.35, 0); dest(ng, 0.2, 0);
  }
  function rim(dest, t, vel = 0.5) {
    const n = noiseSrc(t, 0.06); const bp = filt('bandpass', 2600, 6); const g = gainEnv(t, 0.001, vel * 0.5, 0.05);
    n.connect(bp); bp.connect(g);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 820;
    const og = gainEnv(t, 0.001, vel * 0.12, 0.04); o.connect(og); o.start(t); o.stop(t + 0.08);
    dest(g, 0.25, 0); dest(og, 0.2, 0);
  }
  function shaker(dest, t, vel = 0.3) {
    const n = noiseSrc(t, 0.05); const hp = filt('highpass', 7000); const g = gainEnv(t, 0.004, vel * 0.18, 0.04);
    n.connect(hp); hp.connect(g); dest(g, 0.1, 0);
  }
  function bell(dest, f, t, vel = 0.5) {
    [1, 2.76, 5.4, 8.93].forEach((r, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
      const g = gainEnv(t, 0.002, vel * 0.18 / (i + 1), 2.5 / (i + 1));
      o.connect(g); o.start(t); o.stop(t + 3);
      dest(g, 0.8, 0);
    });
  }

  /* ------------------------------------------------------------ score */
  function degToMidi(root, scale, deg) {
    const o = Math.floor(deg / scale.length);
    const i = ((deg % scale.length) + scale.length) % scale.length;
    return root + 12 * o + scale[i];
  }
  function genMotif(rng, len, density, lo, hi, start) {
    const out = new Array(len).fill(null);
    let d = start, i = 0;
    while (i < len) {
      if (i === 0 || rng() < density) {
        const steps = [-2, -1, -1, 1, 1, 2, 0, 3, -3];
        d = clamp(d + steps[Math.floor(rng() * steps.length)], lo, hi);
        const durs = [2, 2, 4, 1, 3, 6];
        const dur = durs[Math.floor(rng() * durs.length)];
        out[i] = { d, dur };
        i += Math.max(1, dur);
      } else i += 2;
    }
    return out;
  }

  const TRACKS = {
    title: { bpm: 66, root: 50, scale: IN, prog: [0, 0, -2, -1], seed: 11,
      lead: 'flute', melDensity: 0.35, drums: ['T...............', '................'], arp: null,
      padOn: true, bassPat: 'x...............', combat: null },
    forest: { bpm: 90, root: 52, scale: IN, prog: [0, 0, 3, -1, 0, 2, -2, -1], seed: 3,
      lead: 'flute', melDensity: 0.55, drums: ['T.....t.T...k...', 'T..k..t.T.k.k..h'],
      arp: [0, 2, 4, 2, 5, 4, 2, 4], arpEvery: 2, padOn: true, bassPat: 'x.....x.x.......',
      combat: ['T.t.T.t.T.tkT.tk', 'x.x.x.x.x.x.x.x.'] },
    garden: { bpm: 80, root: 57, scale: IN, prog: [0, -2, 1, -1], seed: 7,
      lead: 'koto', melDensity: 0.5, drums: ['T.......k.......', 'T...h...k...h..h'],
      arp: [0, 4, 2, 5, 7, 5, 2, 4], arpEvery: 1, padOn: true, bassPat: 'x.......x.....x.',
      combat: ['T..tT..kT.t.T.kk', 'x..x..x.x..x..x.'] },
    dungeon: { bpm: 68, root: 45, scale: HIRA, prog: [0, 0, 1, -1], seed: 19,
      lead: 'flute', melDensity: 0.25, drums: ['T.........t.....', '..k.......k.....'],
      arp: [0, null, 1, null, 3, null, 1, null], arpEvery: 2, padOn: true, bassPat: 'x...............',
      combat: ['T.t.k.T.t.k.T.tk', 'x...x...x..xx...'] },
    keep: { bpm: 100, root: 50, scale: IN, prog: [0, 1, -2, -1], seed: 29,
      lead: 'pulse', melDensity: 0.5, drums: ['T...k..tT...k...', 'T.h.k.htT.h.k.h.'],
      arp: [0, 2, 4, 7, 4, 2], arpEvery: 1, padOn: true, bassPat: 'x..x..x.x..x..x.',
      combat: ['T.tkT.tkT.tkTTtk', 'x.xxx.xxx.xxx.xx'] },
    boss: { bpm: 138, root: 52, scale: IN, prog: [0, 0, 1, -1, 0, 0, -2, -1], seed: 41,
      lead: 'pulse', melDensity: 0.7, drums: ['T.tkT.tkT.tkT.tk', 'x.x.x.x.x.x.x.x.'],
      arp: [0, 4, 7, 4, 9, 7, 4, 2], arpEvery: 1, padOn: true, bassPat: 'x.xxx.xxx.xxx.xx',
      combat: ['TTtkT.tkTTtkTTTT', 'x.x.x.x.x.x.x.x.'] },
    ending: { bpm: 72, root: 55, scale: IN, prog: [0, -2, 1, 0], seed: 5,
      lead: 'koto', melDensity: 0.45, drums: ['T...............', '........k.......'],
      arp: [0, 2, 4, 7], arpEvery: 2, padOn: true, bassPat: 'x.......x.......', combat: null },
  };

  const seq = { tr: null, name: '', step: 0, next: 0, bus: null, intensity: 0, target: 0 };

  function buildTrack(name) {
    const src = TRACKS[name];
    const rng = mulberry32(src.seed * 9973);
    const A = genMotif(rng, 32, src.melDensity, 3, 11, 6);
    const B = genMotif(rng, 32, src.melDensity, 5, 13, 8);
    const Aend = A.slice(); // resolve phrase on tonic
    for (let i = 24; i < 32; i++) Aend[i] = null;
    Aend[24] = { d: 5, dur: 8 };
    return Object.assign({}, src, { form: [A, A, B, Aend] });
  }

  function play(name) {
    if (!ctx) { pendingTrack = name; return; }
    if (seq.name === name) return;
    const now = ctx.currentTime;
    if (seq.bus) {
      const old = seq.bus;
      old.gain.setTargetAtTime(0.0001, now, 0.4);
      setTimeout(() => old.disconnect(), 2500);
    }
    seq.name = name;
    if (!name) { seq.tr = null; seq.bus = null; return; }
    seq.tr = buildTrack(name);
    seq.step = 0; seq.next = now + 0.12;
    seq.bus = ctx.createGain(); seq.bus.gain.value = 0.0001;
    seq.bus.gain.setTargetAtTime(1, now, 0.6);
    seq.bus.connect(musicBus);
  }

  function schedule() {
    if (!ctx || !seq.tr) return;
    const tr = seq.tr;
    seq.intensity = approach(seq.intensity, seq.target, 0.02);
    const spb = 60 / tr.bpm / 4;
    while (seq.next < ctx.currentTime + 0.14) {
      playStep(tr, seq.step, seq.next, spb);
      seq.next += spb; seq.step++;
    }
  }

  function playStep(tr, s, t, spb) {
    const bus = seq.bus;
    const dest = (node, verbAmt, delayAmt) => {
      node.connect(bus);
      if (verbAmt > 0) { const g = ctx.createGain(); g.gain.value = verbAmt; node.connect(g); g.connect(musicVerb); }
      if (delayAmt > 0) { const g = ctx.createGain(); g.gain.value = delayAmt; node.connect(g); g.connect(delay); }
    };
    delay.delayTime.setValueAtTime(spb * 3, t);
    const bar = Math.floor(s / 16), st = s % 16;
    const chord = tr.prog[bar % tr.prog.length];
    const combat = tr.combat && seq.intensity > 0.5;
    const n = (deg, oct = 0) => mtof(degToMidi(tr.root + oct * 12, tr.scale, deg + chord));

    // drums
    const dLayers = combat ? [tr.combat[0]] : tr.drums;
    dLayers.forEach((pat) => {
      const c = pat[st];
      if (c === 'T') taiko(dest, t, 0.9);
      else if (c === 't') taiko(dest, t, 0.45);
      else if (c === 'k') rim(dest, t, 0.5);
      else if (c === 'h') shaker(dest, t, 0.5);
    });
    // bass
    const bp = combat ? tr.combat[1] : tr.bassPat;
    if (bp[st] === 'x') bass(dest, n(0, -2), t, spb * 1.8, combat ? 0.8 : 0.6);
    // pad
    if (tr.padOn && st === 0 && bar % 2 === 0) pad(dest, [n(0, -1), n(2, -1), n(4, -1)], t, spb * 32, 0.6);
    // arp
    if (tr.arp && st % tr.arpEvery === 0) {
      const a = tr.arp[(st / tr.arpEvery) % tr.arp.length];
      if (a !== null && a !== undefined) koto(dest, n(a, 0), t, 0.28 + (combat ? 0.12 : 0), 0.9);
    }
    // melody
    const phrase = tr.form[Math.floor(bar / 2) % tr.form.length];
    const ev = phrase[(bar % 2) * 16 + st];
    if (ev) {
      const f = mtof(degToMidi(tr.root + 12, tr.scale, ev.d + chord));
      const dur = ev.dur * spb;
      if (tr.lead === 'flute') flute(dest, f, t, dur, 0.55);
      else if (tr.lead === 'koto') koto(dest, f, t, 0.55, 1.6);
      else pulse(dest, f, t, dur, 0.6);
    }
  }

  function setIntensity(v) { seq.target = v; }

  /* ------------------------------------------------------------ sfx */
  const sfxDest = (node, verb = 0) => out(node, sfxBus, sfxVerb, verb);
  let lastSfx = {};
  function sfx(name, vel = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (lastSfx[name] && t - lastSfx[name] < 0.025) return;
    lastSfx[name] = t;
    const f = SFX[name];
    if (f) f(t, vel);
  }
  const SFX = {
    swing(t, v) {
      const n = noiseSrc(t, 0.2); const bp = filt('bandpass', 900, 2.5);
      bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(3800, t + 0.13);
      const g = gainEnv(t, 0.02, 0.45 * v, 0.15); n.connect(bp); bp.connect(g); sfxDest(g, 0.1);
    },
    heavy(t, v) {
      const n = noiseSrc(t, 0.4); const bp = filt('bandpass', 400, 1.5);
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.3);
      const g = gainEnv(t, 0.05, 0.6 * v, 0.32); n.connect(bp); bp.connect(g); sfxDest(g, 0.2);
    },
    hit(t, v) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      const g = gainEnv(t, 0.002, 0.8 * v, 0.18); o.connect(g); o.start(t); o.stop(t + 0.25); sfxDest(g, 0.1);
      const n = noiseSrc(t, 0.1); const lp = filt('lowpass', 2400); const ng = gainEnv(t, 0.001, 0.5 * v, 0.09);
      n.connect(lp); lp.connect(ng); sfxDest(ng, 0.05);
    },
    slice(t, v) {
      SFX.hit(t, v);
      const n = noiseSrc(t, 0.15); const hp = filt('highpass', 3000); const g = gainEnv(t, 0.001, 0.35 * v, 0.12);
      n.connect(hp); hp.connect(g); sfxDest(g, 0.1);
    },
    clang(t, v) {
      [1, 2.76, 5.4, 8.93].forEach((r, i) => {
        const o = ctx.createOscillator(); o.type = i ? 'sine' : 'square'; o.frequency.value = 720 * r * rnd(0.98, 1.02);
        const g = gainEnv(t, 0.001, (0.22 * v) / (i + 1), 0.5 / (1 + i * 0.4)); o.connect(g); o.start(t); o.stop(t + 0.6);
        sfxDest(g, 0.4);
      });
      const n = noiseSrc(t, 0.05); const hp = filt('highpass', 4000); const g = gainEnv(t, 0.001, 0.4 * v, 0.04);
      n.connect(hp); hp.connect(g); sfxDest(g, 0.2);
    },
    parry(t, v) {
      SFX.clang(t, v * 1.1);
      [1320, 1760, 2640].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = gainEnv(t + i * 0.04, 0.002, 0.12 * v, 0.9); o.connect(g); o.start(t); o.stop(t + 1.2); sfxDest(g, 0.9);
      });
    },
    step(t, v) {
      const n = noiseSrc(t, 0.05); const lp = filt('lowpass', 900); const g = gainEnv(t, 0.002, 0.07 * v, 0.05);
      n.connect(lp); lp.connect(g); sfxDest(g, 0);
    },
    jump(t, v) {
      const n = noiseSrc(t, 0.2); const bp = filt('bandpass', 600, 1.2);
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
      const g = gainEnv(t, 0.01, 0.2 * v, 0.18); n.connect(bp); bp.connect(g); sfxDest(g, 0);
    },
    land(t, v) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
      const g = gainEnv(t, 0.002, 0.35 * v, 0.1); o.connect(g); o.start(t); o.stop(t + 0.15); sfxDest(g, 0);
      SFX.step(t, v * 2);
    },
    roll(t, v) {
      const n = noiseSrc(t, 0.35); const lp = filt('lowpass', 700); const g = gainEnv(t, 0.05, 0.22 * v, 0.3);
      n.connect(lp); lp.connect(g); sfxDest(g, 0);
    },
    splash(t, v) {
      const n = noiseSrc(t, 0.8); const lp = filt('lowpass', 3000);
      lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.7);
      const g = gainEnv(t, 0.01, 0.6 * v, 0.7); n.connect(lp); lp.connect(g); sfxDest(g, 0.4);
    },
    pickup(t, v) {
      [0, 7, 12].forEach((s, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(76 + s);
        const g = gainEnv(t + i * 0.06, 0.003, 0.18 * v, 0.4); o.connect(g); o.start(t); o.stop(t + 0.8); sfxDest(g, 0.6);
      });
    },
    key(t, v) {
      [0, 5, 7, 12, 17].forEach((s, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(79 + s);
        const g = gainEnv(t + i * 0.07, 0.003, 0.16 * v, 0.7); o.connect(g); o.start(t); o.stop(t + 1.3); sfxDest(g, 0.8);
      });
    },
    gate(t, v) {
      const n = noiseSrc(t, 1.2); const lp = filt('lowpass', 220, 4); const g = gainEnv(t, 0.1, 0.7 * v, 1.1);
      n.connect(lp); lp.connect(g); sfxDest(g, 0.3);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 38;
      const og = gainEnv(t, 0.1, 0.15 * v, 1.0); const ol = filt('lowpass', 120); o.connect(ol); ol.connect(og); o.start(t); o.stop(t + 1.2); sfxDest(og, 0);
    },
    locked(t, v) {
      [0, 0.09].forEach((d) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 180;
        const g = gainEnv(t + d, 0.002, 0.12 * v, 0.07); const lp = filt('lowpass', 900); o.connect(lp); lp.connect(g);
        o.start(t); o.stop(t + 0.3); sfxDest(g, 0);
      });
    },
    throw(t, v) {
      const n = noiseSrc(t, 0.12); const bp = filt('bandpass', 3000, 4);
      bp.frequency.setValueAtTime(5000, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.1);
      const g = gainEnv(t, 0.005, 0.3 * v, 0.1); n.connect(bp); bp.connect(g); sfxDest(g, 0.1);
    },
    tink(t, v) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = rnd(2400, 3000);
      const g = gainEnv(t, 0.001, 0.15 * v, 0.12); o.connect(g); o.start(t); o.stop(t + 0.2); sfxDest(g, 0.3);
    },
    bow(t, v) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.12);
      const g = gainEnv(t, 0.002, 0.25 * v, 0.14); o.connect(g); o.start(t); o.stop(t + 0.2); sfxDest(g, 0.1);
      SFX.throw(t, v * 0.8);
    },
    hurt(t, v) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.22);
      const lp = filt('lowpass', 900, 2); const g = gainEnv(t, 0.01, 0.22 * v, 0.22);
      o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.3); sfxDest(g, 0.1);
      SFX.hit(t, v);
    },
    alert(t, v) {
      [0, 1].forEach((i) => {
        const f = i ? 1046 : 988;
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const lp = filt('lowpass', 3000); const g = gainEnv(t, 0.002, 0.09 * v, 0.35);
        o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.4); sfxDest(g, 0.5);
      });
    },
    death(t, v) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
      const g = gainEnv(t, 0.01, 0.8 * v, 1.5); o.connect(g); o.start(t); o.stop(t + 1.6); sfxDest(g, 0.5);
    },
    smoke(t, v) {
      const n = noiseSrc(t, 0.9); const lp = filt('lowpass', 1200);
      lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
      const g = gainEnv(t, 0.005, 0.55 * v, 0.85); n.connect(lp); lp.connect(g); sfxDest(g, 0.5);
    },
    stealth(t, v) {
      SFX.slice(t, v);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t + 0.05); o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
      const g = gainEnv(t + 0.05, 0.01, 0.7 * v, 1.2); o.connect(g); o.start(t); o.stop(t + 1.4); sfxDest(g, 0.8);
    },
    bell(t, v) { bell(sfxDest, 392, t, v); bell(sfxDest, 196, t + 0.02, v * 0.8); },
    ui(t, v) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1320;
      const g = gainEnv(t, 0.001, 0.08 * v, 0.06); o.connect(g); o.start(t); o.stop(t + 0.1); sfxDest(g, 0.1);
    },
    spike(t, v) {
      const n = noiseSrc(t, 0.12); const hp = filt('highpass', 1800); const g = gainEnv(t, 0.002, 0.18 * v, 0.1);
      n.connect(hp); hp.connect(g); sfxDest(g, 0);
    },
    slam(t, v) {
      taiko(sfxDest, t, 1.4 * v);
      const n = noiseSrc(t, 0.6); const lp = filt('lowpass', 500); const g = gainEnv(t, 0.005, 0.7 * v, 0.6);
      n.connect(lp); lp.connect(g); sfxDest(g, 0.4);
    },
    gong(t, v) {
      [1, 1.48, 2.02, 2.74, 3.3].forEach((r, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 98 * r;
        const g = gainEnv(t, 0.01, (0.35 * v) / (i + 1), 4 / (1 + i * 0.3)); o.connect(g); o.start(t); o.stop(t + 4.5);
        sfxDest(g, 0.9);
      });
    },
  };

  return { init, play, sfx, setVolume, setIntensity, vol, get ready() { return !!ctx; } };
})();
