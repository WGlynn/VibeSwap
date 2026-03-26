// ============ Knowledge Constitution — Documentation as Constitutional Firmware ============
//
// Each shard loads the DOCUMENTATION corpus as its constitutional kernel.
// Papers aren't just docs — they're the validation rules each shard checks against.
// When 64 shards reach CRPC consensus, they're 64 independent minds verifying
// claims against shared constitutional knowledge.
//
// Security model:
//   - 64 shards each loaded with 80 papers = 64 independent constitutional minds
//   - CRPC consensus requires majority agreement (33+ of 64)
//   - Compromising one shard doesn't help — 63 others still verify
//   - The documentation corpus IS the security barrier
//
// This is P-001 applied to information integrity:
//   - Extraction detection for financial transactions → CRPC verification for claims
//   - Shapley null player axiom → credibility-neutral nodes (no shard is privileged)
//   - Self-correction → consensus automatically rejects false information
// ============

import { readFile, readdir } from 'fs/promises';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';

// ============ Constants ============

const DOCS_DIR = join(config.vibeswapRepo || '/repo', 'DOCUMENTATION');
const CONSTITUTION_CACHE_FILE = join(config.dataDir, 'constitution-manifest.json');
const MAX_PAPER_TOKENS = 2000; // Max tokens per paper summary for context injection
const PAPER_CATEGORIES = {
  AXIOM: 'axiom',           // Foundational principles (P-000, P-001, Lawson Constant)
  PROOF: 'proof',           // Mathematical proofs (fairness, MEV resistance)
  MECHANISM: 'mechanism',   // How things work (batch auctions, Shapley, circuit breakers)
  PHILOSOPHY: 'philosophy', // Why things exist (cooperative capitalism, IIA)
  STRATEGY: 'strategy',     // How to get there (Cincinnatus, disintermediation)
  SPEC: 'spec',             // Technical specifications (LayerZero, Kalman filter)
  IDENTITY: 'identity',     // Who we are (convergence thesis, cave philosophy)
  GOVERNANCE: 'governance',  // How decisions are made (augmented governance, DAO layer)
};

