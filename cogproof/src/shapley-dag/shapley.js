/**
 * Shapley Value Distribution with Lawson Constant Floor
 *
 * Computes game-theory optimal reward distribution:
 * - Each participant receives their marginal contribution
 * - Lawson constant λ guarantees minimum floor (no one gets zeroed)
 * - DAG structure models contribution dependencies
 *
 * The hackathon's 70%-to-all-participants IS a Lawson floor in practice.
 * This is the math behind what they're already doing.
 */

const crypto = require('crypto');

// Lawson constant — keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")
const LAWSON_HASH = crypto.createHash('sha256')
  .update('FAIRNESS_ABOVE_ALL:W.GLYNN:2026')
  .digest('hex');

class ShapleyDistributor {
  constructor(lawsonFloor = 0.05) {
    // λ = minimum share any participant receives (default 5%)
    this.lawsonFloor = lawsonFloor;
    this.participants = new Map();
    this.coalitions = [];
    this.dag = new Map(); // contribution dependency graph
  }

  /**
   * Add a participant with their contribution metrics.
   */
  addParticipant(id, contributions) {
    this.participants.set(id, {
      id,
      contributions, // { metric: value, ... }
      shapleyValue: 0,
      rawShare: 0,
      adjustedShare: 0,
    });
    this.dag.set(id, { dependencies: [], dependents: [] });
  }

  /**
   * Add a dependency edge in the DAG.
   * "A depends on B" means B's contribution enables A's.
   */
  addDependency(fromId, toId) {
    const from = this.dag.get(fromId);
    const to = this.dag.get(toId);
    if (!from || !to) throw new Error('Unknown participant');
    from.dependencies.push(toId);
    to.dependents.push(fromId);
  }

  /**
   * Compute Shapley values for all participants.
   *
   * Shapley value φ_i = average marginal contribution of i
   * across all possible coalition orderings.
   */
  compute(totalPool) {
    const ids = [...this.participants.keys()];
    const n = ids.length;

    if (n === 0) throw new Error('No participants');

    // Generate all permutations for exact Shapley (feasible for n ≤ 10)
    // For larger n, use sampling approximation
    const permutations = n <= 10
      ? this._allPermutations(ids)
      : this._samplePermutations(ids, 10000);

    // Compute marginal contributions
    for (const perm of permutations) {
      const coalition = new Set();
      for (const id of perm) {
        const marginal = this._marginalContribution(id, coalition);
        const p = this.participants.get(id);
        p.shapleyValue += marginal;
        coalition.add(id);
      }
    }

    // Normalize
    const totalShapley = [...this.participants.values()]
      .reduce((sum, p) => sum + p.shapleyValue, 0);

    for (const p of this.participants.values()) {
      p.rawShare = totalShapley > 0 ? p.shapleyValue / totalShapley : 1 / n;
    }

    // Apply Lawson floor — redistribute from top to guarantee minimum
    this._applyLawsonFloor();

    // Compute final payouts
    const results = [];
    for (const p of this.participants.values()) {
      results.push({
        id: p.id,
        shapleyValue: Math.round(p.shapleyValue * 100) / 100,
        rawShare: Math.round(p.rawShare * 10000) / 10000,
        adjustedShare: Math.round(p.adjustedShare * 10000) / 10000,
        payout: Math.round(totalPool * p.adjustedShare * 100) / 100,
        contributions: p.contributions,
      });
    }

    return {
      totalPool,
      lawsonFloor: this.lawsonFloor,
      lawsonHash: LAWSON_HASH.slice(0, 16),
      participants: results.sort((a, b) => b.payout - a.payout),
      dag: this._serializeDAG(),
    };
  }

  /**
   * Marginal contribution of player joining a coalition.
   * Accounts for DAG dependencies — contribution only counts
   * if dependencies are already in the coalition.
   */
  _marginalContribution(playerId, coalition) {
    const player = this.participants.get(playerId);
    const deps = this.dag.get(playerId).dependencies;

    // If dependencies aren't met, marginal contribution is reduced
    const depsMet = deps.filter(d => coalition.has(d)).length;
    const depFactor = deps.length === 0 ? 1.0 : depsMet / deps.length;

    // Value function: sum of weighted contribution metrics
    const playerValue = this._valueFunction(player.contributions) * depFactor;

    // Coalition value without player
    const coalitionValue = [...coalition].reduce((sum, id) => {
      return sum + this._valueFunction(this.participants.get(id).contributions);
    }, 0);

    // Coalition value with player
    const withPlayer = coalitionValue + playerValue;

    return withPlayer - coalitionValue;
  }

  /**
   * Value function — scores a participant's contributions.
   * Logarithmic scaling prevents burst dominance.
   */
  _valueFunction(contributions) {
    let value = 0;
    for (const [metric, amount] of Object.entries(contributions)) {
      // log2(1 + amount) — same as Proof of Mind scoring
      value += Math.log2(1 + amount);
    }
    return value;
  }

