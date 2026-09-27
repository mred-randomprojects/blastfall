// Pure, deterministic game simulation — no DOM, no Math.random, no trig.
// Same seed + same inputs => identical state, so it can later run headless
// (and be ported to Python) for training. One call to createRound() is one
// round; step() advances it by one fixed 1/60s tick.

export const TICK_HZ = 60;
export const TILE = 16;

// '#' solid, '.' empty. 30 x 17 tiles => 480 x 272 logical pixels.
export const MAP = [
  "##############################",
  "#............................#",
  "#............................#",
  "#...######..........######...#",
  "#............................#",
  "#............................#",
  "#.........##########.........#",
  "#............................#",
  "#............................#",
  "####......................####",
  "#............................#",
  "#......######....######......#",
  "#............................#",
  "#............................#",
  "#.............##.............#",
  "#.............##.............#",
  "##############################",
];
export const COLS = MAP[0].length;
export const ROWS = MAP.length;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

export const SPAWNS = [
  { x: 3 * TILE + 3, y: 15 * TILE + 4 },
  { x: 26 * TILE + 3, y: 15 * TILE + 4 },
];

// Where power-ups may appear (centres, floating above platforms).
export const PICKUP_SPOTS = [
  { x: 15 * TILE, y: 5 * TILE + 6 },
  { x: 7 * TILE, y: 2 * TILE + 6 },
  { x: 23 * TILE, y: 2 * TILE + 6 },
  { x: 9 * TILE + 8, y: 10 * TILE + 6 },
  { x: 20 * TILE + 8, y: 10 * TILE + 6 },
  { x: 15 * TILE, y: 12 * TILE + 8 },
];

export const PICKUP_KINDS = ["radius", "speed", "damage"];

export const T = {
  gravity: 0.3,
  maxFall: 6,
  maxSpeed: 12,
  runMax: 1.9,
  groundAccel: 0.4,
  airAccel: 0.25,
  groundFriction: 0.3,
  airFriction: 0.05,
  jumpVel: 7.2,
  airJumpVel: 6,
  airJumps: 1, // double jump
  jumpCutVel: 2.5,
  wallSlideMax: 0.7, // slow descent while holding toward a wall
  wallJumpVx: 2.8,
  wallJumpVy: 6.6,
  wallJumpLockTicks: 8,
  ledgeGrabLockTicks: 14, // after letting go of a ledge, don't instantly re-grab
  coyoteTicks: 6,
  jumpBufferTicks: 6,
  playerW: 10,
  playerH: 12,
  maxHp: 100,

  // specials (one per character, see CHARACTERS)
  dashSpeed: 5.5,
  dashTicks: 10,
  dashInvulnTicks: 16,
  shieldTicks: 45,
  shieldRadius: 15,
  cannonRadiusMult: 2,
  cannonDamageMult: 1.15,
  cannonSpeedMult: 0.85,
  cannonRecoil: 2.5,

  fireCooldown: 50,
  missileSpeed: 6.5,
  missileGravity: 0.06,
  missileThrustTicks: 20, // flies straight while the motor burns, then falls (0 = gravity from launch)
  missileArmTicks: 10,
  missileMaxTicks: 300,
  blastRadius: 26,
  blastDamage: 30,
  edgeDamageFactor: 0.4,
  selfDamageFactor: 0.5,
  knockback: 6,

  pickupInterval: 300,
  maxPickups: 2,
  pickupRadius: 7,
  maxStacks: 4,
  perStack: { radius: 8, speed: 1.5, damage: 8 },

  suddenDeathTick: 45 * 60,
  suddenDeathPerSec: { radius: 1.5, damage: 1.5 },
  maxTicks: 90 * 60,
};

// Each character has the same base kit plus ONE special on the special button.
export const CHARACTERS = {
  volt: { name: "Volt", special: "dash", specialName: "Dash", cooldown: 180 },
  aegis: { name: "Aegis", special: "shield", specialName: "Reflect Shield", cooldown: 240 },
  ember: { name: "Ember", special: "cannon", specialName: "Super-Cannon", cooldown: 300 },
};
export const CHARACTER_IDS = ["volt", "aegis", "ember"];

