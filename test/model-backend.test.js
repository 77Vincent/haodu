const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const backend = require("../src/backend/inference.js");
const modelData = require("../src/boundary-model-data.js");
const reference = require("./model-backend-reference.json");

const projectRoot = join(__dirname, "..");

test("browser backend loads the validation-selected multi-cut checkpoint", () => {
  const info = backend.getModelInfo();
  assert.equal(info.task, "multi");
  assert.equal(info.checkpointSha256, reference.checkpointSha256);
  assert.equal(info.trainedSamples, reference.trainedSamples);
  assert.equal(modelData.sourceEpoch, reference.sourceEpoch);
  assert.equal(modelData.exportedState, "model_state");
  assert.equal(info.vocabularySize, reference.vocabularySize);
  assert.equal(info.channels, 192);
  assert.equal(info.convolutionLayers, 16);
  assert.equal(modelData.multiCut.threshold, reference.threshold);
  const settings = require('../src/backend/chunker.js').getSettings();
  assert.equal(settings.task, 'multi');
  assert.equal(settings.recursion, false);
  assert.equal(settings.min_visual_length, null);
  assert.equal(settings.max_model_window_tokens, 64);
});

test("browser logits and sigmoid decisions match independent PyTorch references", () => {
  const sigmoid = x => Math.fround(1 / (1 + Math.exp(-x)));
  for (const example of reference.cases) {
    const scores = backend.scoreTokens(Array.from(example.text));
    assert.equal(scores.length, example.scores.length);
    scores.forEach((score, i) => {
      const tolerance = 2e-5 + 4e-6 * Math.abs(example.scores[i]);
      assert.ok(Math.abs(score - example.scores[i]) < tolerance, `${example.text}, gap ${i}`);
      for (const expected of [example.scores[i], example.float32Scores[i]]) {
        assert.ok(Math.abs(sigmoid(score) - sigmoid(expected)) < 2e-5, `${example.text}, probability ${i}`);
        assert.equal(sigmoid(score) >= Math.fround(reference.threshold),
          sigmoid(expected) >= Math.fround(reference.threshold), `${example.text}, cut ${i}`);
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
