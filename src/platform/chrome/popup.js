"use strict";

const toggle = document.getElementById("reader-toggle");
const label = document.getElementById("reader-toggle-state");
const hueSlider = document.getElementById("divider-hue");
const { normalizeHue, validHue, colorForHue, gradient } = Haodu.dividerColor;
let confirmedHue = 0;
let colorRevision = 0;
let colorEdit = 0;
let colorPending = 0;
let enabled = false;
let pending = false;
let revision = 0;
document.body.style.setProperty("--divider-spectrum", gradient);

function renderHue(hue) {
  hueSlider.value = String(hue);
  const color = colorForHue(hue);
  document.body.style.setProperty("--selected-divider-color", color);
  hueSlider.setAttribute("aria-valuetext", color);
}

async function saveHue() {
  const hue = Number(hueSlider.value);
  const edit = ++colorEdit;
  colorPending += 1;
  renderHue(hue);
  try {
    // Send every input immediately: closing the popup must not lose a final
    // value waiting in a popup-owned timer. The background serializes writes.
    const response = await chrome.runtime.sendMessage({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: hue });
    if (!validHue(response?.dividerHue)) throw new Error(response?.error || "Color unavailable");
    if (edit === colorEdit) {
      confirmedHue = response.dividerHue;
      renderHue(confirmedHue);
      hueSlider.title = "拖动调整分隔线颜色";
    }
  } catch (error) {
    if (edit === colorEdit) {
      renderHue(confirmedHue);
      hueSlider.title = "颜色保存失败，请重试";
    }
    console.warn("[haodu] Could not save color:", error.message);
  } finally {
    colorPending -= 1;
  }
}

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
  if (area !== "local") return;
  if (changes.enabled) {
    revision += 1;
    enabled = changes.enabled.newValue === true;
    render();
  }
  if (changes.dividerHue) {
    colorRevision += 1;
    confirmedHue = normalizeHue(changes.dividerHue.newValue);
    if (!colorPending) renderHue(confirmedHue);
  }
});

async function requestState(next) {
  if (pending) return;
  pending = true;
  toggle.disabled = true;
  const startRevision = revision;
  const startColorRevision = colorRevision;
  try {
    const response = await chrome.runtime.sendMessage(next === undefined
      ? { type: "HAODU_GET_ENABLED" }
      : { type: "HAODU_SET_ENABLED", enabled: next });
    if (typeof response?.enabled !== "boolean") throw new Error(response?.error || "State unavailable");
    if (revision === startRevision) enabled = response.enabled;
    render();
    if (next === undefined) {
      if (colorRevision === startColorRevision) confirmedHue = normalizeHue(response.dividerHue);
      renderHue(confirmedHue);
      hueSlider.disabled = false;
    }
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
hueSlider.addEventListener("input", () => { void saveHue(); });
void requestState();
void showShortcut();
