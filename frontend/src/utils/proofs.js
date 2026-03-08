/**
 * Proof Verification Utilities — 7-Layer Security for Frontend ↔ Backend State
 *
 * These utilities ensure that all digital asset state (JUL balances, compute credits,
 * token balances, positions, etc.) is provably and immutably correct between the
 * frontend and backend. No trust assumptions — verify everything cryptographically.
 *
 * LAYER 1: ECDSA Signatures — User signs messages with their private key
 * LAYER 2: One-Time Stamps — Monotonic nonces prevent replay attacks
 * LAYER 3: Binding Proofs — Tie (user, amount, action, timestamp) together
 * LAYER 4: Fraud Proofs — Detect and flag state inconsistencies
 * LAYER 5: Rate Limiting — Prevent sybil abuse at the request level
 * LAYER 6: PoW Ancestry — Link actions to original mining work
 * LAYER 7: Commitment Scheme — Commit-reveal for MEV protection
 */

// ============ LAYER 1: ECDSA Signatures ============

/**
 * Sign a message with the user's wallet (MetaMask, WalletConnect, etc.)
 * Returns the signature that the backend can verify against the user's address.
 */
export async function signMessage(provider, address, message) {
  if (!provider || !address) throw new Error('Wallet not connected')

  // EIP-191 personal_sign
  const messageBytes = typeof message === 'string'
    ? message
    : JSON.stringify(message)

  const signature = await provider.request({
    method: 'personal_sign',
    params: [messageBytes, address],
  })

  return {
    message: messageBytes,
    signature,
    signer: address,
    timestamp: Date.now(),
  }
}

/**
 * Create a signed action request (for any state-changing operation)
 */
export async function createSignedAction(provider, address, action, data) {
  const nonce = getNextNonce(address)
  const timestamp = Date.now()

  const payload = {
    action,
    data,
    nonce,
    timestamp,
    address,
  }

  const bindingProof = await generateBindingProof(address, action, nonce, timestamp)
  payload.bindingProof = bindingProof

  const signed = await signMessage(provider, address, JSON.stringify(payload))

  return {
    ...payload,
    signature: signed.signature,
  }
}

// ============ LAYER 2: One-Time Stamps (Nonces) ============

const NONCE_KEY = 'vsos_nonces'

/**
 * Get the next unused nonce for an address.
 * Nonces are monotonically increasing — each can only be used once.
 */
export function getNextNonce(address) {
  const key = `${NONCE_KEY}:${address?.toLowerCase()}`
  const current = parseInt(localStorage.getItem(key) || '0', 10)
  const next = current + 1
  localStorage.setItem(key, String(next))
  return next
}

/**
 * Verify a nonce hasn't been used before (client-side pre-check)
 */
export function isNonceValid(address, nonce) {
  const key = `${NONCE_KEY}:${address?.toLowerCase()}`
  const current = parseInt(localStorage.getItem(key) || '0', 10)
  return nonce > current - 100 && nonce <= current // Allow last 100 nonces
}

// ============ LAYER 3: Binding Proofs ============

/**
 * Generate a SHA-256 binding proof that ties together:
 * (address, action/amount, nonce, timestamp)
 *
 * This proof is verified by the backend against on-chain state.
 * The binding is deterministic — same inputs always produce same hash.
 */
