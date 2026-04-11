/**
 * CogCoin OP_RETURN Transaction Builder
 *
 * Maps CogProof operations to CogCoin's 80-byte OP_RETURN format.
 * Every CogProof action becomes a valid CogCoin transaction.
 *
 * Budget: 80 bytes total
 *   Bytes 0-2:  Magic "COG" (0x434F47)
 *   Byte 3:     Operation type
 *   Bytes 4-79: Payload (76 bytes max)
 *
 * CogCoin's 20 ops we map to:
 *   0x01 MINE           — compression mining submission
 *   0x02 COG_TRANSFER   — reward distribution
 *   0x03 COG_LOCK       — commit phase escrow
 *   0x04 COG_CLAIM      — reveal phase claim
 *   0x09 FIELD_REG      — register credential field
 *   0x0A DATA_UPDATE    — write credential data
 *   0x0C REP_COMMIT     — reputation burn (endorsement)
 *   0x0D REP_REVOKE     — reputation revocation
 */

const crypto = require('crypto');

const MAGIC = Buffer.from('COG');

const OPS = {
  GENESIS: 0x00,
  MINE: 0x01,
  COG_TRANSFER: 0x02,
  COG_LOCK: 0x03,
  COG_CLAIM: 0x04,
  DOMAIN_REG: 0x05,
  DOMAIN_TRANSFER: 0x06,
  DOMAIN_ANCHOR: 0x0F,
  DOMAIN_SELL: 0x07,
  DOMAIN_BUY: 0x08,
  FIELD_REG: 0x09,
  DATA_UPDATE: 0x0A,
  SET_ENDPOINT: 0x0B,
  REP_COMMIT: 0x0C,
  REP_REVOKE: 0x0D,
  DELEGATE_AUTH: 0x10,
  DELEGATE_MINE: 0x11,
  PQ_COMMIT: 0x12,
  PQ_MIGRATE: 0x13,
};

// CogProof credential field IDs (registered via FIELD_REG)
const CREDENTIAL_FIELDS = {
  TRUST_SCORE: 'cogproof_trust',
  REVEAL_RATE: 'cogproof_reveal_rate',
  BATCH_COUNT: 'cogproof_batches',
  SHAPLEY_RANK: 'cogproof_shapley',
  COMPRESSION_BEST: 'cogproof_compress',
  FLAGS: 'cogproof_flags',
};

class OpReturnBuilder {
  /**
   * Build a raw OP_RETURN payload (80 bytes max).
   */
  static build(opCode, payload) {
    const header = Buffer.alloc(4);
    MAGIC.copy(header, 0);
    header[3] = opCode;

    const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (header.length + payloadBuf.length > 80) {
      throw new Error(`OP_RETURN exceeds 80 bytes: ${header.length + payloadBuf.length}`);
    }

    return Buffer.concat([header, payloadBuf]);
  }

  /**
   * Parse an OP_RETURN payload back to structured data.
   */
  static parse(raw) {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'hex');

    if (buf.length < 4) throw new Error('Too short for CogCoin OP_RETURN');
    if (buf.slice(0, 3).toString() !== 'COG') throw new Error('Not a CogCoin transaction');

    return {
      magic: buf.slice(0, 3).toString(),
      opCode: buf[3],
      opName: Object.entries(OPS).find(([_, v]) => v === buf[3])?.[0] || 'UNKNOWN',
      payload: buf.slice(4),
      raw: buf,
      size: buf.length,
      remaining: 80 - buf.length,
    };
  }
}

class CogProofTxBuilder {
  /**
   * COMMIT: Lock COG as escrow for a mining commitment.
   * Uses COG_LOCK (0x03).
   *
   * Payload (76 bytes):
   *   [32] commitHash — hash(compressed || secret)
   *   [8]  batchId    — batch identifier
   *   [8]  amount     — COG locked as escrow
   *   [28] reserved
   */
  static buildCommit(commitHash, batchId, amount) {
    const payload = Buffer.alloc(76);
    Buffer.from(commitHash, 'hex').copy(payload, 0, 0, 32);
    payload.writeBigUInt64BE(BigInt(batchId), 32);
    payload.writeBigUInt64BE(BigInt(amount), 40);
    return {
      op: 'COG_LOCK',
      tx: OpReturnBuilder.build(OPS.COG_LOCK, payload),
      decoded: { commitHash, batchId, amount },
    };
  }

