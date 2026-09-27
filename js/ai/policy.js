// Tiny MLP forward pass in plain JS (no deps) — mirrors the PyTorch model in
// train/ppo.py exactly: trunk of Linear+ReLU layers, then a policy head
// (factored categorical logits) and a value head.
//
// Weights JSON: { trunk: [{in, out, w: [out*in row-major], b: [out]}...],
//                 pi: {in, out, w, b}, v: {in, out, w, b}, meta: {...} }

import { HEADS, N_LOGITS } from "./obs.js";

export function loadPolicy(json) {
  const layer = (l) => ({ in: l.in, out: l.out, w: Float32Array.from(l.w), b: Float32Array.from(l.b) });
  const trunk = json.trunk.map(layer);
  const pi = layer(json.pi);
  const v = layer(json.v);
  if (pi.out !== N_LOGITS) throw new Error(`policy has ${pi.out} logits, expected ${N_LOGITS}`);
  const bufs = trunk.map((l) => new Float32Array(l.out));
  return { trunk, pi, v, bufs, logits: new Float32Array(N_LOGITS), meta: json.meta ?? {} };
}

function linear(l, x, out, relu) {
  const { w, b } = l;
  const n = l.in;
  for (let o = 0; o < l.out; o++) {
    let s = b[o];
    const row = o * n;
    for (let i = 0; i < n; i++) s += w[row + i] * x[i];
    out[o] = relu && s < 0 ? 0 : s;
  }
  return out;
}

// Returns { logits (shared buffer!), value }.
export function forward(policy, obs) {
  let x = obs;
  for (let i = 0; i < policy.trunk.length; i++) x = linear(policy.trunk[i], x, policy.bufs[i], true);
  linear(policy.pi, x, policy.logits, false);
  const value = linear(policy.v, x, new Float32Array(1), false)[0];
  return { logits: policy.logits, value };
}

// Sample (or take the argmax of) each head. Returns { action: Int32Array(5), logp }.
export function act(policy, obs, rng, { greedy = false, temperature = 1 } = {}) {
  const { logits, value } = forward(policy, obs);
  const action = new Int32Array(HEADS.length);
  let logp = 0;
  let off = 0;
  for (let h = 0; h < HEADS.length; h++) {
    const n = HEADS[h];
    let max = -Infinity;
    for (let i = 0; i < n; i++) max = Math.max(max, logits[off + i]);
    let z = 0;
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      p[i] = Math.exp((logits[off + i] - max) / temperature);
      z += p[i];
    }
    let choice = 0;
    if (greedy) {
      for (let i = 1; i < n; i++) if (p[i] > p[choice]) choice = i;
    } else {
      let r = rng() * z;
      choice = n - 1;
      for (let i = 0; i < n; i++) {
        r -= p[i];
        if (r <= 0) {
          choice = i;
          break;
        }
      }
    }
    // log-prob under the untempered distribution (what PPO trains on)
    let z1 = 0;
    for (let i = 0; i < n; i++) z1 += Math.exp(logits[off + i] - max);
    logp += logits[off + choice] - max - Math.log(z1);
    action[h] = choice;
    off += n;
  }
  return { action, logp, value };
}
