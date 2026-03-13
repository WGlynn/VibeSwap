# IPFS Contribution Graph — Technical Specification

**Status**: Design
**Priority**: HIGH — build sync tool tonight
**Author**: Will + JARVIS (Session 047-048)

---

## Overview

Mirror the ContributionDAG and entire GitHub repository to IPFS, making the contribution graph truly unstoppable. If GitHub goes down, if centralized servers fail, the graph persists.

## Architecture

### 1. ContributionDAG → IPFS

The ContributionDAG smart contract already stores contribution data on-chain. We mirror this to IPFS for:
- Redundancy (chain + IPFS = two independent persistence layers)
- Fast queries without RPC calls
- Human-readable graph exploration

**Flow:**
```
On-chain ContributionDAG
    ↓ (event listener)
IPFS DAG node
    ↓ (pin)
Pinata / local Kubo node
```

### 2. GitHub → IPFS Sync

Cron job that pushes repository snapshots to IPFS after every meaningful change.

**Implementation:**
```bash
# Runs every hour or on push webhook
git archive --format=tar.gz HEAD | ipfs add --pin
# Store CID on-chain or in a CID registry
```

**What gets synced:**
- Full repo snapshot (tar.gz)
- Individual docs/ directory (for direct IPFS gateway access)
- Session reports (provenance trail)
- Research papers (knowledge base)

### 3. IPFS Node Setup

**Option A: Kubo (Go IPFS)**
- Battle-tested, full DHT participation
- Runs on Fly.io or VPS alongside JARVIS
- `ipfs daemon --enable-gc --routing=dht`

**Option B: Helia (JS IPFS)**
- Runs inside JARVIS Node.js process
- No separate daemon
- Better for lightweight pinning
- `import { createHelia } from 'helia'`

**Recommendation:** Kubo for production (stability), Helia for JARVIS integration (convenience).

### 4. Graph Queries

**Option A: The Graph Protocol**
- Subgraph indexing ContributionDAG events
- GraphQL API for contribution queries
- Decentralized hosting on The Graph Network

**Option B: Custom Indexer**
- Node.js service reading from IPFS + chain
- SQLite or DuckDB for local query engine
- REST API: `/api/contributors`, `/api/graph/:authorId`

### 5. Decentralized Identity (DID:IPID)

Link IPFS-based identities to VibeCodes.

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:ipid:QmXyz...",
  "vibeCode": "0xabc...",
  "publicKey": [...],
  "service": [
    { "type": "ContributionGraph", "endpoint": "ipfs://QmGraph..." },
    { "type": "VibeSwap", "endpoint": "https://vibeswap.io" }
  ]
}
```

## Sync Tool Design (MVP — Tonight)

```javascript
// ipfs-sync.js
import { create } from 'kubo-rpc-client'
import { execSync } from 'child_process'

const ipfs = create({ url: '/ip4/127.0.0.1/tcp/5001' })

async function syncRepo() {
  // 1. Create tar.gz of repo
  const archive = execSync('git archive --format=tar.gz HEAD')

  // 2. Add to IPFS
  const result = await ipfs.add(archive, { pin: true })
  console.log(`Repo CID: ${result.cid}`)

  // 3. Store CID in registry
  await updateCIDRegistry(result.cid)

  return result.cid
}

async function syncContributionGraph(graph) {
  // 1. Serialize graph as DAG-CBOR
  const cid = await ipfs.dag.put(graph, { storeCodec: 'dag-cbor' })
  console.log(`Graph CID: ${cid}`)

  // 2. Pin for persistence
  await ipfs.pin.add(cid)

  return cid
}
```

## Security Considerations

- CIDs are content-addressed — tamper-proof by design
- Pin to multiple providers (Pinata, web3.storage, local node)
- On-chain CID registry prevents DNS-style attacks
- DID documents signed with contributor's private key
