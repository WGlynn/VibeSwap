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
  loadManifest,
  registerCell,
  unregisterCell,
  matchSignal,
  matchCapability,
  queryCells,
  getRegistryStats,
  getCell,
  listCells
} from './mi-manifest.js';
import { StigmergyBoard } from './mi-bandit.js';
import { config } from './config.js';
import { watch, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';

// ============ Constants (from config with fallbacks) ============
const miConfig = config.mi || {};
const DEFAULT_CELLS_DIR = miConfig.cellsDir || './cells';
const MI_STATE_FILE = miConfig.stateFile || './data/mi-state.json';
const MAX_SIGNAL_QUEUE = miConfig.maxSignalQueue || 1000;
const SIGNAL_PROCESS_INTERVAL_MS = miConfig.signalProcessIntervalMs || 100;
const TELEMETRY_FLUSH_INTERVAL_MS = 30000;
const STATE_PERSIST_INTERVAL_MS = miConfig.persistIntervalMs || 300000;
const HOT_RELOAD_DEBOUNCE_MS = miConfig.hotReloadDebounceMs || 2000;
const LIFECYCLE_CHECK_INTERVAL_MS = miConfig.lifecycleCheckIntervalMs || 60000;
const HANDLER_TIMEOUT_MS = parseInt(process.env.MI_HANDLER_TIMEOUT || '10000');

// ============ State ============

// Active cell instances (id → CellInstance)
const cells = new Map();

// Signal queue (FIFO)
const signalQueue = [];

// Signal handlers (signal name → Set<handler fn>)
const signalHandlers = new Map();

// Per-handler error tracking for auto-disable (handler → { errors, disabled, lastError })
const handlerHealth = new WeakMap();
const HANDLER_ERROR_THRESHOLD = 5;  // Disable after 5 consecutive errors
const HANDLER_RECOVERY_MS = 60000;  // Re-enable after 60s

// Global pheromone board for stigmergic coordination
const pheromoneBoard = new StigmergyBoard({ defaultTTL: 300000, maxEntries: 500 });

// Global telemetry accumulator
const telemetry = {
  signalsEmitted: 0,
  signalsProcessed: 0,
  signalsDropped: 0,
  cellsActive: 0,
  identityChanges: 0,
  invocations: 0,
  errors: 0,
  pheromonesDeposited: 0,
  pheromonesQueried: 0,
  pheromonesDecayed: 0
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

    // Energy budget tracking
    this.energyBudget = manifest.runtime?.energy_budget || 100;
    this.energyUsed = 0;
    this.cpuBudgetMs = manifest.runtime?.cpu_budget_ms || 5000;
    this.cpuUsedMs = 0;
    this.budgetResetAt = Date.now() + 60000; // Reset every 60s
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
      // Strategy-based selection
      const strategy = this.manifest.lifecycle?.learn?.strategy || 'fixed';
      if (strategy === 'fixed') {
        // Fixed: pick highest priority (lowest number)
        const best = eligible.sort((a, b) => a.priority - b.priority)[0];
        this.identity = best.identity;
        this.confidence = 1.0;
      } else {
        // Bandit strategies: thompson, epsilon_greedy, ucb1, contextual_bandit
        this.identity = banditSelect(eligible, this.strategyWeights);
        this.confidence = this.strategyWeights[this.identity] || 0.5;
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
    if (strategy === 'fixed') return; // Fixed cells don't learn

    // EMA update for all bandit strategies (thompson, epsilon_greedy, ucb1, contextual_bandit)
    const lr = 0.1;
    const currentWeight = this.strategyWeights[this.identity] || 0.5;
    this.strategyWeights[this.identity] = currentWeight + lr * (reward - currentWeight);

    // Normalize weights
    const total = Object.values(this.strategyWeights).reduce((s, w) => s + w, 0);
    if (total > 0) {
      for (const key of Object.keys(this.strategyWeights)) {
        this.strategyWeights[key] /= total;
      }
    }

    // Track reward signal for telemetry
    this.metrics[`reward_${rewardSignal}`] = (this.metrics[`reward_${rewardSignal}`] || 0) + 1;
    this.metrics.totalRewards = (this.metrics.totalRewards || 0) + 1;
    this.metrics.avgReward = this.metrics.avgReward
      ? this.metrics.avgReward * 0.9 + reward * 0.1
      : reward;
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
    telemetry.invocations++;

    // Reset budget window
    if (Date.now() > this.budgetResetAt) {
      this.energyUsed = 0;
      this.cpuUsedMs = 0;
      this.budgetResetAt = Date.now() + 60000;
    }

    // Energy budget check
    if (this.energyUsed >= this.energyBudget) {
      this.metrics.budgetExceeded = (this.metrics.budgetExceeded || 0) + 1;
      return { error: `Energy budget exceeded (${this.energyUsed}/${this.energyBudget})` };
    }

    const handler = this.handlers.get(capabilityName);
    if (!handler) {
      this.errors++;
      this.learn(0.0, 'missing_handler');
      return { error: `No handler registered for capability: ${capabilityName}` };
    }

    const startMs = Date.now();
    try {
      const result = await Promise.race([
        handler(input),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Handler timeout (${HANDLER_TIMEOUT_MS}ms)`)), HANDLER_TIMEOUT_MS)
        ),
      ]);
      const latencyMs = Date.now() - startMs;

      // Auto-reward: success = 1.0, scaled by latency (faster = better reward)
      // Latency reward: 1.0 at 0ms, 0.5 at 5000ms, approaches 0 at infinity
      const latencyReward = 1.0 / (1 + latencyMs / 5000);
      const reward = result?.error ? 0.2 : (0.5 + 0.5 * latencyReward);
      this.learn(reward, 'invoke_success');

      // Charge energy: 1 unit base + latency penalty
      const energyCost = 1 + Math.floor(latencyMs / 1000);
      this.energyUsed += energyCost;
      this.cpuUsedMs += latencyMs;

      // Track latency metric
      this.metrics.avgLatencyMs = this.metrics.avgLatencyMs
        ? this.metrics.avgLatencyMs * 0.9 + latencyMs * 0.1
        : latencyMs;

      return result;
    } catch (err) {
      this.errors++;
      telemetry.errors++;
      this.energyUsed += 2; // Errors cost extra
      this.learn(0.0, 'invoke_error');
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

    // ============ Pheromone Board Signals ============
    if (signal.name === 'pheromone.deposit') {
      const { key, value, depositor, ttlMs } = signal.payload || {};
      if (key) {
        pheromoneBoard.deposit(key, value, depositor || signal.source, ttlMs);
        telemetry.pheromonesDeposited++;
      }
      continue;
    }
    if (signal.name === 'pheromone.query') {
      telemetry.pheromonesQueried++;
      // Query results delivered via callback in payload
      const { key, prefix, callback } = signal.payload || {};
      if (callback) {
        if (prefix) {
          callback(pheromoneBoard.queryPrefix(prefix));
        } else if (key) {
          callback(pheromoneBoard.query(key));
        }
      }
      continue;
    }
    if (signal.name === 'pheromone.decay') {
      const removed = pheromoneBoard.decay();
      telemetry.pheromonesDecayed += removed;
      continue;
    }

    // Deliver to subscribed cells
    const subscribers = matchSignal(signal.name);
    for (const manifest of subscribers) {
      const cell = cells.get(manifest.id);
      if (cell && cell.state === 'active') {
        // Cell receives signal — could trigger capability invocation
        cell.lastActivity = Date.now();
      }
    }

    // Deliver to host handlers (with error budget)
    const handlers = signalHandlers.get(signal.name);
    if (handlers) {
      for (const handler of handlers) {
        // Check handler health
        let health = handlerHealth.get(handler);
        if (!health) {
          health = { errors: 0, disabled: false, lastError: 0 };
          handlerHealth.set(handler, health);
        }

        // Skip disabled handlers (auto-recover after HANDLER_RECOVERY_MS)
        if (health.disabled) {
          if (Date.now() - health.lastError > HANDLER_RECOVERY_MS) {
            health.disabled = false;
            health.errors = 0;
          } else {
            continue;
          }
        }

        try {
          handler(signal);
          // Reset on success
          if (health.errors > 0) health.errors = Math.max(0, health.errors - 1);
        } catch (err) {
          health.errors++;
          health.lastError = Date.now();
          telemetry.errors++;
          if (health.errors >= HANDLER_ERROR_THRESHOLD) {
            health.disabled = true;
            console.warn(`[mi-host] Handler disabled for ${signal.name} after ${health.errors} errors: ${err.message}`);
          } else {
            console.warn(`[mi-host] Signal handler error for ${signal.name} (${health.errors}/${HANDLER_ERROR_THRESHOLD}): ${err.message}`);
          }
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

  // Emit system.heartbeat — all cells subscribe to this for health monitoring
  emitSignalInternal('system.heartbeat', {
    ts: Date.now(),
    cellsActive: telemetry.cellsActive,
    cellsTotal: cells.size,
    signalsProcessed: telemetry.signalsProcessed,
    invocations: telemetry.invocations,
  });

  // Trigger pheromone decay — evicts expired entries
  pheromoneBoard.decay();
  emitSignalInternal('pheromone.decay', {
    entries: pheromoneBoard.stats().entries,
  });
}

// ============ State Persistence ============

let persistInterval = null;

/**
 * Save cell strategy weights and telemetry to disk.
 */
export function persistMIState() {
  try {
    const state = {
      version: 1,
      timestamp: Date.now(),
      cells: {},
      pheromones: pheromoneBoard.serialize()
    };

    for (const [id, cell] of cells) {
      state.cells[id] = {
        identity: cell.identity,
        confidence: cell.confidence,
        strategyWeights: { ...cell.strategyWeights },
        invocations: cell.invocations,
        errors: cell.errors,
        metrics: { ...cell.metrics }
      };
    }

    // Ensure directory exists
    const dir = dirname(MI_STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(MI_STATE_FILE, JSON.stringify(state, null, 2));
    return true;
  } catch (err) {
    console.warn(`[mi-host] Failed to persist state: ${err.message}`);
    return false;
  }
}

/**
 * Load saved cell state from disk. Restores strategy weights.
 */
function loadMIState() {
  try {
    if (!existsSync(MI_STATE_FILE)) return null;
    const raw = readFileSync(MI_STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    if (state.version !== 1) return null;
    console.log(`[mi-host] Loaded persisted state (${Object.keys(state.cells).length} cells, saved ${new Date(state.timestamp).toISOString()})`);
    return state;
  } catch (err) {
    console.warn(`[mi-host] Failed to load persisted state: ${err.message}`);
    return null;
  }
}

/**
 * Apply persisted state to a cell instance.
 */
function applyPersistedState(cell, savedState) {
  if (!savedState) return;
  // Restore strategy weights (learned from past runs)
  if (savedState.strategyWeights) {
    cell.strategyWeights = { ...savedState.strategyWeights };
  }
  // Restore counters (cumulative across runs)
  if (savedState.invocations) cell.invocations = savedState.invocations;
  if (savedState.errors) cell.errors = savedState.errors;
}

// ============ Initialization ============

/**
 * Initialize the MI Host SDK. Loads manifests, starts signal processing.
 */
export async function initMIHost(cellsDir = DEFAULT_CELLS_DIR) {
  console.log('[mi-host] Initializing MI Host SDK...');

  // Load persisted state (strategy weights from previous runs)
  const savedState = loadMIState();

  // Restore pheromone board from persisted state
  if (savedState?.pheromones && Array.isArray(savedState.pheromones)) {
    for (const entry of savedState.pheromones) {
      if (entry.expiresAt > Date.now()) {
        pheromoneBoard.deposit(entry.key, entry.value, entry.depositor, entry.expiresAt - Date.now());
      }
    }
    console.log(`[mi-host] Restored ${pheromoneBoard.stats().entries} pheromones from persisted state`);
  }

  // Load manifests
  const manifests = loadManifestDir(cellsDir);
  console.log(`[mi-host] Loaded ${manifests.length} manifest(s) from ${cellsDir}`);

  // Register and instantiate cells
  for (const manifest of manifests) {
    registerCell(manifest);
    const instance = new CellInstance(manifest);

    // Apply persisted state (learned weights, counters)
    if (savedState?.cells?.[manifest.id]) {
      applyPersistedState(instance, savedState.cells[manifest.id]);
    }

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
    telemetry.cellsActive = [...cells.values()].filter(c => c.state === 'active').length;
    telemetry.cellsTotal = cells.size;
    telemetry.pheromoneEntries = pheromoneBoard.stats().entries;
    telemetry.uptimeMs = Date.now() - (telemetry._startedAt || Date.now());

    // Log summary if any activity occurred since last flush
    if (telemetry.invocations > 0 && telemetry.invocations % 10 === 0) {
      console.log(`[mi-host] Telemetry: ${telemetry.invocations} invocations, ${telemetry.errors} errors, ${telemetry.cellsActive}/${telemetry.cellsTotal} cells active`);
    }
  }, TELEMETRY_FLUSH_INTERVAL_MS);
  telemetry._startedAt = Date.now();

  // Start state persistence loop (save learned weights every 5 min)
  persistInterval = setInterval(persistMIState, STATE_PERSIST_INTERVAL_MS);

  // Start hot-reload file watcher
  startHotReload(cellsDir);

  console.log(`[mi-host] Host SDK initialized. ${cells.size} cells active.`);
  return { cellCount: cells.size, manifests: manifests.length };
}

// ============ Hot Reload ============

let fileWatcher = null;
let hotReloadDebounce = null;

/**
 * Watch cells directory for manifest changes. Debounced reload.
 */
function startHotReload(cellsDir) {
  if (!existsSync(cellsDir)) return;

  try {
    fileWatcher = watch(cellsDir, { persistent: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.mi.json')) return;

      // Debounce: wait for writes to finish
      if (hotReloadDebounce) clearTimeout(hotReloadDebounce);
      hotReloadDebounce = setTimeout(() => {
        reloadCell(join(cellsDir, filename));
      }, HOT_RELOAD_DEBOUNCE_MS);
    });
    console.log(`[mi-host] Hot-reload watching: ${cellsDir}`);
  } catch (err) {
    console.warn(`[mi-host] Hot-reload watcher failed: ${err.message}`);
  }
}

/**
 * Reload a single cell manifest from disk.
 */
function reloadCell(filePath) {
  try {
    if (!existsSync(filePath)) {
      // File deleted — unregister cell
      const fileName = basename(filePath, '.mi.json');
      for (const [id, cell] of cells) {
        if (cell.manifest._source === filePath) {
          console.log(`[mi-host] Hot-reload: removing ${id} (file deleted)`);
          emitSignalInternal('cell.death', { cellId: id, identity: cell.identity });
          unregisterCell(id);
          cells.delete(id);
          break;
        }
      }
      return;
    }

    const manifest = loadManifest(filePath);
    const existingCell = cells.get(manifest.id);

    if (existingCell) {
      // Re-register manifest (updates registry indexes)
      unregisterCell(manifest.id);
      registerCell(manifest);

      // Preserve learned weights but update manifest
      existingCell.manifest = manifest;

      // Re-run lifecycle with new manifest
      const features = existingCell.sense({});
      existingCell.choose(features);
      existingCell.act();

      console.log(`[mi-host] Hot-reload: updated ${manifest.id} → identity: ${existingCell.identity}`);
      emitSignalInternal('cell.hot_reload', {
        cellId: manifest.id,
        action: 'updated',
        identity: existingCell.identity,
        capabilities: (manifest.capabilities || []).map(c => c.name),
        version: manifest.version
      });
    } else {
      // New cell
      registerCell(manifest);
      const instance = new CellInstance(manifest);
      const features = instance.sense({});
      instance.choose(features);
      instance.act();
      cells.set(manifest.id, instance);
      console.log(`[mi-host] Hot-reload: added ${manifest.id} → identity: ${instance.identity}`);
      emitSignalInternal('cell.hot_reload', {
        cellId: manifest.id,
        action: 'added',
        identity: instance.identity,
        capabilities: (manifest.capabilities || []).map(c => c.name),
        version: manifest.version
      });
    }

    emitSignalInternal('cell.identity.announce', {
      cellId: manifest.id,
      identity: cells.get(manifest.id)?.identity,
      confidence: cells.get(manifest.id)?.confidence,
      capabilities: (manifest.capabilities || []).map(c => c.name),
      reason: 'hot_reload'
    });
  } catch (err) {
    console.warn(`[mi-host] Hot-reload failed for ${filePath}: ${err.message}`);
  }
}

/**
 * Shutdown the MI Host SDK.
 */
export function shutdownMIHost() {
  // Persist state before shutdown
  persistMIState();

  if (signalInterval) clearInterval(signalInterval);
  if (lifecycleInterval) clearInterval(lifecycleInterval);
  if (telemetryInterval) clearInterval(telemetryInterval);
  if (persistInterval) clearInterval(persistInterval);
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }

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

  // Rank cells by score (active, lowest error rate, highest confidence)
  const ranked = [];
  for (const manifest of matches) {
    const cell = cells.get(manifest.id);
    if (!cell || cell.state !== 'active') continue;

    const errorPenalty = cell.invocations > 0 ? cell.errors / cell.invocations : 0;
    const score = cell.confidence * (1 - errorPenalty);
    ranked.push({ cell, score });
  }

  ranked.sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { error: `No active cell provides capability: ${capabilityName}` };
  }

  // Try cells in ranked order — fallback on timeout/error
  for (const { cell } of ranked) {
    const result = await cell.invoke(capabilityName, input);
    // If primary cell returned a timeout or handler error, try next cell
    if (result?.error && ranked.length > 1 && /timeout|budget/i.test(result.error)) {
      console.warn(`[mi-host] Cell ${cell.id} failed for ${capabilityName}: ${result.error} — trying fallback`);
      continue;
    }
    return result;
  }

  return { error: `All cells failed for capability: ${capabilityName}` };
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
    pheromones: pheromoneBoard.stats(),
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
    `Invocations: ${stats.host.invocations} total`,
    `Signals: ${stats.host.signalsEmitted} emitted, ${stats.host.signalsProcessed} processed, ${stats.host.signalsDropped} dropped`,
    `Identity changes: ${stats.host.identityChanges}`,
    `Pheromones: ${stats.pheromones.entries} active (${stats.host.pheromonesDeposited} deposited, ${stats.host.pheromonesDecayed} decayed)`,
    `Errors: ${stats.host.errors}`,
    ''
  ];

  if (stats.cells.length > 0) {
    lines.push('--- Cells ---');
    // Sort by confidence × (1 - errorRate) for ranking
    const ranked = stats.cells.sort((a, b) => {
      const scoreA = a.confidence * (1 - parseFloat(a.errorRate));
      const scoreB = b.confidence * (1 - parseFloat(b.errorRate));
      return scoreB - scoreA;
    });
    for (const cell of ranked) {
      const rewards = cell.metrics?.totalRewards || 0;
      const avgReward = cell.metrics?.avgReward ? cell.metrics.avgReward.toFixed(2) : 'n/a';
      const latency = cell.metrics?.avgLatencyMs ? `~${Math.round(cell.metrics.avgLatencyMs)}ms` : '';
      lines.push(`  ${cell.id}: ${cell.state} → ${cell.identity || 'none'} (conf: ${(cell.confidence * 100).toFixed(0)}%, inv: ${cell.invocations}, err: ${cell.errorRate}, rewards: ${rewards}, avg: ${avgReward}${latency ? ', ' + latency : ''})`);
    }
  }

  return lines.join('\n');
}

// ============ Pheromone Board API ============

/**
 * Deposit a pheromone trace (convenience wrapper).
 */
export function depositPheromone(key, value, depositor, ttlMs) {
  return emitSignal('pheromone.deposit', { key, value, depositor, ttlMs });
}

/**
 * Query a pheromone by key (synchronous).
 */
export function queryPheromone(key) {
  return pheromoneBoard.query(key);
}

/**
 * Query pheromones by prefix (synchronous).
 */
export function queryPheromonePrefix(prefix) {
  return pheromoneBoard.queryPrefix(prefix);
}

/**
 * Get pheromone board stats.
 */
export function getPheromoneStats() {
  return pheromoneBoard.stats();
}
