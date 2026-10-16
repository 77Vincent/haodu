"use strict";

// Firefox MV3 uses an event page, which can host the shared inference Worker.
Haodu.backgroundHost = (() => {
  const service = Haodu.createInferenceService({
    workerUrl: chrome.runtime.getURL("src/platform/firefox/inference-worker.js"),
  });
  return {
    async runInference(texts) {
      return { offsetsByText: await service.runInference(texts) };
    },
    supportsUrl(url) {
      return ["http:", "https:", "file:"].includes(url.protocol);
    },
    isPageAccessDenied(error) {
      // Firefox also restricts injection on its add-on store and protected pages.
      return /^(?:Missing host permission for the tab|Missing host permission for the frame|Cannot access a privileged URL)\.?$/u.test(error?.message || "");
    },
  };
})();
