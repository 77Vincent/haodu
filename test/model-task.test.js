const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const data = require('../src/boundary-model-data.js');
// Exercise multi-cut dispatch independently of the currently bundled task.
const multiCut = {threshold: .5, maximumCharacters: 64,
  inputPolicy: require('../benchmark/multicut-input-v20.json')};

function session(task, score = (_,i) => i === 2 ? 10 : -10) {
  const calls = [];
  const context = vm.createContext({Intl,
    HaoduBoundaryModelData: {...data, task, ...(task === 'multi' ? {multiCut} : {})},
    HaoduModelBackend: {
      getModelInfo: () => ({inputRepresentation:'unicode-context-v1'}),
      scoreTokens(tokens) {
        calls.push([...tokens]);
        return tokens.slice(1).map((_,i) => typeof score === 'function' ? score(tokens,i) : score);
      },
    },
  });
  for (const name of ['clauses.js','single-cut.js','multicut-input.js','multicut.js','chunker.js']) {
    vm.runInContext(readFileSync(join(__dirname,'../src/backend',name),'utf8'),context);
  }
  return {api:context.HaoduChunker,calls};
}

test('the shared entry selects multi-cut or legacy single-cut from model metadata', () => {
  const multi = session('multi');
  assert.deepEqual(Array.from(multi.api.process(['甲乙丙丁戊己'])[0]),[3]);
  assert.equal(multi.calls.length,1);
  assert.equal(multi.api.getSettings().min_confidence,multiCut.threshold);
  for (const task of ['single',undefined]) {
    const single = session(task);
    assert.deepEqual(Array.from(single.api.process(['甲乙丙丁戊'])[0]),[]);
    assert.equal(single.calls.length,0);
    assert.equal(single.api.MIN_SPLIT_CONFIDENCE,.45);
  }
  assert.throws(() => session('unknown'),/Unsupported model task/);
});

test('short clauses retain model cuts with fragmentation prevention disabled', () => {
  const {api,calls} = session('multi',(_,i) => i === 0 ? 10 : -10);
  const texts = ['', '甲', '甲乙', '甲乙丙', '甲乙丙丁', '甲乙丙丁戊', '甲乙丙丁戊。', '𠮷乙丙丁戊', '甲e\u0301乙丙丁'];
  assert.deepEqual(Array.from(api.process(texts), cuts => Array.from(cuts)),
    [[],[],[1],[1],[1],[1],[1],[2],[1]]);
  assert.deepEqual(calls.map(tokens => tokens.join('')),
    ['甲乙','甲乙丙','甲乙丙丁','甲乙丙丁戊','甲乙丙丁戊','𠮷乙丙丁戊','甲é乙丙丁']);
  assert.deepEqual(Array.from(api.process(['甲㍻乙丙','甲１２３']), cuts => Array.from(cuts)),[[1],[1]]);
});

test('shared multi-cut entry retains consecutive short fragments by default', () => {
  const {api} = session('multi',(_,i) => [1,3,5].includes(i) ? 10 : -10);
  assert.deepEqual(Array.from(api.process(['甲乙丙丁戊己庚辛'])[0]),[2,4,6]);
  assert.equal(api.getSettings().prevent_consecutive_short_segments,false);
});

test('shared multi-cut entry propagates no-cut long-window errors without partial output', () => {
  const {api,calls} = session('multi',-10);
  assert.deepEqual(Array.from(api.process(['甲'.repeat(64)])[0]),[]);
  assert.throws(() => api.process(['甲乙丙丁戊己','甲'.repeat(65)]),/no valid cut/);
  assert.deepEqual(calls.map(x => x.length),[64,6,64]);
});

test('multi-cut scores natural clauses separately and returns only internal model cuts', () => {
  const {api,calls} = session('multi');
  const pairs = ['甲乙','丙丁','戊己','庚辛','壬癸','子丑','寅卯','辰巳','午未','申酉'].map(pair => pair+'测试句子');
  const separators = ['，','。','！','？','；','…','\n','\r\n','\u2028',''];
  const raw = pairs.map((pair,i) => pair+separators[i]).join('');
  assert.deepEqual(Array.from(api.process([raw])[0]),pairs.map(pair => raw.indexOf(pair)+3));
  assert.deepEqual(calls.map(tokens => tokens.join('')),pairs);
  assert.equal(calls.length,10,'short clauses are scored once, without recursive child calls');
});

test('reading boundaries and numeric exceptions are shared with the single-cut splitter', () => {
  const raw = '甲乙,丙丁.戊己、庚辛：壬癸  子丑。金额１，０００．５０元，时间８：３０到。';
  const expected = ['甲乙,','丙丁.','戊己、','庚辛：','壬癸  ','子丑。','金额１，０００．５０元，','时间８：３０到。'];
  const single = session('single');
  assert.deepEqual(Array.from(single.api.splitClauses(raw)),expected);
  const {api,calls} = session('multi',-10);
  assert.deepEqual(Array.from(api.process([raw])[0]),[]);
  assert.deepEqual(calls.map(tokens => tokens.join('')),
    ['甲乙,','丙丁.','戊己、','庚辛:','壬癸','子丑','金额1,000.50元','时间8:30到']);
});

test('pure non-Han clauses skip inference, even within mixed or very long input', () => {
  const {api,calls} = session('multi');
  const raw = 'English '.repeat(20)+'。甲乙丙丁戊己，'+'1'.repeat(80)+'；庚辛壬癸子丑。';
  assert.deepEqual(Array.from(api.process([raw])[0]),[raw.indexOf('甲')+3,raw.indexOf('庚')+3]);
  assert.deepEqual(calls.map(tokens => tokens.join('')),['甲乙丙丁戊己','庚辛壬癸子丑']);
});

test('clause offsets remain original UTF-16 positions across quotes and supplementary Han', () => {
  const {api,calls} = session('multi');
  const raw = '𠮷甲乙丙丁戊，“己庚辛壬癸。”子丑寅卯辰';
  assert.deepEqual(Array.from(api.process([raw])[0]),[4,11,18]);
  assert.deepEqual(calls.map(tokens => tokens.join('')),['𠮷甲乙丙丁戊','“己庚辛壬癸','”子丑寅卯辰']);
});

test('a later clause error cannot return partial results from preceding clauses', () => {
  const {api,calls} = session('multi',-10);
  assert.throws(() => api.process(['甲乙丙丁戊己，'+'丙'.repeat(65)]),/no valid cut/);
  assert.deepEqual(calls.map(tokens => tokens.length),[6,64]);
  assert.deepEqual(Array.from(api.process(['甲乙'])[0]),[]);
});
