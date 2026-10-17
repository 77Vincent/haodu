const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const { preview } = require("./helpers/site-preview.js");

const runScript = (path, context) => vm.runInContext(
  readFileSync(join(__dirname, "..", path), "utf8"), context, { filename: path },
);
const drain = () => new Promise((resolve) => setImmediate(resolve));

function createBackground(saved = {}, browser = "chrome") {
  let command, message, navigate, activate, focusWindow, startup, install;
  let shortcut = "Alt+Shift+U";
  let activeId = null;
  let offscreen = false;
  let fileAccess = false;
  let creations = 0;
  const tabs = new Map();
  const pages = new Map();
  const optedOutTabs = new Set();
  const badges = new Map();
  const icons = new Map();
  const titles = new Map();
  const disabled = new Set();
  const commands = [];
  const queries = [];
  const writes = [];
  const injected = [];
  const cssInjections = [];
  const injectedFiles = [];
  const injectionErrors = new Map();
  const requests = [];
  const injectionDelays = new Map();
  const statusDelays = new Map();
  const settingDelays = new Map();
  const previewDocuments = new Map();
  const previewSyncs = [];
  const workers = [];
  const timers = new Map();
  let timerId = 0;
  let holdInference = false;
  class FakeWorker {
    constructor(url) {
      assert.equal(url, chrome.runtime.getURL(browser === "firefox" ? "src/platform/firefox/inference-worker.js" : "src/inference-worker.js"));
      this.messages = [];
      workers.push(this);
    }
    postMessage(request) {
      this.messages.push(request);
      requests.push(request);
      if (!holdInference) queueMicrotask(() => this.onmessage({ data: {
        id: request.id, offsetsByText: request.texts.map(() => [4]),
      } }));
    }
    terminate() { this.terminated = true; }
  }

  function publish(request, tabId = 1) {
    return new Promise((resolve) => message(request,
      { id: "test-extension", tab: { id: tabId }, frameId: 0 }, resolve));
  }

  // Use the real reader and Chrome page adapter. Only DOM work and inference
  // are stubbed, so focus/toggle handling exercises both sides of the protocol.
  function injectPage(id) {
    let listener;
    const page = { reads: 0, clears: 0, marker: null, process: async () => [[]] };
    const context = vm.createContext({ setTimeout, clearTimeout,
      document: { querySelector: (selector) => {
        assert.equal(selector, 'meta[name="haodu"][content="off"]');
        return optedOutTabs.has(id) ? {} : null;
      } }, chrome: { runtime: {
      getURL: (path) => path,
      onMessage: { addListener: (callback) => { listener = callback; } },
      sendMessage: (request) => publish(request, id),
    } } });
    runScript("src/app/reader.js", context);
    runScript("src/platform/webextension/content.js", context);
    context.Haodu.setMarkerColor = (color) => { page.color = color; };
    context.Haodu.setMarkerWidth = (width) => { page.width = width; };
    const adapter = context.Haodu.createReaderAdapter();
    page.reader = context.Haodu.createReader({
      read() { page.reads += 1; return { texts: ["需要处理的中文"] }; },
      process: (texts) => page.process(texts),
      write() { page.marker = {}; },
      clear() { page.clears += 1; page.marker = null; },
      remember() {}, reset() {}, watch: () => () => {},
      publishState: adapter.publishState,
    });
    adapter.connect(page.reader);
    page.message = (request) => {
      let response;
      listener(request, {}, (value) => { response = value; });
      return response;
    };
    pages.set(id, page);
  }

  const chrome = {
    commands: {
      onCommand: { addListener: (callback) => { command = callback; } },
      async getAll() { return [{ name: "haodu-toggle", shortcut }]; },
    },
    action: {
      onClicked: { addListener: () => { throw new Error("Toolbar clicks must only open the popup"); } },
      async setBadgeText({ tabId, text }) { badges.set(tabId, text); },
      async setIcon({ tabId, path }) {
        const resolved = {};
        // Chrome's service-worker binding fetches paths relative to the worker URL.
        for (const [size, imagePath] of Object.entries(path)) {
          const url = new URL(imagePath, chrome.runtime.getURL(manifest.background.service_worker));
          assert.equal(url.protocol, browser === "safari" ? "safari-web-extension:" : browser === "firefox" ? "moz-extension:" : "chrome-extension:");
          assert.equal(url.hostname, chrome.runtime.id);
          const png = readFileSync(join(__dirname, "..", url.pathname.slice(1)));
          assert.equal(png.subarray(1, 4).toString(), "PNG");
          assert.equal(png.readUInt32BE(16), Number(size));
          assert.equal(png.readUInt32BE(20), Number(size));
          resolved[size] = url.href;
        }
        icons.set(tabId, resolved);
      },
      async setTitle({ tabId, title }) { titles.set(tabId, title); },
      async disable(id) { disabled.add(id); },
      async enable(id) { disabled.delete(id); },
    },
    tabs: {
      onUpdated: { addListener: (callback) => { navigate = callback; } },
      onActivated: { addListener: (callback) => { activate = callback; } },
      async query(query) {
        queries.push(query);
        assert.equal(query.active, true, "never enumerate inactive tabs");
        assert.equal(query.lastFocusedWindow, true);
        return activeId === null ? [] : [{ ...tabs.get(activeId) }];
      },
      async sendMessage(id, request, options) {
        assert.equal(options.frameId, 0);
        commands.push({ id, ...request });
        if (!pages.has(id)) throw new Error("No receiver");
        const response = pages.get(id).message(request);
        if (request.type === "HAODU_PING" && statusDelays.has(id)) {
          const delay = statusDelays.get(id);
          statusDelays.delete(id);
          await delay;
        }
        if (request.type === "HAODU_APPLY_SETTING" && settingDelays.has(id)) {
          const delay = settingDelays.get(id);
          settingDelays.delete(id);
          await delay;
        }
        return response;
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: { addListener: (callback) => { focusWindow = callback; } },
    },
    storage: { local: {
      async get(defaults) { return { ...defaults, ...saved }; },
      async set(value) { Object.assign(saved, value); writes.push({ ...value }); },
    } },
    extension: { async isAllowedFileSchemeAccess() { return fileAccess; } },
    scripting: {
      async insertCSS({ target }) {
        cssInjections.push(target.tabId);
        const failure = injectionErrors.get(target.tabId);
        if (failure?.method === "insertCSS") throw new Error(failure.message);
      },
      async executeScript({ target, files, func, args }) {
        if (func) {
          previewSyncs.push({ tabId: target.tabId, args });
          const failure = injectionErrors.get(target.tabId);
          if (failure?.method === "executeScript") throw new Error(failure.message);
          const document = previewDocuments.get(target.tabId) || {
            URL: tabs.get(target.tabId).url,
            querySelector: (selector) => selector === 'meta[name="haodu"][content="off"]'
              && optedOutTabs.has(target.tabId) ? {} : null,
          };
          return [{ result: vm.runInNewContext(`(${func.toString()})(...args)`, { document, Event, args }) }];
        }
        injected.push(target.tabId);
        injectedFiles.push(Array.from(files));
        const failure = injectionErrors.get(target.tabId);
        if (failure?.method === "executeScript") throw new Error(failure.message);
        await injectionDelays.get(target.tabId);
        injectPage(target.tabId);
      },
    },
    offscreen: { async createDocument() { creations += 1; offscreen = true; } },
    runtime: {
      id: "test-extension",
      getURL: (path) => `${browser === "safari" ? "safari-web-extension" : browser === "firefox" ? "moz-extension" : "chrome-extension"}://test-extension/${path}`,
      async getContexts() { return offscreen ? [{}] : []; },
      async sendMessage(request) {
        requests.push(request);
        return { offsetsByText: request.texts.map(() => [4]) };
      },
      onMessage: { addListener: (callback) => { message = callback; } },
      onStartup: { addListener: (callback) => { startup = callback; } },
      onInstalled: { addListener: (callback) => { install = callback; } },
    },
  };
  if (browser !== "chrome") {
    // Document hosts must work without any Chrome-only offscreen APIs.
    delete chrome.offscreen;
    delete chrome.runtime.getContexts;
    delete chrome.extension;
  }
  const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf8"));
  const boot = () => {
    const context = vm.createContext({ console, chrome, URL, Worker: FakeWorker,
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    });
    if (browser !== "chrome") {
      // Use exactly the script order emitted in the target manifest.
      const { extensionTarget } = require("../scripts/extension-targets.mjs");
      for (const script of extensionTarget(manifest, browser).manifest.background.scripts) runScript(script, context);
    } else {
      context.importScripts = (...paths) => {
        for (const path of paths) runScript(join("src/platform/chrome", path), context);
      };
      runScript(manifest.background.service_worker, context);
    }
  };
  boot();

  function addTab(id, url = "https://example.com/", status = "complete") {
    tabs.set(id, { id, url, status, active: false });
  }

  function select(id) {
    if (!tabs.has(id)) addTab(id);
    for (const tab of tabs.values()) tab.active = tab.id === id;
    activeId = id;
  }

  return {
    pages, badges, icons, titles, disabled, commands, queries, writes, saved, tabs, injected, injectedFiles, requests,
    workers, timers,
    holdInference(value) { holdInference = value; },
    addTab, optedOutTabs, cssInjections, injectionErrors, previewDocuments, previewSyncs,
    setShortcut(value) { shortcut = value; },
    setFileAccess(allowed) { fileAccess = allowed; },
    pauseInjection(id) {
      let resume;
      injectionDelays.set(id, new Promise((resolve) => { resume = resolve; }));
      return resume;
    },
    pauseStatus(id) {
      let resume;
      statusDelays.set(id, new Promise((resolve) => { resume = resolve; }));
      return resume;
    },
    pauseSettingReply(id) {
      let resume;
      settingDelays.set(id, new Promise((resolve) => { resume = resolve; }));
      return resume;
    },
    creations: () => creations,
    async shortcut(id) { select(id); command("haodu-toggle", tabs.get(id)); await drain(); },
    popup(request, sender = { id: chrome.runtime.id, url: chrome.runtime.getURL("src/popup.html") }) {
      return new Promise((resolve) => {
        if (message(request, sender, resolve) !== true) resolve(undefined);
      });
    },
    async focus(id) { select(id); activate({ tabId: id }); await drain(); },
    async windowFocus(id) { select(id); focusWindow(2); await drain(); },
    async navigate(id) {
      pages.delete(id);
      const tab = tabs.get(id);
      tab.status = "loading";
      navigate(id, { status: "loading" }, { ...tab });
      await drain();
      tab.status = "complete";
      navigate(id, { status: "complete" }, { ...tab });
      await drain();
    },
    async restartWorker() { boot(); await drain(); },
    async startup() { startup(); await drain(); },
    async install() { install(); await drain(); },
    message: publish,
  };
}

test("homepage commands toggle the real site preview without changing global settings or loading a reader", async () => {
  for (const enabled of [false, true]) {
    const background = createBackground({ enabled });
    const site = await preview();
    background.addTab(1, site.document.URL);
    background.previewDocuments.set(1, site.document);
    await background.focus(1);
    assert.equal(site.shortcutText.textContent, "Alt+Shift+U");
    assert.equal(site.toggle.getAttribute("aria-checked"), "true");
    await background.shortcut(1);
    assert.equal(site.toggle.getAttribute("aria-checked"), "false");
    assert.equal(site.hue.disabled, true);
    // Even if a browser also delivers a key event, the page must not toggle again.
    site.document.fire("keydown", { code: "KeyU", altKey: true, shiftKey: true });
    assert.equal(site.toggle.getAttribute("aria-checked"), "false");
    await background.shortcut(1);
    assert.equal(site.toggle.getAttribute("aria-checked"), "true");
    assert.equal(background.saved.enabled, enabled);
    assert.equal(background.writes.length, 0);
    assert.equal(background.injected.length, 0);
    assert.equal(background.cssInjections.length, 0);
    assert.equal(background.creations(), 0);
    assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).enabled, enabled);
  }
});

