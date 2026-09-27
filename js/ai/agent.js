// Event-driven controller for the learned policy: decides only when something
// happens (or after MAX_GAP ticks), then holds its input until the next
// decision. Used identically in the browser and in training.

import { buildObs, decodeAction, OBS_SIZE } from "./obs.js";
import { act } from "./policy.js";

export const MIN_GAP = 3; // never re-decide faster than this (ticks)
export const MAX_GAP = 10; // always re-decide at least this often (~6/s)

const TRIGGERS = new Set(["fire", "explode", "hit", "land", "hang", "pickupSpawn", "pickup", "reflect", "dash", "shield", "walljump"]);

export function createAgent(id, policy, rng, opts = {}) {
  return {
    id,
    policy,
    rng,
    opts, // { greedy, temperature }
    sinceDecision: MAX_GAP, // decide on the first tick
    wasReady: false,
    wasSpecialReady: false,
    input: null,
    pendingJump: false,
    obs: new Float32Array(OBS_SIZE),
    last: null, // { obs, action, logp, value } of the latest decision (training reads this)
  };
}

export function needsDecision(agent, state, lastEvents) {
  const me = state.players[agent.id];
  const ready = me.cooldown === 0;
  const specialReady = me.specialCooldown === 0;
  const becameReady = (ready && !agent.wasReady) || (specialReady && !agent.wasSpecialReady);
  agent.wasReady = ready;
  agent.wasSpecialReady = specialReady;
  if (agent.sinceDecision >= MAX_GAP) return true;
  if (agent.sinceDecision < MIN_GAP) return false;
  return becameReady || lastEvents.some((e) => TRIGGERS.has(e.type));
}

// Returns this tick's sim input. `decided` tells the trainer a new decision was made.
export function agentStep(agent, state, lastEvents) {
  agent.sinceDecision += 1;
  let decided = false;
  if (needsDecision(agent, state, lastEvents)) {
    buildObs(state, agent.id, agent.obs);
    const r = act(agent.policy, agent.obs, agent.rng, agent.opts);
    const prevJump = agent.input?.jump ?? false;
    agent.input = decodeAction(r.action, agent.id);
    // a jump only registers on a fresh press: if jump was already held, release for one tick
    agent.pendingJump = agent.input.jump && prevJump;
    agent.last = { obs: Float32Array.from(agent.obs), action: r.action, logp: r.logp, value: r.value };
    agent.sinceDecision = 0;
    decided = true;
  }
  let input = agent.input;
  if (agent.pendingJump) {
    input = { ...input, jump: false };
    agent.pendingJump = false;
  }
  // special is a one-shot press: only on the decision tick
  if (!decided && input.special) input = { ...input, special: false };
  return { input, decided };
}
