import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from export_checkpoint import (DEPENDENCIES, HERE, export_checkpoint, input_contract,
                               selected_threshold, tensor_shapes)


class CheckpointContractTests(unittest.TestCase):
    def test_threshold_belongs_to_current_weights_not_historical_best(self):
        checkpoint = dict(progress=dict(epoch=1, seen_examples=100),
            validation_history=[dict(epoch=1, samples=100, validation=dict(threshold=.8))],
            best_metrics=dict(threshold=.95))
        self.assertEqual(selected_threshold(checkpoint), .8)
        checkpoint['progress']['seen_examples'] = 101
        with self.assertRaisesRegex(ValueError, 'exact model_state'):
            selected_threshold(checkpoint)
        self.assertEqual(selected_threshold(dict(selection=dict(threshold=.75))), .75)
        for value in (0, 1, float('nan'), None, True):
            with self.assertRaises(ValueError):
                selected_threshold(dict(selection=dict(threshold=value)))

    def test_policy_is_checked_not_silently_replaced_by_latest_rules(self):
        policy = json.loads((HERE/'multicut-input-v20.json').read_text())
        self.assertEqual(input_contract(policy), policy)
        policy['sample_filter'] = {'unused_training_gate':'not an inference rule'}
        self.assertNotIn('sample_filter', input_contract(policy))
        policy['proxy_punctuation'] = []
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            input_contract(policy)


try:
    sys.path.insert(0, str(DEPENDENCIES))
    import torch
except ImportError:
    torch = None