const DIAG = 0.7071067811865476;

/* ---------- seeded RNG (mulberry32) ---------- */

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same generator, but its state lives in the sim state (so state is fully serialisable).
function rand(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ---------- tiles ---------- */

function tileSolid(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
  return MAP[r][c] === "#";
}

export function solidAt(px, py) {
  return tileSolid(Math.floor(px / TILE), Math.floor(py / TILE));
}

function rectHitsSolid(x, y, w, h) {
  const c0 = Math.floor(x / TILE);
  const c1 = Math.floor((x + w - 0.001) / TILE);
  const r0 = Math.floor(y / TILE);
  const r1 = Math.floor((y + h - 0.001) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tileSolid(c, r)) return true;
    }
  }
  return false;
}

/* ---------- state ---------- */

function createPlayer(id, char) {
  const s = SPAWNS[id];
  return {
    id,
    char,
    x: s.x,
    y: s.y,
    vx: 0,
    vy: 0,
    facing: id === 0 ? 1 : -1,
    aimX: id === 0 ? 1 : -1,
    aimY: 0,
    hp: T.maxHp,
    alive: true,
    grounded: false,
    wallDir: 0,
    hanging: 0, // -1 / 1 while hanging off a ledge on that side
    airJumps: T.airJumps,
    coyote: 0,
    jumpBuffer: 0,
    wallJumpLock: 0,
    grabLock: 0,
    prevJump: false,
    prevSpecial: false,
    jumping: false, // rising from a jump (releasing jump cuts it; knockback isn't cut)
    specialCooldown: 0,
    dashTicks: 0,
    invuln: 0,
    shieldTicks: 0,
    cooldown: 20,
    stacks: { radius: 0, speed: 0, damage: 0 },
  };
}

export function createRound(seed = 1, chars = ["volt", "ember"]) {
  return {
    tick: 0,
    rng: seed >>> 0,
    players: [createPlayer(0, chars[0]), createPlayer(1, chars[1])],
    missiles: [],
    pickups: [],
    pickupTimer: 150,
    nextId: 1,
    over: false,
    winner: null, // 0, 1, or -1 for a draw
    events: [],
  };
}

export const NO_INPUT = Object.freeze({ left: false, right: false, up: false, down: false, jump: false, fire: false, special: false });

export function suddenDeathSeconds(state) {
  return Math.max(0, (state.tick - T.suddenDeathTick) / TICK_HZ);
}

export function playerStats(state, p) {
  const sd = suddenDeathSeconds(state);
  return {
    radius: T.blastRadius + T.perStack.radius * p.stacks.radius + T.suddenDeathPerSec.radius * sd,
    speed: T.missileSpeed + T.perStack.speed * p.stacks.speed,
    damage: T.blastDamage + T.perStack.damage * p.stacks.damage + T.suddenDeathPerSec.damage * sd,
  };
}

/* ---------- step ---------- */

export function step(state, inputs) {
  state.events = [];
  state.tick += 1;

  for (const p of state.players) {
    if (p.alive) updatePlayer(state, p, inputs[p.id] ?? NO_INPUT);
  }
  updateMissiles(state);
  updatePickups(state);
  checkRoundEnd(state);

  return state.events;
}

function emit(state, e) {
  state.events.push(e);
}

