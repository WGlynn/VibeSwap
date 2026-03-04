// ============ SHA-256 PoW Miner Web Worker ============
//
// Correct bit-counting SHA-256 PoW matching CKB Rust implementation.
// Mining loop: SHA-256(challenge || nonce) where nonce is random bytes.
// Mobile-optimized: batch size 50, setTimeout(0) yield between batches.
//
// Messages IN:
//   { type: 'start', challenge: hex, difficulty: number }
//   { type: 'stop' }
//
// Messages OUT:
//   { type: 'proof', nonce: hex, hash: hex, zeroBits: number }
//   { type: 'hashrate', rate: number }  (hashes/sec, every 1s)
// ============

let mining = false;
let challenge = null;
let difficulty = 0;
let generation = 0; // Prevents concurrent miningLoop() instances

/**
 * Count leading zero bits in a Uint8Array hash buffer (0-255).
 * Port of ckb/lib/pow/src/lib.rs count_leading_zero_bits()
 */
function countLeadingZeroBits(hashBytes) {
  for (let i = 0; i < hashBytes.length; i++) {
    if (hashBytes[i] === 0) continue;
    return i * 8 + (Math.clz32(hashBytes[i]) - 24);
  }
  return 255;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
  if (!hex || typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string: length=${hex?.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Mine a batch of nonces. Returns proof if found, null otherwise.
 */
async function mineBatch(challengeBytes, batchSize) {
  let hashes = 0;

  for (let i = 0; i < batchSize; i++) {
    if (!mining) return { hashes, proof: null };

    // Random nonce
    const nonce = crypto.getRandomValues(new Uint8Array(32));

    // SHA-256(challenge || nonce)
    const input = new Uint8Array(challengeBytes.length + nonce.length);
    input.set(challengeBytes);
    input.set(nonce, challengeBytes.length);

    const hashBuffer = await crypto.subtle.digest('SHA-256', input);
    const hashBytes = new Uint8Array(hashBuffer);
    hashes++;

    const zeroBits = countLeadingZeroBits(hashBytes);
    if (zeroBits >= difficulty) {
      return {
        hashes,
        proof: {
          type: 'proof',
          nonce: bytesToHex(nonce),
          hash: bytesToHex(hashBytes),
          zeroBits,
        },
      };
    }
  }

  return { hashes, proof: null };
}

/**
 * Main mining loop — runs until stopped.
 */
async function miningLoop() {
  const BATCH_SIZE = 50; // Mobile-optimized: smaller batches for UI responsiveness
  const HASHRATE_INTERVAL = 1000; // Report hashrate every 1s
  const myGeneration = generation; // Capture — if generation changes, this loop exits

  const challengeBytes = hexToBytes(challenge);
  let totalHashes = 0;
  let lastReport = performance.now();

  while (mining && generation === myGeneration) {
    const result = await mineBatch(challengeBytes, BATCH_SIZE);
    totalHashes += result.hashes;

    if (result.proof) {
      self.postMessage(result.proof);
      // Don't stop — keep mining for more proofs
    }

    // Report hashrate
    const now = performance.now();
    if (now - lastReport >= HASHRATE_INTERVAL) {
      const elapsed = (now - lastReport) / 1000;
      const rate = Math.round(totalHashes / elapsed);
      self.postMessage({ type: 'hashrate', rate });
      totalHashes = 0;
      lastReport = now;
    }

    // Yield to event loop (critical for mobile responsiveness)
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

// ============ Message Handler ============

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === 'start') {
    generation++; // Kill any existing miningLoop() before starting a new one
    challenge = e.data.challenge;
    difficulty = e.data.difficulty || 1; // Minimum 1 — prevents difficulty=0 flood
    mining = true;
    miningLoop();
  } else if (type === 'stop') {
    mining = false;
  }
};
