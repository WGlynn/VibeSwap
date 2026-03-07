// ============ MI Host SDK — Cell Lifecycle Runtime ============
// Loads MI manifests, manages cell lifecycle (sense/choose/act/learn/commit),
// routes signals between cells, bridges to existing Jarvis tool system.
//
// This is the runtime that makes manifests executable.
//
// Architecture:
//   Manifest (JSON) → Host SDK → Cell Instance → Signal Bus → Other Cells
//                                    ↕
//                              Tool System (claude.js)
//
// Usage:
//   import { initMIHost, emitSignal, getCellStats } from './mi-host.js';
//   await initMIHost('/path/to/cells/');
//   await emitSignal('price.request', { symbol: 'ETH' });
// ============

import {
  loadManifestDir,
  registerCell,
  unregisterCell,
  matchSignal,
  matchCapability,
  queryCells,
  getRegistryStats,
  getCell,
  listCells
} from './mi-manifest.js';

// ============ Constants ============
const DEFAULT_CELLS_DIR = './cells';
const MAX_SIGNAL_QUEUE = 1000;
const SIGNAL_PROCESS_INTERVAL_MS = 100;
const TELEMETRY_FLUSH_INTERVAL_MS = 30000;
const LIFECYCLE_CHECK_INTERVAL_MS = 60000;

// ============ State ============

// Active cell instances (id → CellInstance)
const cells = new Map();

// Signal queue (FIFO)
const signalQueue = [];

// Signal handlers (signal name → Set<handler fn>)
const signalHandlers = new Map();

// Global telemetry accumulator
const telemetry = {
  signalsEmitted: 0,
  signalsProcessed: 0,
  signalsDropped: 0,
  cellsActive: 0,
  identityChanges: 0,
  errors: 0
};

// Intervals
let signalInterval = null;
let telemetryInterval = null;
let lifecycleInterval = null;

// ============ Cell Instance ============

/**
 * A running cell instance — wraps a manifest with runtime state.
 */
class CellInstance {
  constructor(manifest) {
    this.manifest = manifest;
    this.id = manifest.id;
    this.identity = null; // Chosen identity (from candidates)
    this.state = 'undifferentiated'; // undifferentiated → sensing → choosing → active → reconsidering
    this.confidence = 0;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.commitUntil = 0; // Timestamp: don't reconsider before this
    this.invocations = 0;
    this.errors = 0;
    this.metrics = {};

    // Strategy weights (for contextual bandit)
    this.strategyWeights = {};
    if (manifest.lifecycle?.candidates) {
      for (const candidate of manifest.lifecycle.candidates) {
        this.strategyWeights[candidate.identity] = 1.0 / manifest.lifecycle.candidates.length;
      }
    }

    // Capability handlers (capability name → handler fn)
    this.handlers = new Map();
  }

  /**
   * Sense: gather environmental signals.
   */
  sense(context) {
    this.state = 'sensing';
    this.lastActivity = Date.now();

    const features = {
      neighborCount: cells.size - 1,
      neighborCapabilities: [],
      hostDomain: context?.domain || 'jarvis',
      signalsPending: signalQueue.length,
      uptime: Date.now() - this.createdAt,
      errorRate: this.invocations > 0 ? this.errors / this.invocations : 0
    };

    // Collect neighbor capabilities
    for (const [id, cell] of cells) {
      if (id !== this.id && cell.state === 'active') {
        for (const cap of cell.manifest.capabilities || []) {
          features.neighborCapabilities.push(cap.name);
        }
      }
    }

    return features;
  }

  /**
   * Choose: select identity from candidates based on features.
   */
  choose(features) {
    this.state = 'choosing';
    const candidates = this.manifest.lifecycle?.candidates || [];
    if (candidates.length === 0) {
      this.identity = 'default';
      this.confidence = 1.0;
      return this.identity;
    }

    // Evaluate conditions (simple pattern matching)
    const eligible = candidates.filter(c => evaluateCondition(c.condition, features, this));

    if (eligible.length === 0) {
      // Fallback to lowest priority (highest number)
      const fallback = candidates.sort((a, b) => b.priority - a.priority)[0];
      this.identity = fallback.identity;
      this.confidence = 0.3;
    } else {
      // Weighted selection using strategy weights
      const strategy = this.manifest.lifecycle?.learn?.strategy || 'fixed';
      if (strategy === 'contextual_bandit') {
        this.identity = banditSelect(eligible, this.strategyWeights);
        this.confidence = this.strategyWeights[this.identity] || 0.5;
      } else {
        // Fixed: pick highest priority (lowest number)
        const best = eligible.sort((a, b) => a.priority - b.priority)[0];
        this.identity = best.identity;
        this.confidence = 1.0;
      }
    }

    return this.identity;
  }

