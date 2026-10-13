(function defineDividerColor() {
  "use strict";

  globalThis.Haodu ??= {};
  const DEFAULT_COLOR = "#ff1744";
  const validHue = (value) => Number.isInteger(value) && value >= 0 && value <= 360;
  const normalizeHue = (value) => validHue(value) ? value : 0;

  function colorForHue(value) {
    const hue = normalizeHue(value);
    if (hue === 0 || hue === 360) return DEFAULT_COLOR;
    // Rotate the existing red through a full spectrum, keeping its saturation
    // and lightness. RGB channels range from 23 to 255; its blue channel is 68.
    const sector = (hue / 60 + 6 - (68 - 23) / (255 - 23)) % 6;
    const chroma = 255 - 23;
    const x = chroma * (1 - Math.abs(sector % 2 - 1));
    const channels = [
      [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
      [0, x, chroma], [x, 0, chroma], [chroma, 0, x],
    ][Math.floor(sector)];
    return `#${channels.map((channel) => Math.round(channel + 23).toString(16).padStart(2, "0")).join("")}`;
  }

  globalThis.Haodu.dividerColor = {
    validHue, normalizeHue, colorForHue,
    gradient: `linear-gradient(to right, ${Array.from({ length: 37 }, (_, i) => colorForHue(i * 10)).join(", ")})`,
  };
})();