function updatePlayer(state, p, input) {
  const wasGrounded = p.grounded;
  const fallSpeed = p.vy;
  const cxOf = () => p.x + T.playerW / 2;

  // aim: 8 directions from held keys, default to facing
  let ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (ax !== 0 && p.hanging === 0) p.facing = ax;
  if (ax === 0 && ay === 0) ax = p.facing;
  if (ax !== 0 && ay !== 0) {
    p.aimX = ax * DIAG;
    p.aimY = ay * DIAG;
  } else {
    p.aimX = ax;
    p.aimY = ay;
  }

  const move = p.wallJumpLock > 0 ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (p.wallJumpLock > 0) p.wallJumpLock -= 1;
  if (p.grabLock > 0) p.grabLock -= 1;
  if (p.specialCooldown > 0) p.specialCooldown -= 1;
  if (p.invuln > 0) p.invuln -= 1;
  if (p.shieldTicks > 0) p.shieldTicks -= 1;

  const jumpPressed = input.jump && !p.prevJump;
  p.prevJump = input.jump;
  const specialPressed = input.special && !p.prevSpecial;
  p.prevSpecial = input.special;

  if (jumpPressed) p.jumpBuffer = T.jumpBufferTicks;
  else if (p.jumpBuffer > 0) p.jumpBuffer -= 1;
  if (p.grounded) p.coyote = T.coyoteTicks;
  else if (p.coyote > 0) p.coyote -= 1;

  if (specialPressed && p.specialCooldown === 0) useSpecial(state, p);

  if (p.dashTicks > 0) {
    p.dashTicks -= 1;
    if (p.dashTicks === 0) {
      p.vx *= 0.4;
      p.vy *= 0.4;
    }
  } else if (p.hanging !== 0) {
    p.vx = 0;
    p.vy = 0;
    if (p.jumpBuffer > 0) {
      // climb / jump up off the ledge
      p.vy = -T.jumpVel;
      p.jumping = true;
      p.hanging = 0;
      p.jumpBuffer = 0;
      p.airJumps = T.airJumps;
      p.grabLock = T.ledgeGrabLockTicks;
      emit(state, { type: "jump", player: p.id, x: cxOf(), y: p.y + T.playerH });
    } else if (input.down || move === -p.hanging) {
      p.hanging = 0;
      p.grabLock = T.ledgeGrabLockTicks;
    }
  } else {
    // run
    const accel = p.grounded ? T.groundAccel : T.airAccel;
    const friction = p.grounded ? T.groundFriction : T.airFriction;
    if (move !== 0 && p.vx * move < T.runMax) {
      p.vx = move * Math.min(T.runMax, p.vx * move + accel);
    } else {
      // decelerate toward 0 (or back down to run speed after knockback / dash)
      const target = move === 0 ? 0 : move * T.runMax;
      if (p.vx > target) p.vx = Math.max(target, p.vx - friction);
      else if (p.vx < target) p.vx = Math.min(target, p.vx + friction);
    }

    // jumps: ground (with coyote time) > wall jump > double jump
    if (p.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -T.jumpVel;
      p.jumping = true;
      p.jumpBuffer = 0;
      p.coyote = 0;
      emit(state, { type: "jump", player: p.id, x: cxOf(), y: p.y + T.playerH });
    } else if (p.jumpBuffer > 0 && !p.grounded && p.wallDir !== 0) {
      p.vy = -T.wallJumpVy;
      p.vx = -p.wallDir * T.wallJumpVx;
      p.facing = -p.wallDir;
      p.jumping = true;
      p.wallJumpLock = T.wallJumpLockTicks;
      p.jumpBuffer = 0;
      p.airJumps = T.airJumps;
      emit(state, { type: "walljump", player: p.id, x: p.x + (p.wallDir > 0 ? T.playerW : 0), y: p.y + T.playerH / 2 });
    } else if (p.jumpBuffer > 0 && !p.grounded && p.airJumps > 0) {
      p.vy = -T.airJumpVel;
      p.jumping = true;
      p.jumpBuffer = 0;
      p.airJumps -= 1;
      emit(state, { type: "doublejump", player: p.id, x: cxOf(), y: p.y + T.playerH });
    }
    if (p.vy >= 0) p.jumping = false;
    if (p.jumping && !input.jump && p.vy < -T.jumpCutVel) p.vy = -T.jumpCutVel;

    // gravity + slow wall slide while holding toward the wall
    p.vy = Math.min(T.maxFall, p.vy + T.gravity);
    if (!p.grounded && p.wallDir !== 0 && move === p.wallDir && p.vy > T.wallSlideMax) {
      p.vy = T.wallSlideMax;
      p.airJumps = T.airJumps;
    }
  }

  p.vx = Math.max(-T.maxSpeed, Math.min(T.maxSpeed, p.vx));
  p.vy = Math.max(-T.maxSpeed, Math.min(T.maxSpeed, p.vy));

  // move + collide, one axis at a time
  if (p.hanging === 0) {
    p.x += p.vx;
    if (rectHitsSolid(p.x, p.y, T.playerW, T.playerH)) {
      if (p.vx > 0) p.x = Math.floor((p.x + T.playerW) / TILE) * TILE - T.playerW;
      else p.x = (Math.floor(p.x / TILE) + 1) * TILE;
      p.vx = 0;
    }
    p.y += p.vy;
    if (rectHitsSolid(p.x, p.y, T.playerW, T.playerH)) {
      if (p.vy > 0) p.y = Math.floor((p.y + T.playerH) / TILE) * TILE - T.playerH;
      else p.y = (Math.floor(p.y / TILE) + 1) * TILE;
      p.vy = 0;
    }
  }

  p.grounded = p.hanging === 0 && rectHitsSolid(p.x, p.y + 1, T.playerW, T.playerH);
  p.wallDir = rectHitsSolid(p.x + 1, p.y, T.playerW, T.playerH)
    ? 1
    : rectHitsSolid(p.x - 1, p.y, T.playerW, T.playerH)
      ? -1
      : 0;
  if (p.grounded) p.airJumps = T.airJumps;

  if (p.grounded && !wasGrounded && fallSpeed > 2.5) {
    emit(state, { type: "land", player: p.id, x: cxOf(), y: p.y + T.playerH, speed: fallSpeed });
  }

  tryLedgeGrab(state, p, move);

  // fire (held = fire whenever the cooldown allows; not mid-dash or behind a shield)
  if (p.cooldown > 0) p.cooldown -= 1;
  if (input.fire && p.cooldown === 0 && p.dashTicks === 0 && p.shieldTicks === 0) {
    launch(state, p, 1, 1, 1, false);
  }
}

