import json
import csv
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from benchmark_backend import (SCHEMA, REPORT_SCHEMA, prepare, compare, score_outputs, load_baseline,
                               write, sha, paired_changes, f1)
from bznsyp_golden import CASES, project


def report():
    return dict(schema_version=SCHEMA, run_id='test',
        dataset=dict(cases_sha256='csv', projected_sha256='projected', projection='v1', cases=10000),
        scoring=dict(policy='v1', sha256='score'), environment=dict(node='v25', cpu='test'),
        measurement=dict(protocol='v1', repeats=3),
        quality=dict(sentence_accuracy=.6, cut_precision=.9, required_coverage=.7),
        performance=dict(batch_wall_ms=30, backend_total_ms=100, model_total_ms=90))


class BackendBenchmarkTests(unittest.TestCase):
    def test_requested_f1_is_the_harmonic_mean_with_defined_empty_behavior(self):
        self.assertAlmostEqual(f1(.8, .6), 2 * .8 * .6 / 1.4)
        self.assertEqual(f1(0, 0), 0)
        self.assertEqual(f1(0, .6), 0)
        self.assertIsNone(f1(None, .6))
        self.assertIsNone(f1(.8, None))

    @unittest.skipUnless(CASES.is_file(), 'Install the official corpus for the full-source integration check')
    def test_full_source_includes_short_long_incompatible_and_known_error(self):
        rows, identity = prepare()
        self.assertEqual(len(rows), 10000)
        self.assertFalse(identity['eligibility_filter'])
        self.assertEqual(identity['excluded_ids'], [])
        self.assertIn('003892', [r['id'] for r in rows])
        self.assertTrue(any(r['precheck_reasons'] for r in rows))
        self.assertEqual(identity, prepare()[1])

    def test_scoring_reuses_required_optional_quote_policy(self):
        row = dict(id='1', source='test', **project('甲乙#2丙“丁#3”戊己。'))
        output = dict(id='1', cuts=[2, 6], backend_ms=[1], model_ms=[.9], model_calls=[1], model_tokens=[8])
        result = score_outputs([row], dict(rows=[output]))[0]
        self.assertTrue(result['complete'])
        self.assertEqual(result['optional_hits'], 1)
        self.assertTrue(result['matches'][1]['quote_equivalent'])
        with self.assertRaisesRegex(ValueError, 'coverage'):
            score_outputs([row], dict(rows=[]))

    def test_quality_regression_cannot_be_hidden_by_speed_improvement(self):
        baseline, current = report(), report()
        current['quality']['sentence_accuracy'] -= .0001
        current['performance']['model_total_ms'] = 50
        result = compare(current, baseline)
        self.assertEqual(result['status'], 'regression')
        self.assertAlmostEqual(result['quality_delta_percentage_points']['sentence_accuracy'], -.01)
        self.assertEqual(result['regressions'], ['quality.sentence_accuracy'])

    def test_speed_noise_tolerance_and_equal_scores(self):
        baseline, current = report(), report()
        current['performance']['backend_total_ms'] = 104
        self.assertEqual(compare(current, baseline)['status'], 'pass')
        current['performance']['backend_total_ms'] = 106
        self.assertEqual(compare(current, baseline)['regressions'], ['performance.backend_total_ms'])

    def test_environment_or_measurement_drift_blocks_speed_claims(self):
        for key in ('environment', 'measurement'):
            baseline, current = report(), report()
            current[key] = {}
            result = compare(current, baseline)
            self.assertEqual(result['status'], 'incomparable')
            self.assertTrue(result['quality_comparable'])
            self.assertFalse(result['performance_comparable'])
            self.assertEqual(result['performance_delta_percent'], {})

    def test_batch_wall_time_regression_is_detected(self):
        baseline, current = report(), report()
        current['performance']['batch_wall_ms'] = 32
        self.assertIn('performance.batch_wall_ms', compare(current, baseline)['regressions'])

    def test_worker_count_change_blocks_speed_comparison(self):
        baseline, current = report(), report()
        baseline['measurement']['workers'] = 4
        current['measurement']['workers'] = 2
        result = compare(current, baseline)
        self.assertTrue(result['quality_comparable'])
        self.assertFalse(result['performance_comparable'])

    def test_old_baselines_remain_quality_comparable(self):
        for schema in ('haodu-backend-benchmark-v1', 'haodu-backend-benchmark-v2'):
            baseline, current = report(), report()
            baseline['schema_version'] = schema
            if schema.endswith('v1'):
                del baseline['performance']['batch_wall_ms']
            result = compare(current, baseline)
            self.assertTrue(result['quality_comparable'])
            self.assertFalse(result['performance_comparable'])
            self.assertEqual(result['performance_delta_percent'], {})

    def test_dataset_or_scoring_changes_block_quality_comparison(self):
        for key in ('dataset', 'scoring'):
            baseline, current = report(), report()
            current[key]['cases' if key == 'dataset' else 'policy'] = 'changed'
            result = compare(current, baseline)
            self.assertFalse(result['quality_comparable'])
            self.assertEqual(result['status'], 'incomparable')

    def test_undefined_precision_is_a_regression_from_defined_precision(self):
        baseline, current = report(), report()
        current['quality']['cut_precision'] = None
        self.assertIn('quality.cut_precision', compare(current, baseline)['regressions'])

    def test_baseline_pointer_and_sentence_results_are_integrity_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(load_baseline(root), (None, None))
            rows = [dict(id='a', complete=False, cuts=[])]
            cases = root/'cases.jsonl'
            cases.write_text(json.dumps(rows[0])+'\n')
            data = report()
            data['files'] = dict(cases_sha256=sha(cases))
            write(root/'report.json', data)
            write(root/'baseline.json', dict(report='report.json', report_sha256=sha(root/'report.json')))
            self.assertEqual(load_baseline(root)[0], data)
            self.assertEqual(paired_changes([dict(id='a', complete=True, cuts=[1])], cases),
                             dict(changed_sentences=1, wrong_to_complete=1, complete_to_wrong=0))
            cases.write_text('{}\n')
            with self.assertRaisesRegex(ValueError, 'sentence results changed'):
                load_baseline(root)

    @unittest.skipUnless(CASES.is_file(), 'Install the official corpus for the full-source CLI integration check')
    def test_cli_keeps_baseline_on_regression_and_failure(self):
        # Exercise the real one-command pipeline on all original IDs, with a
        # lightweight backend so this test does not benchmark the large model.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = root/'model.js'
            model.write_text('globalThis.HaoduBoundaryModelData={};')
            (root/'inference.js').write_text('globalThis.HaoduModelBackend={'
                'getModelInfo:()=>({}), scoreTokens:()=>[]};')
            backend = root/'chunker.js'
            backend.write_text('globalThis.HaoduChunker={process: texts=>texts.map(()=>[])};')
            output = root/'output'
            command = [sys.executable, str(Path(__file__).with_name('benchmark_backend.py')),
                       '--model', str(model), '--backend-dir', str(root), '--output', str(output)]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            pinned = (output/'baseline.json').read_bytes()
            first_report, _ = load_baseline(output)
            summary = json.loads((output/'report.json').read_text())
            self.assertEqual(summary['schema_version'], REPORT_SCHEMA)
            self.assertEqual(set(summary), {'schema_version', 'run_id', 'backend', 'test', 'results', 'performance', 'environment'})
            self.assertEqual(set(summary['results']), {'sentence_accuracy', 'precision', 'recall', 'f1'})
            self.assertEqual(summary['test']['sentences'], 10000)
            self.assertEqual(summary['test']['rounds'], 2)
            self.assertEqual(summary['test']['workers'], 8)
            self.assertFalse(list(output.rglob('report.md')))
            self.assertEqual(Path(first.stdout.strip()), (output/'report.json').resolve())
            self.assertEqual(first_report['quality']['cases'], 10000)
            self.assertEqual(first_report['performance']['measured_sentences'], 20000)
            self.assertEqual(first_report['measurement']['workers'], 8)
            self.assertEqual(first_report['measurement']['repeats'], 2)
            self.assertEqual(first_report['measurement']['aggregate'], 'mean')
            self.assertEqual(first_report['performance']['warmup_sentences'], 800)
            self.assertEqual(first_report['performance']['batch_wall_ms'],
                             sum(p['batch_wall_ms'] for p in first_report['performance']['passes']) / 2)
            backend.write_text('globalThis.HaoduChunker={process: texts=>texts.map(t=>{'
                               'let n=0;return Array.from(t).slice(0,-1).map(ch=>n+=ch.length)})};')
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 2, second.stderr)
            self.assertEqual((output/'baseline.json').read_bytes(), pinned)
            latest = json.loads((output/'latest.json').read_text())
            latest_report = json.loads((output/latest['report']).read_text())
            self.assertEqual(latest_report['comparison']['status'], 'regression')
            self.assertLess(latest_report['results']['sentence_accuracy'], first_report['quality']['sentence_accuracy'])
            latest_bytes = (output/'latest.json').read_bytes()
            backend.write_text('throw Error("broken runtime");')
            failed = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(failed.returncode, 1)
            self.assertEqual((output/'latest.json').read_bytes(), latest_bytes)
            self.assertEqual((output/'baseline.json').read_bytes(), pinned)
            backend.write_text('globalThis.HaoduChunker={process: texts=>texts.map(()=>[])};')
            accepted = subprocess.run(command+['--set-baseline'], capture_output=True, text=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertNotEqual((output/'baseline.json').read_bytes(), pinned)
            reference = json.loads((output/'baseline.json').read_text())
            request_path = (output/reference['report']).parent/'request.json'
            request_path.write_text('{}\n')
            with self.assertRaisesRegex(ValueError, 'request changed'):
                load_baseline(output)

    def test_default_command_runs_from_an_isolated_main_checkout(self):
        # No sibling training checkout, Python packages, or canonical manifest.
        # Synthetic fixtures exercise plumbing, never replace the real corpus.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'runtime'
            scripts = root / 'benchmark'
            scripts.mkdir(parents=True)
            for source in Path(__file__).parent.iterdir():
                if source.suffix in ('.py', '.cjs'):
                    shutil.copy2(source, scripts / source.name)
            golden = scripts / 'golden'
            golden.mkdir()
            cases = golden / 'cases.csv'
            with cases.open('w', encoding='utf-8', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(['text', 'source'])
                for n in range(1, 10001):
                    writer.writerow(['甲乙。', f'BZNSYP/ProsodyLabeling/000001-010000.txt:{2*n-1};id={n:06}'])
            write(golden/'source.json', dict(cases_sha256=sha(cases)))
            backend = root/'src/backend'
            backend.mkdir(parents=True)
            (root/'src/boundary-model-data.js').write_text('globalThis.HaoduBoundaryModelData={};')
            (backend/'inference.js').write_text('globalThis.HaoduModelBackend={getModelInfo:()=>({}),scoreTokens:()=>[]};')
            (backend/'chunker.js').write_text('globalThis.HaoduChunker={process:texts=>texts.map(()=>[])};')
            command = [sys.executable, str(scripts/'benchmark_backend.py')]
            result = subprocess.run(command, cwd=temp, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = root/'artifacts/backend-benchmark/public/parallel-8'
            self.assertEqual(Path(result.stdout.strip()), (output/'report.json').resolve())
            summary = json.loads((output/'report.json').read_text())
            self.assertEqual(summary['backend']['target'], 'public')
            self.assertEqual(summary['test']['sentences'], 10000)
            self.assertEqual(summary['test']['workers'], 8)
            self.assertEqual(summary['test']['rounds'], 2)
            record, _ = load_baseline(output)
            self.assertEqual(Path(record['model_path']), (root/'src/boundary-model-data.js').resolve())
            self.assertEqual(Path(record['backend_path']), (backend/'chunker.js').resolve())
            pinned = (output/'baseline.json').read_bytes()
            cases.unlink()
            missing = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(missing.returncode, 1)
            self.assertIn('npm run golden:import', missing.stderr)
            self.assertEqual((output/'baseline.json').read_bytes(), pinned)

    def test_custom_model_requires_a_separate_output(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('benchmark_backend.py')),
                                 '--model', '/unused/export.js'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Use --output', result.stderr)

    def test_legacy_absolute_baseline_is_resolved_after_relocation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            artifacts = root/'artifacts/backend-benchmark'
            run = artifacts/'current/runs/example'
            run.mkdir(parents=True)
            (run/'cases.jsonl').write_text('{}\n')
            record = report()
            record['files'] = dict(cases_sha256=sha(run/'cases.jsonl'))
            write(run/'report.json', record)
            comparison = artifacts/'release-comparison'
            comparison.mkdir()
            write(comparison/'baseline.json', dict(
                report='/old/checkout/training/artifacts/backend-benchmark/current/runs/example/report.json',
                report_sha256=sha(run/'report.json')))
            pointer = (comparison/'baseline.json').read_bytes()
            with patch('benchmark_backend.ROOT', root):
                self.assertEqual(load_baseline(comparison)[0], record)
            self.assertEqual((comparison/'baseline.json').read_bytes(), pointer)


if __name__ == '__main__':
    unittest.main()
