// One runtime source tree; only the background host and manifest differ.
export function extensionTarget(sourceManifest, browser = 'chrome') {
  if (!['chrome', 'safari'].includes(browser)) throw new Error(`Unsupported browser: ${browser}`);
  const manifest = structuredClone(sourceManifest);
  const common = [
    'manifest.json',
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
  if (browser === 'safari') {
    delete manifest.minimum_chrome_version;
    manifest.permissions = manifest.permissions.filter(permission => permission !== 'offscreen');
    manifest.host_permissions = manifest.host_permissions.filter(pattern => !pattern.startsWith('file:'));
    manifest.background = {
      scripts: [
        'src/divider-color.js', 'src/divider-width.js', 'src/inference-service.js',
        'src/platform/safari/background.js', 'src/platform/webextension/background.js',
      ],
      persistent: false,
    };
  }
  return {
    manifest,
    files: [...common, ...(browser === 'safari' ? ['src/platform/safari/background.js'] : [
      'src/platform/chrome/background.js', 'src/platform/chrome/inference.js',
      'src/inference.html', 'src/start-inference.js',
    ])].sort(),
    directory: browser === 'safari' ? 'safari-extension' : 'extension',
    archive: `haodu-${manifest.version}${browser === 'safari' ? '-safari' : ''}.zip`,
    report: browser === 'safari' ? 'safari-extension-release.json' : 'extension-release.json',
  };
}
