# Backend regression checks

The fixed full BZNSYP quality/speed benchmark is available from this root:

```sh
npm run golden:benchmark
```

Do not run the full benchmark merely because a commit was requested. Run it
when the user requests a quality/performance evaluation or agrees to benchmark
validation for a substantive backend/model change. Reuse applicable completed
checks when committing already-validated work; do not impose a per-commit
benchmark gate.

The runner, scoring, dataset provenance and focused tests live in `benchmark/`.
The default loads this repository's own `src/backend` and exported model, with
no training checkout or PyTorch dependency. Custom exported models use
`--model /path/model.js --output /path/results`. An explicit `--checkpoint /path/model.pt`
imports single/multi-cut FP32 tensors and their validated input contract before
measurement. Only that optional import needs PyTorch; it never imports private
training modules, resolves a training manifest, or trains/selects weights. Both
tasks run the same JavaScript inference engine and benchmark measurement loop.
Single-cut checkpoints use the existing recursive decoder with its 13-visual-unit
floor and softmax > 0.45 gate; only multi-cut imports a sigmoid validation threshold.
Both tasks enter `src/backend/chunker.js`, which dispatches using model metadata.
Both decoders use the same `src/backend/clauses.js` presegmentation and skip
clauses without Han. Multi-cut normalization and windowed decoding operate
independently within each pre-split clause; never join clauses across proxies.
Fragmentation prevention is temporarily disabled by default: retain every
threshold-passing mappable cut, deduplicating original offsets. Consecutive short
pieces are allowed. The retained filter is enabled only by explicitly setting
`multiCut.preventConsecutiveShortSegments: true`; when enabled, forbid two
adjacent pieces both at most two normalized Unicode characters. Across the whole
clause, remove the lowest-logit cut touching a violating pair, rechecking the merged
pieces after each removal; remove the later gap first on ties. Either the pair's
internal cut or its outer cuts can help by merging a short piece with a neighbor.
Do not minimize deletion count ahead of score. There is no independent input floor
or three-character minimum per piece; fewer than two characters need no inference.
Never merge separate natural clauses to fix short pieces.
Each window predicts all cuts once, with long clauses advancing from the last raw
predicted cut before final selection. Natural clause boundaries are not emitted as model dividers.
The bundled export is the explicitly promoted single-cut epoch-1 checkpoint at
5,250,006,027 samples, using the 13-visual-unit floor and strict softmax > 0.45
gate. Multi-cut decoding remains available for explicitly supplied multi-cut models.
Preserve original checkpoint validation records. Do not duplicate decoders
inside benchmark or silently promote another checkpoint.

The official BZNSYP corpus is installed in ignored `benchmark/golden/cases.csv`;
its fixed hash and import instructions are tracked. Do not redistribute the
corpus or unselected research checkpoints with the public code; only the explicitly
promoted browser export belongs in src/boundary-model-data.js. Missing data must produce an
actionable setup error, never silently select another dataset.

The benchmark covers all 10,000 sentences, with #3 required, #2 optional and
closing-double-quote equivalence. One invocation tests one backend/model. It uses
eight fixed processes with disjoint shards, 100 warmup sentences per worker, and
two sequential passes (parallel within each pass), averaged arithmetically. It reports quality, batch
wall time, and summed backend/model call times. Different worker counts and the
old serial protocol are not performance-comparable. Do not substitute a filtered
threshold cohort, cached predictions, or a temporary ad hoc script.

The main result is the compact `artifacts/backend-benchmark/public/parallel-8/report.json`, containing
backend/model/rules, test settings, accuracy/precision/recall/F1 and performance.
Do not generate Markdown reports or rerun inference just to change formatting.

Read `docs/backend-benchmark.md` for report fields and exit
codes. Ordinary runs compare to the pinned baseline. Do not use `--set-baseline`
to hide a regression; updating an existing baseline requires the user's explicit
acceptance. Avoid concurrent training/benchmarks while measuring speed.
