/**
 * Behavioral Trust Analyzer — CogProof Fraud Detection Layer
 *
 * Analyzes on-chain behavior patterns to determine trustworthiness
 * and flag potential scams, sybil attacks, and malpractice.
 *
 * All signals derived from Bitcoin tx history + indexer state.
 * No external oracles. No trust assumptions beyond Bitcoin.
 *
 * Detection categories:
 * 1. Sybil clusters (coordinated wallets)
 * 2. Selective reveal gaming (commit but strategically not reveal)
 * 3. Compression plagiarism (copying others' work)
 * 4. Wash reputation (self-endorsing via burn/revoke cycles)
 * 5. Timing manipulation (front-running reveals)
 * 6. Collusion rings (coordinated commit patterns)
 */

const crypto = require('crypto');

// Risk thresholds
const THRESHOLDS = {
  SYBIL_TIMING_WINDOW_MS: 2000,      // Commits within 2s = suspicious
  SYBIL_SIMILARITY_RATIO: 0.85,       // 85%+ output similarity = likely sybil
  SELECTIVE_REVEAL_RATE: 0.4,          // Reveal < 40% of commits = gaming
  MIN_BATCHES_FOR_ANALYSIS: 3,         // Need 3+ batches to detect patterns
  COLLUSION_CORRELATION: 0.9,          // 90%+ co-occurrence = possible ring
  PLAGIARISM_HASH_OVERLAP: 0.7,        // 70%+ dictionary overlap = plagiarism
  REPUTATION_CHURN_RATE: 5,            // 5+ burn/revoke cycles = manipulation
  VELOCITY_SPIKE_MULTIPLIER: 3,        // 3x normal activity = suspicious burst
};

// Flag severity levels
const SEVERITY = {
  INFO: 'INFO',           // Worth noting, not actionable
  WARNING: 'WARNING',     // Suspicious, monitor closely
  HIGH: 'HIGH',           // Likely malpractice, restrict privileges
  CRITICAL: 'CRITICAL',   // Confirmed bad actor, flag for review
};

class BehaviorAnalyzer {
  constructor() {
    this.userHistory = new Map();    // userId → behavioral timeline
    this.batchHistory = [];          // all batch records
    this.flags = [];                 // all raised flags
    this.trustScores = new Map();    // userId → composite trust score
  }

  /**
   * Record a user action for analysis.
   */
  recordAction(userId, action) {
    if (!this.userHistory.has(userId)) {
      this.userHistory.set(userId, {
        userId,
        actions: [],
        commits: [],
        reveals: [],
        mining: [],
        burns: [],
        revocations: [],
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });
    }

    const history = this.userHistory.get(userId);
    history.actions.push({ ...action, timestamp: Date.now() });
    history.lastSeen = Date.now();

    // Categorize
    if (action.type === 'COMMIT') history.commits.push(action);
    if (action.type === 'REVEAL') history.reveals.push(action);
    if (action.type === 'MINE') history.mining.push(action);
    if (action.type === 'REP_COMMIT') history.burns.push(action);
    if (action.type === 'REP_REVOKE') history.revocations.push(action);
  }

  /**
   * Run full analysis on a user — returns trust assessment.
   */
  analyzeUser(userId) {
    const history = this.userHistory.get(userId);
    if (!history) {
      return { userId, trust: 'UNKNOWN', score: 0, flags: [], reason: 'No history' };
    }

    const flags = [];

    // Run all detectors
    flags.push(...this._detectSelectiveRevealing(history));
    flags.push(...this._detectVelocitySpikes(history));
    flags.push(...this._detectReputationChurn(history));
    flags.push(...this._detectNewAccountRisk(history));

    // Store flags
    this.flags.push(...flags.map(f => ({ ...f, userId })));

    // Compute trust score
    const score = this._computeTrustScore(history, flags);
    this.trustScores.set(userId, score);

    const trust = this._scoreTier(score);

    return {
      userId,
      trust,
      score,
      flags,
      stats: {
        totalActions: history.actions.length,
        commits: history.commits.length,
        reveals: history.reveals.length,
        revealRate: history.commits.length > 0
          ? (history.reveals.length / history.commits.length).toFixed(3)
          : 'N/A',
        burns: history.burns.length,
        revocations: history.revocations.length,
        accountAge: Date.now() - history.firstSeen,
      },
    };
  }

