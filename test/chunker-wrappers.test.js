const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const realChunker = require("../src/backend/chunker.js");
const source = readFileSync(join(__dirname, "../src/backend/chunker.js"), "utf8");
const inner = "甲乙丙丁戊己庚辛壬癸子丑寅";

function withScores(scoreTokens) {
  const context = vm.createContext({ Intl, HaoduModelBackend: {
    scoreTokens, getModelInfo: () => ({ inputRepresentation: "unicode-context-v1" }),
  } });
  vm.runInContext(source, context);
  return context.HaoduChunker;
}

test("each supported enclosing Chinese pair stays in the output and outside inference", () => {
  for (const [opening, closing] of [
    ["“", "”"], ["‘", "’"], ["（", "）"], ["《", "》"],
    ["〈", "〉"], ["【", "】"], ["「", "」"], ["『", "』"],
  ]) {
    const inputs = [];
    const chunker = withScores((tokens) => {
      inputs.push(tokens.join(""));
      return tokens.slice(1).map((_, i) => i === 5 ? 100 : 0);
    });
    const input = opening + inner + closing;
    const chunks = Array.from(chunker.chunkText(input, { segmenter: null }));
    assert.deepEqual(inputs, [inner], input);
    assert.deepEqual(chunks, [opening + inner.slice(0, 6), inner.slice(6) + closing], input);
    assert.equal(chunks.join(""), input);
  }
});

test("nested enclosing pairs are peeled together without changing source offsets", () => {
  const inputs = [];
  const chunker = withScores((tokens) => {
    inputs.push(tokens.join(""));
    return tokens.slice(1).map((_, i) => i === 5 ? 100 : 0);
  });
  const input = `【“${inner}”】`;
  assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })),
    [`【“${inner.slice(0, 6)}`, `${inner.slice(6)}”】`]);
  assert.deepEqual(inputs, [inner]);
});

test("an enclosing pair exposed by a parent split is peeled before child inference", () => {
  const prefix = "前面的内容说明";
  const input = `${prefix}“${inner}”`;
  const inputs = [];
  const chunker = withScores((tokens) => {
    inputs.push(tokens.join(""));
    const target = tokens[0] === "前" ? prefix.length - 1 : 5;
    return tokens.slice(1).map((_, i) => i === target ? 100 : 0);
  });
  assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })),
    [prefix, `“${inner.slice(0, 6)}`, `${inner.slice(6)}”`]);
  assert.deepEqual(inputs, [input, inner]);
});

test("matching ends from separate pairs and mismatched nesting are not peeled", () => {
  for (const input of [
    `“${inner}”和“${inner}”`, `“${inner}（结尾”`, `（${inner}】`,
    `【“${inner}】`, `“${inner}”末尾”`,
  ]) {
    const inputs = [];
    const chunker = withScores((tokens) => {
      inputs.push(tokens.join(""));
      return tokens.slice(1).map(() => 0);
    });
    assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })), [input]);
    assert.deepEqual(inputs, [input.normalize("NFKC")]);
  }
});

test("ASCII pairs stay in inference and short Chinese interiors skip inference", () => {
  for (const input of [`"${inner}"`, `(${inner})`]) {
    const inputs = [];
    const chunker = withScores((tokens) => {
      inputs.push(tokens.join(""));
      return tokens.slice(1).map(() => 0);
    });
    assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })), [input]);
    assert.deepEqual(inputs, [input]);
  }
  const chunker = withScores(() => { throw new Error("short interiors must not be scored"); });
  const input = `【“${inner.slice(0, 12)}”】`;
  assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })), [input]);
});

test("Greek letters and quote edges can be model boundaries without the retired Han-only rule", () => {
  for (const snippet of ["｜α辐射", "｜“引文”", "“引文”｜", "｜AI研究"]) {
    const marked = inner + snippet + inner;
    const offset = marked.indexOf("｜");
    const input = marked.replace("｜", "");
    const target = realChunker.tokenizeContext(input).findIndex((token) => token.index === offset) - 1;
    const chunker = withScores((tokens) => tokens.slice(1).map((_, i) => (
      tokens.length === Array.from(input).length && i === target ? 100 : 0
    )));
    assert.deepEqual(Array.from(chunker.chunkText(input, { segmenter: null })),
      [input.slice(0, offset), input.slice(offset)], snippet);
  }
});

test("NFKC expansion gaps remain forbidden and supplementary Han offsets remain intact", () => {
  const input = `“𠮷${inner}ﬃ${inner}”`;
  const normalized = realChunker.tokenizeContext(input).slice(1, -1);
  const expansionGap = normalized.findIndex((token, i) => normalized[i + 1]?.index === token.index);
  assert.ok(expansionGap >= 0);
  const blocked = withScores((tokens) => tokens.slice(1).map((_, i) => i === expansionGap ? 100 : 0));
  assert.deepEqual(Array.from(blocked.chunkText(input, { segmenter: null })), [input]);
  const chunker = withScores((tokens) => tokens.slice(1).map((_, i) => (
    tokens[0] === "𠮷" && i === 5 ? 100 : 0
  )));
  const chunks = Array.from(chunker.chunkText(input, { segmenter: null }));
  assert.equal(chunks[0], `“𠮷${inner.slice(0, 5)}`);
  assert.equal(chunks.join(""), input);
});

test("the reported citation example does not emit a standalone left quote with E6", () => {
  const input = "回溯法关注的是研究报告后面的参考文献列表而引文检索关注的是“有什么文献引用了本篇相关研究”";
  const chunks = realChunker.chunkText(input);
  assert.equal(chunks.join(""), input);
  assert.ok(chunks.some((part) => part.startsWith("“有")));
  assert.ok(chunks.every((part) => part !== "“" && part !== "”"));
});
