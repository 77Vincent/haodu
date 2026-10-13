const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const read = (path) => readFileSync(join(__dirname, "..", path), "utf8");

test("the toolbar opens a popup while the keyboard shortcut toggles directly", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.action.default_popup, "src/popup.html");
  assert.deepEqual(manifest.commands, {
    "haodu-toggle": { suggested_key: "Alt+Shift+U", description: "开启或关闭阅读辅助" },
  });
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.permissions.includes("storage"), true);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*", "file:///*"]);
});

test("divider geometry lives in CSS with configurable color and width and the original defaults", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.web_accessible_resources.some((entry) =>
    entry.resources.includes("src/content.css") && entry.matches.includes("<all_urls>")),
  "shadow roots must be able to load the shared extension stylesheet");
  const css = read("src/content.css");
  assert.match(css, /\.haodu-divider::before/u);
  assert.match(css, /content:\s*""/u);
  assert.match(css, /width:\s*calc\(1em \* var\(--haodu-divider-width, 2\) \/ 12\)/u);
  assert.match(css, /height:\s*1em/u);
  assert.match(css, /background-color:\s*var\(--haodu-divider-color,\s*#ff1744\)/u);
  for (const path of [
    "src/app/reader.js", "src/frontend/read.js",
  ]) {
    assert.doesNotMatch(read(path), /dividerWidth/u);
  }
});
