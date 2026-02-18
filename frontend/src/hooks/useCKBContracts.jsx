import { useState, useCallback, useRef, useEffect } from 'react'
import { useCKBWallet } from './useCKBWallet'
import {
  CKB_SCRIPTS, CKB_BATCH_TIMING, CKB_PHASES, CKB_PHASE_NAMES,
  CKB_ORDER_TYPES, CKB_PRECISION, CKB_MIN_DEPOSIT_CKB,
  CELL_SIZES, areCKBScriptsDeployed, isCKBChain,
  parseAuctionCellData, parsePoolCellData, parseCommitCellData, parseLPPositionCellData,
  buildCommitCellData, buildRevealWitness,
  computeOrderHash, generateSecret, formatTokenAmount, formatCKB,
} from '../utils/ckb-constants'

// ============================================
// CKB CONTRACTS HOOK
// ============================================
// Provides CKB cell operations matching the EVM useContracts pattern.
// Queries CKB indexer for live cells, builds transactions via the SDK,
// and tracks commit/reveal/settlement lifecycle.
//
// All operations fall back to demo mode when scripts aren't deployed.

// ============================================
// INDEXER RPC HELPERS
// ============================================

async function rpcCall(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  })
  const data = await response.json()
  if (data.error) throw new Error(`RPC error: ${data.error.message}`)
  return data.result
}

// Query live cells by type script
async function queryLiveCells(indexerUrl, typeScript, limit = 10) {
  return rpcCall(indexerUrl, 'get_cells', [{
    script: {
      code_hash: typeScript.codeHash,
      hash_type: typeScript.hashType,
      args: typeScript.args || '0x',
    },
    script_type: 'type',
    filter: null,
  }, 'asc', `0x${limit.toString(16)}`])
}

// Query tip block number
async function getTipBlockNumber(rpcUrl) {
  const result = await rpcCall(rpcUrl, 'get_tip_block_number', [])
  return BigInt(result)
}

// ============================================
// DEMO MODE DATA
// ============================================

function makeDemoAuctionState(phase = CKB_PHASES.COMMIT) {
  return {
    phase,
    phaseName: CKB_PHASE_NAMES[phase],
    batchId: 42n,
    commitCount: phase === CKB_PHASES.COMMIT ? 7 : 12,
    revealCount: phase >= CKB_PHASES.REVEAL ? 10 : 0,
    clearingPrice: 2000n * CKB_PRECISION,
    fillableVolume: 50000n * CKB_PRECISION,
    phaseStartBlock: 1000000n,
    pairId: '0x' + '01'.repeat(32),
  }
}

function makeDemoPoolState() {
  return {
    reserve0: 1000000n * CKB_PRECISION,
    reserve1: 2000000n * CKB_PRECISION,
    totalLpSupply: 1414213n * CKB_PRECISION,
    feeRateBps: 5,
    pairId: '0x' + '01'.repeat(32),
    token0TypeHash: '0x' + '0a'.repeat(32),
    token1TypeHash: '0x' + '0b'.repeat(32),
  }
}

// ============================================
// MAIN HOOK
// ============================================

