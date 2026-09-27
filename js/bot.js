// Scripted baseline bot — NOT trained, just hand-written rules. It's the
// yardstick the trained AI has to beat later. It re-decides on a timer and on
// "events" (enemy fires, something explodes), after a reaction delay, and
// holds its input in between.

import { T, CHARACTERS, solidAt, playerStats } from "./sim.js";

const DIAG = 0.7071067811865476;
const DIRS = [
  [1, 0], [-1, 0], [0, -1], [0, 1],
  [DIAG, -DIAG], [-DIAG, -DIAG], [DIAG, DIAG], [-DIAG, DIAG],
];

export const BOT_LEVELS = {
  easy: { thinkEvery: 14, reactionTicks: 18, fireChance: 0.45, aimSlop: 10, dodgeChance: 0.3, specialChance: 0.15, lead: 0 },
  normal: { thinkEvery: 10, reactionTicks: 12, fireChance: 0.7, aimSlop: 6, dodgeChance: 0.55, specialChance: 0.35, lead: 0.5 },
  hard: { thinkEvery: 6, reactionTicks: 6, fireChance: 0.9, aimSlop: 3, dodgeChance: 0.8, specialChance: 0.7, lead: 1 },
};

export function createBot(id, rng, level = "normal") {
  return { id, rng, ...BOT_LEVELS[level], timer: 0, pendingReact: -1, sinceShot: 0, input: blank() };
}

function blank() {
  return { left: false, right: false, up: false, down: false, jump: false, fire: false, special: false };
}

// Call once per tick with the events from the previous step.
export function botInput(bot, state, lastEvents = []) {
  const me = state.players[bot.id];
  if (!me.alive || state.over) return blank();

  if (bot.pendingReact < 0 && lastEvents.some((e) => (e.type === "fire" && e.player !== bot.id) || e.type === "explode")) {
    bot.pendingReact = bot.reactionTicks;
  }
  if (bot.pendingReact > 0) bot.pendingReact -= 1;

  bot.timer -= 1;
  if (bot.timer <= 0 || bot.pendingReact === 0) {
    bot.input = think(bot, state, me);
    bot.sinceShot = bot.input.fire ? 0 : bot.sinceShot + bot.thinkEvery;
    bot.timer = bot.thinkEvery;
    bot.pendingReact = -1;
  } else {
    // special is a one-tick press; jump is held (full height) but released just
    // before the next think so a new jump registers as a fresh press
    bot.input = { ...bot.input, special: false, jump: bot.timer === 1 ? false : bot.input.jump };
  }
  return bot.input;
}