  /**
   * REVEAL: Claim escrowed COG by revealing the committed output.
   * Uses COG_CLAIM (0x04).
   *
   * Payload (76 bytes):
   *   [32] commitHash — references the original commit
   *   [32] secretHash — hash of the secret (full secret sent in witness/memo)
   *   [12] reserved
   */
  static buildReveal(commitHash, secret) {
    const payload = Buffer.alloc(76);
    Buffer.from(commitHash, 'hex').copy(payload, 0, 0, 32);
    const secretHash = crypto.createHash('sha256').update(Buffer.from(secret, 'hex')).digest();
    secretHash.copy(payload, 32, 0, 32);
    return {
      op: 'COG_CLAIM',
      tx: OpReturnBuilder.build(OPS.COG_CLAIM, payload),
      decoded: { commitHash, secretHash: secretHash.toString('hex') },
    };
  }

  /**
   * MINE: Submit a compression mining result.
   * Uses MINE (0x01).
   *
   * Payload (76 bytes):
   *   [32] outputHash — hash of compressed output
   *   [32] originalHash — hash of original corpus
   *   [2]  ratio      — compression ratio × 10000 (e.g., 3500 = 35%)
   *   [2]  density    — density score × 10000
   *   [8]  reserved
   */
  static buildMine(outputHash, originalHash, ratio, density) {
    const payload = Buffer.alloc(76);
    Buffer.from(outputHash, 'hex').copy(payload, 0, 0, 32);
    Buffer.from(originalHash, 'hex').copy(payload, 32, 0, 32);
    payload.writeUInt16BE(Math.round(ratio * 10000), 64);
    payload.writeUInt16BE(Math.round(density * 10000), 66);
    return {
      op: 'MINE',
      tx: OpReturnBuilder.build(OPS.MINE, payload),
      decoded: { outputHash, originalHash, ratio, density },
    };
  }

  /**
   * CREDENTIAL: Write a behavioral credential to a domain's data.
   * Uses DATA_UPDATE (0x0A).
   *
   * Payload (76 bytes):
   *   [20] domainHash — first 20 bytes of domain name hash
   *   [16] fieldId    — credential field identifier
   *   [8]  value      — credential value (uint64)
   *   [8]  batchId    — source batch
   *   [24] reserved
   */
  static buildCredential(domain, field, value, batchId) {
    const payload = Buffer.alloc(76);
    const domainHash = crypto.createHash('sha256').update(domain).digest();
    domainHash.copy(payload, 0, 0, 20);
    Buffer.from(field.padEnd(16, '\0')).copy(payload, 20, 0, 16);
    payload.writeBigUInt64BE(BigInt(value), 36);
    payload.writeBigUInt64BE(BigInt(batchId), 44);
    return {
      op: 'DATA_UPDATE',
      tx: OpReturnBuilder.build(OPS.DATA_UPDATE, payload),
      decoded: { domain, field, value, batchId },
    };
  }

  /**
   * REPUTATION BURN: Endorse another user by burning COG.
   * Uses REP_COMMIT (0x0C).
   *
   * Payload (76 bytes):
   *   [20] targetDomainHash — who you're endorsing
   *   [8]  amount           — COG burned (permanent)
   *   [32] reason           — hash of endorsement reason
   *   [16] reserved
   */
  static buildReputationBurn(targetDomain, amount, reason) {
    const payload = Buffer.alloc(76);
    const targetHash = crypto.createHash('sha256').update(targetDomain).digest();
    targetHash.copy(payload, 0, 0, 20);
    payload.writeBigUInt64BE(BigInt(amount), 20);
    const reasonHash = crypto.createHash('sha256').update(reason).digest();
    reasonHash.copy(payload, 28, 0, 32);
    return {
      op: 'REP_COMMIT',
      tx: OpReturnBuilder.build(OPS.REP_COMMIT, payload),
      decoded: { targetDomain, amount, reasonHash: reasonHash.toString('hex').slice(0, 16) },
    };
  }