test("preview hints follow remapped and cleared extension commands on focus", async () => {
  const background = createBackground();
  const site = await preview();
  background.addTab(1, site.document.URL);
  background.previewDocuments.set(1, site.document);
  background.setShortcut("Ctrl+Shift+K");
  await background.focus(1);
  assert.equal(site.shortcutText.textContent, "Ctrl+Shift+K");
  await background.shortcut(1);
  assert.equal(site.toggle.getAttribute("aria-checked"), "false");
  background.setShortcut("");
  await background.focus(1);
  assert.equal(site.shortcutText.textContent, "未设置");
  site.document.fire("keydown", { code: "KeyU", altKey: true, shiftKey: true });
  assert.equal(site.toggle.getAttribute("aria-checked"), "false");
  site.toggle.fire("click");
  assert.equal(site.toggle.getAttribute("aria-checked"), "true");
});

test("preview commands leave global state alone when the page cannot safely toggle", async () => {
  const background = createBackground({ enabled: true });
  const site = await preview();
  background.addTab(1, site.document.URL);
  background.previewDocuments.set(1, site.document);
  for (const prepare of [
    () => { background.tabs.get(1).status = "loading"; },
    () => { background.tabs.get(1).status = "complete"; site.document.focused = false; },
    () => { site.document.focused = true; site.controls.hidden = true; },
    () => { site.controls.hidden = false; site.document.activeElement = { isContentEditable: true }; },
    () => { site.document.activeElement = null; site.document.fire("compositionstart"); },
    () => { site.document.fire("compositionend"); site.document.URL = "https://haodu.site/en/"; },
  ]) {
    prepare();
    await background.shortcut(1);
    assert.equal(site.toggle.getAttribute("aria-checked"), "true");
    assert.equal(background.saved.enabled, true);
    assert.equal(background.writes.length, 0);
  }
  background.previewDocuments.set(1, {
    URL: "https://haodu.site/", querySelector: (selector) => selector.startsWith("meta") ? {} : null,
  });
  await background.shortcut(1);
  assert.equal(background.saved.enabled, true, "opted-out pages without a preview have no shortcut action");
});