function think(bot, state, me) {
  const op = state.players[1 - bot.id];
  const input = blank();
  const mx = me.x + T.playerW / 2;
  const my = me.y + T.playerH / 2;
  const ox = op.x + T.playerW / 2;
  const oy = op.y + T.playerH / 2;
  const stats = playerStats(state, me);
  const special = CHARACTERS[me.char].special;
  const specialReady = me.specialCooldown === 0 && me.shieldTicks === 0;

  // 1) defend: an enemy missile about to hit me => dash away / raise the shield / jump
  const threat = incomingThreat(state, bot.id, mx, my);
  if (threat) {
    if (specialReady && special === "dash" && bot.rng() < bot.specialChance) {
      input.special = true;
      input.up = true; // dash up and along the missile's travel direction, out of its path
      if (threat.vx > 0) input.right = true;
      else input.left = true;
      return input;
    }
    if (specialReady && special === "shield" && bot.rng() < bot.specialChance) {
      input.special = true;
      return input;
    }
    if (bot.rng() < bot.dodgeChance) input.jump = true;
  }

  // 2) shoot: simulate each of the 8 arcs and take the one landing closest to the opponent.
  //    Ember uses the super-cannon (bigger blast, slower shell) when it's ready.
  const cannon = special === "cannon" && specialReady && bot.rng() < bot.specialChance;
  const canShoot = cannon || me.cooldown <= 2;
  if (op.alive && canShoot && me.dashTicks === 0 && me.shieldTicks === 0 && bot.rng() < bot.fireChance) {
    const leadX = op.vx * bot.lead;
    const speed = stats.speed * (cannon ? T.cannonSpeedMult : 1);
    const radius = stats.radius * (cannon ? T.cannonRadiusMult : 1);
    let best = null;
    for (const [ux, uy] of DIRS) {
      const shot = simulateShot(mx + ux * 6, my + uy * 6, ux * speed, uy * speed, ox, oy, leadX);
      if (!shot) continue;
      const safe = Math.hypot(shot.x - mx, shot.y - my) > radius + 6;
      const good = shot.miss < bot.aimSlop || (shot.hitWall && shot.miss < radius * 0.7);
      if (safe && good && (!best || shot.miss < best.miss)) best = { ux, uy, miss: shot.miss };
    }
    if (best) {
      if (cannon) input.special = true;
      else input.fire = true;
      if (best.ux > 0.1) input.right = true;
      if (best.ux < -0.1) input.left = true;
      if (best.uy < -0.1) input.up = true;
      if (best.uy > 0.1) input.down = true;
      return input;
    }
  }

  // 3) move: grab a nearby pickup, else keep a comfortable distance (push in if no shots lately)
  const restless = bot.sinceShot > 90;
  let tx = ox;
  let ty = oy;
  let wantDist = restless ? 0 : 90;
  const pickup = nearest(state.pickups, mx, my);
  if (pickup && Math.hypot(pickup.x - mx, pickup.y - my) < Math.hypot(ox - mx, oy - my) * 1.6 + 40) {
    tx = pickup.x;
    ty = pickup.y;
    wantDist = 0;
  }
  const dx = tx - mx;
  let dir = 0;
  if (Math.abs(dx) > wantDist + 20) dir = Math.sign(dx);
  else if (wantDist > 0 && Math.abs(dx) < wantDist - 30) dir = -Math.sign(dx) || 1;
  if (dir === 0 && bot.rng() < 0.3) dir = bot.rng() < 0.5 ? -1 : 1;
  if (dir > 0) input.right = true;
  if (dir < 0) input.left = true;

  // jump over walls, toward targets above (double jumps happen naturally mid-air), or sometimes
  const wallAhead = dir !== 0 && solidAt(mx + dir * 12, my);
  if (me.hanging !== 0) input.jump = bot.rng() < 0.7;
  else if (wallAhead || (ty < my - 24 && bot.rng() < 0.5) || bot.rng() < (restless ? 0.3 : 0.08)) input.jump = true;

  return input;
}

// Follow a missile arc with the sim's own physics; report how close it gets to the target.
function simulateShot(x, y, vx, vy, ox, oy, leadX) {
  let miss = Infinity;
  for (let t = 1; t <= 120; t++) {
    if (t > T.missileThrustTicks) vy += T.missileGravity;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const n = Math.max(1, Math.ceil(speed / 3));
    for (let s = 0; s < n; s++) {
      x += vx / n;
      y += vy / n;
      const tx = ox + leadX * t;
      const d = Math.hypot(x - tx, y - oy);
      if (d < miss) miss = d;
      if (solidAt(x, y)) return { x, y, miss: Math.hypot(x - tx, y - oy), hitWall: miss > 8 };
      if (d < 7) return { x, y, miss: d, hitWall: false };
    }
  }
  return null;
}

// Enemy missile that will pass near me (or blow up next to me) within ~20 ticks.
function incomingThreat(state, myId, mx, my) {
  for (const m of state.missiles) {
    if (m.owner === myId) continue;
    let { x, y, vx, vy } = m;
    for (let t = 1; t <= 20; t++) {
      if (m.age + t > T.missileThrustTicks) vy += T.missileGravity;
      x += vx;
      y += vy;
      const near = Math.hypot(x - mx, y - my);
      if (near < 16 || (solidAt(x, y) && near < m.radius)) return m;
      if (solidAt(x, y)) break;
    }
  }
  return null;
}

function nearest(items, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.x - x, it.y - y);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}
