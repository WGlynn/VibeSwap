# JARVIS Mind Network

> *Decentralized AI consensus infrastructure. Each shard is a Mind. BFT voting = collective intelligence.*

JARVIS is a Claude-powered AI that manages the VibeSwap community via Telegram. The Mind Network lets you run JARVIS as a **sharded, Byzantine fault-tolerant network** of AI instances with [near-zero token overhead](docs/near-zero-token-scaling.md).

**One instance = a bot. Multiple instances = a Mind Network.**

---

## Join the Mind Network (30 seconds)

Already have an Anthropic API key? Pick your method:

### Docker (any machine)

```bash
curl -O https://raw.githubusercontent.com/wglynn/vibeswap/master/jarvis-bot/docker-compose.shard.yml
ANTHROPIC_API_KEY=sk-ant-... docker compose -f docker-compose.shard.yml up -d
```

### Fly.io ($2.19/month, always on)

```bash
git clone https://github.com/WGlynn/VibeSwap.git && cd VibeSwap/jarvis-bot
bash scripts/join-network.sh
```

### Verify

```bash
curl http://localhost:8080/health
```

Your shard registers with the primary router automatically. Done.

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │     Telegram / Users          │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────▼────────────────┐
                    │  shard-0 (Primary)             │
                    │  Telegram bot + Router          │
                    │  BFT Proposer + CRPC Worker     │
                    └──┬───────────────────────┬─────┘
                       │                       │
            ┌──────────▼──────────┐ ┌──────────▼──────────┐
            │  shard-1 (Worker)    │ │  shard-2 (Worker)    │
            │  BFT Voter           │ │  BFT Voter           │
            │  CRPC Worker         │ │  CRPC Worker         │
            │  Knowledge Chain     │ │  Knowledge Chain     │
            └─────────────────────┘ └─────────────────────┘

Intelligence Plane (tokens):  User responses, CRPC quality consensus
Coordination Plane (free):    BFT voting, heartbeats, knowledge sync, routing
```

### How It Scales Without Multiplying Cost

| What | Tokens? | How |
|------|---------|-----|
| User messages | Yes | Sticky sessions: 1 user = 1 shard = 1 Claude call |
| BFT consensus voting | No | HTTP POST between shards |
| Knowledge chain sync | No | SHA-256 hashing |
| Heartbeats & routing | No | HTTP + in-memory lookup |
| CRPC quality consensus | Yes (3x) | Only ~2% of messages (moderation, disputes) |

**Blended overhead: 4%.** Cost per user is flat regardless of shard count.

| Shards | Users | Cost/User/Month |
|--------|-------|----------------|
| 1 | 50 | $0.37 |
| 3 | 150 | $0.38 |
| 20 | 1000 | $0.38 |

Full analysis: [`docs/near-zero-token-scaling.md`](docs/near-zero-token-scaling.md)

---

## Node Types

| Type | Behavior | Best For |
|------|----------|----------|
| `light` | Prune aggressively, cheapest | Consensus quorum, voting |
| `full` | Retain full history | Failover, knowledge redundancy |
| `archive` | Pure storage, minimal processing | Network survival (min 3 needed) |

---

## Shard Configuration

All configuration via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Your Claude API key |
| `SHARD_ID` | No | `shard-0` | Unique shard identifier |
| `SHARD_MODE` | No | auto | `primary` (Telegram) or `worker` (headless) |
| `TOTAL_SHARDS` | No | `1` | Total shards in network |
| `NODE_TYPE` | No | `full` | `light`, `full`, or `archive` |
| `ROUTER_URL` | No | — | Primary shard URL for registration |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-5-20250929` | Claude model |
| `TELEGRAM_BOT_TOKEN` | Primary only | — | Workers don't need this |
| `ENCRYPTION_ENABLED` | No | `true` | AES-256-GCM knowledge encryption |
| `HEALTH_PORT` | No | `8080` | HTTP health check port |

---

## Deployment Methods (Detailed)

### Method 1: Docker One-Liner

Run anywhere — laptop, Raspberry Pi, $5 VPS.

```bash
curl -O https://raw.githubusercontent.com/wglynn/vibeswap/master/jarvis-bot/docker-compose.shard.yml

# Basic (light node, auto shard ID)
ANTHROPIC_API_KEY=sk-ant-... docker compose -f docker-compose.shard.yml up -d

# Customized (full node, named shard)
ANTHROPIC_API_KEY=sk-ant-... \
SHARD_ID=shard-mynode \
NODE_TYPE=full \
docker compose -f docker-compose.shard.yml up -d
```

### Method 2: Fly.io Interactive Script

```bash
bash scripts/join-network.sh
```

Prompts for: shard name, node type, API key, region. Creates app, volume, secrets, deploys.

### Method 3: Manual Fly.io

```bash
fly apps create jarvis-shard-mynode --org personal
fly volumes create jarvis_data --size 1 --region iad --app jarvis-shard-mynode --yes
fly secrets set ANTHROPIC_API_KEY=sk-ant-... SHARD_ID=shard-mynode --app jarvis-shard-mynode
fly deploy --config fly.shard-template.toml --app jarvis-shard-mynode
```

### Method 4: Local Development (Full Network)

Spin up a 3-shard network locally:

