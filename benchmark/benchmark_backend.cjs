// Real browser backend, unmodified defaults, no prediction/logit cache.
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { fork } = require('node:child_process');

const PROTOCOL = 'fixed-shards-processes-warm100perworker-repeat2-mean-v3';
const PARTITION = 'source-index-modulo-workers-v1';
const DEFAULT_WORKERS = 8;

function distribution(values) {
  assert.ok(values.length > 0 && values.every(v => Number.isFinite(v) && v >= 0));
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = p => ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)];
  return { mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) };
}

function mean(values) {
  assert.ok(values.length > 0 && values.every(Number.isFinite));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateCuts(text, cuts) {
  assert.ok(Array.isArray(cuts), 'Backend process must return an offsets array');
  const boundaries = new Set();
  let offset = 0;
  for (const ch of text) { boundaries.add(offset); offset += ch.length; }
  let last = 0;
  for (const cut of cuts) {
    assert.ok(Number.isInteger(cut) && cut > last && cut < text.length && boundaries.has(cut),
      'Cuts must be sorted, unique, internal UTF-16 character boundaries');
    last = cut;
  }
}

function createSession(input, progress = () => {}) {
  assert.ok(input.records.length > 0);
  assert.equal(new Set(input.records.map(r => r.id)).size, input.records.length);
  assert.ok(Number.isInteger(input.repeats) && input.repeats >= 1);
  assert.ok(Number.isInteger(input.warmup) && input.warmup >= 1);
  const context = vm.createContext({ Intl, atob, btoa });
  const started = performance.now();
  for (const file of [input.model, input.inference]) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  const original = context.HaoduModelBackend;
  assert.equal(typeof original.scoreTokens, 'function');
  let modelMs = 0, modelCalls = 0, modelTokens = 0;
  // Keep the real inference implementation and any other exported API intact.
  context.HaoduModelBackend = Object.freeze({ ...original, scoreTokens(tokens) {
    const start = performance.now();
    const scores = original.scoreTokens(tokens);
    modelMs += performance.now() - start;
    modelCalls++;
    modelTokens += tokens.length;
    return scores;
  } });
  const backendSource = fs.readFileSync(input.backend, 'utf8');
  vm.runInContext(backendSource, context, { filename: input.backend });
  const api = context.HaoduChunker;
  assert.equal(typeof api.process, 'function');
  const loadMs = performance.now() - started;
  const metadata = context.HaoduBoundaryModelData;
  if (input.expected_model) {
    assert.equal(metadata.checkpointSha256, input.expected_model.checkpoint_sha256,
      'Current export does not match current-model.json; run npm run model:export');
    assert.equal(original.getModelInfo().vocabularySize, input.expected_model.vocabulary_size);
  }
  // Read existing settings for provenance only. Never rewrite source constants.
  const numberConstant = name => {
    const match = backendSource.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)\\s*;`));
    return match ? Number(match[1]) : null;
  };
  const settings = { min_visual_length: numberConstant('MIN_SPLIT_VISUAL_LENGTH'),
    min_confidence: numberConstant('MIN_SPLIT_CONFIDENCE'), options: 'backend defaults' };
  const warmStarted = performance.now();
  for (let i = 0; i < input.warmup; i++) {
    const row = input.records[Math.floor(i * input.records.length / input.warmup) % input.records.length];
    api.process([row.raw]);
  }
  const warmupMs = performance.now() - warmStarted;
  progress({ phase: 'warmup_complete', warmup: input.warmup, load_ms: loadMs, warmup_ms: warmupMs });
  const rows = input.records.map(r => ({ id: r.id, cuts: null, backend_ms: [], model_ms: [],
    model_calls: [], model_tokens: [] }));
  let completedPasses = 0;
  function runPass(pass) {
    assert.equal(pass, completedPasses);
    assert.ok(pass < input.repeats);
    modelMs = 0; modelCalls = 0; modelTokens = 0;
    let backendMs = 0;
    const passStarted = performance.now(), cpuStart = process.cpuUsage();
    for (let i = 0; i < input.records.length; i++) {
      const row = input.records[i], result = rows[i];
      const beforeMs = modelMs, beforeCalls = modelCalls, beforeTokens = modelTokens;
      const start = performance.now();
      const output = api.process([row.raw]);
      const duration = performance.now() - start;
      backendMs += duration;
      assert.equal(output.length, 1);
      const cuts = Array.from(output[0]);
      validateCuts(row.raw, cuts);
      if (pass === 0) result.cuts = cuts;
      else assert.deepEqual(cuts, result.cuts, `Nondeterministic output at ${row.id}, pass ${pass + 1}`);
      result.backend_ms.push(duration);
      result.model_ms.push(modelMs - beforeMs);
      result.model_calls.push(modelCalls - beforeCalls);
      result.model_tokens.push(modelTokens - beforeTokens);
      if ((i + 1) % 500 === 0 || i + 1 === input.records.length) {
        progress({ phase: 'inference', pass: pass + 1, passes: input.repeats,
          completed: i + 1, total: input.records.length, elapsed_seconds: (performance.now() - started) / 1000 });
      }
    }
    const cpu = process.cpuUsage(cpuStart);
    completedPasses++;
    return { pass: pass + 1, backend_total_ms: backendMs, model_total_ms: modelMs,
      model_calls: modelCalls, model_tokens: modelTokens,
      loop_wall_ms: performance.now() - passStarted, cpu_ms: (cpu.user + cpu.system) / 1000 };
  }
  const cpu = os.cpus();
  return { runPass, rows, metadata: { settings, model: { ...original.getModelInfo(),
    sourceEpoch: metadata.sourceEpoch ?? null, exportedState: metadata.exportedState ?? null,
    format: metadata.format ?? null, architecture: metadata.architecture ?? null },
    environment: { node: process.version, v8: process.versions.v8, icu: process.versions.icu,
      platform: process.platform, arch: process.arch, os_release: os.release(),
      cpu: cpu[0]?.model ?? null, logical_cpus: cpu.length, memory_bytes: os.totalmem(),
      machine_id: crypto.createHash('sha256').update(os.hostname()).digest('hex'),
      exec_argv: process.execArgv, node_options: process.env.NODE_OPTIONS || '' },
    load_ms: loadMs, warmup_ms: warmupMs } };
}

function startWorker(index, progress) {
  const child = fork(__filename, ['--worker'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let pending = null, failure = null;
  function fail(error) {
    failure = error;
    if (pending) { const { reject } = pending; pending = null; reject(error); }
  }
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`Worker ${index} exited: ${signal || code}`)));
  child.on('message', message => {
    if (message.type === 'progress') { progress(index, message.value); return; }
    if (message.type === 'error') { fail(new Error(`Worker ${index}: ${message.error}`)); return; }
    if (!pending || message.type !== pending.expected) { fail(new Error(`Unexpected worker ${index} response`)); return; }
    const { resolve } = pending; pending = null; resolve(message.value);
  });
  return { child, request(type, value, expected) {
    return new Promise((resolve, reject) => {
      if (failure || !child.connected) { reject(failure || new Error(`Worker ${index} disconnected`)); return; }
      assert.equal(pending, null);
      pending = { resolve, reject, expected };
      child.send({type, value}, error => { if (error) fail(error); });
    });
  } };
}

async function runBenchmark(input, progress = () => {}) {
  const workerCount = input.workers ?? DEFAULT_WORKERS;
  assert.ok(Number.isInteger(workerCount) && workerCount > 0);
  assert.ok(input.records.length >= workerCount, 'Every worker must have a nonempty shard');
  assert.equal(new Set(input.records.map(r => r.id)).size, input.records.length);
  assert.ok(Number.isInteger(input.repeats) && input.repeats > 0);
  assert.ok(Number.isInteger(input.warmup) && input.warmup > 0);
  const shards = Array.from({length: workerCount}, (_, worker) => input.records.filter((_, i) => i % workerCount === worker));
  const started = performance.now(), workers = [], passes = [];
  let counts = Array(workerCount).fill(0);
  const cleanup = () => { for (const {child} of workers) child.kill('SIGTERM'); };
  const onInterrupt = () => { cleanup(); process.exit(130); };
  const onTerminate = () => { cleanup(); process.exit(143); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    for (let i = 0; i < workerCount; i++) {
      workers.push(startWorker(i, (worker, update) => {
        if (update.phase !== 'inference') return;
        counts[worker] = update.completed;
        progress({phase: 'inference', pass: update.pass, passes: input.repeats,
          workers: workerCount, completed: counts.reduce((a, b) => a + b, 0),
          total: input.records.length, elapsed_seconds: (performance.now() - started) / 1000});
      }));
    }
    const metadata = await Promise.all(workers.map((worker, i) =>
      worker.request('init', {...input, records: shards[i]}, 'ready')));
    for (const meta of metadata) {
      for (const key of ['settings', 'model', 'environment']) assert.deepEqual(meta[key], metadata[0][key]);
    }
    const startupWallMs = performance.now() - started;
    progress({phase: 'warmup_complete', workers: workerCount, warmup_per_worker: input.warmup,
      warmup: input.warmup * workerCount, startup_wall_ms: startupWallMs});
    for (let pass = 0; pass < input.repeats; pass++) {
      counts = Array(workerCount).fill(0);
      // Barrier: all workers are warm/idle before each pass; never overlap passes.
      const passStarted = performance.now();
      const measured = await Promise.all(workers.map(worker => worker.request('pass', pass, 'done')));
      const batchWallMs = performance.now() - passStarted;
      const total = key => measured.reduce((sum, value) => sum + value[key], 0);
      passes.push({pass: pass + 1, batch_wall_ms: batchWallMs,
        backend_total_ms: total('backend_total_ms'), model_total_ms: total('model_total_ms'),
        model_calls: total('model_calls'), model_tokens: total('model_tokens'), cpu_ms: total('cpu_ms'),
        sentences_per_second: input.records.length * 1000 / batchWallMs,
        workers: measured.map((value, worker) => ({worker, sentences: shards[worker].length, ...value}))});
      progress({phase: 'pass_complete', pass: pass + 1, passes: input.repeats,
        workers: workerCount, batch_wall_ms: batchWallMs, elapsed_seconds: (performance.now() - started) / 1000});
    }
    // Transfer detailed predictions only after the measured passes.
    const shardRows = await Promise.all(workers.map(worker => worker.request('results', null, 'results')));
    const byId = new Map();
    for (let i = 0; i < workerCount; i++) {
      assert.deepEqual(shardRows[i].map(r => r.id), shards[i].map(r => r.id));
      for (const row of shardRows[i]) { assert.ok(!byId.has(row.id)); byId.set(row.id, row); }
    }
    const rows = input.records.map(r => byId.get(r.id));
    const avg = key => mean(passes.map(p => p[key]));
    return {protocol: PROTOCOL, partition: PARTITION, workers: workerCount,
      settings: metadata[0].settings, model: metadata[0].model, environment: metadata[0].environment,
      performance: {startup_wall_ms: startupWallMs,
        load_ms: Math.max(...metadata.map(m => m.load_ms)), warmup_ms: Math.max(...metadata.map(m => m.warmup_ms)),
        warmup_sentences: input.warmup * workerCount, warmup_sentences_per_worker: input.warmup,
        workers: workerCount, repeats: input.repeats, measured_sentences: rows.length * input.repeats,
        batch_wall_ms: avg('batch_wall_ms'), backend_total_ms: avg('backend_total_ms'),
        model_total_ms: avg('model_total_ms'), model_calls: avg('model_calls'), model_tokens: avg('model_tokens'),
        sentences_per_second: avg('sentences_per_second'),
        backend_sentence_ms: distribution(rows.flatMap(r => r.backend_ms)),
        model_sentence_ms: distribution(rows.flatMap(r => r.model_ms)),
        passes}, rows};
  } finally {
    cleanup();
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

function workerMain() {
  let session;
  process.on('disconnect', () => process.exit(1));
  process.on('message', ({type, value}) => {
    try {
      if (type === 'init') {
        assert.equal(session, undefined);
        session = createSession(value, update => process.send({type: 'progress', value: update}));
        process.send({type: 'ready', value: session.metadata});
      } else if (type === 'pass') {
        process.send({type: 'done', value: session.runPass(value)});
      } else if (type === 'results') {
        process.send({type: 'results', value: session.rows});
      } else throw new Error('Unknown worker command');
    } catch (error) {
      process.send({type: 'error', error: error.stack}, () => process.exit(1));
    }
  });
}

if (require.main === module) {
  if (process.argv[2] === '--worker') workerMain();
  else {
    const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    runBenchmark(input, update => {
      fs.writeFileSync(input.progress + '.tmp', JSON.stringify(update) + '\n');
      fs.renameSync(input.progress + '.tmp', input.progress);
      console.error(JSON.stringify(update));
    }).then(result => fs.writeFileSync(input.output, JSON.stringify(result) + '\n'))
      .catch(error => { console.error(error.stack); process.exitCode = 1; });
  }
}

module.exports = { PROTOCOL, PARTITION, DEFAULT_WORKERS, runBenchmark, validateCuts, distribution, mean };
