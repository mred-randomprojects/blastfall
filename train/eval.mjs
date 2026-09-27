// Evaluate a trained model against the scripted bots (or another model).
//   node train/eval.mjs models/v1/latest.json [games=400] [opponent=hard|normal|easy|path.json]
// Sides and characters are alternated/randomised; prints win rate with a 95% interval.

import { readFileSync } from "node:fs";
import { createRound, step, makeRng, CHARACTER_IDS } from "../js/sim.js";
import { createBot, botInput } from "../js/bot.js";
import { loadPolicy } from "../js/ai/policy.js";
import { createAgent, agentStep } from "../js/ai/agent.js";

const [modelPath, gamesArg = "400", oppArg = "hard"] = process.argv.slice(2);
const games = Number(gamesArg);
const load = (p) => loadPolicy(JSON.parse(readFileSync(p, "utf8")));
const model = load(modelPath);
const oppModel = oppArg.endsWith(".json") ? load(oppArg) : null;

let w = 0, l = 0, d = 0, ticks = 0;
const byChar = Object.fromEntries(CHARACTER_IDS.map((c) => [c, { w: 0, n: 0 }]));
for (let g = 0; g < games; g++) {
  const rng = makeRng(g * 7 + 3);
  const side = g % 2;
  const chars = [CHARACTER_IDS[Math.floor(rng() * 3)], CHARACTER_IDS[Math.floor(rng() * 3)]];
  const state = createRound(100000 + g, chars);
  const ctl = [0, 1].map((id) =>
    id === side
      ? { agent: createAgent(id, model, makeRng(g * 11 + 1)) }
      : oppModel
        ? { agent: createAgent(id, oppModel, makeRng(g * 13 + 2)) }
        : { bot: createBot(id, makeRng(g * 17 + 5), oppArg) },
  );
  let ev = [];
  while (!state.over) {
    const inputs = ctl.map((c, id) => (c.bot ? botInput(c.bot, state, ev) : agentStep(c.agent, state, ev).input));
    ev = step(state, inputs);
  }
  ticks += state.tick;
  const bc = byChar[chars[side]];
  bc.n++;
  if (state.winner === side) { w++; bc.w++; } else if (state.winner === -1) d++; else l++;
}
const p = (w + 0.5 * d) / games;
const ci = 1.96 * Math.sqrt((p * (1 - p)) / games);
console.log(`${modelPath} vs ${oppArg}: ${w}W ${l}L ${d}D over ${games} → ${(p * 100).toFixed(1)}% ± ${(ci * 100).toFixed(1)}  (avg round ${(ticks / games / 60).toFixed(1)}s)`);
console.log("  by character:", Object.entries(byChar).map(([c, v]) => `${c} ${v.n ? ((100 * v.w) / v.n).toFixed(0) : "-"}%`).join(", "));
