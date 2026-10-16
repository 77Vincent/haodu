const test = require('node:test');
const assert = require('node:assert/strict');

const chromeURL = 'https://chromewebstore.google.com/detail/haodu/fdkefmimhojbfbiekkkmeliifmclfhdk';
const firefoxURL = 'https://addons.mozilla.org/firefox/addon/haodu/';
const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15';
const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';

async function installButton(userAgent, { url = '', platform = 'MacIntel', maxTouchPoints = 0, english = false } = {}) {
  const attributes = { href: chromeURL, target: '_blank', rel: 'noopener' };
  const button = {
    dataset: {
      firefoxUrl: url,
      chromeFallback: english ? 'View Chrome version' : '查看 Chrome 版',
      firefoxUnavailable: english ? 'Firefox coming soon' : 'Firefox 版待上架',
      safariUnavailable: english ? 'Safari unavailable' : 'Safari 版未上架',
      desktopOnly: english ? 'Install on desktop' : '请在电脑上安装',
    },
    textContent: english ? 'Install now' : '现在安装',
    classList: new Set(),
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
  };
  const { initInstallButton } = await import('../site/assets/js/install-button.js');
  initInstallButton({ querySelector: () => button }, { userAgent, platform, maxTouchPoints });
  return { button, attributes };
}

function assertChromeFallback(result, hint, english = false) {
  assert.equal(result.button.textContent, english ? 'View Chrome version' : '查看 Chrome 版');
  assert.equal(result.attributes.title, hint);
  assert.equal(result.attributes.href, chromeURL, 'the Chrome listing stays accessible in every browser');
  assert.equal(result.attributes.target, '_blank');
  assert.equal(result.attributes.rel, 'noopener');
  assert.equal(result.attributes['aria-disabled'], undefined);
  assert.equal(result.attributes.tabindex, undefined, 'the link remains keyboard accessible');
  assert.equal(result.button.classList.has('disabled'), false);
}

test('desktop Firefox uses AMO only when its public listing is configured', async () => {
  assertChromeFallback(await installButton(firefox), 'Firefox 版待上架');
  assertChromeFallback(await installButton(firefox, { english: true }), 'Firefox coming soon', true);
  for (const english of [false, true]) {
    const result = await installButton(firefox, { url: firefoxURL, english });
    assert.equal(result.attributes.href, firefoxURL);
    assert.equal(result.attributes.target, '_blank');
    assert.equal(result.attributes.rel, 'noopener');
    assert.equal(result.attributes['aria-disabled'], undefined);
    assert.equal(result.button.textContent, english ? 'Install now' : '现在安装');
  }
});

test('Chrome, Edge and unknown desktop browsers retain the existing store link', async () => {
  for (const ua of [chrome, `${chrome} Edg/140.0.0.0`, '']) {
    const result = await installButton(ua, { url: firefoxURL });
    assert.equal(result.attributes.href, chromeURL);
    assert.equal(result.attributes.target, '_blank');
    assert.equal(result.attributes['aria-disabled'], undefined);
    assert.equal(result.button.textContent, '现在安装');
  }
});

test('Safari keeps the Chrome listing accessible while explaining availability', async () => {
  assertChromeFallback(await installButton(safari), 'Safari 版未上架');
  assertChromeFallback(await installButton(safari, { english: true }), 'Safari unavailable', true);
});

test('mobile browsers keep access to Chrome instead of the desktop-only Firefox listing', async () => {
  for (const userAgent of [
    'Mozilla/5.0 (Android 16; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
    'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ]) {
    assertChromeFallback(await installButton(userAgent, { url: firefoxURL }), '请在电脑上安装');
  }
  assertChromeFallback(await installButton(safari, { maxTouchPoints: 5, english: true }), 'Install on desktop', true);
});

test('pages without an install button need no browser detection', async () => {
  const { initInstallButton } = await import('../site/assets/js/install-button.js');
  assert.doesNotThrow(() => initInstallButton({ querySelector: () => null }, undefined));
});
