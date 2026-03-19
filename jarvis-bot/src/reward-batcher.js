// ============ REWARD BATCHER — TG Contributions → On-Chain Shapley Games ============
//
// The missing bridge between "everybody is a dev" and "everybody gets paid."
//
// Flow:
//   1. Collect contributions from tracker.js (already tracked)
//   2. Filter to users with linked wallets
//   3. Compute weighted Shapley participant data
//   4. Call EmissionController.createContributionGame()
//   5. Shapley settlement happens automatically
//   6. Users claim rewards via claimReward()
//
// Runs weekly or on-demand via /batch_rewards command.
// Dry-run mode when contracts aren't deployed yet.
//
// "We have clawbacks for a reason. Ship it, fix forward."
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'reward-batches');
const STATE_FILE = join(DATA_DIR, 'batches.json');

const BATCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // Weekly
const MIN_CONTRIBUTIONS = 1;     // Minimum contributions to qualify
const MIN_QUALITY_AVG = 1;       // Minimum average quality
const DRAIN_BPS = 1000;          // 10% of pool per batch
const MIN_DRAIN_BPS = 100;       // 1% minimum
const MAX_DRAIN_BPS = 5000;      // 50% maximum

// Weight configuration for Shapley participant scores
const WEIGHTS = {
  directContribution: 0.40,  // Quality * count
  timeInPool: 0.30,          // Days since first message (log scale)
  scarcity: 0.20,            // Category diversity (rare categories score higher)
  stability: 0.10,           // Consistency (messages per week)
};

// Category scarcity scores (rarer = more valuable)
const CATEGORY_SCARCITY = {
  CODE: 10000,        // Rarest — direct code contributions
  GOVERNANCE: 8000,   // Governance participation
  DESIGN: 7000,       // Design/UX insights
  REVIEW: 6000,       // Code/mechanism review
  IDEA: 5000,         // Ideas and suggestions
  COMMUNITY: 2000,    // General community participation
};

// ============ State ============

let batches = [];
let lastBatchTime = 0;
let initialized = false;

// ============ Init ============

export async function initRewardBatcher() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    batches = state.batches || [];
    lastBatchTime = state.lastBatchTime || 0;
    console.log(`[reward-batcher] Loaded ${batches.length} historical batches`);
  } catch {
    console.log('[reward-batcher] No saved state - starting fresh');
  }
  initialized = true;
}

// ============ Core: Compute Batch ============

/**
 * Compute a reward batch from tracker data.
 * Returns the batch data WITHOUT executing on-chain (use executeBatch for that).
 *
 * @param {Function} getAllUsers - From tracker.js
 * @param {Function} getUserStats - From tracker.js
 * @param {Function} getUserWallet - From tracker.js
 * @returns {Object} Batch data with participants and computed values
 */
