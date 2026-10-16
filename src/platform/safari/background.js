"use strict";

// Safari runs the shared background in a nonpersistent document, which can
// create Workers directly. Reopening the document recreates this lazy service;
// settings are restored by the shared background from storage.local.
Haodu.backgroundHost = (() => {
  const service = Haodu.createInferenceService({
    workerUrl: chrome.runtime.getURL("src/inference-worker.js"),
  });
  return {
    async runInference(texts) {
      return { offsetsByText: await service.runInference(texts) };
    },
    supportsUrl(url) {
      // Safari ignores file:// host permissions. Never attempt file injection.
      return url.protocol === "http:" || url.protocol === "https:";
    },
    isPageAccessDenied(error) {
      // WebKit's scripting APIs use this message when website access is denied.
      // Only classify injection failures; model/reader errors remain visible.
      return /\bthis extension does not have access to this tab\.?$/iu.test(error?.message || "");
    },
  };
})();
