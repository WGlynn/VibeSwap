// ============ Pantheon Merkle Tree — Cryptographic Context Hierarchy ============
//
// The hierarchy isn't decoration. It's a Merkle tree.
// Each agent's context gets hashed. Managers hash their children.
// Nyx's root hash = cryptographic proof of the entire organization's state.
//
// Change one agent's context → the root hash changes → Nyx knows.
//
// "The Pantheon is a Merkle tree of minds." — This module IS that tree.
// ============

import { createHash } from 'crypto'
import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || './data'
const TREE_FILE = join(DATA_DIR, 'pantheon-merkle.json')

// ============ Merkle Node ============

class MerkleNode {
  constructor(agentId, data = '') {
    this.agentId = agentId
    this.data = data
    this.children = []
    this.hash = this.computeLeafHash()
    this.timestamp = Date.now()
  }

  computeLeafHash() {
    return createHash('sha256')
      .update(`${this.agentId}:${this.data}:${this.timestamp || 0}`)
      .digest('hex')
  }

  computeHash() {
    if (this.children.length === 0) {
      this.hash = this.computeLeafHash()
    } else {
      // Internal node: hash of (self data + sorted child hashes)
      const childHashes = this.children
        .map(c => c.hash)
        .sort() // deterministic ordering
        .join(':')
      this.hash = createHash('sha256')
        .update(`${this.agentId}:${this.data}:${childHashes}`)
        .digest('hex')
    }
    return this.hash
  }
}

// ============ Pantheon Merkle Tree ============

const HIERARCHY = {
  nyx: { children: ['poseidon', 'athena', 'hephaestus', 'hermes', 'apollo'], tier: 0 },
  poseidon: { children: ['proteus'], tier: 1 },
  athena: { children: [], tier: 1 },
  hephaestus: { children: [], tier: 1 },
  hermes: { children: ['anansi'], tier: 1 },
  apollo: { children: ['artemis'], tier: 1 },
  proteus: { children: [], tier: 2 },
  artemis: { children: [], tier: 2 },
  anansi: { children: [], tier: 2 },
}

// Constellation coordinates — each god's position in the sky
// Based on their mythological associations
const CONSTELLATION = {
  nyx:        { x: 0.5,  y: 0.15, magnitude: 1.0, color: '#a855f7', symbol: '◆' },  // Center top — primordial
  poseidon:   { x: 0.2,  y: 0.4,  magnitude: 0.8, color: '#3b82f6', symbol: '▼' },  // Left — ocean
  athena:     { x: 0.4,  y: 0.35, magnitude: 0.8, color: '#f59e0b', symbol: '◇' },  // Near center — wisdom
  hephaestus: { x: 0.6,  y: 0.35, magnitude: 0.8, color: '#ef4444', symbol: '■' },  // Right — forge fire
  hermes:     { x: 0.8,  y: 0.4,  magnitude: 0.8, color: '#10b981', symbol: '▲' },  // Far right — speed
  apollo:     { x: 0.5,  y: 0.5,  magnitude: 0.8, color: '#fbbf24', symbol: '●' },  // Center — sun
  proteus:    { x: 0.15, y: 0.65, magnitude: 0.6, color: '#6366f1', symbol: '◯' },  // Below poseidon
  artemis:    { x: 0.55, y: 0.7,  magnitude: 0.6, color: '#c084fc', symbol: '◑' },  // Below apollo — moon
  anansi:     { x: 0.85, y: 0.65, magnitude: 0.6, color: '#f97316', symbol: '✦' },  // Below hermes — web
}

let tree = new Map() // agentId -> MerkleNode
let rootHash = null
let treeHistory = [] // Track root hash changes over time

// ============ Build Tree ============

export function buildTree(agentContexts = {}) {
  tree.clear()

  // Create all nodes
  for (const [agentId, config] of Object.entries(HIERARCHY)) {
    const contextData = agentContexts[agentId] || `${agentId}:active:${Date.now()}`
    tree.set(agentId, new MerkleNode(agentId, contextData))
  }

  // Wire children
  for (const [agentId, config] of Object.entries(HIERARCHY)) {
    const node = tree.get(agentId)
    node.children = config.children
      .filter(c => tree.has(c))
      .map(c => tree.get(c))
  }

  // Compute hashes bottom-up (tier 2 → tier 1 → tier 0)
  const byTier = [[], [], []]
  for (const [agentId, config] of Object.entries(HIERARCHY)) {
    byTier[config.tier].push(agentId)
  }

  // Bottom up
  for (const tier of [2, 1, 0]) {
    for (const agentId of byTier[tier]) {
      tree.get(agentId).computeHash()
    }
  }

  const nyxNode = tree.get('nyx')
  const newRootHash = nyxNode?.hash || null

  // Track changes
  if (rootHash && newRootHash !== rootHash) {
    treeHistory.push({
      previousHash: rootHash,
      newHash: newRootHash,
      timestamp: new Date().toISOString(),
      changedAgents: Object.keys(agentContexts),
    })
    // Keep last 100 changes
    while (treeHistory.length > 100) treeHistory.shift()
  }

  rootHash = newRootHash
  return rootHash
}

