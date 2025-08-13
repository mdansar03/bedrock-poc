const express = require('express');
const { body, validationResult, query } = require('express-validator');
const bedrockAgentService = require('../services/bedrockAgentService');
const agentSetupUtility = require('../utils/agentSetup');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * /api/chat/agent:
 *   post:
 *     summary: Chat with Bedrock Agent
 *     description: Query the knowledge base using AWS Bedrock Agent for intelligent responses based on stored documents
 *     tags: [Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AgentMessage'
 *           examples:
 *             knowledgeQuery:
 *               summary: Knowledge base query
 *               value:
 *                 message: "What are the system requirements for installation?"
 *                 sessionId: "agent-session-001"
 *                 options:
 *                   useEnhancement: true
 *                   sessionConfig:
 *                     enableTrace: false
 *             technicalQuery:
 *               summary: Technical documentation query
 *               value:
 *                 message: "How do I configure the API endpoints?"
 *                 options:
 *                   useEnhancement: true
 *     responses:
 *       200:
 *         description: Successfully generated agent response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     response:
 *                       type: string
 *                       example: "Based on the documentation, the system requirements are..."
 *                     sessionId:
 *                       type: string
 *                       example: "agent-session-001"
 *                     trace:
 *                       type: object
 *                       description: "Optional trace information (if enabled)"
 *                     sources:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           documentId:
 *                             type: string
 *                           relevanceScore:
 *                             type: number
 *                           excerpt:
 *                             type: string
 *                     processingTime:
 *                       type: string
 *                       example: "3.2s"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', [
  body('message')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters')
    .trim(),
  body('sessionId')
    .optional()
    .isString()
    .withMessage('Session ID must be a string'),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object'),
  body('options.useEnhancement')
    .optional()
    .isBoolean()
    .withMessage('Use enhancement must be a boolean'),
  body('options.sessionConfig')
    .optional()
    .isObject()
    .withMessage('Session config must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { 
      message, 
      sessionId = null, 
      options = {} 
    } = req.body;

    logger.info(`Received agent query: ${message.substring(0, 100)}...`);
    if (sessionId) {
      logger.info(`Using session ID: ${sessionId}`);
    }

    // Invoke the Bedrock Agent
    const response = await bedrockAgentService.invokeAgent(message, sessionId, options);

    res.json({
      success: true,
      data: {
        answer: response.answer,
        citations: response.citations,
        sessionId: response.sessionId,
        analysis: response.analysis,
        session: response.session,
        metadata: response.metadata,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Agent query error:', error);
    
    // Provide specific error handling
    if (error.message.includes('Agent not found')) {
      return res.status(404).json({
        success: false,
        error: 'Agent not configured',
        message: 'Bedrock Agent is not properly configured. Please check BEDROCK_AGENT_ID.',
        setupRequired: true
      });
    }
    
    if (error.message.includes('Access denied')) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'Insufficient permissions to access Bedrock Agent. Please check IAM permissions.',
        setupRequired: true
      });
    }
    
    if (error.message.includes('throttled')) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Agent requests are being throttled. Please try again in a moment.',
        retryAfter: 5
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to process agent query',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/chat/agent/info:
 *   get:
 *     summary: Get agent information
 *     description: Retrieve detailed information about the Bedrock Agent and current session summary
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Successfully retrieved agent information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     agent:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         status:
 *                           type: string
 *                         knowledgeBaseId:
 *                           type: string
 *                     sessions:
 *                       type: object
 *                       properties:
 *                         active:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/info', async (req, res) => {
  try {
    const agentInfo = await bedrockAgentService.getAgentInfo();
    const sessionsSummary = bedrockAgentService.getSessionsSummary();
    
    res.json({
      success: true,
      data: {
        agent: agentInfo,
        sessions: sessionsSummary,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error fetching agent info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch agent information',
      message: error.message
    });
  }
});

/**
 * Test agent connectivity and functionality
 * GET /api/chat/agent/test
 */
router.get('/test', async (req, res) => {
  try {
    logger.info('Testing agent connectivity...');
    
    const testResult = await bedrockAgentService.testAgent();
    
    if (testResult.success) {
      res.json({
        success: true,
        message: 'Agent test successful',
        data: testResult
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Agent test failed',
        data: testResult
      });
    }

  } catch (error) {
    logger.error('Agent test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Agent test failed',
      message: error.message
    });
  }
});