// Paper → category mapping
const PAPER_TAXONOMY = {
  'LAWSON_CONSTANT.md': PAPER_CATEGORIES.AXIOM,
  'FORMAL_FAIRNESS_PROOFS.md': PAPER_CATEGORIES.PROOF,
  'VIBESWAP_FORMAL_PROOFS.md': PAPER_CATEGORIES.PROOF,
  'VIBESWAP_FORMAL_PROOFS_ACADEMIC.md': PAPER_CATEGORIES.PROOF,
  'IIA_EMPIRICAL_VERIFICATION.md': PAPER_CATEGORIES.PROOF,
  'PROOF_INDEX.md': PAPER_CATEGORIES.PROOF,
  'COOPERATIVE_MARKETS_PHILOSOPHY.md': PAPER_CATEGORIES.PHILOSOPHY,
  'INTRINSIC_ALTRUISM_WHITEPAPER.md': PAPER_CATEGORIES.PHILOSOPHY,
  'THE_TRANSPARENCY_THEOREM.md': PAPER_CATEGORIES.PHILOSOPHY,
  'THE_PROVENANCE_THESIS.md': PAPER_CATEGORIES.PHILOSOPHY,
  'THE_INVERSION_PRINCIPLE.md': PAPER_CATEGORIES.PHILOSOPHY,
  'THE_HARD_LINE.md': PAPER_CATEGORIES.PHILOSOPHY,
  'ARCHETYPE_PRIMITIVES.md': PAPER_CATEGORIES.PHILOSOPHY,
  'ECONOMITRA.md': PAPER_CATEGORIES.PHILOSOPHY,
  'CONVERGENCE_THESIS.md': PAPER_CATEGORIES.IDENTITY,
  'WEIGHT_AUGMENTATION.md': PAPER_CATEGORIES.IDENTITY,
  'FRACTAL_SCALABILITY.md': PAPER_CATEGORIES.IDENTITY,
  'VIBESWAP_WHITEPAPER.md': PAPER_CATEGORIES.MECHANISM,
  'VIBESWAP_COMPLETE_MECHANISM_DESIGN.md': PAPER_CATEGORIES.MECHANISM,
  'CONSENSUS_MASTER_DOCUMENT.md': PAPER_CATEGORIES.MECHANISM,
  'INCENTIVES_WHITEPAPER.md': PAPER_CATEGORIES.MECHANISM,
  'DESIGN_PHILOSOPHY_CONFIGURABILITY.md': PAPER_CATEGORIES.MECHANISM,
  'COMMIT_REVEAL_MECHANISM.md': PAPER_CATEGORIES.MECHANISM,
  'FISHER_YATES_SHUFFLE.md': PAPER_CATEGORIES.MECHANISM,
  'CIRCUIT_BREAKER_DESIGN.md': PAPER_CATEGORIES.MECHANISM,
  'FLASH_LOAN_PROTECTION.md': PAPER_CATEGORIES.MECHANISM,
  'IT_META_PATTERN.md': PAPER_CATEGORIES.MECHANISM,
  'SHAPLEY_REWARD_SYSTEM.md': PAPER_CATEGORIES.MECHANISM,
  'THREE_TOKEN_ECONOMY.md': PAPER_CATEGORIES.MECHANISM,
  'TIME_NEUTRAL_TOKENOMICS.md': PAPER_CATEGORIES.MECHANISM,
  'TRUE_PRICE_ORACLE.md': PAPER_CATEGORIES.SPEC,
  'TRUE_PRICE_DISCOVERY.md': PAPER_CATEGORIES.SPEC,
  'PRICE_INTELLIGENCE_ORACLE.md': PAPER_CATEGORIES.SPEC,
  'KALMAN_FILTER_ORACLE.md': PAPER_CATEGORIES.SPEC,
  'LAYERZERO_INTEGRATION_DESIGN.md': PAPER_CATEGORIES.SPEC,
  'CROSS_CHAIN_SETTLEMENT.md': PAPER_CATEGORIES.SPEC,
  'SHARD_ARCHITECTURE.md': PAPER_CATEGORIES.SPEC,
  'VERKLE_CONTEXT_TREE.md': PAPER_CATEGORIES.SPEC,
  'ERGON_MONETARY_BIOLOGY.md': PAPER_CATEGORIES.SPEC,
  'SECURITY_MECHANISM_DESIGN.md': PAPER_CATEGORIES.MECHANISM,
  'SOCIAL_SCALABILITY_VIBESWAP.md': PAPER_CATEGORIES.PHILOSOPHY,
  'THE_PSYCHONAUT_PAPER.md': PAPER_CATEGORIES.PHILOSOPHY,
  'AUGMENTED_GOVERNANCE.md': PAPER_CATEGORIES.GOVERNANCE,
  'CONSTITUTIONAL_DAO_LAYER.md': PAPER_CATEGORIES.GOVERNANCE,
  'ROSETTA_COVENANTS.md': PAPER_CATEGORIES.GOVERNANCE,
  'DISINTERMEDIATION_GRADES.md': PAPER_CATEGORIES.STRATEGY,
  'CINCINNATUS_ENDGAME.md': PAPER_CATEGORIES.STRATEGY,
  'JARVIS_INDEPENDENCE.md': PAPER_CATEGORIES.STRATEGY,
  'GRACEFUL_INVERSION.md': PAPER_CATEGORIES.STRATEGY,
  'COORDINATION_DYNAMICS.md': PAPER_CATEGORIES.STRATEGY,
  'ATTRACT_PUSH_REPEL.md': PAPER_CATEGORIES.STRATEGY,
  'CRYPTO_MARKET_TAXONOMY.md': PAPER_CATEGORIES.STRATEGY,
  'SEC_WHITEPAPER_VIBESWAP.md': PAPER_CATEGORIES.GOVERNANCE,
  'SEC_REGULATORY_COMPLIANCE_ANALYSIS.md': PAPER_CATEGORIES.GOVERNANCE,
  'SEC_ENGAGEMENT_ROADMAP.md': PAPER_CATEGORIES.GOVERNANCE,
  'WALLET_RECOVERY.md': PAPER_CATEGORIES.SPEC,
  'WALLET_RECOVERY_WHITEPAPER.md': PAPER_CATEGORIES.SPEC,
  'TRINITY_RECURSION_PROTOCOL.md': PAPER_CATEGORIES.IDENTITY,
};

// ============ State ============

let constitutionLoaded = false;
let constitutionManifest = null; // { papers: [...], hash, loadedAt }
const paperIndex = new Map();    // filename -> { title, category, hash, abstract }

// ============ Core Functions ============

/**
 * Load the documentation corpus as constitutional firmware.
 * Each paper is indexed, hashed, and categorized.
 * Returns manifest for cross-shard verification.
 */
