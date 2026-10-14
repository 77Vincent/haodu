const test = require("node:test");
const assert = require("node:assert/strict");
const { preview } = require("./helpers/site-preview.js");

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

const shortcutKey = { code: "KeyU", key: "¨", altKey: true, shiftKey: true };

test("the site shortcut uses the physical U key and ignores held, composing and editable input", async () => {
  const p = await preview();
  assert.equal(p.shortcutText.textContent, "⌥⇧U");
  assert.equal((await preview(false, "Win32")).shortcutText.textContent, "Alt+Shift+U");
  assert.equal(p.document.fire("keydown", shortcutKey).defaultPrevented, true);
  assert.equal(p.toggle.getAttribute("aria-checked"), "false");
  p.document.fire("keydown", { ...shortcutKey, repeat: true });
  assert.equal(p.toggle.getAttribute("aria-checked"), "false");
  p.document.fire("keydown", shortcutKey);
  assert.equal(p.toggle.getAttribute("aria-checked"), "true");
  for (const override of [
    { altKey: false }, { shiftKey: false }, { ctrlKey: true }, { metaKey: true },
    { code: "KeyI" }, { defaultPrevented: true }, { isComposing: true },
    { target: { isContentEditable: true } },
    { target: { closest: () => ({ tagName: "INPUT" }) } },
    { composedPath: () => [{ isContentEditable: true }] },
  ]) {
    p.document.fire("keydown", { ...shortcutKey, ...override });
    assert.equal(p.toggle.getAttribute("aria-checked"), "true");
  }
  p.document.fire("compositionstart");
  p.document.fire("keydown", shortcutKey);
  assert.equal(p.toggle.getAttribute("aria-checked"), "true");
  p.document.fire("compositionend");
  p.document.fire("keydown", shortcutKey);
  assert.equal(p.toggle.getAttribute("aria-checked"), "false");
});

test("an extension-owned shortcut disables the local fallback, including an unassigned binding", async () => {
  const p = await preview();
  p.toggle.dataset.haoduExtensionShortcut = "Ctrl+Shift+K";
  p.toggle.fire("haodu:preview-shortcut");
  assert.equal(p.shortcutText.textContent, "Ctrl+Shift+K");
  p.document.fire("keydown", shortcutKey);
  assert.equal(p.toggle.getAttribute("aria-checked"), "true");
  p.toggle.fire("haodu:preview-toggle");
  assert.equal(p.toggle.getAttribute("aria-checked"), "false", "one forwarded command toggles exactly once");
  p.toggle.dataset.haoduExtensionShortcut = "";
  p.toggle.fire("haodu:preview-shortcut");
  assert.equal(p.shortcutText.textContent, "未设置");
  p.document.fire("keydown", shortcutKey);
  assert.equal(p.toggle.getAttribute("aria-checked"), "false");
  p.toggle.fire("click");
  assert.equal(p.toggle.getAttribute("aria-checked"), "true", "the mouse switch remains usable");
});