test("the opt-out marker enables preview commands independently of the URL", async () => {
  for (const url of [
    "https://haodu.site/en/",
    "https://www.haodu.site/",
    "http://localhost:1313/en/",
    "http://127.0.0.1:1313/",
    "http://[::1]:1313/",
    "https://preview.example.com/build/42/en/",
    "http://192.168.1.2:1313/",
    "file:///tmp/haodu-preview/index.html",
  ]) {
    const background = createBackground({ enabled: false });
    background.setFileAccess(true);
    const site = await preview();
    site.document.URL = url;
    background.addTab(1, url);
    background.previewDocuments.set(1, site.document);
    await background.focus(1);
    assert.equal(site.shortcutText.textContent, "Alt+Shift+U", url);
    await background.shortcut(1);
    assert.equal(site.toggle.getAttribute("aria-checked"), "false", url);
    assert.equal(background.saved.enabled, false, url);
    assert.equal(background.writes.length, 0, url);
    assert.equal(background.injected.length, 0, url);
  }
});

test("pages without the opt-out marker retain global commands even with preview controls", async () => {
  for (const url of ["https://example.com/", "https://haodu.site/", "http://localhost:1313/"]) {
    const background = createBackground({ enabled: false });
    const site = await preview();
    site.document.URL = url;
    const querySelector = site.document.querySelector.bind(site.document);
    site.document.querySelector = (selector) => selector === 'meta[name="haodu"][content="off"]'
      ? null : querySelector(selector);
    background.addTab(1, url);
    background.previewDocuments.set(1, site.document);
    await background.focus(1);
    await background.shortcut(1);
    assert.equal(background.saved.enabled, true, url);
    assert.equal(site.toggle.getAttribute("aria-checked"), "true", url);
    assert.equal(site.toggle.dataset.haoduExtensionShortcut, undefined, url);
    assert.equal(background.pages.get(1).reader.status().enabled, true, url);
    await background.shortcut(1);
    assert.equal(background.saved.enabled, false, url);
    assert.equal(background.pages.get(1).reader.status().enabled, false, url);
  }
});

test("unrelated localhost pages retain normal global commands", async () => {
  const background = createBackground({ enabled: false });
  background.addTab(1, "http://localhost:3000/");
  await background.shortcut(1);
  assert.equal(background.saved.enabled, true);
  assert.equal(background.pages.get(1).reader.status().enabled, true);
  await background.shortcut(1);
  assert.equal(background.saved.enabled, false);
  assert.equal(background.pages.get(1).reader.status().enabled, false);
});

test("a denied marker check does not disable global shortcuts on inaccessible pages", async () => {
  const background = createBackground({ enabled: false });
  background.addTab(1, "https://example.com/");
  background.injectionErrors.set(1, { method: "executeScript", message: "Cannot access contents of the page" });
  await background.shortcut(1);
  assert.equal(background.saved.enabled, true);
  assert.equal(background.pages.has(1), false);
  assert.equal(background.injected.length, 0);
  assert.equal(background.cssInjections.length, 0);
  assert.equal(background.badges.get(1), "");
  await background.shortcut(1);
  assert.equal(background.saved.enabled, false);
});

test("opening the popup only reads state; its switch and shortcut share the saved setting", async () => {
  const background = createBackground();
  await background.focus(1);
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).enabled, false);
  assert.equal(background.writes.length, 0);
  assert.equal(background.injected.length, 0);
  assert.equal((await background.popup({ type: "HAODU_SET_ENABLED", enabled: true })).enabled, true);
  await drain();
  assert.equal(background.saved.enabled, true);
  assert.equal(background.pages.get(1).reader.status().enabled, true);
  const writes = background.writes.length;
  await background.popup({ type: "HAODU_SET_ENABLED", enabled: true });
  assert.equal(background.writes.length, writes, "repeated SET requests must not toggle back");
  await background.shortcut(1);
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).enabled, false);
  await background.shortcut(1);
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).enabled, true);
  await background.restartWorker();
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).enabled, true);
  await background.popup({ type: "HAODU_SET_ENABLED", enabled: false });
  assert.equal(background.pages.get(1).reader.status().enabled, false);
});

test("color writes persist in order and update only the active reader without running inference", async () => {
  const background = createBackground();
  await background.shortcut(1);
  await background.focus(2);
  const first = background.pages.get(1);
  const active = background.pages.get(2);
  const marker = active.marker;
  const reads = active.reads;
  const reply = await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: 180 });
  assert.equal(reply.dividerHue, 180);
  assert.equal(background.saved.dividerHue, 180);
  assert.equal(first.color, "#ff1744");
  assert.notEqual(active.color, "#ff1744");
  assert.equal(active.marker, marker);
  assert.equal(active.reads, reads);
  await background.focus(1);
  assert.equal(first.color, active.color);
  await Promise.all([60, 120, 240].map((dividerHue) => background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue })));
  assert.equal(background.saved.dividerHue, 240);
  const color = first.color;
  await background.restartWorker();
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).dividerHue, 240);
  await background.navigate(1);
  assert.equal(background.pages.get(1).color, color);
});

test("color selection works while off or busy and rejects invalid or untrusted values", async () => {
  const background = createBackground();
  await background.focus(1);
  await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: 90 });
  assert.equal(background.injected.length, 0);
  assert.equal(background.creations(), 0);
  for (const dividerHue of [-1, 361, 1.5, "90", null, NaN]) {
    assert.equal(await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue }), undefined);
  }
  assert.equal(await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: 5 },
    { id: "other-extension", url: "chrome-extension://test-extension/src/popup.html" }), undefined);
  assert.equal(background.writes.length, 1);
  await background.shortcut(1);
  const page = background.pages.get(1);
  page.reader.toggle(false);
  let finish;
  page.process = () => new Promise((resolve) => { finish = resolve; });
  page.reader.toggle(true);
  const reads = page.reads;
  await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: 0 });
  assert.equal(page.color, "#ff1744");
  assert.equal(page.reader.status().busy, true);
  assert.equal(page.reads, reads);
  finish([[]]);
  await drain();
});

