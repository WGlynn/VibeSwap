# VibeSwap Frontend

## Install on iPhone

**Add VibeSwap to your home screen for an app-like experience:**

1. Open **https://frontend-jade-five-87.vercel.app** in Safari
2. Tap the **Share** button (square with arrow pointing up)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"** in the top right

That's it! VibeSwap now appears as an app on your home screen.

---

A clean, Uniswap-style interface for the VibeSwap MEV-resistant omnichain DEX.

## Features

- 🔄 **Token Swapping** - Clean swap interface with real-time quotes
- 🛡️ **MEV Protection** - Commit-reveal batch auction visualization
- 💧 **Liquidity Pools** - Add/remove liquidity with pool analytics
- 🌐 **Multi-chain** - Support for Ethereum, Arbitrum, Optimism, Base, Polygon
- 👛 **Wallet Connect** - MetaMask and other Web3 wallet support
- 🎨 **Dark Theme** - Modern, clean UI inspired by Uniswap

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
│   ├── components/
│   │   ├── Header.jsx         # Navigation and wallet connect
│   │   ├── SwapPage.jsx       # Main swap interface
│   │   ├── PoolPage.jsx       # Liquidity pools
│   │   ├── TokenSelector.jsx  # Token selection modal
│   │   ├── BatchTimer.jsx     # Commit-reveal phase timer
│   │   └── SettingsModal.jsx  # Slippage settings
│   ├── hooks/
│   │   └── useWallet.jsx      # Wallet connection hook
│   ├── utils/
│   │   ├── constants.js       # Contract addresses, tokens
│   │   └── format.js          # Number formatting utilities
│   ├── abis/                  # Contract ABIs
│   ├── App.jsx                # Main app component
│   ├── main.jsx               # Entry point
│   └── index.css              # Tailwind styles
├── public/
│   └── vibe-icon.svg          # Logo
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

The `useWallet` hook provides:
- Connection state management
- Chain switching
- Auto-reconnection
- Event listeners for account/chain changes

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

Deploy the `dist/` folder to any static hosting:
- Vercel
- Netlify
- IPFS
- GitHub Pages

## License

MIT
