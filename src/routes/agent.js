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
 *     summary: Chat with Bedrock Agent with Advanced Configuration
 *     description: Query the knowledge base using AWS Bedrock Agent for intelligent responses with support for custom inference parameters, system prompts, model selection, and data source filtering
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
 *             filteredQuery:
 *               summary: Query with data source filtering
 *               value:
 *                 message: "What does the documentation say about API endpoints?"
 *                 sessionId: "agent-session-002"
 *                 dataSources:
 *                   websites: ["docs.example.com"]
 *                   pdfs: ["api-manual"]
 *                   documents: []
 *                 options:
 *                   useEnhancement: true
 *             technicalQuery:
 *               summary: Technical documentation query
 *               value:
 *                 message: "How do I configure the API endpoints?"
 *                 options:
 *                   useEnhancement: true
 *             customizedQuery:
 *               summary: Query with custom inference parameters
 *               value:
 *                 message: "Explain the system architecture in detail"
 *                 model: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 temperature: 0.7
 *                 topP: 0.9
 *                 systemPrompt: "You are a technical documentation expert. Provide detailed, structured responses with examples."
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
 *                           dataSourceType:
 *                             type: string
 *                             enum: ["website", "pdf", "document"]
 *                     processingTime:
 *                       type: string
 *                       example: "3.2s"
 *                     appliedFilters:
 *                       type: object
 *                       description: "Data source filters that were applied"
 *                       properties:
 *                         websites:
 *                           type: array
 *                           items:
 *                             type: string
 *                         pdfs:
 *                           type: array
 *                           items:
 *                             type: string
 *                         documents:
 *                           type: array
 *                           items:
 *                             type: string
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
  body('dataSources')
    .optional()
    .isObject()
    .withMessage('Data sources must be an object'),
  body('dataSources.websites')
    .optional()
    .isArray()
    .withMessage('Websites must be an array of domain names'),
  body('dataSources.pdfs')
    .optional()
    .isArray()
    .withMessage('PDFs must be an array of file names'),
  body('dataSources.documents')
    .optional()
    .isArray()
    .withMessage('Documents must be an array of file names'),
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
    .withMessage('Session config must be an object'),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string'),
  body('temperature')
    .optional()
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('Temperature must be a number between 0.0 and 1.0'),
  body('topP')
    .optional()
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('Top P must be a number between 0.0 and 1.0'),
  body('systemPrompt')
    .optional()
    .isString()
    .isLength({ min: 1, max: 4000 })
    .withMessage('System prompt must be between 1 and 4000 characters')
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
      dataSources = null,
      options = {},
      model = null,
      temperature = null,
      topP = null,
      systemPrompt = null
    } = req.body;

    logger.info(`Received agent query: ${message.substring(0, 100)}...`);
    if (sessionId) {
      logger.info(`Using session ID: ${sessionId}`);
    }
    
    // Log model selection if provided
    if (model) {
      logger.info(`Using model: ${model}`);
    }
    
    // Log inference parameters if provided
    if (temperature !== null || topP !== null) {
      logger.info('Inference parameters:', {
        temperature,
        topP
      });
    }
    
    // Log system prompt if provided
    if (systemPrompt) {
      logger.info(`System prompt provided: ${systemPrompt.substring(0, 100)}...`);
    }

    // Log data source filtering if provided
    if (dataSources) {
      logger.info('Data source filters applied:', {
        websites: dataSources.websites?.length || 0,
        pdfs: dataSources.pdfs?.length || 0,
        documents: dataSources.documents?.length || 0
      });
    }

    // Enhanced options to include data source filtering and inference parameters
    const enhancedOptions = {
      ...options,
      dataSources: dataSources,
      model: model,
      temperature: temperature,
      topP: topP,
      systemPrompt: systemPrompt
    };

    // Invoke the Bedrock Agent with enhanced options
    const response = await bedrockAgentService.invokeAgent(message, sessionId, enhancedOptions);

    // Log response for debugging
    logger.debug('Agent response structure:', {
      hasAnswer: !!response.answer,
      answerLength: response.answer?.length || 0,
      citationCount: response.citations?.length || 0,
      sessionId: response.sessionId,
      metadataKeys: Object.keys(response.metadata || {}),
      filtersApplied: !!dataSources
    });

    // Map citations to sources format for consistency with enhanced data source info
    const sources = (response.citations || []).map(citation => {
      let source = {
        content: citation.content || citation.text || '',
        metadata: citation.metadata || {},
        documentId: citation.documentId || '',
        relevanceScore: citation.score || 0
      };

      // Enhanced source mapping with data source type detection
      if (citation.retrievedReferences) {
        const reference = citation.retrievedReferences[0];
        source = {
          content: citation.generatedResponsePart?.textResponsePart?.text || '',
          metadata: citation.retrievedReferences || [],
          documentId: reference?.location?.s3Location?.uri || '',
          relevanceScore: reference?.metadata?.score || 0
        };

        // Determine data source type from S3 path
        const s3Uri = reference?.location?.s3Location?.uri || '';
        if (s3Uri.includes('/web-scrapes/')) {
          source.dataSourceType = 'website';
        } else if (s3Uri.includes('/pdfs/')) {
          source.dataSourceType = 'pdf';
        } else if (s3Uri.includes('/documents/')) {
          source.dataSourceType = 'document';
        } else {
          source.dataSourceType = 'unknown';
        }
      }

      return source;
    });

    res.json({
      success: true,
      data: {
        answer: response.answer || '',
        sources: sources,
        sessionId: response.sessionId,
        model: response.metadata?.agentId || 'agent',
        agentMetadata: {
          analysis: response.analysis,
          session: response.session,
          agentId: response.metadata?.agentId,
          responseTime: response.metadata?.responseTime,
          tokensUsed: response.metadata?.tokensUsed
        },
        appliedFilters: dataSources || null,
        method: 'agent',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Agent query error:', error);
    
    // Provide specific error handling
    if (error.message.includes('Agent not found') || error.message.includes('BEDROCK_AGENT_ID is not configured')) {
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

/**
 * Verify environment configuration
 * GET /api/chat/agent/verify
 */
router.get('/verify', (req, res) => {
  try {
    const envCheck = {
      AWS_REGION: !!process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: !!process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: !!process.env.AWS_SECRET_ACCESS_KEY,
      BEDROCK_AGENT_ID: !!process.env.BEDROCK_AGENT_ID,
      BEDROCK_AGENT_ALIAS_ID: !!process.env.BEDROCK_AGENT_ALIAS_ID,
      BEDROCK_KNOWLEDGE_BASE_ID: !!process.env.BEDROCK_KNOWLEDGE_BASE_ID
    };

    const missingEnvVars = Object.entries(envCheck)
      .filter(([key, hasValue]) => !hasValue)
      .map(([key]) => key);

    const isConfigured = missingEnvVars.length === 0 || 
                        (missingEnvVars.length === 1 && missingEnvVars[0] === 'BEDROCK_AGENT_ALIAS_ID');

    res.json({
      success: true,
      data: {
        configured: isConfigured,
        environmentVariables: envCheck,
        missingRequired: missingEnvVars.filter(key => key !== 'BEDROCK_AGENT_ALIAS_ID'),
        agentValues: {
          agentId: process.env.BEDROCK_AGENT_ID ? `${process.env.BEDROCK_AGENT_ID.substring(0, 8)}...` : null,
          agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID (default)',
          knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID ? `${process.env.BEDROCK_KNOWLEDGE_BASE_ID.substring(0, 8)}...` : null,
          region: process.env.AWS_REGION || 'us-east-1 (default)'
        },
        recommendations: isConfigured 
          ? ['Configuration looks good! Try testing the agent.']
          : ['Please set the missing environment variables and restart the server.']
      }
    });

  } catch (error) {
    logger.error('Error verifying environment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify environment',
      message: error.message
    });
  }
});

module.exports = router;