# JARVIS — Dockerized Telegram Bot
# VibeSwap AI Co-Admin
#
# Build:  docker build -t jarvis-bot .
# Run:    docker run --env-file .env -v jarvis-data:/app/data jarvis-bot

FROM node:22-slim

# Git is required for auto-sync and auto-backup
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY src/ ./src/

# Create data directory (will be overridden by volume mount)
RUN mkdir -p /app/data

# Create directories for context files that get cloned at startup
RUN mkdir -p /repo /memory

# Copy the entrypoint script (strip Windows CRLF line endings)
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Health check — verify the process is alive
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD node -e "const fs=require('fs');const hb=JSON.parse(fs.readFileSync('/app/data/heartbeat.json','utf-8'));const age=Date.now()-hb.timestamp;process.exit(age>600000?1:0)" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