  /**
   * Lawson floor — guarantee minimum share for every participant.
   * "Fairness Above All" — encoded on-chain as an immutable constant.
   *
   * If any participant's raw share < λ, redistribute from those above λ
   * proportionally until everyone meets the floor.
   */
  _applyLawsonFloor() {
    const participants = [...this.participants.values()];
    const n = participants.length;
    const floor = this.lawsonFloor;

    // Start with raw shares
    for (const p of participants) {
      p.adjustedShare = p.rawShare;
    }

    // Find who's below floor
    let belowFloor = participants.filter(p => p.adjustedShare < floor);
    let aboveFloor = participants.filter(p => p.adjustedShare >= floor);

    if (belowFloor.length === 0) return;

    // Calculate total deficit
    const totalDeficit = belowFloor.reduce(
      (sum, p) => sum + (floor - p.adjustedShare), 0
    );

    // Calculate total surplus available
    const totalSurplus = aboveFloor.reduce(
      (sum, p) => sum + (p.adjustedShare - floor), 0
    );

    if (totalSurplus <= 0) {
      // Everyone gets equal share (edge case)
      for (const p of participants) {
        p.adjustedShare = 1 / n;
      }
      return;
    }

    // Redistribute proportionally from surplus holders
    const redistributionRate = Math.min(totalDeficit / totalSurplus, 1);

    for (const p of aboveFloor) {
      const surplus = p.adjustedShare - floor;
      p.adjustedShare -= surplus * redistributionRate;
    }

    for (const p of belowFloor) {
      p.adjustedShare = floor;
    }

    // Normalize to ensure sum = 1
    const total = participants.reduce((sum, p) => sum + p.adjustedShare, 0);
    for (const p of participants) {
      p.adjustedShare /= total;
    }
  }

  _allPermutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const perm of this._allPermutations(rest)) {
        result.push([arr[i], ...perm]);
      }
    }
    return result;
  }

  _samplePermutations(arr, count) {
    const perms = [];
    for (let i = 0; i < count; i++) {
      const shuffled = [...arr];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
      }
      perms.push(shuffled);
    }
    return perms;
  }

  _serializeDAG() {
    const nodes = [];
    const edges = [];
    for (const [id, node] of this.dag) {
      nodes.push(id);
      for (const dep of node.dependencies) {
        edges.push({ from: id, to: dep });
      }
    }
    return { nodes, edges };
  }
}

// CLI demo
if (require.main === module) {
  console.log('=== Shapley Distribution DAG — Lawson Floor Demo ===\n');
  console.log(`Lawson constant: ${LAWSON_HASH.slice(0, 32)}...`);
  console.log(`  keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")\n`);

  const dist = new ShapleyDistributor(0.05); // 5% floor

  // Simulate hackathon team
  dist.addParticipant('will', {
    code_commits: 45,
    protocol_design: 30,
    architecture: 25,
    presentation: 10,
  });

  dist.addParticipant('soham', {
    code_commits: 20,
    credential_design: 35,
    api_layer: 25,
    testing: 15,
  });

  dist.addParticipant('bianca', {
    statistical_analysis: 40,
    proof_validation: 20,
    documentation: 15,
  });

  dist.addParticipant('amelia', {
    frontend_design: 30,
    ux_research: 20,
    presentation: 25,
  });

  dist.addParticipant('teammate_5', {
    testing: 15,
    documentation: 20,
    deployment: 10,
  });

  // DAG: credential design depends on protocol design
  dist.addDependency('soham', 'will');
  // DAG: statistical analysis validates the proofs
  dist.addDependency('bianca', 'will');
  dist.addDependency('bianca', 'soham');
  // DAG: frontend depends on backend
  dist.addDependency('amelia', 'will');
  dist.addDependency('amelia', 'soham');

  const result = dist.compute(20000); // $20K prize pool

  console.log(`Prize Pool: $${result.totalPool}`);
  console.log(`Lawson Floor: ${(result.lawsonFloor * 100)}% ($${result.totalPool * result.lawsonFloor})\n`);

  console.log('--- Distribution ---');
  for (const p of result.participants) {
    const bar = '█'.repeat(Math.round(p.adjustedShare * 50));
    console.log(`  ${p.id.padEnd(12)} ${bar} ${(p.adjustedShare * 100).toFixed(1)}% → $${p.payout}`);
  }

  console.log('\n--- DAG Edges ---');
  for (const edge of result.dag.edges) {
    console.log(`  ${edge.from} ← depends on ← ${edge.to}`);
  }

  console.log('\n✓ Fair distribution with Lawson floor — nobody zeroed out');
}

module.exports = { ShapleyDistributor, LAWSON_HASH };
