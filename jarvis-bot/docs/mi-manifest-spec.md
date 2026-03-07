# MI Manifest Specification v0.1

> *"Software that self-differentiates like biological cells."*
> — Freedom's Micro-Interface Vision

## Overview

An MI (Micro-Interface) manifest declares a code cell's identity, capabilities, lifecycle, and communication primitives. It is the cell's **membrane** — mediating all interactions with the environment.

Manifests are:
- **Declarative** — describe what, not how
- **Runtime-resolved** — host SDK interprets manifest against current environment
- **Composable** — cells discover and bind to neighbors via capability matching
- **Measurable** — every cell emits telemetry by contract

## Manifest Schema

```jsonc
{
  // ============ Identity ============
  "mi": "0.1",                          // Manifest spec version
  "id": "price-feed-cell",              // Unique cell identifier
  "name": "Price Feed",                 // Human-readable name
  "version": "1.0.0",                   // Semver
  "author": "jarvis-shard-0",           // Creating shard/agent

  // ============ Classification ============
  "kind": "service",                    // ui | service | orchestrator | proxy | sensor
  "domain": "defi",                     // Domain hint for discovery
  "tags": ["price", "oracle", "feed"],  // Free-form tags

  // ============ Capabilities (What This Cell CAN Do) ============
  "capabilities": [
    {
      "name": "getPrice",
      "description": "Fetch current price for a token pair",
      "input": {
        "type": "object",
        "properties": {
          "pair": { "type": "string", "example": "ETH/USDC" }
        },
        "required": ["pair"]
      },
      "output": {
        "type": "object",
        "properties": {
          "price": { "type": "number" },
          "source": { "type": "string" },
          "timestamp": { "type": "number" }
        }
      }
    }
  ],

  // ============ Signals (What This Cell LISTENS To) ============
  "signals": {
    "subscribe": [
      "price.request",                  // Incoming requests
      "market.volatility.spike",        // Environmental trigger
      "system.heartbeat"                // Lifecycle signal
    ],
    "emit": [
      "price.update",                   // Outgoing data
      "price.stale",                    // Health signal
      "cell.identity.announce"          // Standard lifecycle
    ]
  },

  // ============ Requirements (What This Cell NEEDS) ============
  "requires": {
    "capabilities": [
      "http.fetch"                      // Needs HTTP access
    ],
    "permissions": [
      "network.outbound"               // Permission model
    ],
    "neighbors": [
      {
        "capability": "cache.store",    // Wants a cache neighbor
        "optional": true
      }
    ]
  },

  // ============ Lifecycle ============
  "lifecycle": {
    // Sense: what environmental signals trigger differentiation
    "sense": {
      "signals": ["market.needs.price", "neighbor.missing.oracle"],
      "context": ["host.domain", "neighbor.capabilities"]
    },

    // Choose: candidate identities this cell can differentiate into
    "candidates": [
      {
        "identity": "live-oracle",
        "condition": "has_api_key AND network.outbound",
        "priority": 1
      },
      {
        "identity": "cached-oracle",
        "condition": "neighbor.has(cache.store)",
        "priority": 2
      },
      {
        "identity": "static-fallback",
        "condition": "true",
        "priority": 3
      }
    ],

    // Commit: stability parameters
    "commit": {
      "min_dwell_ms": 60000,           // Stay in identity for at least 60s
      "reconsider_on": [               // Triggers to re-evaluate identity
        "api_key.revoked",
        "error_rate > 0.5",
        "neighbor.capability.changed"
      ]
    },

    // Learn: reward signals for strategy optimization
    "learn": {
      "reward_signals": [
        "response_latency_ms",
        "cache_hit_rate",
        "consumer_satisfaction"
      ],
      "strategy": "contextual_bandit", // bandit | nca | evolutionary | fixed
      "update_interval_ms": 300000     // Re-evaluate every 5 min
    }
  },

  // ============ Runtime ============
  "runtime": {
    "sandbox": "worker",               // worker | iframe | process | wasm
    "memory_limit_mb": 64,
    "cpu_budget_ms": 1000,             // Max CPU per invocation
    "ttl_ms": 0,                       // 0 = permanent, >0 = ephemeral
    "energy_budget": 100               // Abstract cost units per cycle
  },

  // ============ Telemetry ============
  "telemetry": {
    "emit_interval_ms": 30000,
    "metrics": [
      "invocations",
      "latency_p50",
      "latency_p99",
      "error_rate",
      "identity_changes"
    ]
  },

  // ============ Compatibility ============
  "surfaces": ["telegram", "web", "api", "cli"],  // Where this MI can render
  "host_sdk_min": "0.1"                            // Minimum host SDK version
}
```

