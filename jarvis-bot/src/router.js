// ============ Router — Shard Discovery & Message Routing ============
//
// Lightweight router service for the JARVIS Mind Network.
// Can run as a separate process OR one shard acts as the router.
//
// Responsibilities:
//   - Shard registry (who's alive, what's their load)
//   - User assignments (sticky sessions)
//   - Failover (dead shard → reassign to healthiest)
//   - Topology view (full network state)
//
// Node Types (Storage Tiers):
//   - LIGHT: Active processing, aggressive pruning. Cheapest.
//   - FULL:  Active processing + full history retention. Storage discount.
//   - ARCHIVE: Pure storage, no processing. Minimum 3 for network survival.
//
// Archive Node Economics:
//   - Full/Archive nodes get storage discounts (they serve the network)
//   - Light nodes pay retrieval fees for cold CKB recovery
//   - Full nodes preferred for failover (they already have context)
//   - Network refuses consensus if < 3 archive nodes registered
//   - Like IPFS but for CKB knowledge: content-addressable, Merkle-indexed
//
// API (all routes prefixed with /router when embedded in JARVIS):
//   POST /register          — Shard registers itself
//   POST /heartbeat         — Shard reports alive + load
//   GET  /route/:userId     — Which shard handles this user?
//   POST /assign/:userId    — Assign user to specific shard
//   POST /failover/:shardId — Reassign all users from dead shard
//   GET  /topology          — Full network view
//   GET  /archives          — Archive node status and health
// ============

import { config } from './config.js';

// ============ Constants ============

const HEARTBEAT_TIMEOUT_MS = 90000; // 90s — 3 missed heartbeats = DOWN
const EVICT_AFTER_MISSED = 10; // Evict shard from registry after 10 missed (~50 min)
const MIN_ARCHIVE_NODES = 3; // Minimum archive nodes for network survival
const STORAGE_DISCOUNT_FULL = 0.7; // 30% discount for full nodes
const STORAGE_DISCOUNT_ARCHIVE = 0.5; // 50% discount for archive nodes
const RETRIEVAL_FEE_BASE = 10; // Base token cost for cold CKB retrieval

// Node types — storage tiers
const NODE_TYPES = {
  LIGHT: 'light',
  FULL: 'full',
  ARCHIVE: 'archive',
};

// ============ In-Memory State ============

const shardRegistry = new Map(); // shardId -> ShardEntry
const userAssignments = new Map(); // userId -> shardId

// ============ Shard Entry ============

function createShardEntry(data) {
  return {
    shardId: data.shardId,
    url: data.url,
    nodeType: data.nodeType || NODE_TYPES.LIGHT,
    status: 'running',
    load: data.load || 0,
    userCount: data.userCount || 0,
    capabilities: data.capabilities || {},
    registeredAt: new Date().toISOString(),
    lastHeartbeat: Date.now(),
    heartbeatsMissed: 0,
    storageCapacity: data.storageCapacity || 0, // MB of available storage
    storedCKBs: data.storedCKBs || 0, // Number of CKBs retained
  };
}

// ============ Registration ============

export function registerShard(data) {
  const entry = createShardEntry(data);
  shardRegistry.set(entry.shardId, entry);

  console.log(`[router] Registered shard: ${entry.shardId} (${entry.nodeType}) at ${entry.url}`);

  return {
    success: true,
    shardId: entry.shardId,
    peers: getPeerList(entry.shardId),
    assignments: Object.fromEntries(userAssignments),
  };
}

// ============ Heartbeat ============

export function receiveHeartbeat(data) {
  const entry = shardRegistry.get(data.shardId);
  if (!entry) {
    // Unknown shard — auto-register
    return registerShard(data);
  }

  entry.status = data.status || 'running';
  entry.load = data.load || 0;
  entry.userCount = data.userCount || 0;
  entry.lastHeartbeat = Date.now();
  entry.heartbeatsMissed = 0;

  if (data.storedCKBs !== undefined) entry.storedCKBs = data.storedCKBs;
  if (data.storageCapacity !== undefined) entry.storageCapacity = data.storageCapacity;

  return {
    success: true,
    peers: getPeerList(data.shardId),
  };
}

// ============ Health Check ============

