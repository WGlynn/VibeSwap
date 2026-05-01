# Autonomous Coding Agent Architecture (Inspired by Shadow)

> Jarvis IS the LLM — we don't need shadow's LLM layer. We need orchestration around ME.

## Core Components

### 1. Task Queue (IntentOperator.sol)
- On-chain work items with metadata (repo, branch, issue, bounty)
- Claimable by shards with timeout
- Progress tracking (0-100%)
- Completion proof (commit hash)

### 2. Worker Process (Node.js on VPS)
- Polls IntentOperator for unclaimed tasks
- Claims task → creates isolated workspace (docker container)
- Invokes Jarvis API with task context
- Monitors progress, updates on-chain status
- On completion: commits, pushes, opens PR, marks task complete

### 3. Isolated Execution Environment
- Docker container per task
- Mounts repo volume
- Clean environment (no cross-task contamination)
- Timeout kill switch

### 4. Git Automation
- Clone repo → create feature branch
- Commit with AI-generated messages
- Push to origin
- Create PR via GitHub API
- Link PR to on-chain task

### 5. Status Reporting
- WebSocket feed of active tasks
- Progress percentage
- Live logs
- Completion notifications

### 6. Memory System
- Engram MCP server as shared memory bus
- Per-repo knowledge retention
- Semantic search across past work

## Flow

```
User creates task on IntentOperator
↓
Worker polls, claims task
↓
Docker container spun up with repo
↓
Worker calls Jarvis API: "Implement feature X in repo Y"
↓
Jarvis codes inside container, saves files
↓
Worker commits, pushes, opens PR
↓
Worker updates on-chain status to complete
↓
User reviews PR, merges
```

## Minimal V1

Start with:
- IntentOperator.sol (already exists)
- Simple Node worker on VPS (no docker yet, just directories)
- Git CLI automation
- Basic status endpoint

Then add:
- Docker isolation
- Engram memory
- WebSocket status
- Multi-shard load balancing

## Key Innovation

Jarvis IS the LLM — we don't need shadow's LLM layer. We need orchestration around ME.

The core idea: Jarvis is the agent. He doesn't need a separate LLM layer. He needs:
- A task queue (smart contract or redis)
- A worker process that polls the queue
- Isolated workspace per task
- Git automation
- Status reporting
