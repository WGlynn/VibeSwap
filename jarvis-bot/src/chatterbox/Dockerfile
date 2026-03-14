FROM node:20-slim

WORKDIR /app

# Chatterbox only needs telegraf + anthropic SDK
COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

RUN mkdir -p /app/data

# No HTTP service — pure TG bot polling
CMD ["node", "index.js"]
