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

for (const browser of ["chrome", "safari", "firefox"]) {
  test(`${browser} package contains its manifest, HTML and worker dependencies`, () => {
    const target = extensionTarget(manifest, browser);
    const required = [target.manifest.action.default_popup,
      ...Object.values(target.manifest.icons),
      ...(target.manifest.background.scripts || [target.manifest.background.service_worker]),
      ...target.manifest.web_accessible_resources.flatMap(entry => entry.resources),
    ];
    for (const file of target.files) {
      if (!["src/boundary-model-data.json", "src/boundary-model-weights.bin"].includes(file)) {
        assert.ok(statSync(join(root, file)).isFile(), file);
      }
      assert.doesNotMatch(file, /^(?:site|test|training|node_modules|dist)\//);
      if (file.endsWith(".html")) {
        const html = readFileSync(join(root, file), "utf8");
        for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/gu)) {
          required.push(posix.normalize(`${dirname(file)}/${match[1]}`));
        }
      }
    }
    required.push(...(browser === "firefox" ? ["src/platform/firefox/inference-worker.js", "src/boundary-model-data.json", "src/boundary-model-weights.bin"] : ["src/inference-worker.js", "src/boundary-model-data.js"]),
      "src/backend/inference.js", "src/backend/chunker.js");
    for (const file of required) assert.ok(target.files.includes(file), `Missing ${file}`);
  });
}


test("Firefox packaging isolates its host, local model data and distribution metadata", () => {
  const firefox = extensionTarget(manifest, "firefox");
  assert.equal(firefox.manifest.background.service_worker, undefined);
  assert.equal(firefox.manifest.background.persistent, undefined);
  assert.deepEqual(firefox.manifest.permissions, ["scripting", "storage"]);
  assert.deepEqual(firefox.manifest.host_permissions, manifest.host_permissions);
  assert.equal(firefox.manifest.browser_specific_settings.gecko.id, "haodu@haodu.site");
  // Declaring gecko_android forces AMO to enable Android distribution.
  assert.equal(firefox.manifest.browser_specific_settings.gecko_android, undefined);
  assert.deepEqual(firefox.manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["none"] });
  assert.ok(firefox.files.includes("src/boundary-model-data.json"));
  assert.ok(!firefox.files.includes("src/boundary-model-data.js"));
  assert.ok(firefox.files.every(file => !/^src\/platform\/(chrome|safari)\//u.test(file)));
  for (const browser of ["chrome", "safari"]) {
    const other = extensionTarget(manifest, browser);
    assert.equal(other.manifest.browser_specific_settings, undefined);
    assert.ok(other.files.includes("src/boundary-model-data.js"));
    assert.notEqual(firefox.archive, other.archive);
    assert.notEqual(firefox.directory, other.directory);
  }
});
