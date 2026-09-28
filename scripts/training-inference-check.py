"""Verify that the real smoke-training exports load in the existing TTS adapter."""
import json
from pathlib import Path
import subprocess
import soundfile as sf

root = Path(__file__).resolve().parent.parent
config = json.loads((root / "config.local.json").read_text(encoding="utf-8"))["gpt-sovits"]
work = root / "data/training-smoke"
result = work / "result"
job = dict(engine="gpt-sovits", engineRoot=str(root / config["root"]),
           voice=dict(version="v2", weights=str(result / "voice.pth"), gpt=str(result / "voice.ckpt")),
           reference=str(result / "reference.wav"), prompt="", referenceLanguage="zh", language="zh",
           text="你好，这是一段新音色训练后的配音测试。", speed=1,
           output=str(work / "inference-check.wav"))
request = work / "inference-request.json"
request.write_text(json.dumps(job), encoding="utf-8")
with (work / "inference.log").open("w", encoding="utf-8") as log:
    subprocess.run([str(root / config["python"]), "-X", "utf8", str(root / "scripts/engine-worker.py"), str(request)],
                   stdout=log, stderr=subprocess.STDOUT, check=True)
info = sf.info(job["output"])
assert .5 < info.duration < 30, info
print(json.dumps(dict(passed=True, duration=info.duration, sampleRate=info.samplerate, output=job["output"])))
