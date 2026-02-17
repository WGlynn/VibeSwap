import { ethers } from 'ethers';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

// EIP-712 type definitions matching GitHubContributionTracker.sol
const CONTRIBUTION_TYPES = {
  GitHubContribution: [
    { name: 'contributor', type: 'address' },
    { name: 'repoHash', type: 'bytes32' },
    { name: 'commitHash', type: 'bytes32' },
    { name: 'contribType', type: 'uint8' },
    { name: 'value', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'evidenceHash', type: 'bytes32' },
  ],
};

const DOMAIN = {
  name: 'GitHubContributionTracker',
  version: '1',
};

// Contribution type enum matching contract
const ContributionType = {
  COMMIT: 0,
  PR_MERGED: 1,
  REVIEW: 2,
  ISSUE_CLOSED: 3,
};

// Minimal ABI for GitHubContributionTracker (only functions we call)
const TRACKER_ABI = [
  'function recordContribution((address contributor, bytes32 repoHash, bytes32 commitHash, uint8 contribType, uint256 value, uint256 timestamp, bytes32 evidenceHash) contribution, bytes signature) external',
  'function recordContributionBatch((address contributor, bytes32 repoHash, bytes32 commitHash, uint8 contribType, uint256 value, uint256 timestamp, bytes32 evidenceHash)[] contributions, bytes[] signatures) external',
  'function getContributionCount() external view returns (uint256)',
  'function getContributorStats(address) external view returns (uint256, uint256)',
  'function authorizedRelayers(address) external view returns (bool)',
  'function githubAccountHash(address) external view returns (bytes32)',
];

