/* Multi-cut research backend; uses the same FP32 JS network as production. */
(function expose(root) {
  'use strict';
  const data = root.HaoduBoundaryModelData, config = data?.multiCut;
  if (data?.task !== 'multi' || !config || !Number.isFinite(config.threshold) ||
      config.threshold <= 0 || config.threshold >= 1 || !Number.isInteger(config.maximumCharacters) ||
      config.maximumCharacters < 2) throw Error('Invalid multi-cut model contract');
  const normalize = root.HaoduMultiCutInput.createNormalizer(config.inputPolicy);
  function process(texts) {
    return texts.map(raw => {
      // Normalize once so windowing cannot change proxy/quote context or offsets.
      const {tokens, mapping} = normalize(raw);
      if (tokens.length < 2) return [];
      const cuts = new Set();
      let start = 0, originalStart = 0;
      while (start < tokens.length-1) {
        const window = tokens.slice(start, start + config.maximumCharacters);
        const scores = root.HaoduModelBackend.scoreTokens(window);
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
    });
  }
  root.HaoduChunker = Object.freeze({process, getSettings: () => ({
    task: 'multi', recursion: false, min_visual_length: null,
    min_confidence: config.threshold, confidence: 'sigmoid >= threshold',
    threshold_source: config.thresholdSource, max_model_window_tokens: config.maximumCharacters,
    long_input: 'advance from last predicted mappable cut',
    nonfinal_window_without_cut: 'error', final_window_without_cut: 'accept',
    input_policy: config.inputPolicy.standard, normalization: 'actual proxies before NFKC',
    candidate_positions: 'all internal Unicode character gaps',
    unmappable_gaps: 'skip gaps inside normalization expansions',
  })});
})(globalThis);
