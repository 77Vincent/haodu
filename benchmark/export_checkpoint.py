"""Convert an explicit checkpoint to the existing JS tensor format, without training code.

PyTorch is optional and used only before measurement. Never load a pickled model
object or choose best_state implicitly: the supplied model_state is the subject.
"""
import base64
import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
DEPENDENCIES = HERE.parent / 'artifacts/benchmark-deps'


def input_contract(policy):
    expected = json.loads((HERE/'multicut-input-v20.json').read_text())
    actual = {key: policy.get(key) for key in expected}
    for key in ('quote_boundaries', 'wrapper_boundaries'):
        actual[key] = {'pairs': (actual[key] or {}).get('pairs')}
    actual['protected_structures'] = {'patterns': (actual['protected_structures'] or {}).get('patterns')}
    if actual != expected:
        raise ValueError('Unsupported checkpoint input policy; expected the pinned v20 normalization contract')
    return actual


def selected_threshold(checkpoint):
    # Final best.pt snapshots carry selection. Periodic snapshots carry current
    # progress and matching validation history; best_metrics may be older.
    if 'selection' in checkpoint:
        selected = checkpoint['selection']
    else:
        progress = checkpoint.get('progress', {})
        matches = [v for v in checkpoint.get('validation_history', [])
                   if v.get('epoch') == progress.get('epoch')
                   and v.get('samples') == progress.get('seen_examples')]
        if len(matches) != 1:
            raise ValueError('Checkpoint has no validation threshold for this exact model_state; '
                             'use a validation checkpoint or final best.pt')
        selected = matches[0]['validation']
    value = selected.get('threshold')
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value < 1:
        raise ValueError('Checkpoint validation threshold must be strictly between 0 and 1')
    return value


def tensor_shapes(vocabulary_size, channels, blocks):
    shapes = {'embedding.weight': (vocabulary_size, channels)}
    for i in range(blocks):
        for name, shape in (
            ('normalization.weight', (channels,)), ('normalization.bias', (channels,)),
            ('first.weight', (channels, channels, 3)), ('first.bias', (channels,)),
            ('second.weight', (channels, channels, 3)), ('second.bias', (channels,)),
            ('residual_scale', (1,)),
        ):
            shapes[f'blocks.{i}.{name}'] = shape
    shapes.update({'boundary_hidden.weight': (channels, channels*4),
                   'boundary_hidden.bias': (channels,),
                   'boundary_output.weight': (1, channels), 'boundary_output.bias': (1,)})
    return shapes


def export_checkpoint(source, output):
    sys.path.insert(0, str(DEPENDENCIES))
    try:
        import torch
    except ImportError as error:
        raise ValueError('Checkpoint import needs PyTorch. From haodu run once: '
                         'python3 -m pip install --target artifacts/benchmark-deps '
                         '-r benchmark/checkpoint-requirements.txt') from error
    torch.set_num_threads(1)
    source, output = Path(source), Path(output)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    checkpoint = torch.load(source, map_location='cpu', weights_only=True)
    if not isinstance(checkpoint, dict) or checkpoint.get('task') not in ('single', 'multi'):
        raise ValueError('--checkpoint requires an explicit single or multi task')
    task = checkpoint['task']
    config = checkpoint['configuration']
    if config.get('task', task) != task:
        raise ValueError('Checkpoint task disagrees with its configuration')
    if config.get('model_execution_contract') != 'masked-residual-convolutions-v1':
        raise ValueError('Unsupported checkpoint network execution contract')
    channels, blocks = config['channels'], config['residual_blocks']
    maximum = config['input_maximum_characters']
    if any(type(v) is not int or v < 1 for v in (channels, blocks, maximum)) or maximum < 2:
        raise ValueError('Invalid checkpoint dimensions or input limit')
    policy = input_contract(checkpoint['data_policy'])
    # Single-cut logits are decoded by the existing recursive softmax backend.
    # Its confidence gate is a backend rule, not a sigmoid validation threshold.
    threshold = selected_threshold(checkpoint) if task == 'multi' else None
    vocabulary = checkpoint['vocabulary']
    if (not isinstance(vocabulary, dict) or vocabulary.get('<pad>') != 0 or vocabulary.get('<unk>') != 1
            or any(type(i) is not int for i in vocabulary.values())
            or sorted(vocabulary.values()) != list(range(len(vocabulary)))
            or any(not isinstance(c, str) or len(c) != 1 for c in vocabulary if c not in ('<pad>', '<unk>'))):
        raise ValueError('Invalid checkpoint character vocabulary/IDs')
    state = checkpoint['model_state']
    shapes = tensor_shapes(len(vocabulary), channels, blocks)
    if set(state) != set(shapes):
        raise ValueError('Checkpoint tensor names do not match the supported network')
    chunks, descriptors, offset = [], {}, 0
    for name, shape in shapes.items():
        value = state[name]
        if (not isinstance(value, torch.Tensor) or tuple(value.shape) != shape
                or value.dtype != torch.float32 or not bool(torch.isfinite(value).all())):
            raise ValueError(f'Invalid FP32 checkpoint tensor: {name}')
        array = value.detach().cpu().contiguous().numpy().astype('<f4', copy=False)
        chunks.append(array.tobytes())
        descriptors[name] = dict(offset=offset, length=array.size, shape=list(shape))
        offset += array.size
    after = hashlib.sha256(source.read_bytes()).hexdigest()
    if after != before:
        raise ValueError('Checkpoint changed while reading; use a saved validation snapshot')
    position = checkpoint.get('progress') or checkpoint.get('best_position') or {}
    epoch = position.get('epoch', checkpoint.get('selection', {}).get('epoch', checkpoint.get('epoch')))
    payload = dict(format='haodu-f32-v1', task=task, checkpointSha256=before,
        sourceEpoch=epoch, trainedSamples=position.get('seen_examples', position.get('samples')),
        exportedState='model_state', tokenization='character', inputRepresentation='unicode-context-v1',
        candidatePositions='between every adjacent Unicode code point',
        architecture=dict(channels=channels, residualBlocks=blocks, convolutionsPerBlock=2, kernelSize=3, dilation=1),
        vocabulary=vocabulary, tensors=descriptors,
        weightsBase64=base64.b64encode(b''.join(chunks)).decode('ascii'))
    if task == 'multi':
        payload['multiCut'] = dict(threshold=threshold, thresholdSource='checkpoint validation',
                                  maximumCharacters=maximum, inputPolicy=policy)
    text = '(function(root,data){if(typeof module==="object"&&module.exports)module.exports=data;'
    text += 'root.HaoduBoundaryModelData=data;})(globalThis,'
    text += json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + ');\n'
    temporary = output.with_suffix('.tmp')
    temporary.write_text(text, encoding='utf-8')
    temporary.replace(output)
    return before
