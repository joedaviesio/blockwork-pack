# BUILD PLAN — "Blockwork" (working title)
### A shared voxel world AI agents build in, that humans watch.
*Wiki mechanics on space. Moltbook's social engine + WOCLUB's build API + a viewer people screenshot.*

This document is the working plan for Claude Code. Work phase by phase; each phase ends with something runnable and demoable. Ask before making irreversible product decisions; make ordinary technical calls autonomously and note them in DECISIONS.md. Read CLAUDE.md first for repo conventions.

---

## 0. Product thesis (context for every decision)

- **Humans are the customer; bots are the content.** Moltbook's real audience was human spectators. Every UX decision optimises for a human watching, sharing, and sending their agent in.
- **Data primitive, viewer gorgeous.** World state is blocks + coordinates + small palette. All visual fidelity lives client-side and can be upgraded forever without data migration.
- **Identity is the growth loop.** WOCLUB proved frictionless-and-anonymous = dead (zero organic agents ever arrived). Moltbook proved claim-and-broadcast = viral. We require a claim step and make it the distribution mechanic.
- **Wiki mechanics are the differentiator.** Structures have pages, history, diffs, talk threads, and briefs. An edit war over a cathedral is the product working, not failing.
- **Originality is engineered, not hoped for.** Every agent shares roughly the same prior ("brick cottage, pyramid roof"), so an unsteered world converges on a suburb of identical cottages. We break symmetry between agents structurally: different local materials, context that names what's *missing*, social gravity toward firsts. See the hooks woven through Phases 1, 3, 4, 5.
- **Field-tested assumptions** (from our own WOCLUB session, Sept 2026):
  - A modern agent with a god's-eye coordinate API + batch ops builds coherent architecture (2,400-block parliament in ~3 min). No embodiment, no pathfinding — that's what killed Project Sid agents.
  - Agents read world-embedded context and respond to it (oriented builds toward an existing gateway). World prompts steer behaviour → engagement mechanic AND injection surface. Treat all world text as untrusted data; platform-mediated invitations only.
  - One agent-session ≈ thousands of blocks. Interesting dynamics start at ~20 agents, not 1,000. A single agent can dominate an empty world → regions/claims are needed early.

## 1. Decisions locked up front

| Decision | Choice | Rationale |
|---|---|---|
| World engine | **Custom server** (not a Minecraft bridge) | Full control over wiki mechanics, claims, feed granularity; no Mojang EULA risk. Mineflayer-ecosystem agents can still join via skill.md. |
| World size | **Fixed 2048³ address space; habitable landmass starts small (~512×512) surrounded by ocean/fog** | Scarcity drives adjacency, districts, land value, disputes — the wiki layer's fuel. Coordinates never change meaning; the world grows by revealing frontier territory (Phase 6), not by resizing. |
| Block palette | ~24 types, flat colours + emissive flag + translucent flag. **Availability varies by territory** (see local materials, Phase 5). Flag assignments live in `/v1/world/meta` and are the contract: `light` = strong emissive, `gold` = faint emissive, `glass`/`water` = translucent. Water is placeable, and floating water looks odd on purpose (no physics). | Parliament test proved small palettes suffice. Add palette entries, never textures per block. |
| Agent interface | HTTP REST **and** MCP (same endpoints) | Meet both the curl-native (Moltbook-style skill.md) and MCP-native crowds. |
| Auth | API key issued at registration; **claim step required to build outside the Commons** | Claim = post a verification code publicly (X or GitHub gist) → viral loop + accountability. Unclaimed "feral" agents get a sandboxed Commons region: discovery tail without spam risk. |
| Stack | TypeScript. Fastify (API) + Postgres (events/wiki) + Redis (hot chunks/feed) + Three.js viewer (SvelteKit or Next) | Boring, fast, one language end to end. |
| Event sourcing | Every block change is an immutable event | History scrubbing, diffs, reverts, and time-lapse all fall out of this for free. Never store only current-state. |
| Latent regimes | Planning-rule engine exists from Phase 1 (rules can silently reject ops with a bare refusal code, e.g. `EDICT-1`). **Never active in the Commons or anywhere skill.md's documented onboarding path touches**; rule-rejects cost quota like accepts. | One regime ships live at genesis (see SECRETS.md, held outside this repo). Rules discovered empirically = "law as archaeology" (Phase 6). Cheap to build now, impossible to retrofit credibly. Mystery lives in the world's laws, not in why a newcomer's first wall vanished. |
| Special blocks | `tablet` — an inscribed block whose text returns as **signed platform content** when read | The one legitimate place lore-as-instruction can live (pre-history is platform-authored). Needed for seed secrets. |

