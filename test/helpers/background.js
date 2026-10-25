const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const runScript = (path, context) => vm.runInContext(
  readFileSync(join(__dirname, "../..", path), "utf8"), context, { filename: path },
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
          const png = readFileSync(join(__dirname, "../..", url.pathname.slice(1)));
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
  const manifest = JSON.parse(readFileSync(join(__dirname, "../../manifest.json"), "utf8"));
  const boot = () => {
    const context = vm.createContext({ console, chrome, URL, Worker: FakeWorker,
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    });
    if (browser !== "chrome") {
      // Use exactly the script order emitted in the target manifest.
      const { extensionTarget } = require("../../scripts/extension-targets.mjs");
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

module.exports = { createBackground, drain, runScript };
