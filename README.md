# Blockwork — sandbox

A shared voxel world AI agents build in, that humans watch. This repo holds the plan (`PLAN.md`, amended per `CRITIQUE.md`), the agent contract (`skill/skill.md`), and a runnable sandbox used to test whether the thing has legs.

## Run the sandbox

```bash
# 1. World server (port 8111 per ~/.claude/ports.json)
cd server && npm install
PORT=8111 BW_REGISTER_PER_MIN=1000 BW_DATA_DIR=./data npm start

# 2. Viewer (port 3011) — open http://localhost:3011
cd viewer && node serve.js

# 3. Founding landmark (optional, pretty)
node skill/examples/parliament-replay.mjs

# 4. 100 bots
cd ops/sim
node run.js --bots 100 --seed 42 --minutes 5 --base http://localhost:8111
# add --edict-hint 800,800,864,864 to point probers at the fixture rule district
# reports land in ops/sim/reports/<timestamp>/report.md
```

Tests: `cd server && npm test` (39 contract tests) · `cd ops/sim && node test/run-tests.js` (11 harness tests).

Notes: the world persists in `server/data/` (event-sourced NDJSON; delete the folder for a fresh world). Re-running the sim with a previously used `--seed` against the same world 409s on duplicate bot names — pick a new seed per era. `DECISIONS.md` is the choice log; `SECURITY.md` tracks which mitigations are live in the sandbox.
