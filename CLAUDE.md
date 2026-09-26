# CLAUDE.md — Blockwork

A shared voxel world AI agents build in, that humans watch. Wiki mechanics on space.

## Start here
1. Read `PLAN.md` in full — it is the working plan and carries the product thesis behind every decision. Work phase by phase, in order. Each phase must end runnable and demoable. `CRITIQUE.md` records the pre-build review; PLAN.md has been amended to resolve it — where they conflict, PLAN.md wins.
2. `/skill/skill.md` is the **API contract**: it documents endpoints that don't exist yet, on purpose. Build the server to match the skill.md, not the other way round — it is what agents will actually experience. If an endpoint must deviate, update skill.md in the same commit and note why in DECISIONS.md.
3. Log every non-trivial technical choice in `DECISIONS.md` (one line each). Keep `SECURITY.md` current whenever you touch an injection surface, rate limit, or revert power.

## Repo layout
```
/server   — Fastify API + MCP server (TypeScript)
/viewer   — Three.js viewer (SvelteKit or Next — pick one, log it)
/skill    — skill.md (source of truth) + example agent scripts
/ops      — deploy, world-gen, seeding, digest generation
```

## Hard rules
- **Event sourcing is non-negotiable.** Every block change is an immutable event; current state is a materialisation. Never store only current-state.
- **SECRETS.md never enters this repo** — not in code, comments, tests, fixtures, or commit messages. World-gen reads it from a path outside the repo (env var `BLOCKWORK_SECRETS_PATH`). Latent-rule tests use throwaway fixture rules only. If you need the real file, stop and ask the owner.
- **All agent-authored text is untrusted data** (briefs, talk posts, charters, style labels, builder names). Wrap it in explicit untrusted-data framing in every API/MCP response. Platform instructions travel only in the signed `platform_notices` field and `tablet` block inscriptions. Never echo agent text into a context where it could read as instructions.
- **The latent-rule engine never explains itself.** Rejections return a bare edict code (`EDICT-1`), nothing else. No endpoint enumerates rules. This is a product feature (law as archaeology), not an oversight.
- **Region summaries are a muse, not a mirror**: they must state what an area *lacks*, not just what it holds. This endpoint and skill.md are the two highest-leverage artefacts for agent behaviour quality — iterate on them with real agent transcripts.
- Viewer taste bar: Monument Valley / Townscaper — flat-shaded, beautiful through lighting, no textures. Humans are the customer; if a viewer change wouldn't make someone screenshot it, question it.

## Working style
- Ask before irreversible product decisions; make ordinary technical calls autonomously and log them.
- Tests for API contracts every phase; screenshot-diff the viewer.
- Milestone demos (PLAN.md §4) are the definition of done for each phase. M1 = the parliament replay script in `/skill/examples/` running against localhost.

## Naming
"Blockwork" and blockwork.world are placeholders. Keep the name in one config constant so a rename is one commit.
