import 'dotenv/config';
import { validateEnv } from './utils/validateEnv.js';
validateEnv();

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { logger, httpLogger } from './utils/logger.js';
import { setupWebSocket } from './services/websocket.js';
import { PriceFeedService } from './services/priceFeed.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createHealthRoutes } from './routes/health.js';
import priceRoutes from './routes/prices.js';
import tokenRoutes from './routes/tokens.js';
import chainRoutes from './routes/chains.js';
import { createGitHubRoutes } from './routes/github.js';
import { GitHubRelayerService } from './services/githubRelayer.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============ Shared Services ============
const priceFeed = new PriceFeedService();
const githubRelayer = new GitHubRelayerService();
githubRelayer.initialize(); // Non-blocking — logs warning if not configured

// ============ Security Middleware ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "wss:", "https:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ============ CORS ============
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ============ Request Parsing ============
app.use(express.json({ limit: '1mb' }));

// ============ Logging ============
app.use(httpLogger);

// ============ Rate Limiting ============
app.use('/api/', apiLimiter);

// ============ Trust Proxy (for reverse proxy setups) ============
app.set('trust proxy', 1);

// ============ API Routes ============
app.use('/api/health', createHealthRoutes(priceFeed));
app.use('/api/prices', priceRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/chains', chainRoutes);
app.use('/api/github', createGitHubRoutes(githubRelayer));

// ============ Root ============
app.get('/', (_req, res) => {
  res.json({
    name: 'VibeSwap API',
    version: '1.0.0',
    status: 'operational',
    docs: '/api/health',
  });
});

// ============ Error Handling ============
app.use(notFoundHandler);
app.use(errorHandler);

// ============ WebSocket Setup ============
const wss = setupWebSocket(server, { priceFeed, allowedOrigins });

// ============ Request Timeouts ============
server.timeout = 30000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// ============ Start Server ============
server.listen(PORT, () => {
  logger.info({ port: PORT, env: NODE_ENV }, 'VibeSwap API server started');
  logger.info({ url: `http://localhost:${PORT}/api/health` }, 'Health check endpoint');
  logger.info({ url: `ws://localhost:${PORT}/ws` }, 'WebSocket endpoint');
});

// ============ Graceful Shutdown ============
const shutdown = (signal) => {
  logger.info({ signal }, 'Shutdown signal received');

  // Flush pending GitHub contributions
  githubRelayer.shutdown();

  // Close WebSocket server first
  if (wss) {
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    wss.close(() => {
      logger.info('WebSocket server closed');
    });
  }

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