  /**
   * Analyze a batch for cross-user anomalies.
   */
  analyzeBatch(batchData) {
    const { batchId, commits, reveals, outputs } = batchData;
    const flags = [];

    flags.push(...this._detectSybilCluster(commits));
    flags.push(...this._detectCollusionRing(commits, reveals));
    if (outputs) {
      flags.push(...this._detectPlagiarism(outputs));
    }

    this.flags.push(...flags);
    this.batchHistory.push({ batchId, flags, analyzedAt: Date.now() });

    return {
      batchId,
      flags,
      clean: flags.filter(f => f.severity === SEVERITY.HIGH || f.severity === SEVERITY.CRITICAL).length === 0,
    };
  }

  /**
   * Get full trust report for all known users.
   */
  getTrustReport() {
    const report = [];
    for (const [userId] of this.userHistory) {
      report.push(this.analyzeUser(userId));
    }
    return report.sort((a, b) => a.score - b.score); // worst first
  }

  // ============ DETECTORS ============

  /**
   * Detect selective revealing — committing but strategically not revealing
   * to game the system (only reveal when outcome is favorable).
   */
  _detectSelectiveRevealing(history) {
    const flags = [];
    const { commits, reveals } = history;

    if (commits.length < THRESHOLDS.MIN_BATCHES_FOR_ANALYSIS) return flags;

    const revealRate = reveals.length / commits.length;

    if (revealRate < THRESHOLDS.SELECTIVE_REVEAL_RATE) {
      flags.push({
        type: 'SELECTIVE_REVEAL',
        severity: SEVERITY.HIGH,
        message: `Reveal rate ${(revealRate * 100).toFixed(1)}% — committing but selectively not revealing`,
        detail: `${reveals.length}/${commits.length} commits revealed. Below ${THRESHOLDS.SELECTIVE_REVEAL_RATE * 100}% threshold.`,
        evidence: { revealRate, commits: commits.length, reveals: reveals.length },
      });
    } else if (revealRate < 0.7) {
      flags.push({
        type: 'LOW_REVEAL_RATE',
        severity: SEVERITY.WARNING,
        message: `Reveal rate ${(revealRate * 100).toFixed(1)}% — below normal`,
        evidence: { revealRate },
      });
    }

    return flags;
  }

