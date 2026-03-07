// ============ Contextual Bandit — Proto-AI Kernel for MI Cells ============
// Freedom's recommended first substrate: contextual bandit for immediate
// strategy selection. This is the minimal intelligence that makes cells
// self-differentiating.
//
// Supports:
//   - Epsilon-greedy exploration with decay
//   - Thompson sampling (Beta distribution)
//   - UCB1 (Upper Confidence Bound)
//   - Context-aware feature vectors
//   - Persistent weights (serialize/deserialize)
//   - Reward signal integration
//
// Usage:
//   const bandit = new ContextualBandit(['live-api', 'cached', 'static'], { strategy: 'thompson' });
//   const choice = bandit.select(contextFeatures);
//   // ... execute choice ...
//   bandit.update(choice, reward);  // reward ∈ [0, 1]
//   const weights = bandit.serialize();  // persist
// ============

// ============ Epsilon-Greedy Bandit ============

/**
 * Epsilon-greedy contextual bandit with decay.
 * Simple, effective, low memory footprint.
 */
export class EpsilonGreedyBandit {
  /**
   * @param {string[]} arms - Available actions/identities
   * @param {object} opts - Configuration
   * @param {number} opts.epsilon - Initial exploration rate (default 0.15)
   * @param {number} opts.decay - Epsilon decay per update (default 0.999)
   * @param {number} opts.minEpsilon - Floor for exploration (default 0.02)
   * @param {number} opts.lr - Learning rate (default 0.1)
   */
  constructor(arms, opts = {}) {
    this.arms = arms;
    this.epsilon = opts.epsilon ?? 0.15;
    this.decay = opts.decay ?? 0.999;
    this.minEpsilon = opts.minEpsilon ?? 0.02;
    this.lr = opts.lr ?? 0.1;

    // Q-values: estimated reward for each arm
    this.Q = {};
    // Pull counts per arm
    this.N = {};

    for (const arm of arms) {
      this.Q[arm] = 0.5; // Optimistic initialization
      this.N[arm] = 0;
    }

    this.totalPulls = 0;
  }

  /**
   * Select an arm. Context features are currently unused (pure bandit)
   * but kept in signature for future context-aware extension.
   */
  select(context = {}) {
    // Explore
    if (Math.random() < this.epsilon) {
      return this.arms[Math.floor(Math.random() * this.arms.length)];
    }

    // Exploit: pick arm with highest Q-value
    let bestArm = this.arms[0];
    let bestQ = -Infinity;
    for (const arm of this.arms) {
      if (this.Q[arm] > bestQ) {
        bestQ = this.Q[arm];
        bestArm = arm;
      }
    }
    return bestArm;
  }

  /**
   * Update Q-value for an arm based on observed reward.
   * @param {string} arm - The arm that was pulled
   * @param {number} reward - Observed reward ∈ [0, 1]
   */
  update(arm, reward) {
    if (!(arm in this.Q)) return;

    this.N[arm]++;
    this.totalPulls++;

    // Incremental mean update
    this.Q[arm] = this.Q[arm] + this.lr * (reward - this.Q[arm]);

    // Decay epsilon
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.decay);
  }

  serialize() {
    return {
      type: 'epsilon_greedy',
      arms: this.arms,
      Q: { ...this.Q },
      N: { ...this.N },
      epsilon: this.epsilon,
      totalPulls: this.totalPulls
    };
  }

  static deserialize(data) {
    const bandit = new EpsilonGreedyBandit(data.arms);
    bandit.Q = { ...data.Q };
    bandit.N = { ...data.N };
    bandit.epsilon = data.epsilon;
    bandit.totalPulls = data.totalPulls;
    return bandit;
  }
}

// ============ Thompson Sampling Bandit ============

/**
 * Thompson sampling with Beta distribution.
 * Better exploration-exploitation tradeoff than epsilon-greedy.
 * Models uncertainty explicitly — explores arms it's uncertain about.
 */
