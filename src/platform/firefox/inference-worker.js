"use strict";

// AMO requires the large weight table to be data, rather than executable JS.
// Fetch only a packaged extension resource; never send page text over a network.
let initializationError;
async function modelResource(path, format) {
  const response = await fetch(new URL(path, self.location.href));
  if (!response.ok) throw new Error("haodu model data could not be loaded");
  return response[format]();
}
const ready = Promise.all([
  modelResource("../../boundary-model-data.json", "json"),
  modelResource("../../boundary-model-weights.bin", "arrayBuffer"),
])
  .then(([data, weights]) => {
    data.weightsBytes = new Uint8Array(weights);
    globalThis.HaoduBoundaryModelData = data;
    importScripts("../../backend/inference.js", "../../backend/chunker.js");
  })
  .catch((error) => { initializationError = error; });

self.onmessage = async (event) => {
  const id = event.data?.id;
  try {
    await ready;
    if (initializationError) throw initializationError;
    self.postMessage({ id, offsetsByText: globalThis.HaoduChunker.process(event.data.texts) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
