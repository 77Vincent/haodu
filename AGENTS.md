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
The default loads this repository's own `src/backend` and exported model. Never
make this command depend on a training checkout, checkpoint, PyTorch or training
metadata. Custom exported models use `--model /path/model.js --output /path/results`.

The official BZNSYP corpus is installed in ignored `benchmark/golden/cases.csv`;
its fixed hash and import instructions are tracked. Do not redistribute the
corpus or research weights with the public code. Missing data must produce an
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