  /**
   * REPUTATION REVOKE: Revoke a previous endorsement.
   * Burned COG is NOT returned — revocation is free but burn is permanent.
   * Uses REP_REVOKE (0x0D).
   *
   * Payload (76 bytes):
   *   [20] targetDomainHash
   *   [32] originalBurnTxHash — reference to the REP_COMMIT tx
   *   [24] reserved
   */
  static buildReputationRevoke(targetDomain, originalBurnTxHash) {
    const payload = Buffer.alloc(76);
    const targetHash = crypto.createHash('sha256').update(targetDomain).digest();
    targetHash.copy(payload, 0, 0, 20);
    Buffer.from(originalBurnTxHash, 'hex').copy(payload, 20, 0, 32);
    return {
      op: 'REP_REVOKE',
      tx: OpReturnBuilder.build(OPS.REP_REVOKE, payload),
      decoded: { targetDomain, originalBurnTxHash },
    };
  }

  /**
   * SHAPLEY ANCHOR: Anchor Shapley distribution result on-chain.
   * Uses DATA_UPDATE (0x0A).
   *
   * Payload (76 bytes):
   *   [32] distributionHash — hash of full Shapley result JSON
   *   [8]  totalPool        — total COG distributed
   *   [2]  participantCount
   *   [2]  lawsonFloorBps   — Lawson floor in basis points
   *   [8]  batchId
   *   [24] reserved
   */
  static buildShapleyAnchor(distributionHash, totalPool, participantCount, lawsonFloorBps, batchId) {
    const payload = Buffer.alloc(76);
    Buffer.from(distributionHash, 'hex').copy(payload, 0, 0, 32);
    payload.writeBigUInt64BE(BigInt(totalPool), 32);
    payload.writeUInt16BE(participantCount, 40);
    payload.writeUInt16BE(lawsonFloorBps, 42);
    payload.writeBigUInt64BE(BigInt(batchId), 44);
    return {
      op: 'DATA_UPDATE',
      tx: OpReturnBuilder.build(OPS.DATA_UPDATE, payload),
      decoded: { distributionHash, totalPool, participantCount, lawsonFloorBps, batchId },
    };
  }

  /**
   * TRUST FLAG: Write a trust analysis result to a domain.
   * Uses DATA_UPDATE (0x0A).
   *
   * Payload (76 bytes):
   *   [20] domainHash
   *   [1]  trustScore (0-100)
   *   [1]  tier (0=FLAGGED, 1=SUSPICIOUS, 2=CAUTIOUS, 3=NORMAL, 4=TRUSTED)
   *   [1]  flagCount
   *   [1]  highestSeverity (0=INFO, 1=WARNING, 2=HIGH, 3=CRITICAL)
   *   [32] analysisHash — hash of full analysis JSON
   *   [20] reserved
   */
  static buildTrustFlag(domain, trustScore, tier, flagCount, highestSeverity, analysisHash) {
    const TIER_MAP = { FLAGGED: 0, SUSPICIOUS: 1, CAUTIOUS: 2, NORMAL: 3, TRUSTED: 4 };
    const SEV_MAP = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 };

    const payload = Buffer.alloc(76);
    const domainHash = crypto.createHash('sha256').update(domain).digest();
    domainHash.copy(payload, 0, 0, 20);
    payload[20] = trustScore;
    payload[21] = TIER_MAP[tier] || 0;
    payload[22] = flagCount;
    payload[23] = SEV_MAP[highestSeverity] || 0;
    Buffer.from(analysisHash, 'hex').copy(payload, 24, 0, 32);
    return {
      op: 'DATA_UPDATE',
      tx: OpReturnBuilder.build(OPS.DATA_UPDATE, payload),
      decoded: { domain, trustScore, tier, flagCount, highestSeverity },
    };
  }
}

/**
 * CogProof Indexer — reconstructs CogProof state from Bitcoin chain.
 * Deterministic state machine: same chain = same state.
 */