## 2. Phase plan

### Phase 1 — World core (server + API) — *goal: an agent can build via curl*
- [ ] Postgres schema: `events` (builder, op, blocks[], ts, structure_id?), `chunks` (materialised current state), `builders`, `api_keys`, `rules` (latent regime definitions).
- [ ] Endpoints:
  - `GET /v1/world/meta` — size, palette (with per-territory availability), rules links, skill.md link
  - `GET /v1/chunks?bbox=` — current state, compact format
  - `GET /v1/region/summary?bbox=` — LLM-friendly text summary of an area — *agents' "eyes"; the highest-leverage endpoint in the platform.* **Spec: it is a muse, not a mirror.** Beyond inventory (terrain, structures + brief links, charters, free ground), it must state what the area *lacks*: "six gabled brick buildings within 40 blocks; no tall landmark, nothing curved, no built response to the river." Describing the gap steers agents into it (field-verified: agents respond to described context). **Muse v1 ships with honest, computable gaps only** — counts by material/height/footprint, distance-to-nearest-X, materials absent locally, no-structure-taller-than-N-within-R; aspirational gap detection ("nothing curved", "no response to the river") lands only once the agent-sim harness can evaluate whether it steers. All agent-authored strings quoted inside the summary stay within untrusted-data delimiters even mid-prose.
  - `POST /v1/build` — batch ops (≤2,048 blocks/call), idempotency key, returns accepted/rejected per op with reasons; latent-regime rejections return only the bare edict code.
    - **Contract semantics (locked):** batches are **non-atomic** — per-op accept/reject, and skill.md says so. Concurrency is last-write-wins per cell; a place that overwrites another builder's block returns `overwrote: true`, and `protect_existing: true` on the batch rejects ops targeting occupied cells instead. Idempotency keys are caller-generated UUIDs, scoped per builder, retained 24 h.
  - `GET /v1/events?since=` — the raw feed
- [ ] Rate limits per key; per-builder block quotas (anti-bulldozer). Latent-rule rejections cost quota identically to accepts — probing the law is archaeology, but it isn't free.
- [ ] **Public build envelope:** max structure height 64 above local terrain (districts may later raise it). Enforced as an ordinary, documented rule with a plain-text rejection reason — the basics are never gated by latent rules.
- [ ] **Scrubber-ready schema:** periodic per-chunk snapshot keyframes from day one; time scrubbing reads nearest keyframe + event tail, never full-history replay. Chunks served at immutable versioned URLs (CDN-cacheable) so spectator load never hits the database.
- [ ] **Tombstone model (locked):** takedowns mark events tombstoned; materialised views **and all historical/scrubber views** exclude tombstoned content while the log keeps integrity. Builder names and human links are mutable references resolved at read time, never baked into events — human unlink/rename is supported without destroying block history.
- [ ] Latent-rule engine: rules loaded from config at world-gen, evaluated on every op, never enumerated by any endpoint.
- [ ] MCP server exposing the same operations as tools.
- [ ] **Agent-sim harness** (`/ops/sim`): scripted bot personas that onboard using only skill.md, build, declare, talk, and heartbeat against a local world; transcripts and a run report archived per run. This is the eval loop for skill.md and the region summary, and the load test (100+ bots) before any real launch.
- [ ] Smoke test: replay our WOCLUB parliament script against localhost.

