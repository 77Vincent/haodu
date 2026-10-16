"use strict";

importScripts("../../divider-color.js", "../../divider-width.js");
const INFERENCE_PAGE = "src/inference.html";
let creatingInferencePage = null;

async function ensureInferencePage() {
  if (creatingInferencePage) return creatingInferencePage;
  creatingInferencePage = (async () => {
    const url = chrome.runtime.getURL(INFERENCE_PAGE);
    const contexts = typeof chrome.runtime.getContexts === "function"
      ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })
      : (await clients.matchAll()).filter((client) => client.url === url);
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: INFERENCE_PAGE, reasons: ["WORKERS"],
        justification: "Run the bundled boundary model outside web pages",
      });
    }
  })();
  try {
    await creatingInferencePage;
  } finally {
    creatingInferencePage = null;
  }
}

async function runInference(texts) {
  await ensureInferencePage();
  return chrome.runtime.sendMessage({
    target: "offscreen", type: "HAODU_RUN_INFERENCE", texts,
  });
}

async function supportsUrl(url) {
  const host = url.hostname.replace(/\.$/u, "");
  // Chrome protects both Web Store domains, including their subdomains.
  if (["chrome.google.com", "webstore.google.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  return url.protocol !== "file:" || await chrome.extension.isAllowedFileSchemeAccess();
}

function isPageAccessDenied(error) {
  // Scripting API rejections have messages, not typed error codes. Restrict
  // this classification to injection; reader/model errors must remain visible.
  const message = error?.message || "";
  return message.startsWith("Cannot access contents of ") || [
    "The extensions gallery cannot be scripted.",
    "The New Tab Page cannot be scripted.",
    "Cannot access a chrome:// URL",
    "Cannot access a chrome-extension:// URL of different extension",
    "This page cannot be scripted due to an ExtensionsSettings policy.",
    "Blocked",
  ].includes(message);
}

Haodu.backgroundHost = { runInference, supportsUrl, isPageAccessDenied };
importScripts("../webextension/background.js");
