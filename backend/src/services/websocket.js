import { WebSocketServer } from 'ws';
import { PriceFeedService } from './priceFeed.js';
import { logger } from '../utils/logger.js';

const HEARTBEAT_INTERVAL = parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10);
const PRICE_BROADCAST_INTERVAL = 10000; // 10 seconds
const MAX_CONNECTIONS = parseInt(process.env.WS_MAX_CONNECTIONS || '1000', 10);
const MAX_PER_IP = parseInt(process.env.WS_MAX_PER_IP || '10', 10);
const MAX_MESSAGES_PER_MIN = 30;

export function setupWebSocket(server, options = {}) {
  const { priceFeed: injectedPriceFeed, allowedOrigins } = options;
  const wss = new WebSocketServer({ server, path: '/ws' });
  const priceFeed = injectedPriceFeed || new PriceFeedService();
  const clients = new Set();
  const ipConnections = new Map(); // ip -> count
  const messageCounters = new Map(); // ws -> { count, resetAt }

  wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

    // ============ Origin Validation ============
    if (allowedOrigins && allowedOrigins.length > 0) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        logger.warn({ origin, ip: clientIp }, 'WS connection rejected: invalid origin');
        ws.close(1008, 'Origin not allowed');
        return;
      }
    }

    // ============ Global Connection Limit ============
    if (clients.size >= MAX_CONNECTIONS) {
      logger.warn({ ip: clientIp, connections: clients.size }, 'WS connection rejected: max connections');
      ws.close(1013, 'Try again later');
      return;
    }

    // ============ Per-IP Connection Limit ============
    const ipCount = ipConnections.get(clientIp) || 0;
    if (ipCount >= MAX_PER_IP) {
      logger.warn({ ip: clientIp, count: ipCount }, 'WS connection rejected: per-IP limit');
      ws.close(1013, 'Too many connections from this IP');
      return;
    }
    ipConnections.set(clientIp, ipCount + 1);

    logger.info({ ip: clientIp, active: clients.size + 1 }, 'WS client connected');

    ws.isAlive = true;
    ws._clientIp = clientIp;
    clients.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      // ============ Rate Limiting ============
      const now = Date.now();
      let counter = messageCounters.get(ws);
      if (!counter || now > counter.resetAt) {
        counter = { count: 0, resetAt: now + 60000 };
        messageCounters.set(ws, counter);
      }
      counter.count++;
      if (counter.count > MAX_MESSAGES_PER_MIN) {
        logger.warn({ ip: clientIp }, 'WS client rate limited');
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg, priceFeed);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      messageCounters.delete(ws);
      const count = ipConnections.get(clientIp) || 1;
      if (count <= 1) {
        ipConnections.delete(clientIp);
      } else {
        ipConnections.set(clientIp, count - 1);
      }
      logger.info({ ip: clientIp, active: clients.size }, 'WS client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ ip: clientIp, error: err.message }, 'WS client error');
      clients.delete(ws);
      messageCounters.delete(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'VibeSwap WebSocket connected',
      timestamp: new Date().toISOString(),
    }));
  });

  // Heartbeat to detect dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        clients.delete(ws);
        messageCounters.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  // Broadcast price updates periodically
  const priceBroadcast = setInterval(async () => {
    if (clients.size === 0) return;
    try {
      const prices = await priceFeed.getAllPrices();
      const msg = JSON.stringify({
        type: 'prices',
        data: prices,
        timestamp: new Date().toISOString(),
      });
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(msg);
        }
      }
    } catch (err) {
      logger.error({ error: err.message }, 'WS price broadcast error');
    }
  }, PRICE_BROADCAST_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(priceBroadcast);
  });

  // Expose client count for health checks
  wss.getClientCount = () => clients.size;

  logger.info('WebSocket server ready on /ws');
  return wss;
}

function handleMessage(ws, msg, priceFeed) {
  switch (msg.type) {
    case 'subscribe':
      ws.send(JSON.stringify({
        type: 'subscribed',
        channel: msg.channel || 'prices',
        timestamp: new Date().toISOString(),
      }));
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;

    case 'getPrice':
      priceFeed.getPrice(msg.symbol).then((price) => {
        ws.send(JSON.stringify({
          type: 'price',
          symbol: msg.symbol,
          data: price,
          timestamp: new Date().toISOString(),
        }));
      });
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${msg.type}`,
      }));
  }
}
