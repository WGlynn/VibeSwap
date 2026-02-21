import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { createAppKit } from '@reown/appkit/react'
import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider, useDisconnect, useAppKitEvents } from '@reown/appkit/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { mainnet, arbitrum, optimism, base, polygon, sepolia, arbitrumSepolia } from '@reown/appkit/networks'
import { BrowserProvider } from 'ethers'
import toast from 'react-hot-toast'

// ============================================
// PRODUCTION CONFIGURATION
// ============================================
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '3a8170812b534d0ff9d794f19a901d64'
const isProduction = import.meta.env.VITE_PRODUCTION_MODE === 'true'
const disableTestnets = import.meta.env.VITE_DISABLE_TESTNETS === 'true'
const appUrl = import.meta.env.VITE_APP_URL || 'https://frontend-jade-five-87.vercel.app'

const metadata = {
  name: 'VibeSwap',
  description: 'MEV-Protected Omnichain DEX',
  url: appUrl,
  icons: [`${appUrl}/logo.png`]
}

// Build networks array based on environment
const networks = disableTestnets
  ? [base, mainnet, arbitrum, optimism, polygon]
  : [base, mainnet, arbitrum, optimism, polygon, sepolia, arbitrumSepolia]

// Initialize AppKit (Reown — replaces deprecated Web3Modal)
const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks,
  defaultNetwork: base,
  metadata,
  projectId,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-color-mix': '#00ff41',
    '--w3m-color-mix-strength': 20,
    '--w3m-accent': '#00ff41',
    '--w3m-border-radius-master': '8px'
  },
  featuredWalletIds: [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase
  ],
  features: {
    email: false,
    socials: false,
    emailShowWallets: true,
    swaps: false,
    analytics: false,
  },
  coinbasePreference: 'eoaOnly',
  allWallets: 'SHOW',
})

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const { open, close } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  const { chainId } = useAppKitNetwork()
  const { walletProvider } = useAppKitProvider('eip155')
  const { disconnect: appKitDisconnect } = useDisconnect()
  const events = useAppKitEvents()

  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState(null)
  const hasShownConnectToast = useRef(false)

  // Supported chains lookup
  const supportedChains = networks.reduce((acc, network) => {
    acc[network.id] = { chainId: network.id, name: network.name, currency: network.nativeCurrency?.symbol || 'ETH' }
    return acc
  }, {})

  // Listen for connection events
  useEffect(() => {
    if (events.data?.event === 'CONNECT_SUCCESS' || events.data?.event === 'MODAL_CLOSE') {
      setIsConnecting(false)
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
      await appKitDisconnect()
      setProvider(null)
      setSigner(null)
      toast.success('Wallet disconnected')
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }, [appKitDisconnect])

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
