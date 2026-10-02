"""Publish prepared release assets using the existing Git Credential Manager login.

Credentials stay in memory and are never printed or written to files.
The release stays a draft until every expected attachment is uploaded and verified.
Re-running safely skips matching assets already on GitHub.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
FOLDER = ROOT / "dist/release"
REPO = "wxu43717-collab/Voice-workshop"
API = "https://api.github.com/repos/" + REPO
VERSION = "v0.1.0-preview"
STATE = ROOT / "dist/release-upload-status.json"
LOCK = threading.Lock()
PROGRESS = {}
EXPECTED = {}
HEADERS = {}


def api(method, path, **kwargs):
    response = requests.request(method, API + path, headers=HEADERS, timeout=(30, 90), **kwargs)
    if response.status_code >= 400:
        try:
            message = response.json().get("message", "request failed")
        except ValueError:
            message = "request failed"
        raise RuntimeError("GitHub API %s: %s" % (response.status_code, message))
    return response.json() if response.content else None


def save_status(release, phase):
    with LOCK:
        data = dict(release=release["html_url"], phase=phase, files=dict(PROGRESS),
                    totalBytes=sum(EXPECTED.values()), transferredBytes=sum(PROGRESS.values()))
        STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


class UploadStream:
    def __init__(self, file):
        self.path = file
        self.stream = file.open("rb")
        self.sha = hashlib.sha256()
        self.count = 0

    def __len__(self):
        return self.path.stat().st_size

    def read(self, amount=-1):
        block = self.stream.read(amount)
        self.sha.update(block)
        self.count += len(block)
        with LOCK:
            PROGRESS[self.path.name] = self.count
        return block

    def close(self):
        self.stream.close()


def matches(asset, file, digest):
    return (asset.get("state") == "uploaded" and asset.get("size") == file.stat().st_size
            and asset.get("digest") == "sha256:" + digest)


def upload(release, file, digest):
    upload_url = release["upload_url"].split("{")[0]
    if urlparse(upload_url).hostname != "uploads.github.com":
        raise RuntimeError("Unexpected GitHub upload host")
    for attempt in range(4):
        existing = next((a for a in api("GET", "/releases/%s/assets?per_page=100" % release["id"]) if a["name"] == file.name), None)
        if existing:
            if matches(existing, file, digest):
                with LOCK:
                    PROGRESS[file.name] = file.stat().st_size
                print("VERIFIED", file.name, flush=True)
                return
            if not release["draft"]:
                raise RuntimeError("Published asset differs: " + file.name)
            # Only replace assets in this version's unpublished draft.
            api("DELETE", "/releases/assets/%s" % existing["id"])
        body = UploadStream(file)
        try:
            print("UPLOADING", file.name, flush=True)
            response = requests.post(upload_url, params={"name": file.name}, data=body,
                                     headers={**HEADERS, "Content-Type": "application/octet-stream"},
                                     timeout=(30, 7200), allow_redirects=False)
            if response.status_code != 201:
                raise RuntimeError("Upload HTTP %s" % response.status_code)
            asset = response.json()
            if body.sha.hexdigest() != digest or not matches(asset, file, digest):
                raise RuntimeError("Upload checksum verification failed: " + file.name)
            print("VERIFIED", file.name, flush=True)
            return
        except (requests.RequestException, RuntimeError) as error:
            if attempt == 3:
                raise RuntimeError("Upload failed for %s (%s)" % (file.name, type(error).__name__)) from None
            print("RETRY", file.name, "attempt", attempt + 2, flush=True)
            time.sleep(3 * (attempt + 1))
        finally:
            body.close()


def main():
    global HEADERS
    checksum = {}
    for line in (FOLDER / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", 1)
        if Path(name).name != name:
            raise RuntimeError("Invalid release filename")
        checksum[name] = digest
    checksum["SHA256SUMS.txt"] = hashlib.sha256((FOLDER / "SHA256SUMS.txt").read_bytes()).hexdigest()
    files = [FOLDER / name for name in checksum]
    for file in files:
        if not file.is_file() or file.stat().st_size >= 2 * 1024**3:
            raise RuntimeError("Missing or oversized asset: " + file.name)
        EXPECTED[file.name] = file.stat().st_size
        PROGRESS[file.name] = 0
    login = subprocess.run(["git", "-c", "safe.directory=" + str(ROOT), "credential", "fill"],
                           input="protocol=https\nhost=github.com\n\n", text=True,
                           capture_output=True, timeout=60,
                           env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never"})
    credentials = dict(line.split("=", 1) for line in login.stdout.splitlines() if "=" in line)
    token = credentials.get("password")
    if login.returncode or not token:
        raise RuntimeError("GitHub login unavailable; sign in using Git Credential Manager first")
    HEADERS = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
               "User-Agent": "VoiceWorkshop-Release", "X-GitHub-Api-Version": "2022-11-28"}
    releases = api("GET", "/releases?per_page=100")
    release = next((r for r in releases if r["tag_name"] == VERSION), None)
    if not release:
        release = api("POST", "/releases", json=dict(tag_name=VERSION,
            target_commitish="b49a3c9a3fbe7e09c0c9dd9a821cee9e66302180",
            name="声间 v0.1.0 Preview · Windows NVIDIA", draft=True, prerelease=True,
            body=(FOLDER / "RELEASE_NOTES.md").read_text(encoding="utf-8")))
    print("RELEASE", release["html_url"], "draft=" + str(release["draft"]), flush=True)
    save_status(release, "uploading")
    try:
        # Small essential files first, then at most three large streams concurrently.
        ordered = sorted(files, key=lambda f: f.stat().st_size)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(upload, release, file, checksum[file.name]) for file in ordered]
            while any(not future.done() for future in futures):
                data = save_status(release, "uploading")
                percent = 100 * data["transferredBytes"] / data["totalBytes"]
                print("PROGRESS %.1f%% %.2f / %.2f GB" % (percent, data["transferredBytes"] / 1e9, data["totalBytes"] / 1e9), flush=True)
                time.sleep(20)
            for future in futures:
                future.result()
        remote = {a["name"]: a for a in api("GET", "/releases/%s/assets?per_page=100" % release["id"])}
        for file in files:
            if not matches(remote.get(file.name, {}), file, checksum[file.name]):
                raise RuntimeError("Incomplete release attachment: " + file.name)
        if release["draft"]:
            release = api("PATCH", "/releases/%s" % release["id"], json=dict(draft=False))
        save_status(release, "published")
        print("PUBLISHED", release["html_url"], flush=True)
    except Exception:
        save_status(release, "failed")
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("STOPPED", str(error), flush=True)
        raise SystemExit(1)