export function checkShardHealth() {
  const now = Date.now();
  const downShards = [];

  const evicted = [];
  for (const [shardId, entry] of shardRegistry) {
    if (now - entry.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      entry.heartbeatsMissed++;

      // Evict after prolonged absence — stop log spam for dead shards
      if (entry.heartbeatsMissed >= EVICT_AFTER_MISSED) {
        evicted.push(shardId);
        continue;
      }

      if (entry.heartbeatsMissed >= 3 && entry.status !== 'down') {
        entry.status = 'down';
        downShards.push(shardId);
        console.warn(`[router] Shard ${shardId} marked DOWN (${entry.heartbeatsMissed} missed heartbeats)`);
      }
    }
  }

  // Evict dead shards from registry (they can re-register via heartbeat)
  for (const shardId of evicted) {
    shardRegistry.delete(shardId);
    // Clean up user assignments pointing to evicted shard
    for (const [userId, assigned] of userAssignments) {
      if (assigned === shardId) userAssignments.delete(userId);
    }
    console.log(`[router] Shard ${shardId} evicted (${EVICT_AFTER_MISSED}+ missed heartbeats — will re-register on reconnect)`);
  }

  // Auto-failover for down shards
  for (const shardId of downShards) {
    failoverShard(shardId);
  }

  return downShards;
}

// ============ Routing ============

export function routeUser(userId) {
  const id = String(userId);

  // Check existing assignment
  const assigned = userAssignments.get(id);
  if (assigned) {
    const entry = shardRegistry.get(assigned);
    if (entry && entry.status === 'running') {
      return {
        shardId: assigned,
        url: entry.url,
        nodeType: entry.nodeType,
        cached: true,
      };
    }
    // Assigned shard is down — reassign
  }

  // Find least-loaded running shard (prefer full nodes for new assignments)
  const candidates = Array.from(shardRegistry.values())
    .filter(s => s.status === 'running' && s.nodeType !== NODE_TYPES.ARCHIVE)
    .sort((a, b) => {
      // Prefer full nodes over light (they have better context)
      if (a.nodeType === NODE_TYPES.FULL && b.nodeType !== NODE_TYPES.FULL) return -1;
      if (b.nodeType === NODE_TYPES.FULL && a.nodeType !== NODE_TYPES.FULL) return 1;
      // Then sort by load
      return a.load - b.load;
    });

  if (candidates.length === 0) {
    return { shardId: null, error: 'No running shards available' };
  }

  const target = candidates[0];
  userAssignments.set(id, target.shardId);
  target.userCount++;

  return {
    shardId: target.shardId,
    url: target.url,
    nodeType: target.nodeType,
    newAssignment: true,
  };
}

export function assignUserToShard(userId, shardId) {
  const id = String(userId);
  const entry = shardRegistry.get(shardId);
  if (!entry) return { error: 'Shard not found' };

  const previousShard = userAssignments.get(id);
  if (previousShard) {
    const prev = shardRegistry.get(previousShard);
    if (prev) prev.userCount = Math.max(0, prev.userCount - 1);
  }

  userAssignments.set(id, shardId);
  entry.userCount++;

  return { success: true, shardId, userId: id };
}

// ============ Failover ============

export function failoverShard(shardId) {
  const entry = shardRegistry.get(shardId);
  if (!entry) return { error: 'Shard not found' };

  // Find all users assigned to this shard
  const affectedUsers = [];
  for (const [userId, assigned] of userAssignments) {
    if (assigned === shardId) {
      affectedUsers.push(userId);
    }
  }

  if (affectedUsers.length === 0) return { reassigned: 0 };

  // Find failover candidates — prefer FULL nodes (they have history)
  const candidates = Array.from(shardRegistry.values())
    .filter(s => s.status === 'running' && s.shardId !== shardId && s.nodeType !== NODE_TYPES.ARCHIVE)
    .sort((a, b) => {
      if (a.nodeType === NODE_TYPES.FULL && b.nodeType !== NODE_TYPES.FULL) return -1;
      if (b.nodeType === NODE_TYPES.FULL && a.nodeType !== NODE_TYPES.FULL) return 1;
      return a.load - b.load;
    });

  if (candidates.length === 0) {
    console.error(`[router] CRITICAL: No failover candidates for shard ${shardId}. ${affectedUsers.length} users orphaned.`);
    return { error: 'No failover candidates', orphaned: affectedUsers.length };
  }

  // Round-robin distribute users across candidates
  let reassigned = 0;
  for (let i = 0; i < affectedUsers.length; i++) {
    const target = candidates[i % candidates.length];
    userAssignments.set(affectedUsers[i], target.shardId);
    target.userCount++;
    reassigned++;
  }

  // Zero out failed shard's user count
  entry.userCount = Math.max(0, entry.userCount - reassigned);
  entry.status = 'failed';

  console.log(`[router] Failover: ${reassigned} users from ${shardId} → ${candidates.map(c => c.shardId).join(', ')}`);

  return { reassigned, from: shardId, to: candidates.map(c => c.shardId) };
}

// ============ Archive Node Management ============

