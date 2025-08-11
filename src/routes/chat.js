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
 * Get available enhancement options and their descriptions
 * GET /api/chat/enhancement-options
 */
router.get('/enhancement-options', (req, res) => {
  res.json({
    success: true,
    data: {
      responseTypes: {
        auto: {
          description: 'Automatically detect query intent and optimize response style',
          default: true
        },
        general: {
          description: 'General-purpose responses with balanced detail and structure',
          default: false
        },
        technical: {
          description: 'Technical responses with code examples and implementation details',
          default: false
        },
        business: {
          description: 'Business-focused responses with strategic insights and ROI considerations',
          default: false
        }
      },
      options: {
        includeExamples: {
          type: 'boolean',
          default: true,
          description: 'Include relevant examples, code snippets, or use cases in responses'
        },
        requestElaboration: {
          type: 'boolean',
          default: true,
          description: 'Request detailed explanations with comprehensive context'
        },
        structureResponse: {
          type: 'boolean',
          default: true,
          description: 'Structure responses with clear sections and organized formatting'
        },
        includeContext: {
          type: 'boolean',
          default: true,
          description: 'Include relevant background context and related information'
        },
        maxTokens: {
          type: 'number',
          default: 2000,
          range: [100, 4000],
          description: 'Maximum number of tokens for response generation (direct model only)'
        },
        temperature: {
          type: 'number',
          default: 0.7,
          range: [0, 1],
          description: 'Response creativity level - lower for focused answers, higher for creative responses'
        }
      }
    }
  });
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
    .withMessage('Model must be a string'),
  body('enhancementOptions')
    .optional()
    .isObject()
    .withMessage('Enhancement options must be an object'),
  body('enhancementOptions.responseType')
    .optional()
    .isIn(['auto', 'general', 'technical', 'business'])
    .withMessage('Response type must be auto, general, technical, or business'),
  body('enhancementOptions.includeExamples')
    .optional()
    .isBoolean()
    .withMessage('Include examples must be a boolean'),
  body('enhancementOptions.requestElaboration')
    .optional()
    .isBoolean()
    .withMessage('Request elaboration must be a boolean'),
  body('enhancementOptions.structureResponse')
    .optional()
    .isBoolean()
    .withMessage('Structure response must be a boolean')
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

    const { 
      message, 
      sessionId = null, 
      model = null, 
      enhancementOptions = {} 
    } = req.body;

    logger.info(`Received chat query: ${message.substring(0, 100)}...`);
    if (model) {
      logger.info(`Using model: ${model}`);
    }
    if (Object.keys(enhancementOptions).length > 0) {
      logger.info(`Enhancement options:`, enhancementOptions);
    }

    // Query the knowledge base with selected model and enhancement options
    const response = await bedrockService.queryKnowledgeBase(message, sessionId, model, enhancementOptions);

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
    
    // Check if this is a rate limiting error
    const isRateLimitError = error.message?.includes('rate limiting') || 
                            error.message?.includes('too high') ||
                            error.message?.includes('throttling');
    
    if (isRateLimitError) {
      const queueStatus = bedrockService.getQueueStatus();
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please wait and try again.',
        retryAfter: Math.ceil(queueStatus.minInterval / 1000), // seconds
        queueInfo: {
          position: queueStatus.queueLength + 1,
          estimatedWait: queueStatus.queueLength * queueStatus.minInterval
        }
      });
    }
    
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
    .trim(),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string'),
  body('enhancementOptions')
    .optional()
    .isObject()
    .withMessage('Enhancement options must be an object')
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

    const { 
      prompt, 
      model = null, 
      enhancementOptions = {} 
    } = req.body;

    logger.info(`Received direct model query: ${prompt.substring(0, 100)}...`);
    if (model) {
      logger.info(`Using model: ${model}`);
    }
    if (Object.keys(enhancementOptions).length > 0) {
      logger.info(`Enhancement options:`, enhancementOptions);
    }

    // Invoke model directly with enhancements
    const response = await bedrockService.invokeModel(prompt, model, enhancementOptions);

    res.json({
      success: true,
      data: {
        answer: response,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Direct model query error:', error);
    
    // Check if this is a rate limiting error
    const isRateLimitError = error.message?.includes('rate limiting') || 
                            error.message?.includes('too high') ||
                            error.message?.includes('throttling');
    
    if (isRateLimitError) {
      const queueStatus = bedrockService.getQueueStatus();
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please wait and try again.',
        retryAfter: Math.ceil(queueStatus.minInterval / 1000), // seconds
        queueInfo: {
          position: queueStatus.queueLength + 1,
          estimatedWait: queueStatus.queueLength * queueStatus.minInterval
        }
      });
    }
    
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

/**
 * Get Bedrock service status and rate limiting information
 * GET /api/chat/status
 */
router.get('/status', (req, res) => {
  try {
    const queueStatus = bedrockService.getQueueStatus();
    const isRateLimited = bedrockService.isRateLimited();
    
    res.json({
      success: true,
      data: {
        status: isRateLimited ? 'rate-limited' : 'ready',
        isRateLimited,
        queue: {
          length: queueStatus.queueLength,
          running: queueStatus.runningRequests,
          maxConcurrent: queueStatus.maxConcurrent,
          minInterval: queueStatus.minInterval
        },
        timing: {
          lastRequestTime: queueStatus.lastRequestTime,
          timeSinceLastRequest: queueStatus.timeSinceLastRequest,
          canMakeRequest: queueStatus.timeSinceLastRequest >= queueStatus.minInterval
        },
        retryConfig: queueStatus.retryConfig,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting Bedrock status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get service status',
      message: error.message
    });
  }
});

module.exports = router;