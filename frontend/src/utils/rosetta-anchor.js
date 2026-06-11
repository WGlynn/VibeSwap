// ============ CKG → On-Chain Citation Anchor (vibeswap mirror) ============
//
// Mirrors the standalone rosetta engine's anchor module, but uses the
// installed ethers v6 keccak256 (audited) directly instead of requiring
// caller-injection. Provides the lightweight wrappers used by RosettaPage:
//
//   anchorCKGLog(signer, registryAddr, epochId, maxPrimitiveId)
//   verifyCitation(leaf, proof, root)
//
// CYCLE5: This file duplicates logic from
//   rosetta-stone-protocol/packages/engine/src/anchor.js
// Dedup proposal: publish @rosetta/engine to npm, vibeswap/frontend installs
// as a runtime dep, this file shrinks to a 3-line re-export + setKeccak256
// injection. Blocker: standalone engine not yet on npm. Track via session
// state until the standalone repo is published.
//
// Contract function (verified against contracts/psinet/PrimitiveRegistry.sol L191):
//   anchorCitations(uint256 epochId, bytes32 merkleRoot, uint256[] perPrimitiveCounts)
//
// OPH surface: 4 (record algebra + ε-stability bounds on central record projectors)
// ============

import { keccak256 as ethKeccak, toUtf8Bytes, getBytes } from 'ethers'
import { getCKGLog } from './rosetta-engine'

// ─────────────────────────────────────────────────────────────────────
// Hash helpers — backed by ethers v6 audited keccak256
// ─────────────────────────────────────────────────────────────────────

/**
 * keccak256 over raw bytes → 0x-hex32. Thin wrapper for clarity.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function keccak(bytes) {
  return ethKeccak(bytes)
}

/**
 * Canonical JSON for a CKG log entry (keys sorted). Stability-critical:
 * third parties regenerate the same leaf bytes to verify inclusion.
 * @param {{seq:number, prevHash:string, hash:string, op:string, payload:object, timestamp:number}} entry
 * @returns {Uint8Array}
 */
function canonicalEntryBytes(entry) {
  const canonical = JSON.stringify(
    {
      hash: entry.hash,
      op: entry.op,
      payload: entry.payload,
      prevHash: entry.prevHash,
      seq: entry.seq,
      timestamp: entry.timestamp,
    },
    ['hash', 'op', 'payload', 'prevHash', 'seq', 'timestamp'].sort()
  )
  return toUtf8Bytes(canonical)
}

/**
 * Sorted-pair node hash (OpenZeppelin MerkleProof convention).
 * Commutative under (a,b) swap so inclusion proofs need no left/right flag.
 * @param {string} a 0x-hex32
 * @param {string} b 0x-hex32
 * @returns {string}
 */
function hashPair(a, b) {
  const ab = getBytes(a)
  const bb = getBytes(b)
  let cmp = 0
  for (let i = 0; i < 32; i++) {
    if (ab[i] !== bb[i]) { cmp = ab[i] - bb[i]; break }
  }
  const [lo, hi] = cmp <= 0 ? [ab, bb] : [bb, ab]
  const concat = new Uint8Array(64)
  concat.set(lo, 0)
  concat.set(hi, 32)
  return keccak(concat)
}

/**
 * Hash a CKG log entry into a merkle leaf.
 * @param {object} entry
 * @returns {string} 0x-hex32
 */
export function hashCKGLeaf(entry) {
  return keccak(canonicalEntryBytes(entry))
}

// ─────────────────────────────────────────────────────────────────────
// Merkle tree + inclusion proofs
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a balanced binary merkle tree over CKG log entries.
 * Odd nodes per level are duplicated (OZ convention).
 * Empty log → root = bytes32(0) sentinel.
 *
 * @param {object[]} ckgLog
 * @returns {{ root: string, leaves: string[], levels: string[][] }}
 */
export function computeCKGMerkleRoot(ckgLog) {
  if (!Array.isArray(ckgLog)) throw new TypeError('ckgLog must be an array')
  if (ckgLog.length === 0) {
    return { root: '0x' + '0'.repeat(64), leaves: [], levels: [[]] }
  }
  const leaves = ckgLog.map(hashCKGLeaf)
  const levels = [leaves]
  let current = leaves
  while (current.length > 1) {
    const next = []
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]
      const right = (i + 1 < current.length) ? current[i + 1] : left
      next.push(hashPair(left, right))
    }
    levels.push(next)
    current = next
  }
  return { root: current[0], leaves, levels }
}

