"use strict";

importScripts("../../divider-color.js");
const { validHue, normalizeHue, colorForHue } = Haodu.dividerColor;

// Chrome entry point: toolbar, script loading, routing, and offscreen host.
const INFERENCE_PAGE = "src/inference.html";
const POPUP_PAGE = "src/popup.html";
let creatingInferencePage = null;
let enabled = false;
let dividerHue = 0;
let colorWrites = Promise.resolve();
let toggling = false;
let checkingActiveTab = false;
let checkPending = false;
let actionShortcut = "";
const settingsReady = Promise.all([
  chrome.storage.local.get({ enabled: false, dividerHue: 0 }),
  refreshShortcut(),
]).then(([saved]) => {
  enabled = saved.enabled;
  dividerHue = normalizeHue(saved.dividerHue);
  return updateAction();
});

async function refreshShortcut() {
  // Use the active binding, not the suggestion: users can change or clear it.
  const commands = await chrome.commands.getAll().catch(() => []);
  actionShortcut = commands.find((command) => command.name === "haodu-toggle")?.shortcut || "";
}

function updateAction(tabId, error) {
  // Busy is a click lock, not a visual state.
  const shortcutHint = actionShortcut ? ` / ${actionShortcut} 切换` : "";
  const title = error || `好读（${enabled ? "已开启" : "已关闭"}${shortcutHint}）`;
  const icon = enabled ? "on" : "off";
  return Promise.all([
    chrome.action.setIcon({ tabId, path: {
      // setIcon fetches relative to this worker, which lives in a subdirectory.
      16: chrome.runtime.getURL(`icons/${icon}-16.png`),
      32: chrome.runtime.getURL(`icons/${icon}-32.png`),
    } }),
    chrome.action.setBadgeText({ tabId, text: error ? "ERR" : "" }),
    chrome.action.setTitle({ tabId, title }),
  ]);
}

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

async function readerStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "HAODU_PING" }, { frameId: 0 });
  } catch (_) { /* The document may not have a reader yet. */ }
}

async function supportsReader(tab) {
  if (tab?.id == null || tab.discarded || tab.status === "loading" || !/^(https?|file):/u.test(tab.url || "")) return false;
  const url = new URL(tab.url);
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

async function injectReader(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/frontend/dom-tree.js", "src/frontend/viewport.js", "src/frontend/visibility.js", "src/frontend/processed-text.js",
        "src/frontend/read.js", "src/frontend/write.js", "src/frontend/content-changes.js", "src/app/reader.js",
        "src/platform/chrome/content.js", "src/start-reader.js",
      ],
    });
    return true;
  } catch (error) {
    // Permissions, policy, or the page itself can change after the URL check.
    if (isPageAccessDenied(error)) return false;
    throw error;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function applyToTab(tab) {
  try {
    if (!await supportsReader(tab)) return;
    const ready = await readerStatus(tab.id);
    if (!ready) {
      if (!enabled) return;
      if (!await injectReader(tab.id)) return;
    }
    // Injection can outlast a tab switch. Leave that page inert until visited.
    if ((await activeTab())?.id !== tab.id) return;
    const state = await chrome.tabs.sendMessage(tab.id, {
      type: "HAODU_APPLY_SETTING", enabled, dividerColor: colorForHue(dividerHue),
    }, { frameId: 0 });
    // A successful reply can predate an error already published by the reader.
    // Only restore a retained error here; transitions publish their own state.
    if (state?.error) await updateAction(tab.id, enabled ? state.error : null);
  } catch (error) {
    await updateAction(tab.id, error.message).catch(() => {});
  }
}

async function applyToActiveTab() {
  checkPending = true;
  if (checkingActiveTab) return;
  checkingActiveTab = true;
  try {
    await settingsReady;
    while (checkPending) {
      checkPending = false;
      // A reload or focus event during a check requests another check of the
      // latest document in the focused tab. Intermediate tabs aren't queued.
      const tab = await activeTab();
      if (!tab) continue;
      await refreshShortcut();
      await updateAction(tab.id);
      await applyToTab(tab);
    }
  } finally {
    checkingActiveTab = false;
  }
}

async function toggleGlobal(tab, requestedEnabled) {
  if (toggling) return;
  toggling = true;
  try {
    await settingsReady;
    tab ??= await activeTab();
    // Only the active page's task locks this change. Other tabs apply the new
    // setting when visited, without interrupting their current operation.
    if (await supportsReader(tab) && (await readerStatus(tab.id))?.busy) return;
    const next = requestedEnabled ?? !enabled;
    if (next === enabled) return;
    await chrome.storage.local.set({ enabled: next });
    enabled = next;
    await updateAction();
    await applyToActiveTab();
  } catch (error) {
    await updateAction(tab?.id, error.message).catch(() => {});
  } finally {
    toggling = false;
  }
}

function setDividerHue(hue) {
  const update = colorWrites.then(async () => {
    await settingsReady;
    if (hue === dividerHue) return;
    await chrome.storage.local.set({ dividerHue: hue });
    dividerHue = hue;
    const tab = await activeTab();
    if (!await supportsReader(tab)) return;
    // Only recolor an existing reader. Never inject, toggle, or run inference.
    await chrome.tabs.sendMessage(tab.id, {
      type: "HAODU_SET_DIVIDER_COLOR", color: colorForHue(hue),
    }, { frameId: 0 }).catch(() => {});
  });
  colorWrites = update.catch(() => {});
  return update;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "haodu-toggle") void toggleGlobal(tab);
});
chrome.tabs.onActivated.addListener(() => { void applyToActiveTab().catch(() => {}); });
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) void applyToActiveTab().catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "loading") void settingsReady.then(() => updateAction(tabId)).catch(() => {});
  if (change.status === "complete" && tab.active) void applyToActiveTab().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { void applyToActiveTab().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void applyToActiveTab().catch(() => {}); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(POPUP_PAGE)) {
    const isSet = message?.type === "HAODU_SET_ENABLED" && typeof message.enabled === "boolean";
    const isColor = message?.type === "HAODU_SET_DIVIDER_HUE" && validHue(message.dividerHue);
    if (!isSet && !isColor && message?.type !== "HAODU_GET_ENABLED") return;
    void settingsReady.then(async () => {
      if (isSet) await toggleGlobal(undefined, message.enabled);
      if (isColor) await setDividerHue(message.dividerHue);
      return { enabled, dividerHue };
    }).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || sender.tab?.id == null || sender.frameId !== 0) return;
  if (message?.type === "HAODU_STATE") {
    // Page failures don't change the saved global preference or other pages.
    void settingsReady.then(() => updateAction(sender.tab.id, enabled ? message.error : null)).catch(() => {});
    sendResponse({});
  }
  if (message?.type !== "HAODU_PROCESS") return;
  void runInference(message.texts).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