@unittest.skipIf(torch is None, 'Optional checkpoint importer dependency not installed')
class CheckpointIntegrationTests(unittest.TestCase):
    def checkpoint(self):
        # Tiny FP32 weights exercise the same exported tensor schema cheaply.
        shapes = tensor_shapes(4, 2, 1)
        state = {key: torch.zeros(shape) for key, shape in shapes.items()}
        state['boundary_output.bias'].fill_(2)
        return dict(task='multi', model_state=state, vocabulary={'<pad>':0,'<unk>':1,'甲':2,'乙':3},
            configuration=dict(channels=2,residual_blocks=1,input_maximum_characters=64,
                               model_execution_contract='masked-residual-convolutions-v1'),
            data_policy=json.loads((HERE/'multicut-input-v20.json').read_text()),
            progress=dict(epoch=1,seen_examples=100),
            validation_history=[dict(epoch=1,samples=100,validation=dict(threshold=.75))])

    def test_export_uses_exact_model_state_and_rejects_wrong_shapes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = self.checkpoint()
            source, output = root/'checkpoint.pt', root/'model.js'
            torch.save(checkpoint, source)
            digest = export_checkpoint(source, output)
            result = subprocess.run(['node','-e',
                'const m=require(process.argv[1]);console.log(JSON.stringify({hash:m.checkpointSha256,'
                'threshold:m.multiCut.threshold,task:m.task,state:m.exportedState}));',str(output)],
                capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(result.stdout),dict(hash=digest,threshold=.75,task='multi',state='model_state'))
            final = dict(checkpoint, selection=dict(threshold=.75,epoch=2),
                         best_position=dict(epoch=2,samples=500))
            final.pop('progress')
            torch.save(final,source)
            export_checkpoint(source,output)
            identity = subprocess.run(['node','-e',
                'const m=require(process.argv[1]);console.log(JSON.stringify([m.sourceEpoch,m.trainedSamples]));',
                str(output)],capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(identity.stdout),[2,500])
            checkpoint['model_state']['embedding.weight'] = torch.zeros(3,2)
            torch.save(checkpoint,source)
            with self.assertRaisesRegex(ValueError,'embedding.weight'):
                export_checkpoint(source,output)

    def test_long_inputs_use_exported_weights_shared_js_engine_and_standard_runner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root/'checkpoint.pt', root/'model.js'
            checkpoint = self.checkpoint()
            torch.save(checkpoint,source)
            export_checkpoint(source,output)
            lengths = [65,130,1,64]
            request = dict(model=str(output), inference=str(HERE.parent/'src/backend/inference.js'),
                backend=str(HERE/'multicut_backend.js'), preprocessing=[str(HERE/'multicut_input.js')],
                records=[dict(id=str(n),raw='甲'*n) for n in lengths],
                warmup=1,repeats=2,workers=2)
            script = ('const {runBenchmark}=require(process.argv[1]);'
                'runBenchmark(JSON.parse(process.argv[2])).then(r=>console.log(JSON.stringify(r)))'
                '.catch(e=>{console.error(e.message);process.exitCode=1;});')
            command = ['node','-e',script,str(HERE/'benchmark_backend.cjs'),json.dumps(request)]
            result = subprocess.run(command,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr)
            measured = json.loads(result.stdout)
            self.assertEqual(measured['settings']['long_input'],'advance from last predicted mappable cut')
            self.assertEqual(measured['settings']['nonfinal_window_without_cut'],'error')
            self.assertEqual(measured['settings']['final_window_without_cut'],'accept')
            for row, length, calls, tokens in zip(measured['rows'],lengths,[2,3,0,1],[66,132,0,64]):
                self.assertEqual(row['cuts'],list(range(1,length)))
                self.assertEqual(row['model_calls'],[calls,calls])
                self.assertEqual(row['model_tokens'],[tokens,tokens])
            self.assertEqual([p['model_calls'] for p in measured['performance']['passes']],[6,6])
            self.assertGreater(measured['performance']['model_total_ms'],0)

            # Actual network output below threshold must propagate an error,
            # rather than turning an unprocessed long input into a zero-cut answer.
            checkpoint['model_state']['boundary_output.bias'].fill_(-2)
            torch.save(checkpoint,source)
            export_checkpoint(source,output)
            failed = subprocess.run(command,capture_output=True,text=True,timeout=30)
            self.assertEqual(failed.returncode,1)
            self.assertIn('no valid cut',failed.stderr)
            self.assertEqual(failed.stdout,'')

    def test_full_command_auto_selects_multi_and_writes_standard_report(self):
        from bznsyp_golden import CASES
        if not CASES.is_file():
            self.skipTest('Install official corpus for CLI integration check')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root/'checkpoint.pt'
            torch.save(self.checkpoint(), source)
            command = [sys.executable,str(HERE/'benchmark_backend.py'),'--checkpoint',str(source),
                       '--output',str(root/'results')]
            result = subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            report = json.loads((root/'results/report.json').read_text())
            self.assertEqual(report['test']['sentences'],10000)
            self.assertEqual(report['test']['rounds'],2)
            self.assertEqual(report['test']['workers'],8)
            self.assertEqual(report['backend']['model']['task'],'multi')
            self.assertEqual(report['backend']['model']['trained_samples'],100)
            self.assertFalse(report['backend']['rules']['recursion'])
            self.assertEqual(report['performance']['model_calls_per_round'],10000)
            exported = next((root/'results/runs').glob('*/model.js'))
            # The portable export runs with the same command and engine.
            again = subprocess.run([sys.executable,str(HERE/'benchmark_backend.py'),'--model',str(exported),
                                    '--output',str(root/'exported')],capture_output=True,text=True)
            self.assertEqual(again.returncode,0,again.stderr)
            other = json.loads((root/'exported/report.json').read_text())
            self.assertEqual(report['results'],other['results'])
            pinned = (root/'results/baseline.json').read_bytes()
            compared = subprocess.run([sys.executable,str(HERE/'benchmark_backend.py'),'--model',str(exported),
                                       '--output',str(root/'compared'),'--compare-to',str(root/'results')],
                                      capture_output=True,text=True)
            self.assertIn(compared.returncode,(0,2),compared.stderr)
            comparison = json.loads((root/'compared/report.json').read_text())['comparison']
            self.assertTrue(comparison['quality_comparable'])
            self.assertTrue(comparison['performance_comparable'])
            self.assertEqual(comparison['quality_delta_pp'],dict(sentence_accuracy=0,precision=0,recall=0))
            self.assertEqual((root/'results/baseline.json').read_bytes(),pinned)


if __name__ == '__main__':
    unittest.main()