  /**
   * Act: transition to active state, announce identity.
   */
  act() {
    const previousIdentity = this.state === 'active' ? this.identity : null;
    this.state = 'active';
    this.lastActivity = Date.now();

    // Set commit dwell time
    const dwellMs = this.manifest.lifecycle?.commit?.min_dwell_ms || 60000;
    this.commitUntil = Date.now() + dwellMs;

    // Announce identity
    if (previousIdentity !== this.identity) {
      telemetry.identityChanges++;
      emitSignalInternal('cell.identity.announce', {
        cellId: this.id,
        identity: this.identity,
        confidence: this.confidence,
        capabilities: (this.manifest.capabilities || []).map(c => c.name)
      });
    }
  }

  /**
   * Learn: update strategy weights based on reward signal.
   */
  learn(reward, rewardSignal) {
    if (!this.identity) return;
    const strategy = this.manifest.lifecycle?.learn?.strategy || 'fixed';
    if (strategy !== 'contextual_bandit') return;

    // Simple exponential moving average update
    const lr = 0.1; // Learning rate
    const currentWeight = this.strategyWeights[this.identity] || 0.5;
    this.strategyWeights[this.identity] = currentWeight + lr * (reward - currentWeight);

    // Normalize weights
    const total = Object.values(this.strategyWeights).reduce((s, w) => s + w, 0);
    if (total > 0) {
      for (const key of Object.keys(this.strategyWeights)) {
        this.strategyWeights[key] /= total;
      }
    }

    this.lastActivity = Date.now();
  }

  /**
   * Check if cell should reconsider its identity.
   */
  shouldReconsider() {
    // Still within dwell period
    if (Date.now() < this.commitUntil) return false;

    // Check reconsider triggers
    const triggers = this.manifest.lifecycle?.commit?.reconsider_on || [];
    for (const trigger of triggers) {
      if (trigger.includes('error_rate') && this.invocations > 10) {
        const threshold = parseFloat(trigger.split('>')[1]?.trim() || '0.5');
        if (this.errors / this.invocations > threshold) return true;
      }
    }

    return false;
  }

  /**
   * Invoke a capability on this cell.
   */
  async invoke(capabilityName, input) {
    this.invocations++;
    this.lastActivity = Date.now();

    const handler = this.handlers.get(capabilityName);
    if (!handler) {
      this.errors++;
      return { error: `No handler registered for capability: ${capabilityName}` };
    }

    try {
      const result = await handler(input);
      return result;
    } catch (err) {
      this.errors++;
      telemetry.errors++;
      return { error: err.message };
    }
  }

  /**
   * Get telemetry snapshot.
   */
  getTelemetry() {
    return {
      id: this.id,
      identity: this.identity,
      state: this.state,
      confidence: this.confidence,
      invocations: this.invocations,
      errors: this.errors,
      errorRate: this.invocations > 0 ? (this.errors / this.invocations).toFixed(3) : '0.000',
      uptime: Date.now() - this.createdAt,
      lastActivity: Date.now() - this.lastActivity,
      strategyWeights: { ...this.strategyWeights },
      metrics: { ...this.metrics }
    };
  }
}

// ============ Condition Evaluator ============

/**
 * Evaluate a simple condition string against features.
 * Supports: "true", "has_api_key", "network.outbound", "neighbor.has(X)"
 */
function evaluateCondition(condition, features, cell) {
  if (!condition || condition === 'true') return true;

  const cond = condition.toLowerCase().trim();

  if (cond === 'has_api_key') {
    // Check if any API keys are available
    return !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY ||
              process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY);
  }

  if (cond === 'network.outbound') {
    return true; // Assume network available in normal runtime
  }

  if (cond.startsWith('neighbor.has(') && cond.endsWith(')')) {
    const capName = cond.slice(13, -1);
    return features.neighborCapabilities?.includes(capName) || false;
  }

  // Default: treat as truthy
  return true;
}

// ============ Bandit Selection ============

/**
 * Thompson-sampling-inspired selection: use weights as probabilities.
 */
