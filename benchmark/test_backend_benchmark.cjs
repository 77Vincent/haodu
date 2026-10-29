const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBenchmark, validateCuts, mean, distribution } = require('./benchmark_backend.cjs');

function fixture(t, backend) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haodu-benchmark-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = { model: path.join(dir, 'model.js'), inference: path.join(dir, 'inference.js'),
    backend: path.join(dir, 'chunker.js') };
  fs.writeFileSync(files.model, 'globalThis.HaoduBoundaryModelData={format:"test"};');
  fs.writeFileSync(files.inference, `globalThis.calls=0; globalThis.HaoduModelBackend=Object.freeze({
    getModelInfo:()=>({inputRepresentation:'unicode-context-v1'}),
    scoreTokens:tokens=>{calls++;return [calls];}});`);
  fs.writeFileSync(files.backend, backend || `
    const MIN_SPLIT_VISUAL_LENGTH = 13;
    const MIN_SPLIT_CONFIDENCE = 0.45;
    globalThis.HaoduChunker = {process: texts => texts.map(text => {
      // Every call must execute the actual model, including repeat inputs.
      const result = HaoduModelBackend.scoreTokens(Array.from(text));
      if(result[0] !== calls) throw Error('cached prediction');
      return text.length > 1 ? [1] : [];
    })};`);
  return { ...files, records: [{ id: 'a', raw: '甲乙' }, { id: 'b', raw: '丙丁' }],
    warmup: 3, repeats: 2, workers: 2 };
}

test('real API receives defaults; warmup and repeats do not bypass model calls', async t => {
  const input = fixture(t);
  const before = fs.readFileSync(input.backend, 'utf8');
  const result = await runBenchmark(input);
  assert.equal(fs.readFileSync(input.backend, 'utf8'), before);
  assert.deepEqual(result.settings, { min_visual_length: 13, min_confidence: .45, options: 'backend defaults' });
  assert.equal(result.performance.measured_sentences, 4);
  assert.equal(result.performance.warmup_sentences, 6);
  assert.equal(result.performance.warmup_sentences_per_worker, 3);
  assert.deepEqual(result.performance.passes.map(p => p.model_calls), [2, 2]);
  assert.deepEqual(result.performance.passes.map(p => p.model_tokens), [4, 4]);
  assert.deepEqual(result.rows.map(r => r.cuts), [[1], [1]]);
  assert.ok(result.rows.every(r => r.backend_ms.length === 2 && r.model_calls.every(n => n === 1)));
  assert.ok(result.performance.backend_total_ms >= result.performance.model_total_ms);
  assert.equal(result.workers, 2);
  for (const pass of result.performance.passes) {
    assert.equal(pass.workers.length, 2);
    assert.equal(pass.backend_total_ms, pass.workers.reduce((s, w) => s + w.backend_total_ms, 0));
    assert.equal(pass.model_total_ms, pass.workers.reduce((s, w) => s + w.model_total_ms, 0));
    assert.equal(pass.sentences_per_second, 2000 / pass.batch_wall_ms);
  }
});

test('repeated passes detect nondeterministic predictions', async t => {
  const input = fixture(t, `globalThis.n=0; globalThis.HaoduChunker={process:()=>[++n > 4 ? [] : [1]]};`);
  await assert.rejects(runBenchmark(input), /Nondeterministic/);
});

test('invalid offsets cannot silently become valid scores', () => {
  validateCuts('甲😀乙', [1, 3]);
  for (const cuts of [[0], [4], [2], [1, 1], [3, 1], [-1], [1.5]]) {
    assert.throws(() => validateCuts('甲😀乙', cuts));
  }
});

test('speed statistics use measured values and nearest-rank percentiles', () => {
  assert.equal(mean([100, 1, 3]), 104 / 3);
  assert.equal(mean([1, 5, 2, 4]), 3);
  assert.throws(() => mean([]));
  assert.deepEqual(distribution([1, 2, 3, 100]), { mean: 26.5, p50: 2, p95: 100, p99: 100 });
});

test('corpus IDs are checked before inference', async t => {
  const input = fixture(t);
  input.records[1].id = 'a';
  await assert.rejects(runBenchmark(input));
});

test('a stale canonical export is rejected before warmup', async t => {
  const input = fixture(t);
  input.expected_model = { checkpoint_sha256: 'current-checkpoint', vocabulary_size: 16384 };
  await assert.rejects(runBenchmark(input), /Current export does not match/);
});

test('fixed shards preserve coverage/order and serial answers across three passes', async t => {
  const input = fixture(t);
  input.records = Array.from({length: 11}, (_, i) => ({id: String(i), raw: i % 2 ? '甲' : '甲乙'}));
  input.repeats = 3;
  const parallel = await runBenchmark({...input, workers: 4});
  const serial = await runBenchmark({...input, workers: 1});
  assert.deepEqual(parallel.rows.map(r => ({id: r.id, cuts: r.cuts})),
    serial.rows.map(r => ({id: r.id, cuts: r.cuts})));
  assert.deepEqual(parallel.rows.map(r => r.id), input.records.map(r => r.id));
  for (const pass of parallel.performance.passes) {
    assert.equal(pass.model_calls, 11);
    assert.deepEqual(pass.workers.map(w => w.sentences), [3, 3, 3, 2]);
  }
  for (const key of ['batch_wall_ms', 'backend_total_ms', 'model_total_ms', 'sentences_per_second']) {
    assert.equal(parallel.performance[key], mean(parallel.performance.passes.map(p => p[key])));
  }
});

test('default eight workers split coverage evenly and execute two complete passes', async t => {
  const input = fixture(t);
  delete input.workers;
  input.records = Array.from({length: 16}, (_, i) => ({id: String(i), raw: '甲乙'}));
  const result = await runBenchmark(input);
  assert.equal(result.workers, 8);
  assert.equal(result.performance.measured_sentences, 32);
  assert.equal(result.performance.passes.length, 2);
  for (const pass of result.performance.passes) {
    assert.deepEqual(pass.workers.map(w => w.sentences), Array(8).fill(2));
    assert.equal(pass.model_calls, 16);
  }
});

test('workers overlap within each pass and all finish before the next starts', async t => {
  const input = fixture(t, `
    globalThis.HaoduChunker={process: texts=>texts.map(()=>{
      const end=Date.now()+80; while(Date.now()<end){}; return [1];
    })};`);
  input.warmup = 1;
  const progress = [];
  const result = await runBenchmark(input, update => progress.push(update));
  assert.deepEqual(progress.map(p => p.phase), [
    'warmup_complete', 'inference', 'inference', 'pass_complete',
    'inference', 'inference', 'pass_complete']);
  for (const pass of result.performance.passes) {
    // Broad allowance for IPC: sequential work would take at least 160 ms.
    assert.ok(pass.batch_wall_ms < pass.backend_total_ms * .9,
      `${pass.batch_wall_ms} batch wall vs ${pass.backend_total_ms} summed work`);
  }
});

test('worker failure rejects promptly and terminates remaining workers', {timeout: 5000}, async t => {
  const input = fixture(t, 'throw Error("broken worker");');
  await assert.rejects(runBenchmark(input), /broken worker/);
});
