const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const drain = () => new Promise((resolve) => setImmediate(resolve));

function createPopup({ shortcut = "Alt+Shift+U", shortcutError = false } = {}) {
  let click, storageChanged, hueInput, widthInput;
  const requests = [];
  const warnings = [];
  const label = { textContent: "关闭" };
  const shortcutText = { textContent: "" };
  const shortcutHint = { hidden: true };
  const body = { style: { setProperty(name, value) { this[name] = value; } } };
  const hue = {
    value: "0", disabled: true, title: "", attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { assert.equal(name, "input"); hueInput = callback; },
  };
  const width = {
    value: "2", disabled: true, title: "", attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { assert.equal(name, "input"); widthInput = callback; },
  };
  const toggle = {
    disabled: true, title: "", checked: "false",
    setAttribute(name, value) { assert.equal(name, "aria-checked"); this.checked = value; },
    addEventListener(name, callback) { assert.equal(name, "click"); click = callback; },
  };
  const context = vm.createContext({
    document: { body, getElementById: (id) => {
      if (id === "reader-toggle-state") return label;
      if (id === "reader-shortcut") return shortcutText;
      if (id === "shortcut-hint") return shortcutHint;
      if (id === "divider-hue") return hue;
      if (id === "divider-width") return width;
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
  vm.runInContext(readFileSync(join(__dirname, "../src/divider-width.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "../src/platform/chrome/popup.js"), "utf8"), context);
  return { toggle, label, hue, width, body, shortcutText, shortcutHint, requests, warnings, click: () => click(),
    inputWidth(value) { width.value = String(value); widthInput(); },
    changeWidth(value) { storageChanged({ dividerWidth: { newValue: value } }, "local"); },
    inputHue(value) { hue.value = String(value); hueInput(); },
    changeHue(value) { storageChanged({ dividerHue: { newValue: value } }, "local"); },
    change(value, area = "local") { storageChanged({ enabled: { newValue: value } }, area); },
  };
}

test("the popup reads without toggling and prevents duplicate requests until a change is confirmed", async () => {
  const popup = createPopup();
  assert.equal(popup.requests[0].type, "HAODU_GET_ENABLED");
  assert.equal(popup.toggle.disabled, true);
  popup.requests[0].resolve({ enabled: false, dividerHue: 180, dividerWidth: 4 });
  await drain();
  assert.equal(popup.toggle.disabled, false);
  assert.equal(popup.hue.disabled, true);
  assert.equal(popup.width.disabled, true);
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
  assert.equal(popup.hue.disabled, true);
  assert.equal(popup.width.disabled, true);
  popup.click();
  popup.requests[2].resolve({ enabled: true });
  await drain();
  assert.equal(popup.toggle.checked, "true");
  assert.equal(popup.label.textContent, "开启");
  assert.equal(popup.hue.disabled, false);
  assert.equal(popup.width.disabled, false);
  assert.equal(popup.hue.value, "180");
  assert.equal(popup.width.value, "4");
  popup.click();
  assert.equal(popup.requests[3].enabled, false);
  popup.requests[3].resolve({ enabled: false });
  await drain();
  assert.equal(popup.toggle.checked, "false");
  assert.equal(popup.label.textContent, "关闭");
  assert.equal(popup.hue.disabled, true);
  assert.equal(popup.width.disabled, true);
  assert.equal(popup.hue.value, "180");
  assert.equal(popup.width.value, "4");
  assert.equal(popup.requests.length, 4, "toggling must not rewrite appearance settings");
});

test("width defaults to step two and restores saved steps without writing on open", async () => {
  for (const [saved, expected] of [[undefined, 2], [1, 1], [5, 5], [0, 2], [6, 2], ["3", 2]]) {
    const popup = createPopup();
    assert.equal(popup.width.disabled, true);
    popup.requests[0].resolve({ enabled: true, dividerWidth: saved });
    await drain();
    assert.equal(popup.width.value, String(expected));
    assert.equal(popup.width.disabled, false);
    assert.equal(popup.body.style["--selected-divider-width"], String(expected));
    assert.equal(popup.requests.length, 1);
  }
});

test("width storage changes supersede a stale initial reply and reset to step two when removed", async () => {
  const popup = createPopup();
  popup.changeWidth(4);
  popup.requests[0].resolve({ enabled: false, dividerWidth: 2 });
  await drain();
  assert.equal(popup.width.value, "4");
  popup.changeWidth(undefined);
  assert.equal(popup.width.value, "2");
});

test("width sends every step immediately, keeps the latest drag and restores on save failure", async () => {
  const popup = createPopup();
  popup.requests[0].resolve({ enabled: true, dividerHue: 180, dividerWidth: 2 });
  await drain();
  const color = popup.body.style["--selected-divider-color"];
  popup.inputWidth(1);
  popup.inputWidth(5);
  assert.equal(popup.requests[1].type, "HAODU_SET_DIVIDER_WIDTH");
  assert.equal(popup.requests[1].dividerWidth, 1);
  assert.equal(popup.requests[2].dividerWidth, 5);
  popup.changeWidth(1);
  popup.requests[1].resolve({ dividerWidth: 1 });
  await drain();
  assert.equal(popup.width.value, "5");
  popup.changeWidth(5);
  popup.requests[2].resolve({ dividerWidth: 5 });
  await drain();
  assert.equal(popup.width.value, "5");
  popup.inputWidth(3);
  popup.requests[3].reject(new Error("Storage unavailable"));
  await drain();
  assert.equal(popup.width.value, "5");
  assert.match(popup.width.title, /保存失败/u);
  assert.equal(popup.body.style["--selected-divider-color"], color);
  assert.equal(popup.toggle.checked, "true");
});

test("the color band restores a saved hue and does not save or toggle merely on opening", async () => {
  const popup = createPopup();
  popup.changeHue(180);
  popup.requests[0].resolve({ enabled: false, dividerHue: 0 });
  await drain();
  assert.equal(popup.hue.value, "180", "a newer storage event beats a stale initial reply");
  assert.equal(popup.hue.disabled, true);
  assert.equal(popup.requests.length, 1);
  popup.changeHue(undefined);
  assert.equal(popup.hue.value, "0");
  assert.equal(popup.body.style["--selected-divider-color"], "#ff1744");
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
  assert.equal(popup.hue.disabled, true, "wait for saved settings before allowing edits");
  assert.equal(popup.width.disabled, true);
  popup.requests[0].resolve({ enabled: false });
  await drain();
  assert.equal(popup.toggle.checked, "true");
  assert.equal(popup.hue.disabled, false);
  assert.equal(popup.width.disabled, false);
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
  assert.equal(popup.hue.disabled, true);
  assert.equal(popup.width.disabled, true);

  popup.click();
  popup.change(true);
  popup.change(false);
  popup.requests[2].resolve({ enabled: true });
  await drain();
  assert.equal(popup.hue.disabled, true, "a stale reply cannot enable sliders after a shortcut turns off");
  assert.equal(popup.width.disabled, true);
});

test("appearance saves completing after switch-off preserve values without enabling sliders", async () => {
  const popup = createPopup();
  popup.requests[0].resolve({ enabled: true });
  await drain();
  popup.inputHue(180);
  popup.inputWidth(4);
  popup.change(false);
  popup.changeHue(180);
  popup.changeWidth(4);
  popup.requests[1].resolve({ dividerHue: 180 });
  popup.requests[2].resolve({ dividerWidth: 4 });
  await drain();
  assert.equal(popup.hue.disabled, true);
  assert.equal(popup.width.disabled, true);
  assert.equal(popup.hue.value, "180");
  assert.equal(popup.width.value, "4");
  popup.change(true);
  assert.equal(popup.hue.disabled, false);
  assert.equal(popup.width.disabled, false);
  assert.equal(popup.hue.value, "180");
  assert.equal(popup.width.value, "4");
  assert.equal(popup.requests.length, 3);
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
  assert.equal(popup.hue.disabled, false);
  assert.equal(popup.width.disabled, false);
  assert.equal(popup.warnings.length, 1);
  assert.match(popup.toggle.title, /重新打开/u);

  const failedRead = createPopup();
  failedRead.change(true);
  failedRead.requests[0].resolve(undefined);
  await drain();
  assert.equal(failedRead.toggle.disabled, true);
  assert.equal(failedRead.hue.disabled, true);
  assert.equal(failedRead.width.disabled, true);
  assert.equal(failedRead.warnings.length, 1);
});