/**
 * Generate an inclusion proof (sibling-hash list) for the leaf at index.
 * @param {string[][]} levels
 * @param {number} leafIndex
 * @returns {string[]}
 */
export function generateInclusionProof(levels, leafIndex) {
  if (!Array.isArray(levels) || levels.length === 0) return []
  const proof = []
  let idx = leafIndex
  for (let lvl = 0; lvl < levels.length - 1; lvl++) {
    const layer = levels[lvl]
    const siblingIdx = (idx % 2 === 0) ? Math.min(idx + 1, layer.length - 1) : idx - 1
    proof.push(layer[siblingIdx])
    idx = idx >> 1
  }
  return proof
}

/**
 * Pure verifier — third parties confirm a CKG citation is anchored on-chain.
 * No signer needed. Reads root from PrimitiveRegistry.epochRoots[epochId].
 *
 * @param {string} leaf  0x-hex32
 * @param {string[]} proof
 * @param {string} root  0x-hex32 (epoch root from chain)
 * @returns {boolean}
 */
export function verifyCitation(leaf, proof, root) {
  if (!leaf || !root || !Array.isArray(proof)) return false
  let h = leaf.toLowerCase()
  for (const sibling of proof) {
    h = hashPair(h, sibling.toLowerCase())
  }
  return h === root.toLowerCase()
}

// ─────────────────────────────────────────────────────────────────────
// Per-primitive citation tallying
// ─────────────────────────────────────────────────────────────────────

/**
 * Count citations per primitive from CKG log payloads.
 * Default extractor: payload.primitiveId (single) + payload.citedPrimitives (array).
 *
 * @param {object[]} ckgLog
 * @param {number} maxPrimitiveId  totalPrimitives() from PrimitiveRegistry
 * @param {(e: object) => number[]} [extractor]
 * @returns {bigint[]}  length = maxPrimitiveId; index = primitiveId - 1
 */
export function tallyPerPrimitiveCounts(ckgLog, maxPrimitiveId, extractor) {
  if (!Number.isInteger(maxPrimitiveId) || maxPrimitiveId < 0) {
    throw new RangeError('maxPrimitiveId must be a non-negative integer')
  }
  const counts = new Array(maxPrimitiveId).fill(0n)
  const defaultExtractor = (e) => {
    const out = []
    const p = e?.payload
    if (!p || typeof p !== 'object') return out
    if (Number.isInteger(p.primitiveId) && p.primitiveId >= 1) out.push(p.primitiveId)
    if (Array.isArray(p.citedPrimitives)) {
      for (const pid of p.citedPrimitives) {
        if (Number.isInteger(pid) && pid >= 1) out.push(pid)
      }
    }
    return out
  }
  const ex = extractor || defaultExtractor
  for (const entry of ckgLog) {
    for (const pid of ex(entry)) {
      if (pid <= maxPrimitiveId) counts[pid - 1] += 1n
    }
  }
  return counts
}

// ─────────────────────────────────────────────────────────────────────
// On-chain submission
// ─────────────────────────────────────────────────────────────────────

const ANCHOR_CITATIONS_ABI = [
  'function anchorCitations(uint256 epochId, bytes32 merkleRoot, uint256[] perPrimitiveCounts) external',
  'function totalPrimitives() external view returns (uint256)',
  'function epochRoots(uint256) external view returns (bytes32)',
  'function authorizedAnchorers(address) external view returns (bool)',
]

/**
 * High-level wrapper: read CKG log, build merkle root, submit anchor tx.
 *
 * If `import.meta.env.VITE_PRIMITIVE_REGISTRY_ADDR` is unset, throws a
 * descriptive error so the UI can surface "Contract not deployed on this
 * network" honestly — no theater, no mock receipt.
 *
 * @param {object} signer    ethers v6 Signer (BrowserProvider.getSigner())
 * @param {object} [opts]
 * @param {string} [opts.registryAddr]  override env var
 * @param {bigint} [opts.epochId]       defaults to floor(now / 1 day)
 * @returns {Promise<{
 *   txHash: string,
 *   blockNumber: number,
 *   gasUsed: bigint,
 *   epochId: bigint,
 *   root: string,
 *   leafCount: number,
 * }>}
 */
