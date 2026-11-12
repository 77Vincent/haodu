const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const data = require('../src/boundary-model-data.js');

// Exercise multi-cut dispatch independently of the currently bundled task.
const multiCut = {threshold: .5, maximumCharacters: 64,
  inputPolicy: require('../benchmark/multicut-input-v20.json')};

function session(task, score = 10) {
  const calls = [];
  const context = vm.createContext({Intl,
    HaoduBoundaryModelData: {...data, task, ...(task === 'multi' ? {multiCut} : {})},
    HaoduModelBackend: {
      getModelInfo: () => ({inputRepresentation:'unicode-context-v1'}),
      scoreTokens(tokens) { calls.push([...tokens]); return tokens.slice(1).map(() => score); },
    },
  });
  for (const name of ['clauses.js','single-cut.js','multicut-input.js','multicut.js','chunker.js']) {
    vm.runInContext(readFileSync(join(__dirname,'../src/backend',name),'utf8'),context);
  }
  return {api:context.HaoduChunker,calls};
}

test('the shared entry selects multi-cut or legacy single-cut from model metadata', () => {
  const multi = session('multi');
  assert.deepEqual(Array.from(multi.api.process(['甲乙丙丁'])[0]),[1,2,3]);
  assert.equal(multi.calls.length,1);
  assert.equal(multi.api.getSettings().min_confidence,multiCut.threshold);
  for (const task of ['single',undefined]) {
    const single = session(task);
    assert.deepEqual(Array.from(single.api.process(['甲乙丙丁'])[0]),[]);
    assert.equal(single.calls.length,0);
    assert.equal(single.api.MIN_SPLIT_CONFIDENCE,.45);
  }
  assert.throws(() => session('unknown'),/Unsupported model task/);
});

test('shared multi-cut entry propagates no-cut long-window errors without partial output', () => {
  const {api,calls} = session('multi',-10);
  assert.deepEqual(Array.from(api.process(['甲'.repeat(64)])[0]),[]);
  assert.throws(() => api.process(['甲乙','甲'.repeat(65)]),/no valid cut/);
  assert.deepEqual(calls.map(x => x.length),[64,2,64]);
});

test('multi-cut scores natural clauses separately and returns only internal model cuts', () => {
  const {api,calls} = session('multi');
  const raw = '甲乙，丙丁。戊己！庚辛？壬癸；子丑…寅卯\n辰巳\r\n午未\u2028申酉';
  const pairs = ['甲乙','丙丁','戊己','庚辛','壬癸','子丑','寅卯','辰巳','午未','申酉'];
  assert.deepEqual(Array.from(api.process([raw])[0]),pairs.map(pair => raw.indexOf(pair)+1));
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
  const raw = 'English '.repeat(20)+'。甲乙，'+'1'.repeat(80)+'；丙丁。';
  assert.deepEqual(Array.from(api.process([raw])[0]),[raw.indexOf('乙'),raw.indexOf('丁')]);
  assert.deepEqual(calls.map(tokens => tokens.join('')),['甲乙','丙丁']);
});

test('clause offsets remain original UTF-16 positions across quotes and supplementary Han', () => {
  const {api,calls} = session('multi');
  const raw = '𠮷甲，“乙丙。”丁戊';
  assert.deepEqual(Array.from(api.process([raw])[0]),[2,5,6,9,10]);
  assert.deepEqual(calls.map(tokens => tokens.join('')),['𠮷甲','“乙丙','”丁戊']);
});

test('a later clause error cannot return partial results from preceding clauses', () => {
  const {api,calls} = session('multi',-10);
  assert.throws(() => api.process(['甲乙，'+'丙'.repeat(65)]),/no valid cut/);
  assert.deepEqual(calls.map(tokens => tokens.length),[2,64]);
  assert.deepEqual(Array.from(api.process(['甲乙'])[0]),[]);
});
