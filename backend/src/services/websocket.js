import { WebSocketServer } from 'ws';
import { PriceFeedService } from './priceFeed.js';
import { logger } from '../utils/logger.js';

const HEARTBEAT_INTERVAL = parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10);
const PRICE_BROADCAST_INTERVAL = 10000; // 10 seconds
const BATCH_TICK_INTERVAL = 1000; // 1 second batch timer tick
const MAX_CONNECTIONS = parseInt(process.env.WS_MAX_CONNECTIONS || '1000', 10);
const MAX_PER_IP = parseInt(process.env.WS_MAX_PER_IP || '10', 10);
const MAX_MESSAGES_PER_MIN = 30;

// ============ Batch Cycle Constants ============
const BATCH_PHASES = { COMMIT: 'commit', REVEAL: 'reveal', SETTLING: 'settling' };
const PHASE_DURATIONS = { [BATCH_PHASES.COMMIT]: 8, [BATCH_PHASES.REVEAL]: 2, [BATCH_PHASES.SETTLING]: 1 };
const PHASE_ORDER = [BATCH_PHASES.COMMIT, BATCH_PHASES.REVEAL, BATCH_PHASES.SETTLING];

export function setupWebSocket(server, options = {}) {
  const { priceFeed: injectedPriceFeed, allowedOrigins } = options;
  const wss = new WebSocketServer({ server, path: '/ws' });
  const priceFeed = injectedPriceFeed || new PriceFeedService();
  const clients = new Set();
  const ipConnections = new Map(); // ip -> count
  const messageCounters = new Map(); // ws -> { count, resetAt }

  // ============ Batch State (server-authoritative) ============
  const batchState = {
    phase: BATCH_PHASES.COMMIT,
    timeLeft: PHASE_DURATIONS[BATCH_PHASES.COMMIT],
    batchId: Math.floor(Date.now() / 11000), // deterministic starting batch ID
    queue: { orderCount: 0, totalValue: 0, priorityOrders: 0 },
  };

  // ============ Activity Feed ============
  const recentActivity = []; // last 20 events

  function pushActivity(event) {
    recentActivity.unshift({ ...event, timestamp: new Date().toISOString() });
    if (recentActivity.length > 20) recentActivity.pop();
    broadcastToChannel('activity', { type: 'activity', event, timestamp: new Date().toISOString() });
  }

  // ============ Channel Subscription ============
  function broadcastToChannel(channel, msg) {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === 1) {
        const subs = client._subscriptions || new Set(['prices']); // prices is default
        if (subs.has(channel) || subs.has('all')) {
          client.send(payload);
        }
      }
    }
  }

  function broadcastToAll(msg) {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

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
    ws._subscriptions = new Set(['prices']); // default subscription
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
        handleMessage(ws, msg, priceFeed, batchState, recentActivity);
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

    // Send welcome + current state snapshot
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'VibeSwap WebSocket connected',
      channels: ['prices', 'batch', 'activity'],
      batch: {
        phase: batchState.phase,
        timeLeft: batchState.timeLeft,
        batchId: batchState.batchId,
        queue: batchState.queue,
      },
      timestamp: new Date().toISOString(),
    }));
  });

  // ============ Heartbeat ============
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

  // ============ Price Broadcast (every 10s) ============
  const priceBroadcast = setInterval(async () => {
    if (clients.size === 0) return;
    try {
      const prices = await priceFeed.getAllPrices();
      broadcastToChannel('prices', {
        type: 'prices',
        data: prices,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ error: err.message }, 'WS price broadcast error');
    }
  }, PRICE_BROADCAST_INTERVAL);

  // ============ Batch Cycle Timer (every 1s) ============
  const batchTick = setInterval(() => {
    if (clients.size === 0) return;

    batchState.timeLeft--;

    if (batchState.timeLeft <= 0) {
      // Phase transition
      const phaseIdx = PHASE_ORDER.indexOf(batchState.phase);
      const nextIdx = (phaseIdx + 1) % PHASE_ORDER.length;
      const prevPhase = batchState.phase;
      batchState.phase = PHASE_ORDER[nextIdx];
      batchState.timeLeft = PHASE_DURATIONS[batchState.phase];

      // New batch on settling → commit transition
      if (prevPhase === BATCH_PHASES.SETTLING) {
        batchState.batchId++;
        // Simulate queue for new batch
        batchState.queue = {
          orderCount: Math.floor(Math.random() * 15) + 5,
          totalValue: Math.floor(Math.random() * 400000) + 50000,
          priorityOrders: Math.floor(Math.random() * 4),
        };

        pushActivity({
          action: 'batch_settled',
          batchId: batchState.batchId - 1,
          ordersExecuted: Math.floor(Math.random() * 20) + 8,
          totalVolume: Math.floor(Math.random() * 500000) + 100000,
        });
      }

      // Broadcast phase transition
      broadcastToChannel('batch', {
        type: 'batch_transition',
        from: prevPhase,
        to: batchState.phase,
        batchId: batchState.batchId,
        timeLeft: batchState.timeLeft,
        queue: batchState.queue,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Regular tick — only send if batch subscribers exist
      broadcastToChannel('batch', {
        type: 'batch_tick',
        phase: batchState.phase,
        timeLeft: batchState.timeLeft,
        batchId: batchState.batchId,
        queue: batchState.queue,
        timestamp: new Date().toISOString(),
      });
    }

    // Simulate queue growth during commit phase
    if (batchState.phase === BATCH_PHASES.COMMIT && Math.random() > 0.5) {
      batchState.queue.orderCount += Math.floor(Math.random() * 2) + 1;
      batchState.queue.totalValue += Math.floor(Math.random() * 30000);
      if (Math.random() > 0.8) batchState.queue.priorityOrders++;
    }
  }, BATCH_TICK_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(priceBroadcast);
    clearInterval(batchTick);
  });

  // Expose for external use (health checks, API routes injecting events)
  wss.getClientCount = () => clients.size;
  wss.getBatchState = () => ({ ...batchState });
  wss.pushActivity = pushActivity;
  wss.broadcastToChannel = broadcastToChannel;

  logger.info('WebSocket server ready on /ws (channels: prices, batch, activity)');
  return wss;
}

