import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    status: 404,
  });
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  logger.error({
    status,
    error: err.message,
    stack: err.stack,
  }, 'Request error');

  res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : err.message,
    message,
    status,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}
