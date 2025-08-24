const express = require("express");
const { body, validationResult, query } = require("express-validator");
const bedrockService = require("../services/bedrockService");
const bedrockAgentService = require("../services/bedrockAgentService");
const DataManagementService = require("../services/dataManagementService");
const dataSourceValidator = require("../utils/dataSourceValidator");
const logger = require("../utils/logger");

// Initialize data management service for validation
const dataManagementService = new DataManagementService();
dataSourceValidator.setDataManagementService(dataManagementService);

const router = express.Router();

/**
 * @swagger
 * /api/chat/models:
 *   get:
 *     summary: Get available foundation models
 *     description: Retrieve a list of all available AI foundation models with their configurations and the default model ID
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Successfully retrieved available models
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
 *                     models:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                           name:
 *                             type: string
 *                             example: "Claude 3 Sonnet"
 *                           provider:
 *                             type: string
 *                             example: "Anthropic"
 *                           maxTokens:
 *                             type: integer
 *                             example: 4096
 *                     defaultModel:
 *                       type: string
 *                       example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/models", async (req, res) => {
  try {
    const models = bedrockService.getAvailableModels();

    res.json({
      success: true,
      data: {
        models,
        defaultModel: bedrockService.defaultModelId,
      },
    });
  } catch (error) {
    logger.error("Error fetching models:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch available models",
      details: error.message,
    });
  }
});

/**
 * @swagger
 * /api/chat/enhancement-options:
 *   get:
 *     summary: Get available enhancement options
 *     description: Retrieve all available response enhancement options and their configurations for customizing AI responses
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Successfully retrieved enhancement options
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
 *                     responseTypes:
 *                       type: object
 *                       properties:
 *                         auto:
 *                           type: object
 *                           properties:
 *                             description:
 *                               type: string
 *                             default:
 *                               type: boolean
 *                         general:
 *                           type: object
 *                           properties:
 *                             description:
 *                               type: string
 *                             default:
 *                               type: boolean
 *                         technical:
 *                           type: object
 *                           properties:
 *                             description:
 *                               type: string
 *                             default:
 *                               type: boolean
 *                         business:
 *                           type: object
 *                           properties:
 *                             description:
 *                               type: string
 *                             default:
 *                               type: boolean
 *                     options:
 *                       type: object
 *                       properties:
 *                         maxTokens:
 *                           type: object
 *                           properties:
 *                             type:
 *                               type: string
 *                               example: "number"
 *                             default:
 *                               type: integer
 *                               example: 2000
 *                             range:
 *                               type: array
 *                               items:
 *                                 type: integer
 *                               example: [100, 4000]
 *                         temperature:
 *                           type: object
 *                           properties:
 *                             type:
 *                               type: string
 *                               example: "number"
 *                             default:
 *                               type: number
 *                               example: 0.7
 *                             range:
 *                               type: array
 *                               items:
 *                                 type: number
 *                               example: [0, 1]
 */
router.get("/enhancement-options", (req, res) => {
  res.json({
    success: true,
    data: {
      responseTypes: {
        auto: {
          description:
            "Automatically detect query intent and optimize response style",
          default: true,
        },
        general: {
          description:
            "General-purpose responses with balanced detail and structure",
          default: false,
        },
        technical: {
          description:
            "Technical responses with code examples and implementation details",
          default: false,
        },
        business: {
          description:
            "Business-focused responses with strategic insights and ROI considerations",
          default: false,
        },
      },
      options: {
        includeExamples: {
          type: "boolean",
          default: true,
          description:
            "Include relevant examples, code snippets, or use cases in responses",
        },
        requestElaboration: {
          type: "boolean",
          default: true,
          description:
            "Request detailed explanations with comprehensive context",
        },
        structureResponse: {
          type: "boolean",
          default: true,
          description:
            "Structure responses with clear sections and organized formatting",
        },
        includeContext: {
          type: "boolean",
          default: true,
          description:
            "Include relevant background context and related information",
        },
        maxTokens: {
          type: "number",
          default: 2000,
          range: [100, 4000],
          description:
            "Maximum number of tokens for response generation (direct model only)",
        },
        temperature: {
          type: "number",
          default: 0.7,
          range: [0, 1],
          description:
            "Response creativity level - lower for focused answers, higher for creative responses",
        },
      },
    },
  });
});

