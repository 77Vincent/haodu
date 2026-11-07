const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {createNormalizer} = require('../src/backend/multicut-input.js');
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
    HaoduClauses: require('../src/backend/clauses.js'),
    HaoduBoundaryModelData: {task:'multi',multiCut:{threshold:.5,maximumCharacters:64,inputPolicy:policy,...options}},
    HaoduModelBackend: {scoreTokens(tokens) { calls.push(tokens); return scores(tokens, calls.length-1); }},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/backend/multicut.js'),'utf8'),context);
  vm.runInContext('globalThis.HaoduChunker = HaoduMultiCut.createChunker(HaoduBoundaryModelData, HaoduModelBackend)',context);
  return {process:raw => Array.from(context.HaoduChunker.process([raw])[0]), calls,
    settings: () => JSON.parse(JSON.stringify(context.HaoduChunker.getSettings()))};
}

const logits = (tokens, gaps) => tokens.slice(1).map((_, i) => gaps.includes(i+1) ? 10 : -10);

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

test('invalid outputs fail; empty and single-character inputs need no model call', () => {
  assert.throws(() => backend(() => [NaN]).process('甲乙'), /Invalid.*logits/);
  assert.throws(() => backend(() => []).process('甲乙'), /Invalid.*logits/);
  const model = backend(() => { throw Error('Unexpected model call'); });
  assert.deepEqual(model.process(''),[]);
  assert.deepEqual(model.process('甲'),[]);
  assert.equal(model.calls.length,0);
});

test('long input keeps every cut and advances from the last cut rather than a fixed stride', () => {
  const chars = Array.from({length:140}, (_, i) => String.fromCodePoint(0x4e00+i));
  const plans = [[16,48], [12,40], [8]];
  const model = backend((tokens, call) => logits(tokens, plans[call]));
  assert.deepEqual(model.process(chars.join('')), [16,48,60,88,96]);
  assert.deepEqual(model.calls, [chars.slice(0,64), chars.slice(48,112), chars.slice(88)]);
});

test('zero cuts are accepted at 63/64 characters but fail at 65 without skipping the suffix', () => {
  for (const length of [63,64,65]) {
    const model = backend(tokens => logits(tokens, []), {threshold:.95});
    if (length <= 64) assert.deepEqual(model.process('甲'.repeat(length)), []);
    else assert.throws(() => model.process('甲'.repeat(length)), /offset 0 \(64 characters\).*no valid cut.*0\.95/);
    assert.equal(model.calls.length,1);
    assert.equal(model.calls[0].length,Math.min(length,64));
  }
});

test('a final tail may have zero cuts even when it is exactly 64 characters', () => {
  for (const length of [100,112]) {
    const model = backend((tokens, call) => logits(tokens, call === 0 ? [16,48] : []));
    assert.deepEqual(model.process('甲'.repeat(length)), [16,48]);
    assert.deepEqual(model.calls.map(tokens => tokens.length), [64,length-48]);
  }
});

test('a later nonfinal window without cuts fails instead of returning partial results', () => {
  const model = backend((tokens, call) => logits(tokens, call === 0 ? [48] : []));
  assert.throws(() => model.process('甲'.repeat(140)), /offset 48 \(64 characters\).*no valid cut/);
  assert.equal(model.calls.length,2);
  // A failed text must not leave window state behind for the next request.
  assert.deepEqual(model.process('甲乙'), []);
});

test('later-window invalid logits are not hidden by earlier valid cuts', () => {
  const model = backend((tokens, call) => call === 0 ? logits(tokens,[48]) : [NaN]);
  assert.throws(() => model.process('甲'.repeat(140)), /Invalid multi-cut logits/);
  assert.equal(model.calls.length,2);
});

