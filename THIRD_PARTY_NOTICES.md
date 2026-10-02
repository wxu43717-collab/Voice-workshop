# Third-party components

The MIT license in this repository covers Voice Workshop's own code only.
Downloaded engine bundles, pretrained models and dependencies keep their own
licenses. The installer downloads original engine archives directly from their
official Hugging Face repositories, keeping their included notices. GitHub
Release assets contain the application, not mirrored models or engine archives.
A top-level MIT license does not relicense every dependency
inside an engine bundle.

| Component | Upstream / source | Notice |
| --- | --- | --- |
| GPT-SoVITS | https://github.com/RVC-Boss/GPT-SoVITS | MIT project; dependencies and model notices remain in the integrated bundle |
| GPT-SoVITS Windows bundle | https://huggingface.co/lj1995/GPT-SoVITS-windows-package | Original `GPT-SoVITS-v2pro-20250604-nvidia50.7z`, unchanged |
| RVC | https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI | MIT project; third-party components retain their licenses |
| RVC Windows bundle | https://huggingface.co/lj1995/VoiceConversionWebUI | Original `RVC20260718Nvidia50x0.7z`, unchanged |
| Node.js 24.13.0 | https://github.com/nodejs/node/tree/v24.13.0 | MIT and bundled third-party notices; full upstream LICENSE is in the application package |
| 7zr 26.03 | https://www.7-zip.org/download.html | Reduced standalone decompressor identifies itself as public domain; do not confuse it with the full LGPL 7-Zip distribution |
| faster-whisper small weights | https://huggingface.co/Systran/faster-whisper-small | Model card: MIT; converted from OpenAI Whisper small |
| Whisper | https://github.com/openai/whisper | MIT; upstream license is included with the offline model package |

No community character voices, user recordings, generated audio, private
configuration, or training jobs are included in the release packages.
Users import or train their own voices. Check the applicable voice/model terms
before redistribution or use.
