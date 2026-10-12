(function startInference() {
  "use strict";
  // Shared inference-host startup; the loaded adapter supplies the implementation.
  const adapter = globalThis.Haodu.createInferenceAdapter();
  const service = globalThis.Haodu.createInferenceService({ workerUrl: adapter.workerUrl });
  adapter.connect(service);
})();
