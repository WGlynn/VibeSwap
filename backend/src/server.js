import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';
import { setupWebSocket } from './services/websocket.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.js';
import priceRoutes from './routes/prices.js';
import tokenRoutes from './routes/tokens.js';
import chainRoutes from './routes/chains.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

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
if (NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// ============ Rate Limiting ============
app.use('/api/', apiLimiter);

// ============ Trust Proxy (for reverse proxy setups) ============
app.set('trust proxy', 1);

// ============ API Routes ============
app.use('/api/health', healthRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/chains', chainRoutes);

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
setupWebSocket(server);

// ============ Start Server ============
server.listen(PORT, () => {
  console.log(`VibeSwap API server running on port ${PORT} (${NODE_ENV})`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});

// ============ Graceful Shutdown ============
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force close after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
