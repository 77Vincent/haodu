"use strict";

globalThis.Haodu ??= {};

/** @returns {ReaderAdapter} */
globalThis.Haodu.createReaderAdapter = function createChromeReaderAdapter() {
  return {
    markerStyleUrl: chrome.runtime.getURL("src/content.css"),
    async process(texts) {
      const response = await chrome.runtime.sendMessage({
        type: "HAODU_PROCESS", texts,
      });
      if (response?.error) throw new Error(response.error);
      if (!Array.isArray(response?.offsetsByText) || response.offsetsByText.length !== texts.length) {
        throw new Error("haodu received an incomplete viewport result");
      }
      return response.offsetsByText;
    },
    publishState(state) {
      try {
        void chrome.runtime.sendMessage({ type: "HAODU_STATE", ...state }).catch(() => {});
      } catch (_) { /* An extension reload can invalidate this page's context. */ }
    },
    connect(reader) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === "HAODU_PING") sendResponse(reader.status());
        if (message?.type === "HAODU_SET_DIVIDER_COLOR") {
          Haodu.setMarkerColor(message.color);
          sendResponse({});
          return;
        }
        if (message?.type !== "HAODU_APPLY_SETTING" || typeof message.enabled !== "boolean") return;
        // A demonstration page can opt out so its own marker toggle stays independent.
        const optedOut = document.querySelector('meta[name="haodu"][content="off"]');
        Haodu.setMarkerColor(message.dividerColor);
        sendResponse(reader.toggle(message.enabled && !optedOut));
      });
    },
  };
};
