import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/ethers') || id.includes('node_modules/@adraffy') || id.includes('node_modules/@noble')) {
            return 'vendor-ethers'
          }
          // Combined to fix circular dependency warning
          if (id.includes('node_modules/@walletconnect') || id.includes('node_modules/@web3modal') || id.includes('node_modules/@reown')) {
            return 'vendor-wallet'
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'vendor-motion'
          }
        }
      }
    },
    chunkSizeWarningLimit: 2500, // WalletConnect + Web3Modal bundle is ~2MB
  },
  preview: {
    port: 3000,
  },
}))
