(function exposeChunker(root, factory) {
  const modelBackend = typeof module === "object" && module.exports
    ? require("./inference.js")
    : root.SuperReaderModelBackend;
  const api = factory(modelBackend);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SuperReaderChunker = api;
})(globalThis, function createChunker(modelBackend) {
  "use strict";

  const HAN_CHARACTER = /\p{Script=Han}/u;
  const NUMERIC_EXPRESSION = /\p{Number}+(?:[.,]\p{Number}+)?(?:\s+\p{Number}+[\/／]\p{Number}+|[\/／]\p{Number}+)?/gu;
  const MIN_SPLIT_VISUAL_LENGTH = 13;
  const MIN_SPLIT_CONFIDENCE = 0.45;
  const MAX_MODEL_WINDOW_TOKENS = 256;
  const MODEL_INFO = modelBackend?.getModelInfo?.();
  if (MODEL_INFO?.inputRepresentation !== "unicode-context-v1") {
    throw new Error("Super Reader chunker requires a unicode-context-v1 model backend");
  }
  // Each kernel-3, dilation-1 convolution adds one token of context per side.
  const MODEL_CONTEXT_RADIUS = MODEL_INFO?.convolutionLayers ?? 0;
  // Match the text policy in the private training repository. Classify ORIGINAL
  // glyphs before NFKC: ASCII/compatibility punctuation is retained context.
  const CONTEXT_PROXY = /[，。！？；…]/u;
  const LINE_BOUNDARY = /[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u;
  const PHYSICAL_LINE = /[^\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]+/gu;
  const NUMBER_SIGN = String.raw`[+\-−﹢﹣＋－]`;
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

  // Keep source UTF-16 offsets even when NFKC expands a grapheme (e.g. ﬃ).
  function normalizeContextTokens(text) {
    const graphemes = typeof Intl?.Segmenter === "function"
      ? Array.from(new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text))
      : Array.from(text).reduce((items, segment) => {
        const previous = items[items.length - 1];
        items.push({ segment, index: previous ? previous.index + previous.segment.length : 0 });
        return items;
      }, []);
    return graphemes.flatMap(({ segment, index }) => (
      Array.from(segment.normalize("NFKC"), (c) => ({ segment: /\s/u.test(c) ? " " : c, index }))
    ));
  }

  function tokenizeContext(text) {
    // Called on an already separated clause. Exclude its raw delimiters before
    // normalization; e.g. a retained ｡ may normalize to 。 and must stay a token.
    const expanded = [];
    let start = 0;
    for (const end of [...contextBoundaryOffsets(text), text.length]) {
      for (const token of normalizeContextTokens(text.slice(start, end))) {
        expanded.push({ segment: token.segment, index: start + token.index });
      }
      start = end + 1; // All source delimiters are one UTF-16 code unit.
    }
    const tokens = [];
    for (const token of expanded) {
      if (token.segment === " " && (!tokens.length || tokens[tokens.length - 1].segment === " ")) continue;
      tokens.push(token);
    }
    if (tokens[tokens.length - 1]?.segment === " ") tokens.pop();
    return tokens;
  }

  function visualLength(text) {
    const hanLength = Array.from(text).reduce(
      (length, character) => length + (HAN_CHARACTER.test(character) ? 1 : 0),
      0,
    );
    const numericExpressionLength = Array.from(text.matchAll(NUMERIC_EXPRESSION)).length;
    const latinWords = Array.from(text.matchAll(/[A-Za-zＡ-Ｚａ-ｚ]+/gu)).length;
    return hanLength + numericExpressionLength + latinWords;
  }

  function createSegmenter(locale) {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      return new Intl.Segmenter(locale || "zh-CN", { granularity: "word" });
    }
    return null;
  }

  function splitClauses(text) {
    if (!text) return [];

    const characters = Array.from(text);
    const clauses = [];
    let buffer = "";
    const boundaryOffsets = contextBoundaryOffsets(text);
    let sourceOffset = 0;
    const sourceOffsets = characters.map((character) => {
      const start = sourceOffset;
      sourceOffset += character.length;
      return start;
    });
    // The original enumeration comma is an extra reading boundary, not a
    // training proxy: it stays in the preceding fragment's model tokens.
    const isEnd = (index) => boundaryOffsets.has(sourceOffsets[index]) || characters[index] === "、";

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

  function boundaryFallsInsideWord(text, boundary, segmenter) {
    return normalizedSegments(text, segmenter).some(
      (item) => item.isWordLike && boundary > item.start && boundary < item.end,
    );
  }

  function normalizedSegments(text, segmenter) {
    if (!segmenter) return [];

    let fallbackIndex = 0;
    return Array.from(segmenter.segment(text), (item) => {
      const start = Number.isInteger(item.index) ? item.index : fallbackIndex;
      const end = start + item.segment.length;
      fallbackIndex = end;
      return { ...item, start, end };
    });
  }

  // Cumulative visual lengths at token boundaries, including numeric expressions.
  function visualOffsetsForTokens(text, tokens) {
    const ends = [];
    let index = 0;
    for (const c of text) {
      if (HAN_CHARACTER.test(c)) ends.push(index + c.length);
      index += c.length;
    }
    for (const pattern of [NUMERIC_EXPRESSION, /[A-Za-zＡ-Ｚａ-ｚ]+/gu]) {
      for (const match of text.matchAll(pattern)) ends.push(match.index + match[0].length);
    }
    ends.sort((a, b) => a - b);
    let units = 0;
    const result = tokens.map((token) => {
      while (units < ends.length && ends[units] <= token.index) units += 1;
      return units;
    });
    result[0] = 0;
    result.push(ends.length);
    return result;
  }

  function selectBestBoundary(scores, isAllowed = () => true, start = 0, end) {
    if (!Array.isArray(scores) || scores.length === 0) return null;
    end ??= scores.length;

    let bestIndex = null;
    let bestScore = -Infinity;
    for (let index = start; index < end; index += 1) {
      if (!Number.isFinite(scores[index]) || !isAllowed(index)) continue;
      // Rank by the model's raw logit; equal scores keep the first allowed gap.
      const score = scores[index];
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    return bestIndex;
  }

  // A relative distribution over the supplied gaps, before word protection.
  // Filtering candidates never renormalizes their confidence.
  function gapProbabilities(scores) {
    if (!scores.length) return [];
    if (scores.some((score) => !Number.isFinite(score))) return scores.map(() => 0);
    const maximum = scores.reduce((best, score) => Math.max(best, score), -Infinity);
    const weights = scores.map((score) => Math.exp(score - maximum));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => weight / total);
  }

  function scoreTokenWindows(tokens) {
    const scores = [];
    // Score owned gaps with a full convolution halo on both sides. Otherwise
    // an internal window seam looks like a sentence edge to the CNN.
    const radius = MODEL_CONTEXT_RADIUS;
    const stride = MAX_MODEL_WINDOW_TOKENS - 2 * radius - 1;
    if (!Number.isInteger(radius) || radius < 0 || stride < 1) {
      throw new RangeError("Model receptive field exceeds the inference window");
    }
    for (let cursor = 0; cursor < tokens.length - 1;) {
      const gapEnd = tokens.length <= MAX_MODEL_WINDOW_TOKENS
        ? tokens.length - 1 : Math.min(tokens.length - 1, cursor + stride);
      const windowStart = Math.max(0, cursor - radius);
      const windowEnd = Math.min(tokens.length, gapEnd + radius + 1);
      const windowScores = modelBackend.scoreTokens(tokens.slice(windowStart, windowEnd));
      scores.push(...windowScores.slice(cursor - windowStart, gapEnd - windowStart));
      cursor = gapEnd;
    }
    return scores;
  }

  function chunkByModel(text, segmenter, minConfidence) {
    const tokens = tokenizeContext(text);
    if (tokens.length < 2 || visualLength(text) < MIN_SPLIT_VISUAL_LENGTH) return [text];
    if (!modelBackend || typeof modelBackend.scoreTokens !== "function") {
      throw new Error("Super Reader model backend must load before the chunker");
    }
    const visualOffsets = visualOffsetsForTokens(text, tokens);
    const ranges = [];
    // Check adjacent source code points, including spaces and characters that
    // normalization changes or expands. Keep supplementary Han UTF-16 offsets.
    const hanBoundaryOffsets = new Set();
    let sourceOffset = 0;
    let previousIsHan = false;
    for (const character of text) {
      const isHan = HAN_CHARACTER.test(character);
      if (previousIsHan && isHan) hanBoundaryOffsets.add(sourceOffset);
      previousIsHan = isHan;
      sourceOffset += character.length;
    }
    const segments = normalizedSegments(text, segmenter);
    const protectedBoundaryRanges = segments
      .filter((item) => item.isWordLike)
      .map((item) => ({ start: item.start, end: item.end }));
    const protectedBoundaryOffsets = new Set(
      tokens.slice(1)
        .map((token) => token.index)
        .filter((boundary) => protectedBoundaryRanges.some(
          (range) => boundary > range.start && boundary < range.end,
        )),
    );

    function scoreRange(start, end) {
      const scores = scoreTokenWindows(tokens.slice(start, end).map((token) => token.segment));
      // Combine windows before normalization, including any short final window.
      return { scores, confidence: gapProbabilities(scores) };
    }
    // Use a stack so repeated choices near one end cannot overflow the call stack.
    const pendingRanges = [{ start: 0, end: tokens.length }];
    while (pendingRanges.length > 0) {
      const { start, end } = pendingRanges.pop();
      const length = visualOffsets[end] - visualOffsets[start];
      if (
        end - start < 2 ||
        length < MIN_SPLIT_VISUAL_LENGTH
      ) {
        ranges.push({ start, end });
        continue;
      }

      // Run the CNN again on each over-threshold child, so scores
      // reflect its new context and edges. Token offsets and protection ranges
      // stay fixed in the original clause.
      const { scores, confidence } = scoreRange(start, end);
      // Use the same confidence gate for every eligible fragment.
      // An explicit threshold supports offline comparisons, including zero abstention.
      const requiredConfidence = minConfidence ?? MIN_SPLIT_CONFIDENCE;
      const selected = selectBestBoundary(
        scores,
        (index) => (requiredConfidence === 0 || confidence[index] > requiredConfidence) &&
          tokens[start + index + 1].index > tokens[start + index].index &&
          hanBoundaryOffsets.has(tokens[start + index + 1].index) &&
          !protectedBoundaryOffsets.has(tokens[start + index + 1].index),
      );
      const boundaryAfter = selected === null ? null : selected + start;
      if (boundaryAfter === null) {
        ranges.push({ start, end });
        continue;
      }

      // Visit the left fragment first to preserve source order in the output.
      pendingRanges.push({ start: boundaryAfter + 1, end }, { start, end: boundaryAfter + 1 });
    }

    return ranges.map((range, index) => {
      const start = index === 0 ? 0 : tokens[range.start].index;
      const end = index === ranges.length - 1
        ? text.length
        : tokens[ranges[index + 1].start].index;
      return text.slice(start, end);
    });
  }

  function chunkTextByClause(text, options = {}) {
    const minConfidence = options.minConfidence;
    const scoringStrategy = options.scoringStrategy ?? "recursive-model";
    if (minConfidence != null && (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)) {
      throw new RangeError("Super Reader minConfidence must be between 0 and 1");
    }
    if (scoringStrategy !== "recursive-model") {
      throw new TypeError("Super Reader scoringStrategy must be recursive-model");
    }
    if (!text) return [];
    const segmenter = options.segmenter === undefined
      ? createSegmenter(options.locale)
      : options.segmenter;
    return splitClauses(text).map((clause) => chunkByModel(clause, segmenter, minConfidence));
  }

  function chunkText(text, options = {}) {
    return chunkTextByClause(text, options).flat();
  }

  function buildVisualChunks(text, options = {}) {
    return chunkTextByClause(text, options).flatMap((clauseChunks) => (
      clauseChunks.map((chunk, index) => {
        const processed = HAN_CHARACTER.test(chunk);
        return {
          text: chunk,
          processed,
          separated: index > 0,
        };
      })
    ));
  }

  /**
   * Process all texts from one viewport in order. Offsets are ascending UTF-16
   * positions inside each corresponding input; no DOM or task scheduling here.
   * @param {string[]} texts
   * @param {{minConfidence?: number, scoringStrategy?: "recursive-model"}} options
   * Defaults to >45% at 13 or more visual units; shorter
   * fragments skip inference. Each eligible child receives fresh inference.
   * An explicit minConfidence overrides the default; 0 disables abstention.
   * @returns {number[][]}
   */
  function process(texts, options = {}) {
    const segmenter = createSegmenter("zh-CN");
    return texts.map((text) => {
      const offsets = [];
      let offset = 0;
      for (const chunk of buildVisualChunks(text, { ...options, segmenter })) {
        if (chunk.separated) offsets.push(offset);
        offset += chunk.text.length;
      }
      return offsets;
    });
  }

  return Object.freeze({
    MIN_SPLIT_CONFIDENCE,
    gapProbabilities,
    process,
    boundaryFallsInsideWord,
    buildVisualChunks,
    chunkText,
    chunkTextByClause,
    createSegmenter,
    selectBestBoundary,
    scoreTokenWindows,
    splitClauses,
    tokenizeContext,
    visualLength,
  });
});
