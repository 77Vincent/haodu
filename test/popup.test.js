const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const drain = () => new Promise((resolve) => setImmediate(resolve));

function createPopup() {
  let click, storageChanged;
  const requests = [];
  const warnings = [];
  const label = { textContent: "关闭" };
  const toggle = {
    disabled: true, title: "", checked: "false",
    setAttribute(name, value) { assert.equal(name, "aria-checked"); this.checked = value; },
    addEventListener(name, callback) { assert.equal(name, "click"); click = callback; },
  };
  const context = vm.createContext({
    document: { getElementById: (id) => {
      if (id === "reader-toggle-label") return label;
      assert.equal(id, "reader-toggle");
      return toggle;
    } },
    console: { warn: (...args) => warnings.push(args) },
    chrome: {
      storage: { onChanged: { addListener: (callback) => { storageChanged = callback; } } },
      runtime: { sendMessage: (request) => new Promise((resolve, reject) => {
        requests.push({ ...request, resolve, reject });
      }) },
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "../src/platform/chrome/popup.js"), "utf8"), context);
  return { toggle, label, requests, warnings, click: () => click(),
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
