// ============ JARVIS SOVEREIGN WALLET ============
// Hot wallet for autonomous on-chain actions.
// Private key encrypted at rest with AES-256-GCM.
// Spending limits enforced in code — daily cap, per-tx cap, whitelist.

import { ethers } from 'ethers'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const DATA_DIR = process.env.DATA_DIR || './data'
const WALLET_FILE = join(DATA_DIR, 'wallet-encrypted.json')
const LEDGER_FILE = join(DATA_DIR, 'wallet-ledger.json')

// ============ CHAIN CONFIG ============
const CHAINS = {
  base: {
    name: 'Base',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    nativeSymbol: 'ETH',
  },
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    rpc: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    nativeSymbol: 'ETH',
  },
  arbitrum: {
    name: 'Arbitrum',
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    nativeSymbol: 'ETH',
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    rpc: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io',
    nativeSymbol: 'ETH',
  },
}

// ============ SPENDING LIMITS ============
const DEFAULT_LIMITS = {
  dailyCapUsd: 50,        // Max $50/day to start — conservative
  perTxCapUsd: 20,        // Max $20 per transaction
  dailyTxCount: 20,       // Max 20 transactions per day
  whitelistOnly: true,    // Only send to whitelisted addresses
  whitelist: [],          // Will populates this
  paused: false,          // Emergency pause
}

// ============ ENCRYPTION ============
function deriveKey(passphrase) {
  return scryptSync(passphrase, 'jarvis-vibeswap-salt-v1', 32)
}

function encrypt(data, passphrase) {
  const key = deriveKey(passphrase)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return { encrypted, iv: iv.toString('hex'), tag: tag.toString('hex') }
}

function decrypt(encData, passphrase) {
  const key = deriveKey(passphrase)
  const iv = Buffer.from(encData.iv, 'hex')
  const tag = Buffer.from(encData.tag, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return JSON.parse(decrypted)
}

// ============ STATE ============
let walletData = null    // { address, encryptedKey }
let limits = { ...DEFAULT_LIMITS }
let ledger = { transactions: [], dailySpend: {}, created: null }
let providers = {}       // chain -> JsonRpcProvider
let unlocked = null      // ethers.Wallet (only in memory while unlocked)

// ============ INITIALIZATION ============
export function initWallet() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  // Load existing wallet
  if (existsSync(WALLET_FILE)) {
    try {
      walletData = JSON.parse(readFileSync(WALLET_FILE, 'utf8'))
      console.log(`[wallet] Loaded wallet: ${walletData.address}`)
    } catch (err) {
      console.error('[wallet] Failed to load wallet:', err.message)
    }
  }

  // Load ledger
  if (existsSync(LEDGER_FILE)) {
    try {
      ledger = JSON.parse(readFileSync(LEDGER_FILE, 'utf8'))
    } catch {
      // Fresh ledger
    }
  }

  // Load limits from wallet data
  if (walletData?.limits) {
    limits = { ...DEFAULT_LIMITS, ...walletData.limits }
  }

  // Initialize providers
  for (const [key, chain] of Object.entries(CHAINS)) {
    try {
      providers[key] = new ethers.JsonRpcProvider(chain.rpc, {
        chainId: chain.chainId,
        name: chain.name,
      })
    } catch (err) {
      console.warn(`[wallet] Failed to init ${key} provider:`, err.message)
    }
  }

  console.log(`[wallet] Initialized — ${Object.keys(providers).length} chains, wallet ${walletData ? walletData.address : 'NOT CREATED'}`)
  return { address: walletData?.address || null }
}

