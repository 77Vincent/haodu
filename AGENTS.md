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

This delegates to the adjacent private `../haodu-training` checkout, uses this
repository's actual backend and model export, and keeps its public-target
baseline there under `public/parallel-8/` by default. Do not copy private datasets or research weights into this repo.
If the private checkout is unavailable, report the benchmark as not run.

The benchmark covers all 10,000 sentences, with #3 required, #2 optional and
closing-double-quote equivalence. One invocation tests one backend/model. It uses
eight fixed processes with disjoint shards, 100 warmup sentences per worker, and
two sequential passes (parallel within each pass), averaged arithmetically. It reports quality, batch
wall time, and summed backend/model call times. Different worker counts and the
old serial protocol are not performance-comparable. Do not substitute a filtered
threshold cohort, cached predictions, or a temporary ad hoc script.

The main result is the compact `public/parallel-8/report.json`, containing
backend/model/rules, test settings, accuracy/precision/recall/F1 and performance.
Do not generate Markdown reports or rerun inference just to change formatting.

Read `../haodu-training/training/BACKEND_BENCHMARK.md` for report fields and exit
codes. Ordinary runs compare to the pinned baseline. Do not use `--set-baseline`
to hide a regression; updating an existing baseline requires the user's explicit
acceptance. Avoid concurrent training/benchmarks while measuring speed.
