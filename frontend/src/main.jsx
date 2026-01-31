import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { WalletProvider } from './hooks/useWallet'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
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
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
