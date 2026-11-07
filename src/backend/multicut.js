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
  const config = data?.multiCut;
  if (data?.task !== 'multi' || !config || !Number.isFinite(config.threshold) ||
      config.threshold <= 0 || config.threshold >= 1 || !Number.isInteger(config.maximumCharacters) ||
      config.maximumCharacters < 2) throw Error('Invalid multi-cut model contract');
  const normalize = input.createNormalizer(config.inputPolicy);
  function processClause(raw) {
    if (!/\p{Script=Han}/u.test(raw)) return [];
    // Normalize the already separated clause once; windows retain its context.
    const {tokens, mapping} = normalize(raw);
    if (tokens.length < 2) return [];
    const cuts = new Set();
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
          cuts.add(cut);
          lastGap = gap;
        }
      });
      // A complete tail (including exactly the input limit) may have no cuts.
      if (start + window.length === tokens.length) break;
      if (lastGap === null) {
        throw Error(`Multi-cut window at normalized offset ${start} (${window.length} characters) has no valid cut at threshold ${config.threshold}; refusing to skip remaining input`);
      }
      // Keep every predicted cut; re-score the unfinished suffix with more context.
      start = lastGap;
      originalStart = mapping.get(start);
    }
    return [...cuts].sort((a,b) => a-b);
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