test("width steps persist in order and update existing active readers without inference", async () => {
  const background = createBackground();
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).dividerWidth, 2);
  await background.shortcut(1);
  await background.focus(2);
  const first = background.pages.get(1);
  const active = background.pages.get(2);
  const marker = active.marker;
  const reads = active.reads;
  for (const dividerWidth of [1, 2, 3, 4, 5]) {
    const reply = await background.popup({ type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth });
    assert.equal(reply.dividerWidth, dividerWidth);
    assert.equal(background.saved.dividerWidth, dividerWidth);
    assert.equal(active.width, dividerWidth);
  }
  assert.equal(first.width, 2);
  assert.equal(active.marker, marker);
  assert.equal(active.reads, reads);
  await background.focus(1);
  assert.equal(first.width, 5);
  await Promise.all([4, 2, 1].map((dividerWidth) => background.popup({ type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth })));
  assert.equal(background.saved.dividerWidth, 1);
  await background.restartWorker();
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).dividerWidth, 1);
  await background.navigate(1);
  assert.equal(background.pages.get(1).width, 1);
});

test("width selection while off saves without injection and rejects invalid or untrusted input", async () => {
  const background = createBackground({ dividerWidth: "5" });
  await background.focus(1);
  assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).dividerWidth, 2);
  await background.popup({ type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth: 4 });
  assert.equal(background.injected.length, 0);
  assert.equal(background.creations(), 0);
  for (const dividerWidth of [0, 6, 1.5, "3", null, NaN]) {
    assert.equal(await background.popup({ type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth }), undefined);
  }
  for (const sender of [
    { id: "test-extension", url: "https://example.com/", tab: { id: 1 }, frameId: 0 },
    { id: "other-extension", url: "chrome-extension://test-extension/src/popup.html" },
  ]) assert.equal(await background.popup({ type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth: 5 }, sender), undefined);
  assert.equal(background.writes.length, 1);
  await background.shortcut(1);
  assert.equal(background.pages.get(1).width, 4);
  await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: 180 });
  assert.equal(background.saved.dividerWidth, 4, "color changes must preserve width");
});

test("popup controls reject page senders and invalid values", async () => {
  const background = createBackground();
  await background.focus(1);
  const request = { type: "HAODU_SET_ENABLED", enabled: true };
  for (const sender of [
    { id: "test-extension", url: "https://example.com/", tab: { id: 1 }, frameId: 0 },
    { id: "another-extension", url: "chrome-extension://test-extension/src/popup.html" },
    { id: "test-extension", url: "chrome-extension://test-extension/src/inference.html" },
  ]) assert.equal(await background.popup(request, sender), undefined);
  assert.equal(await background.popup({ type: "HAODU_SET_ENABLED", enabled: "false" }), undefined);
  assert.equal(background.writes.length, 0);
});

test("the toolbar tooltip follows changed and cleared shortcuts without showing the suggested binding", async () => {
  const background = createBackground();
  await background.focus(1);
  background.setShortcut("⌃⇧H");
  await background.focus(1);
  assert.equal(background.titles.get(1), "好读（已关闭 / ⌃⇧H 切换）");
  background.setShortcut("");
  await background.focus(1);
  assert.equal(background.titles.get(1), "好读（已关闭）");
});

test("the saved switch is global but toggles and focus leave every inactive tab untouched", async () => {
  const background = createBackground();
  background.addTab(2);
  await background.shortcut(1);
  assert.deepEqual(background.injected, [1]);
  assert.deepEqual(background.injectedFiles[0], [
    "src/divider-width.js",
    "src/frontend/dom-tree.js", "src/frontend/viewport.js", "src/frontend/visibility.js", "src/frontend/processed-text.js",
    "src/frontend/read.js", "src/frontend/write.js", "src/frontend/content-changes.js", "src/app/reader.js",
    "src/platform/webextension/content.js", "src/start-reader.js",
  ]);
  assert.equal(background.saved.enabled, true);
  assert.equal(background.pages.get(1).reader.status().enabled, true);
  assert.equal(background.pages.has(2), false);
  await background.focus(2);
  assert.equal(background.pages.get(2).reader.status().enabled, true);
  const first = background.pages.get(1);
  const marker = first.marker;
  await background.focus(1);
  await background.focus(2);
  assert.equal(first.marker, marker);
  assert.equal(first.reads, 1);
  const beforeToggle = background.commands.length;
  await background.shortcut(2); // OFF only touches the focused tab.
  assert.equal(background.saved.enabled, false);
  assert.equal(background.pages.get(2).reader.status().enabled, false);
  assert.equal(first.reader.status().enabled, true);
  assert.equal(first.marker, marker);
  assert.ok(background.commands.slice(beforeToggle).every(({ id }) => id === 2));
  await background.focus(1);
  assert.equal(first.reader.status().enabled, false);
  assert.equal(first.marker, null);
  assert.deepEqual(background.injected, [1, 2]);
  assert.equal(background.badges.get(1), "");
  assert.equal(background.badges.get(2), "");
  assert.deepEqual(background.icons.get(1), {
    16: "chrome-extension://test-extension/icons/off-16.png",
    32: "chrome-extension://test-extension/icons/off-32.png",
  });
  assert.deepEqual(background.icons.get(2), background.icons.get(1));
});

test("active reloads and new tabs use the saved switch; background reloads wait for focus", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const oldPage = background.pages.get(1);
  await background.navigate(1);
  assert.notEqual(background.pages.get(1), oldPage);
  assert.equal(background.pages.get(1).reads, 1);
  assert.equal(background.badges.get(1), "");
  assert.deepEqual(background.icons.get(1), {
    16: "chrome-extension://test-extension/icons/on-16.png",
    32: "chrome-extension://test-extension/icons/on-32.png",
  });
  await background.focus(2);
  assert.equal(background.pages.get(2).reads, 1);
  await background.navigate(1);
  assert.equal(background.pages.has(1), false, "an inactive page reload must not initialize a reader");
  await background.focus(1);
  assert.equal(background.pages.get(1).reads, 1);
  await background.shortcut(1);
  await background.navigate(1);
  await background.focus(3);
  assert.equal(background.pages.has(1), false);
  assert.equal(background.pages.has(3), false);
});

