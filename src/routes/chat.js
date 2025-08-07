const express = require('express');
const { body, validationResult, query } = require('express-validator');
const bedrockService = require('../services/bedrockService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get available foundation models
 * GET /api/chat/models
 */
router.get('/models', async (req, res) => {
  try {
    const models = bedrockService.getAvailableModels();
    
    res.json({
      success: true,
      data: {
        models,
        defaultModel: bedrockService.defaultModelId
      }
    });

  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available models',
      details: error.message
    });
  }
});

/**
 * Chat with the AI using RAG
 * POST /api/chat/query
 */
router.post('/query', [
  body('message')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters')
    .trim(),
  body('sessionId')
    .optional()
    .isString()
    .withMessage('Session ID must be a string'),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { message, sessionId = null, model = null } = req.body;

    logger.info(`Received chat query: ${message.substring(0, 100)}...`);
    if (model) {
      logger.info(`Using model: ${model}`);
    }

    // Query the knowledge base with selected model
    const response = await bedrockService.queryKnowledgeBase(message, sessionId, model);

    res.json({
      success: true,
      data: {
        answer: response.answer,
        sources: response.sources,
        sessionId: response.sessionId,
        model: bedrockService.getModelId(model),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Chat query error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process chat query',
      message: error.message
    });
  }
});

/**
 * Direct model invocation (without RAG)
 * POST /api/chat/direct
 */
router.post('/direct', [
  body('prompt')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Prompt must be between 1 and 2000 characters')
    .trim()
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { prompt } = req.body;

    logger.info(`Received direct model query: ${prompt.substring(0, 100)}...`);

    // Invoke model directly
    const response = await bedrockService.invokeModel(prompt);

    res.json({
      success: true,
      data: {
        answer: response,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Direct model query error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process direct query',
      message: error.message
    });
  }
});

/**
 * Get chat session info
 * GET /api/chat/session/:sessionId
 */
router.get('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  res.json({
    success: true,
    data: {
      sessionId,
      status: 'active',
      createdAt: new Date().toISOString(),
      messageCount: 0 // Placeholder - would track in real implementation
    }
  });
});

/**
 * Test knowledge base connectivity
 * GET /api/chat/test
 */
router.get('/test', async (req, res) => {
  try {
    const testQuery = "What information is available in the knowledge base?";
    
    logger.info('Testing knowledge base connectivity...');
    
    const response = await bedrockService.queryKnowledgeBase(testQuery, 'test-session');
    
    res.json({
      success: true,
      message: 'Knowledge base test successful',
      data: {
        query: testQuery,
        answer: response.answer,
        sources: response.sources,
        sessionId: response.sessionId,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Knowledge base test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Knowledge base test failed',
      message: error.message,
      details: {
        knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
        region: process.env.AWS_REGION
      }
    });
  }
});

/**
 * Get available models
 * GET /api/chat/models
 */
router.get('/models', (req, res) => {
  res.json({
    success: true,
    models: [
      {
        id: 'anthropic.claude-3-sonnet-20240229-v1:0',
        name: 'Claude 3 Sonnet',
        description: 'High-performance model for complex reasoning',
        default: true
      },
      {
        id: 'anthropic.claude-3-haiku-20240307-v1:0',
        name: 'Claude 3 Haiku',
        description: 'Fast and efficient model for quick responses',
        default: false
      }
    ]
  });
});

module.exports = router;