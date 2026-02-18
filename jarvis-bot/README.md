# JARVIS — VibeSwap AI Co-Admin

JARVIS is a Telegram bot powered by Claude. He manages the VibeSwap community — tracks contributions, moderates chat, answers questions, and runs daily digests. He has full project context and proactive intelligence.

---

## What You Need Before Starting

You need **two keys** to run JARVIS. Both are free to get.

### 1. Telegram Bot Token

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Pick a name (e.g. "JARVIS") and a username (e.g. "MyJarvisBot")
4. BotFather gives you a token that looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
5. Copy it. You'll need it in a minute.

### 2. Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys** and click **Create Key**
4. Copy the key. It starts with `sk-ant-...`

---

## Option A: Run on Your Computer

This is the simplest way. JARVIS runs as long as your computer is on.

### Step 1: Install Node.js

Go to [nodejs.org](https://nodejs.org) and download the **LTS** version. Install it. To check it worked, open a terminal and type:

```
node --version
```

You should see a version number like `v22.x.x`.

### Step 2: Download the code

```
git clone https://github.com/WGlynn/VibeSwap.git
cd VibeSwap/jarvis-bot
```

### Step 3: Install dependencies

```
npm install
```

### Step 4: Set up your keys

Copy the example file:

```
cp .env.example .env
```

Open `.env` in any text editor (Notepad, VS Code, whatever). Fill in these two lines:

```
TELEGRAM_BOT_TOKEN=paste_your_telegram_token_here
ANTHROPIC_API_KEY=paste_your_anthropic_key_here
```

Save the file.

### Step 5: Start JARVIS

```
npm start
```

You should see:

```
[jarvis] ============ JARVIS IS ONLINE ============
```

Open Telegram, find your bot, and send it a message. It should reply.

**To stop JARVIS:** Press `Ctrl+C` in the terminal.

---

## Option B: Run with Docker

Docker keeps JARVIS running even if you close the terminal. It auto-restarts if it crashes.

### Step 1: Install Docker

Go to [docker.com/get-started](https://www.docker.com/get-started/) and download **Docker Desktop**. Install it and open it.

To check it worked:

```
docker --version
```

### Step 2: Download the code

```
git clone https://github.com/WGlynn/VibeSwap.git
cd VibeSwap/jarvis-bot
```

### Step 3: Set up your keys

```
cp .env.example .env
```

Open `.env` and fill in:

```
TELEGRAM_BOT_TOKEN=paste_your_telegram_token_here
ANTHROPIC_API_KEY=paste_your_anthropic_key_here
```

### Step 4: Start JARVIS

```
docker compose up -d
```

That's it. JARVIS is running in the background.

**Useful commands:**

| What you want | Command |
|---|---|
| See if JARVIS is running | `docker compose ps` |
| Watch the logs live | `docker compose logs -f` |
| Stop JARVIS | `docker compose down` |
| Restart JARVIS | `docker compose restart` |
| Rebuild after code changes | `docker compose up -d --build` |

---

## Option C: Run in the Cloud (Always On)

This runs JARVIS on a server so it's online 24/7 even when your computer is off. Uses [Fly.io](https://fly.io) — free tier is enough.

### Step 1: Install Fly.io CLI

**Mac/Linux:**
```
curl -L https://fly.io/install.sh | sh
```

**Windows:**
```
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### Step 2: Sign up and log in

```
fly auth signup
```

This opens a browser. Create a free account, then come back to the terminal.

### Step 3: Download the code

```
git clone https://github.com/WGlynn/VibeSwap.git
cd VibeSwap/jarvis-bot
```

### Step 4: Create your app on Fly.io

```
fly launch --copy-config --no-deploy
```

When it asks questions:
- **App name**: pick anything (e.g. `my-jarvis-bot`)
- **Region**: pick the one closest to you
- Say **yes** to creating a volume when asked

### Step 5: Set your keys

```
fly secrets set TELEGRAM_BOT_TOKEN=paste_your_telegram_token_here ANTHROPIC_API_KEY=paste_your_anthropic_key_here
```

If you want JARVIS to sync with a private GitHub repo (recommended), also create a [GitHub personal access token](https://github.com/settings/tokens) and add it:

```
fly secrets set GITHUB_TOKEN=paste_your_github_token_here
```

### Step 6: Deploy

```
fly deploy
```

Wait a couple minutes. When it's done, JARVIS is live in the cloud.

**Useful commands:**

| What you want | Command |
|---|---|
| Check status | `fly status` |
| Watch logs | `fly logs` |
| Open health check | `fly open /health` |
| Restart | `fly apps restart` |
| Stop (destroy app) | `fly apps destroy my-jarvis-bot` |

---

## Talking to JARVIS

Once running, open Telegram and message your bot. Some things to try:

- Just talk to him — he knows the full VibeSwap project
- `/mystats` — see your contribution profile
- `/health` — check JARVIS's brain status
- `/digest` — get today's community summary
- `/archive` — save a good conversation as a knowledge artifact
- `/threads` — browse archived conversations
- `/brain` — see JARVIS's proactive intelligence stats

In group chats, JARVIS listens to everything (for contribution tracking) but only responds when:
- You mention him by name ("jarvis")
- You `@mention` him
- You reply to one of his messages

---

## Troubleshooting

**JARVIS doesn't reply:**
- Check that `TELEGRAM_BOT_TOKEN` is correct in your `.env`
- Make sure only ONE instance is running (two instances fight over the same token)
- Run `docker compose logs` or check the terminal for error messages

**"Unauthorized" error:**
- Your `ANTHROPIC_API_KEY` is wrong or expired. Get a new one from [console.anthropic.com](https://console.anthropic.com)

**JARVIS replies but doesn't know anything about VibeSwap:**
- The context files might not have loaded. Send `/health` to check
- If running in Docker/cloud, make sure `GITHUB_TOKEN` is set so JARVIS can clone the repo

**Docker won't start:**
- Make sure Docker Desktop is running (check your system tray/menu bar)
- Try `docker compose down` then `docker compose up -d` again

**Fly.io deploy fails:**
- Run `fly auth login` to make sure you're logged in
- Check `fly logs` for the error message
- Make sure you created a volume: `fly volumes create jarvis_data --region YOUR_REGION --size 1`

---

## Architecture

```
jarvis-bot/
├── src/
│   ├── index.js          # Main bot — commands, message handler, startup
│   ├── claude.js          # Claude API integration + conversation history
│   ├── memory.js          # System prompt builder (loads all context files)
│   ├── config.js          # Configuration (env vars, path resolution)
│   ├── tracker.js         # Contribution tracking + user registry
│   ├── moderation.js      # Warn/mute/ban with evidence hashes
│   ├── antispam.js        # Scam detection, flood protection
│   ├── intelligence.js    # Proactive AI analysis + engagement
│   ├── digest.js          # Daily/weekly community summaries
│   ├── threads.js         # Conversation archival
│   └── git.js             # Git sync + backup operations
├── data/                  # Persistent data (auto-created)
├── Dockerfile             # Container build
├── docker-compose.yml     # Docker orchestration
├── entrypoint.sh          # Cloud startup script
├── fly.toml               # Fly.io deployment config
├── .env.example           # Template for secrets
└── package.json
```

---

## License

Part of VibeSwap. The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.
