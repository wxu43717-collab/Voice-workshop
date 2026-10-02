# Project workflow

- The user authorizes committing and pushing completed project changes to GitHub after appropriate checks. Do this by default; do not ask for repeated permission.
- Repository: https://github.com/wxu43717-collab/Voice-workshop
- Published branch: `main`. When working on another local branch, push explicitly to the intended remote branch; for the current direct-update workflow use `git push origin HEAD:main`.
- Fetch and inspect remote changes before pushing. Preserve other contributors' changes; never force-push or overwrite remote history.
- Keep local recordings, generated audio, voice models, engine environments, credentials, private configuration, and download caches out of Git. Release resources belong in Release assets.
- Committing source changes does not publish new installer binaries. Rebuild and publish matching release assets separately when an installer release is requested.
