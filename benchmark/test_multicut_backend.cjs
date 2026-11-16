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
const rankedLogits = (tokens, scores) => tokens.slice(1).map((_,i) => scores[i+1] ?? -10);
const filteredBackend = (scores, options = {}) => backend(scores, {preventConsecutiveShortSegments:true,...options});

test('isolated one/two-character fragments are allowed, including clause heads and tails', () => {
  for (const [length,gaps] of [[10,[4,6]], [8,[1,6]], [5,[2]], [4,[1]], [4,[3]]]) {
    assert.deepEqual(filteredBackend(tokens => logits(tokens,gaps)).process('甲'.repeat(length)),gaps);
  }
  for (const [length,gaps] of [[2,[1]], [3,[1]], [3,[2]], [4,[2]]]) {
    assert.deepEqual(filteredBackend(tokens => logits(tokens,gaps)).process('甲'.repeat(length)),[]);
  }
});

test('adjacent short fragments drop the weakest helpful cut and recheck after each merge', () => {
  // AA|BB|CC|DD: lower scores on the outside preserve the strong middle cut.
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:.2,4:2.2,6:.4})).process('甲'.repeat(8)),[4]);
  // If the middle cut is weakest, a single removal solves every violation.
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:2.2,4:.2,6:.4})).process('甲'.repeat(8)),[2,6]);
  // Scores take priority over minimizing the number of deletions.
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:1,4:2,6:3})).process('甲'.repeat(8)),[6]);
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:3,4:2,6:1})).process('甲'.repeat(8)),[2]);
  // Float32 sigmoid saturation must not erase the original score ordering.
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:30,4:20,6:40})).process('甲'.repeat(8)),[2,6]);
});

test('a short pair may merge outward, but unrelated low-score cuts stay untouched', () => {
  // Lengths 5|2|2|5|6: cut 5 can fix the 2|2 pair by merging outward.
  const model = filteredBackend(tokens => rankedLogits(tokens,{5:1,7:4,9:3,14:.1}));
  assert.deepEqual(model.process('甲'.repeat(20)),[7,9,14]);
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{5:4,7:3,9:1})).process('甲'.repeat(14)),[5,7]);
});

test('equal scores remove later helpful cuts first and stop once the short pair is gone', () => {
  const model = filteredBackend(tokens => rankedLogits(tokens,{2:2,4:2}));
  assert.deepEqual(model.process('甲'.repeat(6)),[2]);
  assert.deepEqual(model.process('甲'.repeat(6)),[2]);
});

test('later-window candidates participate in the same adjacent-short-fragment resolution', () => {
  const model = filteredBackend((tokens,call) => rankedLogits(tokens,call === 0 ? {62:4,63:2} : {1:8}));
  assert.deepEqual(model.process('甲'.repeat(100)),[62,64]);
  assert.deepEqual(model.calls.map(tokens => tokens.length),[64,37]);
});

// Independent, deliberately simple oracle: try each possible removal, choose
// the lowest-scoring one reducing violation count, and start over from scratch.
function referenceCuts(scores, length) {
  const cuts = scores.flatMap((score,i) => score >= 0 ? [i+1] : []);
  const violations = gaps => {
    const boundaries = [0,...gaps,length];
    const sizes = boundaries.slice(1).map((gap,i) => gap-boundaries[i]);
    return sizes.slice(1).filter((size,i) => size <= 2 && sizes[i] <= 2).length;
  };
  while (violations(cuts)) {
    const before = violations(cuts);
    const eligible = cuts.filter(cut => violations(cuts.filter(gap => gap !== cut)) < before);
    eligible.sort((a,b) => scores[a-1]-scores[b-1] || b-a);
    assert.ok(eligible.length);
    cuts.splice(cuts.indexOf(eligible[0]),1);
  }
  return cuts;
}

test('selection matches iterative violation removal for varied lengths and scores', () => {
  for (let length = 2; length <= 60; length++) {
    for (const seed of [1,7,19]) {
      const scores = Array.from({length:length-1},(_,i) => ((i*17+length*seed)%23)-7);
      assert.deepEqual(filteredBackend(() => scores).process('甲'.repeat(length)),referenceCuts(scores,length),
        `length ${length}, seed ${seed}`);
    }
  }
});

test('fragmentation prevention is off by default and can be explicitly enabled', () => {
  const scores = tokens => rankedLogits(tokens,{2:.2,4:2.2,6:.4});
  for (const options of [{},{preventConsecutiveShortSegments:false}]) {
    assert.deepEqual(backend(scores,options).process('甲乙丙丁戊己庚辛'),[2,4,6]);
  }
  assert.deepEqual(filteredBackend(scores).process('甲乙丙丁戊己庚辛'),[4]);
  const enabled = filteredBackend(scores).settings();
  assert.equal(enabled.prevent_consecutive_short_segments,true);
  assert.equal(enabled.short_segment_max_characters,2);
  assert.equal(enabled.max_consecutive_short_segments,1);
  assert.equal(enabled.cut_selection,'remove lowest-logit cut touching adjacent short segments; later gap on ties');
});