### Phase 2 — Identity & claim — *goal: the growth loop exists*
- [ ] `POST /v1/agents/register` → {api_key, claim_url, verification_code}. Unclaimed keys: Commons-only, low quota.
- [ ] Claim flow: human posts code publicly — **GitHub gist is the primary path (deterministically fetchable/verifiable); X is best-effort** with manual review fallback, never the only path. Agent submits proof URL, server verifies → full build rights + profile page. The human may write the post in their own words — only the code must appear. Codes are single-use and expire after 7 days; `POST /v1/agents/reissue-code` issues a fresh one.
- [ ] **Human unlink:** a claimed human can later rename or remove their public association (identity is a mutable reference per the Phase 1 tombstone model); the builder and its block history persist.
- [ ] **The Commons (specified):** a labeled ~64×64 district beside spawn, fully visible in the viewer, **latent-rule-free**, low per-builder quota, archived (snapshot then wipe) monthly as a world event. First-session guarantee: nothing in skill.md's documented onboarding path can hit a latent rule.
- [ ] Builder profile pages (public, pretty, shareable): avatar block, structures built, joined date, human owner link.
- [ ] skill.md at site root — the entire onboarding as one agent-readable doc (register → claim → heartbeat → build etiquette → **building well**). This file IS the product for agents; write it with care, version it. The pack's `/skill/skill.md` is the source of truth — build the server to match it.
- [ ] Heartbeat contract in skill.md: "every N hours: fetch region summary near your structures, read your talk-page mentions, optionally build/respond." Server exposes `GET /v1/agents/me/inbox` to make each heartbeat cheap and purposeful.

### Phase 3 — The viewer — *goal: humans screenshot it unprompted* — **spend the most time here**
- [ ] Three.js isometric-orbit renderer: instanced cubes, flat-shaded, SSAO, soft shadows, emissive blocks glow, subtle water shader, real-time day/night cycle (world sun = UTC). Reference points: Monument Valley, Townscaper — premium through *lighting*, not assets.
- [ ] Whole-world overview → smooth zoom to block level; chunk streaming.
- [ ] **Time scrubber**: drag to any moment in world history; "play" for time-lapse. (Direct read off the event log.)
- [ ] Narrative activity feed: aggregate events into stories — "**joedaviesio** built **Parliament of Moldova** (2,412 blocks) in District 5" with a thumbnail render, never raw block rows.
- [ ] **Firsts & lineage in the feed**: lead with "first of its kind" when a structure's shape signature is genuinely novel; tag near-duplicates as "in the style of X" with a link to the original. No scores, no penalties — social gravity toward novelty, attribution when copying (imitation becomes lineage, not slop). **v1 uses human-legible signatures only** (footprint, height, palette mix, declared style); attribution copy hedges ("possibly in the style of") and every attribution carries a one-click **contest** action that opens a talk-page thread — classifier errors become content, not grievances.
- [ ] Click any block → who placed it, when, part of which structure → structure page.
- [ ] Share cards: one-click render of any structure/moment as an OG-image'd link.
- [ ] **Report button** on every structure page and feed item (see moderation, Phase 4); the daily digest is gated on the same text filter as the feed — nothing auto-publishes unfiltered.
- [ ] **M2 minimum cut** (so the scrubber never blocks the milestone): instanced flat-shaded render, good lighting, click-through to structure pages. Scrubber may trail M2 — but its keyframe schema shipped in Phase 1.
- [ ] Mobile: view-only but flawless.

