/* Single-pass research backend; uses the same FP32 JS network as production. */
(function expose(root) {
  'use strict';
  const data = root.HaoduBoundaryModelData, config = data?.multiCut;
  if (data?.task !== 'multi' || !config || !Number.isFinite(config.threshold) ||
      config.threshold <= 0 || config.threshold >= 1 || !Number.isInteger(config.maximumCharacters) ||
      config.maximumCharacters < 2) throw Error('Invalid multi-cut model contract');
  const normalize = root.HaoduMultiCutInput.createNormalizer(config.inputPolicy);
  function process(texts) {
    return texts.map(raw => {
      const {tokens, mapping} = normalize(raw);
      if (tokens.length > config.maximumCharacters) throw Error(`Multi-cut input exceeds ${config.maximumCharacters} characters; refusing truncation`);
      if (tokens.length < 2) return [];
      const scores = root.HaoduModelBackend.scoreTokens(tokens);
      if (scores.length !== tokens.length-1 || scores.some(x => !Number.isFinite(x))) throw Error('Invalid multi-cut logits');
      const cuts = new Set();
      scores.forEach((score, i) => {
        // Float32 sigmoid and threshold, as in validation; no softmax or argmax.
        const probability = Math.fround(1 / (1 + Math.exp(-score)));
        const cut = mapping.get(i+1);
        if (probability >= Math.fround(config.threshold) && cut > 0 && cut < raw.length) cuts.add(cut);
      });
      return [...cuts].sort((a,b) => a-b);
    });
  }
  root.HaoduChunker = Object.freeze({process, getSettings: () => ({
    task: 'multi', recursion: false, min_visual_length: null,
    min_confidence: config.threshold, confidence: 'sigmoid >= threshold',
    threshold_source: config.thresholdSource, max_model_window_tokens: config.maximumCharacters,
    input_policy: config.inputPolicy.standard, normalization: 'actual proxies before NFKC',
    candidate_positions: 'all internal Unicode character gaps',
    unmappable_gaps: 'skip gaps inside normalization expansions',
  })});
})(globalThis);
