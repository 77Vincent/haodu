"use strict";

importScripts("boundary-model-data.js", "backend/inference.js", "backend/clauses.js", "backend/single-cut.js", "backend/multicut-input.js", "backend/multicut.js", "backend/chunker.js");

// Each message is a complete viewport. The backend only sees text data.
self.onmessage = (event) => {
  const id = event.data?.id;
  try {
    self.postMessage({
      id,
      offsetsByText: globalThis.HaoduChunker.process(event.data.texts),
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