export function computeBatch(getAllUsers, getUserStats, getUserWallet) {
  const users = getAllUsers();
  const participants = [];
  const excluded = [];

  for (const [telegramId, userData] of Object.entries(users)) {
    const wallet = getUserWallet(telegramId);
    const stats = getUserStats(telegramId);

    // Must have linked wallet
    if (!wallet) {
      excluded.push({ username: userData.username || telegramId, reason: 'no wallet linked' });
      continue;
    }

    // Must meet minimum thresholds
    if (!stats || stats.contributions < MIN_CONTRIBUTIONS) {
      excluded.push({ username: userData.username || telegramId, reason: 'below minimum contributions' });
      continue;
    }

    if (stats.avgQuality < MIN_QUALITY_AVG) {
      excluded.push({ username: userData.username || telegramId, reason: 'below quality threshold' });
      continue;
    }

    // Compute weighted scores
    const qualityScore = stats.avgQuality * stats.contributions;
    const timeScore = Math.log2(Math.max(1, stats.daysSinceFirst || 1)) * 1000;

    // Category diversity — reward rare contributions
    const categoryCounts = stats.categoryCounts || {};
    const categoryScore = Object.entries(categoryCounts).reduce((sum, [cat, count]) => {
      return sum + (CATEGORY_SCARCITY[cat] || 2000) * count;
    }, 0) / Math.max(1, stats.contributions);

    // Stability — messages per week (consistency)
    const weeks = Math.max(1, (stats.daysSinceFirst || 1) / 7);
    const msgPerWeek = stats.messageCount / weeks;
    const stabilityScore = Math.min(10000, msgPerWeek * 1000);

    // Scale to wei-like values for Shapley (multiply by 1e18 conceptually)
    const directContribution = Math.floor(qualityScore * 1e4);
    const timeInPool = Math.floor(timeScore);
    const scarcityBps = Math.min(10000, Math.floor(categoryScore));
    const stabilityBps = Math.min(10000, Math.floor(stabilityScore));

    participants.push({
      telegramId,
      username: userData.username || userData.firstName || telegramId,
      wallet,
      directContribution,
      timeInPool: Math.floor((stats.daysSinceFirst || 0) * 86400),
      scarcityScore: scarcityBps,
      stabilityScore: stabilityBps,
      // Metadata for display
      meta: {
        contributions: stats.contributions,
        avgQuality: stats.avgQuality,
        daysSinceFirst: stats.daysSinceFirst || 0,
        topCategory: Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'COMMUNITY',
        messageCount: stats.messageCount,
      },
    });
  }

  // Sort by directContribution (highest first)
  participants.sort((a, b) => b.directContribution - a.directContribution);

  const batchId = createHash('sha256')
    .update(`batch_${Date.now()}_${participants.length}`)
    .digest('hex')
    .slice(0, 16);

  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));

  return {
    batchId,
    weekNumber,
    timestamp: Date.now(),
    participants,
    excluded,
    totalParticipants: participants.length,
    totalExcluded: excluded.length,
    drainBps: DRAIN_BPS,
    status: 'computed',
  };
}

// ============ Execute Batch On-Chain ============

/**
 * Execute a computed batch on-chain.
 * Calls EmissionController.createContributionGame() with the participant list.
 *
 * @param {Object} batch - Computed batch from computeBatch()
 * @param {Object} contracts - { emissionController, signer } ethers.js instances
 * @returns {Object} Transaction result
 */
export async function executeBatch(batch, contracts) {
  if (!contracts?.emissionController) {
    console.log('[reward-batcher] No contracts available - dry run only');
    batch.status = 'dry_run';
    batches.push(batch);
    await save();
    return { success: false, reason: 'no contracts', batch };
  }

  try {
    // Prepare on-chain participant data
    const onChainParticipants = batch.participants.map(p => ({
      participant: p.wallet,
      directContribution: BigInt(p.directContribution) * BigInt(1e14), // Scale to wei
      timeInPool: BigInt(p.timeInPool),
      scarcityScore: BigInt(p.scarcityScore),
      stabilityScore: BigInt(p.stabilityScore),
    }));

    // Generate game ID from batch
    const gameId = '0x' + createHash('sha256')
      .update(`vibeswap_week_${batch.weekNumber}_${batch.batchId}`)
      .digest('hex');

    // Execute on-chain
    const tx = await contracts.emissionController.createContributionGame(
      gameId,
      onChainParticipants,
      batch.drainBps,
    );

    const receipt = await tx.wait();

    batch.status = 'executed';
    batch.txHash = receipt.hash;
    batch.gameId = gameId;
    batch.blockNumber = receipt.blockNumber;

    batches.push(batch);
    lastBatchTime = Date.now();
    await save();

    console.log(
      `[reward-batcher] Batch executed on-chain: ${receipt.hash}`
      + ` (${batch.totalParticipants} participants, game: ${gameId.slice(0, 10)}...)`
    );

    return { success: true, txHash: receipt.hash, gameId, batch };
  } catch (err) {
    console.error(`[reward-batcher] On-chain execution failed: ${err.message}`);
    batch.status = 'failed';
    batch.error = err.message;
    batches.push(batch);
    await save();
    return { success: false, reason: err.message, batch };
  }
}

// ============ Format for Display ============

/**
 * Format a batch for TG announcement.
 */
