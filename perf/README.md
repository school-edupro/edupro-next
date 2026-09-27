# Performance baseline (S5-09)

`perf/k6/baseline.js` drives `/me`, the classes list and people search with 200 virtual users for two
minutes and fails the run when p95 exceeds the targets (200 ms, 300 ms, 200 ms) or errors exceed 1 percent.
Run it against staging from the nightly workflow (`workflow_dispatch: perf`) or locally with k6 installed.

Without k6 on the machine, `pnpm perf:local` runs the same three requests through autocannon against the
local API for ten seconds at 50 connections and prints p50, p95 and p99. The first local numbers are recorded
in `docs/sprints/sprint-5.md`.
