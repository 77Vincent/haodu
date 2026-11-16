const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const backend = require("../src/backend/inference.js");
const modelData = require("../src/boundary-model-data.js");
const reference = require("./model-backend-reference.json");

const projectRoot = join(__dirname, "..");

test("browser backend loads the promoted 5.25-billion-sample single-cut checkpoint", () => {
  const info = backend.getModelInfo();
  assert.equal(info.task, "single");
  assert.equal(reference.task, "single");
  assert.equal(info.trainedSamples, 5250006027);
  assert.equal(info.checkpointSha256, reference.checkpointSha256);
  assert.equal(info.trainedSamples, reference.trainedSamples);
  assert.equal(modelData.sourceEpoch, reference.sourceEpoch);
  assert.equal(modelData.exportedState, "model_state");
  assert.equal(info.vocabularySize, reference.vocabularySize);
  assert.equal(info.channels, 192);
  assert.equal(info.convolutionLayers, 16);
  assert.equal(modelData.multiCut, undefined, 'single-cut has no sigmoid threshold override');
  const settings = require('../src/backend/chunker.js').getSettings();
  assert.equal(settings.task, 'single');
  assert.equal(settings.recursion, true);
  assert.equal(settings.min_visual_length, 13);
  assert.equal(settings.min_confidence, .45);
  assert.equal(settings.word_protection, 'Intl.Segmenter zh-CN');
  assert.equal(settings.max_model_window_tokens, 256);
});

test("browser logits and softmax decisions match independent PyTorch references", () => {
  const chunker = require('../src/backend/chunker.js');
  const probabilities = scores => {
    const max = Math.max(...scores);
    const weights = scores.map(x => Math.exp(x - max));
    const total = weights.reduce((sum, x) => sum + x, 0);
    return weights.map(x => x / total);
  };
  for (const example of reference.cases) {
    const scores = backend.scoreTokens(Array.from(example.text));
    assert.equal(scores.length, example.scores.length);
    const actualProbabilities = chunker.gapProbabilities(scores);
    const expectedProbabilities = [example.scores, example.float32Scores].map(probabilities);
    for (const expected of [example.scores, example.float32Scores]) {
      assert.equal(chunker.selectBestBoundary(scores), expected.indexOf(Math.max(...expected)),
        `${example.text}, top gap`);
    }
    scores.forEach((score, i) => {
      for (const expected of [example.scores[i], example.float32Scores[i]]) {
        const tolerance = 2e-5 + 4e-6 * Math.abs(expected);
        assert.ok(Math.abs(score - expected) < tolerance, `${example.text}, gap ${i}`);
      }
      for (const expected of expectedProbabilities) {
        assert.ok(Math.abs(actualProbabilities[i] - expected[i]) < 2e-5, `${example.text}, probability ${i}`);
        assert.equal(actualProbabilities[i] > chunker.MIN_SPLIT_CONFIDENCE,
          expected[i] > chunker.MIN_SPLIT_CONFIDENCE, `${example.text}, confidence gate ${i}`);
      }
    });
  }
});

test("runtime inference contains no handwritten Chinese lexical rules", () => {
  const implementation = ["src/backend/chunker.js", "src/backend/inference.js"]
    .map((path) => readFileSync(join(projectRoot, path), "utf8"))
    .join("\n");

  assert.doesNotMatch(implementation, /\p{Script=Han}/u);
  assert.doesNotMatch(
    implementation,
    /lexicon|dictionary|wordOverrides|buildStableUnits|shouldMerge/iu,
  );
});