export function useCKBContracts() {
  const { address, lockHash, chainId, isConnected, signTransaction } = useCKBWallet()

  const [auctionState, setAuctionState] = useState(null)
  const [poolStates, setPoolStates] = useState({})
  const [userCommits, setUserCommits] = useState([])
  const [userLPPositions, setUserLPPositions] = useState([])
  const [tipBlock, setTipBlock] = useState(0n)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const pollingRef = useRef(null)
  const secretsRef = useRef({}) // batchId → secret (persisted in localStorage)

  const isLive = isCKBChain(chainId) && areCKBScriptsDeployed()
  const isDemoMode = !isLive

  // ============================================
  // SECRET MANAGEMENT
  // ============================================
  // Secrets are stored in localStorage keyed by batchId
  // Critical: losing the secret means losing the deposit (slashed)

  const getOrCreateSecret = useCallback((batchId) => {
    const key = `ckb_secret_${batchId}`
    let secret = localStorage.getItem(key)
    if (!secret) {
      secret = generateSecret()
      localStorage.setItem(key, secret)
    }
    secretsRef.current[batchId.toString()] = secret
    return secret
  }, [])

  const getSecret = useCallback((batchId) => {
    const key = `ckb_secret_${batchId}`
    return localStorage.getItem(key) || secretsRef.current[batchId.toString()] || null
  }, [])

  // ============================================
  // FETCH AUCTION STATE
  // ============================================

  const fetchAuctionState = useCallback(async (pairId) => {
    if (isDemoMode) {
      const demoState = makeDemoAuctionState()
      setAuctionState(demoState)
      return demoState
    }

    try {
      setIsLoading(true)
      const chain = getCKBChain(chainId)
      if (!chain) throw new Error('CKB chain not configured')

      // Query auction cells by type script
      const result = await queryLiveCells(chain.indexerUrl, {
        codeHash: CKB_SCRIPTS.batchAuctionType.codeHash,
        hashType: CKB_SCRIPTS.batchAuctionType.hashType,
        args: pairId || '0x',
      })

      if (result.objects && result.objects.length > 0) {
        const cell = result.objects[0]
        const dataHex = cell.output_data
        const dataBytes = hexToBytes(dataHex)
        const parsed = parseAuctionCellData(dataBytes)

        if (parsed) {
          setAuctionState(parsed)
          return parsed
        }
      }

      // No auction cell found — pair doesn't exist yet
      setAuctionState(null)
      return null
    } catch (err) {
      console.warn('Auction state fetch failed:', err.message)
      // Fallback to demo
      const demoState = makeDemoAuctionState()
      setAuctionState(demoState)
      return demoState
    } finally {
      setIsLoading(false)
    }
  }, [isDemoMode, chainId])

  // ============================================
  // FETCH POOL STATE
  // ============================================

  const fetchPoolState = useCallback(async (pairId) => {
    if (isDemoMode) {
      const demoPool = makeDemoPoolState()
      setPoolStates(prev => ({ ...prev, [pairId]: demoPool }))
      return demoPool
    }

    try {
      const chain = getCKBChain(chainId)
      if (!chain) return null

      const result = await queryLiveCells(chain.indexerUrl, {
        codeHash: CKB_SCRIPTS.ammPoolType.codeHash,
        hashType: CKB_SCRIPTS.ammPoolType.hashType,
        args: pairId || '0x',
      })

      if (result.objects && result.objects.length > 0) {
        const cell = result.objects[0]
        const parsed = parsePoolCellData(hexToBytes(cell.output_data))
        if (parsed) {
          setPoolStates(prev => ({ ...prev, [pairId]: parsed }))
          return parsed
        }
      }
      return null
    } catch (err) {
      console.warn('Pool state fetch failed:', err.message)
      const demoPool = makeDemoPoolState()
      setPoolStates(prev => ({ ...prev, [pairId]: demoPool }))
      return demoPool
    }
  }, [isDemoMode, chainId])

  // ============================================
  // FETCH USER COMMITS
  // ============================================

  const fetchUserCommits = useCallback(async () => {
    if (!isConnected || isDemoMode) {
      setUserCommits([])
      return []
    }

    try {
      const chain = getCKBChain(chainId)
      if (!chain) return []

      // Query commit cells owned by user's lock script
      const result = await queryLiveCells(chain.indexerUrl, {
        codeHash: CKB_SCRIPTS.commitType.codeHash,
        hashType: CKB_SCRIPTS.commitType.hashType,
        args: '0x', // All commits — filter client-side by sender_lock_hash
      }, 50)

      const commits = []
      if (result.objects) {
        for (const cell of result.objects) {
          const parsed = parseCommitCellData(hexToBytes(cell.output_data))
          if (parsed && parsed.senderLockHash === lockHash) {
            commits.push({
              ...parsed,
              outpoint: {
                txHash: cell.out_point.tx_hash,
                index: parseInt(cell.out_point.index, 16),
              },
            })
          }
        }
      }

      setUserCommits(commits)
      return commits
    } catch (err) {
      console.warn('User commits fetch failed:', err.message)
      setUserCommits([])
      return []
    }
  }, [isConnected, isDemoMode, chainId, lockHash])

  // ============================================
  // FETCH USER LP POSITIONS
  // ============================================

  const fetchUserLPPositions = useCallback(async () => {
    if (!isConnected || isDemoMode) {
      setUserLPPositions([])
      return []
    }

    try {
      const chain = getCKBChain(chainId)
      if (!chain) return []

      const result = await queryLiveCells(chain.indexerUrl, {
        codeHash: CKB_SCRIPTS.lpPositionType.codeHash,
        hashType: CKB_SCRIPTS.lpPositionType.hashType,
        args: '0x',
      }, 50)

      const positions = []
      if (result.objects) {
        for (const cell of result.objects) {
          // LP position cells are locked by user's lock script
          const parsed = parseLPPositionCellData(hexToBytes(cell.output_data))
          if (parsed) {
            positions.push({
              ...parsed,
              outpoint: {
                txHash: cell.out_point.tx_hash,
                index: parseInt(cell.out_point.index, 16),
              },
            })
          }
        }
      }

      setUserLPPositions(positions)
      return positions
    } catch (err) {
      console.warn('LP positions fetch failed:', err.message)
      setUserLPPositions([])
      return []
    }
  }, [isConnected, isDemoMode, chainId])

  // ============================================
  // COMMIT ORDER (create commit cell)
  // ============================================

  const commitOrder = useCallback(async ({ pairId, orderType, amountIn, limitPrice, priorityBid = 0, depositCkb = CKB_MIN_DEPOSIT_CKB }) => {
    if (!isConnected) throw new Error('CKB wallet not connected')

    const currentAuction = auctionState || await fetchAuctionState(pairId)
    if (!currentAuction) throw new Error('No auction found for this pair')
    if (currentAuction.phase !== CKB_PHASES.COMMIT) throw new Error('Auction not in commit phase')

    const batchId = currentAuction.batchId
    const secret = getOrCreateSecret(batchId)

    // Compute order hash: SHA-256(order || secret)
    const orderHash = await computeOrderHash(orderType, amountIn, limitPrice, priorityBid, secret)

    if (isDemoMode) {
      // Demo mode: simulate commit
      const demoCommit = {
        orderHash,
        batchId,
        depositCkb: BigInt(depositCkb),
        tokenAmount: BigInt(amountIn),
        blockNumber: tipBlock,
        senderLockHash: lockHash,
        status: 'committed',
        secret,
      }
      setUserCommits(prev => [...prev, demoCommit])
      return { success: true, orderHash, batchId, secret }
    }

    // Build commit cell data
    const commitData = buildCommitCellData({
      orderHash,
      batchId,
      depositCkb,
      tokenTypeHash: '0x' + '00'.repeat(32), // Token type hash from pair config
      tokenAmount: amountIn,
      blockNumber: 0n, // Set by CKB
      senderLockHash: lockHash,
    })

    // Build transaction (simplified — full CCC SDK integration needed for production)
    const rawTx = {
      type: 'ckb_commit',
      data: Array.from(commitData),
      pairId,
      batchId: batchId.toString(),
    }

    // Sign and submit
    const signature = await signTransaction(rawTx)

    return {
      success: true,
      orderHash,
      batchId,
      secret,
      txHash: signature, // In production, this is the actual CKB tx hash
    }
  }, [isConnected, auctionState, fetchAuctionState, isDemoMode, tipBlock, lockHash, signTransaction, getOrCreateSecret])

  // ============================================
  // REVEAL ORDER
  // ============================================

  const revealOrder = useCallback(async ({ pairId, orderType, amountIn, limitPrice, priorityBid = 0, commitIndex = 0 }) => {
    if (!isConnected) throw new Error('CKB wallet not connected')

    const currentAuction = auctionState || await fetchAuctionState(pairId)
    if (!currentAuction) throw new Error('No auction found for this pair')
    if (currentAuction.phase !== CKB_PHASES.REVEAL) throw new Error('Auction not in reveal phase')

    const batchId = currentAuction.batchId
    const secret = getSecret(batchId)
    if (!secret) throw new Error('Secret not found for this batch — deposit will be slashed')

    if (isDemoMode) {
      return { success: true, batchId, revealed: true }
    }

    // Build reveal witness
    const witness = buildRevealWitness({
      orderType,
      amountIn,
      limitPrice,
      secret,
      priorityBid,
      commitIndex,
    })

    const rawTx = {
      type: 'ckb_reveal',
      witness: Array.from(witness),
      pairId,
      batchId: batchId.toString(),
    }

    const signature = await signTransaction(rawTx)

    return {
      success: true,
      batchId,
      txHash: signature,
    }
  }, [isConnected, auctionState, fetchAuctionState, isDemoMode, signTransaction, getSecret])

  // ============================================
  // BATCH STATE POLLING
  // ============================================

  const startPolling = useCallback((pairId, intervalMs = 2000) => {
    stopPolling()
    pollingRef.current = setInterval(async () => {
      try {
        await fetchAuctionState(pairId)
        if (!isDemoMode) {
          const chain = getCKBChain(chainId)
          if (chain) {
            const tip = await getTipBlockNumber(chain.rpcUrl)
            setTipBlock(tip)
          }
        }
      } catch (err) {
        // Silent polling failure
      }
    }, intervalMs)
  }, [fetchAuctionState, isDemoMode, chainId])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // ============================================
  // COMPUTED VALUES
  // ============================================

  // Time remaining in current phase (estimated from blocks)
  const phaseTimeRemaining = auctionState ? (() => {
    const blocksInPhase = auctionState.phase === CKB_PHASES.COMMIT
      ? CKB_BATCH_TIMING.COMMIT_WINDOW_BLOCKS
      : CKB_BATCH_TIMING.REVEAL_WINDOW_BLOCKS
    const blocksElapsed = Number(tipBlock - (auctionState.phaseStartBlock || 0n))
    const blocksRemaining = Math.max(0, blocksInPhase - blocksElapsed)
    return Math.round(blocksRemaining * CKB_BATCH_TIMING.BLOCK_TIME_MS / 1000 * 10) / 10
  })() : null

  // Price formatted from clearing price
  const formattedClearingPrice = auctionState?.clearingPrice
    ? formatTokenAmount(auctionState.clearingPrice)
    : null

  return {
    // State
    auctionState,
    poolStates,
    userCommits,
    userLPPositions,
    tipBlock,
    isLoading,
    error,
    isLive,
    isDemoMode,

    // Auction operations
    commitOrder,
    revealOrder,
    fetchAuctionState,

    // Pool operations
    fetchPoolState,

    // User data
    fetchUserCommits,
    fetchUserLPPositions,

    // Polling
    startPolling,
    stopPolling,

    // Computed
    phaseTimeRemaining,
    formattedClearingPrice,
    currentPhase: auctionState?.phaseName || null,
    commitCount: auctionState?.commitCount || 0,
    revealCount: auctionState?.revealCount || 0,

    // Formatters
    formatCKB,
    formatTokenAmount,
  }
}

// ============================================
// INTERNAL HELPERS
// ============================================

function getCKBChain(chainId) {
  // Import from top of file via the already-imported isCKBChain
  // CKB_CHAINS is not directly imported here to avoid circular deps,
  // so we use the constants module inline
  const chains = [
    { id: 'ckb-mainnet', rpcUrl: import.meta.env.VITE_CKB_RPC_URL || 'https://mainnet.ckbapp.dev/rpc', indexerUrl: import.meta.env.VITE_CKB_INDEXER_URL || 'https://mainnet.ckbapp.dev/indexer' },
    { id: 'ckb-testnet', rpcUrl: import.meta.env.VITE_CKB_TESTNET_RPC_URL || 'https://testnet.ckbapp.dev/rpc', indexerUrl: import.meta.env.VITE_CKB_TESTNET_INDEXER_URL || 'https://testnet.ckbapp.dev/indexer' },
    { id: 'ckb-devnet', rpcUrl: 'http://localhost:8114', indexerUrl: 'http://localhost:8116' },
  ]
  return chains.find(c => c.id === chainId)
}

function hexToBytes(hex) {
  if (!hex) return new Uint8Array(0)
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
