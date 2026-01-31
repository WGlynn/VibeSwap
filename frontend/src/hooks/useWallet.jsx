import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState(null)

  // Chain configurations
  const supportedChains = {
    1: { name: 'Ethereum', currency: 'ETH', explorer: 'https://etherscan.io' },
    42161: { name: 'Arbitrum', currency: 'ETH', explorer: 'https://arbiscan.io' },
    10: { name: 'Optimism', currency: 'ETH', explorer: 'https://optimistic.etherscan.io' },
    137: { name: 'Polygon', currency: 'MATIC', explorer: 'https://polygonscan.com' },
    8453: { name: 'Base', currency: 'ETH', explorer: 'https://basescan.org' },
    11155111: { name: 'Sepolia', currency: 'ETH', explorer: 'https://sepolia.etherscan.io' },
  }

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('Please install MetaMask or another Web3 wallet')
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum)
      const accounts = await browserProvider.send('eth_requestAccounts', [])
      const network = await browserProvider.getNetwork()
      const walletSigner = await browserProvider.getSigner()

      setProvider(browserProvider)
      setSigner(walletSigner)
      setAccount(accounts[0])
      setChainId(Number(network.chainId))
    } catch (err) {
      console.error('Failed to connect:', err)
      setError(err.message || 'Failed to connect wallet')
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAccount(null)
    setChainId(null)
    setProvider(null)
    setSigner(null)
  }, [])

  const switchChain = useCallback(async (targetChainId) => {
    if (!window.ethereum) return

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      })
    } catch (err) {
      console.error('Failed to switch chain:', err)
      setError(err.message)
    }
  }, [])

  // Listen for account changes
  useEffect(() => {
    if (!window.ethereum) return

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        disconnect()
      } else {
        setAccount(accounts[0])
      }
    }

    const handleChainChanged = (chainIdHex) => {
      setChainId(parseInt(chainIdHex, 16))
      // Refresh provider on chain change
      if (account) {
        connect()
      }
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [account, connect, disconnect])

  // Auto-connect if previously connected
  useEffect(() => {
    const autoConnect = async () => {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' })
        if (accounts.length > 0) {
          connect()
        }
      }
    }
    autoConnect()
  }, [connect])

  const value = {
    account,
    chainId,
    provider,
    signer,
    isConnecting,
    error,
    connect,
    disconnect,
    switchChain,
    supportedChains,
    isConnected: !!account,
    chainName: chainId ? supportedChains[chainId]?.name || 'Unknown' : null,
    shortAddress: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null,
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
