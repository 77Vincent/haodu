const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, statSync } = require("node:fs");
const { join, dirname, posix } = require("node:path");
const { extensionTarget } = require("../scripts/extension-targets.mjs");
const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

test("Safari packaging selects a nonpersistent background document without changing the Chrome manifest", () => {
  const original = JSON.stringify(manifest);
  const safari = extensionTarget(manifest, "safari");
  const chrome = extensionTarget(manifest, "chrome");
  assert.equal(JSON.stringify(manifest), original);
  assert.deepEqual(chrome.manifest, manifest);
  assert.equal(safari.manifest.version, manifest.version);
  assert.equal(safari.manifest.minimum_chrome_version, undefined);
  assert.deepEqual(safari.manifest.permissions, ["scripting", "storage"]);
  assert.deepEqual(safari.manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(safari.manifest.background.service_worker, undefined);
  assert.equal(safari.manifest.background.persistent, false);
  assert.equal(safari.manifest.action.default_popup, chrome.manifest.action.default_popup);
  assert.deepEqual(safari.manifest.commands, chrome.manifest.commands);
  assert.notEqual(safari.archive, chrome.archive);
  assert.notEqual(safari.directory, chrome.directory);
  assert.notEqual(safari.report, chrome.report);
  assert.ok(safari.files.every(file => !file.startsWith("src/platform/chrome/")));
  assert.ok(chrome.files.every(file => !file.startsWith("src/platform/safari/")));
  assert.throws(() => extensionTarget(manifest, "unknown"), /Unsupported browser/);
});

for (const browser of ["chrome", "safari"]) {
  test(`${browser} package contains its manifest, HTML and worker dependencies`, () => {
    const target = extensionTarget(manifest, browser);
    const required = [target.manifest.action.default_popup,
      ...Object.values(target.manifest.icons),
      ...(target.manifest.background.scripts || [target.manifest.background.service_worker]),
      ...target.manifest.web_accessible_resources.flatMap(entry => entry.resources),
    ];
    for (const file of target.files) {
      assert.ok(statSync(join(root, file)).isFile(), file);
      assert.doesNotMatch(file, /^(?:site|test|training|node_modules|dist)\//);
      if (file.endsWith(".html")) {
        const html = readFileSync(join(root, file), "utf8");
        for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/gu)) {
          required.push(posix.normalize(`${dirname(file)}/${match[1]}`));
        }
      }
    }
    required.push("src/inference-worker.js", "src/boundary-model-data.js",
      "src/backend/inference.js", "src/backend/chunker.js");
    for (const file of required) assert.ok(target.files.includes(file), `Missing ${file}`);
  });
}
