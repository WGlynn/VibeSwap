# Jarvis on Free Models

No Claude Code subscription? Run Jarvis on Ollama (local, fully free) or Groq (cloud, free tier).

## Quickstart — Ollama (local, 100% free)

```bash
# 1. Install Ollama (one-time): https://ollama.com
# 2. Pull a model (one-time)
ollama pull llama3.2       # ~2GB, fast
# or
ollama pull qwen2.5:7b     # better for code, ~4GB
# or
ollama pull deepseek-r1:8b # better reasoning, ~5GB

# 3. Make sure Ollama is serving (runs as a background service on install)
ollama serve   # only if not already running

# 4. Install Jarvis template into your project
curl -sSL https://raw.githubusercontent.com/WGlynn/VibeSwap/master/jarvis-template/install.sh | bash

# 5. Install Python deps
pip install requests

# 6. Run
python .claude/../jarvis-cli.py                             # from within the project dir
# or
python path/to/jarvis-cli.py --backend ollama --model qwen2.5:7b
```

Actually — `jarvis-cli.py` is bundled in the template. After install:

```bash
cp ~/.jarvis-template-cache/jarvis-template/jarvis-cli.py ./
python jarvis-cli.py
```

## Quickstart — Groq (cloud, free tier)

Groq is free up to a rate limit. Much faster than Ollama for bigger models.

```bash
# 1. Sign up at console.groq.com → create API key
# 2. Set the key
export GROQ_API_KEY=gsk_your_key_here   # or add to ~/.bashrc
# 3. Install
curl -sSL https://raw.githubusercontent.com/WGlynn/VibeSwap/master/jarvis-template/install.sh | bash
pip install groq
# 4. Run
python jarvis-cli.py --backend groq --model llama-3.3-70b-versatile
```

Good Groq models:
- `llama-3.3-70b-versatile` — general purpose, fast
- `qwen-2.5-coder-32b` — best for code
- `deepseek-r1-distill-llama-70b` — reasoning

## Quickstart — OpenAI (paid but cheap)

```bash
export OPENAI_API_KEY=sk-your_key_here
pip install openai
python jarvis-cli.py --backend openai --model gpt-4o-mini
```

## What you get

All of the Jarvis stateful-overlay primitives, running against any LLM:

- **CLAUDE.md + memory/** loaded as system prompt on boot
- **Session chain** — every prompt/response gets a hash-linked block (`chain.py`)
- **PROPOSALS.md capture** — if the model presents decision slates, they get auto-persisted
- **WAL** — crash-recovery log, marked ACTIVE/CLEAN automatically
- **SESSION_STATE** — continuation context, updated every turn
- **Slash commands** — `/state`, `/wal`, `/memory`, `/chain`, `/clear`, `/help`, `/exit`

What you DON'T get vs Claude Code:
- Native tool use (file edits, bash, etc.) — the model can tell you what to run but can't execute
- IDE integration
- Streaming responses
- `StopFailure` / `PreCompact` hooks (replaced by `atexit` + signal handlers)

For code editing on free models, pair Jarvis CLI for reasoning with [aider](https://aider.chat) for the actual edits. Point both at the same project dir and they'll share the `.claude/` state.

## Model recommendations

| Use case | Ollama | Groq | OpenAI |
|----------|--------|------|--------|
| Fast local chat | `llama3.2` (3B) | — | — |
| Code reasoning | `qwen2.5-coder:7b` | `qwen-2.5-coder-32b` | `gpt-4o-mini` |
| Deep reasoning | `deepseek-r1:8b` | `deepseek-r1-distill-llama-70b` | `o1-mini` |
| Best overall free | `qwen2.5:14b` | `llama-3.3-70b-versatile` | — |

Smaller local models won't reliably follow the memory primitives (32-bit quantization degrades instruction following). For serious use, prefer a 14B+ local model or a 70B+ hosted one.

## Memory loading

On boot, `jarvis-cli.py` reads:
- `CLAUDE.md` — system prompt root
- All `memory/primitive_*.md` — load-bearing rules
- All `memory/feedback_*.md` — behavioral feedback

For the template (~10 memory files) this is ~10-20K tokens — fits any modern context window.

If you have 100+ memory files, the system prompt gets huge. Options:
1. Delete memory files you don't need
2. Move unused ones to `memory/_archive/` (glob skips)
3. Split into fast-path vs on-demand (not yet supported — PR welcome)

## Debugging

```bash
# Check chain state
python .claude/session-chain/chain.py stats
python .claude/session-chain/chain.py view --last 5

# Check WAL
cat .claude/WAL.md | tail -20

# Check last proposals captured
tail -50 .claude/PROPOSALS.md

# Test a clean turn without persistence (dry run)
echo "hello" | python jarvis-cli.py --backend ollama
```

## Caveats

- **Small models hallucinate more** — the Anti-Hallucination primitive helps but doesn't eliminate. Always verify file paths the model names.
- **Tool use is manual** — the model tells you to run a command; you run it and paste the output back. Slower than Claude Code but free.
- **Context grows linearly** — every turn appends to messages. At ~100 turns on a 32K model you'll hit the limit. Use `/clear` when you change topics.
- **No streaming** — full response prints when ready. For Ollama that's a few seconds for 70B models. For Groq/OpenAI it's near-instant.
