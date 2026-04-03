#!/usr/bin/env bash
# LLM A/B Comparison: Qwen 3.6 Plus (free) vs Claude Opus 4.6
# Sends the same prompt to both models via OpenRouter, saves responses side by side.
#
# Usage:
#   export OPENROUTER_API_KEY="sk-or-..."
#   ./scripts/llm-compare.sh "your prompt here"
#   ./scripts/llm-compare.sh --file prompt.txt
#
# Output: results saved to llm-compare-results/YYYY-MM-DD-HHMMSS/

set -euo pipefail

# --- Config ---
QWEN_MODEL="qwen/qwen3.6-plus:free"
CLAUDE_MODEL="anthropic/claude-opus-4-6"
API_URL="https://openrouter.ai/api/v1/chat/completions"

# --- Validate ---
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    echo "ERROR: Set OPENROUTER_API_KEY first"
    echo "  export OPENROUTER_API_KEY=\"sk-or-...\""
    echo "  Get one free at https://openrouter.ai/keys"
    exit 1
fi

if [ -z "${1:-}" ]; then
    echo "Usage: ./scripts/llm-compare.sh \"your prompt\""
    echo "       ./scripts/llm-compare.sh --file prompt.txt"
    exit 1
fi

# --- Read prompt ---
if [ "$1" = "--file" ]; then
    PROMPT=$(cat "${2:?Missing filename after --file}")
else
    PROMPT="$*"
fi

# --- Output dir ---
TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
OUTDIR="llm-compare-results/$TIMESTAMP"
mkdir -p "$OUTDIR"

# Save the prompt
echo "$PROMPT" > "$OUTDIR/prompt.txt"

# --- JSON escape the prompt ---
PROMPT_JSON=$(printf '%s' "$PROMPT" | python -c "import sys,json; print(json.dumps(sys.stdin.read()))")

# --- Call function ---
call_model() {
    local model="$1"
    local outfile="$2"
    local label="$3"

    echo -n "  Calling $label ($model)... "

    local start=$(date +%s)

    local response
    response=$(curl -s -w "\n%{http_code}" "$API_URL" \
        -H "Authorization: Bearer $OPENROUTER_API_KEY" \
        -H "Content-Type: application/json" \
        -H "HTTP-Referer: https://github.com/wglynn/vibeswap" \
        -H "X-Title: VibeSwap LLM Compare" \
        -d "{
            \"model\": \"$model\",
            \"messages\": [{\"role\": \"user\", \"content\": $PROMPT_JSON}],
            \"max_tokens\": 4096,
            \"temperature\": 0.7
        }" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    local end=$(date +%s)
    local elapsed=$((end - start))

    if [ "$http_code" = "200" ]; then
        # Extract the response content
        local content
        content=$(echo "$body" | python -c "
import sys, json
data = json.load(sys.stdin)
print(data['choices'][0]['message']['content'])
" 2>/dev/null || echo "ERROR: Could not parse response")

        local tokens
        tokens=$(echo "$body" | python -c "
import sys, json
data = json.load(sys.stdin)
u = data.get('usage', {})
print(f\"prompt: {u.get('prompt_tokens', '?')}, completion: {u.get('completion_tokens', '?')}, total: {u.get('total_tokens', '?')}\")
" 2>/dev/null || echo "unknown")

        echo "$content" > "$outfile"
        echo "done (${elapsed}s, $tokens)"
    else
        echo "$body" > "$outfile"
        echo "FAILED (HTTP $http_code, ${elapsed}s)"
        echo "  See $outfile for error details"
    fi
}

echo "=== LLM A/B Comparison ==="
echo "Prompt: $(echo "$PROMPT" | head -c 100)..."
echo "Output: $OUTDIR/"
echo ""

# --- Run both ---
call_model "$QWEN_MODEL" "$OUTDIR/qwen-response.txt" "Qwen 3.6 Plus"
call_model "$CLAUDE_MODEL" "$OUTDIR/claude-response.txt" "Claude Opus 4.6"

# --- Generate comparison ---
cat > "$OUTDIR/comparison.md" << 'HEADER'
# LLM A/B Comparison
HEADER

cat >> "$OUTDIR/comparison.md" << EOF

**Date**: $TIMESTAMP
**Models**: $QWEN_MODEL vs $CLAUDE_MODEL

## Prompt

\`\`\`
$(cat "$OUTDIR/prompt.txt")
\`\`\`

## Qwen 3.6 Plus (Free)

$(cat "$OUTDIR/qwen-response.txt")

---

## Claude Opus 4.6

$(cat "$OUTDIR/claude-response.txt")

---

## Evaluation

| Dimension | Qwen | Claude | Notes |
|-----------|------|--------|-------|
| Accuracy | /10 | /10 | |
| Depth | /10 | /10 | |
| Hallucination | /10 | /10 | (10 = zero hallucination) |
| Usefulness | /10 | /10 | |
| **Total** | /40 | /40 | |

**Winner**:
**Notes**:
EOF

echo ""
echo "=== Done ==="
echo "  Prompt:     $OUTDIR/prompt.txt"
echo "  Qwen:       $OUTDIR/qwen-response.txt"
echo "  Claude:     $OUTDIR/claude-response.txt"
echo "  Comparison: $OUTDIR/comparison.md (fill in scores)"
