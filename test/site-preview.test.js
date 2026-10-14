const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/divider-color.js");
require("../src/divider-width.js");

function element(value = "") {
  const attributes = new Map();
  const listeners = {};
  return {
    value, hidden: false, disabled: false, textContent: "",
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    addEventListener(name, callback) { listeners[name] = callback; },
    fire(name) { listeners[name](); },
  };
}

async function preview(english = false) {
  const toggle = element();
  const label = element();
  const hue = element("0");
  const width = element("2");
  const controls = element();
  controls.hidden = true;
  controls.dataset = english
    ? { labelOn: "On", labelOff: "Off", widthLabel: "Step {value} of 5" }
    : { labelOn: "开启", labelOff: "关闭", widthLabel: "第 {value} 档，共 5 档" };
  const nodes = {
    "#reader-toggle": toggle, "#reader-toggle-state": label,
    "#divider-hue": hue, "#divider-width": width,
  };
  controls.querySelector = (selector) => nodes[selector];
  const markers = [element(), element()];
  const root = element();
  const document = {
    documentElement: root,
    querySelector(selector) {
      assert.equal(selector, "[data-reader-controls]");
      return controls;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".reader-divider", "only authored preview markers participate");
      return markers;
    },
  };
  const { initReaderPreview } = await import("../site/assets/js/reader-preview.js");
  initReaderPreview(document);
  return { toggle, label, hue, width, controls, markers, root };
}

test("site preview starts enabled with the extension's red and second thickness step", async () => {
  const p = await preview();
  assert.equal(p.controls.hidden, false);
  assert.equal(p.toggle.getAttribute("aria-checked"), "true");
  assert.equal(p.label.textContent, "开启");
  assert.equal(p.root.style["--selected-divider-color"], "#ff1744");
  assert.equal(p.root.style["--selected-divider-width"], "2");
  assert.equal(p.controls.style["--divider-spectrum"], globalThis.Haodu.dividerColor.gradient);
  assert.equal(p.width.getAttribute("aria-valuetext"), "第 2 档，共 5 档");
  assert.ok(p.markers.every((marker) => !marker.hidden));
});

test("site sliders update appearance immediately over the full color and thickness ranges", async () => {
  const p = await preview();
  const originalMarkers = [...p.markers];
  for (const value of [0, 180, 360]) {
    p.hue.value = String(value);
    p.hue.fire("input");
    const color = globalThis.Haodu.dividerColor.colorForHue(value);
    assert.equal(p.root.style["--selected-divider-color"], color);
    assert.equal(p.hue.getAttribute("aria-valuetext"), color);
  }
  for (const value of [1, 2, 3, 4, 5]) {
    p.width.value = String(value);
    p.width.fire("input");
    assert.equal(p.root.style["--selected-divider-width"], String(value));
    assert.equal(p.width.getAttribute("aria-valuetext"), `第 ${value} 档，共 5 档`);
  }
  assert.deepEqual(p.markers, originalMarkers, "appearance changes preserve the existing cut points");
});

test("turning preview off disables both sliders and preserves their values when reenabled", async () => {
  const p = await preview();
  p.hue.value = "180";
  p.hue.fire("input");
  p.width.value = "5";
  p.width.fire("input");
  p.toggle.fire("click");
  assert.equal(p.label.textContent, "关闭");
  assert.equal(p.toggle.getAttribute("aria-checked"), "false");
  assert.equal(p.hue.disabled, true);
  assert.equal(p.width.disabled, true);
  assert.ok(p.markers.every((marker) => marker.hidden));
  p.toggle.fire("click");
  assert.equal(p.hue.disabled, false);
  assert.equal(p.width.disabled, false);
  assert.equal(p.hue.value, "180");
  assert.equal(p.width.value, "5");
  assert.ok(p.markers.every((marker) => !marker.hidden));
});

test("English preview localizes state and thickness announcements", async () => {
  const p = await preview(true);
  assert.equal(p.label.textContent, "On");
  assert.equal(p.width.getAttribute("aria-valuetext"), "Step 2 of 5");
  p.toggle.fire("click");
  assert.equal(p.label.textContent, "Off");
});

test("pages without preview controls need no appearance initialization", async () => {
  const { initReaderPreview } = await import("../site/assets/js/reader-preview.js");
  assert.doesNotThrow(() => initReaderPreview({ querySelector: () => null }));
});
