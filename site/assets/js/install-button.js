// Store selection is a UI hint, not a capability check. Without JavaScript,
// the existing Chrome store link remains available.
export function initInstallButton(document = globalThis.document, navigator = globalThis.navigator) {
  const button = document.querySelector('[data-install-button]');
  if (!button) return;

  const { userAgent = '', platform = '', maxTouchPoints = 0 } = navigator;
  let hint;
  // iPadOS may identify itself as a desktop Mac.
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1)) {
    hint = button.dataset.desktopOnly;
  } else if (/Firefox\//i.test(userAgent)) {
    if (button.dataset.firefoxUrl) {
      button.setAttribute('href', button.dataset.firefoxUrl);
      return;
    }
    hint = button.dataset.firefoxUnavailable;
  } else if (/Version\/.*Safari\//i.test(userAgent)
    && !/Chrome|Chromium|Edg|OPR/i.test(userAgent)) {
    hint = button.dataset.safariUnavailable;
  } else {
    return;
  }

  // Visitors can still view the listing and choose to install in Chrome.
  button.textContent = button.dataset.chromeFallback;
  button.setAttribute('title', hint);
}
