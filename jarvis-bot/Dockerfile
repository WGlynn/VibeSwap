FROM node:20-slim

# Install git for repo clone/pull operations (entrypoint.sh)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

# Bundle memory files into /app/memory/ (Jarvis context)
COPY memory/ /app/memory/

# Bundle core context files as fallback (used when git clone fails)
# These are snapshots from build time — live versions come from the cloned repo
COPY context-fallback/ /app/context-fallback/

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Data directory (mounted as persistent volume in production)
RUN mkdir -p /app/data

# Health check endpoint runs on 8080
EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