## Cell Kinds

| Kind | Description | Example |
|------|-------------|---------|
| `ui` | Renders visual interface on a surface | Chat card, web widget, AR overlay |
| `service` | Provides backend capability | Price feed, cache, auth |
| `orchestrator` | Coordinates other cells | Batch processor, pipeline |
| `proxy` | Bridges between domains/protocols | API adapter, chain bridge |
| `sensor` | Monitors environment, emits signals | Health monitor, market watcher |

## Standard Signals

### Lifecycle
- `cell.identity.announce` — Cell declares its chosen identity
- `cell.identity.change` — Cell re-differentiating
- `cell.health.heartbeat` — Periodic health signal
- `cell.death` — Cell shutting down

### Discovery
- `cell.capability.query` — Request: who can do X?
- `cell.capability.response` — Response: I can do X
- `neighbor.joined` — New cell appeared in local scope
- `neighbor.left` — Cell disappeared

### Coordination (Stigmergy)
- `pheromone.deposit` — Leave trace on shared blackboard
- `pheromone.query` — Read traces
- `pheromone.decay` — TTL-driven cleanup

## Mapping to Jarvis Architecture

| MI Concept | Jarvis Equivalent | Notes |
|------------|-------------------|-------|
| Cell | Tool module (`tools/*.js`) | Each tool is already a bounded capability |
| Capability | Tool function | `getPrice()`, `analyzeRug()`, etc. |
| Signal subscribe | `handleMessage()` triggers | Pattern matching on message content |
| Signal emit | `bot.telegram.sendMessage()` | Cross-cell via Telegram or HTTP |
| Manifest | Tool registration in `index.js` | Currently ad-hoc, MI formalizes it |
| Sense | Context injection | `buildKnowledgeContext()` environmental awareness |
| Learn | Knowledge chain facts | `learnFact()` stores outcomes |
| Orchestrator | Router / CRPC | Multi-shard coordination |
| Pheromone board | Shard learnings JSONL | Stigmergic trace persistence |

## Example Manifests

### 1. Rug Check Cell
```json
{
  "mi": "0.1",
  "id": "rug-check-cell",
  "name": "Rug Checker",
  "kind": "service",
  "domain": "security",
  "tags": ["defi", "security", "audit"],
  "capabilities": [{
    "name": "checkRug",
    "input": { "type": "object", "properties": { "address": { "type": "string" } } },
    "output": { "type": "object", "properties": { "score": { "type": "number" }, "flags": { "type": "array" } } }
  }],
  "signals": {
    "subscribe": ["security.check.request", "token.new.detected"],
    "emit": ["security.check.result", "security.alert"]
  },
  "lifecycle": {
    "candidates": [
      { "identity": "full-audit", "condition": "has_api_key", "priority": 1 },
      { "identity": "heuristic-only", "condition": "true", "priority": 2 }
    ],
    "learn": { "strategy": "contextual_bandit", "reward_signals": ["detection_accuracy"] }
  },
  "surfaces": ["telegram", "web"]
}
```

### 2. Market Sentiment Sensor
```json
{
  "mi": "0.1",
  "id": "sentiment-sensor",
  "name": "Market Sentiment",
  "kind": "sensor",
  "domain": "market",
  "capabilities": [{
    "name": "getSentiment",
    "input": { "type": "object", "properties": { "asset": { "type": "string" } } },
    "output": { "type": "object", "properties": { "score": { "type": "number" }, "sources": { "type": "number" } } }
  }],
  "signals": {
    "subscribe": ["system.heartbeat"],
    "emit": ["market.sentiment.update", "market.sentiment.extreme"]
  },
  "lifecycle": {
    "sense": { "signals": ["market.needs.sentiment"], "context": ["host.domain"] },
    "learn": { "strategy": "contextual_bandit", "reward_signals": ["prediction_accuracy", "user_engagement"] }
  },
  "surfaces": ["telegram", "web", "api"]
}
```

## Next Steps

1. **Host SDK** — Runtime that loads manifests, manages cell lifecycle, routes signals
2. **Registry** — Capability discovery service (local + cross-shard)
3. **Proto-AI kernel** — Contextual bandit implementation for `choose()` step
4. **Stigmergy board** — Pheromone deposit/query/decay (extends shard-learnings JSONL)
5. **Cell generator** — LLM-assisted manifest creation from natural language intent