export async function loadConstitution() {
  console.log('[constitution] Loading documentation corpus...');

  const papers = [];

  try {
    const files = await readdir(DOCS_DIR);
    const mdFiles = files.filter(f => extname(f) === '.md');

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(DOCS_DIR, file), 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
        const title = extractTitle(content);
        const abstract = extractAbstract(content);
        const category = PAPER_TAXONOMY[file] || PAPER_CATEGORIES.MECHANISM;

        const paper = { file, title, category, hash, abstract, lines: content.split('\n').length };
        papers.push(paper);
        paperIndex.set(file, paper);
      } catch (err) {
        console.warn(`[constitution] Failed to load ${file}: ${err.message}`);
      }
    }

    // Build manifest
    const corpusHash = createHash('sha256')
      .update(papers.map(p => p.hash).sort().join(''))
      .digest('hex');

    constitutionManifest = {
      version: '1.0',
      papers: papers.length,
      categories: Object.fromEntries(
        Object.values(PAPER_CATEGORIES).map(cat => [
          cat,
          papers.filter(p => p.category === cat).length
        ])
      ),
      corpusHash,
      loadedAt: new Date().toISOString(),
      paperList: papers.map(p => ({ file: p.file, hash: p.hash, category: p.category })),
    };

    constitutionLoaded = true;
    console.log(`[constitution] Loaded ${papers.length} papers (corpus hash: ${corpusHash.slice(0, 12)})`);
    console.log(`[constitution] Categories: ${JSON.stringify(constitutionManifest.categories)}`);

    return constitutionManifest;
  } catch (err) {
    console.error(`[constitution] Failed to load corpus: ${err.message}`);
    return null;
  }
}

/**
 * Get the constitutional manifest for cross-shard verification.
 * Two shards with the same corpusHash have identical constitutional knowledge.
 */
export function getConstitutionManifest() {
  return constitutionManifest;
}

/**
 * Verify that a peer shard has the same constitutional knowledge.
 * Used during CRPC to ensure all validators share the same foundation.
 */
export function verifyPeerConstitution(peerManifest) {
  if (!constitutionManifest || !peerManifest) return false;
  return constitutionManifest.corpusHash === peerManifest.corpusHash;
}

/**
 * Get papers relevant to a specific topic for context injection.
 * Used when a shard needs to reason about a specific domain.
 */
export function getPapersForTopic(topic) {
  const topicLower = topic.toLowerCase();
  const relevant = [];

  for (const [file, paper] of paperIndex) {
    const titleMatch = paper.title?.toLowerCase().includes(topicLower);
    const abstractMatch = paper.abstract?.toLowerCase().includes(topicLower);
    const categoryMatch = paper.category === topicLower;

    if (titleMatch || abstractMatch || categoryMatch) {
      relevant.push(paper);
    }
  }

  return relevant;
}

/**
 * Get the constitutional context string for prompt injection.
 * Provides the shard with its foundational knowledge summary.
 */
export function getConstitutionalContext() {
  if (!constitutionLoaded) return '';

  const axioms = [...paperIndex.values()].filter(p => p.category === PAPER_CATEGORIES.AXIOM);
  const proofs = [...paperIndex.values()].filter(p => p.category === PAPER_CATEGORIES.PROOF);

  return [
    `CONSTITUTIONAL KERNEL: ${constitutionManifest.papers} papers loaded (hash: ${constitutionManifest.corpusHash.slice(0, 12)})`,
    `AXIOMS: ${axioms.map(a => a.title).join(', ')}`,
    `PROOFS: ${proofs.length} formal proofs available`,
    `CATEGORIES: ${JSON.stringify(constitutionManifest.categories)}`,
    `VERIFICATION: All claims must be verifiable against this corpus. 64 shards cross-verify via CRPC.`,
  ].join('\n');
}

/**
 * Generate a CRPC verification challenge for a claim.
 * Each shard independently checks the claim against their constitutional knowledge.
 */
export function generateVerificationPrompt(claim, context) {
  return {
    type: 'KNOWLEDGE_VERIFICATION',
    prompt: [
      'CONSTITUTIONAL VERIFICATION TASK',
      '',
      `CLAIM: "${claim}"`,
      '',
      `CONTEXT: ${context}`,
      '',
      'INSTRUCTIONS:',
      '1. Check this claim against the constitutional corpus loaded in your CKB',
      '2. Rate: VERIFIED (supported by papers), UNVERIFIED (not in corpus), or CONTRADICTED (conflicts with papers)',
      '3. Cite the specific paper(s) that support or contradict the claim',
      '4. Provide your confidence level (0-100)',
      '',
      'Your response must be independently derived. Do not coordinate with other shards.',
      'This is CRPC Phase 1 — your response will be commit-revealed against peer shards.',
    ].join('\n'),
  };
}

// ============ Helpers ============

function extractTitle(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ')) return line.replace(/^#\s+/, '').trim();
  }
  return null;
}

function extractAbstract(content) {
  const abstractMatch = content.match(/## Abstract\n\n([\s\S]*?)(?=\n##|\n---)/);
  if (abstractMatch) {
    return abstractMatch[1].trim().slice(0, 500);
  }
  // Fallback: first paragraph after title
  const lines = content.split('\n');
  let foundTitle = false;
  for (const line of lines) {
    if (line.startsWith('# ')) { foundTitle = true; continue; }
    if (foundTitle && line.trim() && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('*')) {
      return line.trim().slice(0, 500);
    }
  }
  return null;
}

// ============ Exports ============

export {
  PAPER_CATEGORIES,
  PAPER_TAXONOMY,
  paperIndex,
};
