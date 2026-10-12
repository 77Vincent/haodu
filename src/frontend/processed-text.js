(function defineProcessedText() {
  "use strict";

  globalThis.Haodu ??= {};
  if (globalThis.Haodu.isProcessedText) return;

  // Weak keys allow removed text nodes to be collected. No page markup is added.
  let processedNodes = new WeakMap();

  globalThis.Haodu.isProcessedText = function isProcessedText(node) {
    const previous = processedNodes.get(node);
    return previous !== undefined && previous.text === node.nodeValue && previous.parent === node.parentNode;
  };

  globalThis.Haodu.rememberProcessedText = function rememberProcessedText(nodes) {
    for (const node of nodes) {
      processedNodes.set(node, { text: node.nodeValue, parent: node.parentNode });
    }
  };

  globalThis.Haodu.clearProcessedText = function clearProcessedText() {
    processedNodes = new WeakMap();
  };

  globalThis.Haodu.forgetProcessedText = function forgetProcessedText(nodes) {
    for (const node of nodes) processedNodes.delete(node);
  };
})();