function launch(state, p, speedMult, radiusMult, damageMult, heavy) {
  const stats = playerStats(state, p);
  const cx = p.x + T.playerW / 2;
  const cy = p.y + T.playerH / 2;
  state.missiles.push({
    id: state.nextId++,
    owner: p.id,
    x: cx + p.aimX * 6,
    y: cy + p.aimY * 6,
    vx: p.aimX * stats.speed * speedMult,
    vy: p.aimY * stats.speed * speedMult,
    radius: stats.radius * radiusMult,
    damage: stats.damage * damageMult,
    heavy,
    age: 0,
  });
  p.cooldown = T.fireCooldown;
  emit(state, { type: "fire", player: p.id, x: cx, y: cy, dx: p.aimX, dy: p.aimY, heavy });
}

function useSpecial(state, p) {
  const ch = CHARACTERS[p.char];
  const cx = p.x + T.playerW / 2;
  const cy = p.y + T.playerH / 2;
  if (ch.special === "dash") {
    // burst in the aim direction, no gravity, invulnerable for a moment
    p.dashTicks = T.dashTicks;
    p.invuln = T.dashInvulnTicks;
    p.vx = p.aimX * T.dashSpeed;
    p.vy = p.aimY * T.dashSpeed;
    p.hanging = 0;
    p.jumping = false;
    p.grabLock = T.ledgeGrabLockTicks;
    emit(state, { type: "dash", player: p.id, x: cx, y: cy, dx: p.aimX, dy: p.aimY });
  } else if (ch.special === "shield") {
    // reflective bubble: sends enemy missiles back and blocks blast damage
    p.shieldTicks = T.shieldTicks;
    emit(state, { type: "shield", player: p.id, x: cx, y: cy });
  } else if (ch.special === "cannon") {
    // heavy shell: double blast radius, a bit slower, kicks you backwards
    if (p.dashTicks > 0) return;
    launch(state, p, T.cannonSpeedMult, T.cannonRadiusMult, T.cannonDamageMult, true);
    p.vx -= p.aimX * T.cannonRecoil;
    p.vy -= p.aimY * T.cannonRecoil;
    if (p.aimY !== 0) p.hanging = 0;
  }
  p.specialCooldown = ch.cooldown;
}