export function formatBatchAnnouncement(batch) {
  const lines = [
    `VIBE Reward Batch #${batches.length + 1}`,
    `Week ${batch.weekNumber} | ${batch.totalParticipants} contributors`,
    '',
  ];

  // Top contributors
  const top = batch.participants.slice(0, 10);
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const m = p.meta;
    lines.push(
      `${i + 1}. @${p.username} - ${m.contributions} contributions`
      + ` (avg quality: ${m.avgQuality.toFixed(1)}, ${m.daysSinceFirst}d active)`
    );
  }

  if (batch.totalParticipants > 10) {
    lines.push(`... and ${batch.totalParticipants - 10} more`);
  }

  lines.push('');

  if (batch.status === 'executed') {
    lines.push(`On-chain game created. Claim your VIBE via claimReward().`);
    lines.push(`TX: ${batch.txHash}`);
  } else if (batch.status === 'dry_run') {
    lines.push(`Dry run - contracts not yet deployed.`);
    lines.push(`Your contributions are recorded and will be rewarded retroactively.`);
  } else if (batch.status === 'computed') {
    lines.push(`Batch computed. Awaiting on-chain execution.`);
  }

  if (batch.totalExcluded > 0) {
    const noWallet = batch.excluded.filter(e => e.reason === 'no wallet linked').length;
    if (noWallet > 0) {
      lines.push('');
      lines.push(`${noWallet} members need to link wallets. Use /linkwallet 0xYourAddress`);
    }
  }

  lines.push('');
  lines.push('Distribution: Shapley fair value. Nobody gets zero (Lawson floor: 1%).');
  lines.push('You don\'t need to write code. Your insights ARE the contributions.');

  return lines.join('\n');
}

/**
 * Format detailed stats for a user.
 */
export function formatUserRewardStatus(telegramId, getUserStats, getUserWallet) {
  const stats = getUserStats(telegramId);
  const wallet = getUserWallet(telegramId);

  if (!stats) return 'No contributions tracked yet. Start chatting with insights!';

  const lines = [
    'Your Contribution Status:',
    '',
    `Messages: ${stats.messageCount}`,
    `Contributions: ${stats.contributions}`,
    `Avg Quality: ${(stats.avgQuality || 0).toFixed(1)}/5`,
    `Active: ${stats.daysSinceFirst || 0} days`,
    `Top Category: ${Object.entries(stats.categoryCounts || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None'}`,
    '',
    `Wallet: ${wallet ? wallet.slice(0, 6) + '...' + wallet.slice(-4) : 'NOT LINKED - use /linkwallet 0xYourAddress'}`,
    '',
  ];

  if (!wallet) {
    lines.push('You MUST link a wallet to receive VIBE rewards.');
    lines.push('Run: /linkwallet 0xYourEthereumAddress');
  } else {
    lines.push('You\'re eligible for the next reward batch.');

    // Check historical batches
    const userBatches = batches.filter(b =>
      b.participants?.some(p => p.telegramId === String(telegramId))
    );
    if (userBatches.length > 0) {
      lines.push(`Included in ${userBatches.length} batch(es) so far.`);
    }
  }

  return lines.join('\n');
}

// ============ Stats ============

export function getBatcherStats() {
  return {
    totalBatches: batches.length,
    executedBatches: batches.filter(b => b.status === 'executed').length,
    dryRunBatches: batches.filter(b => b.status === 'dry_run').length,
    lastBatchTime,
    totalParticipantsRewarded: batches
      .filter(b => b.status === 'executed')
      .reduce((sum, b) => sum + b.totalParticipants, 0),
    recentBatches: batches.slice(-5).map(b => ({
      batchId: b.batchId,
      status: b.status,
      participants: b.totalParticipants,
      timestamp: b.timestamp,
      gameId: b.gameId,
    })),
  };
}

// ============ Persistence ============

async function save() {
  try {
    await writeFile(STATE_FILE, JSON.stringify({
      batches,
      lastBatchTime,
    }, null, 2));
  } catch (err) {
    console.error(`[reward-batcher] Save failed: ${err.message}`);
  }
}
