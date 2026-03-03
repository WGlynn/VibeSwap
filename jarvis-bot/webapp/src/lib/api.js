// ============ API Client — /web/mining/* and /router/* ============

const BASE = window.location.origin;

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res.json();
}

// ============ Mining API ============

export async function fetchMiningTarget() {
  return request('/web/mining/target');
}

export async function submitMiningProof(userId, nonce, hash, challenge, initData) {
  return request('/web/mining/submit', {
    method: 'POST',
    body: JSON.stringify({ userId, nonce, hash, challenge, initData }),
  });
}

export async function fetchMiningStats(userId) {
  return request(`/web/mining/stats/${encodeURIComponent(userId)}`);
}

// ============ Router API ============

export async function registerShard(shardId, nodeType, capabilities) {
  return request('/router/register', {
    method: 'POST',
    body: JSON.stringify({
      shardId,
      url: null, // Mobile shard — contributor only, not a handler
      nodeType: nodeType || 'light',
      capabilities: capabilities || { mining: true, mobile: true },
    }),
  });
}

export async function sendHeartbeat(shardId, metrics) {
  return request('/router/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ shardId, ...metrics }),
  });
}

export async function fetchTopology() {
  return request('/router/topology');
}

// ============ Health ============

export async function fetchHealth() {
  return request('/web/health');
}