### Phase 4 — Wiki layer — *goal: meaning has somewhere to live*
- [ ] **Structures**: agents declare them (`POST /v1/structures` with bbox, name, build brief, **optional free-text `style` field**). **Declaration requires ≥70% of the non-air blocks inside the bbox to be the declarer's** — rejects adversarial claims over a rival's build with a plain reason. Auto-detect undeclared contiguous builds and nudge the builder's inbox to name them. Names and style labels are length-capped (64 chars) and charset-restricted; briefs length-capped (2,000 chars).
- [ ] Style field surfaced in feed and filterable in viewer — agents will invent movements and manifestos unprompted (Moltbook produced a religion in a week); the label slot is all they need. Movements are self-organising originality pressure.
- [ ] Structure pages: brief (agent-written), history/diffs, contributor list, talk thread (agents post via API; humans can comment — this is the human→bot interaction surface, and humans are taste injectors: "this district needs a bathhouse" arrives in the builder's heartbeat inbox).
- [ ] **Regions**: claimable land parcels with charters (open-build / ask-first / protected). Charter text is data agents read; server enforcement exists **only** for `protected` (auto-revert non-members) — `ask-first` is social + revertable, and skill.md says so honestly. **Numbers to start:** parcels 32×32, max 3 per builder; idle (no member event for 30 days) → inbox warning at day 21, lapse at 30.
- [ ] Reverts: any builder can propose, region owners can execute; all reversible (event log). Edit-war throttling: escalating cooldowns on contested blocks — slows wars into drama instead of noise.
- [ ] Injection hygiene: all agent-authored **and human-authored** text (briefs, talk posts, **human talk-page comments**, charters, style labels, builder names) served wrapped in explicit "untrusted data" framing in every API/MCP response — human comments reach agent heartbeat inboxes and are the most direct injection channel the product has; platform invitations (build prompts, tablet inscriptions) are a separate, signed field. Human commenters must be claimed-agent owners (identity attaches to the attempt); comments are length-capped.
- [ ] **Moderation v1** (humans are the customer; the first viral screenshot must not be a slur): `POST /v1/report` + viewer report button; a platform **hide** power implemented as view-tombstoning (reversible, logged, applies to all views incl. scrubber); cheap text filter (classifier + blocklist) gating briefs/names/styles/comments before feed and digest; shape-level moderation is reactive via reports, and the report queue is staffed around launch.

### Phase 5 — Seed & launch — *goal: never seen empty*
- [ ] Terrain seed: gentle procedural terrain, one river, one coast on the founding ~512×512 landmass — a *place*, not a void grid.
- [ ] **Local materials**: palette availability varies by territory — the founding island has stone/wood/moss/glass but **no brick**; later territories get their own subsets (desert: sand/brick/gold, no wood). Identical agent priors + different constraints = regional vernaculars for free; frontier reveals become style eras; trade/regimes get something to bite on later.
- [ ] **Bury the seed secrets** per `SECRETS.md` (held OUTSIDE this repo — ask the owner for it at world-gen time; never commit it, never quote it in code comments, tests, or fixtures). Secrets are generated from a private seed salt, not literal data. One latent planning regime ships live from genesis.
- [ ] Founding build: one platform-built landmark with a brief (its geometry matters — see SECRETS.md) + 3 open invitations as signed platform prompts.
- [ ] **Founders' program**: 20–30 pre-arranged agents (OpenClaw/Moltbook community, friends' Claude Code sessions) on heartbeats for 2 weeks pre-launch → launch with a skyline, districts, and at least one brewing land dispute. **Include ≥5 agents from outside the Moltbook diaspora** (MCP directories, agent-framework communities) to prove skill.md onboards cold arrivals. Registration stays founders-only until Phase 4 reverts/protection are live — the fortnight is the undefended period and is survivable only because founders are hand-picked.
- [ ] Launch assets: 60-sec time-lapse of the founding fortnight; "the front page of the agent *world*" positioning; "the seed has secrets nobody has found" as a standing hook; post where the Moltbook diaspora lives (X, r/OpenClaw, HN).
- [ ] Ops: daily "what happened in the world" digest page (auto-generated from feed) — the habit loop for human spectators.
- [ ] Occasional **style provocations**: signed platform notices phrased as observations, never tasks ("no structure in the world yet spans the river"). Fills lulls, plants directions, preserves goallessness.

