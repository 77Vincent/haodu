from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import evaluate_golden
from bznsyp_golden import (BACKEND, ELIGIBILITY_POLICY, SCORING_POLICY,
                          project, parse_labels, mark, score, audit)


class BznsypGoldenTests(unittest.TestCase):
    def test_proxy_removal_preserves_quote_side_and_unicode_offsets(self):
        row = project('甲😀#2，乙“丙#3”，丁。')
        self.assertEqual(row['raw'], '甲😀乙“丙”，丁。')
        self.assertEqual(row['optional'], [3])  # astral character occupies two UTF-16 units
        self.assertEqual(row['required'], [6])  # before right quote, not after it
        self.assertEqual(row['expected'], '甲😀乙“丙｜”，丁。')
        self.assertEqual(row['removed'], [dict(index=2, character='，')])

    def test_hiding_proxy_on_either_side_does_not_hide_other_punctuation(self):
        row = project('甲，#2；乙#3。！丙。')
        self.assertEqual(row['raw'], '甲乙丙。')
        self.assertEqual(row['optional'], [1])
        self.assertEqual(row['required'], [2])
        self.assertEqual(mark(row['raw'], row['required']+row['optional']), '甲｜乙｜丙。')

    def test_collapsed_or_edge_required_labels_are_rejected(self):
        self.assertIn('collapsed_required_boundaries',project('甲#3，#3乙')['precheck_reasons'])
        self.assertIn('required_boundary_at_edge',project('甲乙#3。')['precheck_reasons'])
        self.assertIn('collapsed_annotated_boundaries',project('甲#2，#3乙')['precheck_reasons'])
        with self.assertRaises(ValueError):
            parse_labels('甲#5乙')
        with self.assertRaises(ValueError):
            parse_labels('甲｜乙')


    def test_evaluator_scores_actual_predictions_with_quote_equivalence(self):
        source = dict(id='quote', **project('趁此机会#2“每日电讯报#3”盘点了类似糗事。'))
        predicted = [source['required'][0]+1]
        environment = dict(node='test', icu='test')
        plan = dict(dataset='test', eligibility_policy=ELIGIBILITY_POLICY, total=1,
                    thresholds=[14], cohorts={'14':['quote']}, common=['quote'],
                    backend=str(BACKEND), records=[source], hashes={}, environment=environment)
        prediction = dict(environment=environment, model={'bestEpoch':6},
                          results={'14':[dict(id='quote', cuts=predicted)]})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, model, inference = root/'prepared.json', root/'model.js', root/'inference.js'
            prepared.write_text(json.dumps(plan))
            model.write_text('test model')
            inference.write_text('test inference')
            output = root/'output'
            argv = ['evaluate_golden.py', '--prepared', str(prepared), '--model', str(model),
                    '--inference', str(inference), '--output', str(output)]
            process = subprocess.CompletedProcess([], 0, stdout=json.dumps(prediction))
            with patch('sys.argv', argv), patch.object(evaluate_golden.subprocess, 'run', return_value=process), redirect_stdout(io.StringIO()):
                evaluate_golden.main()
            report = json.loads((output/'report.json').read_text())
            self.assertEqual(report['scoring_policy'], SCORING_POLICY)
            result = report['groups']['14']['results'][0]
            self.assertTrue(result['complete'])
            self.assertEqual(result['required'], source['required'])
            self.assertEqual(result['cuts'], predicted)
            self.assertTrue(result['matches'][0]['quote_equivalent'])
            self.assertEqual(report['groups']['14']['common_metrics']['required_misses'], 0)
            self.assertIn('Incorrect cut rate', (output/'report.md').read_text())

    def test_real_backend_profiles_and_known_error_exclusion(self):
        rows = [dict(id='ok', **project('甲乙丙丁戊己#3庚辛壬癸天地。')),
                dict(id='excluded', **project('甲乙丙丁戊己#3庚辛壬癸天地呀。'))]
        audit(rows, BACKEND, exclusions={'excluded':'reviewed bad label'})
        self.assertTrue(rows[0]['thresholds']['12']['selected'])
        self.assertFalse(rows[0]['thresholds']['13']['selected'])
        for threshold in ('12','13'):
            self.assertTrue(rows[1]['thresholds'][threshold]['mechanical'])
            self.assertFalse(rows[1]['thresholds'][threshold]['selected'])
            self.assertIn('known_annotation_error',rows[1]['thresholds'][threshold]['reasons'])

    def test_full_annotation_recursion_excludes_mexico(self):
        rows = [dict(id='original', **project('墨西哥#2一五二一年#3沦为#2西班牙#2殖民地。')),
                dict(id='simplified', **project('墨西哥#2一五二一年#3沦为西班牙殖民地。'))]
        audit(rows, BACKEND, thresholds=range(9,17))
        for n in range(9,17):
            self.assertFalse(rows[0]['thresholds'][str(n)]['selected'])
            self.assertIn('infeasible_annotated_recursion',rows[0]['thresholds'][str(n)]['reasons'])
        self.assertTrue(rows[1]['thresholds']['13']['selected'])
        self.assertFalse(rows[1]['thresholds']['14']['selected'])

    def test_optional_boundaries_obey_guards_and_define_final_fragments(self):
        rows = [dict(id='optional', **project('甲乙丙丁戊己庚#2辛壬癸天地玄黄。')),
                dict(id='title', **project('甲乙丙丁戊己庚辛壬癸《甲》#2乙丙丁戊。'))]
        audit(rows, BACKEND, thresholds=[14])
        # The complete answer is 7+7 even though #3 alone would leave 14.
        self.assertTrue(rows[0]['thresholds']['14']['selected'])
        self.assertTrue(score([], rows[0]['optional'], [])['complete'])
        self.assertFalse(rows[1]['thresholds']['14']['selected'])
        self.assertIn('invalid_annotated_gap',rows[1]['thresholds']['14']['reasons'])

    def test_bridge_thresholds_are_isolated_and_do_not_edit_backend(self):
        before = BACKEND.read_bytes()
        with tempfile.TemporaryDirectory() as temp:
            model, inference = Path(temp)/'model.js',Path(temp)/'inference.js'
            model.write_text('globalThis.HaoduBoundaryModelData={bestEpoch:0,format:"test",checkpointSha256:"test"};')
            inference.write_text('globalThis.HaoduModelBackend={getModelInfo:()=>({inputRepresentation:"unicode-context-v1"}),scoreTokens:t=>Array.from({length:t.length-1},(_,i)=>i===7?20:-20)};')
            thresholds = list(range(9,17))
            records = [dict(id=str(n), raw='甲乙丙丁戊己庚辛壬癸天地玄黄宇宙'[:n]+'。') for n in range(8,17)]
            request=dict(backend=str(BACKEND),model=str(model),inference=str(inference),thresholds=thresholds,
                cohorts={str(n):[r['id'] for r in records] for n in thresholds},records=records,confidence=.45)
            report=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('golden_bridge.cjs'))],
                input=json.dumps(request),text=True))
        for minimum in thresholds:
            for row in report['results'][str(minimum)]:
                with self.subTest(minimum=minimum,length=row['id']):
                    self.assertEqual(row['cuts'], [8] if int(row['id']) >= minimum else [])
        self.assertEqual(BACKEND.read_bytes(),before)


if __name__ == '__main__':
    unittest.main()
