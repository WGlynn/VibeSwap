import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react'
import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider, useDisconnect, useWeb3ModalEvents } from '@web3modal/ethers/react'
import { BrowserProvider } from 'ethers'
import toast from 'react-hot-toast'

// ============================================
// PRODUCTION CONFIGURATION
// ============================================
// WalletConnect Project ID - get your own at https://cloud.walletconnect.com
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '3a8170812b534d0ff9d794f19a901d64'

// Production mode flag - disables testnets when true
const isProduction = import.meta.env.VITE_PRODUCTION_MODE === 'true'
const disableTestnets = import.meta.env.VITE_DISABLE_TESTNETS === 'true'

// App URL for metadata
const appUrl = import.meta.env.VITE_APP_URL || 'https://vibeswap.io'

// ============================================
// MAINNET CHAINS
// ============================================
const mainnetChains = [
  {
    chainId: 1,
    name: 'Ethereum',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    rpcUrl: import.meta.env.VITE_ETH_RPC_URL || 'https://eth.llamarpc.com'
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    currency: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    rpcUrl: import.meta.env.VITE_ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc'
  },
  {
    chainId: 10,
    name: 'Optimism',
    currency: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    rpcUrl: import.meta.env.VITE_OP_RPC_URL || 'https://mainnet.optimism.io'
  },
  {
    chainId: 8453,
    name: 'Base',
    currency: 'ETH',
    explorerUrl: 'https://basescan.org',
    rpcUrl: import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org'
  },
  {
    chainId: 137,
    name: 'Polygon',
    currency: 'MATIC',
    explorerUrl: 'https://polygonscan.com',
    rpcUrl: import.meta.env.VITE_POLYGON_RPC_URL || 'https://polygon-rpc.com'
  },
]

// ============================================
// TESTNET CHAINS (disabled in production)
// ============================================
const testnetChains = [
  {
    chainId: 11155111,
    name: 'Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    rpcUrl: 'https://rpc.sepolia.org'
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.arbiscan.io',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc'
  },
]

// Build chains array based on environment
const chains = disableTestnets ? mainnetChains : [...mainnetChains, ...testnetChains]

const metadata = {
  name: 'VibeSwap',
  description: 'MEV-Protected Omnichain DEX',
  url: appUrl,
  icons: [`${appUrl}/logo.png`]
}

// Initialize Web3Modal
const modal = createWeb3Modal({
  ethersConfig: defaultConfig({
    metadata,
    enableEIP6963: true,
    enableInjected: true,
    enableCoinbase: true,
  }),
  chains,
  projectId,
  enableAnalytics: false,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-color-mix': '#00ff41',
    '--w3m-color-mix-strength': 20,
    '--w3m-accent': '#00ff41',
    '--w3m-border-radius-master': '8px'
  },
  // Featured wallets - prioritize these
  featuredWalletIds: [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase
  ],
  // Only show wallet options, no email/social for now
  // Email login requires WalletConnect Cloud project configuration
  allWallets: 'SHOW',
})

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const { open, close } = useWeb3Modal()
  const { address, chainId, isConnected } = useWeb3ModalAccount()
  const { walletProvider } = useWeb3ModalProvider()
  const { disconnect: web3Disconnect } = useDisconnect()
  const events = useWeb3ModalEvents()

  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState(null)
  const hasShownConnectToast = useRef(false)

  // Supported chains lookup
  const supportedChains = chains.reduce((acc, chain) => {
    acc[chain.chainId] = chain
    return acc
  }, {})

  // Listen for connection events and handle auto-close
  useEffect(() => {
    if (events.data?.event === 'CONNECT_SUCCESS' || events.data?.event === 'MODAL_CLOSE') {
      setIsConnecting(false)
      // Force close modal after successful connection
      if (isConnected) {
        close()
      }
    }
  }, [events, isConnected, close])

  // Show toast when wallet connects
  useEffect(() => {
    if (isConnected && address && !hasShownConnectToast.current) {
      hasShownConnectToast.current = true
      toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`)
      setIsConnecting(false)
    }
    if (!isConnected) {
      hasShownConnectToast.current = false
    }
  }, [isConnected, address])

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
