import { useState, useEffect, useCallback, useMemo } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'
import { CONTRACTS, TOKENS, areContractsDeployed } from '../utils/constants'
import VibeSwapCoreABI from '../abis/VibeSwapCore.json'
import VibeAMMABI from '../abis/VibeAMM.json'
import CommitRevealAuctionABI from '../abis/CommitRevealAuction.json'
import DAOTreasuryABI from '../abis/DAOTreasury.json'
import CrossChainRouterABI from '../abis/CrossChainRouter.json'
import SoulboundIdentityABI from '../abis/SoulboundIdentity.json'
import WalletRecoveryABI from '../abis/WalletRecovery.json'
import ShapleyDistributorABI from '../abis/ShapleyDistributor.json'
import ILProtectionVaultABI from '../abis/ILProtectionVault.json'
import SlippageGuaranteeFundABI from '../abis/SlippageGuaranteeFund.json'

// ABI registry — maps address key in CONTRACTS to its ABI
const ABI_REGISTRY = {
  vibeSwapCore: VibeSwapCoreABI,
  auction: CommitRevealAuctionABI,
  amm: VibeAMMABI,
  treasury: DAOTreasuryABI,
  router: CrossChainRouterABI,
  identity: SoulboundIdentityABI,
  recovery: WalletRecoveryABI,
  shapleyDistributor: ShapleyDistributorABI,
  ilProtectionVault: ILProtectionVaultABI,
  slippageGuaranteeFund: SlippageGuaranteeFundABI,
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

export function useContracts() {
  const { provider, signer, chainId, account, isConnected } = useWallet()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // Get contract addresses for current chain
  const addresses = useMemo(() => {
    return CONTRACTS[chainId] || null
  }, [chainId])

  // Create contract instances for all available contracts on this chain
  const contracts = useMemo(() => {
    if (!provider || !addresses) return null

    // Check if contracts are actually deployed (not zero address)
    if (!areContractsDeployed(chainId)) return null

    const signerOrProvider = signer || provider
    const result = {}

    for (const [key, abi] of Object.entries(ABI_REGISTRY)) {
      const addr = addresses[key]
      if (addr && addr !== ZERO_ADDRESS) {
        try {
          result[key] = new ethers.Contract(addr, abi, signerOrProvider)
        } catch (e) {
          console.warn(`Failed to create ${key} contract:`, e.message)
        }
      }
    }

    // Aliases for backward compat
    if (result.amm) result.vibeAMM = result.amm

    return Object.keys(result).length > 0 ? result : null
  }, [provider, signer, addresses, chainId])

  // Check if contracts are deployed
  const isContractsDeployed = useMemo(() => {
    return areContractsDeployed(chainId)
  }, [chainId])

  // Get current batch info
  const getCurrentBatch = useCallback(async () => {
    if (!contracts?.vibeSwapCore) return null

    try {
      const [batchId, phase, timeUntilPhaseChange] =
        await contracts.vibeSwapCore.getCurrentBatch()

      return {
        batchId: Number(batchId),
        phase: Number(phase), // 0 = COMMIT, 1 = REVEAL, 2 = SETTLING
        timeUntilPhaseChange: Number(timeUntilPhaseChange),
      }
    } catch (error) {
      console.error('Failed to get current batch:', error)
      return null
    }
  }, [contracts])

  // Get quote for swap
  const getQuote = useCallback(async (tokenIn, tokenOut, amountIn) => {
    if (!contracts?.vibeSwapCore) return null

    try {
      const amountOut = await contracts.vibeSwapCore.getQuote(
        tokenIn,
        tokenOut,
        amountIn
      )
      return amountOut
    } catch (error) {
      console.error('Failed to get quote:', error)
      return null
    }
  }, [contracts])

  // Get pool info
  const getPoolInfo = useCallback(async (tokenA, tokenB) => {
    if (!contracts?.vibeSwapCore) return null

    try {
      const info = await contracts.vibeSwapCore.getPoolInfo(tokenA, tokenB)
      return {
        poolId: info.poolId,
        token0: info.token0,
        token1: info.token1,
        reserve0: info.reserve0,
        reserve1: info.reserve1,
        spotPrice: info.spotPrice,
        feeRate: info.feeRate,
      }
    } catch (error) {
      console.error('Failed to get pool info:', error)
      return null
    }
  }, [contracts])

  // Commit swap
  const commitSwap = useCallback(async (params) => {
    if (!contracts?.vibeSwapCore || !signer) {
      throw new Error('Contracts not initialized or wallet not connected')
    }

    const { tokenIn, tokenOut, amountIn, minAmountOut, deposit } = params

    // Generate a random secret
    const secret = ethers.randomBytes(32)
    const secretHash = ethers.keccak256(secret)

    try {
      setIsLoading(true)
      setError(null)

      // First approve token if not native
      if (tokenIn !== ethers.ZeroAddress) {
        const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, signer)
        const allowance = await tokenContract.allowance(
          account,
          addresses.vibeSwapCore
        )

        if (allowance < amountIn) {
          const approveTx = await tokenContract.approve(
            addresses.vibeSwapCore,
            ethers.MaxUint256
          )
          await approveTx.wait()
        }
      }

      // Commit the swap
      const tx = await contracts.vibeSwapCore.commitSwap(
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut,
        secretHash,
        { value: deposit || 0 }
      )

      const receipt = await tx.wait()

      // Extract commitId from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = contracts.vibeSwapCore.interface.parseLog(log)
          return parsed.name === 'SwapCommitted'
        } catch {
          return false
        }
      })

      const parsed = contracts.vibeSwapCore.interface.parseLog(event)
      const commitId = parsed.args.commitId

      return {
        hash: receipt.hash,
        commitId,
        secret: ethers.hexlify(secret),
        batchId: Number(parsed.args.batchId),
      }
    } catch (error) {
      console.error('Commit swap failed:', error)
      setError(error.message || 'Transaction failed')
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [contracts, signer, account, addresses])

  // Reveal swap
  const revealSwap = useCallback(async (commitId, priorityBid = 0) => {
    if (!contracts?.vibeSwapCore || !signer) {
      throw new Error('Contracts not initialized or wallet not connected')
    }

    try {
      setIsLoading(true)
      setError(null)

      const tx = await contracts.vibeSwapCore.revealSwap(
        commitId,
        priorityBid,
        { value: priorityBid }
      )

      const receipt = await tx.wait()

      return {
        hash: receipt.hash,
      }
    } catch (error) {
      console.error('Reveal swap failed:', error)
      setError(error.message || 'Transaction failed')
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [contracts, signer])

  // Add liquidity
  const addLiquidity = useCallback(async (params) => {
    if (!contracts?.vibeAMM || !signer) {
      throw new Error('Contracts not initialized or wallet not connected')
    }

    const { poolId, amount0, amount1, amount0Min, amount1Min } = params

    try {
      setIsLoading(true)
      setError(null)

      const tx = await contracts.vibeAMM.addLiquidity(
        poolId,
        amount0,
        amount1,
        amount0Min || 0,
        amount1Min || 0
      )

      const receipt = await tx.wait()

      // Extract liquidity from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = contracts.vibeAMM.interface.parseLog(log)
          return parsed.name === 'LiquidityAdded'
        } catch {
          return false
        }
      })

      if (event) {
        const parsed = contracts.vibeAMM.interface.parseLog(event)
        return {
          hash: receipt.hash,
          amount0: parsed.args.amount0,
          amount1: parsed.args.amount1,
          liquidity: parsed.args.liquidity,
        }
      }

      return { hash: receipt.hash }
    } catch (error) {
      console.error('Add liquidity failed:', error)
      setError(error.message || 'Transaction failed')
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [contracts, signer])

  // Remove liquidity
  const removeLiquidity = useCallback(async (params) => {
    if (!contracts?.vibeAMM || !signer) {
      throw new Error('Contracts not initialized or wallet not connected')
    }

    const { poolId, liquidity, amount0Min, amount1Min } = params

    try {
      setIsLoading(true)
      setError(null)

      const tx = await contracts.vibeAMM.removeLiquidity(
        poolId,
        liquidity,
        amount0Min || 0,
        amount1Min || 0
      )

      const receipt = await tx.wait()

      return { hash: receipt.hash }
    } catch (error) {
      console.error('Remove liquidity failed:', error)
      setError(error.message || 'Transaction failed')
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [contracts, signer])

  // Get token balance
  const getTokenBalance = useCallback(async (tokenAddress) => {
    if (!provider || !account) return null

    try {
      if (tokenAddress === ethers.ZeroAddress) {
        return await provider.getBalance(account)
      }

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
      return await token.balanceOf(account)
    } catch (error) {
      console.error('Failed to get token balance:', error)
      return null
    }
  }, [provider, account])

  // Get token info
  const getTokenInfo = useCallback(async (tokenAddress) => {
    if (!provider) return null

    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
      const [symbol, name, decimals] = await Promise.all([
        token.symbol(),
        token.name(),
        token.decimals(),
      ])

      return { symbol, name, decimals: Number(decimals), address: tokenAddress }
    } catch (error) {
      console.error('Failed to get token info:', error)
      return null
    }
  }, [provider])

  return {
    // State
    isLoading,
    error,
    isContractsDeployed,
    contracts,
    addresses,

    // Read functions
    getCurrentBatch,
    getQuote,
    getPoolInfo,
    getTokenBalance,
    getTokenInfo,

    // Write functions
    commitSwap,
    revealSwap,
    addLiquidity,
    removeLiquidity,

    // Token addresses - convert TOKENS array to object by symbol
    tokenAddresses: (TOKENS[chainId] || []).reduce((acc, token) => {
      acc[token.symbol] = token.address
      return acc
    }, {}),
  }
}

export default useContracts
