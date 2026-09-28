"""Pipeline smoke test; repeated synthetic speech verifies plumbing, NOT voice quality."""
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parent.parent
config = json.loads((root / "config.local.json").read_text(encoding="utf-8"))["gpt-sovits"]
work = root / "data/training-smoke"
work.mkdir(exist_ok=True)
source = root / "data/outputs/c4a680d7-7a00-47e3-b640-68d19771317d.wav"
audio, sr = sf.read(source, dtype="float32")
if audio.ndim > 1:
    audio = audio.mean(axis=1)
fixture = np.concatenate([np.concatenate([audio, np.zeros(int(sr * .4), dtype="float32")])] * 6)
sf.write(work / "fixture.wav", fixture, sr)
request = dict(root=str(root), engineRoot=str(root / config["root"]), work=str(work),
               inputs=[str(work / "fixture.wav")], language="zh", sovitsEpochs=1, gptEpochs=1)
(work / "request.json").write_text(json.dumps(request), encoding="utf-8")
with (work / "smoke.log").open("w", encoding="utf-8") as log:
    result = subprocess.run([str(root / config["python"]), str(root / "scripts/training-worker.py"),
                             str(work / "request.json")], stdout=log, stderr=subprocess.STDOUT)
print("Smoke test exit:", result.returncode, flush=True)
print("Log:", work / "smoke.log", flush=True)
sys.exit(result.returncode)