test("page opt-out survives focus, navigation and global toggles without disabling other pages", async () => {
  const background = createBackground({ enabled: true });
  background.optedOutTabs.add(1);
  await background.focus(1);
  assert.equal(background.pages.has(1), false);
  assert.equal(background.injected.length, 0);
  assert.equal(background.cssInjections.length, 0);
  assert.equal(background.creations(), 0);
  assert.equal(background.saved.enabled, true);
  assert.equal(background.writes.length, 0);

  await background.focus(2);
  assert.equal(background.pages.get(2).reader.status().enabled, true);
  assert.equal(background.pages.get(2).reads, 1);
  await background.focus(1);
  assert.equal(background.pages.has(1), false);

  await background.navigate(1);
  assert.equal(background.pages.has(1), false);
  await background.shortcut(1);
  assert.equal(background.saved.enabled, true, "a marked page without controls consumes the shortcut");
  await background.popup({ type: "HAODU_SET_ENABLED", enabled: false });
  assert.equal(background.saved.enabled, false);
  await background.popup({ type: "HAODU_SET_ENABLED", enabled: true });
  assert.equal(background.saved.enabled, true);
  assert.equal(background.pages.has(1), false);
  assert.ok(background.injected.every((id) => id !== 1));
  assert.ok(background.cssInjections.every((id) => id !== 1));

  await background.focus(2);
  assert.equal(background.pages.get(2).reader.status().enabled, true);
});

test("a tab that missed OFF and ON keeps its existing results when focused again", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const first = background.pages.get(1);
  const marker = first.marker;
  await background.focus(2);
  const beforeToggle = background.commands.length;
  await background.shortcut(2);
  await background.shortcut(2);
  assert.ok(background.commands.slice(beforeToggle).every(({ id }) => id === 2));
  assert.equal(first.reads, 1);
  assert.equal(first.marker, marker);
  assert.equal(first.clears, 0);
  await background.focus(1);
  assert.equal(first.reads, 1);
  assert.equal(first.clears, 0);
  assert.equal(first.marker, marker);
  await background.focus(1);
  assert.equal(first.reads, 1);
  assert.deepEqual(background.saved, { enabled: true });
});

test("worker and browser restarts retain the setting and window focus only checks its active tab", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const marker = background.pages.get(1).marker;
  await background.restartWorker();
  await background.focus(1);
  assert.equal(background.pages.get(1).marker, marker);
  await background.windowFocus(2);
  assert.equal(background.pages.get(2).reads, 1);
  assert.equal(background.saved.enabled, true);
  const restarted = createBackground(background.saved);
  await restarted.focus(1);
  await restarted.startup();
  await restarted.install();
  assert.equal(restarted.pages.get(1).reads, 1);
  assert.equal(restarted.badges.get(1), "");
  assert.deepEqual(restarted.icons.get(1), {
    16: "chrome-extension://test-extension/icons/on-16.png",
    32: "chrome-extension://test-extension/icons/on-32.png",
  });
  await restarted.shortcut(1);
  const stopped = createBackground(background.saved);
  await stopped.focus(1);
  assert.equal(stopped.pages.size, 0);
});

test("busy clicks are ignored without flicker, and inactive pages are neither queried nor stopped", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const title = background.titles.get(1);
  const icon = background.icons.get(1);
  let complete;
  const first = background.pages.get(1);
  first.reader.toggle(false);
  first.process = () => new Promise((resolve) => { complete = resolve; });
  first.reader.toggle(true);
  await drain();
  const writes = background.writes.length;
  await background.shortcut(1);
  assert.equal((await background.popup({ type: "HAODU_SET_ENABLED", enabled: false })).enabled, true);
  assert.equal(background.writes.length, writes, "busy clicks are discarded");
  assert.equal(background.badges.get(1), "");
  assert.deepEqual(background.icons.get(1), icon);
  assert.equal(background.titles.get(1), title);
  assert.equal(background.disabled.size, 0);
  await background.focus(2);
  const beforeToggle = background.commands.length;
  await background.shortcut(2);
  assert.equal(background.saved.enabled, false);
  assert.equal(first.reader.status().busy, true);
  assert.ok(background.commands.slice(beforeToggle).every(({ id }) => id === 2));
  complete([[]]);
  await drain();
  assert.equal(first.reader.status().enabled, true, "inactive completion does not apply a new toggle");
  await background.focus(1);
  assert.equal(first.reader.status().enabled, false);
});

test("a busy tab ignores global OFF and synchronizes on its next idle focus", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const first = background.pages.get(1);
  let finish;
  first.reader.toggle(false);
  first.process = () => new Promise((resolve) => { finish = resolve; });
  first.reader.toggle(true);
  await background.focus(2);
  await background.shortcut(2); // Global OFF.
  await background.focus(1); // The running reader ignores OFF.
  assert.equal(first.reader.status().busy, true);
  assert.equal(first.reader.status().enabled, true);
  finish([[]]);
  await drain();
  assert.equal(first.reader.status().enabled, true, "completion must not apply a discarded command");
  assert.equal(first.reader.status().busy, false);
  assert.equal(first.reads, 2);
  assert.equal(first.clears, 1);
  assert.equal(background.saved.enabled, false);
  await background.focus(2);
  await background.focus(1);
  assert.equal(first.reader.status().enabled, false);
  assert.equal(first.marker, null);
  assert.equal(first.clears, 2);
  assert.equal(background.badges.get(1), "");
});

test("page failures stay local and focusing again doesn't retry or flip the global switch", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const first = background.pages.get(1);
  first.reader.toggle(false);
  first.process = async () => { throw new Error("failed"); };
  first.reader.toggle(true);
  await drain();
  const reads = first.reads;
  assert.equal(background.saved.enabled, true);
  assert.equal(background.badges.get(1), "ERR");
  await background.focus(2);
  assert.equal(background.pages.get(2).reader.status().enabled, true);
  await background.shortcut(2);
  await background.shortcut(2);
  await background.focus(1);
  assert.equal(first.reads, reads);
  assert.equal(background.badges.get(1), "ERR");
  first.process = async () => [[]];
  await background.shortcut(1);
  await background.shortcut(1);
  assert.equal(first.reader.status().enabled, true);
  assert.equal(background.badges.get(1), "");
  assert.deepEqual(background.icons.get(1), {
    16: "chrome-extension://test-extension/icons/on-16.png",
    32: "chrome-extension://test-extension/icons/on-32.png",
  });
});

test("a delayed busy command reply cannot erase a newer inference error", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const first = background.pages.get(1);
  first.reader.toggle(false);
  first.process = async () => { throw new Error("model failed"); };
  const resume = background.pauseSettingReply(1);
  await background.focus(1);
  assert.match(first.reader.status().error, /model failed/u);
  assert.equal(background.badges.get(1), "ERR");
  resume();
  await drain();
  assert.equal(background.badges.get(1), "ERR");
  assert.match(background.titles.get(1), /model failed/u);
});

