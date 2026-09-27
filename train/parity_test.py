"""Check js/ai/policy.js computes exactly what the PyTorch Net computes."""
import json, os, subprocess, sys, tempfile
import numpy as np, torch
sys.path.insert(0, os.path.dirname(__file__))
from ppo import Net, ROOT

hello = json.loads(subprocess.run(["node", "-e", 'import("./js/ai/obs.js").then(m=>console.log(JSON.stringify({o:m.OBS_SIZE,h:m.HEADS})))'], cwd=ROOT, capture_output=True, text=True).stdout)
torch.manual_seed(0)
net = Net(hello["o"], hello["h"])
for p in net.parameters():  # non-trivial weights everywhere
    torch.nn.init.normal_(p, 0, 0.3)
obs = torch.randn(16, hello["o"])
with torch.no_grad():
    logits, v = net(obs)
d = tempfile.mkdtemp()
net.export(os.path.join(d, "w.json"), {})
json.dump(obs.tolist(), open(os.path.join(d, "obs.json"), "w"))
js = f'''import {{ loadPolicy, forward }} from "./js/ai/policy.js";
import {{ readFileSync }} from "node:fs";
const p = loadPolicy(JSON.parse(readFileSync("{d}/w.json")));
const out = JSON.parse(readFileSync("{d}/obs.json")).map(o => {{ const r = forward(p, Float32Array.from(o)); return [...r.logits, r.value]; }});
console.log(JSON.stringify(out));'''
res = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True)
out = np.array(json.loads(res.stdout))
ref = np.concatenate([logits.numpy(), v.numpy()[:, None]], 1)
err = np.abs(out - ref).max()
print(f"max abs diff JS vs torch: {err:.2e}  (outputs range ±{np.abs(ref).max():.1f})")
assert err < 1e-3, "PARITY FAILED"
print("parity OK")
