# JARVIS — Dockerized Telegram Bot
# VibeSwap AI Co-Admin
#
# Build:  docker build -t jarvis-bot .
# Run:    docker run --env-file .env -v jarvis-data:/app/data jarvis-bot

FROM node:20-alpine

# Git is required for auto-sync (git pull) and auto-backup (git commit/push)
RUN apk add --no-cache git ca-certificates bash

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY src/ ./src/

# Copy entrypoint script and fix Windows line endings
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Create data directory (overridden by volume mount in production)
RUN mkdir -p /app/data

# Create directories for repo clone and context files
RUN mkdir -p /repo /memory

# Persistent data volume mount point
VOLUME /app/data

# Health check — verify the bot process is alive via heartbeat file
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD node -e "const fs=require('fs');const hb=JSON.parse(fs.readFileSync('/app/data/heartbeat.json','utf-8'));const age=Date.now()-hb.timestamp;process.exit(age>600000?1:0)" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