function handleMessage(ws, msg, priceFeed, batchState, recentActivity) {
  switch (msg.type) {
    case 'subscribe': {
      const channels = Array.isArray(msg.channels) ? msg.channels : [msg.channel || 'prices'];
      for (const ch of channels) {
        ws._subscriptions.add(ch);
      }
      ws.send(JSON.stringify({
        type: 'subscribed',
        channels: [...ws._subscriptions],
        timestamp: new Date().toISOString(),
      }));

      // Send current batch state immediately on batch subscription
      if (channels.includes('batch')) {
        ws.send(JSON.stringify({
          type: 'batch_tick',
          phase: batchState.phase,
          timeLeft: batchState.timeLeft,
          batchId: batchState.batchId,
          queue: batchState.queue,
          timestamp: new Date().toISOString(),
        }));
      }

      // Send recent activity on activity subscription
      if (channels.includes('activity') && recentActivity.length > 0) {
        ws.send(JSON.stringify({
          type: 'activity_history',
          events: recentActivity,
          timestamp: new Date().toISOString(),
        }));
      }
      break;
    }

    case 'unsubscribe': {
      const channels = Array.isArray(msg.channels) ? msg.channels : [msg.channel];
      for (const ch of channels) {
        ws._subscriptions.delete(ch);
      }
      ws.send(JSON.stringify({
        type: 'unsubscribed',
        channels: [...ws._subscriptions],
        timestamp: new Date().toISOString(),
      }));
      break;
    }

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

    case 'getBatch':
      ws.send(JSON.stringify({
        type: 'batch_tick',
        phase: batchState.phase,
        timeLeft: batchState.timeLeft,
        batchId: batchState.batchId,
        queue: batchState.queue,
        timestamp: new Date().toISOString(),
      }));
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${msg.type}`,
      }));
  }
}
