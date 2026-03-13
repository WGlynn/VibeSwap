# Grant & Application Tracker

*Last updated: 2026-03-13*

| Program | Status | Submitted | Amount | Contact | Notes |
|---------|--------|-----------|--------|---------|-------|
| Ethereum Foundation | Draft ready | - | $100K | [EF Grants](https://esp.ethereum.foundation) | MEV research angle |
| Base Ecosystem Fund | Draft ready | - | $65K | [Base Grants](https://base.org/grants) | Live on Base, highlight MEV-free |
| LayerZero Ecosystem | Draft ready | - | $100K | [LZ Grants](https://layerzero.network/ecosystem) | CrossChainRouter OApp |
| Nervos/CKB | Draft ready | - | $90K | [Nervos Grants](https://www.nervos.org/grants) | CKB Rust SDK, UTXO DEX |
| Gitcoin GG | Draft ready | - | Variable | [Gitcoin](https://grants.gitcoin.co) | Public goods framing |
| ETHGlobal Hackathon | Draft ready | - | Prizes | [ETHGlobal](https://ethglobal.com) | Next event TBD |
| Anthropic Partners | Submitted | 2026-02 | Partnership | claude.com/partners | Via JARVIS customer story |
| Anthropic Fellows | Pending | - | Fellowship | alignment.anthropic.com | May/July 2026 cohorts |
| Anthropic AI for Science | Watching | - | API credits | anthropic.com | Check if apps open |
| Optimism RetroPGF | Not started | - | Variable | [OP RetroPGF](https://app.optimism.io/retropgf) | Need Optimism deployment first |

## Status Key
- **Draft ready** — Application template exists in `docs/grants/`, needs [CUSTOMIZE] fields filled
- **Submitted** — Application sent, awaiting response
- **Pending** — Waiting for application window to open
- **Watching** — Monitoring for opportunity
- **Not started** — No template yet
- **Approved** — Funded
- **Rejected** — Declined (keep for reapplication)

## Quick Commands
```bash
# Generate any grant application with live stats:
node scripts/bd-toolkit.js grant ethereum-foundation

# Generate ALL at once:
node scripts/bd-toolkit.js all-grants

# Pull latest stats for manual applications:
node scripts/bd-toolkit.js stats
```

## Submission Checklist
- [ ] Fill all [CUSTOMIZE] fields
- [ ] Update stats (run `node scripts/bd-toolkit.js stats`)
- [ ] Add Will's email/Twitter handles
- [ ] Review budget justification
- [ ] Include GitHub link and live demo
- [ ] Screenshot of live app
- [ ] Update this tracker with submission date
