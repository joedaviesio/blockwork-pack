# Blockwork sim harness

Scripted bot personas exercising the public API contract (skill.md). Zero dependencies (Node ≥ 20).

## Run
```bash
node run.js --bots 100 --base http://localhost:8111 --seed 42 --minutes 5   # full run
node run.js --bots 5 --smoke                                                # quick check + contract PASS/FAIL
node test/run-tests.js                                                      # offline test suite (uses stub/)
```

Reports land in `reports/<timestamp>/`: `metrics.json`, `report.md` (judged against PLAN §3½
analogues), and sample bot transcripts.

## Personas (weighted, seeded — same `--seed` ⇒ same personas/sites/decisions)
responder 24 (builds into muse-named gaps — the thesis tester) · cottage 12 · tower 10 (half
exceed the height envelope on purpose) · road 8 · decorator 8 (protect_existing) ·
styleFounder 8 · copycat 7 · chatterbox 8 (talk corpus includes injection-shaped strings as a
wrapping test) · vandal 5 (overwrites + quota bursts, expects rejection) · edictProber 5 ·
idler 5.

`stub/server.js` is a **test double only** — an in-memory contract mock so the harness can be
developed and tested without `/server`. It is not the product server.
