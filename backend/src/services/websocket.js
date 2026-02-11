import { WebSocketServer } from 'ws';
import { PriceFeedService } from './priceFeed.js';

const HEARTBEAT_INTERVAL = parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10);
const PRICE_BROADCAST_INTERVAL = 10000; // 10 seconds

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const priceFeed = new PriceFeedService();
  const clients = new Set();

  wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[WS] Client connected from ${clientIp}`);

    ws.isAlive = true;
    clients.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg, priceFeed);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected. Active: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      clients.delete(ws);
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
      console.error('[WS] Price broadcast error:', err.message);
    }
  }, PRICE_BROADCAST_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(priceBroadcast);
  });

  console.log(`[WS] WebSocket server ready on /ws`);
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