/**
 * Get agent health status
 * GET /api/chat/agent/health
 */
router.get('/health', async (req, res) => {
  try {
    const healthStatus = await bedrockAgentService.healthCheck();
    
    if (healthStatus.healthy) {
      res.json({
        success: true,
        status: 'healthy',
        data: healthStatus
      });
    } else {
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        data: healthStatus
      });
    }

  } catch (error) {
    logger.error('Agent health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Get active sessions information
 * GET /api/chat/agent/sessions
 */
router.get('/sessions', (req, res) => {
  try {
    const sessionsSummary = bedrockAgentService.getSessionsSummary();
    
    res.json({
      success: true,
      data: sessionsSummary
    });

  } catch (error) {
    logger.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions information',
      message: error.message
    });
  }
});

/**
 * Setup and configuration endpoints
 */

/**
 * Create a new Bedrock Agent
 * POST /api/chat/agent/setup
 */
router.post('/setup', [
  body('agentName')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('Agent name must be between 1 and 100 characters'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('instructions')
    .optional()
    .isString()
    .withMessage('Instructions must be a string')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const config = req.body;
    
    logger.info('Starting agent setup with configuration:', config);
    
    const setupResult = await agentSetupUtility.setupComplete(config);
    
    if (setupResult.success) {
      res.json({
        success: true,
        message: 'Agent setup completed successfully',
        data: setupResult
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Agent setup failed',
        message: setupResult.error
      });
    }

  } catch (error) {
    logger.error('Agent setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to setup agent',
      message: error.message
    });
  }
});

/**
 * List existing agents
 * GET /api/chat/agent/list
 */
router.get('/list', async (req, res) => {
  try {
    const maxResults = parseInt(req.query.maxResults) || 50;
    
    const agents = await agentSetupUtility.listAgents(maxResults);
    
    res.json({
      success: true,
      data: {
        agents,
        count: agents.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error listing agents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list agents',
      message: error.message
    });
  }
});

/**
 * Check agent status
 * GET /api/chat/agent/status/:agentId
 */
router.get('/status/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    
    const status = await agentSetupUtility.checkAgentStatus(agentId);
    
    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Error checking agent status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check agent status',
      message: error.message
    });
  }
});

/**
 * Update agent configuration
 * PUT /api/chat/agent/:agentId
 */
router.put('/:agentId', [
  body('agentName')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('Agent name must be between 1 and 100 characters'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('instructions')
    .optional()
    .isString()
    .withMessage('Instructions must be a string')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { agentId } = req.params;
    const updates = req.body;
    
    logger.info(`Updating agent ${agentId} with:`, updates);
    
    const updatedAgent = await agentSetupUtility.updateAgent(agentId, updates);
    
    res.json({
      success: true,
      message: 'Agent updated successfully',
      data: updatedAgent
    });

  } catch (error) {
    logger.error('Agent update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update agent',
      message: error.message
    });
  }
});

/**
 * Generate environment configuration for current agent
 * GET /api/chat/agent/config
 */
router.get('/config', async (req, res) => {
  try {
    const agentInfo = await bedrockAgentService.getAgentInfo();
    
    if (!agentInfo.configured) {
      return res.status(404).json({
        success: false,
        error: 'No agent configured',
        message: 'No Bedrock Agent is currently configured. Please run setup first.'
      });
    }

    const envVars = agentSetupUtility.generateEnvVars({
      agentId: agentInfo.agentId,
      agentAliasId: agentInfo.agentAliasId,
      agentName: agentInfo.agentName
    });

    res.json({
      success: true,
      data: {
        environmentVariables: envVars,
        currentConfig: agentInfo,
        instructions: [
          'Copy the environment variables to your .env file',
          'Restart your application to load the new configuration',
          'Test the agent using /api/chat/agent/test',
          'Update your frontend to use agent endpoints instead of direct knowledge base calls'
        ]
      }
    });

  } catch (error) {
    logger.error('Error generating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate configuration',
      message: error.message
    });
  }
});

module.exports = router;