function banditSelect(candidates, weights) {
  // Epsilon-greedy with exploration
  const epsilon = 0.1;
  if (Math.random() < epsilon) {
    // Explore: random candidate
    return candidates[Math.floor(Math.random() * candidates.length)].identity;
  }

  // Exploit: weighted selection
  let totalWeight = 0;
  for (const c of candidates) {
    totalWeight += weights[c.identity] || (1.0 / candidates.length);
  }

  let roll = Math.random() * totalWeight;
  for (const c of candidates) {
    roll -= weights[c.identity] || (1.0 / candidates.length);
    if (roll <= 0) return c.identity;
  }

  return candidates[0].identity;
}

// ============ Signal Bus ============

/**
 * Emit a signal to all subscribed cells.
 */
export function emitSignal(name, payload = {}) {
  return emitSignalInternal(name, payload);
}

function emitSignalInternal(name, payload) {
  if (signalQueue.length >= MAX_SIGNAL_QUEUE) {
    telemetry.signalsDropped++;
    return false;
  }

  signalQueue.push({
    name,
    payload,
    timestamp: Date.now(),
    source: payload?.cellId || 'host'
  });

  telemetry.signalsEmitted++;
  return true;
}

/**
 * Register a custom signal handler (for host-level integration).
 */
export function onSignal(name, handler) {
  if (!signalHandlers.has(name)) {
    signalHandlers.set(name, new Set());
  }
  signalHandlers.get(name).add(handler);
}

/**
 * Process pending signals (called on interval).
 */
function processSignals() {
  const batch = signalQueue.splice(0, 50); // Process 50 at a time

  for (const signal of batch) {
    telemetry.signalsProcessed++;

    // Deliver to subscribed cells
    const subscribers = matchSignal(signal.name);
    for (const manifest of subscribers) {
      const cell = cells.get(manifest.id);
      if (cell && cell.state === 'active') {
        // Cell receives signal — could trigger capability invocation
        cell.lastActivity = Date.now();
      }
    }

    // Deliver to host handlers
    const handlers = signalHandlers.get(signal.name);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(signal);
        } catch (err) {
          console.warn(`[mi-host] Signal handler error for ${signal.name}: ${err.message}`);
          telemetry.errors++;
        }
      }
    }
  }
}

// ============ Lifecycle Manager ============

/**
 * Run lifecycle check on all cells (called on interval).
 */
function lifecycleCheck() {
  for (const [id, cell] of cells) {
    // Skip cells still in dwell period
    if (cell.state === 'active' && cell.shouldReconsider()) {
      console.log(`[mi-host] Cell ${id} reconsidering identity (was: ${cell.identity})`);
      const features = cell.sense({});
      cell.choose(features);
      cell.act();
    }
  }

  telemetry.cellsActive = [...cells.values()].filter(c => c.state === 'active').length;
}

// ============ Initialization ============

/**
 * Initialize the MI Host SDK. Loads manifests, starts signal processing.
 */
export async function initMIHost(cellsDir = DEFAULT_CELLS_DIR) {
  console.log('[mi-host] Initializing MI Host SDK...');

  // Load manifests
  const manifests = loadManifestDir(cellsDir);
  console.log(`[mi-host] Loaded ${manifests.length} manifest(s) from ${cellsDir}`);

  // Register and instantiate cells
  for (const manifest of manifests) {
    registerCell(manifest);
    const instance = new CellInstance(manifest);

    // Run initial lifecycle: sense → choose → act
    const features = instance.sense({});
    instance.choose(features);
    instance.act();

    cells.set(manifest.id, instance);
    console.log(`[mi-host]   ${manifest.id} → identity: ${instance.identity} (${manifest.kind})`);
  }

  // Start signal processing loop
  signalInterval = setInterval(processSignals, SIGNAL_PROCESS_INTERVAL_MS);

  // Start lifecycle check loop
  lifecycleInterval = setInterval(lifecycleCheck, LIFECYCLE_CHECK_INTERVAL_MS);

  // Start telemetry flush loop
  telemetryInterval = setInterval(() => {
    const stats = getRegistryStats();
    telemetry.cellsActive = [...cells.values()].filter(c => c.state === 'active').length;
  }, TELEMETRY_FLUSH_INTERVAL_MS);

  console.log(`[mi-host] Host SDK initialized. ${cells.size} cells active.`);
  return { cellCount: cells.size, manifests: manifests.length };
}

/**
 * Shutdown the MI Host SDK.
 */
