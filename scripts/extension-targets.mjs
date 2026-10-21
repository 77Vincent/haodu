// One runtime source tree; only the background host and manifest differ.
export function extensionTarget(sourceManifest, browser = 'chrome') {
  if (!['chrome', 'safari', 'firefox'].includes(browser)) throw new Error(`Unsupported browser: ${browser}`);
  const manifest = structuredClone(sourceManifest);
  const common = [
    'manifest.json',
    '_locales/zh_CN/messages.json',
    'icons/on-16.png', 'icons/on-32.png', 'icons/on-48.png', 'icons/on-128.png',
    'icons/off-16.png', 'icons/off-32.png',
    'src/app/reader.js',
    'src/backend/chunker.js', 'src/backend/inference.js', 'src/boundary-model-data.js',
    'src/content.css', 'src/divider-color.js', 'src/divider-width.js',
    'src/frontend/content-changes.js', 'src/frontend/dom-tree.js',
    'src/frontend/processed-text.js', 'src/frontend/read.js',
    'src/frontend/viewport.js', 'src/frontend/visibility.js', 'src/frontend/write.js',
    'src/inference-service.js', 'src/inference-worker.js',
    'src/popup.html', 'src/popup.css', 'src/reader-controls.css',
    'src/platform/webextension/background.js', 'src/platform/webextension/content.js',
    'src/platform/webextension/popup.js', 'src/start-reader.js',
  ];
  if (browser !== 'chrome') {
    delete manifest.minimum_chrome_version;
    manifest.permissions = manifest.permissions.filter(permission => permission !== 'offscreen');
    if (browser === 'safari') {
      manifest.host_permissions = manifest.host_permissions.filter(pattern => !pattern.startsWith('file:'));
    }
    manifest.background = {
      scripts: [
        'src/divider-color.js', 'src/divider-width.js', 'src/inference-service.js',
        `src/platform/${browser}/background.js`, 'src/platform/webextension/background.js',
      ],
      persistent: false,
    };
  }
  if (browser === 'firefox') {
    delete manifest.background.persistent; // MV3 event pages are always nonpersistent.
    manifest.browser_specific_settings = { gecko: {
      id: 'haodu@haodu.site',
      strict_min_version: '140.0',
      // Text and preferences stay inside the local browser; no telemetry.
      data_collection_permissions: { required: ['none'] },
    } };
    // AMO parses executable JS only up to 5 MB. Keep weights as local data.
    common.splice(common.indexOf('src/boundary-model-data.js'), 1,
      'src/boundary-model-data.json', 'src/boundary-model-weights.bin');
    common.splice(common.indexOf('src/inference-worker.js'), 1, 'src/platform/firefox/inference-worker.js');
  }
  const suffix = browser === 'chrome' ? '' : `-${browser}`;
  return {
    manifest,
    files: [...common, ...(browser !== 'chrome' ? [`src/platform/${browser}/background.js`] : [
      'src/platform/chrome/background.js', 'src/platform/chrome/inference.js',
      'src/inference.html', 'src/start-inference.js',
    ])].sort(),
    directory: browser === 'chrome' ? 'extension' : `${browser}-extension`,
    archive: `haodu-${manifest.version}${suffix}.zip`,
    report: browser === 'chrome' ? 'extension-release.json' : `${browser}-extension-release.json`,
  };
}