// Falling past a ledge corner while holding toward it => hang off it.
function tryLedgeGrab(state, p, move) {
  if (p.hanging !== 0 || p.grounded || p.dashTicks > 0 || p.grabLock > 0 || p.vy < 0 || move === 0) return;
  const c = move > 0 ? Math.floor((p.x + T.playerW + 1) / TILE) : Math.floor((p.x - 1) / TILE);
  const r = Math.floor((p.y + 3) / TILE);
  if (!tileSolid(c, r) || tileSolid(c, r - 1)) return; // needs a solid tile with open space above
  const edgeY = r * TILE;
  if (p.y < edgeY - 5 || p.y > edgeY + 5) return;
  const touching = move > 0 ? p.x + T.playerW >= c * TILE - 1.5 : p.x <= (c + 1) * TILE + 1.5;
  if (!touching) return;
  const hangY = edgeY - 4;
  if (rectHitsSolid(p.x, hangY, T.playerW, T.playerH)) return;
  p.y = hangY;
  p.x = move > 0 ? c * TILE - T.playerW : (c + 1) * TILE;
  p.vx = 0;
  p.vy = 0;
  p.hanging = move;
  p.facing = move;
  p.airJumps = T.airJumps;
  p.jumping = false;
  emit(state, { type: "hang", player: p.id, x: move > 0 ? c * TILE : (c + 1) * TILE, y: edgeY });
}

function updateMissiles(state) {
  const survivors = [];
  for (const m of state.missiles) {
    m.age += 1;
    if (m.age > T.missileThrustTicks) m.vy += T.missileGravity;
    const speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
    const substeps = Math.max(1, Math.ceil(speed / 3));
    const sx = m.vx / substeps;
    const sy = m.vy / substeps;
    let exploded = false;
    for (let s = 0; s < substeps && !exploded; s++) {
      m.x += sx;
      m.y += sy;
      if (solidAt(m.x, m.y)) {
        explode(state, m, m.x - sx * 0.5, m.y - sy * 0.5);
        exploded = true;
        break;
      }
      if (reflectOffShield(state, m)) continue;
      for (const p of state.players) {
        if (!p.alive || p.invuln > 0 || p.shieldTicks > 0 || (p.id === m.owner && m.age <= T.missileArmTicks)) continue;
        if (m.x >= p.x - 2 && m.x <= p.x + T.playerW + 2 && m.y >= p.y - 2 && m.y <= p.y + T.playerH + 2) {
          explode(state, m, m.x, m.y);
          exploded = true;
          break;
        }
      }
    }
    if (!exploded && m.age >= T.missileMaxTicks) {
      explode(state, m, m.x, m.y);
      exploded = true;
    }
    if (!exploded) survivors.push(m);
  }
  state.missiles = survivors;
}

// An enemy missile touching an active shield bubble turns around and becomes
// the shield owner's missile (motor relit, so it flies straight back).
function reflectOffShield(state, m) {
  for (const p of state.players) {
    if (!p.alive || p.shieldTicks === 0 || p.id === m.owner) continue;
    const cx = p.x + T.playerW / 2;
    const cy = p.y + T.playerH / 2;
    const dx = m.x - cx;
    const dy = m.y - cy;
    if (dx * dx + dy * dy > T.shieldRadius * T.shieldRadius) continue;
    const from = m.owner;
    m.vx = -m.vx;
    m.vy = -m.vy;
    m.owner = p.id;
    m.age = 0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.001) {
      m.x = cx + (dx / len) * (T.shieldRadius + 1);
      m.y = cy + (dy / len) * (T.shieldRadius + 1);
    }
    emit(state, { type: "reflect", player: p.id, from, x: m.x, y: m.y });
    return true;
  }
  return false;
}

