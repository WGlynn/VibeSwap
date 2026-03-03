# Stage 1: Build Mini App
FROM node:20-slim AS webapp-build
WORKDIR /build
COPY webapp/package.json webapp/package-lock.json* ./
RUN npm ci || npm install
COPY webapp/ ./
RUN npm run build

# Stage 2: Main app
FROM node:20-slim

# Install git + fonts for repo operations and sticker generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
    fonts-noto-core fonts-noto-mono fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

# Copy built Mini App from stage 1
COPY --from=webapp-build /build/dist ./webapp/dist/

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
