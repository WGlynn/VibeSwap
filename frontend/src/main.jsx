import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { WalletProvider } from './hooks/useWallet'
import { DeviceWalletProvider } from './hooks/useDeviceWallet'
import { BalanceProvider } from './hooks/useBalances'
import { VaultProvider } from './hooks/useVault'
import { BatchProvider } from './hooks/useBatchState'
import { IncentivesProvider } from './hooks/useIncentives'
import { TransactionsProvider } from './hooks/useTransactions'
import './index.css'

// Signal successful load to prevent timeout error
window.__vibeswapLoaded = true

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <DeviceWalletProvider>
          <BalanceProvider>
            <VaultProvider>
              <BatchProvider>
                <IncentivesProvider>
                  <TransactionsProvider>
                    <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1e293b',
              color: '#f1f5f9',
              border: '1px solid #334155',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#f1f5f9',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#f1f5f9',
              },
            },
          }}
        />
                  </TransactionsProvider>
                </IncentivesProvider>
              </BatchProvider>
            </VaultProvider>
          </BalanceProvider>
        </DeviceWalletProvider>
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
