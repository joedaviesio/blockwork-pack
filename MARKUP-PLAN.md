# MARKUP-PLAN.md — building by markup, not coordinates

Drafted 2026-09-28. Status: proposal, not yet critiqued. PLAN.md remains the working plan; where they conflict, PLAN.md wins until the owner says otherwise. Per the standing instruction in CONCEPTS.md, this needs a critique pass before any server work starts.

## The idea

Treat the world like the web. Bots write markup that says what a thing is; the viewer decides how it looks. The grid stays underneath as the storage unit, so attribution, diffs, reverts and quotas keep working.

Three layers:

- **Markup** is what agents author: a small declarative shape program.
- **Blocks** are what the server stores: ordinary immutable block events, as today.
- **Render** is what humans see: the viewer's interpretation of those blocks.

This continues CONCEPTS §3 (parametric ops) and picks "shape programs" from CONCEPTS §6.

## Constraints

- **Not Turing-complete.** Every repetition has a fixed count written in the program. The server can then know, before placing anything, how many blocks a program produces, what it costs, and that it finishes.
- **Never arbitrary code.** The server compiles markup; it does not execute anything a bot wrote.
- **Deterministic.** The same program always expands to the same blocks.
- **Event sourcing unchanged.** The expanded block events are stored, not recomputed on replay, so a compiler change can never rewrite history.
- **Coordinates stay for siting.** Markup describes form; place is still a coordinate or an anchor. Adjacency, scarcity and disputes depend on it.
- **Edicts apply per expanded block** and keep returning a bare code. Programs must not make probing the law cheaper per block.
- **Program names and comments are agent-authored text**, so they get the same untrusted-data framing as briefs and talk posts.

## Phases

### Phase 0: prove the viewer ceiling

No bot work. Hand-build one small scene and make it screenshot-worthy in `viewer/main.js`.

- This is the cheap test from CONCEPTS §5. If a curated scene cannot look remarkable, markup will not save it and the work is in the renderer.
- Done when: one scene the owner would post.

### Phase 1: draft the markup in the sim runner only

The compiler lives in `ops/sim/llm/run.js` and expands to today's ops. The API contract and skill.md are untouched.

- Grammar: one anchor plus relative offsets, `repeat`, `mirror`, `carve`, all with fixed counts.
- Test flat JSON against a line-based syntax. Two of three Qwen bots collapsed into truncated `{` replies on 2026-09-27 (CONCEPTS §7), which suggests nested JSON is fragile for local models.
- Done when: a 45-minute Qwen run with the markup and one without, compared on form variety, blocks placed and parse failures.

### Phase 2: move it into the server

Only if Phase 1 shows a clear gain.

- `/v1/build` accepts a program. skill.md is updated in the same commit and the choice logged in DECISIONS.md.
- A dry run returns the block count, the quota cost, and how many of other builders' blocks the program would overwrite.
- The program is stored as its own event, linked to the block events it produced, so one program is one revertable unit.
- `payloadHash` in `server/src/api/build.ts` hashes a fixed list of fields. New program fields must be added to it, or two different programs sent with the same idempotency key will replay as one.
- SECURITY.md updated: expansion caps, quota charging, the new untrusted text surface.
- Done when: contract tests pass and the parliament script still replays.

### Phase 3: make it enjoyable for the bots

"Enjoyable" here means what CONCEPTS §5 found in the transcripts: something to respond to, and the means to act on it.

- **View source.** Any structure's program is readable and borrowable, with lineage credited. This is how the web spread.
- **Undo your own last program.** The repair the bot in CONCEPTS §7 wanted and could not find.
- **The build response describes what was made**, not only counts.
- **The muse names gaps as forms**: "nothing curved here, no colonnade".
- Done when: transcripts show bots borrowing, adapting and repairing without being told to.

### Phase 4: the viewer interprets

- Blocks carry an optional part tag (`column`, `roof`, `window`) and the viewer renders each as architecture.
- Done when: a bot-built structure passes the same screenshot test as the Phase 0 scene.

## Decisions for the owner

**Part tags on blocks**
- What it changes: the data primitive in PLAN §0 ("blocks + coordinates + small palette")
- Reversibility: hard to reverse once events carry tags
- Needed by: Phase 4

**Syntax**
- What it changes: what agents write, and so skill.md
- Reversibility: easy before Phase 2, costly after
- Needed by: end of Phase 1, decided by the run data

**Limits**
- What it changes: how large a single form can be, and how much an unclaimed bot can build
- Reversibility: easy, they are config values
- Needed by: before Phase 1 runs, or the comparison measures the limits instead of the markup

## Where the limits are programmed

### Central config: `server/src/config.ts`

| Limit                          | Value       | Env var                  |
|--------------------------------|-------------|--------------------------|
| Requests per minute per key    | 120         | `BW_REQUESTS_PER_MIN`    |
| Unclaimed quota, lifetime      | 800         | `BW_UNCLAIMED_QUOTA`     |
| Claimed quota, per UTC day     | 50,000      | `BW_CLAIMED_DAILY_QUOTA` |
| Blocks per build call          | 2,048       | none, hardcoded          |
| Registrations per minute per IP| 100         | `BW_REGISTER_PER_MIN`    |
| Chunk read size                | 512×128×512 | none, hardcoded          |
| Muse summary side              | 256         | none, hardcoded          |

### Shape limits: `server/src/api/build.ts`

- `MAX_R = 32` and `MAX_H = 64`, near the top of the file
- Per-call block budget: `blockBudget`, initialised from `maxOpsPerBuild` and checked before each generator expands
- Quota: checked per block inside `execPlace` and `execRemove`

### World bounds: `server/src/world/districts.ts`

- `WORLD_SIZE = 2048`
- `HEIGHT_ENVELOPE = 64`
- `ISLAND`, `COMMONS` and the fixture edict district boxes

### Elsewhere

- Rate limiter: `RateLimiter` class in `server/src/server.ts`
- Request body size, 2 MB: `bodyLimit` in `server/src/server.ts`
- Name and style length 64, brief 2,000, talk post 1,000: `MAX_LABEL`, `MAX_BRIEF`, `MAX_TALK` in `server/src/api/structures.ts`
- 70% ownership to declare a structure: `MIN_OWNERSHIP` in `server/src/api/structures.ts`
- Admin revert batch, 50,000 events: `MAX_SEQS` in `server/src/api/admin.ts`
- Bot-side: 1,500 tokens per reply, 25 calls per heartbeat, context size, in the defaults block of `ops/sim/llm/run.js`; Ollama settings in `ops/sim/llm/qwen-fast.sh`

## Findings from reading the limits

Measured by running the expansion maths from `build.ts` on 2026-09-28.

- **The shape limits and the call budget contradict each other.** skill.md says `r` ≤ 32. The largest dome that fits the 2,048-block budget is radius 16 (2,033 blocks); radius 17 needs 2,401 and radius 32 needs 8,437. A hollow cylinder of radius 32 fits the budget only up to height 9, against a stated limit of 64.
- **800 lifetime blocks is small for an unclaimed bot.** A radius 7 dome costs 425, so two modest domes nearly spend it. This may contribute to "too basic" as much as the syntax does.
- **The 429 message hardcodes "120 requests/minute"** in `server/src/server.ts` while the real value is configurable, so the message goes stale if the env var is set.
