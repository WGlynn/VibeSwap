/**
 * Quantum-Resistant Cryptography Utilities
 * =========================================
 *
 * Implements Lamport one-time signatures with Merkle tree key management.
 * These signatures are secure against quantum computers because they only
 * rely on the security of hash functions (SHA-256/Keccak).
 *
 * Usage:
 * 1. Generate a key set: generateLamportKeySet(256)
 * 2. Store keys securely (encrypted in localStorage or hardware wallet)
 * 3. Sign messages: signMessage(message, keySet, keyIndex)
 * 4. Create proofs: createQuantumProof(message, keySet, keyIndex)
 */

import { ethers } from 'ethers'

// ============ Constants ============

const BITS = 256 // Number of bits in message hash
const HASH_SIZE = 32 // Size of hash in bytes

// ============ Key Generation ============

/**
 * Generate a single Lamport keypair
 * @returns {Object} { privateKey, publicKey, publicKeyHash }
 */
export function generateLamportKeypair() {
  // Private key: 256 pairs of random 32-byte values
  const privateKey = []
  for (let i = 0; i < BITS; i++) {
    privateKey.push([
      ethers.hexlify(ethers.randomBytes(32)),
      ethers.hexlify(ethers.randomBytes(32))
    ])
  }

  // Public key: hash of each private key element
  const publicKey = privateKey.map(pair => [
    ethers.keccak256(pair[0]),
    ethers.keccak256(pair[1])
  ])

  // Public key hash for compact storage
  const publicKeyHash = hashPublicKey(publicKey)

  return { privateKey, publicKey, publicKeyHash }
}

/**
 * Generate a set of Lamport keypairs with a Merkle tree
 * @param {number} count Number of keypairs (must be power of 2)
 * @returns {Object} { keys, merkleTree, merkleRoot }
 */
export function generateLamportKeySet(count = 256) {
  if (count <= 0 || (count & (count - 1)) !== 0) {
    throw new Error('Key count must be a power of 2')
  }

  console.log(`Generating ${count} Lamport keypairs...`)

  // Generate all keypairs
  const keys = []
  for (let i = 0; i < count; i++) {
    keys.push(generateLamportKeypair())
    if ((i + 1) % 32 === 0) {
      console.log(`Generated ${i + 1}/${count} keys`)
    }
  }

  // Build Merkle tree of public key hashes
  const leaves = keys.map(k => k.publicKeyHash)
  const { tree, root } = buildMerkleTree(leaves)

  return {
    keys,
    merkleTree: tree,
    merkleRoot: root,
    totalKeys: count,
    usedKeys: new Set()
  }
}

// ============ Merkle Tree ============

/**
 * Build a Merkle tree from leaves
 * @param {string[]} leaves Array of leaf hashes
 * @returns {Object} { tree, root }
 */
export function buildMerkleTree(leaves) {
  if (leaves.length === 0) {
    return { tree: [], root: ethers.ZeroHash }
  }

  const tree = [leaves.slice()]

  while (tree[tree.length - 1].length > 1) {
    const level = tree[tree.length - 1]
    const nextLevel = []

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1] || left
      nextLevel.push(ethers.keccak256(ethers.concat([left, right])))
    }

    tree.push(nextLevel)
  }

  return {
    tree,
    root: tree[tree.length - 1][0]
  }
}

/**
 * Get Merkle proof for a leaf
 * @param {number} index Leaf index
 * @param {string[][]} tree The Merkle tree
 * @returns {string[]} Array of proof hashes
 */
export function getMerkleProof(index, tree) {
  const proof = []
  let currentIndex = index

  for (let level = 0; level < tree.length - 1; level++) {
    const isRight = currentIndex % 2 === 1
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1

    if (siblingIndex < tree[level].length) {
      proof.push(tree[level][siblingIndex])
    }

    currentIndex = Math.floor(currentIndex / 2)
  }

  return proof
}

