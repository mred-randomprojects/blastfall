import test from "node:test";
import assert from "node:assert/strict";
import { createRound, step, makeRng, T } from "../js/sim.js";
import { createBot, botInput } from "../js/bot.js";

// Bot-vs-bot round, fully seeded. Returns the final state + a trace hash.
function playRound(seed) {
  const state = createRound(seed);
  const bots = [createBot(0, makeRng(seed * 3 + 1)), createBot(1, makeRng(seed * 3 + 2))];
  let events = [];
  let trace = 0;
  let explosions = 0;
  while (!state.over) {
    const inputs = bots.map((b) => botInput(b, state, events));
    events = step(state, inputs);
    explosions += events.filter((e) => e.type === "explode").length;
    for (const p of state.players) trace = (trace * 31 + Math.round(p.x * 1000) + Math.round(p.y * 1000) + Math.round(p.hp * 1000)) % 1e9;
  }
  return { state, trace, explosions };
}

test("same seed => identical round (determinism)", () => {
  for (const seed of [1, 42, 999]) {
    const a = playRound(seed);
    const b = playRound(seed);
    assert.equal(a.trace, b.trace);
    assert.equal(a.state.tick, b.state.tick);
    assert.equal(a.state.winner, b.state.winner);
  }
});

test("rounds always end, players stay inside the arena", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state } = playRound(seed);
    assert.ok(state.over);
    assert.ok(state.tick <= T.maxTicks);
    for (const p of state.players) {
      assert.ok(p.x >= 16 && p.x <= 480 - 16 - T.playerW, `x out of bounds: ${p.x}`);
      assert.ok(p.y >= 16 && p.y <= 272 - 16 - T.playerH, `y out of bounds: ${p.y}`);
    }
  }
});

test("bot-vs-bot stats + sim speed (informational)", () => {
  const wins = [0, 0, 0];
  let ticks = 0;
  let explosions = 0;
  const N = 200;
  const t0 = performance.now();
  for (let seed = 1; seed <= N; seed++) {
    const r = playRound(seed);
    wins[r.state.winner === -1 ? 2 : r.state.winner] += 1;
    ticks += r.state.tick;
    explosions += r.explosions;
  }
  const ms = performance.now() - t0;
  console.log(`  P0 wins ${wins[0]}, P1 wins ${wins[1]}, draws ${wins[2]} over ${N} rounds`);
  console.log(`  avg round ${(ticks / N / 60).toFixed(1)}s game time, ${(explosions / N).toFixed(1)} explosions/round`);
  console.log(`  ${Math.round(ticks / (ms / 1000)).toLocaleString()} ticks/s (single thread, incl. bot) = ${Math.round(ticks / 60 / (ms / 1000))}x real time`);
  assert.ok(wins[0] + wins[1] > N * 0.5, "most rounds should have a winner");
});
