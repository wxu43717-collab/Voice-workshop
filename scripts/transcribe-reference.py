import os
from pathlib import Path
from faster_whisper import WhisperModel
root=Path(__file__).resolve().parent.parent
os.environ['HF_HUB_DISABLE_XET']='1'
model=WhisperModel('small',device='cpu',compute_type='int8',download_root=str(root/'tools/asr-cache'))
import sys
file=Path(sys.argv[1]) if len(sys.argv)>1 else root/'models/gpt-sovits/takamatsu-tomori/reference.wav'
segments,info=model.transcribe(str(file),language=sys.argv[2] if len(sys.argv)>2 else 'ja',beam_size=5,vad_filter=False)
for s in segments: print(f'{s.start:.2f}-{s.end:.2f}: {s.text}',flush=True)
