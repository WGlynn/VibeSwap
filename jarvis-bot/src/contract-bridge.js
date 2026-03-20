// ============ Contract Bridge — TG Bot → On-Chain ============
//
// Connects the reward-batcher and other modules to deployed contracts
// via wallet.js's callContract(). Keeps spending limits and ledger
// in the loop — no raw ethers.js bypassing the wallet's safety rails.
//
// Usage:
//   import { getContracts, callEmission, callShapley } from './contract-bridge.js'
//   const result = await callEmission('drip', [])
//   const batch = await callEmission('createContributionGame', [gameId, participants, drainBps])
//
// Contract addresses loaded from environment variables.
// ABIs are minimal — only the functions we actually call.
// ============

import { callContract, isUnlocked } from './wallet.js';

// ============ Contract Addresses (from .env) ============

const CONTRACTS = {
  EMISSION_CONTROLLER: process.env.EMISSION_CONTROLLER || '',
  SHAPLEY_DISTRIBUTOR: process.env.SHAPLEY_DISTRIBUTOR || '',
  VIBE_TOKEN: process.env.VIBE_TOKEN || '',
  SOULBOUND_IDENTITY: process.env.SOULBOUND_IDENTITY || '',
  CONTRIBUTION_DAG: process.env.CONTRIBUTION_DAG || '',
};

// ============ Minimal ABIs (only functions we call) ============

const EMISSION_ABI = [
  'function drip() external',
  'function createContributionGame(bytes32 gameId, tuple(address participant, uint256 directContribution, uint256 timeInPool, uint256 scarcityScore, uint256 stabilityScore)[] participants, uint256 drainBps) external',
  'function getEmissionInfo() external view returns (uint256 era, uint256 rate, uint256 pool, uint256 pending, uint256 totalEmitted, uint256 remaining)',
  'function shapleyPool() external view returns (uint256)',
  'function setBudget(uint256 shapleyBps, uint256 gaugeBps, uint256 stakingBps) external',
];

const SHAPLEY_ABI = [
  'function claimReward(bytes32 gameId) external',
  'function getGameInfo(bytes32 gameId) external view returns (uint256 totalValue, address token, bool settled, uint256 participantCount)',
  'function shapleyValues(bytes32 gameId, address participant) external view returns (uint256)',
];

const VIBE_ABI = [
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];

const IDENTITY_ABI = [
  'function mintIdentity(string username, uint8 level) external',
  'function recordContribution(address author, bytes32 contentHash, uint8 cType) external',
  'function hasIdentity(address user) external view returns (bool)',
];

const DAG_ABI = [
  'function addVouch(address to, bytes32 messageHash) external',
  'function getTrustScore(address user) external view returns (uint256)',
  'function recalculateTrustScores() external',
];

// ============ Call Helpers ============

/**
 * Call a function on the EmissionController.
 */
export async function callEmission(functionName, args = []) {
  if (!CONTRACTS.EMISSION_CONTROLLER) return { error: 'EMISSION_CONTROLLER not configured' };
  return callContract({
    chain: 'base',
    contractAddress: CONTRACTS.EMISSION_CONTROLLER,
    abi: EMISSION_ABI,
    functionName,
    args,
  });
}

/**
 * Call a function on the ShapleyDistributor.
 */
export async function callShapley(functionName, args = []) {
  if (!CONTRACTS.SHAPLEY_DISTRIBUTOR) return { error: 'SHAPLEY_DISTRIBUTOR not configured' };
  return callContract({
    chain: 'base',
    contractAddress: CONTRACTS.SHAPLEY_DISTRIBUTOR,
    abi: SHAPLEY_ABI,
    functionName,
    args,
  });
}

/**
 * Call a function on the VIBEToken.
 */
export async function callVibe(functionName, args = []) {
  if (!CONTRACTS.VIBE_TOKEN) return { error: 'VIBE_TOKEN not configured' };
  return callContract({
    chain: 'base',
    contractAddress: CONTRACTS.VIBE_TOKEN,
    abi: VIBE_ABI,
    functionName,
    args,
  });
}

/**
 * Call a function on SoulboundIdentity.
 */
export async function callIdentity(functionName, args = []) {
  if (!CONTRACTS.SOULBOUND_IDENTITY) return { error: 'SOULBOUND_IDENTITY not configured' };
  return callContract({
    chain: 'base',
    contractAddress: CONTRACTS.SOULBOUND_IDENTITY,
    abi: IDENTITY_ABI,
    functionName,
    args,
  });
}

/**
 * Call a function on ContributionDAG.
 */
export async function callDAG(functionName, args = []) {
  if (!CONTRACTS.CONTRIBUTION_DAG) return { error: 'CONTRIBUTION_DAG not configured' };
  return callContract({
    chain: 'base',
    contractAddress: CONTRACTS.CONTRIBUTION_DAG,
    abi: DAG_ABI,
    functionName,
    args,
  });
}

// ============ High-Level Operations ============

/**
 * Execute a reward batch on-chain.
 * Called by reward-batcher.js executeBatch().
 */
export async function executeRewardBatch(gameId, participants, drainBps) {
  if (!isUnlocked()) return { error: 'Wallet is locked. Use /unlock first.' };

  console.log(`[contract-bridge] Executing reward batch: ${gameId.slice(0, 10)}... (${participants.length} participants, ${drainBps} bps)`);

  const result = await callEmission('createContributionGame', [gameId, participants, drainBps]);

  if (result.error) {
    console.error(`[contract-bridge] Batch execution failed: ${result.error}`);
  } else {
    console.log(`[contract-bridge] Batch executed: ${result.hash}`);
  }

  return result;
}

/**
 * Call drip() to mint accrued VIBE.
 */
export async function drip() {
  if (!isUnlocked()) return { error: 'Wallet is locked.' };
  return callEmission('drip');
}

/**
 * Get current emission state.
 */
export async function getEmissionInfo() {
  return callEmission('getEmissionInfo');
}

/**
 * Get VIBE balance for an address.
 */
export async function getVibeBalance(address) {
  return callVibe('balanceOf', [address]);
}

/**
 * Check if an address has a SoulboundIdentity.
 */
export async function hasIdentity(address) {
  return callIdentity('hasIdentity', [address]);
}

/**
 * Get trust score for an address.
 */
export async function getTrustScore(address) {
  return callDAG('getTrustScore', [address]);
}

// ============ Status ============

export function getContractAddresses() {
  return {
    ...CONTRACTS,
    configured: Object.values(CONTRACTS).filter(v => v.length > 0).length,
    total: Object.keys(CONTRACTS).length,
  };
}

export function isConfigured() {
  // Minimum: EMISSION_CONTROLLER must be set for rewards to work
  return CONTRACTS.EMISSION_CONTROLLER.length > 0;
}
