// ============ Shard Identity & Lifecycle — Decentralized Mind Network ============
//
// Each JARVIS instance is a shard — a Mind in the network.
// This module handles:
//   - Shard identity (unique ID, capabilities, load)
//   - Registration with the router service
//   - Heartbeat liveness signals
//   - User assignment (sticky sessions)
//   - Peer discovery
//
// In single-shard mode (TOTAL_SHARDS=1), this is a no-op passthrough.
// All messages route locally. No network overhead.
//
// Multi-shard mode (TOTAL_SHARDS>1):
//   - On boot: register with router via HTTP POST
//   - Every 30s: heartbeat with load metrics
//   - Messages: check if this shard owns the user, proxy if not
//   - Failover: if heartbeat missed 3x, router reassigns users
// ============

import { config } from './config.js';

// ============ State ============

let shardInfo = null;
let peers = new Map(); // shardId -> { url, status, load, lastHeartbeat }
let userAssignments = new Map(); // userId -> shardId (local cache)
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 5000;

// ============ Init ============

export async function initShard() {
  const shardId = config.shard?.id || 'shard-0';
  const totalShards = config.shard?.totalShards || 1;
  const routerUrl = config.shard?.routerUrl || null;

  const nodeType = config.shard?.nodeType || 'full';

  shardInfo = {
    id: shardId,
    totalShards,
    nodeType,
    routerUrl,
    status: 'running',
    bootTime: new Date().toISOString(),
    load: 0,
    userCount: 0,
    capabilities: {
      model: config.anthropic?.model || 'unknown',
      encryption: config.privacy?.encryptionEnabled !== false,
      stateBackend: config.shard?.stateBackend || 'file',
      nodeType,
    },
  };

  if (totalShards <= 1) {
    console.log(`[shard] Single-shard mode (${shardId}). No network registration needed.`);
    return shardInfo;
  }

  // Multi-shard: register with router
  if (routerUrl) {
    try {
      await registerWithRouter();
      startHeartbeat();
      console.log(`[shard] Registered with router at ${routerUrl}. Shard: ${shardId}`);
    } catch (err) {
      console.warn(`[shard] Router registration failed (will retry on heartbeat): ${err.message}`);
      startHeartbeat(); // Still start heartbeat — it will retry registration
    }
  } else {
    console.warn(`[shard] Multi-shard mode but no ROUTER_URL configured. Operating standalone.`);
  }

  return shardInfo;
}

// ============ Router Communication ============

async function registerWithRouter() {
  if (!shardInfo?.routerUrl) return;

  const response = await fetch(`${shardInfo.routerUrl}/router/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shardId: shardInfo.id,
      url: getShardUrl(),
      capabilities: shardInfo.capabilities,
      load: shardInfo.load,
      userCount: shardInfo.userCount,
    }),
    signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Router registration failed: ${response.status}`);
  }

  const data = await response.json();

  // Sync peer list from router
  if (data.peers) {
    for (const peer of data.peers) {
      if (peer.shardId !== shardInfo.id) {
        peers.set(peer.shardId, peer);
      }
    }
  }

  // Sync user assignments
  if (data.assignments) {
    for (const [userId, shard] of Object.entries(data.assignments)) {
      userAssignments.set(userId, shard);
    }
  }
}

export async function sendHeartbeat() {
  if (!shardInfo?.routerUrl) return;

  try {
    const response = await fetch(`${shardInfo.routerUrl}/router/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shardId: shardInfo.id,
        status: shardInfo.status,
        load: shardInfo.load,
        userCount: shardInfo.userCount,
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
      }),
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[shard] Heartbeat failed: ${response.status}`);
      return false;
    }

    const data = await response.json();

    // Router may send topology updates with heartbeat response
    if (data.peers) {
      for (const peer of data.peers) {
        if (peer.shardId !== shardInfo.id) {
          peers.set(peer.shardId, peer);
        }
      }
    }

    return true;
  } catch (err) {
    console.warn(`[shard] Heartbeat error: ${err.message}`);
    return false;
  }
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// ============ User Assignment ============

export function assignUser(userId) {
  const id = String(userId);
  userAssignments.set(id, shardInfo.id);
  shardInfo.userCount++;
  return shardInfo.id;
}

export function relinquishUser(userId) {
  const id = String(userId);
  if (userAssignments.get(id) === shardInfo.id) {
    userAssignments.delete(id);
    shardInfo.userCount = Math.max(0, shardInfo.userCount - 1);
    return true;
  }
  return false;
}

export function isUserLocal(userId) {
  const id = String(userId);
  // Single shard mode — everything is local
  if (shardInfo?.totalShards <= 1) return true;
  // Check assignment
  const assigned = userAssignments.get(id);
  return !assigned || assigned === shardInfo?.id;
}

export async function routeUser(userId) {
  const id = String(userId);

  // Single shard — always local
  if (shardInfo?.totalShards <= 1) return { local: true, shardId: shardInfo?.id };

  // Check local assignment cache
  const assigned = userAssignments.get(id);
  if (assigned === shardInfo?.id) return { local: true, shardId: shardInfo?.id };
  if (assigned) {
    const peer = peers.get(assigned);
    if (peer && peer.status === 'running') {
      return { local: false, shardId: assigned, url: peer.url };
    }
    // Assigned shard is down — claim locally (failover)
    userAssignments.set(id, shardInfo.id);
    return { local: true, shardId: shardInfo?.id, failover: true };
  }

  // No assignment — claim for this shard
  assignUser(userId);
  return { local: true, shardId: shardInfo?.id, newAssignment: true };
}

// ============ Peer Discovery ============

export function getShardPeers() {
  return Array.from(peers.entries()).map(([id, info]) => ({
    shardId: id,
    ...info,
  }));
}

// ============ Info ============

export function getShardInfo() {
  return {
    ...shardInfo,
    peers: peers.size,
    localUsers: userAssignments.size,
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
}

export function updateShardLoad(load) {
  if (shardInfo) shardInfo.load = load;
}

export function updateUserCount(count) {
  if (shardInfo) shardInfo.userCount = count;
}

function getShardUrl() {
  // In Fly.io, each instance has a unique .internal hostname
  // Format: <app-name>.internal or <instance-id>.vm.<app-name>.internal
  const flyAppName = process.env.FLY_APP_NAME;
  const flyMachineId = process.env.FLY_MACHINE_ID;
  const healthPort = process.env.HEALTH_PORT || '8080';

  if (flyAppName && flyMachineId) {
    return `http://${flyMachineId}.vm.${flyAppName}.internal:${healthPort}`;
  }
  // Local development fallback
  return `http://localhost:${healthPort}`;
}

// ============ Shutdown ============

export async function shutdownShard() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (shardInfo) {
    shardInfo.status = 'stopped';
    // Send final heartbeat to inform router
    await sendHeartbeat().catch(() => {});
  }
}

// ============ Is Multi-Shard ============

export function isMultiShard() {
  return (shardInfo?.totalShards || 1) > 1;
}
