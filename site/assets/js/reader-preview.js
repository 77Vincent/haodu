// Static preview: change marker appearance and visibility, never the saved cut points.
export function initReaderPreview(document = globalThis.document) {
  const controls = document.querySelector('[data-reader-controls]');
  if (!controls) return;
  const toggle = controls.querySelector('#reader-toggle');
  const label = controls.querySelector('#reader-toggle-state');
  const hue = controls.querySelector('#divider-hue');
  const width = controls.querySelector('#divider-width');
  const markers = document.querySelectorAll('.reader-divider');
  const { colorForHue, normalizeHue, gradient } = globalThis.Haodu.dividerColor;
  const { normalizeWidth } = globalThis.Haodu.dividerWidth;
  const style = document.documentElement.style;
  controls.style.setProperty('--divider-spectrum', gradient);

  function renderAppearance() {
    hue.value = String(normalizeHue(Number(hue.value)));
    width.value = String(normalizeWidth(Number(width.value)));
    const color = colorForHue(Number(hue.value));
    style.setProperty('--selected-divider-color', color);
    style.setProperty('--selected-divider-width', width.value);
    hue.setAttribute('aria-valuetext', color);
    width.setAttribute('aria-valuetext', controls.dataset.widthLabel.replace('{value}', width.value));
  }

  function renderEnabled(enabled) {
    markers.forEach((marker) => { marker.hidden = !enabled; });
    toggle.setAttribute('aria-checked', String(enabled));
    label.textContent = enabled ? controls.dataset.labelOn : controls.dataset.labelOff;
    hue.disabled = !enabled;
    width.disabled = !enabled;
  }

  toggle.addEventListener('click', () => {
    renderEnabled(toggle.getAttribute('aria-checked') !== 'true');
  });
  hue.addEventListener('input', renderAppearance);
  width.addEventListener('input', renderAppearance);
  renderAppearance();
  renderEnabled(true);
  controls.hidden = false;
}