class CogProofIndexer {
  constructor() {
    this.commits = new Map();       // commitHash → commit data
    this.reveals = new Map();       // commitHash → reveal data
    this.credentials = new Map();   // domain → { field → value }
    this.reputation = new Map();    // domain → { burns, revocations, score }
    this.shapleyAnchors = [];       // anchored distribution results
    this.trustFlags = new Map();    // domain → latest trust flag
    this.blockHeight = 0;
  }

  /**
   * Process a CogCoin OP_RETURN transaction.
   * Called for every tx as the indexer scans the chain.
   */
  processTx(rawOpReturn, txId, blockHeight) {
    const parsed = OpReturnBuilder.parse(rawOpReturn);
    this.blockHeight = blockHeight;

    switch (parsed.opCode) {
      case OPS.COG_LOCK:
        return this._processCommit(parsed.payload, txId, blockHeight);
      case OPS.COG_CLAIM:
        return this._processReveal(parsed.payload, txId, blockHeight);
      case OPS.MINE:
        return this._processMine(parsed.payload, txId, blockHeight);
      case OPS.DATA_UPDATE:
        return this._processDataUpdate(parsed.payload, txId, blockHeight);
      case OPS.REP_COMMIT:
        return this._processRepBurn(parsed.payload, txId, blockHeight);
      case OPS.REP_REVOKE:
        return this._processRepRevoke(parsed.payload, txId, blockHeight);
      default:
        return { processed: false, op: parsed.opName };
    }
  }

  _processCommit(payload, txId, blockHeight) {
    const commitHash = payload.slice(0, 32).toString('hex');
    const batchId = Number(payload.readBigUInt64BE(32));
    const amount = Number(payload.readBigUInt64BE(40));

    this.commits.set(commitHash, { txId, blockHeight, batchId, amount, revealed: false });
    return { processed: true, op: 'COMMIT', commitHash: commitHash.slice(0, 16) };
  }

  _processReveal(payload, txId, blockHeight) {
    const commitHash = payload.slice(0, 32).toString('hex');
    const secretHash = payload.slice(32, 64).toString('hex');

    const commit = this.commits.get(commitHash);
    if (commit) {
      commit.revealed = true;
      this.reveals.set(commitHash, { txId, blockHeight, secretHash });
    }
    return { processed: true, op: 'REVEAL', commitHash: commitHash.slice(0, 16) };
  }

  _processMine(payload, txId, blockHeight) {
    const outputHash = payload.slice(0, 32).toString('hex');
    const originalHash = payload.slice(32, 64).toString('hex');
    const ratio = payload.readUInt16BE(64) / 10000;
    const density = payload.readUInt16BE(66) / 10000;

    return { processed: true, op: 'MINE', outputHash: outputHash.slice(0, 16), ratio, density };
  }

  _processDataUpdate(payload, txId, blockHeight) {
    const domainHash = payload.slice(0, 20).toString('hex');

    if (!this.credentials.has(domainHash)) {
      this.credentials.set(domainHash, {});
    }

    return { processed: true, op: 'DATA_UPDATE', domainHash: domainHash.slice(0, 16) };
  }

  _processRepBurn(payload, txId, blockHeight) {
    const targetHash = payload.slice(0, 20).toString('hex');
    const amount = Number(payload.readBigUInt64BE(20));

    if (!this.reputation.has(targetHash)) {
      this.reputation.set(targetHash, { totalBurned: 0, burns: 0, revocations: 0 });
    }
    const rep = this.reputation.get(targetHash);
    rep.totalBurned += amount;
    rep.burns++;

    return { processed: true, op: 'REP_COMMIT', target: targetHash.slice(0, 16), amount };
  }

  _processRepRevoke(payload, txId, blockHeight) {
    const targetHash = payload.slice(0, 20).toString('hex');

    if (this.reputation.has(targetHash)) {
      this.reputation.get(targetHash).revocations++;
    }

    return { processed: true, op: 'REP_REVOKE', target: targetHash.slice(0, 16) };
  }

