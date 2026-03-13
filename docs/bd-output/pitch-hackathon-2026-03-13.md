# VibeSwap — Hackathon Pitch (60 seconds)

**Problem**: Every DEX lets bots steal from you. MEV = $1.4B+ extracted from retail traders.

**Solution**: VibeSwap uses 10-second batch auctions. Your order is encrypted, shuffled, and executed at one uniform price. Front-running is impossible — not just hard, impossible.

**How it works**:
1. Submit encrypted order hash (8 seconds)
2. Reveal your order (2 seconds)
3. Fisher-Yates shuffle with XORed secrets
4. Everyone gets the same clearing price

**Built with**: Solidity, Foundry, React, LayerZero V2, Claude AI

**Stats**: 341 contracts, 188 pages, 1612 commits, zero funding

**Demo**: https://frontend-jade-five-87.vercel.app
**Code**: https://github.com/wglynn/vibeswap
