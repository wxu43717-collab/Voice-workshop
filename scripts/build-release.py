"""Build a clean source archive, version-locked setup manifest, and GitHub assets.

Requires the original verified engine archives already downloaded locally.
Does not publish or read credentials. Never packages the working data/models folders.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist/release"
VERSION = "v0.1.0-preview"


def digest(file):
    sha = hashlib.sha256()
    with open(file, "rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def asset(file):
    return dict(name=file.name, bytes=file.stat().st_size, sha256=digest(file))


def files_in(folder):
    return sorted(p for p in folder.rglob("*") if p.is_file() and "__pycache__" not in p.parts)


def write_zip(file, entries):
    with zipfile.ZipFile(str(file) + ".tmp", "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for source, target in entries:
            archive.write(source, target)
    os.replace(str(file) + ".tmp", file)


def download_notice(url, file):
    file.parent.mkdir(parents=True, exist_ok=True)
    if not file.exists():
        with urllib.request.urlopen(url, timeout=30) as response:
            file.write_bytes(response.read())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    notices = ROOT / "dist/notices"
    download_notice("https://raw.githubusercontent.com/nodejs/node/v24.13.0/LICENSE", notices / "NODE-LICENSE.txt")
    download_notice("https://raw.githubusercontent.com/openai/whisper/main/LICENSE", notices / "WHISPER-LICENSE.txt")
    download_notice("https://huggingface.co/Systran/faster-whisper-small/raw/main/README.md", notices / "WHISPER-MODEL-CARD.md")
    # Explicit allowlist: local experiments and private working files never enter the release.
    relative = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", ".gitignore", "package.json", "server.mjs", "training.mjs", "start.cmd"]
    for folder in ["web", "desktop", "installer", "tests", "docs"]:
        relative.extend(str(p.relative_to(ROOT)) for p in files_in(ROOT / folder))
    relative.extend("scripts/" + name for name in [
        "engine-worker.py", "training-worker.py", "training-entry.py", "install-engines.mjs",
        "install-desktop.ps1", "build-release.py", "test-installer.mjs", "test-installer-contracts.mjs",
    ])
    sources = [(ROOT / name, name.replace("\\", "/")) for name in relative]
    write_zip(OUT / "voice-workshop-source.zip", sources)
    launcher = ROOT / "dist/desktop/VoiceWorkshop.exe"
    node = ROOT / "dist/desktop/node.exe"
    if not launcher.exists() or not node.exists():
        raise RuntimeError("Run scripts/install-desktop.ps1 first")
    app = OUT / "voice-workshop-app.zip"
    entries = sources + [(launcher, "dist/desktop/VoiceWorkshop.exe"), (node, "dist/desktop/node.exe"),
                         (ROOT / "tools/7zr.exe", "tools/7zr.exe"), (notices / "NODE-LICENSE.txt", "licenses/NODE-LICENSE.txt"),
                         (notices / "WHISPER-LICENSE.txt", "licenses/WHISPER-LICENSE.txt"),
                         (notices / "WHISPER-MODEL-CARD.md", "licenses/WHISPER-MODEL-CARD.md")]
    write_zip(app, entries)
    info = asset(app)
    packages = [dict(id="app", name="声间工作台", file=app.name, bytes=info["bytes"], sha256=info["sha256"],
                     target=".", format="zip", parts=[info])]
    specs = [
        ("gpt-sovits", "文字配音引擎", "GPT-SoVITS-v2pro-20250604-nvidia50.7z", "97b4edcd451c42357db7e26e6c1c877ca5d85144fe97beaff6d7005d35bee008", "lj1995/GPT-SoVITS-windows-package"),
        ("rvc", "录音换声引擎", "RVC20260718Nvidia50x0.7z", "d258bc0cbcce07136f05781f04aafb6f5e02c593f88c8fe8c62a4ab683751467", "lj1995/VoiceConversionWebUI"),
    ]
    for ident, label, filename, expected, repo in specs:
        original = ROOT / "downloads" / filename
        print("Verifying official source", filename, flush=True)
        if digest(original) != expected:
            raise RuntimeError("Upstream archive hash mismatch: " + filename)
        packages.append(dict(id=ident, name=label, file=filename, bytes=original.stat().st_size,
                             sha256=expected, target="engines/" + ident, format="7z",
                             parts=[dict(name=filename, bytes=original.stat().st_size, sha256=expected,
                                         url="https://huggingface.co/" + repo + "/resolve/main/" + filename + "?download=true")]))
    snapshots = ROOT / "tools/asr-cache/models--Systran--faster-whisper-small/snapshots"
    snapshot = next(p for p in sorted(snapshots.iterdir()) if (p / "model.bin").exists())
    for name in ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"]:
        info = asset(snapshot / name)
        info["url"] = "https://huggingface.co/Systran/faster-whisper-small/resolve/" + snapshot.name + "/" + name + "?download=true"
        packages.append(dict(id="asr-" + name, name="离线转写 " + name, file=name,
                             bytes=info["bytes"], sha256=info["sha256"],
                             target=str(snapshot.relative_to(ROOT)).replace("\\", "/"), format="file", parts=[info]))
    manifest = OUT / "release-manifest.json"
    manifest.write_text(json.dumps(dict(version=VERSION, packages=packages), ensure_ascii=False, indent=2), encoding="utf-8")
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    subprocess.run([str(compiler), "/nologo", "/target:winexe", "/optimize+", "/platform:x64",
                    "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.Web.Extensions.dll",
                    "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll",
                    "/resource:" + str(manifest) + ",release.json",
                    "/win32icon:" + str(ROOT / "dist/desktop/voice.ico"),
                    "/out:" + str(OUT / "VoiceWorkshop-Setup.exe"), str(ROOT / "installer/Setup.cs")], check=True)
    checksum_files = [OUT / "VoiceWorkshop-Setup.exe", OUT / "voice-workshop-source.zip", manifest]
    checksum_files += [app]
    with (OUT / "SHA256SUMS.txt").open("w", encoding="utf-8") as stream:
        for file in checksum_files:
            known = next((part["sha256"] for package in packages for part in package["parts"] if part["name"] == file.name), None)
            stream.write((known or digest(file)) + "  " + file.name + "\n")
    shutil.copyfile(ROOT / "docs/发布指南.md", OUT / "发布指南.md")
    shutil.copyfile(ROOT / "docs/RELEASE_NOTES.md", OUT / "RELEASE_NOTES.md")
    # Remove only known generated mirrors from the previous release design.
    for _, _, filename, _, _ in specs:
        for index in range(1, 6):
            obsolete = OUT / (filename + ".%03d" % index)
            if obsolete.exists():
                obsolete.unlink()
    obsolete = OUT / "voice-workshop-asr.zip"
    if obsolete.exists():
        obsolete.unlink()
    print("READY (application files only)", OUT, flush=True)


if __name__ == "__main__":
    main()
