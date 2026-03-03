#!/bin/bash
set -e

echo "============ JARVIS OLLAMA SHARD STARTUP ============"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ============ Persist Models on Volume ============
# Fly.io only allows 1 mount — store Ollama models inside the data volume
export OLLAMA_MODELS=/app/data/ollama
mkdir -p "$OLLAMA_MODELS"

# ============ Start Ollama Server ============
echo "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
for i in $(seq 1 30); do
  if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is ready."
    break
  fi
  if [ $i -eq 30 ]; then
    echo "ERROR: Ollama failed to start after 30 seconds."
    exit 1
  fi
  sleep 1
done

# ============ Pull Model ============
MODEL="${LLM_MODEL:-qwen2.5:0.5b}"
echo "Pulling model: ${MODEL}..."

# Check if model is already pulled (persistent volume)
if ollama list 2>/dev/null | grep -q "$MODEL"; then
  echo "Model ${MODEL} already available."
else
  echo "Downloading ${MODEL} (first boot only, cached on volume after)..."
  ollama pull "$MODEL"
  echo "Model ${MODEL} pulled successfully."
fi

# ============ Set Ollama Environment ============
export LLM_PROVIDER=ollama
export LLM_MODEL="$MODEL"
export OLLAMA_URL=http://localhost:11434

echo ""
echo "Ollama Configuration:"
echo "  Model:  ${MODEL}"
echo "  URL:    ${OLLAMA_URL}"
echo "  PID:    ${OLLAMA_PID}"

# ============ Run Standard JARVIS Entrypoint ============
echo ""
echo "Starting JARVIS shard with Ollama backend..."
exec ./entrypoint.sh
