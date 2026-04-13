FROM node:20-slim AS frontend

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npx vite build

FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY src/ src/
COPY --from=frontend /app/frontend/dist frontend/dist/

RUN mkdir -p /data

ENV NODE_ENV=production
ENV COGPROOF_DB_PATH=/data/cogproof.db
ENV PORT=3001

EXPOSE 3001

CMD ["node", "src/api/server.js"]