export async function anchorCKGLog(signer, opts = {}) {
  if (!signer || typeof signer.sendTransaction !== 'function') {
    throw new TypeError('signer must be an ethers v6 Signer')
  }

  const registryAddr =
    opts.registryAddr ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PRIMITIVE_REGISTRY_ADDR)

  if (!registryAddr) {
    throw new Error('PrimitiveRegistry not deployed on this network — set VITE_PRIMITIVE_REGISTRY_ADDR to enable anchoring')
  }

  const log = getCKGLog()
  if (log.length === 0) {
    throw new Error('CKG log is empty — run a compose / register-universal op first')
  }

  const { root, leaves } = computeCKGMerkleRoot(log)

  // Default epochId: UTC day index. Matches PrimitiveRegistry's "daily/weekly"
  // anchoring cadence from the contract docstring (L25).
  const epochId = opts.epochId ?? BigInt(Math.floor(Date.now() / 86_400_000))

  // Lazy ethers Contract import to keep tree-shaking happy when this wrapper
  // is imported but never called.
  const { Contract } = await import('ethers')
  const registry = new Contract(registryAddr, ANCHOR_CITATIONS_ABI, signer)

  // Read totalPrimitives to size the counts array; if zero, contract reverts.
  const totalPrimitives = await registry.totalPrimitives()
  if (totalPrimitives === 0n) {
    throw new Error('PrimitiveRegistry has no minted primitives — mint at least one before anchoring')
  }

  const counts = tallyPerPrimitiveCounts(log, Number(totalPrimitives))

  // Gas estimate first → surfaces revert reason (UnauthorizedAnchorer,
  // EpochAlreadyAnchored, CitationCountMismatch) before user signs.
  const gasLimit = await registry.anchorCitations.estimateGas(epochId, root, counts)

  const tx = await registry.anchorCitations(epochId, root, counts, { gasLimit })
  const receipt = await tx.wait(1)

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? 0,
    gasUsed: receipt?.gasUsed ?? 0n,
    epochId,
    root,
    leafCount: leaves.length,
  }
}

/**
 * Estimate-only variant — returns root + gas estimate without sending.
 * Lets the UI preview the anchor before prompting the wallet.
 *
 * @param {object} signer
 * @param {object} [opts]
 * @returns {Promise<{
 *   root: string,
 *   leafCount: number,
 *   epochId: bigint,
 *   registryAddr: string,
 *   gasEstimate: bigint,
 *   alreadyAnchored: boolean,
 * }>}
 */
export async function previewCKGAnchor(signer, opts = {}) {
  const registryAddr =
    opts.registryAddr ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PRIMITIVE_REGISTRY_ADDR)
  if (!registryAddr) {
    throw new Error('PrimitiveRegistry not deployed on this network — set VITE_PRIMITIVE_REGISTRY_ADDR to enable anchoring')
  }
  const log = getCKGLog()
  if (log.length === 0) {
    throw new Error('CKG log is empty')
  }
  const { root, leaves } = computeCKGMerkleRoot(log)
  const epochId = opts.epochId ?? BigInt(Math.floor(Date.now() / 86_400_000))

  const { Contract } = await import('ethers')
  const registry = new Contract(registryAddr, ANCHOR_CITATIONS_ABI, signer)

  const existing = await registry.epochRoots(epochId)
  const alreadyAnchored = existing !== '0x' + '0'.repeat(64)

  const totalPrimitives = await registry.totalPrimitives()
  const counts = tallyPerPrimitiveCounts(log, Number(totalPrimitives))

  let gasEstimate = 0n
  if (!alreadyAnchored && totalPrimitives > 0n) {
    try {
      gasEstimate = await registry.anchorCitations.estimateGas(epochId, root, counts)
    } catch {
      // Revert (likely UnauthorizedAnchorer) — surface zero estimate;
      // caller renders "permission denied" rather than a false number.
      gasEstimate = 0n
    }
  }

  return {
    root,
    leafCount: leaves.length,
    epochId,
    registryAddr,
    gasEstimate,
    alreadyAnchored,
  }
}
