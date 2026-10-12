// Load only the Bootstrap components used by the header.
import 'bootstrap/js/dist/offcanvas.js';
import 'bootstrap/js/dist/dropdown.js';

// Doks binds theme selection to the SVGs. Forward button/keyboard activation
// to the appropriate SVG so the entire button uses Doks' existing theme logic.
const themeButton = document.querySelector('#buttonColorMode');
if (themeButton) {
  themeButton.addEventListener('click', (event) => {
    if (event.target.closest('[data-bs-theme-value]')) return;
    const nextTheme = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    themeButton.querySelector(`[data-bs-theme-value="${nextTheme}"]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// Toggle manually maintained markers in the lead and demos; brand dividers stay visible.
const readerToggle = document.querySelector('[data-reader-toggle]');
if (readerToggle) {
  const installButton = document.querySelector('[data-install-button]');
  if (installButton) {
    // Match the rendered grid width, including responsive layout and font changes.
    const syncToggleSize = () => {
      const { width, height } = installButton.getBoundingClientRect();
      readerToggle.style.width = `${width}px`;
      readerToggle.style.height = `${height}px`;
    };
    syncToggleSize();
    new ResizeObserver(syncToggleSize).observe(installButton);
  }
  const markers = document.querySelectorAll('.reader-divider');
  const label = readerToggle.querySelector('[data-reader-label]');
  readerToggle.addEventListener('click', () => {
    const enabled = readerToggle.getAttribute('aria-pressed') !== 'true';
    markers.forEach((marker) => { marker.hidden = !enabled; });
    readerToggle.setAttribute('aria-pressed', String(enabled));
    label.textContent = enabled ? readerToggle.dataset.labelHide : readerToggle.dataset.labelShow;
  });
  readerToggle.hidden = false;
}
