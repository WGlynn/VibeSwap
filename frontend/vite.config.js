import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
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
          if (id.includes('node_modules/@walletconnect') || id.includes('node_modules/@web3modal')) {
            return 'vendor-wallet'
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'vendor-motion'
          }
        }
      }
    }
  }
})
