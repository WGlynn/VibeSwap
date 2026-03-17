# VibeSwap Frontend

## Install on iPhone

**Add VibeSwap to your home screen for an app-like experience:**

1. Open **https://frontend-jade-five-87.vercel.app** in Safari
2. Tap the **Share** button (square with arrow pointing up)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"** in the top right

That's it! VibeSwap now appears as an app on your home screen.

---

Full-featured frontend for the VibeSwap MEV-resistant omnichain DEX. 336 React components, 70 custom hooks, 147 pages. Deployed on Vercel.

## Features

- **336 React components** across Swap, Pool, Bridge, Staking, Governance, Analytics, Treasury, Shapley, Emissions, CRPC, Trinity, x402, and many more pages
- **70 custom hooks** including useWallet, useDeviceWallet, useBalances, useAuction, useBridge, and more
- **Dual wallet support** — external wallets (MetaMask, WalletConnect) and device wallets (WebAuthn/passkeys via Secure Element)
- **MEV protection visualization** — commit-reveal batch auction timer and phase display
- **Multi-chain** — Ethereum, Arbitrum, Optimism, Base, Polygon via LayerZero V2
- **Dark theme** with cyan/green accents, responsive design
- **Deployed** at https://frontend-jade-five-87.vercel.app

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
frontend/
├── src/
│   ├── components/        # 336 React components (pages, modals, widgets, layouts)
│   ├── hooks/             # 70 custom hooks (wallet, balances, auction, bridge, etc.)
│   ├── utils/             # Constants, formatting, helpers
│   ├── abis/              # Contract ABIs
│   ├── App.jsx            # Main app with routing
│   ├── main.jsx           # Entry point
│   └── index.css          # Tailwind styles
├── public/                # Static assets, PWA manifest
└── package.json
```

## Configuration

### Contract Addresses

Update contract addresses in `src/utils/constants.js` after deployment:

```javascript
export const CONTRACTS = {
  11155111: {  // Sepolia
    vibeSwapCore: '0x...',
    auction: '0x...',
    amm: '0x...',
    treasury: '0x...',
    router: '0x...',
  },
}
```

### Adding New Tokens

Add tokens to the `TOKENS` object in `src/utils/constants.js`:

```javascript
export const TOKENS = {
  11155111: [
    {
      symbol: 'TOKEN',
      name: 'Token Name',
      address: '0x...',
      decimals: 18,
      logo: 'https://...',
    },
  ],
}
```

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **ethers.js v6** - Ethereum interactions
- **Framer Motion** - Animations
- **React Router** - Navigation
- **React Hot Toast** - Notifications

## Key Features Explained

### MEV Protection Visualization

The `BatchTimer` component shows the current batch phase:
- **Commit Phase (8s)** - Users submit hidden orders
- **Reveal Phase (2s)** - Users reveal their orders
- **Settlement** - Orders execute at uniform clearing price

### Swap Flow

1. User enters swap amount
2. Quote is fetched from AMM
3. User clicks "Swap"
4. Order is committed to current batch
5. After reveal phase, order is revealed
6. Batch settles and tokens are swapped

### Wallet Integration

Two wallet systems, unified across all pages:
- **useWallet** — external wallets (MetaMask, injected providers): connection state, chain switching, auto-reconnection
- **useDeviceWallet** — device wallets (WebAuthn/passkeys): keys stored in Secure Element, never leave the device
- Combined state: `isConnected = isExternalConnected || isDeviceConnected`

## Development

```bash
# Run development server
npm run dev

# Lint code
npm run lint

# Preview production build
npm run preview
```

## Deployment

```bash
# Build for production
npm run build

# Output is in dist/
```

Currently deployed on Vercel: https://frontend-jade-five-87.vercel.app

The `dist/` folder can also be deployed to Netlify, IPFS, or GitHub Pages.

## License

MIT
