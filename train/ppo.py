"""Self-play PPO trainer for Blastfall.

The game itself only exists in JavaScript (js/sim.js). This script spawns
train/rollout-server.mjs (Node worker threads playing full rounds with the
current policy), reads back the recorded decisions, and does the PPO update in
PyTorch. Weights are exported as JSON the JS side (and the browser) can run.

    python3 train/ppo.py --run first --iters 300

Outputs:
    models/<run>/gen_XXXX.json   snapshots ("generations")
    models/<run>/latest.json     most recent weights (the browser plays this)
    models/<run>/log.jsonl       one line of stats per iteration
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import numpy as np
import torch
import torch.nn as nn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Net(nn.Module):
    """Must stay identical to js/ai/policy.js: Linear+ReLU trunk, policy + value heads."""

    def __init__(self, obs_size, heads, hidden=(128, 128)):
        super().__init__()
        self.heads = list(heads)
        layers, last = [], obs_size
        for h in hidden:
            layers.append(nn.Linear(last, h))
            last = h
        self.trunk = nn.ModuleList(layers)
        self.pi = nn.Linear(last, sum(heads))
        self.v = nn.Linear(last, 1)
        nn.init.orthogonal_(self.pi.weight, 0.01)
        nn.init.zeros_(self.pi.bias)
        nn.init.orthogonal_(self.v.weight, 1.0)
        nn.init.zeros_(self.v.bias)

    def forward(self, x):
        for layer in self.trunk:
            x = torch.relu(layer(x))
        return self.pi(x), self.v(x).squeeze(-1)

    def dist_stats(self, logits, actions):
        """Sum of per-head log-probs and entropies for a factored categorical."""
        logp = torch.zeros(logits.shape[0])
        ent = torch.zeros(logits.shape[0])
        off = 0
        for h, n in enumerate(self.heads):
            lg = torch.log_softmax(logits[:, off : off + n], dim=-1)
            logp = logp + lg.gather(1, actions[:, h : h + 1]).squeeze(1)
            ent = ent - (lg.exp() * lg).sum(-1)
            off += n
        return logp, ent

    def export(self, path, meta):
        def lin(layer):
            return {
                "in": layer.in_features,
                "out": layer.out_features,
                "w": [round(float(x), 6) for x in layer.weight.detach().flatten()],
                "b": [round(float(x), 6) for x in layer.bias.detach().flatten()],
            }

        data = {"trunk": [lin(l) for l in self.trunk], "pi": lin(self.pi), "v": lin(self.v), "meta": meta}
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)


def gae(rew, val, dt, done, traj, gamma_tick, lam):
    """GAE over variable-length decision windows: discount = gamma_tick ** ticks elapsed."""
    n = len(rew)
    adv = np.zeros(n, dtype=np.float32)
    last = 0.0
    for i in range(n - 1, -1, -1):
        terminal = done[i] > 0.5 or i == n - 1 or traj[i + 1] != traj[i]
        next_v = 0.0 if terminal else val[i + 1]
        g = gamma_tick ** dt[i]
        delta = rew[i] + g * next_v - val[i]
        last = delta + (0.0 if terminal else g * lam * last)
        adv[i] = last
    return adv


class Rollouts:
    def __init__(self, workers):
        self.proc = subprocess.Popen(
            ["node", os.path.join(ROOT, "train", "rollout-server.mjs"), str(workers)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            cwd=ROOT,
        )
        hello = json.loads(self.proc.stdout.readline())
        self.obs_size = hello["obsSize"]
        self.heads = hello["heads"]

    def collect(self, req):
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("rollout server died")
        res = json.loads(line)
        if "error" in res:
            raise RuntimeError(res["error"])
        return res

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


def winrate(d):
    n = d.get("w", 0) + d.get("l", 0) + d.get("d", 0)
    return (d.get("w", 0) + 0.5 * d.get("d", 0)) / n if n else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="run1")
    ap.add_argument("--iters", type=int, default=200)
    ap.add_argument("--decisions", type=int, default=100_000, help="learner decisions collected per iteration")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--hidden", type=int, nargs="+", default=[128, 128])
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--minibatch", type=int, default=4096)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--ent", type=float, default=0.01)
    ap.add_argument("--gamma-tick", type=float, default=0.999)
    ap.add_argument("--lam", type=float, default=0.95)
    ap.add_argument("--save-every", type=int, default=5)
    ap.add_argument("--time-bonus", type=float, default=0.5, help="extra reward for winning fast (scaled by time left)")
    ap.add_argument("--damage-shaping", type=float, default=0.3)
    ap.add_argument("--draw-reward", type=float, default=-0.5)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--init", help="start from another run's checkpoint.pt (fine-tuning)")
    ap.add_argument("--seed-pool", help="also use this run dir's generations as opponents")
    ap.add_argument("--mix-self", type=float, default=0.5)
    ap.add_argument("--mix-pool", type=float, default=0.3)
    ap.add_argument("--mix-dummy", type=float, default=0.0, help="share of games vs idle/wandering dummies")
    ap.add_argument("--random-spawn", type=float, default=0.0, help="share of games starting at random spots")
    args = ap.parse_args()

    torch.set_num_threads(8)
    out_dir = os.path.join(ROOT, "models", args.run)
    os.makedirs(out_dir, exist_ok=True)
    tmp_dir = tempfile.mkdtemp(prefix="blastfall-")

    rollouts = Rollouts(args.workers)
    net = Net(rollouts.obs_size, rollouts.heads, args.hidden)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr, eps=1e-5)
    start_iter, total_decisions = 0, 0
    ckpt_path = os.path.join(out_dir, "checkpoint.pt")
    if args.resume and os.path.exists(ckpt_path):
        ck = torch.load(ckpt_path)
        net.load_state_dict(ck["net"])
        opt.load_state_dict(ck["opt"])
        start_iter, total_decisions = ck["iter"], ck["decisions"]
        print(f"resumed at iter {start_iter}")
    elif args.init:
        ck = torch.load(args.init)
        net.load_state_dict(ck["net"])
        opt.load_state_dict(ck["opt"])
        start_iter, total_decisions = ck["iter"], ck["decisions"]
        print(f"initialised from {args.init} (iter {start_iter})")

    def gens(d):
        return sorted(os.path.join(d, f) for f in os.listdir(d) if f.startswith("gen_") and f.endswith(".json"))

    pool = (gens(args.seed_pool) if args.seed_pool else []) + gens(out_dir)
    row = rollouts.obs_size + len(rollouts.heads) + 6
    log = open(os.path.join(out_dir, "log.jsonl"), "a")

    try:
        for it in range(start_iter + 1, start_iter + args.iters + 1):
            t0 = time.time()
            weights = os.path.join(tmp_dir, f"cur_{it}.json")
            net.export(weights, {"iter": it})
            # opponents: recent snapshots mostly, plus a few old ones (don't forget how to beat them)
            opponents = pool[-10:] + pool[:-10][:: max(1, len(pool[:-10]) // 5 or 1)] if pool else []
            res = rollouts.collect(
                {
                    "weights": weights,
                    "opponents": opponents,
                    "decisions": args.decisions,
                    "seed": it,
                    "outDir": tmp_dir,
                    "mix": {
                        "self": args.mix_self,
                        "pool": args.mix_pool if pool else 0.0,
                        "dummy": args.mix_dummy,
                        "randomSpawn": args.random_spawn,
                    },
                    "reward": {
                        "timeBonus": args.time_bonus,
                        "damageShaping": args.damage_shaping,
                        "drawReward": args.draw_reward,
                    },
                }
            )
            t_roll = time.time() - t0
            os.remove(weights)

            data = np.concatenate([np.fromfile(f, dtype=np.float32).reshape(-1, row) for f in res["files"]])
            o = rollouts.obs_size
            nh = len(rollouts.heads)
            obs = torch.from_numpy(data[:, :o].copy())
            act = torch.from_numpy(data[:, o : o + nh].astype(np.int64))
            old_logp = torch.from_numpy(data[:, o + nh].copy())
            val = data[:, o + nh + 1]
            rew, dt, done, traj = (data[:, o + nh + k] for k in (2, 3, 4, 5))
            # trajIds restart per worker file: make them globally unique by file offset
            sizes = [os.path.getsize(f) // (4 * row) for f in res["files"]]
            traj = traj + np.repeat(np.arange(len(sizes)) * 1e6, sizes)
            adv = gae(rew, val, dt, done, traj, args.gamma_tick, args.lam)
            ret = torch.from_numpy(adv + val)
            # normalise over the whole batch (per-minibatch std is NaN for a 1-row leftover minibatch)
            adv_t = torch.from_numpy((adv - adv.mean()) / (adv.std() + 1e-8))
            skipped = 0

            n = len(data)
            total_decisions += n
            clipfracs, pls, vls, ents, kls = [], [], [], [], []
            for _ in range(args.epochs):
                perm = torch.randperm(n)
                for s in range(0, n, args.minibatch):
                    idx = perm[s : s + args.minibatch]
                    if len(idx) < args.minibatch // 4:
                        continue  # tiny leftover: noisy, skip
                    logits, v = net(obs[idx])
                    logp, ent = net.dist_stats(logits, act[idx])
                    ratio = torch.exp(logp - old_logp[idx])
                    a = adv_t[idx]
                    pl = -torch.min(ratio * a, torch.clamp(ratio, 1 - args.clip, 1 + args.clip) * a).mean()
                    vl = 0.5 * ((v - ret[idx]) ** 2).mean()
                    el = ent.mean()
                    loss = pl + 0.5 * vl - args.ent * el
                    if not torch.isfinite(loss):
                        skipped += 1
                        continue
                    opt.zero_grad()
                    loss.backward()
                    nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                    opt.step()
                    with torch.no_grad():
                        kls.append(float((old_logp[idx] - logp).mean()))
                        clipfracs.append(float(((ratio - 1).abs() > args.clip).float().mean()))
                    pls.append(float(pl))
                    vls.append(float(vl))
                    ents.append(float(el))

            st = res["stats"]
            selfplay = st.get("self", {})
            idle = st.get("dummy", {}).get("idle", {})
            entry = {
                "iter": it,
                "decisions": total_decisions,
                "rollout_s": round(t_roll, 1),
                "update_s": round(time.time() - t0 - t_roll, 1),
                "episodes": st["episodes"],
                "avg_round_s": round(st["ticks"] / st["episodes"] / 60, 1),
                "selfplay_round_s": round(selfplay.get("ticks", 0) / max(1, selfplay.get("n", 0)) / 60, 1),
                "selfplay_draw_rate": round(selfplay.get("draws", 0) / max(1, selfplay.get("n", 0)), 3),
                "vs_normal_bot": winrate(st["bot"]["normal"]),
                "vs_hard_bot": winrate(st["bot"]["hard"]),
                "vs_pool": winrate(st["pool"]),
                "idle_dummy_kill_s": round(idle["ticks"] / idle["n"] / 60, 1) if idle.get("n") else None,
                "idle_dummy_winrate": round(idle["w"] / idle["n"], 3) if idle.get("n") else None,
                "shots_per_round": round(st["shots"] / st["episodes"], 1),
                "specials_per_round": round(st["specials"] / st["episodes"], 2),
                "mean_reward_per_decision": round(float(rew.mean()), 4),
                "entropy": round(float(np.mean(ents)), 3),
                "kl": round(float(np.mean(kls)), 4),
                "clipfrac": round(float(np.mean(clipfracs)), 3),
                "value_loss": round(float(np.mean(vls)), 4),
                "skipped_minibatches": skipped,
            }
            log.write(json.dumps(entry) + "\n")
            log.flush()
            fmt = lambda x: "  -  " if x is None else f"{x:5.2f}"
            print(
                f"it {it:4d} | {total_decisions/1e6:6.2f}M dec | round {entry['avg_round_s']:4.1f}s "
                f"| vs normal {fmt(entry['vs_normal_bot'])} hard {fmt(entry['vs_hard_bot'])} pool {fmt(entry['vs_pool'])} "
                f"| idle dummy {entry['idle_dummy_kill_s'] or '-'}s "
                f"| shots {entry['shots_per_round']:4.1f} spec {entry['specials_per_round']:4.2f} "
                f"| ent {entry['entropy']:.2f} kl {entry['kl']:.4f} | {entry['rollout_s']}s+{entry['update_s']}s",
                flush=True,
            )

            if not all(torch.isfinite(p).all() for p in net.parameters()):
                raise RuntimeError(f"non-finite weights at iter {it}; resume from the last checkpoint")
            meta = {"iter": it, "decisions": total_decisions, "run": args.run, "vs_hard_bot": entry["vs_hard_bot"]}
            net.export(os.path.join(out_dir, "latest.json"), meta)
            if it % args.save_every == 0:
                gen = os.path.join(out_dir, f"gen_{it:04d}.json")
                net.export(gen, meta)
                pool.append(gen)
                torch.save({"net": net.state_dict(), "opt": opt.state_dict(), "iter": it, "decisions": total_decisions}, ckpt_path)
                with open(os.path.join(out_dir, "index.json"), "w") as f:
                    json.dump({"run": args.run, "generations": [os.path.basename(p) for p in pool]}, f)
    finally:
        rollouts.close()
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
