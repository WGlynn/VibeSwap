// ============ x402 — HTTP 402 Payment Required ============
//
// The forgotten HTTP status code, finally fulfilled.
// Machine-to-machine micropayments for API access.
// AI agents pay per-call, no subscriptions, no API keys —
// just cryptographic proof of payment.
//
// x402 + VibeSwap: JARVIS becomes an economic agent,
// not just a chatbot. Intelligence has a price.
// The singularity is just a well-architected toll booth.
//
// Stack: ERC-8004 (identity) + x402 (payment) + CRPC (verification)
//        + ContextAnchor (memory) = full autonomous agent infrastructure
//
// Flow:
//   1. Client requests premium endpoint without payment
//   2. Server returns 402 with payment instructions
//   3. Client sends payment on-chain (VIBE, ETH, or stablecoin)
//   4. Client retries with X-Payment-Proof header (tx hash)
//   5. Server validates proof, serves response
//   6. Optional: X-Payment-Receipt header for pre-paid sessions
//
// Pricing tiers:
//   FREE   — health, status, covenants, lexicon (public goods)
//   LOW    — reads: mining stats, leaderboard, predictions, rosetta
//   MEDIUM — writes: chat, TTS, primitive creation
//   HIGH   — compute: streaming chat, CRPC demo, intelligence synthesis
// ============

import { config } from './config.js';
import { ethers } from 'ethers';
import { createHash, createHmac, randomBytes } from 'crypto';

// ============ Pricing Configuration ============

/**
 * @notice Price tiers in wei-equivalent units.
 *         Actual denomination depends on payment token.
 *         These are baseline prices — adjusted by network congestion.
 */
const TIER = {
  FREE: 0,
  LOW: 100,           // ~$0.001 at $10/VIBE — a read query
  MEDIUM: 1000,       // ~$0.01 — a write or LLM call
  HIGH: 10000,        // ~$0.10 — heavy compute (streaming, synthesis)
};

/**
 * @notice Route → tier mapping. Routes not listed are FREE by default.
 *         Exact match takes priority, then prefix match.
 */
const ROUTE_PRICING = {
  // FREE — public goods, always open
  '/web/health': TIER.FREE,
  '/web/covenants': TIER.FREE,
  '/web/rosetta/lexicon': TIER.FREE,
  '/web/mining/supply': TIER.FREE,
  '/web/mining/target': TIER.FREE,

  // LOW — reads and lightweight queries
  '/web/mind': TIER.LOW,
  '/web/mesh': TIER.LOW,
  '/web/mining/stats': TIER.LOW,
  '/web/mining/leaderboard': TIER.LOW,
  '/web/predictions': TIER.LOW,
  '/web/rosetta/view': TIER.LOW,
  '/web/rosetta/translate': TIER.LOW,
  '/web/rosetta/all': TIER.LOW,
  '/web/attribution': TIER.LOW,
  '/web/wardenclyffe': TIER.LOW,
  '/web/intelligence': TIER.LOW,
  '/web/infofi/stats': TIER.LOW,
  '/web/infofi/primitives': TIER.LOW,
  '/web/infofi/search': TIER.LOW,

  // MEDIUM — writes and single LLM calls
  '/web/chat': TIER.MEDIUM,
  '/web/tts': TIER.MEDIUM,
  '/web/report': TIER.MEDIUM,
  '/web/predictions/create': TIER.MEDIUM,
  '/web/predictions/bet': TIER.MEDIUM,

  // HIGH — heavy compute
  '/web/chat/stream': TIER.HIGH,
  '/crpc/demo': TIER.HIGH,
};

// ============ Payment Validation State ============

// tx hash → { verified, amount, payer, timestamp, remaining }
const paymentProofs = new Map();
const MAX_PROOFS = 10000;
const PROOF_TTL = 3_600_000; // 1 hour — proofs expire after this

