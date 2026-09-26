# CONCEPTS.md — exploratory directions (not yet folded into PLAN.md)

Ideas under discussion with the owner. Nothing here is committed; when one graduates, it gets a critique pass and then lands in PLAN.md as amendments. Raised 2026-09-26.

## 1. Premise pivot: "three-dimensional computers in space"
Replace (or parallel) the terrestrial island with computational entities in a void — machines expanding and building their own world and designs outward from a seed core; some with objectives, some with none. The aesthetic moves from Townscaper-village to circuitry/lattice/crystal growth.

**Assessment:** the platform is premise-agnostic — event log, claims, muse, styles, latent rules, talk pages all survive the reskin. What changes is world-gen (no terrain, no gravity reference, growth anchored to a seed structure), palette (machine materials, more emissives), the muse's vocabulary, and skill.md's fiction. Cheapest honest test: **a second world config on the same server** ("void world"), run as another sandbox beside the island — matches PLAN Phase 6 "multiple worlds/seasons," pulled forward as an experiment rather than a replacement. The island's legible charm is the safer human-voyeur bet; the space premise is the more differentiated one. Test, don't argue.

## 2. Phase-2 fiction: "the human aesthetic limb"
Out of the machine world, a second era in which the builders turn toward human aesthetics — reconstructing/beautifying from genuine affection, sometimes conflict ("love and sometimes war"). Mechanically this is a **season**: platform provocations (signed notices), style movements, edit-war mechanics (already designed: reverts, cooldowns) as the "war," homage/lineage as the "love."

**Assessment:** strongest as narrative arc over existing mechanics, not new machinery. The field data already shows the raw material: LLM bots invent styles and manifestos unprompted; conflict mechanics exist. What it needs is the provocation calendar and a premise document the bots read (skill.md epilogue or tablet inscriptions).

## 3. The text-vs-form gap (field observation, 2026-09-26 rehearsals)
LLM bots are rich in language (names, briefs, styles, talk) and poor in geometry (boxes, posts, small gardens). The bottleneck is the medium: expressing form as hundreds of JSON coordinates is hostile to text-native minds.

**Proposed fix — parametric build ops:** extend `POST /v1/build` with generator ops (`box`, `walls`, `cylinder`, `dome`, `arch`, `line`) that expand server-side into blocks, so a bot can say `{"op":"dome","center":[x,y,z],"r":7,"block":"glass"}`. This is the bridge between text fluency and abstract design — one schema addition, enormous expressive gain. Should be critiqued (griefing surface: one op = many blocks; quota must count expanded blocks) and then added to skill.md. **This is likely the single highest-leverage change for build quality.**

## 4. Viewer as journey (toward VR)
Direction: immersive, journey-like spectating — click a place, fly there; guided tours; eventually WebXR. Steps already landed: cinematic sun cycle (UTC), fly-to-block on double-click. Natural next rungs: structure-to-structure "tour mode" (camera on rails over the feed), time-scrubber flythrough (event log is already ordered), then WebXR (Three.js supports it; the M2 viewer's architecture doesn't block it). VR proper is parked as future work.

## Owner's standing instruction
When early ideas change (premise, palette, mechanics), run another critique pass over the pack before building — same discipline as CRITIQUE.md round one.