/**
 * @swagger
 * /api/chat/query:
 *   post:
 *     summary: Chat with AI using RAG (Enhanced with Agent Support)
 *     description: Send a message to the AI chatbot with support for enhanced responses, model selection, and optional agent routing
 *     tags: [Chat]
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
 *                 example: "What are the latest AI trends in 2024?"
 *                 description: "The user's question or message"
 *               sessionId:
 *                 type: string
 *                 example: "session-123-456-789"
 *                 description: "Optional session ID for conversation continuity"
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Optional model ID to use for this query"
 *               useAgent:
 *                 type: boolean
 *                 example: true
 *                 description: "Whether to use Bedrock Agent for knowledge base queries"
 *               enhancementOptions:
 *                 type: object
 *                 properties:
 *                   responseType:
 *                     type: string
 *                     enum: [auto, general, technical, business]
 *                     example: "auto"
 *                     description: "Type of response enhancement to apply"
 *                   includeExamples:
 *                     type: boolean
 *                     example: true
 *                     description: "Include examples in the response"
 *                   requestElaboration:
 *                     type: boolean
 *                     example: true
 *                     description: "Request detailed explanations"
 *                   structureResponse:
 *                     type: boolean
 *                     example: true
 *                     description: "Structure response with clear sections"
 *                   includeContext:
 *                     type: boolean
 *                     example: true
 *                     description: "Include relevant background context"
 *                   maxTokens:
 *                     type: integer
 *                     minimum: 100
 *                     maximum: 4000
 *                     example: 2000
 *                     description: "Maximum tokens for response generation"
 *                   temperature:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 1
 *                     example: 0.7
 *                     description: "Response creativity level"
 *           examples:
 *             basicQuery:
 *               summary: Basic query
 *               value:
 *                 message: "What is machine learning?"
 *             enhancedQuery:
 *               summary: Enhanced technical query
 *               value:
 *                 message: "Explain neural networks"
 *                 enhancementOptions:
 *                   responseType: "technical"
 *                   includeExamples: true
 *                   maxTokens: 1500
 *             agentQuery:
 *               summary: Knowledge base query using agent
 *               value:
 *                 message: "Find information about our product specifications"
 *                 useAgent: true
 *                 sessionId: "session-agent-001"
 *     responses:
 *       200:
 *         description: Successfully generated response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
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
router.post(
  "/query",
  [
    body("message")
      .isString()
      .isLength({ min: 1, max: 2000 })
      .withMessage("Message must be between 1 and 2000 characters")
      .trim(),
    body("sessionId")
      .optional()
      .isString()
      .withMessage("Session ID must be a string"),
    body("model").optional().isString().withMessage("Model must be a string"),
    body("useAgent")
      .optional()
      .isBoolean()
      .withMessage("Use agent must be a boolean"),
    body("enhancementOptions")
      .optional()
      .isObject()
      .withMessage("Enhancement options must be an object"),
    body("enhancementOptions.responseType")
      .optional()
      .isIn(["auto", "general", "technical", "business"])
      .withMessage(
        "Response type must be auto, general, technical, or business"
      ),
    body("enhancementOptions.includeExamples")
      .optional()
      .isBoolean()
      .withMessage("Include examples must be a boolean"),
    body("enhancementOptions.requestElaboration")
      .optional()
      .isBoolean()
      .withMessage("Request elaboration must be a boolean"),
    body("enhancementOptions.structureResponse")
      .optional()
      .isBoolean()
      .withMessage("Structure response must be a boolean"),
    body("dataSources")
      .optional()
      .isObject()
      .withMessage("Data sources must be an object"),
    body("dataSources.websites")
      .optional()
      .isArray()
      .withMessage("Websites must be an array of domain names"),
    body("dataSources.pdfs")
      .optional()
      .isArray()
      .withMessage("PDFs must be an array of file names"),
    body("dataSources.documents")
      .optional()
      .isArray()
      .withMessage("Documents must be an array of file names"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const {
        message,
        sessionId = null,
        model = null,
        useAgent = process.env.BEDROCK_AGENT_ID ? true : false, // Default to agent if available
        enhancementOptions = {},
        dataSources = null,
      } = req.body;

      logger.info(`Received chat query: ${message.substring(0, 100)}...`);
      logger.info(
        `Using ${useAgent ? "Agent" : "Direct Knowledge Base"} approach`
      );

      if (model) {
        logger.info(`Using model: ${model}`);
      }
      if (Object.keys(enhancementOptions).length > 0) {
        logger.info(`Enhancement options:`, enhancementOptions);
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

      let response;

      if (useAgent) {
        // Use Bedrock Agent for intelligent knowledge retrieval
        try {
          const agentResponse = await bedrockAgentService.invokeAgent(
            message,
            sessionId,
            {
              useEnhancement: enhancementOptions.useEnhancement !== false,
              sessionConfig: enhancementOptions.sessionConfig || {},
              dataSources: validatedDataSources, // Pass validated data sources for filtering
            }
          );

          response = {
            answer: agentResponse.answer,
            sources: (agentResponse.citations || []).map((citation) => {
              // Handle different citation formats
              if (citation.retrievedReferences) {
                // Standard citation format
                return {
                  content:
                    citation.generatedResponsePart?.textResponsePart?.text ||
                    "",
                  metadata: citation.retrievedReferences || [],
                  documentId:
                    citation.retrievedReferences?.[0]?.location?.s3Location
                      ?.uri || "",
                  relevanceScore:
                    citation.retrievedReferences?.[0]?.metadata?.score || 0,
                };
              } else {
                // Fallback format
                return {
                  content: citation.content || citation.text || "",
                  metadata: citation.metadata || {},
                  documentId: citation.documentId || "",
                  relevanceScore: citation.score || 0,
                };
              }
            }),
            sessionId: agentResponse.sessionId,
            model: agentResponse.metadata?.agentId || "agent",
            agentMetadata: {
              analysis: agentResponse.analysis,
              session: agentResponse.session,
              agentId: agentResponse.metadata?.agentId,
              responseTime: agentResponse.metadata?.responseTime,
              tokensUsed: agentResponse.metadata?.tokensUsed,
            },
            method: "agent",
            // Enhanced filtering information
            dataSourceFiltering: sourceFilteringInfo,
            dataSourceWarnings: dataSourceWarnings.length > 0 ? dataSourceWarnings : undefined,
          };
        } catch (agentError) {
          logger.warn(
            "Agent call failed, falling back to direct knowledge base:",
            agentError.message
          );

          // Fallback to direct knowledge base if agent fails
          const kbResponse = await bedrockService.queryKnowledgeBase(
            message,
            sessionId,
            model,
            enhancementOptions
          );
          response = {
            answer: kbResponse.answer,
            sources: kbResponse.sources,
            sessionId: kbResponse.sessionId,
            model: bedrockService.getModelId(model),
            method: "knowledge_base_fallback",
            fallbackReason: agentError.message,
            // Enhanced filtering information (fallback doesn't support filtering but include warning)
            dataSourceFiltering: validatedDataSources ? { 
              ...sourceFilteringInfo,
              fallbackNote: "Data source filtering not available in fallback mode" 
            } : null,
            dataSourceWarnings: dataSourceWarnings.length > 0 ? [
              ...dataSourceWarnings,
              "Data source filtering unavailable due to agent fallback"
            ] : ["Data source filtering unavailable due to agent fallback"],
          };
        }
      } else {
        // Use direct knowledge base query
        const kbResponse = await bedrockService.queryKnowledgeBase(
          message,
          sessionId,
          model,
          enhancementOptions
        );
        response = {
          answer: kbResponse.answer,
          sources: kbResponse.sources,
          sessionId: kbResponse.sessionId,
          model: bedrockService.getModelId(model),
          method: "knowledge_base",
          // Enhanced filtering information (direct KB doesn't support filtering but include warning)
          dataSourceFiltering: validatedDataSources ? { 
            ...sourceFilteringInfo,
            fallbackNote: "Data source filtering not available in direct knowledge base mode" 
          } : null,
          dataSourceWarnings: dataSourceWarnings.length > 0 ? [
            ...dataSourceWarnings,
            "Data source filtering only available in agent mode"
          ] : validatedDataSources ? ["Data source filtering only available in agent mode"] : undefined,
        };
      }

      res.json({
        success: true,
        data: {
          ...response,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Chat query error:", error);

      // Check if this is a rate limiting error
      const isRateLimitError =
        error.message?.includes("rate limiting") ||
        error.message?.includes("too high") ||
        error.message?.includes("throttling");

      if (isRateLimitError) {
        const queueStatus = bedrockService.getQueueStatus();
        return res.status(429).json({
          success: false,
          error: "Rate limit exceeded",
          message: "Too many requests. Please wait and try again.",
          retryAfter: Math.ceil(queueStatus.minInterval / 1000), // seconds
          queueInfo: {
            position: queueStatus.queueLength + 1,
            estimatedWait: queueStatus.queueLength * queueStatus.minInterval,
          },
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to process chat query",
        message: error.message,
      });
    }
  }
);

/**
 * Direct model invocation (without RAG)
 * POST /api/chat/direct
 */
