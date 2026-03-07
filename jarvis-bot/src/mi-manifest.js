// ============ MI Manifest — Micro-Interface Cell Manifests ============
// Loads, validates, and queries MI manifests for code cell management.
// Part of the Freedom × Jarvis MI architecture.
//
// Usage:
//   import { loadManifest, validateManifest, matchCapability } from './mi-manifest.js';
//   const cell = loadManifest('./cells/price-feed.mi.json');
//   const matches = matchCapability(registry, 'getPrice');
// ============

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';

const MI_VERSION = '0.1';
const REQUIRED_FIELDS = ['mi', 'id', 'name', 'kind', 'capabilities'];
const VALID_KINDS = ['ui', 'service', 'orchestrator', 'proxy', 'sensor'];
const VALID_STRATEGIES = ['contextual_bandit', 'nca', 'evolutionary', 'fixed'];
const VALID_SURFACES = ['telegram', 'web', 'api', 'cli', 'ar', 'mobile'];
const VALID_SANDBOXES = ['worker', 'iframe', 'process', 'wasm'];

// ============ In-Memory Registry ============
const registry = new Map(); // id → manifest
const capabilityIndex = new Map(); // capability name → Set<cell id>
const signalIndex = new Map(); // signal name → Set<cell id> (subscribers)

// ============ Validation ============

/**
 * Validate an MI manifest object. Returns { valid, errors }.
 */
