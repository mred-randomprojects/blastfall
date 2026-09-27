import test from "node:test";
import assert from "node:assert/strict";
import { createRound, step, NO_INPUT, T, TILE, CHARACTERS } from "../js/sim.js";

const I = (o) => ({ ...NO_INPUT, ...o });
function run(state, input0, ticks) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...step(state, [input0, NO_INPUT]));
  return events;
}
function settle(state) {
  run(state, NO_INPUT, 30);
  assert.ok(state.players[0].grounded);
}

test("missiles fly straight while the motor burns, then fall with gravity", () => {
  const s = createRound(1);
  const p = s.players[0];
  p.x = 3 * TILE;
  p.y = 7 * TILE; // mid-air, lots of open space ahead
  p.cooldown = 0;
  step(s, [I({ fire: true, right: true }), NO_INPUT]);
  const m = s.missiles[0];
  const y0 = m.y;
  run(s, NO_INPUT, T.missileThrustTicks - 1);
  assert.equal(m.y, y0, "straight during thrust");
  run(s, NO_INPUT, 20);
  assert.ok(s.missiles.includes(m), "still flying");
  assert.ok(m.vy > 1, `vy ${m.vy}`);
  assert.ok(m.y > y0 + 8, `should have dropped: ${y0} -> ${m.y}`);
});

test("double jump: one extra jump in the air, restored on landing", () => {
  const s = createRound(1);
  settle(s);
  const p = s.players[0];
  run(s, I({ jump: true }), 10);
  run(s, NO_INPUT, 1);
  const ev = run(s, I({ jump: true }), 1);
  assert.ok(ev.some((e) => e.type === "doublejump"));
  assert.ok(p.vy < 0);
  run(s, NO_INPUT, 1);
  const ev2 = run(s, I({ jump: true }), 1);
  assert.ok(!ev2.some((e) => e.type === "doublejump"), "no triple jump");
  run(s, NO_INPUT, 120);
  assert.ok(p.grounded);
  assert.equal(p.airJumps, T.airJumps);
});

test("ledge hang: falling next to a platform edge while holding toward it grabs on", () => {
  const s = createRound(1);
  const p = s.players[0];
  // platform in row 11 spans cols 7-12; hang off its left end, falling from above-left
  p.x = 7 * TILE - T.playerW - 0.5;
  p.y = 11 * TILE - 12;
  p.vy = 2;
  const ev = run(s, I({ right: true }), 12);
  assert.ok(ev.some((e) => e.type === "hang"), "should grab the ledge");
  assert.equal(p.hanging, 1);
  const y = p.y;
  run(s, I({ right: true }), 30);
  assert.equal(p.y, y, "hanging players don't fall");
  run(s, I({ down: true }), 1);
  assert.equal(p.hanging, 0, "Down lets go");
});

test("wall slide is slow", () => {
  const s = createRound(1);
  const p = s.players[0];
  p.x = TILE; // touching the left arena wall
  p.y = 4 * TILE;
  run(s, I({ left: true }), 40);
  assert.ok(p.vy <= T.wallSlideMax + 1e-9, `vy ${p.vy}`);
});

test("dash: invulnerable to blasts, then 3s cooldown", () => {
  const s = createRound(1);
  settle(s);
  const p = s.players[0];
  const ev = run(s, I({ special: true, right: true }), 1);
  assert.ok(ev.some((e) => e.type === "dash"));
  assert.ok(p.invuln > 0);
  // drop an enemy missile right on top of the dashing player
  s.missiles.push({ id: 99, owner: 1, x: p.x + 5, y: p.y - 3, vx: 0, vy: 0.1, radius: 30, damage: 50, age: 50 });
  s.missiles.push({ id: 98, owner: 1, x: p.x + 5, y: p.y + T.playerH + 1, vx: 0, vy: 0, radius: 30, damage: 50, age: 50 });
  const ev2 = run(s, NO_INPUT, 1);
  assert.ok(ev2.some((e) => e.type === "dodge"));
  assert.equal(p.hp, T.maxHp);
  run(s, NO_INPUT, 20);
  const ev3 = run(s, I({ special: true }), 1);
  assert.ok(!ev3.some((e) => e.type === "dash"), "still on cooldown");
  run(s, NO_INPUT, CHARACTERS.volt.cooldown);
  const ev4 = run(s, I({ special: true }), 1);
  assert.ok(ev4.some((e) => e.type === "dash"), "cooldown over");
});

test("Aegis shield reflects an enemy missile back and blocks the blast", () => {
  const s = createRound(1, ["aegis", "volt"]);
  settle(s);
  const p = s.players[0];
  run(s, I({ special: true }), 1);
  assert.ok(p.shieldTicks > 0);
  const cx = p.x + T.playerW / 2;
  const cy = p.y + T.playerH / 2;
  const m = { id: 99, owner: 1, x: cx + 30, y: cy, vx: -6, vy: 0, radius: 26, damage: 30, age: 40 };
  s.missiles.push(m);
  const ev = run(s, NO_INPUT, 4);
  assert.ok(ev.some((e) => e.type === "reflect"), "should reflect");
  assert.equal(m.owner, 0, "missile now belongs to the shield owner");
  assert.ok(m.vx > 0, "flies back the way it came");
  assert.equal(p.hp, T.maxHp);
});

test("Ember super-cannon: double blast radius, recoil, 5s cooldown", () => {
  const s = createRound(1, ["ember", "volt"]);
  settle(s);
  const p = s.players[0];
  const ev = run(s, I({ special: true, right: true }), 1);
  const shot = ev.find((e) => e.type === "fire");
  assert.ok(shot && shot.heavy);
  const m = s.missiles.find((mm) => mm.heavy);
  assert.equal(m.radius, T.blastRadius * T.cannonRadiusMult);
  assert.equal(p.specialCooldown, CHARACTERS.ember.cooldown - 0);
  const ev2 = run(s, I({ special: true }), 1);
  assert.ok(!ev2.some((e) => e.type === "fire" && e.heavy), "on cooldown");
});