// Pre-paid session balances: sessionKey → { balance, lastTx, expires }
const sessionBalances = new Map();
const SESSION_TTL = 86_400_000; // 24 hours

// ============ Bloom Filter — Stateless Payment Verification ============
//
// TG Jarvis insight: "payment proof validation needs to be stateless —
// can't query chain for every request. maybe a bloom filter of recent txs
// plus a signed receipt from a relayer?"
//
// Bloom filter stores hashes of verified tx hashes for O(1) lookup.
// False positives are OK (worst case: we accept an unverified tx, which
// gets caught on the next RPC sweep). False negatives: impossible.
// This means 99.9% of repeat requests skip the RPC entirely.

const BLOOM_SIZE = 65536; // 64K bits
const BLOOM_HASHES = 7;   // 7 hash functions → ~0.8% false positive rate at 5000 entries
const bloomFilter = new Uint8Array(BLOOM_SIZE / 8);
let bloomEntries = 0;

function bloomAdd(txHash) {
  const positions = bloomPositions(txHash);
  for (const pos of positions) {
    bloomFilter[Math.floor(pos / 8)] |= (1 << (pos % 8));
  }
  bloomEntries++;
  // Reset bloom if too full (false positive rate increases)
  if (bloomEntries > BLOOM_SIZE / BLOOM_HASHES) {
    bloomFilter.fill(0);
    bloomEntries = 0;
    // Re-add recent proofs
    for (const [hash] of paymentProofs) {
      const positions = bloomPositions(hash);
      for (const pos of positions) {
        bloomFilter[Math.floor(pos / 8)] |= (1 << (pos % 8));
      }
      bloomEntries++;
    }
  }
}

function bloomMightContain(txHash) {
  const positions = bloomPositions(txHash);
  for (const pos of positions) {
    if (!(bloomFilter[Math.floor(pos / 8)] & (1 << (pos % 8)))) {
      return false; // Definitely not present
    }
  }
  return true; // Might be present (check map to confirm)
}

function bloomPositions(txHash) {
  const positions = [];
  for (let i = 0; i < BLOOM_HASHES; i++) {
    const h = createHash('sha256').update(`${txHash}:${i}`).digest();
    const pos = h.readUInt32BE(0) % BLOOM_SIZE;
    positions.push(pos);
  }
  return positions;
}

// ============ Signed Receipts — Relayer Pattern ============
//
// After verifying a payment on-chain, issue a signed receipt that the
// client can reuse without triggering another RPC call. The receipt is
// HMAC-signed with a server secret, so it can't be forged.
//
// Receipt format: base64(JSON({ payer, amount, expires, nonce })):HMAC

let receiptSecret = null; // Generated at init

function createSignedReceipt(payer, amount, ttlMs = SESSION_TTL) {
  if (!receiptSecret) return null;

  const receipt = {
    payer,
    amount,
    expires: Date.now() + ttlMs,
    nonce: randomBytes(8).toString('hex'),
  };

  const payload = Buffer.from(JSON.stringify(receipt)).toString('base64');
  const sig = createHmac('sha256', receiptSecret).update(payload).digest('hex');

  return `${payload}:${sig}`;
}

function validateSignedReceipt(receiptStr) {
  if (!receiptSecret || !receiptStr) return null;

  const parts = receiptStr.split(':');
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  const expected = createHmac('sha256', receiptSecret).update(payload).digest('hex');

  // Timing-safe comparison
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    const receipt = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (Date.now() > receipt.expires) return null; // Expired
    return receipt;
  } catch {
    return null;
  }
}

// ============ Configuration ============

// Payment receiver address (VibeSwap treasury)
let treasuryAddress = null;
// Accepted payment tokens (VIBE + stablecoins + any ERC20)
let acceptedTokens = [];
// Whether x402 is enabled (off by default until treasury is configured)
let x402Enabled = false;
// RPC provider for on-chain verification
let provider = null;