export class ThompsonBandit {
  /**
   * @param {string[]} arms - Available actions/identities
   * @param {object} opts - Configuration
   * @param {number} opts.priorAlpha - Prior successes (default 1)
   * @param {number} opts.priorBeta - Prior failures (default 1)
   */
  constructor(arms, opts = {}) {
    this.arms = arms;
    this.priorAlpha = opts.priorAlpha ?? 1;
    this.priorBeta = opts.priorBeta ?? 1;

    // Beta distribution parameters per arm
    this.alpha = {};
    this.beta = {};
    this.N = {};

    for (const arm of arms) {
      this.alpha[arm] = this.priorAlpha;
      this.beta[arm] = this.priorBeta;
      this.N[arm] = 0;
    }

    this.totalPulls = 0;
  }

  /**
   * Select an arm by sampling from Beta distributions.
   */
  select(context = {}) {
    let bestArm = this.arms[0];
    let bestSample = -1;

    for (const arm of this.arms) {
      // Sample from Beta(alpha, beta) distribution
      const sample = betaSample(this.alpha[arm], this.beta[arm]);
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arm;
      }
    }

    return bestArm;
  }

  /**
   * Update Beta parameters based on binary reward.
   * Reward is treated as probability of success.
   * @param {string} arm - The arm that was pulled
   * @param {number} reward - Observed reward ∈ [0, 1]
   */
  update(arm, reward) {
    if (!(arm in this.alpha)) return;

    this.N[arm]++;
    this.totalPulls++;

    // Bernoulli interpretation: reward > 0.5 → success, else failure
    // Continuous: scale proportionally
    this.alpha[arm] += reward;
    this.beta[arm] += (1 - reward);
  }

  /**
   * Get the estimated probability of success for each arm.
   */
  getEstimates() {
    const estimates = {};
    for (const arm of this.arms) {
      estimates[arm] = this.alpha[arm] / (this.alpha[arm] + this.beta[arm]);
    }
    return estimates;
  }

  serialize() {
    return {
      type: 'thompson',
      arms: this.arms,
      alpha: { ...this.alpha },
      beta: { ...this.beta },
      N: { ...this.N },
      totalPulls: this.totalPulls
    };
  }

  static deserialize(data) {
    const bandit = new ThompsonBandit(data.arms);
    bandit.alpha = { ...data.alpha };
    bandit.beta = { ...data.beta };
    bandit.N = { ...data.N };
    bandit.totalPulls = data.totalPulls;
    return bandit;
  }
}

// ============ UCB1 Bandit ============

/**
 * Upper Confidence Bound (UCB1) bandit.
 * Deterministic: always picks the arm with highest upper confidence bound.
 * Good for situations where you want systematic exploration.
 */
export class UCB1Bandit {
  /**
   * @param {string[]} arms - Available actions/identities
   * @param {object} opts - Configuration
   * @param {number} opts.c - Exploration constant (default sqrt(2))
   */
  constructor(arms, opts = {}) {
    this.arms = arms;
    this.c = opts.c ?? Math.SQRT2;

    this.Q = {};
    this.N = {};

    for (const arm of arms) {
      this.Q[arm] = 0;
      this.N[arm] = 0;
    }

    this.totalPulls = 0;
  }

  /**
   * Select arm with highest UCB score.
   */
  select(context = {}) {
    // First: try each arm at least once
    for (const arm of this.arms) {
      if (this.N[arm] === 0) return arm;
    }

    let bestArm = this.arms[0];
    let bestUCB = -Infinity;

    for (const arm of this.arms) {
      const exploitation = this.Q[arm];
      const exploration = this.c * Math.sqrt(Math.log(this.totalPulls) / this.N[arm]);
      const ucb = exploitation + exploration;

      if (ucb > bestUCB) {
        bestUCB = ucb;
        bestArm = arm;
      }
    }

    return bestArm;
  }

  /**
   * Update Q-value using incremental mean.
   */
  update(arm, reward) {
    if (!(arm in this.Q)) return;

    this.N[arm]++;
    this.totalPulls++;

    // Incremental mean
    this.Q[arm] = this.Q[arm] + (reward - this.Q[arm]) / this.N[arm];
  }

  serialize() {
    return {
      type: 'ucb1',
      arms: this.arms,
      Q: { ...this.Q },
      N: { ...this.N },
      totalPulls: this.totalPulls,
      c: this.c
    };
  }

