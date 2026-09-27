// Synthesized SFX (no audio files), adapted from Heartfall's voxel-audio.js.
// Browsers block audio until a user gesture: call unlockAudio() from a key/pad handler.

let ctx = null;
let bus = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function getBus(c) {
  if (!bus) {
    bus = c.createGain();
    bus.gain.value = 0.55;
    bus.connect(c.destination);
  }
  return bus;
}

export function unlockAudio() {
  getCtx();
}

function noiseBuffer(c, duration) {
  const n = Math.max(1, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envGain(c, out, t0, attack, decay, peak) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(out);
  return g;
}

function filteredNoise(c, out, type, duration, startFreq, endFreq, rampTime, t0, attack, decay, peak, q = 0.5) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, duration);
  const f1 = c.createBiquadFilter();
  f1.type = type;
  f1.Q.value = q;
  f1.frequency.setValueAtTime(startFreq, t0);
  f1.frequency.exponentialRampToValueAtTime(endFreq, t0 + rampTime);
  const f2 = c.createBiquadFilter();
  f2.type = type;
  f2.Q.value = q;
  f2.frequency.setValueAtTime(startFreq, t0);
  f2.frequency.exponentialRampToValueAtTime(endFreq, t0 + rampTime);
  const g = envGain(c, out, t0, attack, decay, peak);
  src.connect(f1);
  f1.connect(f2);
  f2.connect(g);
  src.start(t0);
}

// Heartfall's dark boom: detuned sub-bass thump + double-lowpassed noise body
// + rumble tail. Bigger blast radius => louder, longer, deeper.
export function playExplosion(radiusPx = 26) {
  const c = getCtx();
  const t0 = c.currentTime;
  const r = radiusPx / 8; // ~3 at base radius, like Heartfall's scale
  const scale = Math.min(3.2, 0.7 + r * 0.16);
  const master = c.createGain();
  master.gain.value = Math.min(2.2, 0.9 * scale);
  master.connect(getBus(c));

  for (const detune of [0, -6]) {
    const sub = c.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(120 * Math.pow(2, detune / 1200), t0);
    sub.frequency.exponentialRampToValueAtTime(28, t0 + 0.28 * scale);
    const g = envGain(c, master, t0, 0.005, 0.8 * scale, 0.9);
    sub.connect(g);
    sub.start(t0);
    sub.stop(t0 + 1.0 * scale);
  }
  filteredNoise(c, master, "lowpass", 0.8 * scale, 900, 80, 0.4 * scale, t0, 0.005, 0.55 * scale, 1.0);
  filteredNoise(c, master, "lowpass", 1.4 * scale, 240, 60, 0.5 * scale, t0 + 0.05, 0.25, 1.1 * scale, 0.5);
}

// Fast missile launch: a bright rising "fsssh" plus a low kick.
export function playLaunch(speedBonus = 0) {
  const c = getCtx();
  const t0 = c.currentTime;
  const master = c.createGain();
  master.gain.value = 0.45;
  master.connect(getBus(c));
  filteredNoise(c, master, "bandpass", 0.25, 1400 + speedBonus * 300, 5200 + speedBonus * 800, 0.12, t0, 0.004, 0.16, 0.9, 1.2);
  const kick = c.createOscillator();
  kick.type = "triangle";
  kick.frequency.setValueAtTime(180, t0);
  kick.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
  const g = envGain(c, master, t0, 0.002, 0.09, 0.7);
  kick.connect(g);
  kick.start(t0);
  kick.stop(t0 + 0.12);
}

function blip(type, f0, f1, dur, peak, delay = 0) {
  const c = getCtx();
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = envGain(c, getBus(c), t0, 0.003, dur, peak);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export function playJump() {
  blip("square", 260, 520, 0.08, 0.08);
}

export function playLand() {
  blip("sine", 140, 60, 0.07, 0.25);
}

export function playPickup() {
  blip("triangle", 660, 880, 0.08, 0.25);
  blip("triangle", 880, 1320, 0.1, 0.25, 0.07);
}

export function playSpawn() {
  blip("sine", 520, 780, 0.12, 0.12);
}

export function playHit() {
  blip("square", 300, 90, 0.12, 0.18);
}

export function playDeath() {
  blip("sawtooth", 400, 40, 0.6, 0.25);
  playExplosion(60);
}

export function playRoundStart() {
  blip("triangle", 440, 440, 0.1, 0.2);
  blip("triangle", 660, 660, 0.18, 0.2, 0.12);
}

export function playDoubleJump() {
  blip("square", 420, 840, 0.09, 0.08);
}

export function playDash() {
  const c = getCtx();
  const t0 = c.currentTime;
  filteredNoise(c, getBus(c), "bandpass", 0.3, 3000, 500, 0.2, t0, 0.005, 0.22, 0.7, 1.5);
}

export function playHang() {
  blip("triangle", 200, 160, 0.05, 0.15);
}

export function playDodge() {
  blip("sine", 1200, 1800, 0.12, 0.15);
}

// Super-cannon: deep "thoom" + a heavier launch.
export function playCannon() {
  blip("sine", 90, 35, 0.35, 0.6);
  playLaunch(-1);
}

export function playShield() {
  blip("sine", 300, 900, 0.15, 0.15);
  blip("triangle", 600, 600, 0.3, 0.06, 0.05);
}

export function playReflect() {
  blip("square", 1500, 700, 0.12, 0.15);
  blip("triangle", 2200, 2200, 0.08, 0.1, 0.04);
}