function explode(state, m, x, y) {
  emit(state, { type: "explode", x, y, radius: m.radius, owner: m.owner });
  for (const p of state.players) {
    if (!p.alive) continue;
    // distance from blast centre to the nearest point of the player's box
    const nx = Math.max(p.x, Math.min(x, p.x + T.playerW));
    const ny = Math.max(p.y, Math.min(y, p.y + T.playerH));
    const d = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
    if (d > m.radius) continue;

    if (p.invuln > 0 || p.shieldTicks > 0) {
      emit(state, { type: p.shieldTicks > 0 ? "block" : "dodge", player: p.id, x: p.x + T.playerW / 2, y: p.y });
      continue;
    }

    const falloff = 1 - (1 - T.edgeDamageFactor) * (d / m.radius);
    const self = p.id === m.owner;
    const dmg = m.damage * falloff * (self ? T.selfDamageFactor : 1);
    p.hp -= dmg;

    const cx = p.x + T.playerW / 2 - x;
    const cy = p.y + T.playerH / 2 - y;
    const len = Math.sqrt(cx * cx + cy * cy);
    const kx = len > 0.001 ? cx / len : 0;
    const ky = len > 0.001 ? cy / len : -1;
    const k = T.knockback * (0.5 + 0.5 * falloff);
    p.vx += kx * k;
    p.vy += ky * k - 1.5;
    p.hanging = 0;
    p.grabLock = T.ledgeGrabLockTicks;
    p.jumping = false;
    p.grounded = false;

    emit(state, { type: "hit", player: p.id, by: m.owner, damage: dmg, x: p.x + T.playerW / 2, y: p.y });
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      emit(state, { type: "death", player: p.id, by: m.owner, x: p.x + T.playerW / 2, y: p.y + T.playerH / 2 });
    }
  }
}

function updatePickups(state) {
  for (const p of state.players) {
    if (!p.alive) continue;
    state.pickups = state.pickups.filter((pk) => {
      const nx = Math.max(p.x, Math.min(pk.x, p.x + T.playerW));
      const ny = Math.max(p.y, Math.min(pk.y, p.y + T.playerH));
      const dx = nx - pk.x;
      const dy = ny - pk.y;
      if (dx * dx + dy * dy > T.pickupRadius * T.pickupRadius) return true;
      p.stacks[pk.kind] = Math.min(T.maxStacks, p.stacks[pk.kind] + 1);
      emit(state, { type: "pickup", player: p.id, kind: pk.kind, x: pk.x, y: pk.y });
      return false;
    });
  }

  if (state.pickupTimer > 0) state.pickupTimer -= 1;
  if (state.pickupTimer === 0 && state.pickups.length < T.maxPickups) {
    const free = PICKUP_SPOTS.filter((s) => !state.pickups.some((pk) => pk.x === s.x && pk.y === s.y));
    const spot = free[Math.floor(rand(state) * free.length)];
    const kind = PICKUP_KINDS[Math.floor(rand(state) * PICKUP_KINDS.length)];
    state.pickups.push({ id: state.nextId++, kind, x: spot.x, y: spot.y });
    state.pickupTimer = T.pickupInterval;
    emit(state, { type: "pickupSpawn", kind, x: spot.x, y: spot.y });
  }
}

function checkRoundEnd(state) {
  if (state.over) return;
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.over = true;
    state.winner = alive.length === 1 ? alive[0].id : -1;
  } else if (state.tick >= T.maxTicks) {
    const [a, b] = state.players;
    state.over = true;
    state.winner = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1;
  }
  if (state.over) emit(state, { type: "roundOver", winner: state.winner });
}
