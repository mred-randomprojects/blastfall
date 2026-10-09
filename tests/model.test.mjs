// The shipped AI (models/v2/latest.json, what the browser plays) is trained against
// sim.js + obs.js as they were. An edit to the arena, the tuning or the observation
// can quietly turn it into a broken opponent; these tests catch that.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRound, step, makeRng, CHARACTER_IDS, MAP, SPAWNS, PICKUP_SPOTS, WIDTH, T } from "../js/sim.js";
import { createBot, botInput } from "../js/bot.js";
import { loadPolicy } from "../js/ai/policy.js";
import { createAgent, agentStep } from "../js/ai/agent.js";
import { OBS_SIZE, N_LOGITS } from "../js/ai/obs.js";

const SHIPPED = new URL("../models/v2/latest.json", import.meta.url);
const shippedJson = () => JSON.parse(readFileSync(SHIPPED, "utf8"));

test("the shipped model's shape matches obs.js", () => {
  const json = shippedJson();
  assert.equal(json.trunk[0].in, OBS_SIZE);
  assert.equal(json.pi.out, N_LOGITS);
});

test("loadPolicy refuses a model built for another observation size", () => {
  const json = shippedJson();
  json.trunk[0].in = OBS_SIZE - 1;
  assert.throws(() => loadPolicy(json), /inputs/);
});

// obs.js mirrors player 1's view so one policy plays both sides: that only holds
// while the arena is left-right symmetric.
test("the arena is mirror-symmetric", () => {
  for (const row of MAP) assert.equal(row, [...row].reverse().join(""), `MAP row not a palindrome: ${row}`);
  // spawns are top-left corners of the player box
  assert.equal(SPAWNS[1].x, WIDTH - SPAWNS[0].x - T.playerW);
  assert.equal(SPAWNS[1].y, SPAWNS[0].y);
  // pickup spots are centres
  const key = (s) => `${s.x},${s.y}`;
  const spots = new Set(PICKUP_SPOTS.map(key));
  for (const s of PICKUP_SPOTS) assert.ok(spots.has(key({ x: WIDTH - s.x, y: s.y })), `no mirror for pickup spot ${key(s)}`);
});

// The train/eval.mjs loop: fixed seeds, sides alternated, characters seeded.
// Deterministic, so it cannot flake; v2/latest scores ~0.90 here today.
test("the shipped model still beats the hard bot (200 seeded games)", () => {
  const model = loadPolicy(shippedJson());
  const games = 200;
  let w = 0;
  let d = 0;
  for (let g = 0; g < games; g++) {
    const rng = makeRng(g * 7 + 3);
    const side = g % 2;
    const chars = [CHARACTER_IDS[Math.floor(rng() * 3)], CHARACTER_IDS[Math.floor(rng() * 3)]];
    const state = createRound(100000 + g, chars);
    const ctl = [0, 1].map((id) =>
      id === side ? { agent: createAgent(id, model, makeRng(g * 11 + 1)) } : { bot: createBot(id, makeRng(g * 17 + 5), "hard") },
    );
    let ev = [];
    while (!state.over) {
      const inputs = ctl.map((c, id) => (c.bot ? botInput(c.bot, state, ev) : agentStep(c.agent, state, ev).input));
      ev = step(state, inputs);
    }
    if (state.winner === side) w++;
    else if (state.winner === -1) d++;
  }
  const score = (w + 0.5 * d) / games;
  assert.ok(score >= 0.75, `v2/latest vs hard: ${(score * 100).toFixed(1)}% (${w}W ${d}D of ${games}), expected >= 75%`);
});
