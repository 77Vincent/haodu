"use strict";

const toggle = document.getElementById("reader-toggle");
const label = document.getElementById("reader-toggle-label");
let enabled = false;
let pending = false;
let revision = 0;

function render() {
  toggle.setAttribute("aria-checked", String(enabled));
  label.textContent = enabled ? "开启" : "关闭";
}

async function showShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    document.getElementById("reader-shortcut").textContent =
      commands.find((command) => command.name === "haodu-toggle")?.shortcut || "未设置";
    document.getElementById("shortcut-hint").hidden = false;
  } catch (error) {
    // A shortcut lookup failure must not prevent the switch from working.
    console.warn("[haodu] Could not read shortcut:", error.message);
  }
}

// Subscribe before the first read so a shortcut change cannot be lost
// while the popup is loading. Only the background writes the global setting.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return;
  revision += 1;
  enabled = changes.enabled.newValue === true;
  render();
});

async function requestState(next) {
  if (pending) return;
  pending = true;
  toggle.disabled = true;
  const startRevision = revision;
  try {
    const response = await chrome.runtime.sendMessage(next === undefined
      ? { type: "HAODU_GET_ENABLED" }
      : { type: "HAODU_SET_ENABLED", enabled: next });
    if (typeof response?.enabled !== "boolean") throw new Error(response?.error || "State unavailable");
    if (revision === startRevision) enabled = response.enabled;
    render();
    toggle.title = "";
    toggle.disabled = false;
  } catch (error) {
    // Keep the last confirmed state. Reopen the popup to retry an initial read.
    toggle.title = "暂时无法同步状态，请重新打开面板";
    toggle.disabled = next === undefined;
    console.warn("[haodu] Could not sync popup:", error.message);
  } finally {
    pending = false;
  }
}

toggle.addEventListener("click", () => { void requestState(!enabled); });
void requestState();
void showShortcut();
