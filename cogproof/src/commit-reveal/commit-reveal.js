/**
 * Commit-Reveal Engine for Fair Mining
 *
 * Prevents agents from copying each other's work during mining windows.
 * Uses XOR secret aggregation + Fisher-Yates shuffle for deterministic,
 * unpredictable validation ordering.
 *
 * Based on VibeSwap's CommitRevealAuction mechanism — mathematically proven
 * zero information leakage during commit phase.
 */

const crypto = require('crypto');

class CommitRevealEngine {
  constructor() {
    this.batches = new Map();
    this.currentBatchId = 0;
  }

  /**
   * Create a new mining batch (one per block).
   */
  newBatch(blockHash) {
    const batchId = this.currentBatchId++;
    this.batches.set(batchId, {
      id: batchId,
      blockHash,
      phase: 'COMMIT',
      commits: new Map(),
      reveals: new Map(),
      secrets: [],
      shuffleSeed: null,
      executionOrder: null,
      createdAt: Date.now(),
    });
    return batchId;
  }

  /**
   * COMMIT PHASE: Submit hash(output || secret).
   * No information about the actual output is revealed.
   */
  commit(batchId, minerId, commitHash) {
    const batch = this._getBatch(batchId, 'COMMIT');

    if (batch.commits.has(minerId)) {
      throw new Error(`Miner ${minerId} already committed to batch ${batchId}`);
    }

    batch.commits.set(minerId, {
      minerId,
      commitHash,
      timestamp: Date.now(),
    });

    return { batchId, minerId, commitHash };
  }

  /**
   * Close commit phase, open reveal phase.
   */
  closeCommitPhase(batchId) {
    const batch = this._getBatch(batchId, 'COMMIT');
    batch.phase = 'REVEAL';
    return { batchId, commitCount: batch.commits.size };
  }

  /**
   * REVEAL PHASE: Reveal the actual output + secret.
   * Verified against commit hash.
   */
  reveal(batchId, minerId, output, secret) {
    const batch = this._getBatch(batchId, 'REVEAL');
    const commit = batch.commits.get(minerId);

    if (!commit) {
      throw new Error(`No commit found for miner ${minerId}`);
    }

    // Verify: hash(output || secret) must match commit hash
    const payload = Buffer.concat([
      Buffer.from(output, 'utf8'),
      Buffer.from(secret, 'hex')
    ]);
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');

    if (expectedHash !== commit.commitHash) {
      return { valid: false, reason: 'Commit hash mismatch — slashed' };
    }

    batch.reveals.set(minerId, {
      minerId,
      output,
      secret,
      timestamp: Date.now(),
    });

    batch.secrets.push(Buffer.from(secret, 'hex'));

    return { valid: true, batchId, minerId };
  }

  /**
   * SETTLE: Generate deterministic shuffle seed from XOR'd secrets + block entropy.
   * Then Fisher-Yates shuffle for validation order.
   */
  settle(batchId, blockEntropy) {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error('Unknown batch');
    batch.phase = 'SETTLED';

    // XOR all secrets
    let xorSeed = Buffer.alloc(32, 0);
    for (const secret of batch.secrets) {
      for (let i = 0; i < 32; i++) {
        xorSeed[i] ^= secret[i] || 0;
      }
    }

    // Add block entropy (unavailable during reveal phase)
    const seedInput = Buffer.concat([
      xorSeed,
      Buffer.from(blockEntropy, 'hex'),
      Buffer.from(batchId.toString())
    ]);
    batch.shuffleSeed = crypto.createHash('sha256').update(seedInput).digest('hex');

    // Fisher-Yates shuffle
    const minerIds = [...batch.reveals.keys()];
    batch.executionOrder = this._fisherYatesShuffle(minerIds, batch.shuffleSeed);

    return {
      batchId,
      shuffleSeed: batch.shuffleSeed,
      executionOrder: batch.executionOrder,
      totalCommits: batch.commits.size,
      totalReveals: batch.reveals.size,
      slashed: batch.commits.size - batch.reveals.size,
    };
  }

  /**
   * Fisher-Yates shuffle — deterministic given seed.
   * Same algorithm as VibeSwap's DeterministicShuffle.sol
   */
  _fisherYatesShuffle(array, seed) {
    const result = [...array];
    let currentSeed = seed;

    for (let i = result.length - 1; i > 0; i--) {
      // Derive next random from seed chain
      currentSeed = crypto.createHash('sha256')
        .update(currentSeed + i.toString())
        .digest('hex');

      const j = parseInt(currentSeed.slice(0, 8), 16) % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  _getBatch(batchId, expectedPhase) {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Unknown batch ${batchId}`);
    if (batch.phase !== expectedPhase) {
      throw new Error(`Batch ${batchId} is in ${batch.phase} phase, expected ${expectedPhase}`);
    }
    return batch;
  }

  /**
   * Get batch summary for display.
   */
  getBatchSummary(batchId) {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error('Unknown batch');
    return {
      id: batch.id,
      phase: batch.phase,
      commits: batch.commits.size,
      reveals: batch.reveals.size,
      executionOrder: batch.executionOrder,
      shuffleSeed: batch.shuffleSeed,
    };
  }
}

// CLI demo
if (require.main === module) {
  console.log('=== Commit-Reveal Fair Mining Demo ===\n');

  const engine = new CommitRevealEngine();
  const blockHash = crypto.randomBytes(32).toString('hex');
  const batchId = engine.newBatch(blockHash);

  // Simulate 5 miners
  const miners = [];
  for (let i = 0; i < 5; i++) {
    const minerId = `agent_${i}`;
    const output = `Compressed knowledge output from agent ${i} with unique content ${crypto.randomBytes(8).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');

    const payload = Buffer.concat([
      Buffer.from(output, 'utf8'),
      Buffer.from(secret, 'hex')
    ]);
    const commitHash = crypto.createHash('sha256').update(payload).digest('hex');

    miners.push({ minerId, output, secret, commitHash });
  }

  // COMMIT PHASE
  console.log('--- Commit Phase ---');
  for (const m of miners) {
    engine.commit(batchId, m.minerId, m.commitHash);
    console.log(`  ${m.minerId}: committed ${m.commitHash.slice(0, 16)}...`);
  }

  // Close commits
  engine.closeCommitPhase(batchId);
  console.log('\nCommit phase closed.\n');

  // REVEAL PHASE
  console.log('--- Reveal Phase ---');
  for (const m of miners) {
    const result = engine.reveal(batchId, m.minerId, m.output, m.secret);
    console.log(`  ${m.minerId}: ${result.valid ? '✓ valid' : '✗ SLASHED'}`);
  }

  // SETTLE
  console.log('\n--- Settlement ---');
  const blockEntropy = crypto.randomBytes(32).toString('hex');
  const settlement = engine.settle(batchId, blockEntropy);

  console.log(`Shuffle seed: ${settlement.shuffleSeed.slice(0, 16)}...`);
  console.log(`Execution order: ${settlement.executionOrder.join(' → ')}`);
  console.log(`Commits: ${settlement.totalCommits} | Reveals: ${settlement.totalReveals} | Slashed: ${settlement.slashed}`);
  console.log('\n✓ Fair ordering achieved — no miner could predict or influence position');
}

module.exports = { CommitRevealEngine };