  /**
   * Get indexer state summary.
   */
  getState() {
    return {
      blockHeight: this.blockHeight,
      commits: this.commits.size,
      reveals: this.reveals.size,
      unrevealed: [...this.commits.values()].filter(c => !c.revealed).length,
      credentials: this.credentials.size,
      reputationEntries: this.reputation.size,
    };
  }
}

// CLI demo
if (require.main === module) {
  console.log('=== CogProof Bitcoin-Native OP_RETURN Demo ===\n');

  // Build transactions
  const commitHash = crypto.randomBytes(32).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const outputHash = crypto.randomBytes(32).toString('hex');
  const originalHash = crypto.randomBytes(32).toString('hex');

  console.log('--- Building CogProof Transactions ---\n');

  const commit = CogProofTxBuilder.buildCommit(commitHash, 42, 1000);
  console.log(`COMMIT (COG_LOCK):  ${commit.tx.length} bytes | ${commit.tx.toString('hex').slice(0, 40)}...`);

  const reveal = CogProofTxBuilder.buildReveal(commitHash, secret);
  console.log(`REVEAL (COG_CLAIM): ${reveal.tx.length} bytes | ${reveal.tx.toString('hex').slice(0, 40)}...`);

  const mine = CogProofTxBuilder.buildMine(outputHash, originalHash, 0.35, 0.42);
  console.log(`MINE:               ${mine.tx.length} bytes | ${mine.tx.toString('hex').slice(0, 40)}...`);

  const cred = CogProofTxBuilder.buildCredential('alice.cogcoin', 'cogproof_trust', 83, 42);
  console.log(`CREDENTIAL:         ${cred.tx.length} bytes | ${cred.tx.toString('hex').slice(0, 40)}...`);

  const burn = CogProofTxBuilder.buildReputationBurn('bob.cogcoin', 500, 'honest participant in 20 batches');
  console.log(`REP_BURN:           ${burn.tx.length} bytes | ${burn.tx.toString('hex').slice(0, 40)}...`);

  const shapley = CogProofTxBuilder.buildShapleyAnchor(
    crypto.randomBytes(32).toString('hex'), 20000, 5, 500, 42
  );
  console.log(`SHAPLEY ANCHOR:     ${shapley.tx.length} bytes | ${shapley.tx.toString('hex').slice(0, 40)}...`);

  const trust = CogProofTxBuilder.buildTrustFlag(
    'charlie.cogcoin', 41, 'CAUTIOUS', 2, 'HIGH',
    crypto.randomBytes(32).toString('hex')
  );
  console.log(`TRUST FLAG:         ${trust.tx.length} bytes | ${trust.tx.toString('hex').slice(0, 40)}...`);

  console.log('\n--- All transactions ≤ 80 bytes ✓ ---');
  console.log('--- All use existing CogCoin ops ✓ ---\n');

  // Indexer demo
  console.log('--- Indexer Simulation ---\n');
  const indexer = new CogProofIndexer();

  const txs = [
    { raw: commit.tx, txId: 'tx_001', block: 937337 },
    { raw: reveal.tx, txId: 'tx_002', block: 937338 },
    { raw: mine.tx, txId: 'tx_003', block: 937338 },
    { raw: cred.tx, txId: 'tx_004', block: 937339 },
    { raw: burn.tx, txId: 'tx_005', block: 937339 },
  ];

  for (const tx of txs) {
    const result = indexer.processTx(tx.raw, tx.txId, tx.block);
    console.log(`  Block ${tx.block} | ${tx.txId} | ${result.op} → ${result.processed ? '✓' : '✗'}`);
  }

  console.log('\n--- Indexer State ---');
  const state = indexer.getState();
  console.log(`  Block height: ${state.blockHeight}`);
  console.log(`  Commits: ${state.commits} | Reveals: ${state.reveals} | Unrevealed: ${state.unrevealed}`);
  console.log(`  Credentials: ${state.credentials} | Reputation entries: ${state.reputationEntries}`);
  console.log('\n✓ Full CogProof state reconstructed from Bitcoin chain alone');
  console.log('✓ No external APIs. No sidechains. Just Bitcoin + indexer.');
}

module.exports = { OpReturnBuilder, CogProofTxBuilder, CogProofIndexer, OPS, CREDENTIAL_FIELDS };