test("restricted pages allow switching the global preference without script injection", async () => {
  const background = createBackground();
  background.addTab(1, "chrome://extensions/");
  await background.shortcut(1);
  assert.equal(background.saved.enabled, true);
  assert.equal(background.injected.length, 0);
  assert.equal(background.cssInjections.length, 0);
  assert.equal(background.commands.length, 0);
  assert.equal(background.badges.get(1), "");
  await background.focus(2);
  assert.equal(background.pages.get(2).reader.status().enabled, true);
});

test("protected pages are skipped before contacting or injecting into the page", async () => {
  const background = createBackground({ enabled: true });
  for (const url of [
    "https://chrome.google.com/webstore/devconsole/publisher/item/listing",
    "https://webstore.google.com/detail/reader/item",
    "https://chrome.google.com/",
    "https://sub.webstore.google.com/",
    "https://WEBSTORE.GOOGLE.COM./",
    "chrome://extensions/",
    "chrome-extension://another-extension/viewer.html",
    "about:blank",
  ]) {
    background.addTab(1, url);
    background.badges.set(1, "ERR");
    await background.focus(1);
    assert.equal(background.badges.get(1), "", url);
    assert.equal(background.titles.get(1), "好读（已开启 / Alt+Shift+U 切换）", url);
  }
  assert.equal(background.commands.length, 0);
  assert.equal(background.cssInjections.length, 0);
  assert.equal(background.injected.length, 0);
  assert.equal(background.creations(), 0);
  assert.equal(background.writes.length, 0);
  await background.focus(2);
  assert.equal(background.pages.get(2).reader.status().enabled, true);
});

test("the Web Store exclusion does not block other Google sites or similar URLs", async () => {
  const background = createBackground({ enabled: true });
  let id = 0;
  for (const url of [
    "https://www.google.com/search?q=chrome",
    "https://developer.chrome.com/docs/extensions/",
    "https://example.com/webstore.google.com/",
    "https://webstore.google.com.example.com/",
  ]) {
    background.addTab(++id, url);
    await background.focus(id);
    assert.equal(background.pages.get(id).reader.status().enabled, true, url);
  }
});

test("local files are quietly skipped until file access is allowed", async () => {
  const background = createBackground({ enabled: true });
  background.addTab(1, "file:///tmp/reader.html");
  await background.focus(1);
  assert.equal(background.commands.length, 0);
  assert.equal(background.cssInjections.length, 0);
  assert.equal(background.injected.length, 0);
  assert.equal(background.badges.get(1), "");
  assert.equal(background.saved.enabled, true);
  background.setFileAccess(true);
  await background.focus(1);
  assert.equal(background.pages.get(1).reader.status().enabled, true);
  assert.equal(background.badges.get(1), "");
});

test("Chrome access denials are quiet for both CSS and script injection and do not prevent later access", async () => {
  for (const method of ["insertCSS", "executeScript"]) {
    for (const message of [
      "The extensions gallery cannot be scripted.",
      "The New Tab Page cannot be scripted.",
      "Cannot access a chrome:// URL",
      "Cannot access a chrome-extension:// URL of different extension",
      "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
      'Cannot access contents of url "https://example.com/". Extension manifest must request permission to access this host.',
      "This page cannot be scripted due to an ExtensionsSettings policy.",
      "Blocked",
    ]) {
      const background = createBackground({ enabled: true });
      background.injectionErrors.set(1, { method, message });
      await background.focus(1);
      assert.equal(background.badges.get(1), "", `${method}: ${message}`);
      assert.equal(background.pages.has(1), false);
      assert.equal(background.creations(), 0);
      assert.equal(background.writes.length, 0);
      assert.ok(!background.commands.some(({ type }) => type === "HAODU_APPLY_SETTING"));
      if (method === "insertCSS") assert.equal(background.injected.length, 0);

      await background.focus(2);
      assert.equal(background.pages.get(2).reader.status().enabled, true);
      background.injectionErrors.delete(1);
      await background.focus(1);
      assert.equal(background.pages.get(1).reader.status().enabled, true);
      assert.equal(background.badges.get(1), "");
    }
  }
});

test("unexpected injection failures still show ERR", async () => {
  for (const method of ["insertCSS", "executeScript"]) {
    const background = createBackground({ enabled: true });
    const message = "Could not load file: 'missing-resource'";
    background.injectionErrors.set(1, { method, message });
    await background.focus(1);
    assert.equal(background.badges.get(1), "ERR");
    assert.equal(background.titles.get(1), message);
    assert.equal(background.saved.enabled, true);
  }
});

test("access-like errors from the reader are not mistaken for injection denials", async () => {
  const background = createBackground({ enabled: true });
  await background.focus(1);
  const page = background.pages.get(1);
  page.reader.toggle(false);
  page.process = async () => { throw new Error("Blocked"); };
  page.reader.toggle(true);
  await drain();
  assert.equal(background.badges.get(1), "ERR");
  await background.focus(1);
  assert.equal(background.badges.get(1), "ERR");
});

test("switching away during script loading leaves that tab inert until it is focused again", async () => {
  const background = createBackground({ enabled: true });
  const resume = background.pauseInjection(1);
  await background.focus(1);
  await background.focus(2);
  resume();
  await drain();
  assert.equal(background.pages.get(1).reads, 0);
  assert.equal(background.pages.get(2).reads, 1);
  assert.ok(!background.commands.some(({ id, type }) => id === 1 && type === "HAODU_APPLY_SETTING"));
  await background.focus(1);
  assert.equal(background.pages.get(1).reads, 1);
  assert.equal(background.injected.filter((id) => id === 1).length, 1);
});

test("a reload finishing during an old status check gets a fresh check without another focus event", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const oldPage = background.pages.get(1);
  const resume = background.pauseStatus(1);
  await background.focus(1);
  await background.navigate(1);
  resume();
  await drain();
  assert.ok(background.pages.has(1), "the replacement document must receive its own reader");
  assert.notEqual(background.pages.get(1), oldPage);
  assert.equal(background.pages.get(1).reads, 1);
  assert.deepEqual(background.injected, [1, 1]);
});

test("overlapping focus events recheck only the latest active tab", async () => {
  const background = createBackground();
  await background.shortcut(1);
  const resume = background.pauseStatus(1);
  await background.focus(1);
  await background.focus(2);
  await background.focus(3);
  resume();
  await drain();
  assert.equal(background.pages.has(2), false, "intermediate tabs must not be queued for processing");
  assert.equal(background.pages.get(3).reads, 1);
  assert.equal(background.pages.get(1).reads, 1);
});

