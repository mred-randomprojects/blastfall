# Blastfall (working title)

Bare-bones single-screen missile duel, built so an AI can later learn it by self-play.

- Run: `npm run serve` → http://localhost:8431 (ES modules need a server, `file://` won't work)
- Test: `npm test` (determinism, rounds always end, bot-vs-bot stats + sim speed)

Layout:
- `js/sim.js` — the whole game as a pure, deterministic, fixed-tick (60Hz) simulation. No DOM, no Math.random, no trig. This is what training will run headless.
- `js/bot.js` — scripted baseline bot (event-driven decisions + reaction delay): the yardstick.
- `js/render.js`, `js/audio.js`, `js/input.js`, `js/main.js` — presentation only; they read sim state/events and never change the rules.

## The AI

Self-play PPO. The game only exists in JS; Node worker threads play the rounds, PyTorch does the learning.

- `js/ai/obs.js` — what the AI sees (~108 numbers: itself, opponent, 5 nearest missiles, pickups, time, 8 wall raycasts). Player 2's view is mirrored so one network plays both sides.
- `js/ai/agent.js` — event-driven decisions: re-decides when something happens (a shot, an explosion, landing, a cooldown ending…), at most every 3 ticks and at least every 10; holds its input in between.
- `js/ai/policy.js` — the network's forward pass in plain JS (runs in training workers *and* the browser).
- `train/ppo.py` — trainer. `train/rollout-server.mjs` + `train/rollout-worker.mjs` — parallel self-play.
- `train/parity_test.py` — checks the JS network computes exactly what the PyTorch one does.
- `train/eval.mjs` — win rate of a model vs the scripted bots or another model, with a 95% interval.

Reward: win = +1 plus up to +0.5 for winning fast (scaled by time left), loss = −1, draw/double-KO = −0.5, plus a small bonus/penalty for damage dealt/taken. Time is also discounted per tick, so sooner is always better.

Opponents during training: 50% itself, 30% past generations (so it doesn't forget), 20% the scripted bots.

```
python3 train/ppo.py --run v1 --iters 400          # train (≈1s per iteration of 100k decisions)
python3 train/ppo.py --run v1 --iters 400 --resume # keep going
node train/eval.mjs models/v1/latest.json 400 hard # measure
```

In the game: **4** = you vs the trained AI, **5** = AI vs AI. `?run=v1&gen=gen_0100` picks a specific generation.