test('first/last internal gaps advance and terminate without duplicates or artificial window cuts', () => {
  const all = backend(tokens => logits(tokens, tokens.slice(1).map((_,i) => i+1)));
  assert.deepEqual(all.process('甲'.repeat(130)), Array.from({length:129},(_,i) => i+1));
  assert.deepEqual(all.calls.map(tokens => tokens.length),[64,64,4]);

  const first = backend((tokens, call) => {
    assert.ok(call < 138, 'Window must make forward progress');
    return logits(tokens,[1]);
  });
  assert.deepEqual(first.process('甲'.repeat(200)), Array.from({length:137},(_,i) => i+1));
  assert.equal(first.calls.length,137);
});

test('window offsets preserve surrogate pairs and skip internal NFKC expansion gaps', () => {
  const plans = [[1,2,3],[2,3],[2]];
  const model = backend((tokens, call) => logits(tokens,plans[call]), {maximumCharacters:4});
  assert.deepEqual(model.process('甲😀㍻乙丙丁戊己'),[1,3,4,5,7]);
  assert.deepEqual(model.calls.map(tokens => tokens.join('')),['甲😀平成','平成乙丙','丙丁戊己']);
});

test('only unmappable predictions cannot advance a nonfinal window', () => {
  const model = backend(tokens => logits(tokens,[1]), {maximumCharacters:4});
  assert.throws(() => model.process('㍻甲乙丙丁'), /no valid cut/);
  assert.equal(model.calls.length,1);
});

test('each pre-split clause is normalized once and windows retain clause UTF-16 offsets', () => {
  const model = backend(tokens => tokens.slice(1).map(() => 10), {maximumCharacters:4});
  assert.deepEqual(model.process('甲乙: "丙丁，戊己" 庚辛壬癸'),[1,4,5,6,9,10,11,12,13,14,15]);
  assert.deepEqual(model.calls.map(tokens => tokens.join('')),['甲乙"丙','丙丁','戊己" ',' 庚辛壬','壬癸']);
});

test('the input limit counts normalized characters rather than raw or visual length', () => {
  const model = backend(tokens => logits(tokens,[]));
  assert.deepEqual(model.process('甲，'.repeat(64)),[]);
  assert.deepEqual(model.calls,[],'single-character clauses are never joined for inference');
  // Mixed Han/ASCII counts individual model characters, not visual units.
  assert.throws(() => model.process('甲'+'1'.repeat(64)), /no valid cut/);
  const expanded = backend(tokens => logits(tokens,[]),{maximumCharacters:4});
  assert.throws(() => expanded.process('㍻㍻甲'), /no valid cut/);
});

test('long-window progression resets at every natural clause boundary', () => {
  const model = backend((tokens, call) => logits(tokens,call % 2 === 0 ? [48] : []));
  assert.deepEqual(model.process('甲'.repeat(70)+'，'+'乙'.repeat(70)+'。'),[48,119]);
  assert.deepEqual(model.calls.map(tokens => tokens.join('')),
    ['甲'.repeat(64),'甲'.repeat(22),'乙'.repeat(64),'乙'.repeat(22)]);
});

test('a long paragraph of short clauses never enters the long-window failure path', () => {
  const model = backend(tokens => logits(tokens,[]));
  assert.deepEqual(model.process('甲乙丙丁，'.repeat(40)),[]);
  assert.equal(model.calls.length,40);
  assert.ok(model.calls.every(tokens => tokens.join('') === '甲乙丙丁'));
});

test('settings expose the window policy for benchmark report provenance', () => {
  const settings = backend(() => []).settings();
  assert.equal(settings.recursion,false);
  assert.equal(settings.min_visual_length,null);
  assert.equal(settings.max_model_window_tokens,64);
  assert.equal(settings.long_input,'advance from last predicted mappable cut');
  assert.equal(settings.nonfinal_window_without_cut,'error');
  assert.equal(settings.final_window_without_cut,'accept');
  assert.equal(settings.presegmentation,'shared natural clauses');
  assert.equal(settings.non_han_clauses,'skip');
  assert.equal(settings.normalization_scope,'clause');
  assert.equal(settings.window_scope,'clause');
});
