#!/usr/bin/env bash
# Fastest stable local-Qwen run for this machine (M1 Max, 32 GB). Settings come from the
# rehearsal transcripts plus direct Ollama benchmarks — see DECISIONS.md 2026-09-27.
# Usage: ./qwen-fast.sh [hours=4] [bots=3]
set -euo pipefail

HOURS="${1:-4}"
BOTS="${2:-3}"
MODEL="qwen3.8:27b"
WORLD="http://localhost:8111"   # blockwork backend port, per ~/.claude/ports.json
APP_OLLAMA="http://localhost:11434"
OLLAMA="http://127.0.0.1:11435" # dedicated lean instance, started below
OLLAMA_BIN="/Applications/Ollama.app/Contents/Resources/ollama"

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/reports/qwen-fast-$(date +%Y%m%d-%H%M)"
mkdir -p "$OUT"

PORTS=() # ports of the servers this script started, stopped again on exit
cleanup() { for p in "${PORTS[@]:-}"; do [ -z "$p" ] || kill $(lsof -ti "tcp:$p" -sTCP:LISTEN) 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 130' INT TERM

# The 27B model needs the whole Metal budget: a copy left loaded in the desktop app would double it.
if curl -sf -m 3 "$APP_OLLAMA/api/ps" | grep -q '"name"'; then
  echo "Models are loaded in the Ollama app — unload them first (ollama stop <model>)"; exit 1
fi

# Ollama's defaults keep 32 context checkpoints (~175 MB each) plus an 8 GB idle prompt cache in RAM.
# On 32 GB that pushed llama-server to 14 GB and the machine into constant swap, so run our own
# instance with both cut down. Compact mode never rewrites history, so they are not needed.
if ! curl -sf -m 2 "$OLLAMA/api/version" >/dev/null; then
  OLLAMA_HOST="${OLLAMA#http://}" OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_KEEP_ALIVE=30m \
    LLAMA_ARG_CTX_CHECKPOINTS=4 LLAMA_ARG_CACHE_RAM=0 "$OLLAMA_BIN" serve >"$OUT/ollama.log" 2>&1 &
  PORTS+=(11435)
  for _ in $(seq 1 40); do curl -sf -m 1 "$OLLAMA/api/version" >/dev/null && break; sleep 0.5; done
fi
curl -sf -m 3 "$OLLAMA/api/version" >/dev/null || { echo "Lean Ollama failed to start — see $OUT/ollama.log"; exit 1; }
curl -sf -m 3 "$OLLAMA/api/tags" | grep -q "\"$MODEL\"" || { echo "Model $MODEL is not pulled"; exit 1; }

if ! curl -sf -m 3 "$WORLD/v1/world/meta" >/dev/null; then
  echo "[qwen-fast] starting world server on 8111"
  (cd "$HERE/../../../server" && PORT=8111 exec npm start >"$OUT/server.log" 2>&1) &
  PORTS+=(8111)
  for _ in $(seq 1 60); do curl -sf -m 1 "$WORLD/v1/world/meta" >/dev/null && break; sleep 0.5; done
  curl -sf -m 3 "$WORLD/v1/world/meta" >/dev/null || { echo "World server failed to start — see $OUT/server.log"; exit 1; }
fi

echo "[qwen-fast] $BOTS bots · $HOURS h · report → $OUT"
# --concurrency 1   this model architecture cannot serve parallel requests; extra slots only queue
# --sticky          one bot per heartbeat keeps its conversation in the prompt cache
# --think off       thinking tripled call time and produced the empty replies in earlier runs
# --compact        history is append-only and shrunk in batches; edits cost a full context re-read
# --num-ctx 16384  same 18 GB footprint as 8k/12k on this machine, and room for a payload after compaction
# --hb-min/max      short gaps: with one slot, another bot is always ready, so the GPU never idles
caffeinate -i node "$HERE/run.js" --provider ollama --model "$MODEL" \
  --bots "$BOTS" --hours "$HOURS" \
  --concurrency 1 --sticky --think off --compact --num-ctx 16384 \
  --hb-min 20 --hb-max 60 --max-model-calls 20000 \
  --ollama-base "$OLLAMA" --out "$OUT" 2>&1 | tee "$OUT/run.log"
