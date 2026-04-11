/**
 * Proof of Fair Participation — API Server
 *
 * Backend API for the credential registry + commit-reveal + Shapley DAG.
 * Soham's frontend connects here.
 *
 * Endpoints:
 *   POST /api/batch/create          — Create new mining batch
 *   POST /api/batch/:id/commit      — Commit to a batch
 *   POST /api/batch/:id/reveal      — Reveal commitment
 *   POST /api/batch/:id/settle      — Settle batch (shuffle + validate)
 *   GET  /api/batch/:id             — Get batch summary
 *
 *   POST /api/event                 — Record protocol event → issue credential
 *   POST /api/credential            — Issue credential directly
 *   GET  /api/reputation/:userId    — Get user reputation + credentials
 *
 *   POST /api/shapley/compute       — Compute Shapley distribution
 *   GET  /api/shapley/dag           — Get DAG structure
 *
 *   POST /api/mine                  — Submit compression mining job
 *   POST /api/mine/verify           — Verify mining result
 *
 *   GET  /api/trust/:userId         — Trust analysis for user
 *   POST /api/trust/batch           — Analyze batch for anomalies
 *   GET  /api/trust/report          — Full trust report (all users)
 *
 *   GET  /api/health                — Health check
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { CommitRevealEngine } = require('../commit-reveal/commit-reveal');
const { CredentialRegistry } = require('../credentials/credential-registry');
const { ShapleyDistributor } = require('../shapley-dag/shapley');
const { CompressionMiner, verifyMiningResult } = require('../compression-mining/mine');
const { BehaviorAnalyzer } = require('../trust/behavior-analyzer');
const { CogProofTxBuilder, CogProofIndexer, OpReturnBuilder } = require('../bitcoin/op-return');

const app = express();
app.use(cors());
app.use(express.json());

// Shared state
const commitReveal = new CommitRevealEngine();
const credentials = new CredentialRegistry();
const miners = new Map();
const trustAnalyzer = new BehaviorAnalyzer();
const indexer = new CogProofIndexer();

// ============ Health ============

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'proof-of-fair-participation',
    version: '0.1.0',
    uptime: process.uptime(),
  });
});

// ============ Batch (Commit-Reveal) ============

app.post('/api/batch/create', (req, res) => {
  const { blockHash } = req.body;
  const hash = blockHash || crypto.randomBytes(32).toString('hex');
  const batchId = commitReveal.newBatch(hash);
  res.json({ batchId, blockHash: hash, phase: 'COMMIT' });
});

app.post('/api/batch/:id/commit', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const { minerId, commitHash } = req.body;

    const result = commitReveal.commit(batchId, minerId, commitHash);

    // Issue credential + record for trust analysis
    credentials.hookCommit(minerId, batchId, commitHash);
    trustAnalyzer.recordAction(minerId, { type: 'COMMIT', batchId, commitHash });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/batch/:id/close-commit', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const result = commitReveal.closeCommitPhase(batchId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/batch/:id/reveal', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const { minerId, output, secret } = req.body;

    const result = commitReveal.reveal(batchId, minerId, output, secret);

    // Issue credential + record for trust analysis
    credentials.hookReveal(minerId, batchId, result.valid);
    trustAnalyzer.recordAction(minerId, { type: 'REVEAL', batchId, valid: result.valid });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/batch/:id/settle', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const { blockEntropy } = req.body;
    const entropy = blockEntropy || crypto.randomBytes(32).toString('hex');

    const result = commitReveal.settle(batchId, entropy);

    // Issue execution credentials for each participant in order
    result.executionOrder.forEach((minerId, position) => {
      credentials.hookExecution(minerId, batchId, position);
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/batch/:id', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const summary = commitReveal.getBatchSummary(batchId);
    res.json(summary);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ============ Credentials ============

app.post('/api/event', (req, res) => {
  try {
    const { userId, eventType, batchId, metadata } = req.body;
    const result = credentials.recordEvent({ userId, eventType, batchId, metadata });
    res.json({ credHash: result.credHash, type: eventType });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/credential', (req, res) => {
  try {
    const { userId, credentialType, batchId, metadata } = req.body;
    const result = credentials.issueCredential(userId, credentialType, batchId, metadata);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reputation/:userId', (req, res) => {
  const rep = credentials.getUserReputation(req.params.userId);
  res.json(rep);
});

// ============ Shapley Distribution ============

app.post('/api/shapley/compute', (req, res) => {
  try {
    const { totalPool, lawsonFloor, participants, dependencies } = req.body;

    const dist = new ShapleyDistributor(lawsonFloor || 0.05);

    for (const p of participants) {
      dist.addParticipant(p.id, p.contributions);
    }

    if (dependencies) {
      for (const dep of dependencies) {
        dist.addDependency(dep.from, dep.to);
      }
    }

    const result = dist.compute(totalPool);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ Compression Mining ============

app.post('/api/mine', (req, res) => {
  try {
    const { minerId, corpus, blockHash } = req.body;

    if (!miners.has(minerId)) {
      miners.set(minerId, new CompressionMiner(minerId));
    }
    const miner = miners.get(minerId);
    const hash = blockHash || crypto.randomBytes(32).toString('hex');

    const result = miner.mine(corpus, hash);

    // Issue mining credentials + record for trust analysis
    credentials.hookCompressionMining(minerId, 0, result.ratio, result.density);
    trustAnalyzer.recordAction(minerId, { type: 'MINE', ratio: result.ratio, density: result.density });

    res.json({
      commitHash: result.commitHash,
      originalBytes: result.originalBytes,
      compressedBytes: result.compressedBytes,
      ratio: result.ratio,
      density: result.density,
      miningTimeMs: result.miningTimeMs,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/mine/verify', (req, res) => {
  try {
    const { reveal, originalCorpus } = req.body;
    const result = verifyMiningResult(reveal, originalCorpus);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ Trust Analysis ============

app.get('/api/trust/:userId', (req, res) => {
  const report = trustAnalyzer.analyzeUser(req.params.userId);
  res.json(report);
});

app.post('/api/trust/batch', (req, res) => {
  try {
    const result = trustAnalyzer.analyzeBatch(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/trust/report', (req, res) => {
  const report = trustAnalyzer.getTrustReport();
  res.json(report);
});

// ============ Bitcoin OP_RETURN ============

app.post('/api/bitcoin/commit', (req, res) => {
  try {
    const { commitHash, batchId, amount } = req.body;
    const tx = CogProofTxBuilder.buildCommit(commitHash, batchId, amount || 1000);
    const indexed = indexer.processTx(tx.tx, `tx_${Date.now()}`, indexer.blockHeight + 1);
    res.json({ ...tx, indexed, hex: tx.tx.toString('hex'), size: tx.tx.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bitcoin/reveal', (req, res) => {
  try {
    const { commitHash, secret } = req.body;
    const tx = CogProofTxBuilder.buildReveal(commitHash, secret);
    const indexed = indexer.processTx(tx.tx, `tx_${Date.now()}`, indexer.blockHeight + 1);
    res.json({ ...tx, indexed, hex: tx.tx.toString('hex'), size: tx.tx.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bitcoin/mine', (req, res) => {
  try {
    const { outputHash, originalHash, ratio, density } = req.body;
    const tx = CogProofTxBuilder.buildMine(outputHash, originalHash, ratio, density);
    const indexed = indexer.processTx(tx.tx, `tx_${Date.now()}`, indexer.blockHeight + 1);
    res.json({ ...tx, indexed, hex: tx.tx.toString('hex'), size: tx.tx.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bitcoin/credential', (req, res) => {
  try {
    const { domain, field, value, batchId } = req.body;
    const tx = CogProofTxBuilder.buildCredential(domain, field, value, batchId);
    const indexed = indexer.processTx(tx.tx, `tx_${Date.now()}`, indexer.blockHeight + 1);
    res.json({ ...tx, indexed, hex: tx.tx.toString('hex'), size: tx.tx.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bitcoin/reputation/burn', (req, res) => {
  try {
    const { targetDomain, amount, reason } = req.body;
    const tx = CogProofTxBuilder.buildReputationBurn(targetDomain, amount, reason);
    const indexed = indexer.processTx(tx.tx, `tx_${Date.now()}`, indexer.blockHeight + 1);
    res.json({ ...tx, indexed, hex: tx.tx.toString('hex'), size: tx.tx.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bitcoin/shapley-anchor', (req, res) => {
  try {
    const { distributionHash, totalPool, participantCount, lawsonFloorBps, batchId } = req.body;
    const tx = CogProofTxBuilder.buildShapleyAnchor(distributionHash, totalPool, participantCount, lawsonFloorBps, batchId);
    const indexed = indexer.processTx(tx.tx, `tx_${Date.now()}`, indexer.blockHeight + 1);
    res.json({ ...tx, indexed, hex: tx.tx.toString('hex'), size: tx.tx.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/bitcoin/indexer', (req, res) => {
  res.json(indexer.getState());
});

// ============ Full Pipeline Demo ============

app.post('/api/demo/full-pipeline', (req, res) => {
  try {
    const blockHash = crypto.randomBytes(32).toString('hex');
    const batchId = commitReveal.newBatch(blockHash);
    const results = { batchId, phases: {} };

    // Simulate 3 miners
    const minerData = [
      { id: 'alice', corpus: 'CogCoin uses Proof of Language mining where agents write sentences under cryptographic constraints using BIP-39 words from the previous blockhash.' },
      { id: 'bob', corpus: 'Bitcoin metaprotocols operate within OP_RETURN outputs providing identity and reputation without separate consensus layers or sidechains.' },
      { id: 'charlie', corpus: 'Symbolic compression maps high-entropy language to dense glyph encodings preserving semantic meaning at ratios approaching lossless theoretical limits.' },
    ];

    // Phase 1: Mine + Commit
    const miningResults = [];
    for (const m of minerData) {
      if (!miners.has(m.id)) miners.set(m.id, new CompressionMiner(m.id));
      const miner = miners.get(m.id);
      const mineResult = miner.mine(m.corpus, blockHash);
      commitReveal.commit(batchId, m.id, mineResult.commitHash);
      credentials.hookCommit(m.id, batchId, mineResult.commitHash);
      miningResults.push({ ...m, mineResult });
    }
    results.phases.commit = miningResults.map(m => ({
      miner: m.id,
      commitHash: m.mineResult.commitHash.slice(0, 16) + '...',
      ratio: m.mineResult.ratio,
    }));

    // Phase 2: Reveal
    commitReveal.closeCommitPhase(batchId);
    for (const m of miningResults) {
      const reveal = commitReveal.reveal(
        batchId, m.id, m.mineResult.compressed, m.mineResult.secret
      );
      credentials.hookReveal(m.id, batchId, reveal.valid);
    }
    results.phases.reveal = miningResults.map(m => ({ miner: m.id, valid: true }));

    // Phase 3: Settle
    const blockEntropy = crypto.randomBytes(32).toString('hex');
    const settlement = commitReveal.settle(batchId, blockEntropy);
    settlement.executionOrder.forEach((id, pos) => {
      credentials.hookExecution(id, batchId, pos);
    });
    results.phases.settle = {
      shuffleSeed: settlement.shuffleSeed.slice(0, 16) + '...',
      executionOrder: settlement.executionOrder,
    };

    // Phase 4: Shapley distribution
    const dist = new ShapleyDistributor(0.05);
    for (const m of miningResults) {
      dist.addParticipant(m.id, {
        compressionRatio: Math.round(m.mineResult.ratio * 100),
        miningSpeed: Math.round(1000 / (m.mineResult.miningTimeMs + 1)),
      });
    }
    const shapleyResult = dist.compute(1000); // 1000 COG pool
    results.phases.shapley = shapleyResult.participants;

    // Phase 5: Reputation summary
    results.phases.reputation = miningResults.map(m => {
      const rep = credentials.getUserReputation(m.id);
      return { miner: m.id, score: rep.score, tier: rep.tier };
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Start ============

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🔥 Proof of Fair Participation API running on port ${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/batch/create          — Create mining batch`);
  console.log(`  POST /api/batch/:id/commit      — Commit to batch`);
  console.log(`  POST /api/batch/:id/reveal      — Reveal commitment`);
  console.log(`  POST /api/batch/:id/settle      — Settle (shuffle + validate)`);
  console.log(`  GET  /api/batch/:id             — Batch summary`);
  console.log(`  POST /api/event                 — Record event → credential`);
  console.log(`  POST /api/credential            — Issue credential`);
  console.log(`  GET  /api/reputation/:userId    — User reputation`);
  console.log(`  POST /api/shapley/compute       — Shapley distribution`);
  console.log(`  POST /api/mine                  — Compression mining`);
  console.log(`  POST /api/mine/verify           — Verify mining result`);
  console.log(`  POST /api/demo/full-pipeline    — Full pipeline demo`);
  console.log(`  GET  /api/health                — Health check`);
});

module.exports = app;
