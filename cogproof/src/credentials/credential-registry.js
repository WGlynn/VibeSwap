/**
 * Proof of Fair Participation — Credential Registry
 *
 * Every action in the commit-reveal lifecycle generates a verifiable credential.
 * Credentials are behavioral reputation, not identity (no KYC).
 *
 * On-chain: credential hash/pointer (lightweight)
 * Off-chain: full Verifiable Credential (W3C VC standard)
 *
 * Synthesis:
 * - VibeSwap commit-reveal = source of truth for fair behavior
 * - Credentials = portable proof of that behavior
 * - CogCoin burn = economic commitment signal
 * - Together = unforgeable behavioral + economic reputation
 */

const crypto = require('crypto');

// Credential types mapped to protocol lifecycle events
const CREDENTIAL_TYPES = {
  // Commit-Reveal lifecycle
  BATCH_PARTICIPANT: {
    id: 'batch-participant',
    name: 'Batch Participant',
    description: 'Submitted a commit to a fair auction batch',
    signal: 'positive',
    weight: 1,
  },
  HONEST_REVEAL: {
    id: 'honest-reveal',
    name: 'Honest Reveal',
    description: 'Revealed order matching original commit hash',
    signal: 'positive',
    weight: 2,
  },
  FAIR_EXECUTION: {
    id: 'fair-execution',
    name: 'Fair Execution Participant',
    description: 'Order included in Fisher-Yates shuffled execution',
    signal: 'positive',
    weight: 2,
  },
  FAILED_REVEAL: {
    id: 'failed-reveal',
    name: 'Failed Reveal',
    description: 'Committed but did not reveal — slashed',
    signal: 'negative',
    weight: -3,
  },

  // Shapley contribution
  HIGH_CONTRIBUTOR: {
    id: 'high-contributor',
    name: 'High Contributor',
    description: 'Shapley value in top 20% of batch participants',
    signal: 'positive',
    weight: 5,
  },
  CONSISTENT_CONTRIBUTOR: {
    id: 'consistent-contributor',
    name: 'Consistent Contributor',
    description: 'Maintained positive Shapley value across 10+ batches',
    signal: 'positive',
    weight: 10,
  },

  // Compression mining (CogCoin integration)
  COMPRESSION_MINER: {
    id: 'compression-miner',
    name: 'Compression Miner',
    description: 'Submitted valid lossless compression as PoW',
    signal: 'positive',
    weight: 3,
  },
  HIGH_DENSITY_MINER: {
    id: 'high-density-miner',
    name: 'High Density Miner',
    description: 'Achieved compression density > 0.8',
    signal: 'positive',
    weight: 5,
  },

  // Reputation burns (CogCoin native)
  REPUTATION_BURN: {
    id: 'reputation-burn',
    name: 'Reputation Burn',
    description: 'Irreversibly burned COG to signal commitment',
    signal: 'positive',
    weight: 4,
  },
};

class CredentialRegistry {
  constructor() {
    this.credentials = [];        // Full credential store (off-chain)
    this.onChainHashes = [];      // Hash pointers (on-chain)
    this.userProfiles = new Map(); // Aggregated reputation per user
  }

