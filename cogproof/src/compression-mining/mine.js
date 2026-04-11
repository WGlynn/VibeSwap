/**
 * Compression Mining Engine
 *
 * Mining flow:
 * 1. Receive corpus from CogCoin network
 * 2. Compress using symbolic engine
 * 3. Commit hash(compressed) on-chain
 * 4. Reveal compressed output after window
 * 5. Verifiers decompress and diff — lossless = valid PoW
 * 6. Compression ratio = difficulty score
 */

const crypto = require('crypto');
const { SymbolicCompressor } = require('./compressor');

class CompressionMiner {
  constructor(minerAddress) {
    this.minerAddress = minerAddress;
    this.compressor = new SymbolicCompressor();
    this.pendingCommits = new Map();
  }

  /**
   * Mine a corpus — compress it and prepare commit.
   * Returns a mining result ready for commit-reveal.
   */
  mine(corpus, blockHash) {
    const startTime = Date.now();

    // Compress the corpus
    const result = this.compressor.compress(corpus);

    // Verify losslessness before submitting
    const decompressed = this.compressor.decompress(
      result.compressed,
      result.dictionary,
      result.glyphAssignments
    );

    const isLossless = this.compressor.verify(decompressed, result.originalHash);
    if (!isLossless) {
      throw new Error('Compression is lossy — cannot submit as valid PoW');
    }

    const miningTime = Date.now() - startTime;

    // Create the commit hash (what goes on-chain first)
    const secret = crypto.randomBytes(32);
    const commitPayload = Buffer.concat([
      Buffer.from(result.compressed, 'utf8'),
      secret
    ]);
    const commitHash = crypto.createHash('sha256').update(commitPayload).digest('hex');

    const miningResult = {
      miner: this.minerAddress,
      blockHash,
      commitHash,
      secret: secret.toString('hex'),
      compressed: result.compressed,
      dictionary: result.dictionary,
      glyphAssignments: result.glyphAssignments,
      originalHash: result.originalHash,
      ratio: result.ratio,
      density: result.density,
      originalBytes: result.originalBytes,
      compressedBytes: result.compressedBytes,
      miningTimeMs: miningTime,
      timestamp: Date.now(),
    };

    // Store for reveal phase
    this.pendingCommits.set(commitHash, miningResult);

    return miningResult;
  }

  /**
   * Get the commit data (for on-chain submission).
   * Only the hash goes on-chain during commit phase.
   */
  getCommit(commitHash) {
    const result = this.pendingCommits.get(commitHash);
    if (!result) throw new Error('Unknown commit');
    return {
      commitHash,
      miner: result.miner,
      blockHash: result.blockHash,
      timestamp: result.timestamp,
    };
  }

  /**
   * Reveal the mining result (after commit phase closes).
   */
  reveal(commitHash) {
    const result = this.pendingCommits.get(commitHash);
    if (!result) throw new Error('Unknown commit');
    return {
      commitHash,
      secret: result.secret,
      compressed: result.compressed,
      dictionary: result.dictionary,
      glyphAssignments: result.glyphAssignments,
      originalHash: result.originalHash,
      ratio: result.ratio,
    };
  }
}

/**
 * Verify a revealed mining result.
 * Any node can do this — permissionless verification.
 */
function verifyMiningResult(reveal, originalCorpus) {
  const compressor = new SymbolicCompressor();

  // Decompress
  const decompressed = compressor.decompress(
    reveal.compressed,
    reveal.dictionary,
    reveal.glyphAssignments
  );

  // Verify against original hash
  const isLossless = compressor.verify(decompressed, reveal.originalHash);

  // Verify commit hash matches reveal
  const commitPayload = Buffer.concat([
    Buffer.from(reveal.compressed, 'utf8'),
    Buffer.from(reveal.secret, 'hex')
  ]);
  const expectedCommit = crypto.createHash('sha256').update(commitPayload).digest('hex');
  const commitValid = expectedCommit === reveal.commitHash;

  return {
    lossless: isLossless,
    commitValid,
    valid: isLossless && commitValid,
    ratio: reveal.ratio,
  };
}

// CLI entry point
if (require.main === module) {
  const corpus = `
    CogCoin is a Bitcoin-native metaprotocol that provides autonomous AI agents
    with human-readable identity through domains anchored to Bitcoin addresses.
    The protocol uses Proof of Language mining where agents generate sentences
    incorporating mandatory BIP-39 words derived from the previous Bitcoin blockhash.
    Reputation is built through irreversible COG burns — the more value destroyed,
    the stronger the trust signal. All operations fit within Bitcoin's 80-byte
    OP_RETURN outputs, requiring no separate consensus layer or sidechains.
    A full CogCoin node is simply a Bitcoin full node with an indexer.
    The Coglex encoding maps 4,096 tokens to 12-bit IDs, fitting 40 tokens
    into exactly 60 bytes. This is token-level compression. Our symbolic
    compression operates at the semantic level — compressing entire knowledge
    bases into minimal glyphs while preserving all information. Together,
    Coglex and symbolic compression form complementary layers of the same
    compression philosophy: density without loss.
  `.trim();

  console.log('=== Compression Mining Demo ===\n');

  const miner = new CompressionMiner('miner_will_001');
  const fakeBlockHash = crypto.randomBytes(32).toString('hex');

  console.log(`Corpus: ${corpus.length} chars`);
  console.log(`Block hash: ${fakeBlockHash.slice(0, 16)}...`);
  console.log('');

  const result = miner.mine(corpus, fakeBlockHash);

  console.log('--- Mining Result ---');
  console.log(`Original:    ${result.originalBytes} bytes`);
  console.log(`Compressed:  ${result.compressedBytes} bytes`);
  console.log(`Ratio:       ${(result.ratio * 100).toFixed(2)}%`);
  console.log(`Density:     ${(result.density * 100).toFixed(2)}%`);
  console.log(`Mining time: ${result.miningTimeMs}ms`);
  console.log(`Commit hash: ${result.commitHash.slice(0, 16)}...`);
  console.log('');

  // Simulate reveal and verification
  const reveal = miner.reveal(result.commitHash);
  const verification = verifyMiningResult(reveal, corpus);

  console.log('--- Verification ---');
  console.log(`Lossless:     ${verification.lossless ? '✓' : '✗'}`);
  console.log(`Commit valid: ${verification.commitValid ? '✓' : '✗'}`);
  console.log(`Overall:      ${verification.valid ? '✓ VALID PoW' : '✗ INVALID'}`);
}

module.exports = { CompressionMiner, verifyMiningResult };