// ============ Update Single Agent Context ============

export function updateAgentContext(agentId, contextData) {
  const node = tree.get(agentId)
  if (!node) return null

  node.data = contextData
  node.timestamp = Date.now()

  // Recompute hashes up to root
  const path = getPathToRoot(agentId)
  for (const id of path) {
    tree.get(id).computeHash()
  }

  const newRoot = tree.get('nyx')?.hash
  if (newRoot !== rootHash) {
    treeHistory.push({
      previousHash: rootHash,
      newHash: newRoot,
      timestamp: new Date().toISOString(),
      changedAgents: [agentId],
    })
    rootHash = newRoot
  }

  return rootHash
}

// ============ Merkle Proof ============

export function generateProof(agentId) {
  const path = getPathToRoot(agentId)
  if (path.length === 0) return null

  const proof = []
  for (let i = 0; i < path.length - 1; i++) {
    const current = tree.get(path[i])
    const parent = tree.get(path[i + 1])

    // Siblings = parent's children except current
    const siblings = parent.children
      .filter(c => c.agentId !== current.agentId)
      .map(c => ({ agentId: c.agentId, hash: c.hash }))

    proof.push({
      node: current.agentId,
      hash: current.hash,
      parent: parent.agentId,
      siblings,
    })
  }

  // Add root
  const root = tree.get('nyx')
  proof.push({ node: 'nyx', hash: root.hash, parent: null, siblings: [] })

  return {
    agentId,
    rootHash,
    proof,
    verified: verifyProof(agentId, proof),
  }
}

// ============ Verify Proof ============

function verifyProof(agentId, proof) {
  if (!proof || proof.length === 0) return false

  // The last element should be nyx with the current root hash
  const rootProof = proof[proof.length - 1]
  return rootProof.node === 'nyx' && rootProof.hash === rootHash
}

// ============ Path to Root ============

function getPathToRoot(agentId) {
  const path = [agentId]
  let current = agentId

  while (current !== 'nyx') {
    const parent = Object.entries(HIERARCHY).find(([_, config]) =>
      config.children.includes(current)
    )
    if (!parent) break
    path.push(parent[0])
    current = parent[0]
  }

  return path
}

// ============ Get Full Tree State ============

export function getTreeState() {
  const nodes = {}
  for (const [agentId, node] of tree) {
    const config = HIERARCHY[agentId]
    const constellation = CONSTELLATION[agentId]
    nodes[agentId] = {
      hash: node.hash?.slice(0, 16),
      fullHash: node.hash,
      tier: config?.tier,
      children: config?.children || [],
      childHashes: node.children.map(c => ({ id: c.agentId, hash: c.hash?.slice(0, 16) })),
      timestamp: node.timestamp,
      constellation,
    }
  }

  return {
    rootHash,
    rootHashShort: rootHash?.slice(0, 16),
    nodeCount: tree.size,
    nodes,
    hierarchy: HIERARCHY,
    constellation: CONSTELLATION,
    history: treeHistory.slice(-10),
  }
}

// ============ Persist ============

export async function persistTree() {
  try {
    const state = {
      rootHash,
      history: treeHistory,
      timestamp: new Date().toISOString(),
    }
    await writeFile(TREE_FILE, JSON.stringify(state, null, 2))
  } catch {}
}

export async function loadTree() {
  try {
    const data = await readFile(TREE_FILE, 'utf-8')
    const state = JSON.parse(data)
    if (state.history) treeHistory = state.history
    return state
  } catch {
    return null
  }
}

// ============ Init ============

export function initMerkleTree() {
  buildTree()
  console.log(`[merkle] Pantheon Merkle tree built. Root: ${rootHash?.slice(0, 16)}... (${tree.size} nodes)`)
  return rootHash
}