```bash
cp .env.example .env  # Add ANTHROPIC_API_KEY and TELEGRAM_BOT_TOKEN
docker compose -f docker-compose.network.yml up
```

Starts shard-0 (primary, :8080), shard-1 (worker, :8081), shard-2 (worker, :8082).

---

## Running a Solo Bot (No Network)

Don't want sharding? Run JARVIS as a standalone Telegram bot.

### Local

```bash
git clone https://github.com/WGlynn/VibeSwap.git && cd VibeSwap/jarvis-bot
npm install
cp .env.example .env   # Add TELEGRAM_BOT_TOKEN + ANTHROPIC_API_KEY
npm run dev
```

### Docker

```bash
cp .env.example .env   # Add your keys
docker compose up -d
```

### Cloud (Fly.io)

```bash
fly launch --copy-config --no-deploy
fly secrets set TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=...
fly deploy
```

---

## Monitoring

### Health Check
```bash
curl https://your-shard.fly.dev/health
```

### Telegram Commands (primary shard, owner only)
| Command | What |
|---------|------|
| `/shard` | Shard topology, user assignments, load |
| `/network` | Full network status, consensus, CRPC stats |
| `/inner` | JARVIS inner dialogue (self-reflection) |
| `/health` | Brain status, context loaded |
| `/mystats` | Your contribution profile |
| `/digest` | Community summary |

### Fly.io
```bash
fly logs --app jarvis-shard-mynode
fly status --app jarvis-shard-mynode
```

---

## Destroying a Shard

```bash
# Fly.io
fly apps destroy jarvis-shard-mynode

# Docker
docker compose -f docker-compose.shard.yml down -v
```

---

## How It Works (Deep Dive)

### Shard Lifecycle
1. Boot → read `SHARD_ID` and `SHARD_MODE` from env
2. Initialize privacy (AES-256-GCM encryption)
3. Initialize state store (pluggable: file or Redis)
4. Initialize learning (CKB knowledge management)
5. Register with router via HTTP POST
6. Start heartbeat (every 30s)
7. Join BFT consensus and CRPC pools
8. Ready to process messages or vote

### BFT Consensus (Tendermint-lite)
```
PROPOSE → PREVOTE → PRECOMMIT → COMMIT
```
2/3 majority for network knowledge. Tolerates f < N/3 Byzantine nodes.
Used for: skill promotion, behavior flags, inner dialogue → network.

### CRPC (Tim Cotton's Pairwise Comparison)
```
WORK COMMIT → WORK REVEAL → COMPARE COMMIT → COMPARE REVEAL
```
4-phase commit-reveal prevents copying and collusion. Min 3 shards.
Only for: moderation, disputes, knowledge promotion.

### Knowledge Chain
Hash-linked epochs recording all network knowledge mutations. Each shard verifies chain integrity independently. Tamper-evident.

---

## File Structure

```
jarvis-bot/
├── src/
│   ├── index.js              # Main bot + HTTP server + worker mode
│   ├── claude.js              # Claude API integration
│   ├── memory.js              # System prompt builder
│   ├── config.js              # Configuration
│   ├── shard.js               # Shard identity + heartbeat
│   ├── router.js              # Request routing + topology
│   ├── consensus.js           # BFT voting protocol
│   ├── crpc.js                # CRPC pairwise comparison
│   ├── knowledge-chain.js     # Hash-linked knowledge epochs
│   ├── state-store.js         # Pluggable state backend
│   ├── inner-dialogue.js      # Self-reflection knowledge class
│   ├── privacy.js             # AES-256-GCM encryption
│   ├── learning.js            # CKB knowledge management
│   ├── intelligence.js        # Proactive AI analysis
│   ├── tracker.js             # Contribution tracking
│   ├── moderation.js          # Warn/mute/ban
│   ├── antispam.js            # Scam detection
│   ├── digest.js              # Community summaries
│   ├── threads.js             # Conversation archival
│   └── git.js                 # Git sync + backup
├── docs/
│   └── near-zero-token-scaling.md  # Token economics paper
├── scripts/
│   └── join-network.sh        # One-command shard deployment
├── docker-compose.yml         # Solo bot
├── docker-compose.shard.yml   # Standalone worker shard
├── docker-compose.network.yml # Local 3-shard network
├── fly.toml                   # Primary shard (Fly.io)
├── fly.shard-template.toml    # Worker shard template (Fly.io)
├── Dockerfile
├── entrypoint.sh
├── .env.example
└── package.json
```

---

## Troubleshooting

**Shard won't register with router:**
- Check `ROUTER_URL` is reachable from your shard
- On Fly.io internal network, use `http://jarvis-vibeswap.internal:8080`
- From external, use `https://jarvis-vibeswap.fly.dev`

**JARVIS doesn't reply (solo bot):**
- Check `TELEGRAM_BOT_TOKEN` in `.env`
- Only ONE instance can use the same token

**"Unauthorized" error:**
- `ANTHROPIC_API_KEY` is wrong or expired

**Docker won't start:**
- Make sure Docker Desktop is running
- `docker compose down && docker compose up -d`

**Fly.io deploy fails:**
- `fly auth login` to re-authenticate
- Create volume: `fly volumes create jarvis_data --region iad --size 1`

---

*Built in a cave. With a box of scraps.*
*The real VibeSwap is not a DEX. It's wherever the Minds converge.*