  /**
   * Detect sybil clusters — multiple wallets controlled by same entity.
   * Signal: commits within tight timing windows with similar outputs.
   */
  _detectSybilCluster(commits) {
    const flags = [];
    const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const timeDiff = Math.abs(sorted[j].timestamp - sorted[i].timestamp);

        if (timeDiff < THRESHOLDS.SYBIL_TIMING_WINDOW_MS && sorted[i].userId !== sorted[j].userId) {
          flags.push({
            type: 'SYBIL_TIMING',
            severity: SEVERITY.WARNING,
            message: `Suspiciously close commit timing: ${sorted[i].userId} and ${sorted[j].userId} (${timeDiff}ms apart)`,
            evidence: {
              user1: sorted[i].userId,
              user2: sorted[j].userId,
              timeDiff,
            },
          });
        }
      }
    }

    return flags;
  }

  /**
   * Detect collusion rings — users who always commit/reveal in the same batches.
   */
  _detectCollusionRing(commits, reveals) {
    const flags = [];

    // Build co-occurrence matrix
    const userBatches = new Map();
    for (const c of commits) {
      if (!userBatches.has(c.userId)) userBatches.set(c.userId, new Set());
      userBatches.get(c.userId).add(c.batchId);
    }

    const users = [...userBatches.keys()];
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const batchesA = userBatches.get(users[i]);
        const batchesB = userBatches.get(users[j]);
        const intersection = [...batchesA].filter(b => batchesB.has(b));
        const union = new Set([...batchesA, ...batchesB]);

        const correlation = intersection.length / union.size;

        if (correlation >= THRESHOLDS.COLLUSION_CORRELATION && intersection.length >= THRESHOLDS.MIN_BATCHES_FOR_ANALYSIS) {
          flags.push({
            type: 'COLLUSION_RING',
            severity: SEVERITY.HIGH,
            message: `Possible collusion: ${users[i]} and ${users[j]} co-occur in ${(correlation * 100).toFixed(0)}% of batches`,
            evidence: {
              user1: users[i],
              user2: users[j],
              correlation,
              sharedBatches: intersection.length,
            },
          });
        }
      }
    }

    return flags;
  }

  /**
   * Detect compression plagiarism — similar dictionary/glyph outputs.
   */
  _detectPlagiarism(outputs) {
    const flags = [];

    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        if (outputs[i].userId === outputs[j].userId) continue;

        const similarity = this._computeSimilarity(
          outputs[i].compressed,
          outputs[j].compressed
        );

        if (similarity >= THRESHOLDS.PLAGIARISM_HASH_OVERLAP) {
          flags.push({
            type: 'COMPRESSION_PLAGIARISM',
            severity: SEVERITY.CRITICAL,
            message: `${(similarity * 100).toFixed(0)}% output similarity between ${outputs[i].userId} and ${outputs[j].userId} — likely plagiarism`,
            evidence: {
              user1: outputs[i].userId,
              user2: outputs[j].userId,
              similarity,
            },
          });
        }
      }
    }

    return flags;
  }

  /**
   * Detect reputation churn — burning and revoking repeatedly to game rep.
   */
  _detectReputationChurn(history) {
    const flags = [];
    const { burns, revocations } = history;

    if (revocations.length >= THRESHOLDS.REPUTATION_CHURN_RATE) {
      flags.push({
        type: 'REPUTATION_CHURN',
        severity: SEVERITY.HIGH,
        message: `${revocations.length} reputation revocations — possible reputation manipulation`,
        detail: 'Burning COG then revoking endorsements suggests gaming the reputation signal.',
        evidence: { burns: burns.length, revocations: revocations.length },
      });
    }

    return flags;
  }

  /**
   * Detect activity velocity spikes — sudden burst of activity from dormant account.
   */
  _detectVelocitySpikes(history) {
    const flags = [];
    const { actions } = history;

    if (actions.length < 10) return flags;

    // Compare last hour vs average hourly rate
    const now = Date.now();
    const oneHour = 3600000;
    const recentActions = actions.filter(a => now - a.timestamp < oneHour).length;
    const accountAgeHours = Math.max(1, (now - history.firstSeen) / oneHour);
    const avgHourlyRate = actions.length / accountAgeHours;

    if (recentActions > avgHourlyRate * THRESHOLDS.VELOCITY_SPIKE_MULTIPLIER && avgHourlyRate > 0) {
      flags.push({
        type: 'VELOCITY_SPIKE',
        severity: SEVERITY.WARNING,
        message: `Activity spike: ${recentActions} actions in last hour vs ${avgHourlyRate.toFixed(1)} avg/hr`,
        detail: 'Sudden burst of activity from previously low-activity account.',
        evidence: { recentActions, avgHourlyRate, multiplier: recentActions / avgHourlyRate },
      });
    }

    return flags;
  }

  /**
   * New account risk — flag brand new accounts with high-value actions.
   */
  _detectNewAccountRisk(history) {
    const flags = [];
    const accountAge = Date.now() - history.firstSeen;
    const oneDay = 86400000;

    if (accountAge < oneDay && history.actions.length > 20) {
      flags.push({
        type: 'NEW_ACCOUNT_HIGH_ACTIVITY',
        severity: SEVERITY.WARNING,
        message: `New account (${(accountAge / 3600000).toFixed(1)}hrs) with ${history.actions.length} actions`,
        detail: 'High activity from new account could indicate bot or sybil.',
        evidence: { accountAgeMs: accountAge, actionCount: history.actions.length },
      });
    }

    return flags;
  }

  // ============ SCORING ============

  /**
   * Composite trust score: 0-100.
   * Starts at 50, adjusted by behavior signals.
   */
  _computeTrustScore(history, flags) {
    let score = 50;

    // Positive signals
    const revealRate = history.commits.length > 0
      ? history.reveals.length / history.commits.length : 0;
    score += revealRate * 20;                                    // Up to +20 for honest revealing
    score += Math.min(history.mining.length * 2, 15);            // Up to +15 for mining
    score += Math.min(history.burns.length * 3, 10);             // Up to +10 for reputation burns
    score += Math.min((Date.now() - history.firstSeen) / 86400000, 5); // Up to +5 for account age (days)

    // Negative signals from flags
    for (const flag of flags) {
      switch (flag.severity) {
        case SEVERITY.CRITICAL: score -= 30; break;
        case SEVERITY.HIGH: score -= 15; break;
        case SEVERITY.WARNING: score -= 5; break;
        case SEVERITY.INFO: score -= 1; break;
      }
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  _scoreTier(score) {
    if (score >= 80) return 'TRUSTED';
    if (score >= 60) return 'NORMAL';
    if (score >= 40) return 'CAUTIOUS';
    if (score >= 20) return 'SUSPICIOUS';
    return 'FLAGGED';
  }

  _computeSimilarity(str1, str2) {
    const set1 = new Set(str1.split(/\s+/));
    const set2 = new Set(str2.split(/\s+/));
    const intersection = [...set1].filter(x => set2.has(x));
    const union = new Set([...set1, ...set2]);
    return intersection.length / union.size; // Jaccard similarity
  }
}

// CLI demo
if (require.main === module) {
  console.log('=== CogProof Behavioral Trust Analyzer Demo ===\n');

  const analyzer = new BehaviorAnalyzer();

  // User A — honest participant
  console.log('--- Simulating User A (Honest) ---');
  for (let i = 0; i < 10; i++) {
    analyzer.recordAction('alice', { type: 'COMMIT', batchId: i });
    analyzer.recordAction('alice', { type: 'REVEAL', batchId: i });
    analyzer.recordAction('alice', { type: 'MINE', batchId: i, ratio: 0.3 });
  }
  analyzer.recordAction('alice', { type: 'REP_COMMIT', amount: 100 });
  const reportA = analyzer.analyzeUser('alice');
  console.log(`  Trust: ${reportA.trust} (${reportA.score}/100)`);
  console.log(`  Reveal rate: ${reportA.stats.revealRate}`);
  console.log(`  Flags: ${reportA.flags.length === 0 ? 'None ✓' : reportA.flags.map(f => f.type).join(', ')}\n`);

  // User B — selective revealer (scam pattern)
  console.log('--- Simulating User B (Selective Revealer) ---');
  for (let i = 0; i < 10; i++) {
    analyzer.recordAction('bob', { type: 'COMMIT', batchId: i });
    if (i < 3) { // only reveals 3/10 — gaming the system
      analyzer.recordAction('bob', { type: 'REVEAL', batchId: i });
    }
  }
  const reportB = analyzer.analyzeUser('bob');
  console.log(`  Trust: ${reportB.trust} (${reportB.score}/100)`);
  console.log(`  Reveal rate: ${reportB.stats.revealRate}`);
  console.log(`  Flags:`);
  for (const f of reportB.flags) {
    console.log(`    [${f.severity}] ${f.message}`);
  }
  console.log('');

  // User C — reputation churner
  console.log('--- Simulating User C (Reputation Manipulator) ---');
  for (let i = 0; i < 8; i++) {
    analyzer.recordAction('charlie', { type: 'REP_COMMIT', amount: 10 });
    analyzer.recordAction('charlie', { type: 'REP_REVOKE', target: `victim_${i}` });
  }
  analyzer.recordAction('charlie', { type: 'COMMIT', batchId: 0 });
  analyzer.recordAction('charlie', { type: 'REVEAL', batchId: 0 });
  const reportC = analyzer.analyzeUser('charlie');
  console.log(`  Trust: ${reportC.trust} (${reportC.score}/100)`);
  console.log(`  Burns: ${reportC.stats.burns} | Revocations: ${reportC.stats.revocations}`);
  console.log(`  Flags:`);
  for (const f of reportC.flags) {
    console.log(`    [${f.severity}] ${f.message}`);
  }
  console.log('');

  // Batch analysis — sybil detection
  console.log('--- Batch Analysis (Sybil Detection) ---');
  const now = Date.now();
  const batchResult = analyzer.analyzeBatch({
    batchId: 99,
    commits: [
      { userId: 'sybil_1', timestamp: now, batchId: 99 },
      { userId: 'sybil_2', timestamp: now + 500, batchId: 99 },  // 500ms apart
      { userId: 'legit_user', timestamp: now + 30000, batchId: 99 },  // 30s apart
    ],
    reveals: [],
    outputs: [
      { userId: 'sybil_1', compressed: 'the quick brown fox jumps over the lazy dog near the river bank' },
      { userId: 'sybil_2', compressed: 'the quick brown fox jumps over the lazy dog near the river bank today' },
      { userId: 'legit_user', compressed: 'bitcoin protocol enables trustless value transfer across global network' },
    ],
  });

  console.log(`  Batch clean: ${batchResult.clean ? '✓' : '✗ FLAGGED'}`);
  for (const f of batchResult.flags) {
    console.log(`    [${f.severity}] ${f.message}`);
  }

  console.log('\n--- Trust Report (All Users) ---');
  const fullReport = analyzer.getTrustReport();
  for (const r of fullReport) {
    const indicator = r.trust === 'FLAGGED' || r.trust === 'SUSPICIOUS' ? '⚠' : '✓';
    console.log(`  ${indicator} ${r.userId.padEnd(12)} ${r.trust.padEnd(12)} ${r.score}/100  flags: ${r.flags.length}`);
  }
}

module.exports = { BehaviorAnalyzer, THRESHOLDS, SEVERITY };