export function shutdownMIHost() {
  if (signalInterval) clearInterval(signalInterval);
  if (lifecycleInterval) clearInterval(lifecycleInterval);
  if (telemetryInterval) clearInterval(telemetryInterval);

  // Emit death signals
  for (const [id, cell] of cells) {
    emitSignalInternal('cell.death', { cellId: id, identity: cell.identity });
  }

  cells.clear();
  signalQueue.length = 0;
  console.log('[mi-host] Host SDK shutdown.');
}

// ============ Cell Management ============

/**
 * Register a capability handler for a cell.
 * This bridges MI cells to actual implementation functions.
 */
export function registerHandler(cellId, capabilityName, handler) {
  const cell = cells.get(cellId);
  if (!cell) return false;
  cell.handlers.set(capabilityName, handler);
  return true;
}

/**
 * Invoke a capability on the best matching cell.
 */
export async function invokeCapability(capabilityName, input = {}) {
  const matches = matchCapability(capabilityName);
  if (matches.length === 0) {
    return { error: `No cell provides capability: ${capabilityName}` };
  }

  // Pick the best cell (active, lowest error rate, highest confidence)
  let bestCell = null;
  let bestScore = -1;

  for (const manifest of matches) {
    const cell = cells.get(manifest.id);
    if (!cell || cell.state !== 'active') continue;

    const errorPenalty = cell.invocations > 0 ? cell.errors / cell.invocations : 0;
    const score = cell.confidence * (1 - errorPenalty);

    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }

  if (!bestCell) {
    return { error: `No active cell provides capability: ${capabilityName}` };
  }

  return bestCell.invoke(capabilityName, input);
}

/**
 * Send a reward signal to a cell (for learning).
 */
export function rewardCell(cellId, reward, rewardSignal = 'generic') {
  const cell = cells.get(cellId);
  if (!cell) return false;
  cell.learn(reward, rewardSignal);
  return true;
}

// ============ Bridge to Tool System ============

/**
 * Generate Claude tool definitions from loaded MI manifests.
 * Returns array of tool objects compatible with claude.js allTools format.
 */
export function generateToolDefinitions() {
  const tools = [];

  for (const [id, cell] of cells) {
    for (const cap of cell.manifest.capabilities || []) {
      tools.push({
        name: `mi_${cell.id}_${cap.name}`,
        description: `[MI:${cell.manifest.kind}] ${cap.description || cap.name} (Cell: ${cell.manifest.name})`,
        input_schema: cap.input || { type: 'object', properties: {} }
      });
    }
  }

  return tools;
}

/**
 * Handle a tool call from the LLM that targets an MI cell.
 * Tool name format: mi_{cellId}_{capabilityName}
 */
export async function handleMIToolCall(toolName, input) {
  if (!toolName.startsWith('mi_')) return null;

  const parts = toolName.slice(3);
  // Find the cell by matching the prefix
  for (const [id, cell] of cells) {
    if (parts.startsWith(id + '_')) {
      const capName = parts.slice(id.length + 1);
      const result = await cell.invoke(capName, input);
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
  }

  return `MI cell not found for tool: ${toolName}`;
}

// ============ Stats & Monitoring ============

/**
 * Get comprehensive stats for monitoring.
 */
export function getCellStats() {
  const cellStats = [];
  for (const [id, cell] of cells) {
    cellStats.push(cell.getTelemetry());
  }

  return {
    host: {
      version: '0.1',
      uptime: signalInterval ? 'running' : 'stopped',
      ...telemetry
    },
    registry: getRegistryStats(),
    cells: cellStats
  };
}

/**
 * Get a human-readable status string for /mi_status command.
 */
export function getMIStatusString() {
  const stats = getCellStats();
  const lines = [
    '=== MI Host SDK Status ===',
    `Version: ${stats.host.version}`,
    `Status: ${stats.host.uptime}`,
    `Cells: ${stats.registry.cells} registered, ${stats.host.cellsActive} active`,
    `Signals: ${stats.host.signalsEmitted} emitted, ${stats.host.signalsProcessed} processed, ${stats.host.signalsDropped} dropped`,
    `Identity changes: ${stats.host.identityChanges}`,
    `Errors: ${stats.host.errors}`,
    ''
  ];

  if (stats.cells.length > 0) {
    lines.push('--- Cells ---');
    for (const cell of stats.cells) {
      lines.push(`  ${cell.id}: ${cell.state} → ${cell.identity || 'none'} (conf: ${(cell.confidence * 100).toFixed(0)}%, invocations: ${cell.invocations}, errors: ${cell.errorRate})`);
    }
  }

  return lines.join('\n');
}
