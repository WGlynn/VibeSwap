import { useState, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'
import { useBalances } from './useBalances'
import { CONTRACTS, LZ_ENDPOINTS, SUPPORTED_CHAINS, areContractsDeployed } from '../utils/constants'
import CrossChainRouterABI from '../abis/CrossChainRouter.json'

// ============ Bridge State Machine ============
// idle → approving → burning → in_transit → completed
//   ↘                                        ↗
//    ————————————— failed ————————————————————

// ============ Hardcoded Gas Estimates (Demo Mode) ============
const DEMO_GAS_ESTIMATES = {
  1:     '0.0012',  // Ethereum
  42161: '0.0003',  // Arbitrum
  10:    '0.0004',  // Optimism
  8453:  '0.0003',  // Base
  137:   '0.0002',  // Polygon
}

// ============ Estimated Bridge Times (seconds) ============
const BRIDGE_TIME_ESTIMATES = {
  1:     300,   // Ethereum — ~5 min
  42161: 120,   // Arbitrum — ~2 min
  10:    120,   // Optimism — ~2 min
  8453:  120,   // Base — ~2 min
  137:   180,   // Polygon — ~3 min
}

// Default LayerZero adapter options (200k gas for destination execution)
const DEFAULT_LZ_OPTIONS = ethers.AbiCoder.defaultAbiCoder().encode(
  ['uint16', 'uint256'],
  [1, 200000]
)

export function useBridge() {
  const { provider, signer, chainId, account } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()
  const { simulateSend, refresh } = useBalances()

  // ============ State ============
  const [bridgeState, setBridgeState] = useState('idle')
  const [error, setError] = useState(null)
  const [lastBridge, setLastBridge] = useState(null)
  const timeoutRefs = useRef([])

  // Determine live vs demo
  const isLive = areContractsDeployed(chainId)
  const isLoading = ['approving', 'burning', 'in_transit'].includes(bridgeState)

  // Active wallet address
  const activeAccount = account || deviceAddress

  // ============ Helpers ============

  // Get CrossChainRouter contract instance
  const getRouterContract = useCallback((useSigner = false) => {
    const contracts = CONTRACTS[chainId]
    if (!contracts?.router || contracts.router === '0x0000000000000000000000000000000000000000') {
      return null
    }
    const signerOrProvider = useSigner && signer ? signer : provider
    if (!signerOrProvider) return null
    return new ethers.Contract(contracts.router, CrossChainRouterABI, signerOrProvider)
  }, [chainId, provider, signer])

  // Get LZ endpoint ID for a chain
  const getLzEndpointId = useCallback((targetChainId) => {
    return LZ_ENDPOINTS[targetChainId] || null
  }, [])

  // Get chain info from SUPPORTED_CHAINS
  const getChainInfo = useCallback((targetChainId) => {
    return SUPPORTED_CHAINS.find(c => c.id === targetChainId) || null
  }, [])

  // Clear any pending timeouts (for cleanup / reset)
  const clearTimeouts = useCallback(() => {
    timeoutRefs.current.forEach(id => clearTimeout(id))
    timeoutRefs.current = []
  }, [])

  // ============ Gas Estimation ============

  const estimateGas = useCallback(async (fromChainId, toChainId, token, amount) => {
    // Live mode: query the router's quote() function
    if (areContractsDeployed(fromChainId)) {
      try {
        const contracts = CONTRACTS[fromChainId]
        if (!contracts?.router || !provider) {
          throw new Error('Router not available')
        }

        const router = new ethers.Contract(contracts.router, CrossChainRouterABI, provider)
        const dstEid = LZ_ENDPOINTS[toChainId]
        if (!dstEid) throw new Error(`No LZ endpoint for chain ${toChainId}`)

        // Build a sample message for quoting (commitHash placeholder)
        const sampleCommitHash = ethers.keccak256(ethers.toUtf8Bytes('quote_estimate'))
        const message = ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint8', 'bytes32', 'address', 'uint256'],
          [0, sampleCommitHash, activeAccount || ethers.ZeroAddress, ethers.parseEther(String(amount || '1'))]
        )

        const fee = await router.quote(dstEid, message, DEFAULT_LZ_OPTIONS)

        // Estimate time based on destination chain
        const time = BRIDGE_TIME_ESTIMATES[toChainId] || 180

        return {
          fee: ethers.formatEther(fee.nativeFee),
          lzTokenFee: ethers.formatEther(fee.lzTokenFee),
          time,
        }
      } catch (err) {
        console.warn('Live gas estimation failed, falling back to demo estimates:', err.message)
        // Fall through to demo estimates
      }
    }

    // Demo mode: use hardcoded gas estimates
    const fromGas = parseFloat(DEMO_GAS_ESTIMATES[fromChainId] || '0.001')
    const toGas = parseFloat(DEMO_GAS_ESTIMATES[toChainId] || '0.001')
    const totalFee = (fromGas + toGas).toFixed(4)

    const fromTime = BRIDGE_TIME_ESTIMATES[fromChainId] || 180
    const toTime = BRIDGE_TIME_ESTIMATES[toChainId] || 180
    const time = Math.max(fromTime, toTime)

    return {
      fee: totalFee,
      lzTokenFee: '0',
      time,
    }
  }, [provider, activeAccount])

  // ============ Live Bridge Execution ============

  const executeLiveBridge = useCallback(async ({ fromChain, toChain, token, amount }) => {
    if (!signer || !activeAccount) {
      throw new Error('Wallet not connected')
    }

    const router = getRouterContract(true)
    if (!router) {
      throw new Error('CrossChainRouter not available on this chain')
    }

    const dstEid = getLzEndpointId(toChain.id)
    if (!dstEid) {
      throw new Error(`No LayerZero endpoint for ${toChain.name}`)
    }

    // Step 1: Approve token if ERC20 (not native ETH)
    if (token.symbol !== 'ETH') {
      setBridgeState('approving')

      const ERC20_ABI = [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
      ]

      const contracts = CONTRACTS[chainId]
      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer)
      const amountWei = ethers.parseUnits(String(amount), token.decimals || 18)

      const allowance = await tokenContract.allowance(activeAccount, contracts.router)
      if (allowance < amountWei) {
        const approveTx = await tokenContract.approve(contracts.router, ethers.MaxUint256)
        await approveTx.wait()
      }
    }

    // Step 2: Burn on source chain via sendCommit
    setBridgeState('burning')

    // Generate a commit hash for this bridge transfer
    const secret = ethers.randomBytes(32)
    const commitData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'string', 'uint256', 'uint32', 'bytes32'],
      [activeAccount, token.symbol, ethers.parseEther(String(amount)), dstEid, ethers.hexlify(secret)]
    )
    const commitHash = ethers.keccak256(commitData)

    // Get the LZ fee quote for this message
    const message = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint8', 'bytes32', 'address', 'uint256'],
      [0, commitHash, activeAccount, ethers.parseEther(String(amount))]
    )
    const fee = await router.quote(dstEid, message, DEFAULT_LZ_OPTIONS)

    // Add a 10% buffer to the fee for safety
    const feeWithBuffer = fee.nativeFee * 110n / 100n

    // Calculate total value: LZ fee + (amount if sending native ETH)
    let totalValue = feeWithBuffer
    if (token.symbol === 'ETH') {
      totalValue += ethers.parseEther(String(amount))
    }

    // Send the cross-chain commit
    const tx = await router.sendCommit(dstEid, commitHash, DEFAULT_LZ_OPTIONS, {
      value: totalValue,
    })

    const receipt = await tx.wait()

    // Extract CrossChainCommitSent event
    let messageId = null
    for (const log of receipt.logs) {
      try {
        const parsed = router.interface.parseLog(log)
        if (parsed.name === 'CrossChainCommitSent') {
          messageId = parsed.args.commitId
          break
        }
      } catch {
        // Not our event, skip
      }
    }

    // Step 3: In transit — wait for destination confirmation
    setBridgeState('in_transit')

    // For live mode, we could poll or listen for events on the destination chain.
    // For now, we set a reasonable timeout and mark as completed.
    // A production implementation would listen for BridgedDepositFunded or
    // CrossChainCommitReceived on the destination chain via a secondary provider.
    const bridgeTime = BRIDGE_TIME_ESTIMATES[toChain.id] || 180

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        setBridgeState('completed')
        refresh() // Refresh real balances

        const result = {
          txHash: receipt.hash,
          messageId: messageId || commitHash,
          amount: String(amount),
          token: token.symbol,
          fromChain: fromChain.name,
          toChain: toChain.name,
          timestamp: Date.now(),
        }
        setLastBridge(result)
        resolve(result)
      }, Math.min(bridgeTime * 1000, 30000)) // Cap at 30s for UX, real confirmation is async

      timeoutRefs.current.push(timeoutId)
    })
  }, [signer, activeAccount, chainId, getRouterContract, getLzEndpointId, refresh])

  // ============ Demo Bridge Execution ============

  const executeDemoBridge = useCallback(async ({ fromChain, toChain, token, amount }) => {
    // Step 1: Simulate approval (skip for ETH)
    if (token.symbol !== 'ETH') {
      setBridgeState('approving')
      await new Promise(resolve => {
        const id = setTimeout(resolve, 1000)
        timeoutRefs.current.push(id)
      })
    }

    // Step 2: Simulate burn on source chain
    setBridgeState('burning')
    await new Promise(resolve => {
      const id = setTimeout(resolve, 2000)
      timeoutRefs.current.push(id)
    })

    // Step 3: Simulate LayerZero message in transit
    setBridgeState('in_transit')
    await new Promise(resolve => {
      const id = setTimeout(resolve, 2000)
      timeoutRefs.current.push(id)
    })

    // Step 4: Complete — update mock balances
    simulateSend(token.symbol, amount)
    setBridgeState('completed')

    const result = {
      txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      messageId: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      amount: String(amount),
      token: token.symbol,
      fromChain: fromChain.name,
      toChain: toChain.name,
      timestamp: Date.now(),
    }
    setLastBridge(result)
    return result
  }, [simulateSend])

  // ============ Main Execute Function ============

  const executeBridge = useCallback(async ({ fromChain, toChain, token, amount }) => {
    // Reset state
    clearTimeouts()
    setError(null)
    setBridgeState('idle')

    try {
      if (isLive) {
        return await executeLiveBridge({ fromChain, toChain, token, amount })
      } else {
        return await executeDemoBridge({ fromChain, toChain, token, amount })
      }
    } catch (err) {
      console.error('Bridge execution failed:', err)
      const errorMessage = err.reason || err.message || 'Bridge transfer failed'
      setError(errorMessage)
      setBridgeState('failed')
      throw err
    }
  }, [isLive, executeLiveBridge, executeDemoBridge, clearTimeouts])

  // ============ Reset ============

  const resetBridge = useCallback(() => {
    clearTimeouts()
    setBridgeState('idle')
    setError(null)
    setLastBridge(null)
  }, [clearTimeouts])

  // ============ Return API ============

  return {
    // State
    isLive,
    bridgeState,
    isLoading,
    error,

    // Gas estimation
    estimateGas,

    // Actions
    executeBridge,

    // Result
    lastBridge,
    resetBridge,
  }
}

export default useBridge
