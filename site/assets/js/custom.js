// Load only the Bootstrap components used by the header.
import 'bootstrap/js/dist/offcanvas.js';
import 'bootstrap/js/dist/dropdown.js';
import './haodu/divider-color.js';
import './haodu/divider-width.js';
import { initReaderPreview } from './reader-preview.js';
import { initInstallButton } from './install-button.js';

initInstallButton();

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

initReaderPreview();