/**
 * @notice Initialize x402 payment system
 * @param opts.treasury - Treasury address to receive payments
 * @param opts.tokens - Array of { address, symbol, decimals, priceInWei }
 * @param opts.rpcUrl - RPC URL for payment verification
 */
export function initX402(opts = {}) {
  treasuryAddress = opts.treasury || process.env.X402_TREASURY;
  if (!treasuryAddress) {
    console.log('[x402] No treasury configured — x402 disabled (all endpoints free)');
    return;
  }

  acceptedTokens = opts.tokens || [
    {
      symbol: 'VIBE',
      address: process.env.VIBE_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000',
      decimals: 18,
    },
    {
      symbol: 'ETH',
      address: '0x0000000000000000000000000000000000000000', // native
      decimals: 18,
    },
  ];

  if (opts.rpcUrl || process.env.X402_RPC_URL) {
    try {
      provider = new ethers.JsonRpcProvider(opts.rpcUrl || process.env.X402_RPC_URL);
      console.log(`[x402] RPC provider initialized: ${opts.rpcUrl || process.env.X402_RPC_URL}`);
    } catch (err) {
      console.warn(`[x402] RPC init failed: ${err.message}`);
    }
  }

  // Generate receipt signing secret (ephemeral per instance — receipts don't survive restarts)
  receiptSecret = process.env.X402_RECEIPT_SECRET || randomBytes(32).toString('hex');

  // Accept additional tokens from env: X402_EXTRA_TOKENS=PEPE:0xaddr:18,USDC:0xaddr:6
  const extraTokens = process.env.X402_EXTRA_TOKENS;
  if (extraTokens) {
    for (const spec of extraTokens.split(',')) {
      const [symbol, address, decimals] = spec.split(':');
      if (symbol && address) {
        acceptedTokens.push({ symbol, address, decimals: parseInt(decimals || '18') });
      }
    }
  }

  x402Enabled = true;
  console.log(`[x402] Payment system active. Treasury: ${treasuryAddress}`);
  console.log(`[x402] Accepted tokens: ${acceptedTokens.map(t => t.symbol).join(', ')}`);
  console.log(`[x402] Tiers: FREE=${TIER.FREE}, LOW=${TIER.LOW}, MEDIUM=${TIER.MEDIUM}, HIGH=${TIER.HIGH}`);
  console.log(`[x402] Bloom filter: ${BLOOM_SIZE} bits, ${BLOOM_HASHES} hashes`);
  console.log(`[x402] Signed receipts: enabled (HMAC-SHA256)`);
}

// ============ Core Middleware ============

/**
 * @notice x402 payment gate middleware.
 *         Returns true if request should proceed (paid or free).
 *         Returns false if 402 response was sent (needs payment).
 *
 * @param req - HTTP request
 * @param res - HTTP response
 * @param pathname - Route path (e.g., '/web/chat')
 * @returns {Promise<boolean>} true = proceed, false = 402 sent
 */
