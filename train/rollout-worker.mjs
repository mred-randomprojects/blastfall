// One rollout worker (a worker_thread): plays full rounds with the current
// policy and records every decision the learner makes, then writes them to a
// flat Float32 binary file for train/ppo.py.
//
// Row layout (ROW floats): obs[OBS_SIZE], action[5], logp, value, reward, dt, done, trajId

import { parentPort } from "node:worker_threads";
import { readFileSync, writeFileSync } from "node:fs";
import { createRound, step, makeRng, T, TILE, MAP, NO_INPUT, CHARACTER_IDS } from "../js/sim.js";
import { createBot, botInput } from "../js/bot.js";
import { OBS_SIZE, HEADS } from "../js/ai/obs.js";
import { loadPolicy } from "../js/ai/policy.js";
import { createAgent, agentStep } from "../js/ai/agent.js";

export const ROW = OBS_SIZE + HEADS.length + 6;

const policyCache = new Map();
function getPolicy(path) {
  if (!policyCache.has(path)) {
    if (policyCache.size > 64) policyCache.clear();
    policyCache.set(path, loadPolicy(JSON.parse(readFileSync(path, "utf8"))));
  }
  return policyCache.get(path);
}

// Every tile you can stand on (empty, solid below): used for random spawns / dummy placement.
const STAND_SPOTS = [];
for (let r = 1; r < MAP.length - 1; r++) {
  for (let c = 1; c < MAP[0].length - 1; c++) {
    if (MAP[r][c] === "." && MAP[r + 1][c] === "#") STAND_SPOTS.push({ x: c * TILE + 3, y: (r + 1) * TILE - T.playerH });
  }
}

function randomSpawns(state, rng) {
  const [a, b] = state.players;
  let s1;
  let s2;
  do {
    s1 = STAND_SPOTS[Math.floor(rng() * STAND_SPOTS.length)];
    s2 = STAND_SPOTS[Math.floor(rng() * STAND_SPOTS.length)];
  } while (Math.hypot(s1.x - s2.x, s1.y - s2.y) < 120);
  Object.assign(a, { x: s1.x, y: s1.y });
  Object.assign(b, { x: s2.x, y: s2.y });
}

// Non-learning opponents that exist only to widen what the AI has seen:
// "idle" never touches the controls; "wander" holds random moves/jumps, never fires.
function dummyInput(d, rng) {
  if (d.style === "idle") return NO_INPUT;
  if (--d.timer <= 0) {
    d.timer = 20 + Math.floor(rng() * 70);
    const h = Math.floor(rng() * 3);
    d.input = { ...NO_INPUT, left: h === 0, right: h === 2, jump: rng() < 0.35, down: rng() < 0.1 };
  } else if (d.timer === 1) d.input = { ...d.input, jump: false };
  return d.input;
}

function terminalReward(state, side, cfg) {
  if (state.winner === side) return 1 + cfg.timeBonus * (1 - state.tick / T.maxTicks);
  if (state.winner === -1) return cfg.drawReward;
  return -1;
}

