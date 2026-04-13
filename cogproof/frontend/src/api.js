const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => request('/health'),
  stats: () => request('/stats'),

  // Batches
  listBatches: (limit = 20) => request(`/batches?limit=${limit}`),
  getBatch: (id) => request(`/batch/${id}`),
  createBatch: (blockHash) => request('/batch/create', { method: 'POST', body: { blockHash } }),

  // Reputation
  getReputation: (userId) => request(`/reputation/${userId}`),

  // Trust
  getTrust: (userId) => request(`/trust/${userId}`),
  getTrustReport: () => request('/trust/report'),

  // Shapley
  computeShapley: (body) => request('/shapley/compute', { method: 'POST', body }),

  // Demo
  runDemo: () => request('/demo/full-pipeline', { method: 'POST' }),

  // Indexer
  getIndexer: () => request('/bitcoin/indexer'),
};
