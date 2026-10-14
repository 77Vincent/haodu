// Static preview: change marker appearance and visibility, never the saved cut points.
export function initReaderPreview(document = globalThis.document) {
  const controls = document.querySelector('[data-reader-controls]');
  if (!controls) return;
  const toggle = controls.querySelector('#reader-toggle');
  const label = controls.querySelector('#reader-toggle-state');
  const hue = controls.querySelector('#divider-hue');
  const width = controls.querySelector('#divider-width');
  const shortcutHint = controls.querySelector('#shortcut-hint');
  const shortcutText = controls.querySelector('#reader-shortcut');
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

  function togglePreview() {
    renderEnabled(toggle.getAttribute('aria-checked') !== 'true');
  }

  function renderShortcut() {
    const binding = toggle.dataset.haoduExtensionShortcut;
    const platform = document.defaultView?.navigator?.platform || '';
    shortcutText.textContent = binding === undefined
      ? (/Mac/u.test(platform) ? '⌥⇧U' : 'Alt+Shift+U')
      : (binding || controls.dataset.shortcutUnset);
    shortcutHint.hidden = false;
  }

  function isEditing(target) {
    return target?.isContentEditable || target?.closest?.(
      'textarea, select, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
    );
  }

  let composing = false;
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; });
  document.addEventListener('keydown', (event) => {
    // Once connected, Chrome owns the binding and forwards only its command.
    // This also respects a custom or explicitly unassigned extension shortcut.
    if (toggle.dataset.haoduExtensionShortcut !== undefined || event.defaultPrevented
      || composing || event.isComposing || isEditing(event.composedPath?.()[0] || event.target)
      || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyU') return;
    event.preventDefault();
    if (!event.repeat) togglePreview();
  });
  toggle.addEventListener('haodu:preview-shortcut', renderShortcut);
  toggle.addEventListener('haodu:preview-toggle', () => {
    if (!controls.hidden && !composing && !isEditing(document.activeElement)) togglePreview();
  });
  toggle.addEventListener('click', togglePreview);
  hue.addEventListener('input', renderAppearance);
  width.addEventListener('input', renderAppearance);
  renderAppearance();
  renderEnabled(true);
  renderShortcut();
  controls.hidden = false;
}
