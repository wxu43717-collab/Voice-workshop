from pathlib import Path
import torch
class HParams:
    pass
torch.serialization.add_safe_globals([(HParams, 'utils.HParams')])
root = Path(__file__).resolve().parent.parent
folder = root / 'models/gpt-sovits/takamatsu-tomori'
for file in sorted(folder.glob('*')):
    if file.suffix not in ('.pth', '.ckpt'):
        continue
    data = torch.load(file, map_location='cpu', weights_only=True)
    print(file.name, 'keys:', list(data.keys()))
    if file.suffix == '.pth':
        tensor = data['weight']['enc_p.text_embedding.weight']
        print('text_embedding:', tuple(tensor.shape))
        print('config type:', type(data.get('config')).__name__)