// ============ WALLET CREATION ============
export function generateWallet(passphrase) {
  if (walletData) {
    return { error: 'Wallet already exists. Use rotateWallet() to create a new one.' }
  }
  if (!passphrase || passphrase.length < 8) {
    return { error: 'Passphrase must be at least 8 characters.' }
  }

  const wallet = ethers.Wallet.createRandom()
  const encryptedKey = encrypt({ privateKey: wallet.privateKey, mnemonic: wallet.mnemonic?.phrase }, passphrase)

  walletData = {
    address: wallet.address,
    encryptedKey,
    limits: { ...DEFAULT_LIMITS },
    created: new Date().toISOString(),
    version: 1,
  }

  ledger.created = new Date().toISOString()
  saveWallet()
  saveLedger()

  console.log(`[wallet] Generated new wallet: ${wallet.address}`)
  return {
    address: wallet.address,
    mnemonic: wallet.mnemonic?.phrase, // Show ONCE — user must back up
    message: 'Wallet created. BACK UP YOUR MNEMONIC. It will never be shown again.',
  }
}

// ============ UNLOCK / LOCK ============
export function unlockWallet(passphrase) {
  if (!walletData) return { error: 'No wallet exists. Generate one first.' }
  try {
    const { privateKey } = decrypt(walletData.encryptedKey, passphrase)
    unlocked = new ethers.Wallet(privateKey)
    console.log('[wallet] Unlocked')
    return { address: unlocked.address, unlocked: true }
  } catch {
    return { error: 'Wrong passphrase.' }
  }
}

export function lockWallet() {
  unlocked = null
  console.log('[wallet] Locked')
  return { locked: true }
}

export function isUnlocked() {
  return !!unlocked
}

// ============ BALANCE CHECKS ============
export async function getBalances(chain = 'base') {
  if (!walletData) return { error: 'No wallet.' }
  const provider = providers[chain]
  if (!provider) return { error: `Unknown chain: ${chain}` }

  try {
    const balance = await provider.getBalance(walletData.address)
    return {
      address: walletData.address,
      chain: CHAINS[chain].name,
      native: {
        symbol: CHAINS[chain].nativeSymbol,
        balance: ethers.formatEther(balance),
        wei: balance.toString(),
      },
    }
  } catch (err) {
    return { error: `Failed to fetch balance: ${err.message}` }
  }
}

export async function getAllBalances() {
  if (!walletData) return { error: 'No wallet.' }
  const results = {}
  const promises = Object.keys(CHAINS).map(async (chain) => {
    results[chain] = await getBalances(chain)
  })
  await Promise.all(promises)
  return { address: walletData.address, balances: results }
}

// ============ SPENDING LIMIT ENFORCEMENT ============
function getTodayKey() {
  return new Date().toISOString().split('T')[0]
}

function getDailySpend() {
  const today = getTodayKey()
  return ledger.dailySpend[today] || { usd: 0, count: 0 }
}

function recordSpend(usd, txHash, chain, to, value) {
  const today = getTodayKey()
  if (!ledger.dailySpend[today]) ledger.dailySpend[today] = { usd: 0, count: 0 }
  ledger.dailySpend[today].usd += usd
  ledger.dailySpend[today].count += 1

  ledger.transactions.push({
    hash: txHash,
    chain,
    to,
    value,
    usdValue: usd,
    timestamp: new Date().toISOString(),
  })

  // Keep last 500 transactions
  if (ledger.transactions.length > 500) {
    ledger.transactions = ledger.transactions.slice(-500)
  }

  // Clean old daily spend (keep 30 days)
  const keys = Object.keys(ledger.dailySpend).sort()
  while (keys.length > 30) {
    delete ledger.dailySpend[keys.shift()]
  }

  saveLedger()
}

function checkLimits(toAddress, usdValue) {
  if (limits.paused) return 'Wallet is paused. Unpause before transacting.'
  if (limits.whitelistOnly && !limits.whitelist.includes(toAddress?.toLowerCase())) {
    return `Address ${toAddress} not whitelisted. Add it first.`
  }
  if (usdValue > limits.perTxCapUsd) {
    return `Transaction $${usdValue} exceeds per-tx cap of $${limits.perTxCapUsd}.`
  }
  const daily = getDailySpend()
  if (daily.usd + usdValue > limits.dailyCapUsd) {
    return `Would exceed daily cap: $${daily.usd.toFixed(2)} spent + $${usdValue} = $${(daily.usd + usdValue).toFixed(2)} > $${limits.dailyCapUsd}.`
  }
  if (daily.count >= limits.dailyTxCount) {
    return `Daily transaction limit reached (${limits.dailyTxCount}).`
  }
  return null // All clear
}

