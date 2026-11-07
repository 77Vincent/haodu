// Natural-clause boundaries shared by single-cut and multi-cut inference.
(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HaoduClauses = api;
})(globalThis, function createClauseAPI() {
  "use strict";

  // Training proxy punctuation is classified before NFKC. Reading-only
  // boundaries are added separately; all original glyphs stay in the output.
  const CONTEXT_PROXY = /[，。！？；…]/u;
  const HAN_SEPARATING_SPACES = /(?<=\p{Script=Han})\p{Zs}+(?=\p{Script=Han})/gu;
  const HAN_SEPARATING_ASCII_PUNCTUATION = /(?<=\p{Script=Han})[,.](?=\p{Script=Han})/gu;
  const LINE_BOUNDARY = /[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u;
  const PHYSICAL_LINE = /[^\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]+/gu;
  const NUMBER_SIGN = String.raw`[+\-−﹢﹣＋－]`;
  const NUMERIC_COLONS = new RegExp(`\\p{Number}[\\p{Zs}\\t]*：(?=[\\p{Zs}\\t]*${NUMBER_SIGN}?[\\p{Zs}\\t]*\\p{Number})`, "gu");
  const NUMBER = `${NUMBER_SIGN}? *(?:\\p{Nd}+(?:[.．]\\p{Nd}*)?|[.．]\\p{Nd}+)(?:[eEｅＥ]${NUMBER_SIGN}?\\p{Nd}+)?`;
  const NUMERIC_COMMAS = new RegExp(`(?<![\\p{Nd}.．])${NUMBER} *(，) *(?=${NUMBER})`, "gu");

  function contextBoundaryOffsets(text) {
    const numericCommas = new Set();
    if (text.includes("，")) {
      for (const line of text.matchAll(PHYSICAL_LINE)) {
        // Do not fold line breaks into spaces and accidentally join numbers.
        for (const match of line[0].replace(/\s/gu, " ").matchAll(NUMERIC_COMMAS)) {
          numericCommas.add(line.index + match.index + match[0].indexOf("，"));
        }
      }
    }
    const boundaries = new Set();
    let offset = 0;
    for (const character of text) {
      if (LINE_BOUNDARY.test(character) || (CONTEXT_PROXY.test(character) && !numericCommas.has(offset))) {
        boundaries.add(offset);
      }
      offset += character.length;
    }
    return boundaries;
  }

  function splitClauses(text) {
    if (!text) return [];

    const characters = Array.from(text);
    const clauses = [];
    let buffer = "";
    const boundaryOffsets = contextBoundaryOffsets(text);
    const numericColons = new Set(Array.from(text.matchAll(NUMERIC_COLONS), (match) => (
      match.index + match[0].length - 1
    )));
    // Spaces between Han passages are reading boundaries, not training proxies.
    // Keep the whole run in the preceding clause; tokenization trims its tail.
    for (const match of text.matchAll(HAN_SEPARATING_SPACES)) {
      boundaryOffsets.add(match.index + match[0].length - 1);
    }
    for (const match of text.matchAll(HAN_SEPARATING_ASCII_PUNCTUATION)) {
      boundaryOffsets.add(match.index);
    }
    let sourceOffset = 0;
    const sourceOffsets = characters.map((character) => {
      const start = sourceOffset;
      sourceOffset += character.length;
      return start;
    });
    // Original enumeration commas and non-numeric Chinese colons are reading
    // boundaries, not training proxies. Keep them in the preceding model input.
    const isEnd = (index) => boundaryOffsets.has(sourceOffsets[index]) ||
      characters[index] === "、" ||
      (characters[index] === "：" && !numericColons.has(sourceOffsets[index]));

    const flush = () => {
      if (!buffer) return;
      clauses.push(buffer);
      buffer = "";
    };

    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index];
      buffer += character;
      if (!isEnd(index)) continue;

      while (index + 1 < characters.length && isEnd(index + 1)) {
        index += 1;
        buffer += characters[index];
      }

      flush();
    }

    flush();
    return clauses;
  }

  return Object.freeze({ contextBoundaryOffsets, splitClauses });
});