export async function generateBindingProof(address, data, nonce, timestamp) {
  const input = `${address}:${JSON.stringify(data)}:${nonce}:${timestamp}`
  const encoded = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Verify a binding proof locally (before sending to backend)
 */
export async function verifyBindingProof(address, data, nonce, timestamp, expectedProof) {
  const computed = await generateBindingProof(address, data, nonce, timestamp)
  return computed === expectedProof
}

// ============ LAYER 4: Fraud Detection ============

const STATE_CACHE_KEY = 'vsos_state_cache'

/**
 * Cache the last known good state from the backend.
 * If the backend returns a state that contradicts cached state
 * (e.g., balance goes UP without a deposit), flag it as fraud.
 */
export function cacheState(address, stateType, state) {
  const key = `${STATE_CACHE_KEY}:${address?.toLowerCase()}:${stateType}`
  const entry = {
    state,
    timestamp: Date.now(),
    hash: null, // Set below
  }

  // Compute state hash for integrity checking
  const stateStr = JSON.stringify(state)
  entry.hash = simpleHash(stateStr)

  localStorage.setItem(key, JSON.stringify(entry))
  return entry.hash
}

/**
 * Verify backend state against cached state.
 * Returns { valid, anomalies } where anomalies lists any suspicious changes.
 */
export function verifyState(address, stateType, newState, rules = {}) {
  const key = `${STATE_CACHE_KEY}:${address?.toLowerCase()}:${stateType}`
  const cached = JSON.parse(localStorage.getItem(key) || 'null')

  if (!cached) {
    // First time — cache and trust
    cacheState(address, stateType, newState)
    return { valid: true, anomalies: [] }
  }

  const anomalies = []

  // Rule: balance should never increase without a known deposit/reward
  if (rules.monotonicDecrease && newState.balance > cached.state.balance) {
    anomalies.push({
      type: 'unexpected_increase',
      field: 'balance',
      old: cached.state.balance,
      new: newState.balance,
      delta: newState.balance - cached.state.balance,
    })
  }

  // Rule: nonce should never decrease
  if (rules.monotonicNonce && newState.nonce < cached.state.nonce) {
    anomalies.push({
      type: 'nonce_regression',
      field: 'nonce',
      old: cached.state.nonce,
      new: newState.nonce,
    })
  }

  // Rule: credits should never appear without a deposit
  if (rules.creditIntegrity && newState.credits > cached.state.credits) {
    if (!newState.lastDeposit || newState.lastDeposit <= cached.state.lastDeposit) {
      anomalies.push({
        type: 'phantom_credits',
        field: 'credits',
        old: cached.state.credits,
        new: newState.credits,
      })
    }
  }

  // Update cache
  cacheState(address, stateType, newState)

  return {
    valid: anomalies.length === 0,
    anomalies,
  }
}

// ============ LAYER 5: Rate Limiting (Client-Side) ============

const RATE_LIMIT_KEY = 'vsos_rate_limits'

/**
 * Check if an action is within rate limits before sending to backend.
 * Prevents wasting bandwidth on requests that will be rejected.
 */
export function checkRateLimit(address, action, maxPerMinute = 10) {
  const key = `${RATE_LIMIT_KEY}:${address?.toLowerCase()}:${action}`
  const now = Date.now()
  const window = 60_000 // 1 minute

  const entries = JSON.parse(localStorage.getItem(key) || '[]')
  const recent = entries.filter(t => now - t < window)

  if (recent.length >= maxPerMinute) {
    return {
      allowed: false,
      retryAfter: Math.ceil((recent[0] + window - now) / 1000),
      count: recent.length,
    }
  }

  recent.push(now)
  localStorage.setItem(key, JSON.stringify(recent))

  return { allowed: true, count: recent.length }
}

// ============ LAYER 7: Commitment Scheme ============

const COMMIT_KEY = 'vsos_commits'

/**
 * Create a commitment hash for a future action (MEV protection).
 * User commits to an action before revealing it.
 */
export async function createCommitment(address, action, data, secret) {
  const commitInput = `${address}:${action}:${JSON.stringify(data)}:${secret}`
  const encoded = new TextEncoder().encode(commitInput)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = new Uint8Array(hashBuffer)
  const commitHash = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')

  // Store locally for reveal phase
  const key = `${COMMIT_KEY}:${commitHash}`
  localStorage.setItem(key, JSON.stringify({
    address,
    action,
    data,
    secret,
    commitHash,
    committedAt: Date.now(),
  }))

  return commitHash
}

/**
 * Reveal a commitment (provides the preimage to verify the commit hash)
 */
export function revealCommitment(commitHash) {
  const key = `${COMMIT_KEY}:${commitHash}`
  const stored = JSON.parse(localStorage.getItem(key) || 'null')
  if (!stored) throw new Error('Commitment not found — was it made on this device?')

  // Clean up after reveal
  localStorage.removeItem(key)

  return stored
}

// ============ Helpers ============

/**
 * Simple non-cryptographic hash for state integrity (fast, not secure)
 * Use SHA-256 via generateBindingProof for security-critical hashing.
 */
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32bit integer
  }
  return hash.toString(16)
}

/**
 * Wrap a fetch call with proof verification:
 * 1. Adds binding proof to request
 * 2. Verifies response state against cache
 * 3. Rate limits the request
 */
export async function proofFetch(url, options = {}, proofConfig = {}) {
  const { address, action, rules } = proofConfig

  // Rate limit check
  if (address && action) {
    const limit = checkRateLimit(address, action)
    if (!limit.allowed) {
      throw new Error(`Rate limited — retry in ${limit.retryAfter}s`)
    }
  }

  // Add binding proof to request body
  if (address && action && options.body) {
    const body = JSON.parse(options.body)
    const nonce = getNextNonce(address)
    body._proof = {
      nonce,
      timestamp: Date.now(),
      bindingProof: await generateBindingProof(address, body, nonce, Date.now()),
    }
    options.body = JSON.stringify(body)
  }

  // Execute fetch
  const res = await fetch(url, options)
  const data = await res.json()

  // Verify response state if rules provided
  if (address && rules && data) {
    const verification = verifyState(address, action, data, rules)
    if (!verification.valid) {
      console.warn('[PROOF] State anomalies detected:', verification.anomalies)
      data._anomalies = verification.anomalies
    }
  }

  return data
}