// ============ TRANSACTIONS ============
export async function sendTransaction({ to, value, chain = 'base', data, usdValue = 0 }) {
  if (!unlocked) return { error: 'Wallet is locked. Unlock first.' }
  if (!to) return { error: 'No recipient address.' }
  if (!ethers.isAddress(to)) return { error: `Invalid address: ${to}` }

  const provider = providers[chain]
  if (!provider) return { error: `Unknown chain: ${chain}` }

  // Enforce spending limits
  const limitError = checkLimits(to, usdValue)
  if (limitError) return { error: limitError }

  try {
    const signer = unlocked.connect(provider)
    const tx = await signer.sendTransaction({
      to,
      value: value ? ethers.parseEther(value.toString()) : 0n,
      data: data || '0x',
    })

    console.log(`[wallet] TX sent: ${tx.hash} on ${chain}`)
    recordSpend(usdValue, tx.hash, chain, to, value || '0')

    // Wait for confirmation
    const receipt = await tx.wait(1)
    console.log(`[wallet] TX confirmed: ${tx.hash} block ${receipt.blockNumber}`)

    return {
      hash: tx.hash,
      chain: CHAINS[chain].name,
      to,
      value: value || '0',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorer: `${CHAINS[chain].explorer}/tx/${tx.hash}`,
    }
  } catch (err) {
    return { error: `Transaction failed: ${err.message}` }
  }
}

// ============ CONTRACT CALLS ============
export async function callContract({ chain = 'base', contractAddress, abi, functionName, args = [], value }) {
  if (!unlocked) return { error: 'Wallet is locked.' }
  const provider = providers[chain]
  if (!provider) return { error: `Unknown chain: ${chain}` }

  try {
    const signer = unlocked.connect(provider)
    const contract = new ethers.Contract(contractAddress, abi, signer)
    const overrides = value ? { value: ethers.parseEther(value.toString()) } : {}
    const tx = await contract[functionName](...args, overrides)

    if (tx.hash) {
      const receipt = await tx.wait(1)
      return {
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        explorer: `${CHAINS[chain].explorer}/tx/${tx.hash}`,
      }
    }
    // View function (no tx)
    return { result: tx.toString() }
  } catch (err) {
    return { error: `Contract call failed: ${err.message}` }
  }
}

// ============ SIGN MESSAGE ============
export async function signMessage(message) {
  if (!unlocked) return { error: 'Wallet is locked.' }
  try {
    const signature = await unlocked.signMessage(message)
    return { message, signature, signer: unlocked.address }
  } catch (err) {
    return { error: `Signing failed: ${err.message}` }
  }
}

// ============ WHITELIST MANAGEMENT ============
export function addToWhitelist(address) {
  if (!ethers.isAddress(address)) return { error: 'Invalid address.' }
  const lower = address.toLowerCase()
  if (!limits.whitelist.includes(lower)) {
    limits.whitelist.push(lower)
    if (walletData) walletData.limits = limits
    saveWallet()
  }
  return { whitelist: limits.whitelist, added: lower }
}

export function removeFromWhitelist(address) {
  const lower = address.toLowerCase()
  limits.whitelist = limits.whitelist.filter(a => a !== lower)
  if (walletData) walletData.limits = limits
  saveWallet()
  return { whitelist: limits.whitelist, removed: lower }
}

// ============ LIMIT MANAGEMENT ============
export function updateLimits(newLimits) {
  limits = { ...limits, ...newLimits }
  if (walletData) walletData.limits = limits
  saveWallet()
  return { limits }
}

export function pauseWallet() {
  limits.paused = true
  if (walletData) walletData.limits = limits
  saveWallet()
  lockWallet()
  return { paused: true, locked: true }
}

export function unpauseWallet() {
  limits.paused = false
  if (walletData) walletData.limits = limits
  saveWallet()
  return { paused: false }
}

