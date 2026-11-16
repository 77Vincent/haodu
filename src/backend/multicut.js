// Multi-cut decoder shared by extension workers and benchmark.
(function expose(root, factory) {
  const input = typeof module === 'object' && module.exports
    ? require('./multicut-input.js') : root.HaoduMultiCutInput;
  const clauses = typeof module === 'object' && module.exports
    ? require('./clauses.js') : root.HaoduClauses;
  const api = Object.freeze({createChunker: (data, model) => factory(data, model, input, clauses)});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaoduMultiCut = api;
})(globalThis, function createChunker(data, model, input, clauses) {
  'use strict';
  const SHORT_SEGMENT_CHARACTERS = 2;
  const config = data?.multiCut;
  if (data?.task !== 'multi' || !config || !Number.isFinite(config.threshold) ||
      config.threshold <= 0 || config.threshold >= 1 || !Number.isInteger(config.maximumCharacters) ||
      config.maximumCharacters < 2) throw Error('Invalid multi-cut model contract');
  const normalize = input.createNormalizer(config.inputPolicy);
  // Temporarily disabled by default; retain the filter for explicit experiments.
  const preventConsecutiveShortSegments = config.preventConsecutiveShortSegments === true;
  function selectCuts(candidates, length) {
    // Multiple normalized gaps may map to one original offset. Keep its strongest
    // representative before measuring fragments, rather than emitting duplicates.
    const unique = new Map();
    for (const candidate of candidates) {
      const previous = unique.get(candidate.cut);
      if (!previous || candidate.score > previous.score ||
          (candidate.score === previous.score && candidate.gap < previous.gap)) {
        unique.set(candidate.cut, candidate);
      }
    }
    const ordered = [...unique.values()].sort((a,b) => a.gap-b.gap);
    if (!preventConsecutiveShortSegments) return ordered.map(node => node.cut);
    const boundaries = [{gap:0}, ...ordered, {gap:length}];
    boundaries.forEach((node,i) => {
      node.previous = boundaries[i-1];
      node.next = boundaries[i+1];
    });
    // Only remove cuts touching a pair of adjacent short fragments. This includes
    // their outer cuts: merging either short fragment with a neighbor also helps.
    // Merges only increase fragment lengths, so no new short-pair violation can
    // appear. One score-ordered pass with live neighbors is therefore equivalent
    // to repeatedly finding the weakest currently helpful cut, in O(n log n).
    // Compare logits even when float32 sigmoid rounds probabilities alike.
    for (const node of [...ordered].sort((a,b) => a.score-b.score || b.gap-a.gap)) {
      const left = node.previous, right = node.next;
      const shortLeft = node.gap-left.gap <= SHORT_SEGMENT_CHARACTERS;
      const shortRight = right.gap-node.gap <= SHORT_SEGMENT_CHARACTERS;
      const violation = (shortLeft && shortRight) ||
        (shortLeft && left.previous && left.gap-left.previous.gap <= SHORT_SEGMENT_CHARACTERS) ||
        (shortRight && right.next && right.next.gap-right.gap <= SHORT_SEGMENT_CHARACTERS);
      if (!violation) continue;
      left.next = right;
      right.previous = left;
      node.removed = true;
    }
    return ordered.filter(node => !node.removed).map(node => node.cut);
  }
  function processClause(raw) {
    if (!/\p{Script=Han}/u.test(raw)) return [];
    // Normalize the already separated clause once; windows retain its context.
    const {tokens, mapping} = normalize(raw);
    // No length floor beyond needing an internal character gap.
    if (tokens.length < 2) return [];
    const candidates = [];
    let start = 0, originalStart = 0;
    while (start < tokens.length-1) {
      const window = tokens.slice(start, start + config.maximumCharacters);
      const scores = model.scoreTokens(window);
      if (scores.length !== window.length-1 || scores.some(x => !Number.isFinite(x))) throw Error('Invalid multi-cut logits');
      let lastGap = null;
      scores.forEach((score, i) => {
        // Float32 sigmoid and threshold, as in validation; no softmax or argmax.
        const probability = Math.fround(1 / (1 + Math.exp(-score)));
        const gap = start+i+1, cut = mapping.get(gap);
        if (probability >= Math.fround(config.threshold) && cut > originalStart && cut < raw.length) {
          candidates.push({gap, cut, score});
          lastGap = gap;
        }
      });
      // A complete tail (including exactly the input limit) may have no cuts.
      if (start + window.length === tokens.length) break;
      if (lastGap === null) {
        throw Error(`Multi-cut window at normalized offset ${start} (${window.length} characters) has no valid cut at threshold ${config.threshold}; refusing to skip remaining input`);
      }
      // Advance on raw candidates; final selection may remove this cursor boundary.
      // This lets a higher-scoring cut in the next window win a nearby conflict.
      start = lastGap;
      originalStart = mapping.get(start);
    }
    return selectCuts(candidates, tokens.length);
  }
  function process(texts) {
    return texts.map(raw => {
      const cuts = [];
      let offset = 0;
      for (const clause of clauses.splitClauses(raw)) {
        for (const cut of processClause(clause)) cuts.push(offset + cut);
        offset += clause.length;
      }
      // Natural clause boundaries never become model-generated dividers.
      return cuts;
    });
  }
  return Object.freeze({process, getSettings: () => ({
    task: 'multi', recursion: false, min_visual_length: null,
    min_segment_characters: null, prevent_consecutive_short_segments: preventConsecutiveShortSegments,
    short_segment_max_characters: preventConsecutiveShortSegments ? SHORT_SEGMENT_CHARACTERS : null,
    max_consecutive_short_segments: preventConsecutiveShortSegments ? 1 : null,
    segment_length_unit: 'normalized Unicode characters',
    cut_selection: preventConsecutiveShortSegments
      ? 'remove lowest-logit cut touching adjacent short segments; later gap on ties'
      : 'all threshold-passing mappable gaps; deduplicated by original offset',
    cut_selection_scope: 'complete clause across windows',
    presegmentation: 'shared natural clauses', non_han_clauses: 'skip',
    normalization_scope: 'clause', window_scope: 'clause',
    min_confidence: config.threshold, confidence: 'sigmoid >= threshold',
    threshold_source: config.thresholdSource, max_model_window_tokens: config.maximumCharacters,
    long_input: 'advance from last predicted mappable cut',
    nonfinal_window_without_cut: 'error', final_window_without_cut: 'accept',
    input_policy: config.inputPolicy.standard, normalization: 'actual proxies before NFKC',
    candidate_positions: 'all internal Unicode character gaps',
    unmappable_gaps: 'skip gaps inside normalization expansions',
  })});
});
