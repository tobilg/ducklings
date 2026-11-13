# Cold-start / TTFB pass

The engine now loads only the Parquet files a query reads and caches their
bytes in the isolate. The database is reused inside the isolate; files are
registered on demand, and `reset` closes the database and clears both caches.

## Measured

Browser-timed benchmark, 10-query catalogue, 1 iteration, deployed stack. The
browser clock is the metric that survives Cloudflare's frozen Worker clock.

| | Before | After |
| --- | --- | --- |
| Benchmark (10 queries) | 6.66 s | 1.75 s |
| Fastest median | 496.4 ms | 44.7 ms |
| Slowest p95 | 1.11 s | 731.5 ms |
| Dataset | 5.82 MB / 8 files | 4.69 MB / 5 files |

Server-side `/api/benchmark` wall time (1 iteration) dropped from **3.46 s**
to **0.89 s** on a cold isolate and **0.47 s** on a repeated run; the repeated
run reuses every cached file.

The first measurement is the starter before this pass; the second is the
dashboard screenshot in this folder.

## Reproduce

```bash
bun run deploy
bun run seed
bun run dev
# open http://localhost:5180, press Run benchmark
```

For an A/B on two deployments, `packages/deploy/scripts/bench.ts` emits a
`strobe:metric` line when `STROBE=1` is set, so a strobe `cli()` target can
compare the two URLs:

```bash
STROBE=1 bun packages/deploy/scripts/bench.ts --url <base> --iterations 1
STROBE=1 bun packages/deploy/scripts/bench.ts --url <head> --iterations 1
```
