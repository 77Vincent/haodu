"use strict";

globalThis.Haodu ??= {};

/** @returns {InferenceAdapter} */
globalThis.Haodu.createInferenceAdapter = function createChromeInferenceAdapter() {
  return {
    workerUrl: chrome.runtime.getURL("src/inference-worker.js"),
    connect(service) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.target !== "offscreen" || message?.type !== "HAODU_RUN_INFERENCE") {
          return undefined;
        }
        if (sender.id !== chrome.runtime.id) return false;

        void service.runInference(message.texts).then(
          (offsetsByText) => sendResponse({ offsetsByText }),
          (error) => sendResponse({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return true;
      });
    },
  };
};
