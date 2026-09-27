"""Thin adapter over the original projects; each job releases its GPU process."""
import json
import os
import sys
from pathlib import Path

job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
engine = Path(job["engineRoot"])
os.chdir(engine)
sys.path.insert(0, str(engine))
sys.argv = [sys.argv[0]]
os.environ["PATH"] = str(engine) + os.pathsep + str(engine / "runtime") + os.pathsep + os.environ.get("PATH", "")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
import torch
if not torch.cuda.is_available():
    raise RuntimeError("CUDA unavailable: check the NVIDIA 50-series runtime")
import soundfile as sf

if job["engine"] == "rvc":
    model = Path(job["voice"]["weights"])
    os.environ["weight_root"] = str(model.parent)
    os.environ["index_root"] = str(model.parent)
    os.environ["outside_index_root"] = str(model.parent)
    os.environ["rmvpe_root"] = str(engine / "assets" / "rmvpe")
    from configs.config import Config
    from infer.vc.modules import VC
    vc = VC(Config())
    vc.get_vc(model.name)
    index = job["voice"].get("index", "")
    status, result = vc.vc_single(
        0, job["input"], job.get("pitch", 0), "rmvpe", index,
        0.75 if index else 0.0, 0, 1.0, 0.33
    )
    print(status, flush=True)
    if not result or result[0] is None or result[1] is None:
        raise RuntimeError(status)
    sf.write(job["output"], result[1], result[0])
else:
    sys.path.insert(0, str(engine / "GPT_SoVITS"))
    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
    import numpy as np
    voice = job["voice"]
    version = voice.get("version", "v2Pro")
    base = engine / "GPT_SoVITS" / "pretrained_models"
    config = {"custom": {
        "device": "cuda", "is_half": True, "version": version,
        "t2s_weights_path": voice.get("gpt", str(base / "s1v3.ckpt")),
        "vits_weights_path": voice.get("weights", str(base / "v2Pro" / "s2Gv2Pro.pth")),
        "bert_base_path": str(base / "chinese-roberta-wwm-ext-large"),
        "cnhuhbert_base_path": str(base / "chinese-hubert-base")
    }}
    pipeline = TTS(TTS_Config(config))
    inputs = {"text": job["text"], "text_lang": job.get("language", "zh"),
        "ref_audio_path": job["reference"], "prompt_text": job["prompt"],
        "prompt_lang": job.get("referenceLanguage", "zh"), "top_k": 15, "top_p": 1,
        "temperature": 1, "text_split_method": "cut0" if len(job["text"]) < 100 else "cut5", "batch_size": 1,
        "speed_factor": job.get("speed", 1), "fragment_interval": 0.3,
        "seed": -1, "parallel_infer": bool(job["prompt"]), "repetition_penalty": 1.35,
        "sample_steps": 16, "super_sampling": False, "streaming_mode": False}
    chunks = list(pipeline.run(inputs))
    if not chunks:
        raise RuntimeError("No audio generated")
    sf.write(job["output"], np.concatenate([a for _, a in chunks]), chunks[0][0])
print("VOICE_WORKSHOP_DONE", flush=True)
