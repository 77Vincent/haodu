const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const drain = () => new Promise((resolve) => setImmediate(resolve));

function createPopup({ shortcut = "Alt+Shift+U", shortcutError = false } = {}) {
  let click, storageChanged, hueInput;
  const requests = [];
  const warnings = [];
  const label = { textContent: "关闭" };
  const shortcutText = { textContent: "" };
  const shortcutHint = { hidden: true };
  const hue = {
    value: "0", disabled: true, title: "", attributes: {},
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { assert.equal(name, "input"); hueInput = callback; },
  };
  const toggle = {
    disabled: true, title: "", checked: "false",
    setAttribute(name, value) { assert.equal(name, "aria-checked"); this.checked = value; },
    addEventListener(name, callback) { assert.equal(name, "click"); click = callback; },
  };
  const context = vm.createContext({
    document: { body: { style: { setProperty() {} } }, getElementById: (id) => {
      if (id === "reader-toggle-label") return label;
      if (id === "reader-shortcut") return shortcutText;
      if (id === "shortcut-hint") return shortcutHint;
      if (id === "divider-hue") return hue;
      assert.equal(id, "reader-toggle");
      return toggle;
    } },
    console: { warn: (...args) => warnings.push(args) },
    chrome: {
      commands: { async getAll() {
        if (shortcutError) throw new Error("Commands unavailable");
        return [{ name: "other-command", shortcut: "Ctrl+Shift+X" }, { name: "haodu-toggle", shortcut }];
      } },
      storage: { onChanged: { addListener: (callback) => { storageChanged = callback; } } },
      runtime: { sendMessage: (request) => new Promise((resolve, reject) => {
        requests.push({ ...request, resolve, reject });
      }) },
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "../src/divider-color.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "../src/platform/chrome/popup.js"), "utf8"), context);
  return { toggle, label, hue, shortcutText, shortcutHint, requests, warnings, click: () => click(),
    inputHue(value) { hue.value = String(value); hueInput(); },
    changeHue(value) { storageChanged({ dividerHue: { newValue: value } }, "local"); },
    change(value, area = "local") { storageChanged({ enabled: { newValue: value } }, area); },
  };
}

test("the popup reads without toggling and prevents duplicate requests until a change is confirmed", async () => {
  const popup = createPopup();
  assert.equal(popup.requests[0].type, "HAODU_GET_ENABLED");
  assert.equal(popup.toggle.disabled, true);
  popup.requests[0].resolve({ enabled: false });
  await drain();
  assert.equal(popup.toggle.disabled, false);
  popup.click();
  popup.click();
  assert.equal(popup.requests.length, 2);
  assert.equal(popup.requests[1].type, "HAODU_SET_ENABLED");
  assert.equal(popup.requests[1].enabled, true);
  assert.equal(popup.toggle.checked, "false", "do not show a change before the background accepts it");
  assert.equal(popup.label.textContent, "关闭");
  popup.requests[1].resolve({ enabled: false }); // Reader is busy; toggle was ignored.
  await drain();
  assert.equal(popup.toggle.checked, "false");
  assert.equal(popup.toggle.disabled, false);
  popup.click();
  popup.requests[2].resolve({ enabled: true });
  await drain();
  assert.equal(popup.toggle.checked, "true");
  assert.equal(popup.label.textContent, "开启");
  popup.click();
  assert.equal(popup.requests[3].enabled, false);
  popup.requests[3].resolve({ enabled: false });
  await drain();
  assert.equal(popup.toggle.checked, "false");
  assert.equal(popup.label.textContent, "关闭");
});

test("the color band restores a saved hue and does not save or toggle merely on opening", async () => {
  const popup = createPopup();
  popup.changeHue(180);
  popup.requests[0].resolve({ enabled: false, dividerHue: 0 });
  await drain();
  assert.equal(popup.hue.value, "180", "a newer storage event beats a stale initial reply");
  assert.equal(popup.hue.disabled, false);
  assert.equal(popup.requests.length, 1);
  popup.changeHue(undefined);
  assert.equal(popup.hue.value, "0");
  assert.equal(popup.hue.style["--selected-divider-color"], "#ff1744");
});

test("dragging sends the final color immediately and earlier replies do not move the thumb back", async () => {
  const popup = createPopup();
  popup.requests[0].resolve({ enabled: true, dividerHue: 0 });
  await drain();
  popup.inputHue(80);
  popup.inputHue(180);
  assert.equal(popup.requests[1].type, "HAODU_SET_DIVIDER_HUE");
  assert.equal(popup.requests[2].dividerHue, 180);
  popup.changeHue(80);
  popup.requests[1].resolve({ dividerHue: 80 });
  await drain();
  assert.equal(popup.hue.value, "180");
  popup.changeHue(180);
  popup.requests[2].resolve({ dividerHue: 180 });
  await drain();
  assert.equal(popup.hue.value, "180");
  assert.equal(popup.toggle.checked, "true");
  popup.inputHue(230);
  popup.requests[3].reject(new Error("Storage unavailable"));
  await drain();
  assert.equal(popup.hue.value, "180");
  assert.match(popup.hue.title, /保存失败/u);
  assert.equal(popup.toggle.disabled, false);
});

test("the popup shows the actual shortcut, including custom, macOS and cleared bindings", async () => {
  for (const shortcut of ["Alt+Shift+U", "Ctrl+Shift+Y", "⌥⇧U", ""]) {
    const popup = createPopup({ shortcut });
    assert.equal(popup.shortcutHint.hidden, true);
    await drain();
    assert.equal(popup.shortcutText.textContent, shortcut || "未设置");
    assert.equal(popup.shortcutHint.hidden, false);
    assert.equal(popup.requests.length, 1, "reading the shortcut must not toggle the reader");
  }
});

test("a shortcut lookup failure leaves the hint hidden and the switch usable", async () => {
  const popup = createPopup({ shortcutError: true });
  popup.requests[0].resolve({ enabled: true });
  await drain();
  assert.equal(popup.shortcutHint.hidden, true);
  assert.equal(popup.toggle.disabled, false);
  assert.equal(popup.toggle.checked, "true");
  assert.equal(popup.warnings.length, 1);
  popup.click();
  assert.equal(popup.requests[1].enabled, false);
});

test("storage changes from shortcuts supersede stale initial and change replies", async () => {
  const popup = createPopup();
  popup.change(true);
  popup.requests[0].resolve({ enabled: false });
  await drain();
  assert.equal(popup.toggle.checked, "true");
  popup.change(false, "sync");
  assert.equal(popup.toggle.checked, "true");
  popup.click();
  popup.change(false);
  popup.change(true);
  popup.requests[1].resolve({ enabled: false });
  await drain();
  assert.equal(popup.toggle.checked, "true");
  assert.equal(popup.label.textContent, "开启");
  popup.change(false);
  assert.equal(popup.toggle.checked, "false");
  assert.equal(popup.label.textContent, "关闭");
});

test("a messaging failure preserves the confirmed state without an unhandled rejection", async () => {
  const popup = createPopup();
  popup.requests[0].resolve({ enabled: true });
  await drain();
  popup.click();
  popup.requests[1].reject(new Error("Worker unavailable"));
  await drain();
  assert.equal(popup.toggle.checked, "true");
  assert.equal(popup.toggle.disabled, false);
  assert.equal(popup.warnings.length, 1);
  assert.match(popup.toggle.title, /重新打开/u);

  const failedRead = createPopup();
  failedRead.requests[0].resolve(undefined);
  await drain();
  assert.equal(failedRead.toggle.disabled, true);
  assert.equal(failedRead.warnings.length, 1);
});