/**
 * Verify a Merkle proof
 * @param {string} leaf The leaf hash
 * @param {number} index Leaf index
 * @param {string[]} proof The Merkle proof
 * @param {string} root Expected root
 * @returns {boolean} Whether proof is valid
 */
export function verifyMerkleProof(leaf, index, proof, root) {
  let computedHash = leaf

  for (let i = 0; i < proof.length; i++) {
    const proofElement = proof[i]
    if ((index >> i) & 1) {
      computedHash = ethers.keccak256(ethers.concat([proofElement, computedHash]))
    } else {
      computedHash = ethers.keccak256(ethers.concat([computedHash, proofElement]))
    }
  }

  return computedHash === root
}

// ============ Signing ============

/**
 * Hash message for signing
 * @param {string|Uint8Array} message Message to hash
 * @returns {string} SHA-256 hash
 */
export function hashMessage(message) {
  if (typeof message === 'string') {
    message = ethers.toUtf8Bytes(message)
  }
  return ethers.sha256(message)
}

/**
 * Hash structured message with domain separator
 * @param {string} domainSeparator Contract's domain separator
 * @param {string} data Encoded data
 * @returns {string} Message hash
 */
export function hashStructuredMessage(domainSeparator, data) {
  return ethers.sha256(ethers.concat([domainSeparator, data]))
}

/**
 * Sign a message with a Lamport private key
 * @param {string} messageHash 32-byte message hash
 * @param {string[][]} privateKey Lamport private key
 * @returns {Object} { signature, oppositeHashes }
 */
export function signWithLamport(messageHash, privateKey) {
  const msgBytes = ethers.getBytes(messageHash)
  const signature = []
  const oppositeHashes = []

  for (let i = 0; i < BITS; i++) {
    // Get bit i of message
    const byteIndex = Math.floor(i / 8)
    const bitIndex = 7 - (i % 8)
    const bit = (msgBytes[byteIndex] >> bitIndex) & 1

    // Reveal the private key element for this bit
    signature.push(privateKey[i][bit])

    // Store the hash of the opposite element (for verification)
    oppositeHashes.push(ethers.keccak256(privateKey[i][1 - bit]))
  }

  return { signature, oppositeHashes }
}

/**
 * Verify a Lamport signature
 * @param {string} messageHash Message hash
 * @param {string[]} signature Revealed private key elements
 * @param {string[]} oppositeHashes Hashes of opposite elements
 * @param {string} expectedPkHash Expected public key hash
 * @returns {boolean} Whether signature is valid
 */
export function verifyLamportSignature(messageHash, signature, oppositeHashes, expectedPkHash) {
  const msgBytes = ethers.getBytes(messageHash)
  const pkData = []

  for (let i = 0; i < BITS; i++) {
    const byteIndex = Math.floor(i / 8)
    const bitIndex = 7 - (i % 8)
    const bit = (msgBytes[byteIndex] >> bitIndex) & 1

    const revealedHash = ethers.keccak256(signature[i])

    if (bit === 0) {
      pkData.push(revealedHash, oppositeHashes[i])
    } else {
      pkData.push(oppositeHashes[i], revealedHash)
    }
  }

  const computedPkHash = ethers.keccak256(ethers.concat(pkData))
  return computedPkHash === expectedPkHash
}

// ============ Full Proof Generation ============

/**
 * Create a complete quantum proof for a transaction
 * @param {Object} keySet The key set from generateLamportKeySet
 * @param {number} keyIndex Which key to use
 * @param {string} messageHash Message to sign
 * @returns {Object} Proof object ready for contract submission
 */
export function createQuantumProof(keySet, keyIndex, messageHash) {
  if (keyIndex >= keySet.totalKeys) {
    throw new Error('Key index out of range')
  }
  if (keySet.usedKeys.has(keyIndex)) {
    throw new Error('Key already used')
  }

  const key = keySet.keys[keyIndex]
  const { signature, oppositeHashes } = signWithLamport(messageHash, key.privateKey)
  const merkleProof = getMerkleProof(keyIndex, keySet.merkleTree)

  // Mark key as used locally
  keySet.usedKeys.add(keyIndex)

  return {
    keyIndex,
    publicKeyHash: key.publicKeyHash,
    merkleProof,
    signature,
    oppositeHashes
  }
}

