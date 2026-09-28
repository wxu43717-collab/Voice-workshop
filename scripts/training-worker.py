"""Audio-only GPT-SoVITS v2 training adapter. No user-supplied transcript required."""
import gc
import json
import os
import shutil
import subprocess
import sys
import traceback
import zipfile
from pathlib import Path


def event(stage, message, **extra):
    print("@TRAIN " + json.dumps(dict(stage=stage, message=message, **extra), ensure_ascii=False), flush=True)


def run(script, *args):
    subprocess.run([sys.executable, "-X", "utf8", "-s", str(Path(__file__).with_name("training-entry.py")), str(script), *map(str, args)], check=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    root, engine, work = map(Path, (job["root"], job["engineRoot"], job["work"]))
    work.mkdir(parents=True, exist_ok=True)
    os.chdir(engine)
    os.environ.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", HF_HUB_OFFLINE="1",
                      TRANSFORMERS_OFFLINE="1", USE_LIBUV="0", version="v2", hz="25hz",
                      OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="2")
    os.environ["PATH"] = str(engine / "runtime") + os.pathsep + os.environ.get("PATH", "")
    os.environ["PYTHONPATH"] = os.pathsep.join([str(engine), str(engine / "GPT_SoVITS")])
    base = engine / "GPT_SoVITS/pretrained_models"
    pre = base / "gsv-v2final-pretrained"
    for file in [pre / "s2G2333k.pth", pre / "s2D2333k.pth",
                 pre / "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"]:
        if not file.is_file():
            raise RuntimeError("缺少训练基础权重：" + file.name)
    if shutil.disk_usage(work).free < 8 * 1024**3:
        raise RuntimeError("训练至少需要 8GB 可用磁盘空间")
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("未检测到可用的 NVIDIA GPU")
    event("prepare", "正在检查录音并切分人声")
    import numpy as np
    import soundfile as sf
    import librosa
    clip_dir = work / "clips"
    clip_dir.mkdir(exist_ok=True)
    clips, total = [], 0.0
    for i, source in enumerate(job["inputs"]):
        decoded = work / ("source-%02d.wav" % i)
        subprocess.run([str(engine / "runtime/ffmpeg.exe"), "-hide_banner", "-loglevel", "error",
                        "-y", "-i", source, "-t", "1801", "-ac", "1", "-ar", "32000",
                        "-c:a", "pcm_s16le", str(decoded)], check=True)
        audio, sr = sf.read(decoded, dtype="float32")
        total += len(audio) / sr
        if total > 1800:
            raise RuntimeError("录音总时长不能超过 30 分钟，请缩短后重试")
        if not np.isfinite(audio).all() or np.max(np.abs(audio), initial=0) < .001:
            continue
        intervals = librosa.effects.split(audio, top_db=35, frame_length=1024, hop_length=256)
        merged = []
        for start, end in intervals:
            if merged and start - merged[-1][1] < .65 * sr:
                merged[-1][1] = int(end)
            else:
                merged.append([int(start), int(end)])
        for start, end in merged:
            start = max(0, start - int(.12 * sr))
            end = min(len(audio), end + int(.12 * sr))
            pieces = max(1, int(np.ceil((end - start) / (8 * sr))))
            for part in np.array_split(audio[start:end], pieces):
                if len(part) / sr < 1.5:
                    continue
                dest = clip_dir / ("%05d.wav" % len(clips))
                sf.write(dest, part, sr, subtype="PCM_16")
                clips.append((dest, len(part) / sr))
    if total < job.get("minimumSeconds", 30):
        raise RuntimeError("录音太短：请提供至少 30 秒，建议 1–10 分钟同一人的清晰录音")
    if not clips:
        raise RuntimeError("未找到清晰人声，请检查静音、音量和背景音乐")
    event("transcribe", "正在自动识别人声，无需输入台词", seconds=round(total), clips=len(clips))
    from faster_whisper import WhisperModel
    snapshots = root / "tools/asr-cache/models--Systran--faster-whisper-small/snapshots"
    models = [p for p in snapshots.glob("*") if (p / "model.bin").is_file()]
    if not models:
        raise RuntimeError("缺少离线语音识别模型，请先安装 Whisper small")
    asr = WhisperModel(str(models[0]), device="cpu", compute_type="int8", cpu_threads=6)
    accepted = []
    for index, (file, seconds) in enumerate(clips):
        segments, _ = asr.transcribe(str(file), language=job["language"], beam_size=5,
                                    vad_filter=False, condition_on_previous_text=False)
        text = "".join(s.text for s in segments if s.no_speech_prob < .65 and s.avg_logprob > -1.2)
        text = text.replace("|", " ").replace("\n", " ").strip()
        if text:
            accepted.append((file, seconds, text))
        event("transcribe", "正在自动识别 %d / %d 段" % (index + 1, len(clips)), clips=len(accepted))
    del asr
    gc.collect()
    if len(accepted) < 3 or sum(c[1] for c in accepted) < job.get("minimumSpeechSeconds", 20):
        raise RuntimeError("可识别的人声不足，请提供更长、更清晰的单人录音")
    ref = next((c for c in accepted if 3 <= c[1] <= 9.5), None)
    if ref is None:
        raise RuntimeError("需要至少一段 3–10 秒的连续人声来保存默认声音，请换一段录音")
    exp = work / "experiment"
    exp.mkdir(exist_ok=True)
    (exp / "logs_s2_v2").mkdir(exist_ok=True)
    labels = work / "audio.list"
    labels.write_text("\n".join("%s|speaker|%s|%s" % (p.as_posix(), job["language"].upper(), t)
                                for p, _, t in accepted), encoding="utf-8")
    os.environ.update(inp_text=str(labels), inp_wav_dir=str(clip_dir), exp_name="voice",
                      i_part="0", all_parts="1", opt_dir=str(exp), _CUDA_VISIBLE_DEVICES="0",
                      is_half="True", bert_pretrained_dir=str(base / "chinese-roberta-wwm-ext-large"),
                      cnhubert_base_dir=str(base / "chinese-hubert-base"),
                      pretrained_s2G=str(pre / "s2G2333k.pth"),
                      s2config_path=str(engine / "GPT_SoVITS/configs/s2.json"))
    event("features", "正在提取音色与语音特征")
    prep = engine / "GPT_SoVITS/prepare_datasets"
    for script in ["1-get-text.py", "2-get-hubert-wav32k.py", "3-get-semantic.py"]:
        run(prep / script)
    texts = (exp / "2-name2text-0.txt").read_text(encoding="utf-8").strip().splitlines()
    semantics = (exp / "6-name2semantic-0.tsv").read_text(encoding="utf-8").strip().splitlines()
    names = {line.split("\t")[0] for line in texts} & {line.split("\t")[0] for line in semantics}
    names = {name for name in names if (exp / "5-wav32k" / name).is_file()
             and (exp / "4-cnhubert" / (name + ".pt")).is_file()}
    if len(names) < 3 or len(names) < .8 * len(accepted):
        raise RuntimeError("语音特征提取不完整，请查看日志并更换清晰录音")
    (exp / "2-name2text.txt").write_text("\n".join(l for l in texts if l.split("\t")[0] in names), encoding="utf-8")
    (exp / "6-name2semantic.tsv").write_text("item_name\tsemantic_audio\n" + "\n".join(
        l for l in semantics if l.split("\t")[0] in names), encoding="utf-8")
    weights = work / "weights"
    weights.mkdir(exist_ok=True)
    s2 = json.loads((engine / "GPT_SoVITS/configs/s2.json").read_text())
    s2["train"].update(batch_size=1, epochs=job.get("sovitsEpochs", 8), text_low_lr_rate=.4,
                       pretrained_s2G=str(pre / "s2G2333k.pth"), pretrained_s2D=str(pre / "s2D2333k.pth"),
                       if_save_latest=True, if_save_every_weights=True,
                       save_every_epoch=job.get("sovitsEpochs", 8), gpu_numbers="0", grad_ckpt=True)
    s2["model"]["version"] = "v2"
    s2["data"]["exp_dir"] = s2["s2_ckpt_dir"] = str(exp)
    s2.update(save_weight_dir=str(weights), name="voice", version="v2")
    config = work / "s2.json"
    config.write_text(json.dumps(s2), encoding="utf-8")
    event("sovits", "正在训练音色权重，显卡处理中")
    run(engine / "GPT_SoVITS/s2_train.py", "--config", config)
    import yaml
    s1 = yaml.safe_load((engine / "GPT_SoVITS/configs/s1longer-v2.yaml").read_text())
    s1["train"].update(batch_size=1, epochs=job.get("gptEpochs", 12), save_every_n_epoch=job.get("gptEpochs", 12),
                       if_save_every_weights=True, if_save_latest=True, if_dpo=False,
                       half_weights_save_dir=str(weights), exp_name="voice")
    s1["data"]["num_workers"] = 1
    s1.update(pretrained_s1=str(pre / "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"),
              train_semantic_path=str(exp / "6-name2semantic.tsv"),
              train_phoneme_path=str(exp / "2-name2text.txt"), output_dir=str(exp / "logs_s1_v2"))
    config = work / "s1.yaml"
    config.write_text(yaml.safe_dump(s1), encoding="utf-8")
    event("gpt", "正在训练配音权重")
    run(engine / "GPT_SoVITS/s1_train.py", "--config_file", config)
    pths, ckpts = list(weights.glob("*.pth")), list(weights.glob("*.ckpt"))
    if not pths or not ckpts:
        raise RuntimeError("训练未生成完整的音色权重，请检查日志")
    result = work / "result"
    result.mkdir(exist_ok=True)
    shutil.copy2(max(pths, key=lambda p: p.stat().st_mtime), result / "voice.pth")
    shutil.copy2(max(ckpts, key=lambda p: p.stat().st_mtime), result / "voice.ckpt")
    shutil.copy2(ref[0], result / "reference.wav")
    (result / "README.txt").write_text("GPT-SoVITS v2 音色包\n配套导入 voice.pth 与 voice.ckpt。\n"
                                     "reference.wav 为默认参考录音，可使用无参考文本模式。\n"
                                     "录音语言：" + job["language"], encoding="utf-8")
    event("export", "正在导出音色包")
    with zipfile.ZipFile(work / "voice.zip", "w", compression=zipfile.ZIP_STORED) as archive:
        for file in result.iterdir():
            archive.write(file, file.name)
    event("complete", "训练完成", clips=len(names), seconds=round(total))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        event("error", str(error) if not isinstance(error, subprocess.CalledProcessError)
              else "训练步骤未完成，请查看日志；若提示显存不足，请缩短录音片段后重试")
        traceback.print_exc()
        sys.exit(1)