test("whole viewports are forwarded intact and concurrent pages share one lazy offscreen context", async () => {
  const background = createBackground();
  assert.equal(background.creations(), 0);
  const request = { type: "HAODU_PROCESS", texts: ["这里是一段需要切分的中文文本", "甲".repeat(500)] };
  const results = await Promise.all([background.message(request, 1), background.message(request, 2)]);
  assert.equal(background.creations(), 1);
  results.forEach((result) => assert.deepEqual(result.offsetsByText, [[4], [4]]));
  assert.equal(background.requests.length, 2);
  assert.ok(background.requests.every(({ texts }) => texts === request.texts));
});

for (const browser of ["safari", "firefox"]) {
  test(`${browser} shares one lazy Worker across pages and recreates it after a background restart`, async () => {
    const background = createBackground({ enabled: true, dividerHue: 120, dividerWidth: 4 }, browser);
    await drain();
    assert.equal(background.workers.length, 0);
    background.holdInference(true);
    const request = { type: "HAODU_PROCESS", texts: [sampleText()] };
    const first = background.message(request, 1);
    const second = background.message(request, 2);
    assert.equal(background.workers.length, 1);
    const worker = background.workers[0];
    const [one, two] = worker.messages;
    worker.onmessage({ data: { id: two.id, offsetsByText: [[8]] } });
    worker.onmessage({ data: { id: one.id, offsetsByText: [[4]] } });
    assert.deepEqual((await first).offsetsByText, [[4]]);
    assert.deepEqual((await second).offsetsByText, [[8]]);
    assert.equal(background.timers.size, 0);
    assert.equal(background.creations(), 0);
    await background.restartWorker();
    const saved = await background.popup({ type: "HAODU_GET_ENABLED" });
    assert.equal(saved.enabled, true);
    assert.equal(saved.dividerHue, 120);
    assert.equal(saved.dividerWidth, 4);
    assert.equal(background.workers.length, 1, "reopening alone must not load a model");
    background.holdInference(false);
    assert.deepEqual((await background.message(request)).offsetsByText, [[4]]);
    assert.equal(background.workers.length, 2);
  });

  test(`${browser} timeouts reject all waiting pages and the next request starts a fresh Worker`, async () => {
    const background = createBackground({}, browser);
    background.holdInference(true);
    const first = background.message({ type: "HAODU_PROCESS", texts: [sampleText()] });
    const second = background.message({ type: "HAODU_PROCESS", texts: [sampleText()] }, 2);
    background.timers.values().next().value();
    assert.match((await first).error, /timed out/u);
    assert.match((await second).error, /timed out/u);
    assert.equal(background.workers[0].terminated, true);
    assert.equal(background.timers.size, 0);
    background.holdInference(false);
    assert.deepEqual((await background.message({ type: "HAODU_PROCESS", texts: [sampleText()] })).offsetsByText, [[4]]);
    assert.equal(background.workers.length, 2);
  });

  test(`${browser} uses the shared popup, appearance controls, shortcut and preview opt-out`, async () => {
    const background = createBackground({}, browser);
    await background.focus(1);
    assert.equal((await background.popup({ type: "HAODU_GET_ENABLED" })).enabled, false);
    assert.equal(background.injected.length, 0);
    await background.popup({ type: "HAODU_SET_ENABLED", enabled: true });
    const page = background.pages.get(1);
    assert.equal(page.reader.status().enabled, true);
    await background.popup({ type: "HAODU_SET_DIVIDER_HUE", dividerHue: 90 });
    await background.popup({ type: "HAODU_SET_DIVIDER_WIDTH", dividerWidth: 5 });
    assert.equal(background.saved.dividerHue, 90);
    assert.equal(page.width, 5);
    assert.equal(page.reads, 1);
    await background.shortcut(1);
    assert.equal(page.marker, null);
    const site = await preview();
    background.addTab(2, site.document.URL);
    background.previewDocuments.set(2, site.document);
    await background.focus(2);
    await background.shortcut(2);
    assert.equal(site.toggle.getAttribute("aria-checked"), "false");
    assert.equal(background.saved.enabled, false);
    assert.equal(background.pages.has(2), false);
    assert.equal(background.workers.length, 0);
    const sender = { id: "untrusted", tab: { id: 2 }, frameId: 0 };
    assert.equal(await background.popup({ type: "HAODU_PROCESS", texts: [sampleText()] }, sender), undefined);
    assert.equal(background.workers.length, 0);
  });

}

test("Safari file pages are skipped and denied website access does not become a model error", async () => {
  for (const method of ["insertCSS", "executeScript"]) {
    const background = createBackground({ enabled: true }, "safari");
    background.addTab(1, "file:///tmp/example.html");
    await background.focus(1);
    assert.equal(background.injected.length, 0);
    assert.equal(background.previewSyncs.length, 0);
    background.addTab(2);
    background.injectionErrors.set(2, { method, message: `scripting.${method}(): this extension does not have access to this tab.` });
    await background.focus(2);
    assert.equal(background.badges.get(2), "");
    assert.equal(background.saved.enabled, true);
    background.injectionErrors.delete(2);
    await background.focus(2);
    assert.equal(background.pages.get(2).reader.status().enabled, true);
    background.addTab(3);
    background.injectionErrors.set(3, { method, message: "Failed to load script resource" });
    await background.focus(3);
    assert.equal(background.badges.get(3), "ERR");
  }
});

test("Firefox permission denials are quiet, recover after access is granted, and do not hide real errors", async () => {
  for (const method of ["insertCSS", "executeScript"]) {
    const background = createBackground({ enabled: true }, "firefox");
    // Observed when executing a script on addons.mozilla.org in Firefox.
    background.injectionErrors.set(1, { method, message: "Missing host permission for the tab" });
    await background.focus(1);
    assert.equal(background.badges.get(1), "");
    assert.equal(background.pages.has(1), false);
    assert.equal(background.workers.length, 0);
    assert.equal(background.saved.enabled, true);
    background.injectionErrors.delete(1);
    await background.focus(1);
    assert.equal(background.pages.get(1).reader.status().enabled, true);
    background.injectionErrors.set(2, { method, message: "Failed to load script resource" });
    await background.focus(2);
    assert.equal(background.badges.get(2), "ERR");
  }
});