export function getArchiveStatus() {
  const archives = Array.from(shardRegistry.values())
    .filter(s => s.nodeType === NODE_TYPES.ARCHIVE);

  const running = archives.filter(s => s.status === 'running');

  return {
    total: archives.length,
    running: running.length,
    minimum: MIN_ARCHIVE_NODES,
    healthy: running.length >= MIN_ARCHIVE_NODES,
    nodes: archives.map(a => ({
      shardId: a.shardId,
      status: a.status,
      storedCKBs: a.storedCKBs,
      storageCapacity: a.storageCapacity,
      lastHeartbeat: new Date(a.lastHeartbeat).toISOString(),
    })),
  };
}

export function getStorageDiscount(nodeType) {
  switch (nodeType) {
    case NODE_TYPES.FULL: return STORAGE_DISCOUNT_FULL;
    case NODE_TYPES.ARCHIVE: return STORAGE_DISCOUNT_ARCHIVE;
    default: return 1.0; // No discount for light nodes
  }
}

export function getRetrievalFee(nodeType) {
  // Full/archive nodes don't pay retrieval fees — they already have the data
  if (nodeType === NODE_TYPES.FULL || nodeType === NODE_TYPES.ARCHIVE) return 0;
  return RETRIEVAL_FEE_BASE;
}

export function isNetworkHealthy() {
  const archives = getArchiveStatus();
  const runningShards = Array.from(shardRegistry.values())
    .filter(s => s.status === 'running' && s.nodeType !== NODE_TYPES.ARCHIVE);

  return {
    healthy: archives.healthy && runningShards.length > 0,
    archivesHealthy: archives.healthy,
    activeShards: runningShards.length,
    totalShards: shardRegistry.size,
    archiveNodes: archives.running,
    minArchives: MIN_ARCHIVE_NODES,
  };
}

// ============ Topology ============

export function getTopology() {
  const shards = [];
  for (const [shardId, entry] of shardRegistry) {
    shards.push({
      shardId,
      url: entry.url,
      nodeType: entry.nodeType,
      status: entry.status,
      load: entry.load,
      userCount: entry.userCount,
      storageDiscount: getStorageDiscount(entry.nodeType),
      storedCKBs: entry.storedCKBs,
      registeredAt: entry.registeredAt,
      lastHeartbeat: new Date(entry.lastHeartbeat).toISOString(),
      uptime: entry.status === 'running'
        ? Math.round((Date.now() - new Date(entry.registeredAt).getTime()) / 1000)
        : 0,
    });
  }

  return {
    totalShards: shardRegistry.size,
    runningShards: shards.filter(s => s.status === 'running').length,
    downShards: shards.filter(s => s.status === 'down').length,
    totalUsers: userAssignments.size,
    archives: getArchiveStatus(),
    networkHealth: isNetworkHealthy(),
    shards,
  };
}

function getPeerList(excludeShardId) {
  return Array.from(shardRegistry.values())
    .filter(s => s.shardId !== excludeShardId && s.status === 'running')
    .map(s => ({
      shardId: s.shardId,
      url: s.url,
      nodeType: s.nodeType,
      status: s.status,
      load: s.load,
    }));
}

// ============ HTTP Handler (embeddable in JARVIS HTTP server) ============

export function handleRouterRequest(req, url) {
  const path = url.pathname.replace('/router', '');

  // POST /register
  if (path === '/register' && req.method === 'POST') {
    return { handler: 'register', parse: true };
  }
  // POST /heartbeat
  if (path === '/heartbeat' && req.method === 'POST') {
    return { handler: 'heartbeat', parse: true };
  }
  // GET /route/:userId
  if (path.startsWith('/route/') && req.method === 'GET') {
    const userId = path.replace('/route/', '');
    return { handler: 'route', data: routeUser(userId) };
  }
  // POST /assign/:userId
  if (path.startsWith('/assign/') && req.method === 'POST') {
    return { handler: 'assign', parse: true, userId: path.replace('/assign/', '') };
  }
  // POST /failover/:shardId
  if (path.startsWith('/failover/') && req.method === 'POST') {
    const shardId = path.replace('/failover/', '');
    return { handler: 'failover', data: failoverShard(shardId) };
  }
  // GET /topology
  if (path === '/topology' && req.method === 'GET') {
    return { handler: 'topology', data: getTopology() };
  }
  // GET /archives
  if (path === '/archives' && req.method === 'GET') {
    return { handler: 'archives', data: getArchiveStatus() };
  }
  // GET /health
  if (path === '/health' && req.method === 'GET') {
    return { handler: 'health', data: isNetworkHealthy() };
  }

  return null;
}

// Process parsed body for POST handlers
export function processRouterBody(handler, body, userId) {
  switch (handler) {
    case 'register':
      return registerShard(body);
    case 'heartbeat':
      return receiveHeartbeat(body);
    case 'assign':
      return assignUserToShard(userId, body.shardId);
    default:
      return { error: 'Unknown handler' };
  }
}

// ============ Exports ============

export { NODE_TYPES };
