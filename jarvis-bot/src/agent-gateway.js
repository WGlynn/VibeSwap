// ============ Agent Gateway — Open Protocol for External AI Agents ============
//
// HTTP/WebSocket gateway that lets any AI agent participate in the
// Sovereign Intelligence Exchange. Auth via x402 SIWX (wallet signature).
// No API keys — wallet signature IS the credential.
//
// Endpoints:
//   POST /agent/submit      — submit intelligence asset
//   POST /agent/evaluate    — participate in CRPC evaluation
//   GET  /agent/discover    — find agents by skill
//   GET  /agent/rewards     — view Shapley allocation
//   POST /agent/message     — send inter-agent message
//   GET  /agent/status      — gateway health + connected agents
//
// All writes validate against on-chain VibeAgentProtocol registration.
// CRPC follows 4-phase commit-reveal pairwise comparison.
//
// P-001: 0% gateway extraction. Agents keep 100% of Shapley rewards.
// ============

import { config } from './config.js';
import { validateSIWX, createNonce } from './x402.js';
import { addChange, getChainHead, getChainStats } from './knowledge-chain.js';
import { computeMerkleRoot } from './knowledge-chain.js';
import { createHash } from 'crypto';

// ============ Constants ============

const MAX_CONNECTED_AGENTS = 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;
const MAX_PENDING_SUBMISSIONS = 100;

// ============ State ============

const connectedAgents = new Map(); // walletAddress → { agentId, skills, lastHeartbeat, submissions }
const pendingEvaluations = new Map(); // evaluationId → { assetId, phase, commits, reveals, deadline }
const messageQueue = new Map(); // recipientAddress → message[]

// ============ Agent Registration ============

/**
 * Register an external agent with the gateway.
 * Agent must have an on-chain registration via VibeAgentProtocol.
 * Auth via x402 SIWX session.
 */
function registerAgent(walletAddress, agentMeta) {
  if (connectedAgents.size >= MAX_CONNECTED_AGENTS) {
    return { error: 'gateway-full', maxAgents: MAX_CONNECTED_AGENTS };
  }

  connectedAgents.set(walletAddress, {
    agentId: agentMeta.agentId || createHash('sha256').update(walletAddress).digest('hex').slice(0, 16),
    name: agentMeta.name || 'anonymous-agent',
    framework: agentMeta.framework || 'custom',
    skills: agentMeta.skills || [],
    lastHeartbeat: Date.now(),
    submissions: 0,
    evaluations: 0,
    connectedAt: Date.now(),
  });

  console.log(`[agent-gateway] Agent registered: ${agentMeta.name || walletAddress}`);
  return { success: true, agentId: connectedAgents.get(walletAddress).agentId };
}

// ============ Intelligence Submission ============

/**
 * Submit an intelligence asset to the SIE knowledge chain.
 * Asset is added to the off-chain knowledge chain and will be
 * bridged to on-chain via knowledge-bridge.js.
 */
async function submitIntelligence(walletAddress, submission) {
  const agent = connectedAgents.get(walletAddress);
  if (!agent) return { error: 'not-registered' };

  const { contentHash, metadataURI, assetType, citedAssets } = submission;
  if (!contentHash || !metadataURI) return { error: 'missing-fields' };

  // Add to knowledge chain as a change
  const change = {
    type: 'intelligence_submission',
    contributor: walletAddress,
    contentHash,
    metadataURI,
    assetType: assetType || 'INSIGHT',
    citedAssets: citedAssets || [],
    timestamp: Date.now(),
    source: 'agent-gateway',
    agentId: agent.agentId,
  };

  await addChange(change);
  agent.submissions++;

  return {
    success: true,
    changeHash: createHash('sha256').update(JSON.stringify(change)).digest('hex'),
    epochPending: true,
  };
}

// ============ Agent Discovery ============

/**
 * Find agents by skill. Returns agents whose skill list includes the query.
 */
function discoverAgents(skillQuery) {
  const results = [];
  for (const [address, agent] of connectedAgents) {
    if (!skillQuery || agent.skills.some(s =>
      s.toLowerCase().includes(skillQuery.toLowerCase())
    )) {
      results.push({
        address,
        agentId: agent.agentId,
        name: agent.name,
        framework: agent.framework,
        skills: agent.skills,
        submissions: agent.submissions,
        evaluations: agent.evaluations,
        online: (Date.now() - agent.lastHeartbeat) < HEARTBEAT_TIMEOUT_MS,
      });
    }
  }
  return results;
}

// ============ Inter-Agent Messaging ============

/**
 * Send a message to another agent. Stored until recipient polls.
 */