router.post(
  "/direct",
  [
    body("prompt")
      .isString()
      .isLength({ min: 1, max: 2000 })
      .withMessage("Prompt must be between 1 and 2000 characters")
      .trim(),
    body("model").optional().isString().withMessage("Model must be a string"),
    body("enhancementOptions")
      .optional()
      .isObject()
      .withMessage("Enhancement options must be an object"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { prompt, model = null, enhancementOptions = {} } = req.body;

      logger.info(
        `Received direct model query: ${prompt.substring(0, 100)}...`
      );
      if (model) {
        logger.info(`Using model: ${model}`);
      }
      if (Object.keys(enhancementOptions).length > 0) {
        logger.info(`Enhancement options:`, enhancementOptions);
      }

      // Invoke model directly with enhancements
      const response = await bedrockService.invokeModel(
        prompt,
        model,
        enhancementOptions
      );

      res.json({
        success: true,
        data: {
          answer: response,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Direct model query error:", error);

      // Check if this is a rate limiting error
      const isRateLimitError =
        error.message?.includes("rate limiting") ||
        error.message?.includes("too high") ||
        error.message?.includes("throttling");

      if (isRateLimitError) {
        const queueStatus = bedrockService.getQueueStatus();
        return res.status(429).json({
          success: false,
          error: "Rate limit exceeded",
          message: "Too many requests. Please wait and try again.",
          retryAfter: Math.ceil(queueStatus.minInterval / 1000), // seconds
          queueInfo: {
            position: queueStatus.queueLength + 1,
            estimatedWait: queueStatus.queueLength * queueStatus.minInterval,
          },
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to process direct query",
        message: error.message,
      });
    }
  }
);

/**
 * Get chat session info
 * GET /api/chat/session/:sessionId
 */
router.get("/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  res.json({
    success: true,
    data: {
      sessionId,
      status: "active",
      createdAt: new Date().toISOString(),
      messageCount: 0, // Placeholder - would track in real implementation
    },
  });
});

/**
 * Test connectivity (both knowledge base and agent)
 * GET /api/chat/test
 */
router.get("/test", async (req, res) => {
  try {
    const testQuery = "What information is available in the knowledge base?";
    const useAgent =
      req.query.useAgent === "true" || process.env.BEDROCK_AGENT_ID
        ? true
        : false;

    logger.info(
      `Testing ${useAgent ? "agent" : "knowledge base"} connectivity...`
    );

    let response;
    let method;

    if (useAgent) {
      try {
        const agentResponse = await bedrockAgentService.invokeAgent(
          testQuery,
          "test-agent-session"
        );
        response = {
          query: testQuery,
          answer: agentResponse.answer,
          sources: agentResponse.citations,
          sessionId: agentResponse.sessionId,
          agentMetadata: agentResponse.metadata,
        };
        method = "agent";
      } catch (agentError) {
        logger.warn(
          "Agent test failed, testing knowledge base:",
          agentError.message
        );
        const kbResponse = await bedrockService.queryKnowledgeBase(
          testQuery,
          "test-kb-session"
        );
        response = {
          query: testQuery,
          answer: kbResponse.answer,
          sources: kbResponse.sources,
          sessionId: kbResponse.sessionId,
          fallbackReason: agentError.message,
        };
        method = "knowledge_base_fallback";
      }
    } else {
      const kbResponse = await bedrockService.queryKnowledgeBase(
        testQuery,
        "test-kb-session"
      );
      response = {
        query: testQuery,
        answer: kbResponse.answer,
        sources: kbResponse.sources,
        sessionId: kbResponse.sessionId,
      };
      method = "knowledge_base";
    }

    res.json({
      success: true,
      message: `${method.replace("_", " ")} test successful`,
      method,
      data: {
        ...response,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Connectivity test failed:", error);
    res.status(500).json({
      success: false,
      error: "Connectivity test failed",
      message: error.message,
      details: {
        knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
        agentId: process.env.BEDROCK_AGENT_ID,
        region: process.env.AWS_REGION,
      },
    });
  }
});

/**
 * Get available models
 * GET /api/chat/models
 */
router.get("/models", (req, res) => {
  res.json({
    success: true,
    models: [
      {
        id: "anthropic.claude-3-sonnet-20240229-v1:0",
        name: "Claude 3 Sonnet",
        description: "High-performance model for complex reasoning",
        default: true,
      },
      {
        id: "anthropic.claude-3-haiku-20240307-v1:0",
        name: "Claude 3 Haiku",
        description: "Fast and efficient model for quick responses",
        default: false,
      },
    ],
  });
});

/**
 * Get Bedrock service status and rate limiting information
 * GET /api/chat/status
 */
router.get("/status", (req, res) => {
  try {
    const queueStatus = bedrockService.getQueueStatus();
    const isRateLimited = bedrockService.isRateLimited();

    res.json({
      success: true,
      data: {
        status: isRateLimited ? "rate-limited" : "ready",
        isRateLimited,
        queue: {
          length: queueStatus.queueLength,
          running: queueStatus.runningRequests,
          maxConcurrent: queueStatus.maxConcurrent,
          minInterval: queueStatus.minInterval,
        },
        timing: {
          lastRequestTime: queueStatus.lastRequestTime,
          timeSinceLastRequest: queueStatus.timeSinceLastRequest,
          canMakeRequest:
            queueStatus.timeSinceLastRequest >= queueStatus.minInterval,
        },
        retryConfig: queueStatus.retryConfig,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting Bedrock status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get service status",
      message: error.message,
    });
  }
});

// Agent endpoint moved to /api/chat/agent routes (agent.js)
// This eliminates confusion between /api/chat/agent and /api/chat/agent/ endpoints

module.exports = router;
