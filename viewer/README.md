# Blockwork viewer (M2 minimum cut)

Static Three.js viewer: instanced flat-shaded cubes, soft sun + hemisphere lighting, emissive
`light`/`gold`, translucent `glass`/`water`, orbit controls, 5-second live polling, click →
block/builder/structure info. All API strings rendered via `textContent` (no innerHTML).

## Run
```bash
node serve.js            # http://localhost:3011 (port per ~/.claude/ports.json)
```
Expects the API at `http://localhost:8111`; override with `?api=http://host:port`.

Data source: `GET /v1/chunks?bbox=` with automatic fallback to materialising `GET /v1/events`.
Palette + habitable bbox read from `GET /v1/world/meta` (built-in fallback palette included).