export class GitHubRelayerService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.contract = null;
    this.webhookSecret = null;
    this.pendingBatch = [];
    this.batchTimer = null;
    this.isInitialized = false;
  }

  // ============ Initialization ============

  initialize() {
    const rpcUrl = process.env.RELAYER_RPC_URL || process.env.ETH_RPC_URL;
    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    const contractAddr = process.env.GITHUB_TRACKER_ADDRESS;
    const chainId = parseInt(process.env.RELAYER_CHAIN_ID || '1');

    if (!rpcUrl || !privateKey || !contractAddr) {
      logger.warn('GitHub relayer not configured — skipping initialization');
      return false;
    }

    this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    this.batchSize = parseInt(process.env.RELAYER_BATCH_SIZE || '10');
    this.batchInterval = parseInt(process.env.RELAYER_BATCH_INTERVAL || '60000');

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddr, TRACKER_ABI, this.wallet);
    this.chainId = chainId;
    this.contractAddr = contractAddr;

    // Start batch flush timer
    this.batchTimer = setInterval(() => this._flushBatch(), this.batchInterval);

    this.isInitialized = true;
    logger.info({
      relayer: this.wallet.address,
      contract: contractAddr,
      chainId,
    }, 'GitHub relayer initialized');

    return true;
  }

  shutdown() {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    // Flush remaining batch
    if (this.pendingBatch.length > 0) {
      this._flushBatch().catch(err =>
        logger.error({ err }, 'Failed to flush batch on shutdown')
      );
    }
  }

  // ============ Webhook Verification ============

  verifyWebhookSignature(payload, signature) {
    if (!this.webhookSecret) return true; // Skip if no secret configured

    const expected = 'sha256=' + crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload, 'utf-8')
      .digest('hex');

    const sigBuf = Buffer.from(signature || '');
    const expBuf = Buffer.from(expected);

    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  // ============ Event Processing ============

  async processWebhookEvent(eventType, payload) {
    if (!this.isInitialized) {
      throw new Error('Relayer not initialized');
    }

    const contributions = this._parseGitHubEvent(eventType, payload);
    if (contributions.length === 0) return { queued: 0 };

    // Add to batch
    for (const contrib of contributions) {
      this.pendingBatch.push(contrib);
    }

    logger.info({
      eventType,
      contributions: contributions.length,
      batchSize: this.pendingBatch.length,
    }, 'Queued GitHub contributions');

    // Flush if batch is full
    if (this.pendingBatch.length >= this.batchSize) {
      await this._flushBatch();
    }

    return { queued: contributions.length };
  }

  _parseGitHubEvent(eventType, payload) {
    const contributions = [];

    switch (eventType) {
      case 'push': {
        // Each commit in a push
        const repo = payload.repository?.full_name || '';
        for (const commit of (payload.commits || [])) {
          contributions.push({
            repoFullName: repo,
            commitSha: commit.id,
            contribType: ContributionType.COMMIT,
            timestamp: Math.floor(new Date(commit.timestamp).getTime() / 1000),
            authorEmail: commit.author?.email,
            authorUsername: commit.author?.username || payload.sender?.login,
            message: commit.message,
            additions: commit.added?.length || 0,
            modifications: commit.modified?.length || 0,
          });
        }
        break;
      }

      case 'pull_request': {
        if (payload.action !== 'closed' || !payload.pull_request?.merged) break;
        const repo = payload.repository?.full_name || '';
        const pr = payload.pull_request;
        contributions.push({
          repoFullName: repo,
          commitSha: `pr-${pr.number}`,
          contribType: ContributionType.PR_MERGED,
          timestamp: Math.floor(new Date(pr.merged_at).getTime() / 1000),
          authorUsername: pr.user?.login,
          message: pr.title,
          additions: pr.additions || 0,
          modifications: pr.changed_files || 0,
        });
        break;
      }

      case 'pull_request_review': {
        if (payload.action !== 'submitted') break;
        const repo = payload.repository?.full_name || '';
        const review = payload.review;
        contributions.push({
          repoFullName: repo,
          commitSha: `review-${review.id}`,
          contribType: ContributionType.REVIEW,
          timestamp: Math.floor(new Date(review.submitted_at).getTime() / 1000),
          authorUsername: review.user?.login,
          message: review.body || `Review on PR #${payload.pull_request?.number}`,
          additions: 0,
          modifications: 0,
        });
        break;
      }

      case 'issues': {
        if (payload.action !== 'closed') break;
        const repo = payload.repository?.full_name || '';
        const issue = payload.issue;
        contributions.push({
          repoFullName: repo,
          commitSha: `issue-${issue.number}`,
          contribType: ContributionType.ISSUE_CLOSED,
          timestamp: Math.floor(new Date(issue.closed_at).getTime() / 1000),
          authorUsername: issue.user?.login,
          message: issue.title,
          additions: 0,
          modifications: 0,
        });
        break;
      }
    }

    return contributions;
  }

  // ============ EIP-712 Signing + Batch Submission ============

  async _flushBatch() {
    if (this.pendingBatch.length === 0) return;

    const batch = this.pendingBatch.splice(0, this.batchSize);
    logger.info({ count: batch.length }, 'Flushing contribution batch');

    try {
      const { contributions, signatures } = await this._signBatch(batch);

      if (contributions.length === 1) {
        const tx = await this.contract.recordContribution(
          contributions[0], signatures[0]
        );
        const receipt = await tx.wait();
        logger.info({
          txHash: receipt.hash,
          gasUsed: receipt.gasUsed.toString(),
        }, 'Single contribution recorded on-chain');
      } else {
        const tx = await this.contract.recordContributionBatch(
          contributions, signatures
        );
        const receipt = await tx.wait();
        logger.info({
          txHash: receipt.hash,
          gasUsed: receipt.gasUsed.toString(),
          count: contributions.length,
        }, 'Batch contributions recorded on-chain');
      }
    } catch (err) {
      logger.error({ err, count: batch.length }, 'Failed to submit batch');
      // Re-queue failed items (at front)
      this.pendingBatch.unshift(...batch);
    }
  }

  async _signBatch(batch) {
    const domain = {
      ...DOMAIN,
      chainId: this.chainId,
      verifyingContract: this.contractAddr,
    };

    const contributions = [];
    const signatures = [];

    for (const item of batch) {
      // Resolve contributor address from GitHub username
      const contributor = await this._resolveContributor(item.authorUsername);
      if (!contributor) {
        logger.warn({ username: item.authorUsername }, 'No bound address for GitHub user — skipping');
        continue;
      }

      const repoHash = ethers.keccak256(ethers.toUtf8Bytes(item.repoFullName));
      const commitHash = ethers.keccak256(ethers.toUtf8Bytes(item.commitSha));

      // Evidence hash = hash of full contribution data (for IPFS pinning later)
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
        repo: item.repoFullName,
        commit: item.commitSha,
        message: item.message,
        type: item.contribType,
        author: item.authorUsername,
      })));

      const value = {
        contributor,
        repoHash,
        commitHash,
        contribType: item.contribType,
        value: 0, // Use contract default reward values
        timestamp: item.timestamp,
        evidenceHash,
      };

      // EIP-712 sign
      const signature = await this.wallet.signTypedData(
        domain,
        CONTRIBUTION_TYPES,
        value
      );

      contributions.push(value);
      signatures.push(signature);
    }

    return { contributions, signatures };
  }

  // ============ Contributor Resolution ============

  // In-memory cache: GitHub username → on-chain address
  // In production, this would be backed by a database or on-chain lookup
  _contributorCache = new Map();

  async _resolveContributor(githubUsername) {
    if (!githubUsername) return null;

    // Check cache
    if (this._contributorCache.has(githubUsername)) {
      return this._contributorCache.get(githubUsername);
    }

    // Check .env for static mappings: GITHUB_MAP_username=0x...
    const envKey = `GITHUB_MAP_${githubUsername.toUpperCase()}`;
    const envAddr = process.env[envKey];
    if (envAddr && ethers.isAddress(envAddr)) {
      this._contributorCache.set(githubUsername, envAddr);
      return envAddr;
    }

    return null;
  }

  registerContributor(githubUsername, address) {
    this._contributorCache.set(githubUsername, address);
    logger.info({ githubUsername, address }, 'Contributor registered');
  }

  // ============ Status ============

  async getStatus() {
    if (!this.isInitialized) {
      return { initialized: false };
    }

    try {
      const [isAuthorized, balance, contribCount] = await Promise.all([
        this.contract.authorizedRelayers(this.wallet.address),
        this.provider.getBalance(this.wallet.address),
        this.contract.getContributionCount(),
      ]);

      return {
        initialized: true,
        relayerAddress: this.wallet.address,
        isAuthorized,
        balance: ethers.formatEther(balance),
        contractContributions: contribCount.toString(),
        pendingBatch: this.pendingBatch.length,
        registeredContributors: this._contributorCache.size,
      };
    } catch (err) {
      return {
        initialized: true,
        error: err.message,
      };
    }
  }
}