export function validateManifest(manifest) {
  const errors = [];

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Version check
  if (manifest.mi && manifest.mi !== MI_VERSION) {
    errors.push(`Unsupported MI version: ${manifest.mi} (expected ${MI_VERSION})`);
  }

  // Kind check
  if (manifest.kind && !VALID_KINDS.includes(manifest.kind)) {
    errors.push(`Invalid kind: ${manifest.kind} (expected one of: ${VALID_KINDS.join(', ')})`);
  }

  // Capabilities must be array with at least one entry
  if (manifest.capabilities) {
    if (!Array.isArray(manifest.capabilities)) {
      errors.push('capabilities must be an array');
    } else {
      for (let i = 0; i < manifest.capabilities.length; i++) {
        const cap = manifest.capabilities[i];
        if (!cap.name) errors.push(`capabilities[${i}] missing name`);
      }
    }
  }

  // Signals validation
  if (manifest.signals) {
    if (manifest.signals.subscribe && !Array.isArray(manifest.signals.subscribe)) {
      errors.push('signals.subscribe must be an array');
    }
    if (manifest.signals.emit && !Array.isArray(manifest.signals.emit)) {
      errors.push('signals.emit must be an array');
    }
  }

  // Lifecycle validation
  if (manifest.lifecycle) {
    const lc = manifest.lifecycle;
    if (lc.candidates && !Array.isArray(lc.candidates)) {
      errors.push('lifecycle.candidates must be an array');
    }
    if (lc.learn?.strategy && !VALID_STRATEGIES.includes(lc.learn.strategy)) {
      errors.push(`Invalid learn strategy: ${lc.learn.strategy}`);
    }
    if (lc.commit?.min_dwell_ms && typeof lc.commit.min_dwell_ms !== 'number') {
      errors.push('lifecycle.commit.min_dwell_ms must be a number');
    }
  }

  // Runtime validation
  if (manifest.runtime) {
    if (manifest.runtime.sandbox && !VALID_SANDBOXES.includes(manifest.runtime.sandbox)) {
      errors.push(`Invalid sandbox: ${manifest.runtime.sandbox}`);
    }
  }

  // Surfaces validation
  if (manifest.surfaces) {
    if (!Array.isArray(manifest.surfaces)) {
      errors.push('surfaces must be an array');
    } else {
      for (const s of manifest.surfaces) {
        if (!VALID_SURFACES.includes(s)) {
          errors.push(`Invalid surface: ${s}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Loading ============

/**
 * Load a single manifest from a JSON file.
 */
export function loadManifest(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const manifest = JSON.parse(raw);
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest ${filePath}: ${validation.errors.join('; ')}`);
  }
  // Compute content hash for dedup
  manifest._hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  manifest._source = filePath;
  return manifest;
}

/**
 * Load all manifests from a directory (*.mi.json files).
 */
export function loadManifestDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter(f => f.endsWith('.mi.json'));
  const manifests = [];
  for (const file of files) {
    try {
      manifests.push(loadManifest(join(dirPath, file)));
    } catch (err) {
      console.warn(`[mi-manifest] Failed to load ${file}: ${err.message}`);
    }
  }
  return manifests;
}

// ============ Registry ============

/**
 * Register a manifest in the in-memory registry.
 */
export function registerCell(manifest) {
  registry.set(manifest.id, manifest);

  // Index capabilities
  if (manifest.capabilities) {
    for (const cap of manifest.capabilities) {
      if (!capabilityIndex.has(cap.name)) {
        capabilityIndex.set(cap.name, new Set());
      }
      capabilityIndex.get(cap.name).add(manifest.id);
    }
  }

  // Index signal subscriptions
  if (manifest.signals?.subscribe) {
    for (const signal of manifest.signals.subscribe) {
      if (!signalIndex.has(signal)) {
        signalIndex.set(signal, new Set());
      }
      signalIndex.get(signal).add(manifest.id);
    }
  }

  return manifest;
}

/**
 * Unregister a cell from the registry.
 */
export function unregisterCell(cellId) {
  const manifest = registry.get(cellId);
  if (!manifest) return false;

  // Remove from capability index
  if (manifest.capabilities) {
    for (const cap of manifest.capabilities) {
      capabilityIndex.get(cap.name)?.delete(cellId);
    }
  }

  // Remove from signal index
  if (manifest.signals?.subscribe) {
    for (const signal of manifest.signals.subscribe) {
      signalIndex.get(signal)?.delete(cellId);
    }
  }

  registry.delete(cellId);
  return true;
}

// ============ Discovery ============

/**
 * Find cells that provide a specific capability.
 */
export function matchCapability(capabilityName) {
  const ids = capabilityIndex.get(capabilityName);
  if (!ids || ids.size === 0) return [];
  return [...ids].map(id => registry.get(id)).filter(Boolean);
}

/**
 * Find cells subscribed to a specific signal.
 */
export function matchSignal(signalName) {
  const ids = signalIndex.get(signalName);
  if (!ids || ids.size === 0) return [];
  return [...ids].map(id => registry.get(id)).filter(Boolean);
}

/**
 * Find cells matching a query (kind, domain, tags, surface).
 */
export function queryCells({ kind, domain, tags, surface } = {}) {
  let results = [...registry.values()];

  if (kind) results = results.filter(m => m.kind === kind);
  if (domain) results = results.filter(m => m.domain === domain);
  if (surface) results = results.filter(m => m.surfaces?.includes(surface));
  if (tags && tags.length > 0) {
    results = results.filter(m =>
      m.tags && tags.some(t => m.tags.includes(t))
    );
  }

  return results;
}

/**
 * Get registry stats.
 */
export function getRegistryStats() {
  return {
    cells: registry.size,
    capabilities: capabilityIndex.size,
    signals: signalIndex.size,
    byKind: [...registry.values()].reduce((acc, m) => {
      acc[m.kind] = (acc[m.kind] || 0) + 1;
      return acc;
    }, {}),
    byDomain: [...registry.values()].reduce((acc, m) => {
      if (m.domain) acc[m.domain] = (acc[m.domain] || 0) + 1;
      return acc;
    }, {})
  };
}

/**
 * Get a cell by ID.
 */
export function getCell(cellId) {
  return registry.get(cellId) || null;
}

/**
 * List all registered cell IDs.
 */
export function listCells() {
  return [...registry.keys()];
}

// ============ Manifest Generation ============

/**
 * Generate a manifest skeleton from a natural language description.
 * Returns a template that can be refined by an LLM or human.
 */
export function generateSkeleton(id, name, kind, capabilities = []) {
  return {
    mi: MI_VERSION,
    id,
    name,
    version: '1.0.0',
    author: 'jarvis',
    kind,
    domain: '',
    tags: [],
    capabilities: capabilities.map(c => ({
      name: c,
      description: '',
      input: { type: 'object', properties: {} },
      output: { type: 'object', properties: {} }
    })),
    signals: {
      subscribe: [],
      emit: ['cell.identity.announce']
    },
    requires: {
      capabilities: [],
      permissions: [],
      neighbors: []
    },
    lifecycle: {
      sense: { signals: [], context: [] },
      candidates: [
        { identity: 'default', condition: 'true', priority: 1 }
      ],
      commit: { min_dwell_ms: 60000, reconsider_on: [] },
      learn: { strategy: 'fixed', reward_signals: [], update_interval_ms: 300000 }
    },
    runtime: {
      sandbox: 'worker',
      memory_limit_mb: 64,
      cpu_budget_ms: 1000,
      ttl_ms: 0,
      energy_budget: 100
    },
    telemetry: {
      emit_interval_ms: 30000,
      metrics: ['invocations', 'latency_p50', 'error_rate']
    },
    surfaces: ['telegram', 'web', 'api']
  };
}
