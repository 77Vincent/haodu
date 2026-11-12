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

    def test_single_export_needs_no_sigmoid_threshold_and_matches_pytorch_logits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root/'checkpoint.pt', root/'model.js'
            checkpoint = self.checkpoint()
            checkpoint['task'] = checkpoint['configuration']['task'] = 'single'
            checkpoint.pop('validation_history')
            generator = torch.Generator().manual_seed(42)
            state = {key: torch.randn(value.shape, generator=generator) * .2
                     for key, value in checkpoint['model_state'].items()}
            checkpoint['model_state'] = state
            # Export the supplied weights even when a different historical best exists.
            checkpoint['best_state'] = {key: torch.zeros_like(value) for key, value in state.items()}
            tokens = ['甲', '乙', '甲', '丙', '乙']
            hidden = state['embedding.weight'][torch.tensor([[2,3,2,1,3]])]
            prefix = 'blocks.0.'
            norm = torch.nn.functional.layer_norm(hidden, (2,), state[prefix+'normalization.weight'],
                                                   state[prefix+'normalization.bias'])
            first = torch.nn.functional.gelu(torch.nn.functional.conv1d(norm.transpose(1,2),
                state[prefix+'first.weight'], state[prefix+'first.bias'], padding=1).transpose(1,2),
                approximate='tanh')
            second = torch.nn.functional.conv1d(first.transpose(1,2), state[prefix+'second.weight'],
                state[prefix+'second.bias'], padding=1).transpose(1,2)
            hidden = hidden + state[prefix+'residual_scale'] * second
            left, right = hidden[:,:-1], hidden[:,1:]
            features = torch.cat((left, right, right-left, right*left), dim=-1)
            gaps = torch.nn.functional.gelu(torch.nn.functional.linear(features,
                state['boundary_hidden.weight'], state['boundary_hidden.bias']), approximate='tanh')
            expected = torch.nn.functional.linear(gaps, state['boundary_output.weight'],
                state['boundary_output.bias']).flatten().tolist()
            torch.save(checkpoint, source)
            export_checkpoint(source, output)
            script = ('const fs=require("node:fs"),vm=require("node:vm"),c=vm.createContext({atob});'
                      'for(const p of process.argv.slice(1,3))vm.runInContext(fs.readFileSync(p,"utf8"),c);'
                      'console.log(JSON.stringify({task:c.HaoduBoundaryModelData.task,'
                      'multiCut:c.HaoduBoundaryModelData.multiCut??null,'
                      'scores:c.HaoduModelBackend.scoreTokens(JSON.parse(process.argv[3]))}));')
            result = subprocess.run(['node','-e',script,str(output),str(HERE.parent/'src/backend/inference.js'),
                                     json.dumps(tokens)],capture_output=True,text=True,check=True)
            actual = json.loads(result.stdout)
            self.assertEqual(actual['task'], 'single')
            self.assertIsNone(actual['multiCut'])
            torch.testing.assert_close(torch.tensor(actual['scores']), torch.tensor(expected), rtol=1e-5, atol=1e-6)
            for bad_task in ('unknown', None):
                checkpoint['task'] = bad_task
                torch.save(checkpoint, source)
                with self.assertRaisesRegex(ValueError, 'explicit single or multi'):
                    export_checkpoint(source, output)
            checkpoint['task'] = 'multi'
            torch.save(checkpoint, source)
            with self.assertRaisesRegex(ValueError, 'task disagrees'):
                export_checkpoint(source, output)

    def test_single_checkpoint_uses_recursive_backend_rules_in_standard_runner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root/'checkpoint.pt', root/'model.js'
            checkpoint = self.checkpoint()
            checkpoint['task'] = 'single'
            checkpoint.pop('validation_history')
            state = checkpoint['model_state']
            # High logit after 乙. Two equally strong candidates each have
            # softmax near 0.5, so the second is visited by fresh child inference.
            state['embedding.weight'][3,0] = 1
            state['boundary_hidden.weight'][0,0] = 10
            state['boundary_output.weight'][0,0] = 1
            state['boundary_output.bias'].zero_()
            torch.save(checkpoint, source)
            export_checkpoint(source, output)
            clause = '甲'*6+'乙'+'甲'*6
            texts = [clause, clause[:-1], clause[:-2], '甲'*6+'乙'+'甲'*12+'乙'+'甲'*6,
                     clause+'，'+clause, '甲'*13, 'English only']
            request = dict(model=str(output), inference=str(HERE.parent/'src/backend/inference.js'),
                backend=str(HERE.parent/'src/backend/chunker.js'),
                preprocessing=[str(HERE.parent/'src/backend'/name) for name in
                               ('clauses.js','single-cut.js','multicut-input.js','multicut.js')],
                records=[dict(id=str(i),raw=text) for i,text in enumerate(texts)],
                warmup=1,repeats=2,workers=2)
            script = ('const {runBenchmark}=require(process.argv[1]);'
                      'runBenchmark(JSON.parse(process.argv[2])).then(r=>console.log(JSON.stringify(r)))'
                      '.catch(e=>{console.error(e);process.exitCode=1;});')
            result = subprocess.run(['node','-e',script,str(HERE/'benchmark_backend.cjs'),json.dumps(request)],
                                    capture_output=True,text=True,check=True,timeout=30)
            measured = json.loads(result.stdout)
            self.assertEqual(measured['model']['task'], 'single')
            self.assertEqual(measured['settings']['min_visual_length'], 13)
            self.assertEqual(measured['settings']['min_confidence'], .45)
            self.assertEqual(measured['settings']['max_model_window_tokens'], 256)
            self.assertTrue(measured['settings']['recursion'])
            for row,cuts,calls in zip(measured['rows'], [[7],[],[],[7,20],[7,21],[],[]], [1,0,0,3,2,1,0]):
                self.assertEqual(row['cuts'], cuts)
                self.assertEqual(row['model_calls'], [calls,calls])

    def test_full_command_auto_selects_single_and_writes_standard_report(self):
        from bznsyp_golden import CASES
        if not CASES.is_file():
            self.skipTest('Install official corpus for CLI integration check')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = self.checkpoint()
            checkpoint['task'] = 'single'
            checkpoint.pop('validation_history')
            source = root/'checkpoint.pt'
            torch.save(checkpoint, source)
            result = subprocess.run([sys.executable,str(HERE/'benchmark_backend.py'),'--checkpoint',str(source),
                                     '--output',str(root/'results')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            report = json.loads((root/'results/report.json').read_text())
            self.assertEqual(report['test']['sentences'],10000)
            self.assertEqual(report['test']['rounds'],2)
            self.assertEqual(report['test']['workers'],8)
            self.assertEqual(report['backend']['model']['task'],'single')
            self.assertEqual(report['backend']['model']['trained_samples'],100)
            self.assertEqual(report['backend']['rules']['min_visual_length'],13)
            self.assertEqual(report['backend']['rules']['min_confidence'],.45)
            self.assertTrue(report['backend']['rules']['recursion'])
            self.assertEqual(set(report['results']), {'sentence_accuracy','precision','recall','f1'})

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
                backend=str(HERE.parent/'src/backend/chunker.js'),
                preprocessing=[str(HERE.parent/'src/backend'/name) for name in
                               ('clauses.js', 'single-cut.js','multicut-input.js','multicut.js')],
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
            self.assertEqual(report['backend']['rules']['presegmentation'],'shared natural clauses')
            self.assertEqual(report['backend']['rules']['window_scope'],'clause')
            # The fixed corpus contains multiple natural clauses in some rows.
            self.assertEqual(report['performance']['model_calls_per_round'],10180)
            from benchmark_backend import load_baseline, compact_report
            record, _ = load_baseline(root/'results')
            record['comparison'] = {}
            self.assertEqual(compact_report(record)['backend']['source_sha256'],report['backend']['source_sha256'])
            record['hashes']['preprocessing_0']['sha256'] = 'changed-clause-policy'
            self.assertNotEqual(compact_report(record)['backend']['source_sha256'],report['backend']['source_sha256'])
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
