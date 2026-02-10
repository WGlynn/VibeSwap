import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react'
import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider, useDisconnect } from '@web3modal/ethers/react'
import { BrowserProvider } from 'ethers'
import toast from 'react-hot-toast'

// WalletConnect Project ID - get yours at https://cloud.walletconnect.com
const projectId = 'c4f79cc821944d9680842e34466bfb'

// Chain configurations
const chains = [
  {
    chainId: 1,
    name: 'Ethereum',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    rpcUrl: 'https://eth.llamarpc.com'
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    currency: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    rpcUrl: 'https://arb1.arbitrum.io/rpc'
  },
  {
    chainId: 10,
    name: 'Optimism',
    currency: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    rpcUrl: 'https://mainnet.optimism.io'
  },
  {
    chainId: 8453,
    name: 'Base',
    currency: 'ETH',
    explorerUrl: 'https://basescan.org',
    rpcUrl: 'https://mainnet.base.org'
  },
  {
    chainId: 137,
    name: 'Polygon',
    currency: 'MATIC',
    explorerUrl: 'https://polygonscan.com',
    rpcUrl: 'https://polygon-rpc.com'
  },
  {
    chainId: 11155111,
    name: 'Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    rpcUrl: 'https://rpc.sepolia.org'
  }
]

const metadata = {
  name: 'VibeSwap',
  description: 'MEV-Protected Omnichain DEX',
  url: 'https://vibeswap.io',
  icons: ['https://vibeswap.io/logo.png']
}

// Initialize Web3Modal
createWeb3Modal({
  ethersConfig: defaultConfig({ metadata }),
  chains,
  projectId,
  enableAnalytics: false,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-color-mix': '#00ff41',
    '--w3m-color-mix-strength': 20,
    '--w3m-accent': '#00ff41',
    '--w3m-border-radius-master': '8px'
  }
})

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const { open } = useWeb3Modal()
  const { address, chainId, isConnected } = useWeb3ModalAccount()
  const { walletProvider } = useWeb3ModalProvider()
  const { disconnect: web3Disconnect } = useDisconnect()

  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState(null)

  // Supported chains lookup
  const supportedChains = chains.reduce((acc, chain) => {
    acc[chain.chainId] = chain
    return acc
  }, {})

  // Update provider and signer when wallet connects
  useEffect(() => {
    const setupProvider = async () => {
      if (walletProvider && isConnected) {
        try {
          const browserProvider = new BrowserProvider(walletProvider)
          const walletSigner = await browserProvider.getSigner()
          setProvider(browserProvider)
          setSigner(walletSigner)
        } catch (err) {
          console.error('Failed to setup provider:', err)
        }
      } else {
        setProvider(null)
        setSigner(null)
      }
    }
    setupProvider()
  }, [walletProvider, isConnected])

  const connect = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    try {
      await open()
    } catch (err) {
      console.error('Failed to connect:', err)
      setError(err.message || 'Failed to connect wallet')
      toast.error('Failed to connect wallet')
    } finally {
      setIsConnecting(false)
    }
  }, [open])

  const disconnect = useCallback(async () => {
    try {
      await web3Disconnect()
      setProvider(null)
      setSigner(null)
      toast.success('Wallet disconnected')
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }, [web3Disconnect])

  const switchChain = useCallback(async (targetChainId) => {
    if (!walletProvider) return

    try {
      await walletProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      })
    } catch (err) {
      console.error('Failed to switch chain:', err)
      setError(err.message)
      toast.error('Failed to switch network')
    }
  }, [walletProvider])

  const value = {
    account: address,
    chainId,
    provider,
    signer,
    isConnecting,
    error,
    connect,
    disconnect,
    switchChain,
    supportedChains,
    isConnected,
    chainName: chainId ? supportedChains[chainId]?.name || 'Unknown' : null,
    shortAddress: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null,
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