  /**
   * Record a protocol event and issue corresponding credential.
   */
  recordEvent(event) {
    const { userId, eventType, batchId, metadata } = event;

    const credType = CREDENTIAL_TYPES[eventType];
    if (!credType) throw new Error(`Unknown event type: ${eventType}`);

    // Build W3C Verifiable Credential structure
    const credential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'FairParticipationCredential'],
      issuer: 'did:vibeswap:credential-registry',
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: `did:vibeswap:user:${userId}`,
        credential: credType.id,
        name: credType.name,
        description: credType.description,
        signal: credType.signal,
        batchId,
        metadata: metadata || {},
      },
    };

    // Hash for on-chain pointer
    const credHash = crypto.createHash('sha256')
      .update(JSON.stringify(credential))
      .digest('hex');

    credential.proof = {
      type: 'Sha256Hash',
      hash: credHash,
    };

    // Store
    this.credentials.push(credential);
    this.onChainHashes.push({ credHash, userId, type: credType.id, timestamp: Date.now() });

    // Update user profile
    this._updateProfile(userId, credType);

    return { credential, credHash };
  }

  /**
   * Issue credential via API endpoint.
   */
  issueCredential(userId, credentialType, batchId, metadata) {
    return this.recordEvent({
      userId,
      eventType: credentialType,
      batchId,
      metadata,
    });
  }

  /**
   * Get user reputation score and credential history.
   */
  getUserReputation(userId) {
    const profile = this.userProfiles.get(userId);
    if (!profile) {
      return { userId, score: 0, credentials: [], tier: 'UNKNOWN' };
    }

    const tier = this._computeTier(profile.score);

    return {
      userId,
      score: profile.score,
      totalCredentials: profile.totalCredentials,
      positiveSignals: profile.positiveSignals,
      negativeSignals: profile.negativeSignals,
      tier,
      credentials: this.credentials.filter(
        c => c.credentialSubject.id === `did:vibeswap:user:${userId}`
      ),
    };
  }

  /**
   * Hook into commit-reveal lifecycle — auto-issue credentials.
   */
  hookCommit(userId, batchId, commitHash) {
    return this.recordEvent({
      userId,
      eventType: 'BATCH_PARTICIPANT',
      batchId,
      metadata: { commitHash },
    });
  }

  hookReveal(userId, batchId, valid) {
    return this.recordEvent({
      userId,
      eventType: valid ? 'HONEST_REVEAL' : 'FAILED_REVEAL',
      batchId,
    });
  }

  hookExecution(userId, batchId, executionPosition) {
    return this.recordEvent({
      userId,
      eventType: 'FAIR_EXECUTION',
      batchId,
      metadata: { executionPosition },
    });
  }

  hookShapleyScore(userId, batchId, shapleyValue, percentile) {
    const events = [this.recordEvent({
      userId,
      eventType: 'FAIR_EXECUTION',
      batchId,
      metadata: { shapleyValue },
    })];

    if (percentile >= 80) {
      events.push(this.recordEvent({
        userId,
        eventType: 'HIGH_CONTRIBUTOR',
        batchId,
        metadata: { shapleyValue, percentile },
      }));
    }

    return events;
  }

  hookCompressionMining(userId, batchId, ratio, density) {
    const events = [this.recordEvent({
      userId,
      eventType: 'COMPRESSION_MINER',
      batchId,
      metadata: { ratio, density },
    })];

    if (density > 0.8) {
      events.push(this.recordEvent({
        userId,
        eventType: 'HIGH_DENSITY_MINER',
        batchId,
        metadata: { ratio, density },
      }));
    }

    return events;
  }

  _updateProfile(userId, credType) {
    if (!this.userProfiles.has(userId)) {
      this.userProfiles.set(userId, {
        score: 0,
        totalCredentials: 0,
        positiveSignals: 0,
        negativeSignals: 0,
      });
    }

    const profile = this.userProfiles.get(userId);
    profile.score += credType.weight;
    profile.totalCredentials++;
    if (credType.signal === 'positive') profile.positiveSignals++;
    if (credType.signal === 'negative') profile.negativeSignals++;
  }

  _computeTier(score) {
    if (score >= 50) return 'DIAMOND';
    if (score >= 30) return 'GOLD';
    if (score >= 15) return 'SILVER';
    if (score >= 5) return 'BRONZE';
    if (score >= 0) return 'NEWCOMER';
    return 'FLAGGED';
  }
}

// CLI demo
if (require.main === module) {
  console.log('=== Proof of Fair Participation — Credential Registry Demo ===\n');

  const registry = new CredentialRegistry();

  // Simulate User A — reliable participant
  console.log('--- User A: Reliable Participant ---');
  for (let batch = 0; batch < 5; batch++) {
    registry.hookCommit('user_A', batch, crypto.randomBytes(32).toString('hex'));
    registry.hookReveal('user_A', batch, true);
    registry.hookExecution('user_A', batch, Math.floor(Math.random() * 10));
  }
  const repA = registry.getUserReputation('user_A');
  console.log(`  Score: ${repA.score} | Tier: ${repA.tier} | Credentials: ${repA.totalCredentials}`);
  console.log(`  Positive: ${repA.positiveSignals} | Negative: ${repA.negativeSignals}\n`);

  // Simulate User B — unreliable
  console.log('--- User B: Unreliable Participant ---');
  for (let batch = 0; batch < 5; batch++) {
    registry.hookCommit('user_B', batch, crypto.randomBytes(32).toString('hex'));
    registry.hookReveal('user_B', batch, batch < 2); // fails 3 out of 5
  }
  const repB = registry.getUserReputation('user_B');
  console.log(`  Score: ${repB.score} | Tier: ${repB.tier} | Credentials: ${repB.totalCredentials}`);
  console.log(`  Positive: ${repB.positiveSignals} | Negative: ${repB.negativeSignals}\n`);

  // Simulate User C — high contributor + compression miner
  console.log('--- User C: High Contributor + Compression Miner ---');
  for (let batch = 0; batch < 10; batch++) {
    registry.hookCommit('user_C', batch, crypto.randomBytes(32).toString('hex'));
    registry.hookReveal('user_C', batch, true);
    registry.hookShapleyScore('user_C', batch, 0.35, 92);
    registry.hookCompressionMining('user_C', batch, 0.45, 0.85);
  }
  const repC = registry.getUserReputation('user_C');
  console.log(`  Score: ${repC.score} | Tier: ${repC.tier} | Credentials: ${repC.totalCredentials}`);
  console.log(`  Positive: ${repC.positiveSignals} | Negative: ${repC.negativeSignals}\n`);

  console.log('--- Reputation Comparison ---');
  console.log(`  User A: ${repA.tier} (${repA.score}pts) — reliable but basic`);
  console.log(`  User B: ${repB.tier} (${repB.score}pts) — unreliable, flagged`);
  console.log(`  User C: ${repC.tier} (${repC.score}pts) — top contributor + miner`);
  console.log('\n✓ Behavioral reputation — no KYC, just protocol-verified actions');
}

module.exports = { CredentialRegistry, CREDENTIAL_TYPES };