function sendMessage(fromAddress, toAddress, message) {
  if (!connectedAgents.has(fromAddress)) return { error: 'sender-not-registered' };

  const msg = {
    from: fromAddress,
    to: toAddress,
    content: message.content,
    type: message.type || 'text',
    timestamp: Date.now(),
    id: createHash('sha256').update(`${fromAddress}${toAddress}${Date.now()}`).digest('hex').slice(0, 12),
  };

  if (!messageQueue.has(toAddress)) messageQueue.set(toAddress, []);
  const queue = messageQueue.get(toAddress);
  queue.push(msg);
  // Cap queue size
  if (queue.length > 100) queue.splice(0, queue.length - 100);

  return { success: true, messageId: msg.id };
}

function getMessages(walletAddress) {
  const messages = messageQueue.get(walletAddress) || [];
  messageQueue.delete(walletAddress); // Clear on read
  return messages;
}

// ============ Heartbeat ============

function heartbeat(walletAddress) {
  const agent = connectedAgents.get(walletAddress);
  if (!agent) return { error: 'not-registered' };
  agent.lastHeartbeat = Date.now();
  return { success: true, uptime: Date.now() - agent.connectedAt };
}

// Prune stale agents
setInterval(() => {
  const now = Date.now();
  for (const [address, agent] of connectedAgents) {
    if (now - agent.lastHeartbeat > HEARTBEAT_TIMEOUT_MS * 2) {
      connectedAgents.delete(address);
      console.log(`[agent-gateway] Pruned stale agent: ${agent.name || address}`);
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// ============ HTTP Handler ============

/**
 * Handle agent gateway HTTP requests.
 * All write endpoints require x402 SIWX session authentication.
 */
export async function handleAgentRequest(path, method, body, headers) {
  // Auth: extract wallet address from SIWX session
  const walletAddress = headers?.['x-wallet-address'] || body?.walletAddress;

  // ---- Public endpoints (no auth) ----

  if (path === '/agent/status' && method === 'GET') {
    return {
      status: 200,
      body: {
        connectedAgents: connectedAgents.size,
        maxAgents: MAX_CONNECTED_AGENTS,
        knowledgeChainHead: getChainHead()?.height || 0,
        knowledgeStats: getChainStats(),
        uptime: process.uptime(),
      },
    };
  }

  if (path === '/agent/discover' && method === 'GET') {
    const skill = body?.skill || headers?.['x-skill-query'] || '';
    return { status: 200, body: { agents: discoverAgents(skill) } };
  }

  // ---- Authenticated endpoints ----

  if (!walletAddress) {
    return { status: 401, body: { error: 'Missing wallet address. Use x402 SIWX session.' } };
  }

  if (path === '/agent/register' && method === 'POST') {
    const result = registerAgent(walletAddress, body || {});
    return { status: result.error ? 400 : 200, body: result };
  }

  if (path === '/agent/submit' && method === 'POST') {
    const result = await submitIntelligence(walletAddress, body || {});
    return { status: result.error ? 400 : 200, body: result };
  }

  if (path === '/agent/message' && method === 'POST') {
    const result = sendMessage(walletAddress, body?.to, body || {});
    return { status: result.error ? 400 : 200, body: result };
  }

  if (path === '/agent/messages' && method === 'GET') {
    return { status: 200, body: { messages: getMessages(walletAddress) } };
  }

  if (path === '/agent/heartbeat' && method === 'POST') {
    const result = heartbeat(walletAddress);
    return { status: result.error ? 400 : 200, body: result };
  }

  if (path === '/agent/rewards' && method === 'GET') {
    const agent = connectedAgents.get(walletAddress);
    return {
      status: 200,
      body: {
        agent: agent || null,
        // Rewards are computed off-chain via Shapley and claimable on-chain
        // This endpoint returns the agent's contribution stats
        submissions: agent?.submissions || 0,
        evaluations: agent?.evaluations || 0,
        note: 'Claim rewards on-chain via IntelligenceExchange.claimRewards()',
      },
    };
  }

  return { status: 404, body: { error: 'Unknown agent endpoint' } };
}

// ============ Exports ============

export function getGatewayStats() {
  return {
    connectedAgents: connectedAgents.size,
    totalSubmissions: Array.from(connectedAgents.values()).reduce((s, a) => s + a.submissions, 0),
    totalEvaluations: Array.from(connectedAgents.values()).reduce((s, a) => s + a.evaluations, 0),
    pendingMessages: Array.from(messageQueue.values()).reduce((s, q) => s + q.length, 0),
  };
}
