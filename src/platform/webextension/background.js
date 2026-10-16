"use strict";

const { validHue, normalizeHue, colorForHue } = Haodu.dividerColor;
const { validWidth, normalizeWidth } = Haodu.dividerWidth;

// Shared WebExtension settings, toolbar, page injection and message routing.
const host = Haodu.backgroundHost;
const POPUP_PAGE = "src/popup.html";
let enabled = false;
let dividerHue = 0;
let dividerWidth = 2;
let appearanceWrites = Promise.resolve();
let toggling = false;
let checkingActiveTab = false;
let checkPending = false;
let actionShortcut = "";
const settingsReady = Promise.all([
  chrome.storage.local.get({ enabled: false, dividerHue: 0, dividerWidth: 2 }),
  refreshShortcut(),
]).then(([saved]) => {
  enabled = saved.enabled;
  dividerHue = normalizeHue(saved.dividerHue);
  dividerWidth = normalizeWidth(saved.dividerWidth);
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
      // Resolve from the extension root in both worker and document hosts.
      16: chrome.runtime.getURL(`icons/${icon}-16.png`),
      32: chrome.runtime.getURL(`icons/${icon}-32.png`),
    } }),
    chrome.action.setBadgeText({ tabId, text: error ? "ERR" : "" }),
    chrome.action.setTitle({ tabId, title }),
  ]);
}

async function readerStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "HAODU_PING" }, { frameId: 0 });
  } catch (_) { /* The document may not have a reader yet. */ }
}

async function supportsReader(tab) {
  if (tab?.id == null || tab.discarded || tab.status === "loading" || !/^(https?|file):/u.test(tab.url || "")) return false;
  const url = new URL(tab.url);
  return host.supportsUrl(url);
}

async function injectReader(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/divider-width.js",
        "src/frontend/dom-tree.js", "src/frontend/viewport.js", "src/frontend/visibility.js", "src/frontend/processed-text.js",
        "src/frontend/read.js", "src/frontend/write.js", "src/frontend/content-changes.js", "src/app/reader.js",
        "src/platform/webextension/content.js", "src/start-reader.js",
      ],
    });
    return true;
  } catch (error) {
    // Permissions, policy, or the page itself can change after the URL check.
    if (host.isPageAccessDenied(error)) return false;
    throw error;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function syncSitePreview(tab, activate = false) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // Isolated-world code shares only DOM events/attributes with the site.
      // No site-to-extension messages or access to saved preferences are added.
      func: (shortcut, activate, expectedUrl) => {
        // Navigation must not turn a preview command into a global toggle.
        if (document.URL !== expectedUrl) return true;
        if (!document.querySelector('meta[name="haodu"][content="off"]')) return false;
        const controls = document.querySelector('[data-reader-controls]');
        const toggle = controls?.querySelector('#reader-toggle');
        // Opted-out pages without a preview (privacy, 404) consume the command.
        if (toggle) {
          toggle.dataset.haoduExtensionShortcut = shortcut;
          toggle.dispatchEvent(new Event('haodu:preview-shortcut'));
          if (activate && !controls.hidden && document.hasFocus()) {
            toggle.dispatchEvent(new Event('haodu:preview-toggle'));
          }
        }
        return true;
      },
      args: [actionShortcut, activate, tab.url],
    });
    return result?.result === true;
  } catch (error) {
    // Unknown is not an opt-out: keep global commands available when the browser
    // denies page access, but do not attempt to inject a reader into that page.
    if (host.isPageAccessDenied(error)) return null;
    throw error;
  }
}

async function applyToTab(tab) {
  try {
    if (!await supportsReader(tab)) return;
    if (await syncSitePreview(tab) !== false) return;
    const ready = await readerStatus(tab.id);
    if (!ready) {
      if (!enabled) return;
      if (!await injectReader(tab.id)) return;
    }
    // Injection can outlast a tab switch. Leave that page inert until visited.
    if ((await activeTab())?.id !== tab.id) return;
    const state = await chrome.tabs.sendMessage(tab.id, {
      type: "HAODU_APPLY_SETTING", enabled, dividerColor: colorForHue(dividerHue), dividerWidth,
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
    // Wait for the new document's marker before routing a shortcut. A command
    // during navigation must not accidentally change the global preference.
    if (requestedEnabled === undefined && tab?.status === "loading") return;
    const supported = await supportsReader(tab);
    if (requestedEnabled === undefined && supported) {
      await refreshShortcut();
      if (await syncSitePreview(tab, true) === true) return;
    }
    // Only the active page's task locks this change. Other tabs apply the new
    // setting when visited, without interrupting their current operation.
    if (supported && (await readerStatus(tab.id))?.busy) return;
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
  const update = appearanceWrites.then(async () => {
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
  appearanceWrites = update.catch(() => {});
  return update;
}

function setDividerWidth(width) {
  const update = appearanceWrites.then(async () => {
    await settingsReady;
    if (width === dividerWidth) return;
    await chrome.storage.local.set({ dividerWidth: width });
    dividerWidth = width;
    const tab = await activeTab();
    if (!await supportsReader(tab)) return;
    // Resize only existing markers, just as color changes do.
    await chrome.tabs.sendMessage(tab.id, {
      type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth: width,
    }, { frameId: 0 }).catch(() => {});
  });
  appearanceWrites = update.catch(() => {});
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
    const isWidth = message?.type === "HAODU_SET_DIVIDER_WIDTH" && validWidth(message.dividerWidth);
    if (!isSet && !isColor && !isWidth && message?.type !== "HAODU_GET_ENABLED") return;
    void settingsReady.then(async () => {
      if (isSet) await toggleGlobal(undefined, message.enabled);
      if (isColor) await setDividerHue(message.dividerHue);
      if (isWidth) await setDividerWidth(message.dividerWidth);
      return { enabled, dividerHue, dividerWidth };
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
  void host.runInference(message.texts).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