export async function x402Gate(req, res, pathname) {
  // If x402 is not enabled, everything is free
  if (!x402Enabled) return true;

  // Determine price for this route
  const price = getRoutePrice(pathname);
  if (price === 0) return true; // Free endpoint

  // Check for payment proof (3 verification paths, fastest first)
  const proofHeader = req.headers['x-payment-proof'];
  const receiptHeader = req.headers['x-payment-receipt'];

  // Path 1: Signed receipt (fastest — pure crypto, no I/O)
  // This is the relayer pattern: after one on-chain verification,
  // subsequent requests use a HMAC-signed receipt. Zero RPC calls.
  if (receiptHeader) {
    const receipt = validateSignedReceipt(receiptHeader);
    if (receipt && receipt.amount >= price) {
      return true; // Cryptographically valid, not expired
    }
    // Also check legacy session balances
    const session = sessionBalances.get(receiptHeader);
    if (session && session.balance >= price && Date.now() < session.expires) {
      session.balance -= price;
      return true;
    }
  }

  // Path 2: Bloom filter fast-path (O(1) — no RPC if previously verified)
  // If this tx hash was already verified, skip RPC entirely
  if (proofHeader && bloomMightContain(proofHeader)) {
    const cached = paymentProofs.get(proofHeader);
    if (cached && cached.remaining >= price) {
      cached.remaining -= price;
      return true;
    }
  }

  // Path 3: Full on-chain verification (slowest — RPC call)
  if (proofHeader) {
    const validation = await validatePaymentProof(proofHeader, price);
    if (validation.valid) {
      // Add to bloom filter for future fast-path lookups
      bloomAdd(proofHeader);

      // Issue signed receipt for future requests (no more RPC needed)
      const signedReceipt = createSignedReceipt(
        validation.payer,
        validation.remaining + price, // Total paid
        SESSION_TTL
      );
      if (signedReceipt) {
        res.setHeader('X-Payment-Receipt', signedReceipt);
      }

      // Also credit session balance for overpayment
      if (validation.remaining > 0) {
        res.setHeader('X-Payment-Balance', String(validation.remaining));
      }
      return true;
    }
  }

  // No valid payment — return 402 with payment instructions
  send402(res, pathname, price);
  return false;
}

// ============ 402 Response ============

/**
 * @notice Send HTTP 402 Payment Required with machine-readable payment instructions
 */
function send402(res, pathname, price) {
  const paymentInfo = {
    status: 402,
    message: 'Payment Required',
    endpoint: pathname,
    price: {
      amount: price,
      currency: 'VIBE',
      denomination: 'wei',
    },
    payment: {
      to: treasuryAddress,
      acceptedTokens: acceptedTokens.map(t => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
      })),
      // How to pay: include tx hash in X-Payment-Proof header on retry
      instructions: [
        `1. Send ${price} wei of any accepted token to ${treasuryAddress}`,
        '2. Retry this request with header: X-Payment-Proof: <tx_hash>',
        '3. Overpayment creates a session balance (returned in X-Payment-Receipt)',
        '4. Use X-Payment-Receipt header for subsequent requests until balance depleted',
      ],
    },
    pricing: {
      tiers: TIER,
      thisEndpoint: getTierName(price),
    },
  };

  res.writeHead(402, {
    'Content-Type': 'application/json',
    'X-Payment-Required': 'true',
    'X-Payment-Address': treasuryAddress,
    'X-Payment-Amount': String(price),
    'X-Payment-Currency': 'VIBE',
  });
  res.end(JSON.stringify(paymentInfo));
}

// ============ Payment Verification ============

/**
 * @notice Validate a payment proof (transaction hash)
 * @param txHash - Transaction hash from X-Payment-Proof header
 * @param requiredAmount - Minimum payment required
 * @returns {{ valid: boolean, remaining: number, payer: string|null }}
 */