// ============ WALLET INFO ============
export function getWalletInfo() {
  if (!walletData) return { exists: false }
  const daily = getDailySpend()
  return {
    exists: true,
    address: walletData.address,
    unlocked: !!unlocked,
    paused: limits.paused,
    limits: {
      dailyCap: `$${limits.dailyCapUsd}`,
      perTxCap: `$${limits.perTxCapUsd}`,
      dailyTxLimit: limits.dailyTxCount,
      whitelistOnly: limits.whitelistOnly,
      whitelistCount: limits.whitelist.length,
    },
    today: {
      spent: `$${daily.usd.toFixed(2)}`,
      remaining: `$${Math.max(0, limits.dailyCapUsd - daily.usd).toFixed(2)}`,
      txCount: daily.count,
    },
    created: walletData.created,
    totalTx: ledger.transactions.length,
    chains: Object.keys(CHAINS),
  }
}

export function getTransactionHistory(count = 10) {
  return ledger.transactions.slice(-count)
}

// ============ PERSISTENCE ============
function saveWallet() {
  try {
    writeFileSync(WALLET_FILE, JSON.stringify(walletData, null, 2))
  } catch (err) {
    console.error('[wallet] Failed to save:', err.message)
  }
}

function saveLedger() {
  try {
    writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2))
  } catch (err) {
    console.error('[wallet] Failed to save ledger:', err.message)
  }
}

export function flushWallet() {
  if (walletData) saveWallet()
  saveLedger()
}

// ============ LLM TOOLS ============
export const WALLET_TOOLS = [
  {
    name: 'wallet_info',
    description: 'Get your wallet address, balances, spending limits, and daily usage. Use this when asked about your wallet, funds, or financial status.',
    input_schema: { type: 'object', properties: { chain: { type: 'string', description: 'Chain to check balance on (base, ethereum, arbitrum, optimism). Default: base.' } }, required: [] },
  },
  {
    name: 'wallet_send',
    description: 'Send ETH to an address. Only works if wallet is unlocked and address is whitelisted. Enforces daily spending limits.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address (0x...)' },
        value: { type: 'string', description: 'Amount of ETH to send (e.g. "0.01")' },
        chain: { type: 'string', description: 'Chain (base, ethereum, arbitrum, optimism). Default: base.' },
        reason: { type: 'string', description: 'Why are you sending this? (logged in ledger)' },
      },
      required: ['to', 'value'],
    },
  },
  {
    name: 'wallet_sign',
    description: 'Sign a message with your wallet. Used for proving identity, authentication, or governance votes.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Message to sign' } },
      required: ['message'],
    },
  },
]

export const WALLET_TOOL_NAMES = WALLET_TOOLS.map(t => t.name)

// ============ TOOL HANDLER ============
export async function handleWalletTool(name, input) {
  switch (name) {
    case 'wallet_info': {
      const info = getWalletInfo()
      if (input?.chain) {
        const balances = await getBalances(input.chain)
        return JSON.stringify({ ...info, balance: balances })
      }
      // Get base balance by default
      const balances = await getBalances('base')
      return JSON.stringify({ ...info, balance: balances })
    }
    case 'wallet_send': {
      // Estimate USD value (rough — uses CoinGecko cache if available)
      let usdValue = 0
      try {
        const ethPrice = global.__vibePriceCache?.ETH?.price || 2000
        usdValue = parseFloat(input.value) * ethPrice
      } catch { /* use 0 */ }

      const result = await sendTransaction({
        to: input.to,
        value: input.value,
        chain: input.chain || 'base',
        usdValue,
      })
      if (input.reason && result.hash) {
        // Log reason in ledger
        const last = ledger.transactions[ledger.transactions.length - 1]
        if (last) last.reason = input.reason
        saveLedger()
      }
      return JSON.stringify(result)
    }
    case 'wallet_sign': {
      const result = await signMessage(input.message)
      return JSON.stringify(result)
    }
    default:
      return JSON.stringify({ error: `Unknown wallet tool: ${name}` })
  }
}
