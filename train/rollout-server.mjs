// Rollout server: train/ppo.py spawns this once and talks to it over
// stdin/stdout, one JSON object per line. It fans each request out to a pool
// of worker threads and replies with the written files + merged stats.
//
// request:  { weights, opponents: [paths], decisions, seed, outDir, mix, reward }
// response: { files: [paths], rows, stats, ms }

import { Worker } from "node:worker_threads";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { OBS_SIZE, HEADS } from "../js/ai/obs.js";

const nWorkers = Number(process.argv[2] ?? 8);
const workers = Array.from({ length: nWorkers }, () => new Worker(new URL("./rollout-worker.mjs", import.meta.url)));

function run(worker, job) {
  return new Promise((resolve, reject) => {
    const onMsg = (m) => {
      worker.off("error", onErr);
      resolve(m);
    };
    const onErr = (e) => {
      worker.off("message", onMsg);
      reject(e);
    };
    worker.once("message", onMsg);
    worker.once("error", onErr);
    worker.postMessage(job);
  });
}

function merge(a, b) {
  for (const k of Object.keys(b)) {
    if (typeof b[k] === "number") a[k] = (a[k] ?? 0) + b[k];
    else a[k] = merge(a[k] ?? {}, b[k]);
  }
  return a;
}

process.stdout.write(JSON.stringify({ ready: true, obsSize: OBS_SIZE, heads: HEADS, workers: nWorkers }) + "\n");

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  const t0 = Date.now();
  try {
    const per = Math.ceil(req.decisions / nWorkers);
    const results = await Promise.all(
      workers.map((w, i) =>
        run(w, { ...req, decisions: per, seed: req.seed * 997 + i + 1, out: join(req.outDir, `w${i}.bin`) }),
      ),
    );
    const stats = results.reduce((acc, r) => merge(acc, r.stats), {});
    process.stdout.write(
      JSON.stringify({ files: results.map((r) => r.out), rows: results.reduce((s, r) => s + r.rows, 0), stats, ms: Date.now() - t0 }) + "\n",
    );
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e?.stack ?? e) }) + "\n");
  }
});
rl.on("close", () => {
  for (const w of workers) w.terminate();
});