test("offscreen requests match their results; timeouts terminate the worker and allow retry", async () => {
  let listener;
  const workers = [];
  const timers = new Map();
  let nextTimer = 1;
  class FakeWorker {
    constructor() { workers.push(this); this.messages = []; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({
    Worker: FakeWorker,
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    chrome: { runtime: {
      id: "test-extension", getURL: (path) => path,
      onMessage: { addListener: (callback) => { listener = callback; } },
    } },
  });
  runScript("src/inference-service.js", context);
  runScript("src/platform/chrome/inference.js", context);
  runScript("src/start-inference.js", context);
  const request = () => new Promise((resolve) => listener({
    target: "offscreen", type: "HAODU_RUN_INFERENCE", texts: [sampleText()],
  }, { id: "test-extension" }, resolve));
  const first = request();
  const second = request();
  assert.equal(workers.length, 1);
  const [one, two] = workers[0].messages;
  workers[0].onmessage({ data: { id: two.id, offsetsByText: [[8]] } });
  assert.equal((await second).offsetsByText[0][0], 8);
  workers[0].onmessage({ data: { id: one.id, offsetsByText: [[4]] } });
  assert.equal((await first).offsetsByText[0][0], 4);
  assert.equal(timers.size, 0);
  const timeout = request();
  timers.values().next().value();
  assert.match((await timeout).error, /timed out/u);
  assert.equal(workers[0].terminated, true);
  const retry = request();
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { id: workers[1].messages[0].id, offsetsByText: [[]] } });
  assert.equal((await retry).error, undefined);
  assert.equal(timers.size, 0);
});

function sampleText() { return "将长句切分成短句加速阅读理解"; }

test("the inference service sends a whole viewport once and validates the data interface", async () => {
  const urls = [];
  const requests = [];
  class FakeWorker {
    constructor(url) { urls.push(url); }
    postMessage({ id, texts }) {
      requests.push(texts);
      this.onmessage({ data: { id, offsetsByText: texts.map(() => [4]) } });
    }
  }
  const context = vm.createContext({ Worker: FakeWorker, setTimeout, clearTimeout });
  runScript("src/inference-service.js", context);
  let service;
  context.Haodu.createInferenceAdapter = () => ({
    workerUrl: "./inference-worker.js",
    connect: (instance) => { service = instance; },
  });
  runScript("src/start-inference.js", context);
  await assert.rejects(service.runInference([42]), /invalid inference input/u);
  await assert.rejects(service.runInference("text"), /invalid inference input/u);
  assert.equal((await service.runInference([])).length, 0);
  assert.equal(urls.length, 0);
  const texts = [sampleText(), "甲".repeat(500)];
  assert.deepEqual(await service.runInference(texts), [[4], [4]]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0], texts);
  assert.deepEqual(await service.runInference([sampleText()]), [[4]]);
  assert.deepEqual(urls, ["./inference-worker.js"]);
});

test("the actual worker uses fresh recursive inference with the 13-unit and 45% gates", () => {
  let response;
  const inputs = [];
  const context = vm.createContext({ atob, btoa, console, Intl });
  context.importScripts = (...paths) => paths.forEach((path) => {
    if (path === "backend/chunker.js") {
      const model = context.HaoduModelBackend;
      context.HaoduModelBackend = { ...model, scoreTokens(tokens) {
        inputs.push(Array.from(tokens));
        return model.scoreTokens(tokens);
      } };
    }
    runScript(`src/${path}`, context);
  });
  context.postMessage = (message) => { response = message; };
  context.self = context;
  runScript("src/inference-worker.js", context);
  const texts = [
    "中文天然不使用空格切分语意块，而仅用标点断句。因此过长的的句子会破坏阅读体验。请感受本文里断句的出现是否让你的阅读更轻松。",
    "切分阅读",
    "使用神经网络，在长句中找到符合人类习惯的断句点，把长句切成更短的语意块提升阅读效率。",
    "即便是完全符合语法的通顺的但没有任何标点断句的句子模型依然能够找到恰当的切分点。",
  ];
  context.onmessage({ data: { id: 50, texts } });
  assert.equal(response.error, undefined);
  assert.equal(response.id, 50);
  assert.deepEqual(Array.from(response.offsetsByText, (cuts) => Array.from(cuts)),
    [[25, 31, 50], [], [11, 35], [10, 13, 20, 27]]);
  assert.deepEqual(inputs.map((tokens) => tokens.join("")), [
    "中文天然不使用空格切分语意块",
    "因此过长的的句子会破坏阅读体验",
    "过长的的句子会破坏阅读体验",
    "请感受本文里断句的出现是否让你的阅读更轻松",
    "在长句中找到符合人类习惯的断句点",
    "把长句切成更短的语意块提升阅读效率",
    "即便是完全符合语法的通顺的但没有任何标点断句的句子模型依然能够找到恰当的切分点",
    "即便是完全符合语法的通顺的",
    "但没有任何标点断句的句子模型依然能够找到恰当的切分点",
    "但没有任何标点断句的句子模型",
  ], "the worker passes long child fragments back into the CNN");
  assert.equal(inputs.reduce((n, tokens) => n + tokens.length, 0), 188);
});

test("the actual worker returns ordered model results for a whole viewport including long strings", () => {
  let response;
  let replies = 0;
  const context = vm.createContext({ atob, btoa, console, Intl });
  context.importScripts = (...paths) => paths.forEach((path) => runScript(`src/${path}`, context));
  context.postMessage = (message) => { response = message; replies += 1; };
  context.self = context;
  runScript("src/inference-worker.js", context);
  const texts = [
    sampleText(), `${sampleText()}。`.repeat(12), "", "English only", "𠀀甲乙丙丁戊己庚辛壬癸子丑",
    "我一直在思考明天早上的早餐吃什么".repeat(33),
    "在没有人被人特别留意的情况下，偷偷少去公司一天，几乎不会被他人发觉（切勿模仿）。",
  ];
  context.onmessage({ data: { id: 1, texts } });
  assert.equal(response.error, undefined);
  assert.equal(replies, 1);
  assert.equal(response.offsetsByText.length, texts.length);
  assert.deepEqual(Array.from(response.offsetsByText[0]), [8]);
  assert.deepEqual(Array.from(response.offsetsByText[2]), []);
  assert.deepEqual(Array.from(response.offsetsByText[3]), []);
  const warning = texts.at(-1);
  const bracketEdges = [warning.indexOf("（"), warning.indexOf("（") + 1,
    warning.indexOf("）"), warning.indexOf("）") + 1];
  assert.ok(Array.from(response.offsetsByText.at(-1)).every((offset) => !bracketEdges.includes(offset)));
  // The real confidence gate may abstain on a long repetitive input.
  const expected = require("../src/backend/chunker.js").process(texts);
  assert.deepEqual(Array.from(response.offsetsByText, (offsets) => Array.from(offsets)), expected);
  response.offsetsByText.forEach((offsets, index) => {
    let previous = 0;
    for (const offset of offsets) {
      assert.ok(Number.isInteger(offset) && offset > previous && offset < texts[index].length);
      assert.doesNotMatch(texts[index][offset], /[\uDC00-\uDFFF]/u);
      previous = offset;
    }
  });
  context.onmessage({ data: { id: 2, texts: null } });
  assert.ok(response.error);
});
