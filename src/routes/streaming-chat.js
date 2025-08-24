const express = require('express');
const { body, validationResult } = require('express-validator');
const bedrockAgentService = require('../services/bedrockAgentService');
const bedrockService = require('../services/bedrockService');
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
 * /api/streaming-chat/agent:
 *   post:
 *     summary: Stream chat with Bedrock Agent (Server-Sent Events)
 *     description: Stream real-time responses from AWS Bedrock Agent using Server-Sent Events. Returns immediate streaming response chunks as they're generated.
 *     tags: [Streaming Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "What are the system requirements for installation?"
 *                 description: "The user's question or message"
 *               sessionId:
 *                 type: string
 *                 example: "streaming-session-001"
 *                 description: "Optional session ID for conversation continuity"
 *               dataSources:
 *                 type: object
 *                 description: "Optional data source filtering"
 *                 properties:
 *                   websites:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["docs.example.com"]
 *                   pdfs:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["user-manual"]
 *                   documents:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["specs-doc"]
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Foundation model to use for inference"
 *               temperature:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.7
 *                 description: "Controls randomness in response generation"
 *               topP:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.9
 *                 description: "Controls nucleus sampling probability"
 *               instructionType:
 *                 type: string
 *                 enum: [default, business, technical, customer_service, concise, detailed]
 *                 example: "business"
 *                 description: "Type of professional instructions to apply"
 *               customInstructions:
 *                 type: object
 *                 description: "Custom professional instruction overrides"
 *               history:
 *                 type: object
 *                 description: "Conversation history configuration"
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                     example: true
 *                     description: "Enable conversation history"
 *                   maxMessages:
 *                     type: integer
 *                     minimum: 2
 *                     maximum: 20
 *                     example: 6
 *                     description: "Maximum messages to include in history"
 *                   contextWeight:
 *                     type: string
 *                     enum: [light, balanced, heavy]
 *                     example: "balanced"
 *                     description: "Weight of conversation context"
 *               options:
 *                 type: object
 *                 properties:
 *                   useEnhancement:
 *                     type: boolean
 *                     example: true
 *                   sessionConfig:
 *                     type: object
 *     responses:
 *       200:
 *         description: Streaming response using Server-Sent Events
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 event: start
 *                 data: {"sessionId": "streaming-session-001", "timestamp": "2024-01-15T10:30:00Z"}
 *                 
 *                 event: chunk
 *                 data: {"content": "Based on the documentation, the system requirements"}
 *                 
 *                 event: chunk
 *                 data: {"content": " include at least 8GB of RAM and"}
 *                 
 *                 event: citation
 *                 data: {"source": {"title": "System Requirements", "url": "https://docs.example.com/requirements"}}
 *                 
 *                 event: end
 *                 data: {"complete": true, "totalTime": "3.2s", "tokensUsed": 150}
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
router.post('/agent', [
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
  body('instructionType')
    .optional()
    .isIn(['default', 'business', 'technical', 'customer_service', 'concise', 'detailed'])
    .withMessage('Instruction type must be one of: default, business, technical, customer_service, concise, detailed'),
  body('customInstructions')
    .optional()
    .isObject()
    .withMessage('Custom instructions must be an object'),
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
    .isLength({ min: 1, max: 4000 })
    .withMessage('Each history message content must be between 1 and 4000 characters'),
  body('conversationHistory.*.timestamp')
    .optional()
    .isISO8601()
    .withMessage('Each history message timestamp must be a valid ISO 8601 date')
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
      model = null,
      temperature = null,
      topP = null,
      instructionType = 'default',
      customInstructions = {},
      history = {},
      options = {},
      conversationHistory = null
    } = req.body;

    logger.info(`🚀 STARTING TRUE AWS AGENT STREAMING: ${message.substring(0, 100)}...`);
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
    if (instructionType !== 'default') {
      logger.info(`Using professional instruction type: ${instructionType}`);
    }
    if (Object.keys(customInstructions).length > 0) {
      logger.info('Custom professional instructions provided for streaming:', {
        keys: Object.keys(customInstructions)
      });
    }

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
      logger.info('Direct conversation history provided for streaming:', {
        messageCount: conversationHistory.length,
        messages: conversationHistory.map(msg => ({
          role: msg.role,
          contentLength: msg.content?.length || 0,
          timestamp: msg.timestamp
        }))
      });
    }

    // Log data source filtering if provided
    if (dataSources) {
      logger.info('Data source filters applied:', {
        websites: dataSources.websites?.length || 0,
        pdfs: dataSources.pdfs?.length || 0,
        documents: dataSources.documents?.length || 0
      });
    }

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial event
    const sessionIdToUse = sessionId || `agent-streaming-${Date.now()}`;
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({
      sessionId: sessionIdToUse,
      timestamp: new Date().toISOString(),
      message: message,
      streamingType: 'true-aws-agent-streaming'
    })}\n\n`);

    const startTime = Date.now();

    try {
      // Enhanced options to include all parameters like non-streaming endpoint
      const enhancedOptions = {
        ...options,
        dataSources: dataSources,
        model: model,
        temperature: temperature,
        topP: topP,
        instructionType: instructionType,
        customInstructions: customInstructions,
        conversationHistory: conversationHistory, // NEW: Pass direct conversation history for streaming
        history: {
          enabled: history.enabled !== false, // Default to true
          maxMessages: history.maxMessages || 6,
          contextWeight: history.contextWeight || 'balanced',
          ...history
        }
      };

      // Fetch the latest agent alias ID from action groups
      let latestAlias;
      try {
        latestAlias = await actionGroupService.getLatestAgentAlias();
        if (!latestAlias || !latestAlias.aliasId) {
          throw new Error('No latest alias found or aliasId missing');
        }
        logger.info(`Using latest agent alias for streaming: ${latestAlias.aliasId} (${latestAlias.aliasName || 'Unnamed'})`);
      } catch (aliasError) {
        logger.error('Failed to fetch latest agent alias for streaming:', aliasError);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({
          error: 'Service configuration error: Unable to fetch the latest agent alias. Please check action group configuration.',
          timestamp: new Date().toISOString()
        })}\n\n`);
        res.end();
        return;
      }

      // Add the fetched alias ID to enhanced options
      enhancedOptions.agentAliasId = latestAlias.aliasId;

      // Use bedrockAgentService streaming method (aligned with non-streaming approach)
      let fullContent = "";
      let sources = [];
      let metadata = {};
      let chunkCount = 0;

      await bedrockAgentService.invokeAgentStreaming(
        message,
        sessionId,
        enhancedOptions,
        {
          // Real-time chunk handler
          onChunk: (chunk) => {
            chunkCount++;
            fullContent += chunk;
            
            logger.info("🎯 AGENT STREAMING CHUNK:", {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              chunkNumber: chunkCount,
              timestamp: new Date().toISOString()
            });
            
            // Send chunk immediately to frontend
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          },
          
          // Citation handler
          onCitation: (citation) => {
            sources.push(citation);
            logger.info("📄 AGENT CITATION:", citation);
            
            // Send citation to frontend
            res.write(`event: citation\n`);
            res.write(`data: ${JSON.stringify({ source: citation })}\n\n`);
          },
          
          // Metadata handler
          onMetadata: (meta) => {
            metadata = { ...metadata, ...meta };
            logger.info("🔍 AGENT METADATA:", meta);
            
            // Send metadata to frontend
            res.write(`event: metadata\n`);
            res.write(`data: ${JSON.stringify(meta)}\n\n`);
          },
          
          // Completion handler
          onComplete: (finalData) => {
            const totalTime = Date.now() - startTime;
            
            logger.info(`🎉 AGENT STREAMING COMPLETED: ${chunkCount} chunks, ${fullContent.length} chars, ${totalTime}ms`);
            
            // Send completion event
            res.write(`event: end\n`);
            res.write(`data: ${JSON.stringify({
              complete: true,
              sessionId: finalData.sessionId || sessionIdToUse,
              totalTime: `${totalTime}ms`,
              totalChunks: chunkCount,
              streamingType: 'bedrock-agent-streaming',
              tokensUsed: finalData.tokensUsed || 0,
              sources: sources,
              metadata: {
                ...metadata,
                ...finalData.metadata
              }
            })}\n\n`);
            res.end();
          },
          
          // Error handler
          onError: (error) => {
            logger.error('❌ AGENT STREAMING ERROR:', error);
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
              error: `Agent streaming error: ${error.message}`,
              timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
          }
        }
      );
      
    } catch (error) {
      logger.error('❌ AGENT STREAMING SETUP FAILED:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        error: `Agent streaming setup failed: ${error.message}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('❌ STREAMING INITIALIZATION FAILED:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize streaming',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/streaming-chat/direct:
 *   post:
 *     summary: Stream direct chat with foundation models (Server-Sent Events)
 *     description: Stream real-time responses directly from foundation models using Server-Sent Events, bypassing agents and knowledge base.
 *     tags: [Streaming Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "Explain quantum computing in simple terms"
 *                 description: "The user's message or prompt"
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Foundation model to use"
 *               temperature:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.7
 *               topP:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.9
 *               maxTokens:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 4000
 *                 example: 1000
 *                 description: "Maximum number of tokens to generate"
 *     responses:
 *       200:
 *         description: Streaming response using Server-Sent Events
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 event: start
 *                 data: {"model": "anthropic.claude-3-sonnet-20240229-v1:0", "timestamp": "2024-01-15T10:30:00Z"}
 *                 
 *                 event: chunk
 *                 data: {"content": "Quantum computing is a revolutionary"}
 *                 
 *                 event: chunk
 *                 data: {"content": " technology that uses quantum mechanical"}
 *                 
 *                 event: end
 *                 data: {"complete": true, "totalTime": "2.1s", "tokensUsed": 95}
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/direct', [
  body('message')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters')
    .trim(),
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
  body('maxTokens')
    .optional()
    .isInt({ min: 1, max: 4000 })
    .withMessage('Max tokens must be between 1 and 4000')
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
      model = null,
      temperature = null,
      topP = null,
      maxTokens = null
    } = req.body;

    logger.info(`Starting streaming direct query: ${message.substring(0, 100)}...`);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial event
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({
      model: model || bedrockService.defaultModelId,
      timestamp: new Date().toISOString(),
      message: message
    })}\n\n`);

    try {
      // Use TRUE AWS streaming for direct models
      logger.info("🚀 DIRECT MODE: Using TRUE AWS InvokeModelWithResponseStream API");
      
      const bedrockService = require('../services/bedrockService');
      
      // Use the TRUE streaming method
      const directStartTime = Date.now();
      let directChunkCount = 0;
      let directFullText = "";
      
      await bedrockService.invokeModelStreaming(
        message,
        model,
        {
          temperature,
          topP,
          maxTokens
        },
        {
          // Real-time chunk handler - called as AWS sends each chunk
          onChunk: (chunk) => {
            directChunkCount++;
            const elapsed = Date.now() - directStartTime;
            directFullText += chunk;
            
            console.log(`📦 DIRECT CHUNK #${directChunkCount} (at ${elapsed}ms):`, {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              totalLength: directFullText.length,
              timestamp: new Date().toISOString()
            });
            
            logger.info("🎯 DIRECT MODEL CHUNK:", {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              timestamp: new Date().toISOString()
            });
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          },
          
          // Completion handler
          onComplete: (finalData) => {
            const directTotalTime = Date.now() - directStartTime;
            
            console.log("\n🎉 DIRECT MODEL STREAMING COMPLETED:");
            console.log(`   Total chunks: ${directChunkCount}`);
            console.log(`   Total text length: ${directFullText.length}`);
            console.log(`   Total time: ${directTotalTime}ms`);
            console.log(`   Avg time per chunk: ${directChunkCount > 0 ? (directTotalTime/directChunkCount).toFixed(1) : 0}ms`);
            
            if (directChunkCount > 5 && directFullText.length > 50) {
              console.log("✅ SUCCESS: True character-by-character direct streaming confirmed!");
            } else if (directChunkCount <= 1 && directFullText.length > 50) {
              console.log("❌ BULK RESPONSE: Direct model returned complete text in single chunk");
            } else {
              console.log("⚠️ MIXED: Some streaming but may not be optimal chunk size");
            }
            
            res.write(`event: end\n`);
            res.write(`data: ${JSON.stringify({
              complete: true,
              model: finalData.model,
              totalTime: finalData.totalTime,
              tokensUsed: finalData.tokensUsed,
              streamingType: 'true-aws-streaming' // Indicate this was real streaming
            })}\n\n`);
            res.end();
          },
          
          // Error handler
          onError: (error) => {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
              error: error.message,
              timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
          }
        }
      );
    } catch (error) {
      logger.error('Streaming direct query error:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('Streaming setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize streaming',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/streaming-chat/knowledge-base:
 *   post:
 *     summary: Stream chat with knowledge base (Server-Sent Events)
 *     description: Stream real-time responses from knowledge base using Server-Sent Events with RAG (Retrieval Augmented Generation).
 *     tags: [Streaming Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "What products are available in the electronics category?"
 *                 description: "The user's question about knowledge base content"
 *               sessionId:
 *                 type: string
 *                 example: "kb-streaming-session-001"
 *                 description: "Optional session ID for conversation continuity"
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Foundation model to use"
 *               enhancementOptions:
 *                 type: object
 *                 properties:
 *                   responseType:
 *                     type: string
 *                     enum: [auto, general, technical, business]
 *                     example: "auto"
 *                   includeExamples:
 *                     type: boolean
 *                     example: true
 *                   temperature:
 *                     type: number
 *                     minimum: 0.0
 *                     maximum: 1.0
 *                     example: 0.7
 *     responses:
 *       200:
 *         description: Streaming response using Server-Sent Events
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 event: start
 *                 data: {"sessionId": "kb-streaming-session-001", "model": "claude-3-sonnet", "timestamp": "2024-01-15T10:30:00Z"}
 *                 
 *                 event: sources
 *                 data: {"sources": [{"title": "Electronics Catalog", "url": "https://example.com/catalog", "relevanceScore": 0.95}]}
 *                 
 *                 event: chunk
 *                 data: {"content": "Based on the electronics catalog, we have"}
 *                 
 *                 event: chunk
 *                 data: {"content": " the following products available:"}
 *                 
 *                 event: end
 *                 data: {"complete": true, "totalTime": "2.8s", "tokensUsed": 120, "sourceCount": 3}
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/knowledge-base', [
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
        success: false,
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

    logger.info(`Starting streaming knowledge base query: ${message.substring(0, 100)}...`);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial event
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({
      sessionId: sessionId || `kb-streaming-${Date.now()}`,
      model: model || bedrockService.defaultModelId,
      timestamp: new Date().toISOString(),
      message: message
    })}\n\n`);

    try {
      // Use TRUE AWS streaming for knowledge base
      logger.info("🚀 KNOWLEDGE BASE MODE: Using TRUE AWS RetrieveAndGenerateStream API");
      
      const bedrockService = require('../services/bedrockService');
      
      // Use the TRUE streaming method
      const kbStartTime = Date.now();
      let kbChunkCount = 0;
      let kbFullText = "";
      let kbSourceCount = 0;
      
      await bedrockService.queryKnowledgeBaseStreaming(
        message,
        sessionId,
        model,
        enhancementOptions,
        {
          // Real-time sources handler
          onSources: (sources) => {
            kbSourceCount = sources.length;
            console.log(`📄 KB SOURCES RECEIVED (${sources.length} sources):`, sources.map(s => ({
              title: s.title?.substring(0, 30) || 'Unknown',
              relevanceScore: s.relevanceScore
            })));
            logger.info("📄 KB SOURCES RECEIVED:", { count: sources.length });
            res.write(`event: sources\n`);
            res.write(`data: ${JSON.stringify({ sources })}\n\n`);
          },
          
          // Real-time chunk handler - called as AWS sends each chunk
          onChunk: (chunk) => {
            kbChunkCount++;
            const elapsed = Date.now() - kbStartTime;
            kbFullText += chunk;
            
            // console.log(`📦 KB CHUNK #${kbChunkCount} (at ${elapsed}ms):`, {
            //   length: chunk.length,
            //   preview: chunk.substring(0, 30) + "...",
            //   totalLength: kbFullText.length,
            //   timestamp: new Date().toISOString()
            // });
            
            logger.info("🎯 KB CHUNK:", {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              timestamp: new Date().toISOString()
            });
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          },
          
          // Completion handler
          onComplete: (finalData) => {
            const kbTotalTime = Date.now() - kbStartTime;
            
            console.log("\n🎉 KNOWLEDGE BASE STREAMING COMPLETED:");
            console.log(`   Total chunks: ${kbChunkCount}`);
            console.log(`   Total text length: ${kbFullText.length}`);
            console.log(`   Sources used: ${kbSourceCount}`);
            console.log(`   Total time: ${kbTotalTime}ms`);
            console.log(`   Avg time per chunk: ${kbChunkCount > 0 ? (kbTotalTime/kbChunkCount).toFixed(1) : 0}ms`);
            
            if (kbChunkCount > 5 && kbFullText.length > 50) {
              console.log("✅ SUCCESS: True character-by-character KB streaming confirmed!");
            } else if (kbChunkCount <= 1 && kbFullText.length > 50) {
              console.log("❌ BULK RESPONSE: KB returned complete text in single chunk");
            } else {
              console.log("⚠️ MIXED: Some streaming but may not be optimal chunk size");
            }
            
            res.write(`event: end\n`);
            res.write(`data: ${JSON.stringify({
              complete: true,
              sessionId: finalData.sessionId,
              model: finalData.model,
              totalTime: finalData.totalTime,
              tokensUsed: finalData.tokensUsed,
              sourceCount: finalData.sourceCount,
              streamingType: 'true-aws-kb-streaming' // Indicate this was real streaming
            })}\n\n`);
            res.end();
          },
          
          // Error handler
          onError: (error) => {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
              error: error.message,
              timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
          }
        }
      );
    } catch (error) {
      logger.error('Streaming knowledge base query error:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('Streaming setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize streaming',
      message: error.message
    });
  }
});

module.exports = router;
