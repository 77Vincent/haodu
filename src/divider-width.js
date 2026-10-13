(function defineDividerWidth() {
  "use strict";

  globalThis.Haodu ??= {};
  const validWidth = (value) => Number.isInteger(value) && value >= 1 && value <= 5;
  const normalizeWidth = (value) => validWidth(value) ? value : 2;
  globalThis.Haodu.dividerWidth = { validWidth, normalizeWidth };
})();
