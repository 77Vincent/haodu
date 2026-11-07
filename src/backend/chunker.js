// Shared entry point for extension workers, Node callers and the benchmark.
(function expose(root) {
  "use strict";
  const commonJS = typeof module === "object" && module.exports;
  const data = commonJS ? require("../boundary-model-data.js") : root.HaoduBoundaryModelData;
  const model = commonJS ? require("./inference.js") : root.HaoduModelBackend;
  const task = data?.task || "single";
  let api;
  if (task === "multi") {
    const decoder = commonJS ? require("./multicut.js") : root.HaoduMultiCut;
    api = decoder.createChunker(data, model);
  } else if (task === "single") {
    const decoder = commonJS ? require("./single-cut.js") : root.HaoduSingleCut;
    api = decoder.createChunker(model);
  } else {
    throw new Error(`Unsupported model task: ${task}`);
  }
  if (commonJS) module.exports = api;
  root.HaoduChunker = api;
})(globalThis);