// Play one round. Returns per-learner-side trajectories + stats.
function playEpisode(job, rng, episodeSeed) {
  const cfg = job.reward;
  const learner = getPolicy(job.weights);
  const r = rng();
  const mix = { self: 0.5, pool: 0.3, dummy: 0, randomSpawn: 0, ...job.mix };
  const kind =
    r < mix.self ? "self"
      : r < mix.self + mix.pool && job.opponents.length ? "pool"
        : r < mix.self + mix.pool + mix.dummy ? "dummy"
          : "bot";
  const learnerSide = rng() < 0.5 ? 0 : 1;
  const chars = [CHARACTER_IDS[Math.floor(rng() * 3)], CHARACTER_IDS[Math.floor(rng() * 3)]];
  const state = createRound(episodeSeed, chars);
  const dummyStyle = rng() < 0.5 ? "idle" : "wander";
  if (kind === "dummy" || rng() < mix.randomSpawn) randomSpawns(state, rng);
  const botLevel = rng() < 0.5 ? "normal" : "hard";

  const sides = [0, 1].map((id) => {
    const isLearner = kind === "self" || id === learnerSide;
    if (isLearner) return { id, learner: true, agent: createAgent(id, learner, rng), traj: [], acc: 0, open: null };
    if (kind === "pool") {
      const opp = job.opponents[Math.floor(rng() * job.opponents.length)];
      return { id, learner: false, agent: createAgent(id, getPolicy(opp), rng) };
    }
    if (kind === "dummy") return { id, learner: false, dummy: { style: dummyStyle, timer: 0, input: NO_INPUT } };
    return { id, learner: false, bot: createBot(id, rng, botLevel) };
  });

  let events = [];
  const stats = { shots: 0, specials: 0 };
  while (!state.over) {
    const inputs = [null, null];
    for (const s of sides) {
      if (s.bot) {
        inputs[s.id] = botInput(s.bot, state, events);
        continue;
      }
      if (s.dummy) {
        inputs[s.id] = dummyInput(s.dummy, rng);
        continue;
      }
      const { input, decided } = agentStep(s.agent, state, events);
      inputs[s.id] = input;
      if (s.learner && decided) {
        if (s.open) {
          s.open.reward = s.acc;
          s.open.dt = s.open.ticks;
          s.traj.push(s.open);
        }
        const L = s.agent.last;
        s.open = { obs: L.obs, action: L.action, logp: L.logp, value: L.value, ticks: 0, done: 0 };
        s.acc = 0;
      }
    }
    events = step(state, inputs);
    for (const s of sides) {
      if (!s.learner) continue;
      if (s.open) s.open.ticks += 1;
      for (const e of events) {
        if (e.type === "hit") {
          if (e.player === s.id) s.acc -= (cfg.damageShaping * e.damage) / T.maxHp;
          else if (e.by === s.id) s.acc += (cfg.damageShaping * e.damage) / T.maxHp;
        } else if (e.type === "fire" && e.player === s.id) stats.shots++;
        else if ((e.type === "dash" || e.type === "shield" || (e.type === "fire" && e.heavy)) && e.player === s.id) stats.specials++;
      }
    }
  }
  for (const s of sides) {
    if (!s.learner || !s.open) continue;
    s.open.reward = s.acc + terminalReward(state, s.id, cfg);
    s.open.dt = s.open.ticks;
    s.open.done = 1;
    s.traj.push(s.open);
  }
  return { kind, botLevel, dummyStyle, learnerSide, state, sides, stats };
}

parentPort.on("message", (job) => {
  const rng = makeRng(job.seed);
  const rows = [];
  let trajId = 0;
  const st = {
    episodes: 0, decisions: 0, ticks: 0, shots: 0, specials: 0,
    self: { n: 0, ticks: 0, draws: 0 },
    pool: { w: 0, l: 0, d: 0 },
    dummy: { idle: { n: 0, w: 0, ticks: 0 }, wander: { n: 0, w: 0, ticks: 0 } },
    bot: { normal: { w: 0, l: 0, d: 0 }, hard: { w: 0, l: 0, d: 0 } },
  };
  let episodeSeed = job.seed * 1000;
  while (st.decisions < job.decisions) {
    const ep = playEpisode(job, rng, episodeSeed++);
    st.episodes++;
    st.ticks += ep.state.tick;
    st.shots += ep.stats.shots;
    st.specials += ep.stats.specials;
    const res = ep.state.winner === -1 ? "d" : ep.state.winner === ep.learnerSide ? "w" : "l";
    if (ep.kind === "self") {
      st.self.n++;
      st.self.ticks += ep.state.tick;
      if (ep.state.winner === -1) st.self.draws++;
    } else if (ep.kind === "pool") st.pool[res]++;
    else if (ep.kind === "dummy") {
      const dd = st.dummy[ep.dummyStyle];
      dd.n++;
      dd.ticks += ep.state.tick;
      if (res === "w") dd.w++;
    }
    else st.bot[ep.botLevel][res]++;
    for (const s of ep.sides) {
      if (!s.learner) continue;
      for (const t of s.traj) {
        rows.push(t, trajId);
        st.decisions++;
      }
      trajId++;
    }
  }
  const n = rows.length / 2;
  const buf = new Float32Array(n * ROW);
  for (let i = 0; i < n; i++) {
    const t = rows[2 * i];
    const o = i * ROW;
    buf.set(t.obs, o);
    for (let h = 0; h < HEADS.length; h++) buf[o + OBS_SIZE + h] = t.action[h];
    let k = o + OBS_SIZE + HEADS.length;
    buf[k++] = t.logp;
    buf[k++] = t.value;
    buf[k++] = t.reward;
    buf[k++] = t.dt;
    buf[k++] = t.done;
    buf[k++] = rows[2 * i + 1];
  }
  writeFileSync(job.out, Buffer.from(buf.buffer));
  parentPort.postMessage({ out: job.out, rows: n, stats: st });
});

