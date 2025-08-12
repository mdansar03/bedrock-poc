const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./src/utils/logger');
const scrapingRoutes = require('./src/routes/scraping');
const chatRoutes = require('./src/routes/chat');
const filesRoutes = require('./src/routes/files');
const healthRoutes = require('./src/routes/health');

const app = express();
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// CORS configuration (supports multiple origins via CORS_ORIGINS or FRONTEND_URL)
const configuredOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser or same-origin requests (no Origin header)
    if (!origin) return callback(null, true);

    // Exact match against configured origins
    if (configuredOrigins.includes(origin)) return callback(null, true);

    // Optional: allow all Vercel preview domains when enabled
    const allowVercelWildcard = process.env.CORS_ALLOW_VERCEL_WILDCARD === 'true';
    if (allowVercelWildcard && /https?:\/\/.*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API routes
app.use('/api/health', healthRoutes);
app.use('/api/scraping', scrapingRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/chat', chatRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Oralia AI Chatbot server running on port ${PORT}`);
  logger.info(`📱 Frontend URL: ${process.env.FRONTEND_URL}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🔧 AWS Region: ${process.env.AWS_REGION}`);
  logger.info(`📚 Knowledge Base ID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
});

// Increase server request timeout to tolerate long-running crawls
const SERVER_REQUEST_TIMEOUT_MS = parseInt(process.env.SERVER_REQUEST_TIMEOUT_MS || '', 10) || 1200000; // 20 minutes
server.setTimeout(SERVER_REQUEST_TIMEOUT_MS);
logger.info(`⏱️ HTTP request timeout set to ${SERVER_REQUEST_TIMEOUT_MS}ms`);

module.exports = app;