test('multi-cut has no recursion or three-cut cap, and two-character clauses are scored', () => {
  const all = backend(tokens => tokens.slice(1).map(() => 0));
  assert.deepEqual(all.process('甲乙丙丁戊己'), [1,2,3,4,5]);
  assert.equal(all.calls.length, 1);
  assert.deepEqual(all.process('甲乙'), [1]);
  assert.equal(all.calls.length, 2, 'the only gap is scored and retained');
  assert.deepEqual(backend(tokens => logits(tokens,[1,4,7,10,13])).process('甲'.repeat(15)),[1,4,7,10,13]);
  const none = backend(tokens => tokens.slice(1).map(() => -1));
  assert.deepEqual(none.process('甲乙丙丁戊己庚辛壬癸甲乙丙丁'), []);
  assert.equal(none.calls.length, 1);
});

test('normalization expansions cannot manufacture an original boundary', () => {
  const all = backend(tokens => tokens.slice(1).map(() => 10));
  assert.deepEqual(all.process('甲㍻乙丙丁'), [1,2,3,4]);
  assert.deepEqual(all.process('甲😀乙丙丁戊'), [1,3,4,5,6]);
  assert.deepEqual(all.process('甲e\u0301乙丙丁戊'), [1,3,4,5,6]);
  const afterSecond = backend(tokens => logits(tokens,[2]));
  assert.deepEqual(afterSecond.process('甲㍻乙丙丁'), [],'no boundary inside 平成 expansion');
  assert.deepEqual(afterSecond.process('甲😀乙丙丁戊'), [3],'supplementary character counts once');
  assert.deepEqual(afterSecond.process('甲e\u0301乙丙丁戊'), [3],'combined accent maps back to original UTF-16');
});

test('collapsed whitespace uses normalized lengths and retains original cut offsets', () => {
  // Han-to-Han spaces are natural clause boundaries; Han-to-Latin spaces stay inside.
  const raw = '甲乙  A丙丁戊己';
  assert.deepEqual(require('../src/backend/clauses.js').splitClauses(raw),[raw]);
  const normalized = createNormalizer(policy)(raw);
  assert.equal(normalized.mapping.get(2),2);
  assert.equal(normalized.mapping.get(3),4);
  assert.deepEqual(backend(tokens => rankedLogits(tokens,{2:1,3:5,4:3})).process(raw),[2,4,5]);
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:1,3:5,4:3})).process(raw),[4,5]);
  assert.deepEqual(filteredBackend(tokens => rankedLogits(tokens,{2:5,3:1,4:3})).process(raw),[2]);
});

test('short pieces on opposite sides of a natural clause boundary do not conflict', () => {
  const model = backend((tokens,call) => logits(tokens,call === 0 ? [3] : [1]));
  assert.deepEqual(model.process('甲乙丙丁，戊己庚辛'),[3,6]);
  assert.deepEqual(model.calls.map(tokens => tokens.join('')),['甲乙丙丁','戊己庚辛']);
});

test('invalid outputs fail; empty and single-character inputs need no model call', () => {
  assert.throws(() => backend(() => [NaN]).process('甲乙丙丁戊己'), /Invalid.*logits/);
  assert.throws(() => backend(() => []).process('甲乙丙丁戊己'), /Invalid.*logits/);
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
  assert.deepEqual(model.process('甲乙丙丁戊己'), []);
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
  assert.throws(() => model.process('㍻甲乙丙丁戊'), /no valid cut/);
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
  assert.throws(() => expanded.process('㍻㍻甲乙'), /no valid cut/);
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
  assert.equal(model.calls.length,40,'four-character clauses are scored separately');
});

test('settings expose the window policy for benchmark report provenance', () => {
  const settings = backend(() => []).settings();
  assert.equal(settings.recursion,false);
  assert.equal(settings.min_visual_length,null);
  assert.equal(settings.min_clause_characters,undefined);
  assert.equal(settings.min_segment_characters,null);
  assert.equal(settings.prevent_consecutive_short_segments,false);
  assert.equal(settings.short_segment_max_characters,null);
  assert.equal(settings.max_consecutive_short_segments,null);
  assert.equal(settings.segment_length_unit,'normalized Unicode characters');
  assert.equal(settings.cut_selection,'all threshold-passing mappable gaps; deduplicated by original offset');
  assert.equal(settings.cut_selection_scope,'complete clause across windows');
  assert.equal(settings.max_model_window_tokens,64);
  assert.equal(settings.long_input,'advance from last predicted mappable cut');
  assert.equal(settings.nonfinal_window_without_cut,'error');
  assert.equal(settings.final_window_without_cut,'accept');
  assert.equal(settings.presegmentation,'shared natural clauses');
  assert.equal(settings.non_han_clauses,'skip');
  assert.equal(settings.normalization_scope,'clause');
  assert.equal(settings.window_scope,'clause');
});
