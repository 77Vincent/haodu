const assert = require("node:assert/strict");
require("../../src/divider-color.js");
require("../../src/divider-width.js");

function element(value = "") {
  const attributes = new Map();
  const listeners = {};
  return {
    value, hidden: false, disabled: false, textContent: "", dataset: {},
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    addEventListener(name, callback) { listeners[name] = callback; },
    dispatchEvent(event) { listeners[event.type]?.(event); },
    fire(type, properties = {}) {
      const event = { type, preventDefault() { this.defaultPrevented = true; }, ...properties };
      this.dispatchEvent(event);
      return event;
    },
  };
}

async function preview(english = false, platform = "MacIntel") {
  const toggle = element();
  const label = element();
  const hue = element("0");
  const width = element("2");
  const shortcutHint = element();
  const shortcutText = element();
  const controls = element();
  controls.hidden = true;
  controls.dataset = english
    ? { labelOn: "On", labelOff: "Off", widthLabel: "Step {value} of 5", shortcutUnset: "Not set" }
    : { labelOn: "开启", labelOff: "关闭", widthLabel: "第 {value} 档，共 5 档", shortcutUnset: "未设置" };
  const nodes = {
    "#reader-toggle": toggle, "#reader-toggle-state": label,
    "#divider-hue": hue, "#divider-width": width,
    "#shortcut-hint": shortcutHint, "#reader-shortcut": shortcutText,
  };
  controls.querySelector = (selector) => nodes[selector];
  const markers = [element(), element()];
  const root = element();
  const document = Object.assign(element(), {
    URL: "https://haodu.site/",
    documentElement: root,
    defaultView: { navigator: { platform } },
    focused: true,
    hasFocus() { return this.focused; },
    querySelector(selector) {
      if (selector === 'meta[name="haodu"][content="off"]') return {};
      assert.equal(selector, "[data-reader-controls]");
      return controls;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".reader-divider", "only authored preview markers participate");
      return markers;
    },
  });
  const { initReaderPreview } = await import("../../site/assets/js/reader-preview.js");
  initReaderPreview(document);
  return { toggle, label, hue, width, controls, markers, root, document, shortcutHint, shortcutText };
}

module.exports = { preview };
