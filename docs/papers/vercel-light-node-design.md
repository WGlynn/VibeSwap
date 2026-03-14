# Vercel Frontend as JARVIS Mind Network Light Node

**Faraday1, JARVIS** | March 2026 | VibeSwap Research | Design Document

---

## The Insight

The VibeSwap frontend runs on Vercel — a stateless edge deployment platform. The JARVIS Mind Network runs on Fly.io — a stateful BFT consensus network. These seem like separate systems. But statelessness is not a limitation — it's the defining property of a light node.

A light node doesn't need to:
- Run BFT consensus (stateful)
- Store the knowledge chain (persistent)
- Maintain user CKBs (memory-intensive)
- Process LLM inference (compute-intensive)

A light node DOES:
- Cache recent state (ephemeral)
- Relay requests to full nodes (proxy)
- Report health and latency metrics (observability)
- Serve users from the nearest edge (distribution)

**The Vercel frontend already does all of these things.** It caches assets at edge locations, proxies API calls to backends, reports web vitals, and serves users globally. Making it a "light node" is not adding new functionality — it's recognizing that it already IS one and formalizing the protocol.

---

## Architecture

```
                    JARVIS Mind Network
                    ┌─────────────────────┐
                    │  Full Nodes (Fly.io) │
                    │  ┌─────┐  ┌─────┐   │
                    │  │Shard│  │Shard│   │
                    │  │  0  │  │  1  │   │
                    │  └──┬──┘  └──┬──┘   │
                    │     │        │       │
                    └─────┼────────┼───────┘
                          │        │
            ┌─────────────┼────────┼─────────────┐
            │        Light Node Protocol          │
            └─────────────┼────────┼─────────────┘
                          │        │
    ┌─────────────────────┼────────┼─────────────────────┐
    │              Vercel Edge Network                     │
    │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐   │
    │  │  Edge  │  │  Edge  │  │  Edge  │  │  Edge  │   │
    │  │  SFO   │  │  LHR   │  │  NRT   │  │  GRU   │   │
    │  └────────┘  └────────┘  └────────┘  └────────┘   │
    │  Light Node  Light Node  Light Node  Light Node    │
    └────────────────────────────────────────────────────┘
```

Every Vercel edge location becomes a light node. Global distribution for free.

---

## Light Node Protocol

### 1. State Subscription

The frontend subscribes to a lightweight state feed from the nearest full shard:

```javascript
// In a React context provider or service worker
const lightNode = {
  // Subscribe to knowledge chain head (just the hash, not the full chain)
  chainHead: null,

  // Cache recent network state
  networkState: {
    shardCount: 3,
    healthyShards: 3,
    latestEpoch: 123,
    intelligenceLevel: 'NOMINAL'
  },

  // Track which shard serves this user (sticky session)
  assignedShard: null,

  // Health metrics reported back to router
  metrics: {
    latencyToShard0: null,
    latencyToShard1: null,
    edgeLocation: null,
    userCount: 0
  }
}
```

### 2. Request Relay

User interactions that need AI responses are routed to the assigned full shard:

```javascript
async function relayToShard(message, userId) {
  const shard = lightNode.assignedShard || await discoverNearestShard();

  try {
    const response = await fetch(`${shard.url}/shard/process`, {
      method: 'POST',
      body: JSON.stringify({ message, userId }),
      headers: { 'X-Light-Node': lightNode.edgeLocation }
    });

    // Report latency back
    lightNode.metrics[`latencyTo${shard.id}`] = response.timing;
    return response.json();
  } catch (err) {
    // Failover to next shard
    return relayToShard(message, userId, { exclude: shard.id });
  }
}
```

### 3. Cached Resilience

When full shards are temporarily unreachable, the light node serves cached data:

```javascript
// Service worker intercept
self.addEventListener('fetch', event => {
  if (isNetworkStateRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache fresh state
          cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => {
          // Serve cached state with staleness indicator
          return cache.match(event.request)
            .then(cached => {
              if (cached) {
                cached.headers.set('X-Stale', 'true');
                return cached;
              }
              return new Response(JSON.stringify({ status: 'offline' }));
            });
        })
    );
  }
});
```

### 4. Observability

The light node reports metrics back to the router, providing free global observability:

```javascript
// Periodic beacon (every 30 seconds)
async function reportMetrics() {
  await fetch(`${ROUTER_URL}/router/light-node-metrics`, {
    method: 'POST',
    body: JSON.stringify({
      edgeLocation: lightNode.metrics.edgeLocation,
      latencies: {
        shard0: lightNode.metrics.latencyToShard0,
        shard1: lightNode.metrics.latencyToShard1,
      },
      activeUsers: lightNode.metrics.userCount,
      cacheHitRate: lightNode.metrics.cacheHits / lightNode.metrics.totalRequests,
      timestamp: Date.now()
    })
  });
}
```

---

## What This Enables

### For Users
- **Faster responses**: Cached state served from nearest edge (< 50ms vs 200ms+ to Fly.io)
- **Offline resilience**: Basic functionality works even when full shards are down
- **Seamless failover**: If assigned shard dies, light node routes to next shard transparently

### For the Network
- **Global observability**: Every Vercel edge reports latency, creating a real-time map of network health
- **Load intelligence**: Router knows which edges have most users, can pre-scale shards
- **Zero additional cost**: Vercel edge functions are already running. Light node protocol adds negligible overhead

### For the Architecture
- **The frontend IS the network**: Not a client that connects to a network, but a participant in the network
- **Network grows with users**: Every new user's browser is another observation point
- **Deployment topology = network topology**: No separate infrastructure to maintain

---

## Implementation Plan

### Phase 1: Passive Light Node (No code changes to full shards)
1. Add state subscription to frontend (poll `/health` from nearest shard)
2. Cache network state in service worker
3. Display network health in UI (intelligence level indicator)
4. Report latency metrics to router

### Phase 2: Active Light Node (Minimal shard changes)
1. Add `/router/light-node-metrics` endpoint to router
2. Implement sticky session discovery from light node
3. Add cached resilience (serve stale data when shards unreachable)
4. Implement failover relay logic

### Phase 3: Full Light Node Protocol
1. Subscribe to knowledge chain head (not full chain)
2. Verify chain head against multiple shards (light verification)
3. Participate in network health consensus (report byzantine behavior)
4. Serve as relay for other light nodes (mesh networking at edge)

---

## Knowledge Primitive

**P-046: Stateless Deployments are Natural Light Nodes**

> Any stateless deployment (CDN edge, serverless function, static site) can be upgraded to a network participant by adding light node behavior: cache recent state, relay requests to full nodes, report health metrics. This turns infrastructure costs you're already paying into network capacity. Your deployment topology IS your network topology.
