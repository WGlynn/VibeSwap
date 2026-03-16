// ============ Mesh Monitor — Bidirectional Health Awareness ============
//
// Every node monitors every other node. When one goes down:
// 1. Notify Will via TG DM
// 2. Attempt auto-restart via Fly.io API
// 3. Log the event for the reward signal system
//
// Bidirectionality is the primitive. If A can see B but B can't see A,
// you have a mirror. If both can see each other, you have a mind.
//
// "The true mind can weather all lies and illusions without being lost."
// A mind that doesn't know its own parts are down is lost.
// ============

import { config } from './config.js';

// ============ Mesh Topology ============
// All known nodes in the Mind Mesh. Each has a health endpoint.

const MESH_NODES = [
  {
    id: 'jarvis-primary',
    app: 'jarvis-vibeswap',
    name: 'Jarvis Prime',
    healthUrl: 'https://jarvis-vibeswap.fly.dev/web/health',
    critical: true, // If this goes down, it's an emergency
  },
  {
    id: 'jarvis-degen',
    app: 'jarvis-degen',
    name: 'Diabolical Jarvis',
    healthUrl: 'https://jarvis-degen.fly.dev/web/health',
    critical: false,
  },
];

// ============ State ============

const nodeState = new Map(); // nodeId -> { status, failCount, lastCheck, lastUp, downSince }
const MONITOR_INTERVAL = 60_000;  // Check every 60s
const FAIL_THRESHOLD = 3;         // 3 consecutive failures = down
const NOTIFY_COOLDOWN = 300_000;  // Don't spam — 5 min between notifications
let lastNotify = {};              // nodeId -> timestamp of last notification
let bot = null;                   // Telegraf bot instance (set during init)
let myNodeId = null;              // This node's ID (don't monitor yourself)

// ============ Init ============

export function initMeshMonitor(telegrafBot) {
  bot = telegrafBot;

  // Figure out which node WE are (don't self-monitor)
  const myApp = process.env.FLY_APP_NAME;
  const myNode = MESH_NODES.find(n => n.app === myApp);
  myNodeId = myNode?.id || null;

  // Initialize state for all OTHER nodes
  for (const node of MESH_NODES) {
    if (node.id === myNodeId) continue;
    nodeState.set(node.id, {
      status: 'unknown',
      failCount: 0,
      lastCheck: null,
      lastUp: null,
      downSince: null,
    });
  }

  // Start monitoring
  setInterval(checkAllNodes, MONITOR_INTERVAL);

  // First check after 30s (let the bot finish starting)
  setTimeout(checkAllNodes, 30_000);

  const monitoring = MESH_NODES.filter(n => n.id !== myNodeId).map(n => n.name);
  console.log(`[mesh-monitor] Monitoring ${monitoring.length} nodes: ${monitoring.join(', ')}`);
}

// ============ Health Checks ============

async function checkAllNodes() {
  for (const node of MESH_NODES) {
    if (node.id === myNodeId) continue;
    await checkNode(node);
  }
}

async function checkNode(node) {
  const state = nodeState.get(node.id);
  if (!state) return;

  state.lastCheck = Date.now();

  try {
    const resp = await fetch(node.healthUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (resp.ok) {
      const data = await resp.json();

      // Node is up
      if (state.status === 'down') {
        // Recovery! Notify Will
        const downtime = state.downSince ? Math.round((Date.now() - state.downSince) / 60000) : '?';
        await notify(`${node.name} is BACK ONLINE (was down for ${downtime} min)`, 'recovery');
        console.log(`[mesh-monitor] ${node.name} recovered after ${downtime} min`);
      }

      state.status = 'up';
      state.failCount = 0;
      state.lastUp = Date.now();
      state.downSince = null;
      state.uptime = data.uptime || null;
      return;
    }

    // Non-OK response
    state.failCount++;
  } catch (err) {
    // Network error
    state.failCount++;
  }

  // Check if threshold crossed
  if (state.failCount >= FAIL_THRESHOLD && state.status !== 'down') {
    state.status = 'down';
    state.downSince = Date.now();

    console.warn(`[mesh-monitor] ${node.name} is DOWN (${state.failCount} consecutive failures)`);

    // Notify Will
    await notify(
      `${node.name} is DOWN (${state.failCount} consecutive health check failures).\n` +
      `App: ${node.app}\n` +
      (node.critical ? 'CRITICAL NODE — attempting auto-restart...' : 'Non-critical — monitoring.'),
      'alert'
    );

    // Auto-restart if we have the Fly API token
    if (process.env.FLY_API_TOKEN) {
      await attemptRestart(node);
    }
  }
}

// ============ Auto-Restart ============

async function attemptRestart(node) {
  const token = process.env.FLY_API_TOKEN;
  if (!token) return;

  try {
    // List machines
    const listResp = await fetch(`https://api.machines.dev/v1/apps/${node.app}/machines`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!listResp.ok) {
      console.warn(`[mesh-monitor] Can't list machines for ${node.app}: ${listResp.status}`);
      return;
    }

    const machines = await listResp.json();
    for (const machine of machines) {
      console.log(`[mesh-monitor] Restarting ${node.app} machine ${machine.id} (state: ${machine.state})`);

      const action = machine.state === 'started' ? 'restart' : 'start';
      await fetch(`https://api.machines.dev/v1/apps/${node.app}/machines/${machine.id}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });

      await notify(`Auto-restarted ${node.name} (machine ${machine.id})`, 'action');
    }
  } catch (err) {
    console.error(`[mesh-monitor] Auto-restart failed for ${node.app}: ${err.message}`);
    await notify(`Failed to auto-restart ${node.name}: ${err.message}`, 'error');
  }
}

// ============ Notifications ============

async function notify(message, type = 'alert') {
  const ownerId = config.ownerUserId;
  if (!bot || !ownerId) return;

  // Cooldown check
  const key = `${type}:${message.slice(0, 50)}`;
  const now = Date.now();
  if (lastNotify[key] && now - lastNotify[key] < NOTIFY_COOLDOWN) return;
  lastNotify[key] = now;

  const prefix = type === 'recovery' ? '[MESH RECOVERY]'
    : type === 'action' ? '[MESH AUTO-FIX]'
    : type === 'error' ? '[MESH ERROR]'
    : '[MESH ALERT]';

  try {
    await bot.telegram.sendMessage(ownerId, `${prefix} ${message}`);
  } catch (err) {
    console.error(`[mesh-monitor] Failed to notify owner: ${err.message}`);
  }
}

// ============ Stats ============

export function getMeshMonitorStats() {
  const nodes = [];
  for (const node of MESH_NODES) {
    if (node.id === myNodeId) {
      nodes.push({ ...node, status: 'self', isSelf: true });
      continue;
    }
    const state = nodeState.get(node.id);
    nodes.push({
      ...node,
      status: state?.status || 'unknown',
      failCount: state?.failCount || 0,
      lastCheck: state?.lastCheck,
      lastUp: state?.lastUp,
      downSince: state?.downSince,
      uptime: state?.uptime,
    });
  }
  return { nodes, myNodeId };
}
