"""Generate independent PyTorch logits for an explicitly promoted multi-cut checkpoint."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'benchmark'))
from export_checkpoint import DEPENDENCIES, selected_threshold
sys.path.insert(0, str(DEPENDENCIES))
import torch
import torch.nn.functional as F


def forward(text, checkpoint, dtype, device):
    weights = {k: v.to(device=device, dtype=dtype) for k, v in checkpoint['model_state'].items()}
    vocabulary = checkpoint['vocabulary']
    ids = torch.tensor([[vocabulary.get(c, vocabulary['<unk>']) for c in text]], device=device)
    hidden = F.embedding(ids, weights['embedding.weight'])
    channels = checkpoint['configuration']['channels']
    for i in range(checkpoint['configuration']['residual_blocks']):
        prefix = f'blocks.{i}.'
        normalized = F.layer_norm(hidden, (channels,), weights[prefix+'normalization.weight'],
                                  weights[prefix+'normalization.bias'])
        first = F.conv1d(normalized.transpose(1, 2), weights[prefix+'first.weight'],
                         weights[prefix+'first.bias'], padding=1)
        second = F.conv1d(F.gelu(first, approximate='tanh'), weights[prefix+'second.weight'],
                          weights[prefix+'second.bias'], padding=1).transpose(1, 2)
        hidden = hidden + weights[prefix+'residual_scale'] * second
    left, right = hidden[:, :-1], hidden[:, 1:]
    features = torch.cat([left, right, right-left, right*left], dim=-1)
    gaps = F.gelu(F.linear(features, weights['boundary_hidden.weight'],
                           weights['boundary_hidden.bias']), approximate='tanh')
    return F.linear(gaps, weights['boundary_output.weight'],
                    weights['boundary_output.bias']).flatten().cpu().tolist()


if __name__ == '__main__':
    source = Path(sys.argv[1])
    checkpoint = torch.load(source, map_location='cpu', weights_only=True)
    if checkpoint['task'] != 'multi':
        raise ValueError('Expected an explicit multi-cut checkpoint')
    torch.set_num_threads(1)
    output = ROOT/'test/model-backend-reference.json'
    texts = [row['text'] for row in json.loads(output.read_text())['cases']]
    texts = list(dict.fromkeys(texts + ['你好', '甲😀乙', '神经网络可以找到多个语意块之间的切点']))
    result = dict(source='Independent PyTorch functional forward passes; unpadded sentences, '
                        'same stored FP32 weights, CPU float64 and CPU float32.',
                  checkpointSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  sourceEpoch=checkpoint['progress']['epoch'],
                  trainedSamples=checkpoint['progress']['seen_examples'],
                  vocabularySize=len(checkpoint['vocabulary']),
                  threshold=selected_threshold(checkpoint), cases=[])
    with torch.no_grad():
        for text in texts:
            result['cases'].append(dict(text=text,
                scores=forward(text, checkpoint, torch.float64, 'cpu'),
                float32Scores=forward(text, checkpoint, torch.float32, 'cpu')))
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(output)