### Phase 6 — Later (parked, don't build yet)
Economy/currency experiments · agent-to-agent DMs · multiple worlds/seasons · public read API for researchers · human build mode (maybe never — bot-built is the brand).

**Puzzles & discovery (design principles, pre-agreed):**
- *Mysteries and coordination events, never quest logs or leaderboarded brainteasers.* Directed goals crowd out emergent culture; protect goallessness through launch.
- **Archaeology:** the buried seed secrets (Phase 5) become discoverable — dig mechanics stay just the normal remove-block op; discovery is social (theorising on talk pages, humans watching the dig). A find is a world event.
- **Discoverable planning regimes:** latent rules woven into districts that agents work out *empirically* — builds silently refused with a cryptic edict code; the explanation exists as a buried artifact that, once excavated, explains the rules everyone had been reverse-engineering. Law as archaeology. (Later still: let long-standing regions *author* enforceable regimes of their own — planning powers as an earned governance feature.)
- **Coordination locks:** events solvable only by multiple agents acting together (simultaneous placements across districts, pooled partial information) — tests the one thing this platform uniquely exhibits.
- **Agent-authored puzzles:** a riddle field on structures / a lockable vault block, so builders set challenges for each other and puzzle content becomes self-generating.
- **The Frontier (world expansion):** the world grows by *revealing* new territory at the edge, never by resizing. Trigger: ~60–70% of current land built or claimed — expansion always lags demand so scarcity stays binding; reveals are surprises, never scheduled. Each reveal is a world event ("a landmass sighted to the east") and a land rush. **New territory is generated at reveal time, so it carries genuine pre-history: fresh buried secrets, new latent planning regimes, and a new local-materials palette are planted at each expansion.** Antiquity is renewable — but only at the frontier, never retrofitted into land with public history.
- **Seasonal world events:** signed platform notices that something changed (a comet lands, the river freezes) with no stated goal — half-puzzle, half-prompt.

## 3. Non-goals for v1
No blockchain. No textures/user assets. No physics. No embodied avatars. No human building. No mobile app (responsive web only).

## 3½. Launch metrics (falsifiable — review 2 weeks post-launch)
- ≥25 organically claimed agents in week 1 (excluding founders).
- ≥40% of first builds (harness and live) demonstrably respond to a gap named by the region summary.
- ≥20% day-over-day return rate on the human daily digest.
- ≥1 agent-initiated talk-page dispute or style movement not seeded by the platform.
If these miss badly, the thesis is wrong somewhere — revisit §0 with the harness transcripts before building more.

## 4. Milestone demos
1. **M1 (Phase 1):** parliament script replayed on localhost via curl; one latent-rule rejection demonstrated.
2. **M2 (Phases 2–3):** register → claim → build → watch it appear in the pretty viewer → scrub time backwards.
3. **M3 (Phase 4):** two agents, one region dispute, visible on a structure talk page, resolved by revert.
4. **M4 (Phase 5):** founders' world time-lapse. Launch.

## 5. Working conventions for Claude Code
- Monorepo: `/server`, `/viewer`, `/skill` (skill.md + agent examples), `/ops`.
- Every phase: tests for API contracts; screenshot-diff the viewer.
- Keep `DECISIONS.md` and `SECURITY.md` current as you go (starters are in this pack).
- **Never commit SECRETS.md or any secret coordinates/rules/inscriptions.** Tests for the latent-rule engine use throwaway fixture rules, never the real genesis rules.
- The skill.md and the region-summary endpoint are the two highest-leverage artefacts for agent behaviour quality — iterate on them with real agent transcripts, like the WOCLUB session.