/**
 * Get next available key index
 * @param {Object} keySet The key set
 * @returns {number} Next unused key index, or -1 if exhausted
 */
export function getNextKeyIndex(keySet) {
  for (let i = 0; i < keySet.totalKeys; i++) {
    if (!keySet.usedKeys.has(i)) {
      return i
    }
  }
  return -1
}

// ============ Utility Functions ============

/**
 * Hash a Lamport public key
 * @param {string[][]} publicKey The public key (array of hash pairs)
 * @returns {string} Keccak256 hash of the public key
 */
export function hashPublicKey(publicKey) {
  const flattened = publicKey.flat()
  return ethers.keccak256(ethers.concat(flattened))
}

/**
 * Serialize a key set for storage
 * @param {Object} keySet The key set to serialize
 * @returns {string} JSON string
 */
export function serializeKeySet(keySet) {
  return JSON.stringify({
    keys: keySet.keys,
    merkleRoot: keySet.merkleRoot,
    totalKeys: keySet.totalKeys,
    usedKeys: Array.from(keySet.usedKeys)
  })
}

/**
 * Deserialize a key set from storage
 * @param {string} json Serialized key set
 * @returns {Object} Restored key set
 */
export function deserializeKeySet(json) {
  const data = JSON.parse(json)

  // Rebuild Merkle tree
  const leaves = data.keys.map(k => k.publicKeyHash)
  const { tree } = buildMerkleTree(leaves)

  return {
    keys: data.keys,
    merkleTree: tree,
    merkleRoot: data.merkleRoot,
    totalKeys: data.totalKeys,
    usedKeys: new Set(data.usedKeys)
  }
}

/**
 * Encrypt key set with password
 * @param {Object} keySet Key set to encrypt
 * @param {string} password Encryption password
 * @returns {Promise<string>} Encrypted data
 */
export async function encryptKeySet(keySet, password) {
  const json = serializeKeySet(keySet)
  const encoder = new TextEncoder()
  const data = encoder.encode(json)

  // Derive key from password
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encryptionKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    data
  )

  // Combine salt + iv + encrypted data
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(encrypted), salt.length + iv.length)

  return ethers.hexlify(combined)
}

/**
 * Decrypt key set with password
 * @param {string} encryptedHex Encrypted data
 * @param {string} password Decryption password
 * @returns {Promise<Object>} Decrypted key set
 */
export async function decryptKeySet(encryptedHex, password) {
  const combined = ethers.getBytes(encryptedHex)
  const encoder = new TextEncoder()

  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const encrypted = combined.slice(28)

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  const decryptionKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    decryptionKey,
    encrypted
  )

  const decoder = new TextDecoder()
  const json = decoder.decode(decrypted)
  return deserializeKeySet(json)
}

// ============ Storage Helpers ============

const STORAGE_KEY = 'vibeswap_quantum_keys'

/**
 * Save encrypted keys to localStorage
 */
export async function saveQuantumKeys(keySet, password, address) {
  const encrypted = await encryptKeySet(keySet, password)
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  stored[address.toLowerCase()] = {
    encrypted,
    merkleRoot: keySet.merkleRoot,
    totalKeys: keySet.totalKeys,
    usedCount: keySet.usedKeys.size
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

/**
 * Load encrypted keys from localStorage
 */
export async function loadQuantumKeys(password, address) {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  const data = stored[address.toLowerCase()]
  if (!data) return null
  return decryptKeySet(data.encrypted, password)
}

/**
 * Check if quantum keys exist for address
 */
export function hasStoredQuantumKeys(address) {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  return !!stored[address.toLowerCase()]
}

/**
 * Get stored key metadata without decrypting
 */
export function getQuantumKeyMetadata(address) {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  return stored[address.toLowerCase()] || null
}
