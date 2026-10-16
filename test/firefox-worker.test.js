const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const sourceData = require('../src/boundary-model-data.js');
const { weightsBase64, ...metadata } = sourceData;
const weights = Uint8Array.from(Buffer.from(weightsBase64, 'base64'));

function worker(fetch) {
  const messages = [];
  const context = vm.createContext({ URL, Uint8Array, Intl, fetch, console });
  context.self = context;
  context.location = { href: 'moz-extension://test/src/platform/firefox/inference-worker.js' };
  context.postMessage = message => messages.push(message);
  context.importScripts = (...paths) => {
    for (const path of paths) vm.runInContext(readFileSync(join(__dirname, '../src/platform/firefox', path), 'utf8'), context);
  };
  vm.runInContext(readFileSync(join(__dirname, '../src/platform/firefox/inference-worker.js'), 'utf8'), context);
  return { context, messages };
}

test('Firefox local binary weights preserve every model score and queued request result', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const urls = [];
  const { context, messages } = worker(async url => {
    urls.push(String(url));
    await pending;
    return { ok: true, json: async () => structuredClone(metadata), arrayBuffer: async () => weights.buffer.slice(0) };
  });
  const texts = ['我一直在思考明天早上的早餐吃什么',
    '即便是完全符合语法的通顺的但没有任何标点断句的句子模型依然能够找到恰当的切分点。',
    'English only', '这些文字含有空格 我们也希望能够按语意正确切开足够长的句子'];
  const first = context.onmessage({ data: { id: 1, texts } });
  const second = context.onmessage({ data: { id: 2, texts: [texts[0]] } });
  assert.equal(messages.length, 0);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(urls, ['moz-extension://test/src/boundary-model-data.json', 'moz-extension://test/src/boundary-model-weights.bin']);
  const reference = require('../src/backend/inference.js');
  for (const { text } of require('./model-backend-reference.json').cases) {
    assert.deepEqual(Array.from(context.HaoduModelBackend.scoreTokens(Array.from(text))), reference.scoreTokens(Array.from(text)));
  }
  const chunker = require('../src/backend/chunker.js');
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { id: 1, offsetsByText: chunker.process(texts) },
    { id: 2, offsetsByText: chunker.process([texts[0]]) },
  ]);
});

test('Firefox model load failure replies to waiting requests without processing partial data', async () => {
  const { context, messages } = worker(async () => ({ ok: false }));
  await context.onmessage({ data: { id: 9, texts: ['中文内容'] } });
  assert.equal(messages[0].id, 9);
  assert.match(messages[0].error, /model data could not be loaded/);
  assert.equal(messages[0].offsetsByText, undefined);
});