  static deserialize(data) {
    const bandit = new UCB1Bandit(data.arms, { c: data.c });
    bandit.Q = { ...data.Q };
    bandit.N = { ...data.N };
    bandit.totalPulls = data.totalPulls;
    return bandit;
  }
}

// ============ Factory ============

/**
 * Create a bandit of the specified type.
 * @param {'epsilon_greedy' | 'thompson' | 'ucb1'} type
 * @param {string[]} arms
 * @param {object} opts
 */
export function createBandit(type, arms, opts = {}) {
  switch (type) {
    case 'thompson': return new ThompsonBandit(arms, opts);
    case 'ucb1': return new UCB1Bandit(arms, opts);
    case 'epsilon_greedy':
    default: return new EpsilonGreedyBandit(arms, opts);
  }
}

/**
 * Deserialize a bandit from saved state.
 */
export function deserializeBandit(data) {
  switch (data.type) {
    case 'thompson': return ThompsonBandit.deserialize(data);
    case 'ucb1': return UCB1Bandit.deserialize(data);
    case 'epsilon_greedy':
    default: return EpsilonGreedyBandit.deserialize(data);
  }
}

// ============ Utilities ============

/**
 * Sample from Beta(alpha, beta) distribution using Jöhnk's algorithm.
 * Lightweight — no external dependencies.
 */
function betaSample(alpha, beta) {
  if (alpha <= 0) alpha = 0.001;
  if (beta <= 0) beta = 0.001;

  // Use gamma ratio method for general alpha, beta
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

/**
 * Sample from Gamma(shape, 1) distribution.
 * Uses Marsaglia and Tsang's method for shape >= 1,
 * Ahrens-Dieter for shape < 1.
 */
function gammaSample(shape) {
  if (shape < 1) {
    // Ahrens-Dieter method
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  // Marsaglia and Tsang's method
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x, v;
    do {
      x = normalSample();
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Sample from standard normal distribution (Box-Muller).
 */
function normalSample() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ============ Stigmergy Board ============

/**
 * Simple in-memory pheromone board for indirect cell coordination.
 * Cells leave traces that decay over time. Other cells read them.
 */
export class StigmergyBoard {
  /**
   * @param {object} opts
   * @param {number} opts.defaultTTL - Default pheromone TTL in ms (default 5 min)
   * @param {number} opts.maxEntries - Max pheromones stored (default 1000)
   */
  constructor(opts = {}) {
    this.defaultTTL = opts.defaultTTL ?? 300000;
    this.maxEntries = opts.maxEntries ?? 1000;
    this.board = new Map(); // key → { value, depositor, timestamp, expiresAt }
  }

  /**
   * Deposit a pheromone trace.
   */
  deposit(key, value, depositor = 'unknown', ttlMs = this.defaultTTL) {
    // Evict oldest if at capacity
    if (this.board.size >= this.maxEntries) {
      const oldest = [...this.board.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.board.delete(oldest[0]);
    }

    this.board.set(key, {
      value,
      depositor,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Query a pheromone by key. Returns null if expired or not found.
   */
  query(key) {
    const entry = this.board.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.board.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * Query all pheromones matching a prefix.
   */
  queryPrefix(prefix) {
    const results = [];
    const now = Date.now();
    for (const [key, entry] of this.board) {
      if (key.startsWith(prefix)) {
        if (now > entry.expiresAt) {
          this.board.delete(key);
        } else {
          results.push({ key, ...entry });
        }
      }
    }
    return results;
  }

  /**
   * Decay: remove all expired entries.
   */
  decay() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.board) {
      if (now > entry.expiresAt) {
        this.board.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get board stats.
   */
  stats() {
    return {
      entries: this.board.size,
      maxEntries: this.maxEntries,
      depositors: new Set([...this.board.values()].map(e => e.depositor)).size
    };
  }

  serialize() {
    return [...this.board.entries()].map(([key, entry]) => ({ key, ...entry }));
  }

  static deserialize(data, opts = {}) {
    const board = new StigmergyBoard(opts);
    const now = Date.now();
    for (const entry of data) {
      if (now < entry.expiresAt) {
        board.board.set(entry.key, {
          value: entry.value,
          depositor: entry.depositor,
          timestamp: entry.timestamp,
          expiresAt: entry.expiresAt
        });
      }
    }
    return board;
  }
}
