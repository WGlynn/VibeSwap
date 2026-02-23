# Disaster Recovery Guide

## If Will's Machine Goes Down

### What Still Works
- **Jarvis Telegram Bot** — runs on Fly.io (`jarvis-vibeswap.fly.dev`), has persistent volume
  - Can still respond in Telegram, analyze ideas, generate code drafts
  - `/idea` command creates branches and pushes code
  - `/commit` pushes to both remotes
  - Data backup every 30 minutes to private repo
- **GitHub Actions CI** — runs on every push/PR automatically
  - Frontend build + validation
  - Backend tests (12 tests)
  - Smart contract build + full test suite
  - Oracle tests
  - Docker build verification
  - Security checks (Slither, dependency audits)
- **Frontend** — deployed on Vercel, auto-redeploys from master
- **All code** — mirrored on two GitHub repos (origin + stealth)

### What Stops
- **Claude Code sessions** — interactive development, debugging, architecture work
- **Local Forge testing** — fast iteration on contracts
- **Frontend local dev** — hot reload development

### Recovery Steps (Any Machine)

1. Clone the repo:
   ```bash
   git clone https://github.com/wglynn/vibeswap.git
   cd vibeswap
   ```

2. Read session state:
   ```bash
   cat .claude/SESSION_STATE.md
   cat docs/session-reports/  # Latest session report
   ```

3. Set up Foundry:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

4. Run tests:
   ```bash
   forge build
   forge test -vvv
   ```

5. Set up frontend:
   ```bash
   cd frontend && npm ci && npm run dev
   ```

6. Jarvis bot (if Fly.io is also down):
   ```bash
   cd jarvis-bot
   cp .env.example .env  # Fill in tokens
   npm install
   npm start
   ```

### Critical Secrets (Stored in 1Password / Will's vault)
- `TELEGRAM_BOT_TOKEN` — Jarvis bot
- `ANTHROPIC_API_KEY` — Claude API for Jarvis
- `VERCEL_TOKEN` — Frontend deployment
- `DEPLOYER_PRIVATE_KEY` — Contract deployment (Base mainnet)
- `WALLETCONNECT_PROJECT_ID` — Wallet connections
- GitHub personal access tokens for both repos

### Backup Operator Protocol
If Will is unreachable for 48+ hours:
1. Any authorized contributor can fork the repo
2. Jarvis bot continues operating autonomously on Fly.io
3. Use `/idea` in Telegram to continue generating code
4. PRs can be created and merged by any repo collaborator
5. Vercel auto-deploys from master pushes

### Data That Must Not Be Lost
- `.claude/SESSION_STATE.md` — current work state
- `docs/session-reports/` — session history
- `jarvis-bot/data/` — contribution tracking, user data, conversations
- `docs/` — all whitepapers and mechanism design docs
- Smart contract code (obviously)
