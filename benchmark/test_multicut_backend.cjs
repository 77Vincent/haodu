const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {createNormalizer} = require('./multicut_input.js');
const policy = require('./multicut-input-v20.json');
const fixtures = require('./fixtures/multicut-v20-normalization.json');

test('v20 input/UTF-16 offsets match training reference fixtures', () => {
  const normalize = createNormalizer(policy);
  for (const row of fixtures) {
    const result = normalize(row.raw);
    assert.equal(result.text, row.text, row.raw);
    assert.deepEqual([...result.mapping].sort((a,b) => a[0]-b[0]), row.mapping, row.raw);
  }
  assert.throws(() => createNormalizer({...policy, standard:'future-policy'}), /Unsupported/);
});

function backend(scores, options = {}) {
  const calls = [];
  const context = vm.createContext({
    HaoduMultiCutInput: {createNormalizer},
    HaoduBoundaryModelData: {task:'multi',multiCut:{threshold:.5,maximumCharacters:64,inputPolicy:policy,...options}},
    HaoduModelBackend: {scoreTokens(tokens) { calls.push(tokens); return scores(tokens); }},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'multicut_backend.js'),'utf8'),context);
  return {process:raw => Array.from(context.HaoduChunker.process([raw])[0]), calls};
}

test('multi-cut permits zero through all gaps, no recursion, length floor or three-cut cap', () => {
  const all = backend(tokens => tokens.slice(1).map(() => 0));
  assert.deepEqual(all.process('甲乙丙丁戊己'), [1,2,3,4,5]);
  assert.equal(all.calls.length, 1);
  assert.deepEqual(all.process('甲乙'), [1]);
  const none = backend(tokens => tokens.slice(1).map(() => -1));
  assert.deepEqual(none.process('甲乙丙丁戊己庚辛壬癸甲乙丙丁'), []);
  assert.equal(none.calls.length, 1);
});

test('normalization expansions cannot manufacture an original boundary', () => {
  const all = backend(tokens => tokens.slice(1).map(() => 10));
  assert.deepEqual(all.process('甲㍻乙'), [1,2]);
  assert.deepEqual(all.process('甲😀乙'), [1,3]);
  assert.deepEqual(all.process('甲e\u0301乙'), [1,3]);
});

test('invalid outputs and overlength fail; no truncation or hidden data filtering', () => {
  assert.throws(() => backend(() => [NaN]).process('甲乙'), /Invalid.*logits/);
  assert.throws(() => backend(() => []).process('甲乙'), /Invalid.*logits/);
  const model = backend(tokens => tokens.slice(1).map(() => 1), {maximumCharacters:4});
  assert.throws(() => model.process('甲乙丙丁戊'), /exceeds/);
  assert.equal(model.calls.length,0);
  assert.deepEqual(model.process('甲'),[]);
  assert.equal(model.calls.length,0);
});
