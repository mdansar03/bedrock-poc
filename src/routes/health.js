const express = require('express');
const bedrockService = require('../services/bedrockService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        bedrock: false,
        s3: false
      }
    };

    // Check Bedrock service
    try {
      health.services.bedrock = await bedrockService.healthCheck();
    } catch (error) {
      logger.warn('Bedrock health check failed:', error.message);
      health.services.bedrock = false;
    }

    // S3 health check would go here
    health.services.s3 = true; // Placeholder

    // Overall status
    const allServicesHealthy = Object.values(health.services).every(status => status === true);
    health.status = allServicesHealthy ? 'healthy' : 'degraded';

    const statusCode = allServicesHealthy ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;