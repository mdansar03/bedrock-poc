const express = require('express');
const { body, validationResult, query } = require('express-validator');
const bedrockAgentService = require('../services/bedrockAgentService');
const agentSetupUtility = require('../utils/agentSetup');
const actionGroupService = require('../services/actionGroupService');
const DataManagementService = require('../services/dataManagementService');
const dataSourceValidator = require('../utils/dataSourceValidator');
const logger = require('../utils/logger');

// Initialize data management service for validation
const dataManagementService = new DataManagementService();
dataSourceValidator.setDataManagementService(dataManagementService);

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
 *                 instructionType: "technical"
 *                 customInstructions: 
 *                   response_style: "Detailed technical documentation with examples"
 *                 history:
 *                   enabled: true
 *                   maxMessages: 6
 *                   contextWeight: "balanced"
 *                 userId: "user-001"
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
    .custom((value) => {
      // Allow null, undefined, or string values
      if (value === null || value === undefined || typeof value === 'string') {
        return true;
      }
      throw new Error('Session ID must be a string or null');
    }),
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
    .custom((value) => {
      // Allow null, undefined, or string values
      if (value === null || value === undefined || typeof value === 'string') {
        return true;
      }
      throw new Error('Model must be a string or null');
    }),
  body('temperature')
    .custom((value) => {
      // Allow null, undefined, or valid float values
      if (value === null || value === undefined) {
        return true;
      }
      if (typeof value === 'number' && value >= 0.0 && value <= 1.0) {
        return true;
      }
      throw new Error('Temperature must be a number between 0.0 and 1.0 or null');
    }),
  body('topP')
    .custom((value) => {
      // Allow null, undefined, or valid float values
      if (value === null || value === undefined) {
        return true;
      }
      if (typeof value === 'number' && value >= 0.0 && value <= 1.0) {
        return true;
      }
      throw new Error('Top P must be a number between 0.0 and 1.0 or null');
    }),
  // systemPrompt validation removed - now using Professional Instructions instead
  body('history.enabled')
    .optional()
    .isBoolean()
    .withMessage('History enabled must be a boolean'),
  body('history.maxMessages')
    .optional()
    .isInt({ min: 2, max: 20 })
    .withMessage('History maxMessages must be between 2 and 20'),
  body('history.contextWeight')
    .optional()
    .isIn(['light', 'balanced', 'heavy'])
    .withMessage('History contextWeight must be light, balanced, or heavy'),
  body('conversationHistory')
    .optional()
    .isArray()
    .withMessage('Conversation history must be an array'),
  body('conversationHistory.*.role')
    .optional()
    .isIn(['user', 'assistant'])
    .withMessage('Each history message role must be either user or assistant'),
  body('conversationHistory.*.content')
    .optional()
    .isString()
    .withMessage('Each history message content must be between 1 and 4000 characters'),
  body('conversationHistory.*.timestamp')
    .optional()
    .isISO8601()
    .withMessage('Each history message timestamp must be a valid ISO 8601 date'),
  body('userId')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('User ID must be between 1 and 100 characters')
    .trim(),
  body('instructionType')
    .optional()
    .isIn(['default', 'business', 'technical', 'customer_service', 'concise', 'detailed'])
    .withMessage('Instruction type must be one of: default, business, technical, customer_service, concise, detailed'),
  body('customInstructions')
    .optional()
    .isObject()
    .withMessage('Custom instructions must be an object'),
  body('customInstructions.response_style')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Response style instruction must be less than 500 characters'),
  body('customInstructions.context_usage')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Context usage instruction must be less than 500 characters'),
  body('customInstructions.tone')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Tone instruction must be less than 200 characters')
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
      history = {},
      conversationHistory = null,
      userId = null,
      instructionType = 'default',
      customInstructions = {}
    } = req.body;

    logger.info(`Received agent query: ${message.substring(0, 100)}...`);
    if (sessionId) {
      logger.info(`Using session ID: ${sessionId}`);
    }
    if (userId) {
      logger.info(`Using user ID: ${userId}`);
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
    
    // System prompt logging removed - now using Professional Instructions instead

    // Log history settings if provided
    if (Object.keys(history).length > 0) {
      logger.info('Conversation history settings:', {
        enabled: history.enabled !== false, // Default to true
        maxMessages: history.maxMessages || 6,
        contextWeight: history.contextWeight || 'balanced'
      });
    }
    
    // Log conversation history payload if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      logger.info('Direct conversation history provided:', {
        messageCount: conversationHistory.length,
        messages: conversationHistory.map(msg => ({
          role: msg.role,
          contentLength: msg.content?.length || 0,
          timestamp: msg.timestamp
        }))
      });
    }

    // Validate and normalize data sources if provided
    let validatedDataSources = null;
    let dataSourceWarnings = [];
    let sourceFilteringInfo = null;

    if (dataSources) {
      try {
        const validationResult = await dataSourceValidator.validateDataSources(dataSources);
        validatedDataSources = validationResult.validatedDataSources;
        dataSourceWarnings = validationResult.warnings || [];

        sourceFilteringInfo = {
          originalCount: validationResult.originalCount || 0,
          validatedCount: validationResult.sourceCount || 0,
          filteringApplied: !!validatedDataSources,
          warnings: dataSourceWarnings
        };

        if (validatedDataSources) {
          logger.info('Data source filtering will be applied:', {
            websites: validatedDataSources.websites?.length || 0,
            pdfs: validatedDataSources.pdfs?.length || 0,
            documents: validatedDataSources.documents?.length || 0,
            originalSources: validationResult.originalCount,
            validSources: validationResult.sourceCount
          });
        } else if (validationResult.originalCount > 0) {
          logger.warn('No valid data sources found, filtering disabled');
        }
      } catch (validationError) {
        logger.error('Data source validation failed:', validationError);
        dataSourceWarnings.push(`Data source validation failed: ${validationError.message}`);
        // Continue without filtering if validation fails
      }
    }

    // Log professional instruction settings
    if (instructionType !== 'default') {
      logger.info(`Using professional instruction type: ${instructionType}`);
    }
    if (Object.keys(customInstructions).length > 0) {
      logger.info('Custom professional instructions provided:', {
        keys: Object.keys(customInstructions),
        customCount: Object.keys(customInstructions).length
      });
    }

    // Enhanced options to include data source filtering, inference parameters, history settings, conversation history, user ID, and professional instructions
    const enhancedOptions = {
      ...options,
      dataSources: validatedDataSources, // Use validated data sources for filtering
      model: model,
      temperature: temperature,
      topP: topP,
      conversationHistory: conversationHistory, // NEW: Pass direct conversation history
      userId: userId, // NEW: Pass user ID for context enhancement
      instructionType: instructionType, // NEW: Professional instruction type
      customInstructions: customInstructions, // NEW: Custom professional instructions
      history: {
        enabled: history.enabled !== false, // Default to true
        maxMessages: history.maxMessages || 6,
        contextWeight: history.contextWeight || 'balanced',
        ...history
      }
    };

    console.log(enhancedOptions, "Enhanced Options ===================>");

    // Fetch the latest agent alias ID from action groups
    let latestAlias;
    try {
      latestAlias = await actionGroupService.getLatestAgentAlias();
      if (!latestAlias || !latestAlias.aliasId) {
        throw new Error('No latest alias found or aliasId missing');
      }
      logger.info(`Using latest agent alias: ${latestAlias.aliasId} (${latestAlias.aliasName || 'Unnamed'})`);
    } catch (aliasError) {
      logger.error('Failed to fetch latest agent alias:', aliasError);
      return res.status(503).json({
        success: false,
        error: 'Service configuration error',
        message: 'Unable to fetch the latest agent alias. Please check action group configuration.',
        setupRequired: true
      });
    }

    // Add the fetched alias ID to enhanced options
    enhancedOptions.agentAliasId = latestAlias.aliasId;

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
        // Enhanced filtering information
        dataSourceFiltering: sourceFilteringInfo,
        dataSourceWarnings: dataSourceWarnings.length > 0 ? dataSourceWarnings : undefined,
        appliedFilters: validatedDataSources || null, // Use validated data sources
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
    const serviceSummary = bedrockAgentService.getServiceSummary();
    
    res.json({
      success: true,
      data: {
        agent: agentInfo,
        service: serviceSummary,
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

// History-related endpoints removed - now using direct conversation history payload

/**
 * Get all active sessions with their metadata
 * GET /api/chat/agent/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const sessions = Array.from(bedrockAgentService.activeSessions.entries()).map(([id, session]) => ({
      sessionId: id,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivity: new Date(session.lastActivity).toISOString(),
      messageCount: session.messageCount,
      conversationLength: session.conversationHistory?.length || 0,
      topics: session.context?.topics?.slice(-3) || [],
      metadata: session.historyMetadata,
      sessionAge: Date.now() - session.createdAt
    }));

    // Sort by last activity (most recent first)
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    res.json({
      success: true,
      data: {
        sessions,
        totalSessions: sessions.length,
        activeSessions: sessions.filter(s => Date.now() - new Date(s.lastActivity) < 30 * 60 * 1000).length // Active in last 30 minutes
      }
    });

  } catch (error) {
    logger.error('Error retrieving sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve sessions',
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
      BEDROCK_KNOWLEDGE_BASE_ID: !!process.env.BEDROCK_KNOWLEDGE_BASE_ID
    };

    const missingEnvVars = Object.entries(envCheck)
      .filter(([key, hasValue]) => !hasValue)
      .map(([key]) => key);

    const isConfigured = missingEnvVars.length === 0;

    res.json({
      success: true,
      data: {
        configured: isConfigured,
        environmentVariables: envCheck,
        missingRequired: missingEnvVars,
        agentValues: {
          agentId: process.env.BEDROCK_AGENT_ID ? `${process.env.BEDROCK_AGENT_ID.substring(0, 8)}...` : null,
          agentAliasId: 'Dynamically fetched from action groups API',
          knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID ? `${process.env.BEDROCK_KNOWLEDGE_BASE_ID.substring(0, 8)}...` : null,
          region: process.env.AWS_REGION || 'us-east-1 (default)'
        },
        recommendations: isConfigured 
          ? ['Configuration looks good! Agent alias is dynamically fetched from action groups. Try testing the agent.']
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