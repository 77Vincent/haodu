// Exercise the legacy decoder separately from the default model task dispatch.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createChunker } = require('../../src/backend/single-cut.js');
const chunker = createChunker(require('../../src/backend/inference.js'));
const source = ['clauses.js', 'single-cut.js'].map(name =>
  readFileSync(join(__dirname, '../../src/backend', name), 'utf8')).join('\n') +
  '\nglobalThis.HaoduChunker = HaoduSingleCut.createChunker(HaoduModelBackend);';
module.exports = {chunker, source};
