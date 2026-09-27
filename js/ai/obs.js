// Observation + action encoding for the learned agent. Shared by the browser
// game and the Node training workers, so both see the world identically.
//
// Everything is from the agent's own point of view, and player 1's view is
// mirrored left<->right (the arena is mirror-symmetric), so one policy plays
// both sides. Actions are mirrored back when decoded.

import { T, WIDTH, HEIGHT, CHARACTERS, CHARACTER_IDS, solidAt, suddenDeathSeconds } from "../sim.js";

export const MISSILE_SLOTS = 5;
export const PICKUP_SLOTS = 2;
const RAY_DIRS = [
  [1, 0], [-1, 0], [0, -1], [0, 1],
  [0.7071067811865476, -0.7071067811865476], [-0.7071067811865476, -0.7071067811865476],
  [0.7071067811865476, 0.7071067811865476], [-0.7071067811865476, 0.7071067811865476],
];
const RAY_MAX = 200;

const SELF_SIZE = 20;
const OPP_SIZE = 21;
const MISSILE_SIZE = 9;
const PICKUP_SIZE = 6;
export const OBS_SIZE = SELF_SIZE + OPP_SIZE + MISSILE_SLOTS * MISSILE_SIZE + PICKUP_SLOTS * PICKUP_SIZE + 2 + RAY_DIRS.length;

// Factored action: one categorical choice per head.
//   horiz: left / none / right      vert: up / none / down
//   jump: no / yes   fire: no / yes   special: no / yes
export const HEADS = [3, 3, 2, 2, 2];
export const N_LOGITS = HEADS.reduce((a, b) => a + b, 0);

export function buildObs(state, id, out = new Float32Array(OBS_SIZE)) {
  const flip = id === 1;
  const fx = (x) => (flip ? WIDTH - x : x); // mirror a point's x
  const fv = (v) => (flip ? -v : v); // mirror a horizontal velocity/direction
  const me = state.players[id];
  const op = state.players[1 - id];
  const mx = fx(me.x + T.playerW / 2);
  const my = me.y + T.playerH / 2;
  let k = 0;

  // --- self
  out[k++] = mx / WIDTH;
  out[k++] = my / HEIGHT;
  out[k++] = fv(me.vx) / 6;
  out[k++] = me.vy / 6;
  out[k++] = me.hp / T.maxHp;
  out[k++] = me.grounded ? 1 : 0;
  out[k++] = fv(me.wallDir);
  out[k++] = fv(me.hanging);
  out[k++] = me.airJumps;
  out[k++] = me.cooldown / T.fireCooldown;
  out[k++] = me.specialCooldown / CHARACTERS[me.char].cooldown;
  out[k++] = me.dashTicks > 0 || me.shieldTicks > 0 ? 1 : 0;
  out[k++] = me.invuln > 0 || me.shieldTicks > 0 ? 1 : 0;
  out[k++] = fv(me.facing);
  out[k++] = me.stacks.radius / T.maxStacks;
  out[k++] = me.stacks.speed / T.maxStacks;
  out[k++] = me.stacks.damage / T.maxStacks;
  for (const c of CHARACTER_IDS) out[k++] = me.char === c ? 1 : 0;

  // --- opponent
  const ox = fx(op.x + T.playerW / 2);
  const oy = op.y + T.playerH / 2;
  out[k++] = op.alive ? 1 : 0;
  out[k++] = (ox - mx) / WIDTH;
  out[k++] = (oy - my) / HEIGHT;
  out[k++] = ox / WIDTH;
  out[k++] = oy / HEIGHT;
  out[k++] = fv(op.vx) / 6;
  out[k++] = op.vy / 6;
  out[k++] = op.hp / T.maxHp;
  out[k++] = op.grounded ? 1 : 0;
  out[k++] = fv(op.hanging);
  out[k++] = op.cooldown / T.fireCooldown;
  out[k++] = op.specialCooldown / CHARACTERS[op.char].cooldown;
  out[k++] = op.dashTicks > 0 ? 1 : 0;
  out[k++] = op.shieldTicks > 0 ? 1 : 0;
  out[k++] = fv(op.facing);
  out[k++] = op.stacks.radius / T.maxStacks;
  out[k++] = op.stacks.speed / T.maxStacks;
  out[k++] = op.stacks.damage / T.maxStacks;
  for (const c of CHARACTER_IDS) out[k++] = op.char === c ? 1 : 0;

  // --- nearest missiles
  const missiles = state.missiles
    .map((m) => ({ m, d: (fx(m.x) - mx) ** 2 + (m.y - my) ** 2 }))
    .sort((a, b) => a.d - b.d);
  for (let s = 0; s < MISSILE_SLOTS; s++) {
    const m = missiles[s]?.m;
    if (!m) {
      for (let j = 0; j < MISSILE_SIZE; j++) out[k++] = 0;
      continue;
    }
    out[k++] = 1;
    out[k++] = (fx(m.x) - mx) / WIDTH;
    out[k++] = (m.y - my) / HEIGHT;
    out[k++] = fv(m.vx) / 8;
    out[k++] = m.vy / 8;
    out[k++] = m.owner === id ? 1 : 0;
    out[k++] = m.heavy ? 1 : 0;
    out[k++] = m.radius / 60;
    out[k++] = m.age <= T.missileThrustTicks ? 1 : 0;
  }

  // --- pickups
  for (let s = 0; s < PICKUP_SLOTS; s++) {
    const pk = state.pickups[s];
    if (!pk) {
      for (let j = 0; j < PICKUP_SIZE; j++) out[k++] = 0;
      continue;
    }
    out[k++] = 1;
    out[k++] = (fx(pk.x) - mx) / WIDTH;
    out[k++] = (pk.y - my) / HEIGHT;
    out[k++] = pk.kind === "radius" ? 1 : 0;
    out[k++] = pk.kind === "speed" ? 1 : 0;
    out[k++] = pk.kind === "damage" ? 1 : 0;
  }

  // --- time
  out[k++] = state.tick / T.maxTicks;
  out[k++] = suddenDeathSeconds(state) > 0 ? 1 : 0;

  // --- terrain: distance to the nearest wall in 8 directions (in the mirrored frame)
  const realX = me.x + T.playerW / 2;
  for (const [ux, uy] of RAY_DIRS) {
    const dx = flip ? -ux : ux;
    let d = 4;
    while (d < RAY_MAX && !solidAt(realX + dx * d, my + uy * d)) d += 4;
    out[k++] = d / RAY_MAX;
  }

  if (k !== OBS_SIZE) throw new Error(`obs size mismatch ${k} != ${OBS_SIZE}`);
  return out;
}

// actions: [horiz 0..2, vert 0..2, jump 0..1, fire 0..1, special 0..1] in the agent's (mirrored) frame
export function decodeAction(a, id) {
  let left = a[0] === 0;
  let right = a[0] === 2;
  if (id === 1) [left, right] = [right, left];
  return { left, right, up: a[1] === 0, down: a[1] === 2, jump: a[2] === 1, fire: a[3] === 1, special: a[4] === 1 };
}
