// Run the chosen browser model with isolated research chunker thresholds.
// No production files are written. Caller verifies the frozen input hashes.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const context = vm.createContext({Intl, atob, btoa});
for (const file of [input.model, input.inference]) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename:file});
}
const source = fs.readFileSync(input.backend, 'utf8');
const pattern = /const MIN_SPLIT_VISUAL_LENGTH\s*=\s*\d+\s*;/g;
assert.equal([...source.matchAll(pattern)].length, 1, 'Cannot locate runtime threshold');
const results = {};
for (const minimum of input.thresholds) {
  assert.ok(Number.isInteger(minimum) && minimum >= 9 && minimum <= 16);
  vm.runInContext(source.replace(pattern, `const MIN_SPLIT_VISUAL_LENGTH = ${minimum};`), context);
  const api = context.HaoduChunker;
  const ids = new Set(input.cohorts[String(minimum)]);
  results[minimum] = [];
  for (const row of input.records) {
    if (!ids.has(row.id)) continue;
    const chunks = api.buildVisualChunks(row.raw, {minConfidence:input.confidence});
    assert.equal(chunks.map(c => c.text).join(''), row.raw);
    let offset = 0;
    const cuts = [];
    for (const chunk of chunks) {
      if (chunk.separated) cuts.push(offset);
      offset += chunk.text.length;
    }
    results[minimum].push({id:row.id, cuts});
    if (results[minimum].length % 100 === 0) {
      console.error(`min${minimum}: ${results[minimum].length}/${ids.size}`);
    }
  }
}
const model = context.HaoduBoundaryModelData;
process.stdout.write(JSON.stringify({results, model:{checkpointSha256:model.checkpointSha256,
  bestEpoch:model.bestEpoch, format:model.format}, environment:{node:process.version,icu:process.versions.icu}}));