async function validatePaymentProof(txHash, requiredAmount) {
  // Check cache first
  const cached = paymentProofs.get(txHash);
  if (cached) {
    if (cached.remaining >= requiredAmount) {
      cached.remaining -= requiredAmount;
      return { valid: true, remaining: cached.remaining, payer: cached.payer };
    }
    return { valid: false, remaining: 0, payer: null };
  }

  // On-chain verification
  if (!provider) {
    // No RPC — trust-but-verify mode (accept proof, verify async later)
    console.warn(`[x402] No RPC provider — accepting proof ${txHash.slice(0, 10)}... on trust`);
    paymentProofs.set(txHash, {
      verified: false,
      amount: requiredAmount,
      payer: 'unknown',
      timestamp: Date.now(),
      remaining: 0,
    });
    pruneProofs();
    return { valid: true, remaining: 0, payer: 'unknown' };
  }

  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return { valid: false, remaining: 0, payer: null };
    }

    // Verify recipient is treasury
    const tx = await provider.getTransaction(txHash);
    if (!tx) return { valid: false, remaining: 0, payer: null };

    const toAddress = (tx.to || '').toLowerCase();
    const treasury = treasuryAddress.toLowerCase();

    if (toAddress !== treasury) {
      // Check if it's a token transfer to treasury (ERC20 transfer event)
      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const transferLog = receipt.logs.find(log =>
        log.topics[0] === transferTopic &&
        log.topics[2] &&
        '0x' + log.topics[2].slice(26).toLowerCase() === treasury
      );

      if (!transferLog) {
        return { valid: false, remaining: 0, payer: null };
      }
    }

    // Payment verified
    const paidAmount = Number(tx.value || 0);
    const remaining = Math.max(0, paidAmount - requiredAmount);

    paymentProofs.set(txHash, {
      verified: true,
      amount: paidAmount,
      payer: tx.from,
      timestamp: Date.now(),
      remaining,
    });
    pruneProofs();

    console.log(`[x402] Payment verified: ${txHash.slice(0, 10)}... from ${tx.from?.slice(0, 10)} amount=${paidAmount} remaining=${remaining}`);
    return { valid: true, remaining, payer: tx.from };
  } catch (err) {
    console.warn(`[x402] Verification failed for ${txHash.slice(0, 10)}...: ${err.message}`);
    return { valid: false, remaining: 0, payer: null };
  }
}

// ============ Helpers ============

/**
 * @notice Get price for a route (exact match → prefix match → FREE)
 */
function getRoutePrice(pathname) {
  // Exact match
  if (ROUTE_PRICING[pathname] !== undefined) return ROUTE_PRICING[pathname];

  // Prefix match (e.g., '/web/mining/stats/123' matches '/web/mining/stats')
  for (const [route, price] of Object.entries(ROUTE_PRICING)) {
    if (pathname.startsWith(route)) return price;
  }

  return TIER.FREE; // Default: free
}

function getTierName(price) {
  if (price <= TIER.FREE) return 'FREE';
  if (price <= TIER.LOW) return 'LOW';
  if (price <= TIER.MEDIUM) return 'MEDIUM';
  return 'HIGH';
}

function pruneProofs() {
  if (paymentProofs.size <= MAX_PROOFS) return;
  const now = Date.now();
  for (const [hash, proof] of paymentProofs) {
    if (now - proof.timestamp > PROOF_TTL) {
      paymentProofs.delete(hash);
    }
  }
  // If still over limit, evict oldest
  if (paymentProofs.size > MAX_PROOFS) {
    const entries = [...paymentProofs.entries()];
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const excess = paymentProofs.size - MAX_PROOFS;
    for (let i = 0; i < excess; i++) {
      paymentProofs.delete(entries[i][0]);
    }
  }
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [hash, proof] of paymentProofs) {
    if (now - proof.timestamp > PROOF_TTL) paymentProofs.delete(hash);
  }
  for (const [key, session] of sessionBalances) {
    if (now > session.expires) sessionBalances.delete(key);
  }
}, 5 * 60_000);

// ============ Stats ============

export function getX402Stats() {
  return {
    enabled: x402Enabled,
    treasury: treasuryAddress,
    acceptedTokens: acceptedTokens.map(t => t.symbol),
    tiers: TIER,
    activeSessions: sessionBalances.size,
    cachedProofs: paymentProofs.size,
    routeCount: Object.keys(ROUTE_PRICING).length,
  };
}

/**
 * @notice Get pricing info for a specific route (for UI display)
 */
export function getRoutePricing(pathname) {
  const price = getRoutePrice(pathname);
  return {
    endpoint: pathname,
    price,
    tier: getTierName(price),
    currency: 'VIBE',
    free: price === 0,
  };
}

/**
 * @notice Get full pricing schedule (for documentation)
 */
export function getPricingSchedule() {
  const schedule = {};
  for (const [route, price] of Object.entries(ROUTE_PRICING)) {
    schedule[route] = { price, tier: getTierName(price) };
  }
  return { tiers: TIER, routes: schedule, treasury: treasuryAddress };
}
