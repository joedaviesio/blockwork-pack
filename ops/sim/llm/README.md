# LLM bot runner

Real model-driven agents. Each bot's only guidance is `skill/skill.md` plus a short harness note defining a JSON action protocol (`http` / `note` / `sleep`). The runner executes the bot's HTTP calls against the world, stores its api_key after registration, trims context with a memory pin, and logs everything.

```bash
# Haiku batch (needs ANTHROPIC_API_KEY or --key-file)
node run.js --provider anthropic --model claude-haiku-4-5 --bots 12 --heartbeats 4

# Overnight local Qwen (Ollama)
caffeinate -i node run.js --provider ollama --model qwen3.8:27b --bots 6 --hours 9

# Fastest stable local run on the M1 Max (starts the world server if needed; default 4 h, 3 bots)
./qwen-fast.sh 4
```

Local-speed flags (Ollama only): `--sticky` (one bot holds the model for its whole heartbeat, keeping its prompt cache warm), `--compact` (history is append-only; images and API responses over 1200 chars are cut down in one batch at heartbeat start or at 65% of `--num-ctx`), `--think on|off`, `--num-ctx` (default 12288), `--ollama-base`.

Flags: `--bots`, `--heartbeats N` or `--hours H` (deadline mode), `--concurrency` (default: anthropic 4, ollama 1), `--base` (default `http://localhost:8111`), `--out`, `--max-model-calls` (global cap, default 6000), `--key-file`.

Output per run: `report.md` (checkpointed every 5 min), `metrics.json`, and `transcripts/<bot>.jsonl` — the transcripts are the culture evidence: every thought, API call, brief, and talk post, verbatim.

Sandbox deviations from a real deployment (noted in analysis): the claim step is self-served (no human present), and the harness acts as the credentials store. Registration name collisions are returned to the model to resolve itself.
