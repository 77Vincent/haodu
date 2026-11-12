#!/usr/bin/env python3
"""Fixed 10,000-sentence BZNSYP quality and parallel JavaScript speed regression."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import re
from pathlib import Path
import subprocess
import sys
import uuid

from bznsyp_golden import ROOT, CASES, load_cases, mark, sha
from golden_scoring import SCORING_POLICY, SCORING_DESCRIPTION, aggregate, score
from export_checkpoint import export_checkpoint

SCHEMA = 'haodu-backend-benchmark-v3'
REPORT_SCHEMA = 'haodu-benchmark-v1'
PROJECTION = 'adjacent-proxy-removal-all10000-v1'
QUALITY_KEYS = ('sentence_accuracy', 'cut_precision', 'required_coverage')
SPEED_KEYS = ('batch_wall_ms', 'backend_total_ms', 'model_total_ms')
HERE = Path(__file__).resolve().parent


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def prepare():
    if not CASES.is_file():
        raise ValueError('BZNSYP data is missing. Import the official annotation file with '
                         'npm run golden:import -- --source /path/to/000001-010000.txt '
                         '(see benchmark/golden/README.md)')
    metadata = read(CASES.with_name('source.json'))
    if sha(CASES) != metadata['cases_sha256']:
        raise ValueError('Golden CSV differs from its recorded source hash')
    rows = load_cases()
    if [r['id'] for r in rows] != [f'{n:06}' for n in range(1, 10001)]:
        raise ValueError('Benchmark requires all 10,000 original IDs in source order')
    # No threshold/length/known-error/duplicate exclusion: denominator is fixed.
    projected = [dict(id=r['id'], raw=r['raw'], required=r['required'], optional=r['optional']) for r in rows]
    identity = dict(name='BZNSYP', cases=10000, cases_sha256=sha(CASES),
                    projected_sha256=digest(projected), projection=PROJECTION,
                    eligibility_filter=False, excluded_ids=[],
                    known_annotation_errors_included=metadata.get('exclusions', {}))
    return rows, identity


def score_outputs(rows, prediction):
    outputs = prediction['rows']
    if [r['id'] for r in outputs] != [r['id'] for r in rows]:
        raise ValueError('Prediction IDs/order/coverage differ from fixed corpus')
    scored = []
    for row, output in zip(rows, outputs):
        scored.append(dict(id=row['id'], source=row['source'], raw=row['raw'],
            required=row['required'], optional=row['optional'], expected=row['expected'],
            with_optional=row['with_optional'], predicted=mark(row['raw'], output['cuts']),
            timing={key: output[key] for key in ('backend_ms', 'model_ms', 'model_calls', 'model_tokens')},
            **score(row['required'], row['optional'], output['cuts'], text=row['raw'])))
    return scored


def compare(current, baseline, slowdown_pct=5):
    if baseline.get('schema_version') not in (SCHEMA, 'haodu-backend-benchmark-v1', 'haodu-backend-benchmark-v2'):
        raise ValueError('Baseline report uses an unsupported schema')
    quality_reasons = []
    for key in ('cases_sha256', 'projected_sha256', 'projection', 'cases'):
        if current['dataset'][key] != baseline['dataset'][key]:
            quality_reasons.append('dataset.' + key)
    if current['scoring'] != baseline['scoring']:
        quality_reasons.append('scoring')
    quality_deltas = {}
    regressions = []
    if not quality_reasons:
        for key in QUALITY_KEYS:
            before, after = baseline['quality'][key], current['quality'][key]
            delta = None if before is None or after is None else (after - before) * 100
            quality_deltas[key] = delta
            if (delta is not None and delta < -1e-10) or (before is not None and after is None):
                regressions.append('quality.' + key)
    speed_reasons = list(quality_reasons)
    if current['schema_version'] != baseline['schema_version']:
        speed_reasons.append('schema_version')
    if current['environment'] != baseline['environment']:
        speed_reasons.append('environment')
    if current['measurement'] != baseline['measurement']:
        speed_reasons.append('measurement')
    speed_deltas = {}
    if not speed_reasons:
        for key in SPEED_KEYS:
            before, after = baseline['performance'][key], current['performance'][key]
            delta = (after / before - 1) * 100 if before > 0 else None
            speed_deltas[key] = delta
            if delta is not None and delta > slowdown_pct:
                regressions.append('performance.' + key)
    comparable = not quality_reasons and not speed_reasons
    return dict(status='regression' if regressions else 'pass' if comparable else 'incomparable',
        baseline_run_id=baseline['run_id'], quality_comparable=not quality_reasons,
        performance_comparable=not speed_reasons, quality_incompatibilities=quality_reasons,
        performance_incompatibilities=speed_reasons, quality_delta_percentage_points=quality_deltas,
        performance_delta_percent=speed_deltas, slowdown_tolerance_percent=slowdown_pct,
        regressions=regressions)


def load_baseline(root):
    pointer = root / 'baseline.json'
    if not pointer.exists():
        return None, None
    reference = read(pointer)
    report_path = root / reference['report']
    # Old comparison pointers sometimes stored absolute paths. Keep their
    # original bytes/hashes while resolving the relocated artifact tree.
    if not report_path.is_file() and report_path.is_absolute() and 'backend-benchmark' in report_path.parts:
        index = report_path.parts.index('backend-benchmark')
        report_path = ROOT/'artifacts/backend-benchmark'/Path(*report_path.parts[index+1:])
    if sha(report_path) != reference['report_sha256']:
        raise ValueError('Pinned baseline report changed; refusing comparison')
    report = read(report_path)
    if report.get('schema_version') == REPORT_SCHEMA:
        directory = report_path.parent
        for name in ('request', 'timings'):
            if sha(directory / f'{name}.json') != reference[f'{name}_sha256']:
                raise ValueError(f'Pinned baseline {name} changed')
        request, timing = read(directory/'request.json'), read(directory/'timings.json')
        record = dict(request['provenance'], model=timing['model'],
                      environment=timing['environment'], performance=timing['performance'])
        record['settings'] = request['provenance'].get('settings', timing['settings'])
        if (report['run_id'] != record['run_id'] or
                report['results'] != compact_report(dict(record, comparison={}))['results']):
            raise ValueError('Pinned baseline report differs from original results')
        report = record
    cases_path = report_path.parent / 'cases.jsonl'
    if sha(cases_path) != report['files']['cases_sha256']:
        raise ValueError('Pinned baseline sentence results changed')
    return report, cases_path


def paired_changes(rows, baseline_path):
    old = [json.loads(line) for line in baseline_path.read_text(encoding='utf-8').splitlines()]
    if [r['id'] for r in old] != [r['id'] for r in rows]:
        raise ValueError('Baseline sentence coverage differs')
    return dict(changed_sentences=sum(a['cuts'] != b['cuts'] for a, b in zip(old, rows)),
        wrong_to_complete=sum(not a['complete'] and b['complete'] for a, b in zip(old, rows)),
        complete_to_wrong=sum(a['complete'] and not b['complete'] for a, b in zip(old, rows)))


def f1(precision, recall):
    if precision is None or recall is None:
        return None
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def compact_report(record):
    """One consumer-facing JSON report; raw provenance stays with request/timings."""
    q, p, model = record['quality'], record['performance'], record['model']
    request = record['measurement']
    precision, recall = q['cut_precision'], q['required_coverage']
    rounded = lambda value: None if value is None else round(value, 6)
    seconds = lambda value: round(value / 1000, 6)
    result = dict(
        schema_version=REPORT_SCHEMA,
        run_id=record['run_id'],
        backend=dict(
            target=record['target'],
            source_sha256=digest({k: v['sha256'] for k, v in record['hashes'].items()
                                 if k in ('backend', 'inference', 'preprocessing') or k.startswith('preprocessing_')}),
            model=dict(epoch=model.get('sourceEpoch') or model.get('bestEpoch'),
                state=model.get('exportedState'), vocabulary_size=model.get('vocabularySize'),
                channels=model.get('channels'), convolution_layers=model.get('convolutionLayers'),
                checkpoint_sha256=model.get('checkpointSha256'), task=model.get('task', 'single'),
                trained_samples=model.get('trainedSamples')),
            rules={k: v for k, v in record['settings'].items() if k != 'options'}),
        test=dict(dataset=record['dataset']['name'], sentences=q['cases'],
            workers=request['workers'], rounds=request['repeats'],
            warmup_per_worker=request['warmup_sentences_per_worker'], aggregation=request['aggregate'],
            required_breaks=[3], optional_breaks=[2], closing_quote_equivalence=True,
            f1_formula='2*precision*recall/(precision+recall)'),
        results=dict(sentence_accuracy=rounded(q['sentence_accuracy']), precision=rounded(precision),
                     recall=rounded(recall), f1=rounded(f1(precision, recall))),
        performance=dict(round_seconds=[seconds(v['batch_wall_ms']) for v in p['passes']],
            mean_seconds=seconds(p['batch_wall_ms']), startup_seconds=seconds(p['startup_wall_ms']),
            mean_sentences_per_second=rounded(p['sentences_per_second']),
            backend_compute_seconds=seconds(p['backend_total_ms']), model_compute_seconds=seconds(p['model_total_ms']),
            model_calls_per_round=p['model_calls'],
            sentence_latency_ms={k: rounded(v) for k, v in p['backend_sentence_ms'].items()}),
        environment={k: record['environment'][k] for k in ('cpu', 'node', 'icu', 'platform', 'arch')
                     if k in record['environment']})
    comparison = record['comparison']
    if comparison.get('baseline_run_id'):
        quality_names = {'sentence_accuracy': 'sentence_accuracy', 'cut_precision': 'precision', 'required_coverage': 'recall'}
        result['comparison'] = dict(
            baseline_run_id=comparison['baseline_run_id'], status=comparison['status'],
            quality_comparable=comparison['quality_comparable'],
            performance_comparable=comparison['performance_comparable'],
            performance_incompatibilities=comparison['performance_incompatibilities'],
            quality_delta_pp={quality_names[k]: rounded(v) for k, v in comparison['quality_delta_percentage_points'].items()},
            performance_delta_percent={k: rounded(v) for k, v in comparison['performance_delta_percent'].items()},
            regressions=comparison['regressions'])
    return result


def save_result(output, root, record, request):
    # Preserve exact identities and counts outside the concise report. No extra
    # formatted report: request.json is configuration; timings.json/cases.jsonl
    # remain the original measurements and per-sentence evidence.
    request['provenance'] = {k: record[k] for k in (
        'schema_version', 'run_id', 'target', 'created_at', 'dataset', 'scoring',
        'measurement', 'model_path', 'backend_path', 'hashes', 'quality', 'files')}
    request['provenance']['settings'] = record['settings']
    write(output/'request.json', request)
    summary = compact_report(record)
    write(output/'report.json', summary)
    pointer = dict(schema_version=REPORT_SCHEMA, run_id=record['run_id'],
        report=str((output/'report.json').relative_to(root)), report_sha256=sha(output/'report.json'),
        request_sha256=sha(output/'request.json'), timings_sha256=sha(output/'timings.json'))
    write(root/'latest.json', pointer)
    if record['baseline_updated']:
        write(root/'baseline.json', pointer)
    # Stable, directly consumable result path for people and scripts.
    write(root/'report.json', summary)
    return summary


def run(args, root):
    own_baseline, _ = load_baseline(root)
    baseline, baseline_cases = load_baseline(args.compare_to.resolve() if args.compare_to else root)
    if args.compare_to and baseline is None:
        raise ValueError('--compare-to must name an existing benchmark output directory with a pinned baseline')
    rows, dataset = prepare()
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    output = root / 'runs' / run_id
    output.mkdir(parents=True)
    backend = args.backend_dir.resolve() / 'chunker.js'
    inference = args.backend_dir.resolve() / 'inference.js'
    model = (args.model or ROOT / 'src/boundary-model-data.js').resolve()
    # All supported model tasks use the extension's dispatcher and decoders.
    # Alternate historical backends may still be a standalone chunker.js.
    preprocessing = [args.backend_dir.resolve()/name for name in
                     ('clauses.js', 'single-cut.js', 'multicut-input.js', 'multicut.js')]
    if not (args.backend_dir.resolve()/'single-cut.js').is_file():
        preprocessing = []
    checkpoint_sha = None
    if args.checkpoint:
        model = output/'model.js'
        print('Importing checkpoint for JS inference (outside measurement)...', file=sys.stderr, flush=True)
        checkpoint_sha = export_checkpoint(args.checkpoint.resolve(), model)
    elif args.model and args.backend_dir.resolve() != ROOT/'src/backend':
        task = subprocess.run(['node', '-e',
            'const fs=require("node:fs"),vm=require("node:vm"),c=vm.createContext({});'
            'vm.runInContext(fs.readFileSync(process.argv[1],"utf8"),c,{timeout:10000});'
            'console.log(c.HaoduBoundaryModelData?.task || "single")', str(model)],
            check=True, capture_output=True, text=True).stdout.strip()
        if task != 'single':
            raise ValueError('Multi-cut models use the shared main backend; omit --backend-dir')
    target = 'custom' if args.checkpoint or args.model or args.backend_dir.resolve() != ROOT/'src/backend' else 'public'
    bridge = HERE / 'benchmark_backend.cjs'
    files = dict(cases=CASES, source=CASES.with_name('source.json'), projection=HERE/'bznsyp_golden.py',
                 scoring=HERE/'golden_scoring.py', runner=Path(__file__), bridge=bridge,
                 backend=backend, inference=inference, model=model)
    if preprocessing:
        files.update({f'preprocessing_{i}': path for i, path in enumerate(preprocessing)})
        files['input_contract'] = HERE/'multicut-input-v20.json'
    if args.checkpoint:
        files['checkpoint'] = args.checkpoint.resolve()
        files['checkpoint_importer'] = HERE/'export_checkpoint.py'
    hashes = {key: dict(path=str(p.resolve()), sha256=sha(p)) for key, p in files.items()}
    if checkpoint_sha and hashes['checkpoint']['sha256'] != checkpoint_sha:
        raise ValueError('Checkpoint changed after import')
    request = dict(model=str(model), backend=str(backend), inference=str(inference),
        warmup=100, repeats=2, workers=args.workers, records=[dict(id=r['id'], raw=r['raw']) for r in rows],
        output=str(output/'timings.json'), progress=str(output/'progress.json'))
    if preprocessing:
        request['preprocessing'] = list(map(str, preprocessing))
    write(output/'request.json', request)
    print(f'BZNSYP: 10,000 sentences; target={target}; model={model}\n'
          f'Backend: {backend}\n{args.workers} workers; warmup 100 each; '
          f'2 sequential passes with fixed parallel shards; arithmetic mean; output: {output}', file=sys.stderr, flush=True)
    # subprocess.run terminates its child on interruption; completed reports only
    # are ever promoted to latest/baseline. fcntl releases the lock on exit.
    subprocess.run(['node', str(bridge), str(output/'request.json')], check=True)
    prediction = read(output/'timings.json')
    scored = score_outputs(rows, prediction)
    window = re.search(r'const MAX_MODEL_WINDOW_TOKENS\s*=\s*(\d+)\s*;', backend.read_text())
    if window:
        prediction['settings']['max_model_window_tokens'] = int(window.group(1))
    for key, info in hashes.items():
        if sha(info['path']) != info['sha256']:
            raise ValueError(f'Input changed during benchmark: {key}; no report/baseline promoted')
    cases_path = output / 'cases.jsonl'
    cases_path.write_text(''.join(json.dumps(r, ensure_ascii=False, allow_nan=False) + '\n' for r in scored), encoding='utf-8')
    report = dict(schema_version=SCHEMA, run_id=run_id, target=target,
        created_at=datetime.now(timezone.utc).isoformat(), dataset=dataset,
        scoring=dict(policy=SCORING_POLICY, sha256=hashes['scoring']['sha256'], description=SCORING_DESCRIPTION),
        measurement=dict(protocol=prediction['protocol'], bridge_sha256=hashes['bridge']['sha256'],
                         warmup_sentences=100 * args.workers, warmup_sentences_per_worker=100,
                         repeats=2, workers=args.workers, partition=prediction['partition'],
                         sequential_passes=True, aggregate='mean', prediction_cache=False),
        model_path=str(model), backend_path=str(backend), model=prediction['model'],
        settings=prediction['settings'], environment=prediction['environment'], hashes=hashes,
        quality=aggregate(scored), performance=prediction['performance'],
        files=dict(cases='cases.jsonl', cases_sha256=sha(cases_path), timings='timings.json'),
        baseline_updated=own_baseline is None or args.set_baseline)
    report['comparison'] = compare(report, baseline, args.slowdown_percent) if baseline else dict(status='baseline_created')
    if baseline and report['comparison']['quality_comparable']:
        report['comparison']['paired'] = paired_changes(scored, baseline_cases)
    save_result(output, root, report, request)
    write(output/'progress.json', dict(phase='complete', run_id=run_id, status=report['comparison']['status']))
    print(str(root/'report.json'), flush=True)
    if args.set_baseline or baseline is None:
        return 0
    return {'pass': 0, 'regression': 2, 'incomparable': 3}[report['comparison']['status']]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--model', type=Path, help='Explicit single/multi exported JS model')
    inputs.add_argument('--checkpoint', type=Path, help='Single/multi-cut checkpoint; imports FP32 model_state before timing')
    parser.add_argument('--backend-dir', type=Path, default=ROOT/'src/backend')
    parser.add_argument('--output', type=Path, help='Benchmark root; contains immutable runs and baseline/latest pointers')
    parser.add_argument('--compare-to', type=Path, help='Compare against another output directory\'s pinned baseline (read-only)')
    parser.add_argument('--workers', type=int, default=8, help='Fixed parallel process count, default 8; separate baseline per count')
    parser.add_argument('--set-baseline', action='store_true', help='Explicitly accept this successful run as the new baseline')
    parser.add_argument('--slowdown-percent', type=float, default=5,
                        help='Allowed relative slowdown in mean batch/backend/model time, default 5%%')
    args = parser.parse_args()
    if not math.isfinite(args.slowdown_percent) or args.slowdown_percent < 0:
        parser.error('--slowdown-percent must be finite and nonnegative')
    if not 1 <= args.workers <= 10000:
        parser.error('--workers must be between 1 and 10000')
    if args.checkpoint and args.backend_dir.resolve() != ROOT/'src/backend':
        parser.error('--checkpoint uses the shared main inference engine; omit --backend-dir')
    if (args.model or args.backend_dir.resolve() != ROOT/'src/backend') and not args.output:
        parser.error('Use --output with a custom model/backend to keep the bundled-model baseline separate')
    default_root = ROOT/'artifacts/backend-benchmark/public'/f'parallel-{args.workers}'
    if args.checkpoint:
        if not args.checkpoint.is_file():
            parser.error('Checkpoint file does not exist')
        default_root = ROOT/'artifacts/backend-benchmark/checkpoints'/sha(args.checkpoint)/f'parallel-{args.workers}'
    root = (args.output or default_root).resolve()
    if args.checkpoint and root == (ROOT/'artifacts/backend-benchmark/public'/f'parallel-{args.workers}').resolve():
        parser.error('Checkpoint output must be separate from the bundled-model baseline')
    root.mkdir(parents=True, exist_ok=True)
    with (root/'.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('A benchmark is already running in this output directory')
        try:
            return run(args, root)
        except (ValueError, OSError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
            print(f'Benchmark failed: {error}', file=sys.stderr)
            return 1


if __name__ == '__main__':
    sys.exit(main())
