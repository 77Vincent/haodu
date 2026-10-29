const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const realChunker = require("../src/backend/chunker.js");
const source = readFileSync(join(__dirname, "../src/backend/chunker.js"), "utf8");
const english = "Hi everyone, Please review and update the following tasks for the 27.4.0 EU New ECWH project: 1. Owner Confirmation";
const chinese = "𠮷甲乙丙丁戊己庚辛壬癸子丑";

function withScores(scoreTokens) {
  const context = vm.createContext({ Intl, HaoduModelBackend: {
    scoreTokens, getModelInfo: () => ({ inputRepresentation: "unicode-context-v1" }),
  } });
  vm.runInContext(source, context);
  return context.HaoduChunker;
}

test("non-Han clauses skip inference even when long or abstention is disabled", () => {
  const chunker = withScores(() => assert.fail("non-Han text must not reach the model"));
  for (const input of [english, `“${english}”`, `🌈 αβγ ${english}`,
    "1 2 3 4 5 6 7 8 9 10 11 12 13 14", "Ａ Ｂ Ｃ Ｄ Ｅ Ｆ Ｇ Ｈ Ｉ Ｊ Ｋ Ｌ Ｍ"]) {
    assert.ok(chunker.visualLength(input) >= 13);
    for (const minConfidence of [undefined, 0]) {
      assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null, minConfidence })), [input]);
      assert.deepEqual(Array.from(chunker.process([input], { minConfidence })[0]), []);
    }
  }
});

test("English clauses inside a Han-containing node stay intact and preserve source offsets", () => {
  for (const delimiter of ["\n", "。", "、", "："]) {
    const inputs = [];
    const chunker = withScores((tokens) => {
      inputs.push(tokens.join(""));
      return tokens.slice(1).map((_, i) => i === 0 ? 100 : 0);
    });
    const prefix = `说明${delimiter}${english}${delimiter}`;
    const input = prefix + chinese;
    const offset = prefix.length + "𠮷".length;
    assert.deepEqual(Array.from(chunker.process([input])[0]), [offset], delimiter);
    assert.equal(inputs.length, 1, "only the Chinese clause receives inference");
    assert.equal(inputs[0], chinese);
    assert.equal(Array.from(chunker.chunkText(input)).join(""), input);
  }
});

test("recursive non-Han children skip inference on either side of a mixed clause", () => {
  for (const [left, right] of [[english + " ", chinese], [chinese, " " + english]]) {
    const input = left + right;
    const inputs = [];
    const target = realChunker.tokenizeContext(input).findIndex((token) => token.index === left.length) - 1;
    const chunker = withScores((tokens) => {
      const fragment = tokens.join("");
      inputs.push(fragment);
      assert.ok(/\p{Script=Han}/u.test(fragment), "recursive English child reached inference");
      return tokens.slice(1).map((_, i) => fragment === input && i === target ? 100 : 0);
    });
    assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })), [left, right]);
    assert.deepEqual(inputs, [input, chinese]);
  }
});

test("the bundled model leaves the reported English notification intact", () => {
  assert.deepEqual(realChunker.chunkText(english), [english]);
  assert.deepEqual(realChunker.process([english, english + "\n请及时更新任务状态"]), [[], []]);
});
