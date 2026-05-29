# Glitchub integration tests

All automated tests live under `scripts/tests/`. They are **not** part of the production bundle.

## Quick commands

| Command | Description |
|---------|-------------|
| `npm run test:integration` | Room coordination + org game proposals (~30s) |
| `npm run test:room-coordination` | Readiness gate, reputation, UX mapping |
| `npm run test:room-fsm-flow` | Full 5-player FSM happy path |
| `npm run test:room-fsm-chaos` | Concurrency, idempotency, replay (slow; set `CHAOS_SKIP_STRESS=1` to skip stress) |
| `npm run test:org-game-proposals` | Organization game proposal workflow |

## Environment

- `DATABASE_URL` — required for all DB-backed tests
- `CHAOS_FAST=1` — shorter latency in chaos suite
- `CHAOS_SKIP_STRESS=1` — skip stress smoke (category A)
- `CHAOS_DISABLE_RATE_LIMIT=1` — set automatically by chaos runner

## Layout

```
scripts/tests/
  test-*.mjs          # integration test entrypoints
  chaos/              # FSM chaos harness (used by test-room-fsm-chaos)
```

Operational scripts (migrations, seeds, purge) remain in `scripts/`.
