const {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime");
const {
  BedrockAgentClient,
  GetAgentCommand,
  CreateAgentCommand,
  UpdateAgentCommand,
  PrepareAgentCommand,
} = require("@aws-sdk/client-bedrock-agent");
const logger = require("../utils/logger");
const htmlProcessor = require("../utils/htmlProcessor");

/**
 * Enhanced Bedrock Agent Service for intelligent knowledge retrieval
 * This service manages Bedrock Agents that can access knowledge bases,
 * perform reasoning, and provide contextual responses.
 */
class BedrockAgentService {
  constructor() {
    // Initialize Bedrock Agent Runtime Client for agent interactions
    this.agentRuntimeClient = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent-runtime.${
        process.env.AWS_REGION || "us-east-1"
      }.amazonaws.com`,
      maxAttempts: 3,
    });

    // Initialize Bedrock Agent Client for agent management
    this.agentClient = new BedrockAgentClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent.${
        process.env.AWS_REGION || "us-east-1"
      }.amazonaws.com`,
      maxAttempts: 3,
    });

    // Agent configuration
    this.agentId = process.env.BEDROCK_AGENT_ID;
    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    // Note: agentAliasId is now dynamically fetched from action groups API, not from env

    // Log configuration for debugging
    logger.debug("Bedrock Agent Service Configuration:", {
      hasAgentId: !!this.agentId,
      agentId: this.agentId
        ? `${this.agentId.substring(0, 8)}...`
        : "Not configured",
      hasKnowledgeBaseId: !!this.knowledgeBaseId,
      region: process.env.AWS_REGION || "us-east-1",
      note: "Agent alias ID is now dynamically fetched from action groups API"
    });

    // Removed session management - now using direct conversation history

    // Rate limiting configuration
    this.requestQueue = [];
    this.activeRequests = 0;
    this.maxConcurrentRequests = 2;
    this.rateLimitDelay = 1000; // 1 second between requests

    // Use centralized prompt manager for all instructions

    // Removed session cleanup - now using direct conversation history
  }

  // Removed session cleanup - now using direct conversation history

  /**
   * Generate a session ID if needed (for AWS agent calls)
   * @param {string} sessionId - Optional session identifier
   * @returns {string} - Session identifier
   */
  getSessionId(sessionId) {
    return sessionId || `session-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }

  // Removed session-based conversation history storage - now using direct history

  // Removed session-based conversation history retrieval - now using direct history

  /**
   * Build conversation context for agent prompt enhancement
   * @param {string|null} sessionId - Session identifier (can be null when using direct history)
   * @param {Object} options - Context building options
   * @param {Array} options.directHistory - Direct conversation history array (alternative to session-based)
   * @returns {string} - Formatted conversation context
   */
  buildConversationContext(sessionId, options = {}) {
    const {
      maxMessages = 6, // Include last 6 messages (3 exchanges)
      includeTimestamps = false,
      prioritizeRecent = true,
      contextWeight = "balanced", // 'light', 'balanced', 'heavy'
      directHistory = null, // NEW: Direct conversation history array
    } = options;

    let historyMessages = [];

    // Use direct history if provided, otherwise fall back to session-based history
    if (directHistory && Array.isArray(directHistory) && directHistory.length > 0) {
      // Process direct history payload
      historyMessages = directHistory
        .slice(-maxMessages) // Take only the most recent messages up to maxMessages
        .map(msg => ({
          id: `direct-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: msg.timestamp || new Date().toISOString(),
          type: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
          metadata: msg.metadata || {}
        }));

      logger.info(`Using direct conversation history: ${historyMessages.length} messages`);
    } else {
      // No direct history provided
      logger.info("No conversation history available");
    }

    // If no history available, return null
    if (historyMessages.length === 0) {
      logger.info("No conversation history available");
      return null;
    }

    let contextLines = [];

    // Session context summary has been removed - using direct history only

    // Format conversation history
    contextLines.push("\nRecent conversation history:");

    historyMessages.forEach((msg, index) => {
      const isRecent = index >= historyMessages.length - 2; // Last 2 messages
      const weight = prioritizeRecent && isRecent ? "[RECENT] " : "";
      const timestamp = includeTimestamps
        ? `[${new Date(msg.timestamp).toLocaleTimeString()}] `
        : "";

      const role = msg.type === "user" ? "Human" : "Assistant";
      const content =
        msg.content.length > 200
          ? msg.content.substring(0, 200) + "..."
          : msg.content;

      contextLines.push(`${weight}${timestamp}${role}: ${content}`);
    });

    logger.info(`Built conversation context with ${historyMessages.length} messages`);
    return contextLines.join("\n");
  }

  /**
   * Analyze query to determine the best interaction approach
   * @param {string} query - User query
   * @param {Object} context - Session context
   * @returns {Object} - Analysis result with recommended approach
   */
  analyzeQuery(query, context = {}) {
    const lowerQuery = query.toLowerCase();

    // Conversation indicators
    const conversationalIndicators = [
      "tell me more",
      "what else",
      "continue",
      "also",
      "additionally",
      "furthermore",
      "can you explain",
      "what about",
      "how about",
    ];

    // Analytical indicators
    const analyticalIndicators = [
      "analyze",
      "compare",
      "evaluate",
      "assess",
      "review",
      "examine",
      "pros and cons",
      "advantages",
      "disadvantages",
      "benefits",
      "risks",
      "strategy",
      "approach",
      "methodology",
      "framework",
      "best practices",
    ];

    // Technical indicators
    const technicalIndicators = [
      "implement",
      "code",
      "setup",
      "configure",
      "install",
      "deploy",
      "api",
      "function",
      "method",
      "class",
      "algorithm",
      "syntax",
      "debugging",
      "error",
      "troubleshoot",
      "performance",
    ];

    // Determine interaction style
    let interactionStyle = "knowledgeQuery"; // default
    let confidence = 0.5;

    const conversationalScore = conversationalIndicators.filter((indicator) =>
      lowerQuery.includes(indicator)
    ).length;

    const analyticalScore = analyticalIndicators.filter((indicator) =>
      lowerQuery.includes(indicator)
    ).length;

    const technicalScore = technicalIndicators.filter((indicator) =>
      lowerQuery.includes(indicator)
    ).length;

    // Consider conversation history
    const hasContext = context.messageCount > 0;

    if (conversationalScore > 0 || hasContext) {
      interactionStyle = "conversational";
      confidence = Math.min(
        0.9,
        0.6 + conversationalScore * 0.1 + (hasContext ? 0.2 : 0)
      );
    } else if (analyticalScore > analyticalScore && analyticalScore > 0) {
      interactionStyle = "analytical";
      confidence = Math.min(0.9, 0.6 + analyticalScore * 0.15);
    }

    // Enhanced query construction based on analysis
    const queryEnhancement = this.buildQueryEnhancement(
      query,
      interactionStyle,
      context
    );

    return {
      originalQuery: query,
      interactionStyle,
      confidence,
      queryEnhancement,
      suggestedPrompt: null, // Simplified - no complex prompt management
      technicalScore,
      conversationalScore,
      analyticalScore,
      hasContext,
    };
  }

  /**
   * Build query enhancement based on interaction style and context
   * @param {string} originalQuery - Original user query
   * @param {string} style - Interaction style
   * @param {Object} context - Session context
   * @returns {string} - Enhanced query
   */
  buildQueryEnhancement(originalQuery, style, context) {
    let enhancement = originalQuery;

    // Add context from conversation history
    if (context.topics && context.topics.length > 0) {
      const recentTopics = context.topics.slice(-3).join(", ");
      enhancement += `\n\nContext from our conversation: We've been discussing ${recentTopics}.`;
    }

    // Add style-specific enhancements
    switch (style) {
      case "conversational":
        enhancement += `\n\nPlease provide a conversational response that builds on our discussion.`;
        break;
      case "analytical":
        enhancement += `\n\nPlease provide a comprehensive analytical response with multiple perspectives, pros/cons, and strategic insights.`;
        break;
      default:
        enhancement += `\n\nPlease provide a detailed, well-structured response with relevant examples and context.`;
    }

    // Add HTML formatting instruction to all enhancements
    enhancement += `\n\nIMPORTANT: Format your response using proper HTML markup for better readability. `;

    return enhancement;
  }

  /**
   * Build AWS Bedrock retrieval filters for strict data source filtering
   * @param {Object} dataSources - Data sources to filter by
   * @returns {Object|null} AWS RetrievalFilter configuration
   */
  buildRetrievalFilters(dataSources) {
    if (!dataSources || Object.keys(dataSources).length === 0) {
      return null;
    }

    const filters = [];

    // APPROACH: Use metadata-based filtering instead of URI patterns
    // Since documents are stored with domain metadata, we filter on metadata fields
    if (dataSources.websites && dataSources.websites.length > 0) {
      dataSources.websites.forEach(domain => {
        // Clean domain and handle www prefix intelligently
        const cleanDomain = domain.replace(/^https?:\/\//, ''); // Remove protocol if present
        const hasWww = cleanDomain.startsWith('www.');
        const baseDomain = hasWww ? cleanDomain.substring(4) : cleanDomain;
        
        // Filter by domain metadata field (since documents have "Domain: www.kaaylabs.com" in content)
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-data",
            value: `Domain: ${cleanDomain}`
          }
        });
        
        // Also match alternate format
        const alternateDomain = hasWww ? baseDomain : `www.${baseDomain}`;
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-data",
            value: `Domain: ${alternateDomain}`
          }
        });
        
        // Additional filter for URL field in document
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-data",
            value: `URL: https://${cleanDomain}`
          }
        });
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-data",
            value: `URL: https://${alternateDomain}`
          }
        });
      });
    }

    // PDF document filters using filename patterns
    if (dataSources.pdfs && dataSources.pdfs.length > 0) {
      dataSources.pdfs.forEach(pdfName => {
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-source-uri",
            value: `${pdfName}.pdf`
          }
        });
        // Also try without .pdf extension in case it's stored without it
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-source-uri",
            value: pdfName
          }
        });
      });
    }

    // Document filters using filename patterns
    if (dataSources.documents && dataSources.documents.length > 0) {
      dataSources.documents.forEach(docName => {
        filters.push({
          contains: {
            key: "x-amz-bedrock-kb-source-uri",
            value: docName
          }
        });
      });
    }

    // Return OR filter combining all conditions if we have any filters
    if (!filters || filters.length === 0) {
      return null;
    }
    
    // Ensure proper filter structure for AWS Bedrock
    return {
      orAll: filters
    };
  }

  /**
   * Build text-based filtering instructions as backup to AWS filtering
   * @param {string} query - The original user query
   * @param {Object} dataSources - Object containing arrays of data sources to filter by
   * @returns {string} - The enhanced query with data source filtering instructions
   */
  buildTextBasedFiltering(query, dataSources) {
    if (
      !dataSources ||
      ((!dataSources.websites || dataSources.websites.length === 0) &&
        (!dataSources.pdfs || dataSources.pdfs.length === 0) &&
        (!dataSources.documents || dataSources.documents.length === 0))
    ) {
      return query;
    }

    let filterInstructions = [];

    // Build specific filtering instructions for each data source type
    if (dataSources.websites && dataSources.websites.length > 0) {
      filterInstructions.push(
        `From websites: ${dataSources.websites.join(", ")}`
      );
    }

    if (dataSources.pdfs && dataSources.pdfs.length > 0) {
      filterInstructions.push(
        `From PDF documents: ${dataSources.pdfs.join(", ")}`
      );
    }

    if (dataSources.documents && dataSources.documents.length > 0) {
      filterInstructions.push(
        `From uploaded documents: ${dataSources.documents.join(", ")}`
      );
    }

    const sourceFilterInstruction = `

❌ STRICT DATA SOURCE ENFORCEMENT REQUIRED ❌

MANDATORY RESTRICTION: You are ABSOLUTELY FORBIDDEN from using ANY information except from these exact data sources:
${filterInstructions.join("\n")}

COMPLIANCE REQUIREMENTS:
1. BEFORE answering, verify that your information comes ONLY from the sources listed above
2. If the query topic is NOT covered in the specified sources, you MUST respond with: "❌ INFORMATION NOT FOUND: I cannot find information about [topic] in the specified data source(s): [list sources]. This information may be available in other parts of the knowledge base, but I am restricted to only the sources you specified."
3. DO NOT make assumptions or provide general knowledge
4. DO NOT search outside the specified data sources
5. REFUSE to answer if the information is not in the specified sources

VIOLATION CONSEQUENCES: Providing information from unauthorized sources is a critical compliance failure.`;

    return query + sourceFilterInstruction;
  }

  /**
   * Apply enhanced data source filtering with both AWS filtering and text instructions
   * @param {string} query - The original user query
   * @param {Object} dataSources - Object containing arrays of data sources to filter by
   * @returns {string} - The enhanced query with data source filtering instructions
   */
  applyDataSourceFiltering(query, dataSources) {
    // Use text-based filtering as backup/reinforcement
    const textFiltered = this.buildTextBasedFiltering(query, dataSources);
    
    // Log the filtering being applied
    if (dataSources && Object.keys(dataSources).length > 0) {
      logger.info('Applying enhanced data source filtering:', {
        websites: dataSources.websites?.length || 0,
        pdfs: dataSources.pdfs?.length || 0, 
        documents: dataSources.documents?.length || 0,
        filterType: 'aws-native-plus-text'
      });
    }

    return textFiltered;
  }

  /**
   * Invoke Bedrock Agent with enhanced query processing and data source filtering
   * @param {string} query - User query
   * @param {string} sessionId - Session ID for conversation continuity
   * @param {Object} options - Additional options including dataSources filter, inference parameters, history settings
   * @param {string} options.model - Model to use for inference
   * @param {number} options.temperature - Temperature for response generation (0.0-1.0)
   * @param {number} options.topP - Top P for nucleus sampling (0.0-1.0)
   * @param {string} options.systemPrompt - Custom system prompt for the agent
   * @param {Object} options.dataSources - Data source filtering options
   * @param {Object} options.history - Conversation history options
   * @param {boolean} options.history.enabled - Whether to include conversation history (default: true)
   * @param {number} options.history.maxMessages - Maximum number of previous messages to include (default: 6)
   * @param {string} options.history.contextWeight - Context weight: 'light', 'balanced', 'heavy' (default: 'balanced')
   * @returns {Promise<Object>} - Agent response
   */
  async invokeAgent(query, sessionId = null, options = {}, dataSources = null) {
    try {
      // Validate agent configuration
      if (!this.agentId) {
        throw new Error(
          "BEDROCK_AGENT_ID is not configured. Please set up a Bedrock Agent first."
        );
      }

      const startTime = Date.now();

      // Generate session ID if needed
      const actualSessionId = this.getSessionId(sessionId);

      // Analyze query and determine approach (no session context needed)
      const analysis = this.analyzeQuery(query, {});

      // Build conversation context if enabled
      const historyOptions = {
        enabled: true,
        maxMessages: 6,
        contextWeight: "balanced",
        ...options.history,
      };

      let conversationContext = null;
      if (historyOptions.enabled) {
        // Use direct conversation history if provided
        const shouldUseHistory = options.conversationHistory && 
          Array.isArray(options.conversationHistory) && 
          options.conversationHistory.length > 0;
          
        if (shouldUseHistory) {
          conversationContext = this.buildConversationContext(actualSessionId, {
            maxMessages: historyOptions.maxMessages,
            contextWeight: historyOptions.contextWeight,
            prioritizeRecent: true,
            directHistory: options.conversationHistory,
          });
        }
      }

      logger.info(`Invoking Bedrock Agent for query analysis:`, {
        sessionId: actualSessionId,
        queryLength: query.length,
        interactionStyle: analysis.interactionStyle,
        confidence: analysis.confidence,
        conversationHistoryLength: options.conversationHistory?.length || 0,
        hasConversationContext: !!conversationContext,
        hasDataSourceFilters: !!options.dataSources,
        hasCustomModel: !!options.model,
        hasSystemPrompt: !!options.systemPrompt,
        temperature: options.temperature,
        topP: options.topP,
        historyEnabled: historyOptions.enabled,
      });

      // Apply data source filtering to the query if specified
      let enhancedQuery =
        options.useEnhancement !== false ? analysis.queryEnhancement : query;

      // Add conversation context to enhance query with history
      if (conversationContext) {
        enhancedQuery = `CONVERSATION CONTEXT:
${conversationContext}

CURRENT QUERY: ${enhancedQuery}

Please answer the current query while being aware of the conversation context above. Prioritize the current query but use the conversation history to provide more relevant and coherent responses.`;
        logger.info("Applied conversation context to query");
      }

      // Apply system prompt if provided
      // if (options.systemPrompt) {
      //   enhancedQuery = `${options.systemPrompt}\n\nUser Query: ${enhancedQuery}`;
      //   logger.info("Applied custom system prompt to query");
      // }

      // Apply user context if userId is provided
      if (options.userId) {
        enhancedQuery = `USER CONTEXT:
User ID: ${options.userId}

CURRENT QUERY: ${enhancedQuery}

Please answer the current query in the context of the specified user. When the user asks about "my" orders, deliveries, or personal information, reference the User ID: ${options.userId} to provide personalized responses.`;
        logger.info(`Applied user context for user ID: ${options.userId}`);
      }

      if (options.dataSources) {
        enhancedQuery = this.applyDataSourceFiltering(
          enhancedQuery,
          options.dataSources
        );
        logger.info("Applied data source filtering to query");
      }

      // Validate that agentAliasId is provided in options
      if (!options.agentAliasId) {
        throw new Error('agentAliasId is required but not provided in options. Please ensure the latest alias is fetched before invoking the agent.');
      }

              // Build AWS native retrieval filters for strict data source filtering
        const retrievalFilters = this.buildRetrievalFilters(options.dataSources);
        console.log("=== DEBUGGING DATA SOURCE FILTERING ===");
        console.log("Input dataSources:", JSON.stringify(options.dataSources, null, 2));
        console.log("Query:", query.substring(0, 100));
        console.log("AWS filtering disabled - using strict text-based approach");
        console.log("this.knowledgeBaseId:", this.knowledgeBaseId);
        console.log("=== END DEBUG ===");
      
      // Prepare session state with knowledge base configuration and filters
      let sessionState = { ...options.sessionState };
      
      // DISABLED: AWS native filtering is causing errors - using text-based filtering instead
      // Use text-based filtering approach which is more reliable
      if (options.dataSources && Object.keys(options.dataSources).length > 0) {
        logger.info('Using text-based data source filtering (AWS native filtering disabled):', {
          dataSources: options.dataSources,
          knowledgeBaseId: this.knowledgeBaseId
        });
      }

      // Prepare agent invocation parameters
      const agentParams = {
        agentId: this.agentId,
        agentAliasId: options.agentAliasId, // Use the dynamically provided aliasId
        sessionId: actualSessionId,
        inputText: enhancedQuery,
        // Enable trace for debugging (optional)
        enableTrace: process.env.NODE_ENV === "development",
        // Enhanced session state with knowledge base configuration and filters
        sessionState: sessionState,
      };

      // Add inference configuration if temperature or topP is provided
      if (options.temperature !== null || options.topP !== null) {
        agentParams.inferenceConfiguration = {};

        if (options.temperature !== null) {
          agentParams.inferenceConfiguration.temperature = options.temperature;
        }

        if (options.topP !== null) {
          agentParams.inferenceConfiguration.topP = options.topP;
        }

        logger.info(
          "Added inference configuration to agent params:",
          agentParams.inferenceConfiguration
        );
      }

      // Add foundation model override if provided
      if (options.model) {
        // Model override is typically handled at the agent level, not per-invocation
        // But we'll log it for debugging purposes
        logger.info(
          "Model override requested (handled at agent configuration level):",
          options.model
        );
      }

      logger.debug("Agent invocation parameters:", {
        agentId: this.agentId,
        agentAliasId: options.agentAliasId,
        sessionId: actualSessionId,
        queryPreview: enhancedQuery.substring(0, 150) + "...",
        enableTrace: agentParams.enableTrace,
        filtersApplied: !!options.dataSources,
        hasInferenceConfig: !!agentParams.inferenceConfiguration,
        inferenceConfig: agentParams.inferenceConfiguration,
        customModel: options.model,
        hasSystemPrompt: !!options.systemPrompt,
        fullQuery: enhancedQuery, // DEBUG: See the complete query being sent
      });

      // Create the invoke agent command
      const command = new InvokeAgentCommand(agentParams);

      console.log(command, "Command ===================>");

      // Add to rate limiting queue
      const response = await this.executeWithRateLimit(async () => {
        return await this.agentRuntimeClient.send(command);
      });

      logger.debug("Raw AWS response received:", {
        hasCompletion: !!response.completion,
        responseType: typeof response,
        responseKeys: Object.keys(response || {}),
      });

      // Process the streaming response
      const agentResponse = await this.processAgentResponse(response);

      // If no text was captured, try alternative processing
      if (!agentResponse.text) {
        logger.warn(
          "No text in initial response processing, trying alternative methods..."
        );
        const alternativeResponse = await this.processAgentResponseAlternative(
          response
        );
        if (alternativeResponse.text) {
          logger.info(
            "Alternative processing successful, using alternative response"
          );
          return this.buildFinalResponse(
            actualSessionId,
            alternativeResponse,
            analysis,
            options.dataSources,
            {
              temperature: options.temperature,
              topP: options.topP,
              model: options.model,
              systemPrompt: options.systemPrompt,
              agentAliasId: options.agentAliasId,
            }
          );
        } else {
          // Final fallback - provide an informative response
          logger.error(
            "All processing methods failed, providing fallback response"
          );
          const fallbackResponse = {
            text: `I apologize, but I'm having trouble processing your query "${analysis.originalQuery}" at the moment. This could be due to a temporary service issue or configuration problem. Please try rephrasing your question or contact support if the issue persists.`,
            citations: [],
            trace: null,
            responseTime: Date.now() - Date.parse(new Date().toISOString()),
            tokensUsed: 0,
          };
          return this.buildFinalResponse(
            actualSessionId,
            fallbackResponse,
            analysis,
            options.dataSources,
            {
              temperature: options.temperature,
              topP: options.topP,
              model: options.model,
              systemPrompt: options.systemPrompt,
              agentAliasId: options.agentAliasId,
            }
          );
        }
      }

      logger.info("Agent response processed successfully:", {
        sessionId: actualSessionId,
        responseLength: agentResponse.text?.length || 0,
        citationCount: agentResponse.citations?.length || 0,
        traceAvailable: !!agentResponse.trace,
        filtersApplied: !!options.dataSources,
        conversationContextUsed: !!conversationContext,
      });

      const responseTime = Date.now() - startTime;

      // Session-based storage removed - conversation history now managed by frontend

      return this.buildFinalResponse(
        actualSessionId,
        agentResponse,
        analysis,
        options.dataSources,
        {
          temperature: options.temperature,
          topP: options.topP,
          model: options.model,
          systemPrompt: options.systemPrompt,
          agentAliasId: options.agentAliasId,
          conversationContextUsed: !!conversationContext,
          historyOptions: historyOptions,
        }
      );
    } catch (error) {
      logger.error("Agent invocation failed:", {
        error: error.message,
        agentId: this.agentId,
        sessionId: sessionId,
        query: query.substring(0, 100) + "...",
        hasFilters: !!options.dataSources,
      });

      // Provide specific error handling for common issues
      if (error.name === "ResourceNotFoundException") {
        throw new Error(
          `Bedrock Agent not found. Please verify BEDROCK_AGENT_ID: ${this.agentId}`
        );
      } else if (error.name === "AccessDeniedException") {
        throw new Error(
          "Access denied to Bedrock Agent. Please check IAM permissions."
        );
      } else if (error.name === "ThrottlingException") {
        throw new Error(
          "Agent request was throttled. Please try again in a moment."
        );
      }

      throw new Error(`Agent invocation failed: ${error.message}`);
    }
  }

  /**
   * Process the streaming agent response
   * @param {Object} response - Raw agent response
   * @returns {Promise<Object>} - Processed response
   */
  async processAgentResponse(response) {
    const startTime = Date.now();
    let fullText = "";
    let citations = [];
    let trace = null;
    let tokensUsed = 0;

    try {
      logger.debug("Raw agent response structure:", {
        hasCompletion: !!response.completion,
        responseKeys: Object.keys(response || {}),
      });

      // Handle streaming response
      if (response.completion) {
        for await (const chunk of response.completion) {
          logger.debug("Processing chunk:", {
            chunkType: typeof chunk,
            hasChunk: !!chunk.chunk,
            hasTrace: !!chunk.trace,
            chunkKeys: Object.keys(chunk || {}),
          });

          // Process chunk data
          if (chunk.chunk) {
            const chunkData = chunk.chunk;

            // Process text chunks
            if (chunkData.bytes) {
              const textChunk = new TextDecoder().decode(chunkData.bytes);
              fullText += textChunk;
              logger.debug("Added text chunk:", {
                length: textChunk.length,
                preview: textChunk.substring(0, 100),
              });
            }

            // Process attribution/citations
            if (chunkData.attribution) {
              const newCitations = chunkData.attribution.citations || [];
              citations.push(...newCitations);
              logger.debug("Added citations:", { count: newCitations.length });
            }
          }

          // Check for different chunk formats
          if (chunk.bytes) {
            const textChunk = new TextDecoder().decode(chunk.bytes);
            fullText += textChunk;
            logger.debug("Added direct bytes chunk:", {
              length: textChunk.length,
            });
          }

          // Process final response chunk
          if (chunk.finalResponse) {
            if (chunk.finalResponse.text) {
              fullText += chunk.finalResponse.text;
              logger.debug("Added final response text:", {
                length: chunk.finalResponse.text.length,
              });
            }
          }

          // Process trace information (for debugging)
          if (chunk.trace) {
            trace = chunk.trace;
            logger.debug("Trace information captured");
          }

          // Track token usage if available
          if (chunk.metadata?.usage) {
            tokensUsed =
              chunk.metadata.usage.inputTokens +
              chunk.metadata.usage.outputTokens;
          }
        }
      }

      // If no text was captured, check if response has direct text
      if (!fullText && response.output) {
        fullText = response.output;
        logger.debug("Using direct output:", { length: fullText.length });
      }

      const responseTime = Date.now() - startTime;

      logger.info("Agent response processed:", {
        textLength: fullText.length,
        citationCount: citations.length,
        responseTime: `${responseTime}ms`,
        tokensUsed,
        hasText: !!fullText,
      });

      // If still no text, log the full response structure for debugging
      if (!fullText) {
        logger.warn(
          "No text captured from agent response. Full response structure:",
          {
            response: JSON.stringify(response, null, 2).substring(0, 1000),
          }
        );
      }

      // Process the text response through HTML processor
      const processedResponse = htmlProcessor.processBedrockResponse(fullText.trim(), {
        enhanceFormatting: true,
        addMetadata: false // We'll add metadata later in buildFinalResponse
      });

      logger.debug('HTML processing result:', {
        format: processedResponse.format,
        processingTime: processedResponse.processingTime,
        enhanced: processedResponse.enhanced,
        originalLength: fullText.length,
        htmlLength: processedResponse.html.length
      });

      return {
        text: processedResponse.originalText, // Keep original text for compatibility
        html: processedResponse.html, // Add processed HTML version
        htmlMetadata: {
          format: processedResponse.format,
          processingTime: processedResponse.processingTime,
          enhanced: processedResponse.enhanced
        },
        citations,
        trace,
        responseTime,
        tokensUsed,
      };
    } catch (error) {
      logger.error("Error processing agent response:", error);
      throw new Error(`Failed to process agent response: ${error.message}`);
    }
  }

  /**
   * Execute request with rate limiting
   * @param {Function} requestFn - Function to execute
   * @returns {Promise} - Request result
   */
  async executeWithRateLimit(requestFn) {
    return new Promise((resolve, reject) => {
      const executeRequest = async () => {
        if (this.activeRequests >= this.maxConcurrentRequests) {
          // Add to queue
          this.requestQueue.push({ requestFn, resolve, reject });
          return;
        }

        this.activeRequests++;
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;

          // Process next request in queue
          if (this.requestQueue.length > 0) {
            const {
              requestFn: nextRequestFn,
              resolve: nextResolve,
              reject: nextReject,
            } = this.requestQueue.shift();
            setTimeout(() => {
              executeRequest.call(this, nextRequestFn, nextResolve, nextReject);
            }, this.rateLimitDelay);
          }
        }
      };

      executeRequest();
    });
  }

  /**
   * Extract topic from query for context tracking
   * @param {string} query - User query
   * @returns {string} - Extracted topic
   */
  extractTopicFromQuery(query) {
    // Simple topic extraction - in production, could use NLP
    const words = query.toLowerCase().split(" ");
    const stopWords = [
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "how",
      "what",
      "where",
      "when",
      "why",
      "can",
      "could",
      "would",
      "should",
    ];

    const keyWords = words
      .filter((word) => word.length > 3 && !stopWords.includes(word))
      .slice(0, 3); // Take first 3 key words

    return keyWords.join(" ") || "general";
  }

  /**
   * Get agent information and status
   * @returns {Promise<Object>} - Agent information
   */
  async getAgentInfo() {
    try {
      if (!this.agentId) {
        return {
          configured: false,
          error: "No agent ID configured",
        };
      }

      const command = new GetAgentCommand({
        agentId: this.agentId,
      });

      const response = await this.agentClient.send(command);

      return {
        configured: true,
        agentId: this.agentId,
        agentName: response.agent.agentName,
        status: response.agent.agentStatus,
        description: response.agent.description,
        foundationModel: response.agent.foundationModel,
        createdAt: response.agent.createdAt,
        updatedAt: response.agent.updatedAt,
        agentAliasId: this.agentAliasId,
      };
    } catch (error) {
      logger.error("Error getting agent info:", error);
      return {
        configured: false,
        error: error.message,
        agentId: this.agentId,
      };
    }
  }

  /**
   * Get service summary (sessions removed, now just service status)
   * @returns {Object} - Service summary
   */
  getServiceSummary() {
    return {
      // Session tracking removed - using direct conversation history
      totalSessions: 0,
      activeSessions: 0,
      rateLimitConfig: {
        maxConcurrent: this.maxConcurrentRequests,
        activeRequests: this.activeRequests,
        queueLength: this.requestQueue.length,
        rateLimitDelay: this.rateLimitDelay,
      },
    };
  }

  /**
   * Health check for the agent service
   * @returns {Promise<Object>} - Health status
   */
  async healthCheck() {
    try {
      const agentInfo = await this.getAgentInfo();
      const serviceSummary = this.getServiceSummary();

      const isHealthy = agentInfo.configured && agentInfo.status === "PREPARED";

      return {
        healthy: isHealthy,
        agent: agentInfo,
        service: serviceSummary,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Agent health check failed:", error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Test agent with a simple query
   * @returns {Promise<Object>} - Test result
   */
  async testAgent() {
    try {
      const testQuery =
        "Hello, can you tell me what information is available in your knowledge base?";

      logger.info("Testing agent with simple query...");

      const response = await this.invokeAgent(testQuery, "agent-test-session", {
        useEnhancement: false,
        sessionConfig: { testMode: true },
      });

      return {
        success: true,
        query: testQuery,
        response: response.answer.substring(0, 200) + "...",
        sessionId: response.sessionId,
        citationCount: response.citations.length,
        responseTime: response.metadata.responseTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Agent test failed:", error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Alternative agent response processing for different SDK versions
   * @param {Object} response - Raw agent response
   * @returns {Promise<Object>} - Processed response
   */
  async processAgentResponseAlternative(response) {
    const startTime = Date.now();
    let fullText = "";
    let citations = [];
    let trace = null;
    let tokensUsed = 0;

    try {
      logger.debug("Trying alternative response processing...");

      // Check for different response structures
      if (response.completion) {
        // Try to process as async iterator
        try {
          const chunks = [];
          for await (const chunk of response.completion) {
            chunks.push(chunk);
          }

          logger.debug("Collected chunks:", { count: chunks.length });

          for (const chunk of chunks) {
            // Different processing based on chunk structure
            if (chunk.chunk?.bytes) {
              const text = new TextDecoder().decode(chunk.chunk.bytes);
              fullText += text;
            } else if (chunk.bytes) {
              const text = new TextDecoder().decode(chunk.bytes);
              fullText += text;
            } else if (chunk.completion?.text) {
              fullText += chunk.completion.text;
            } else if (chunk.text) {
              fullText += chunk.text;
            }

            // Extract citations
            if (chunk.chunk?.attribution?.citations) {
              citations.push(...chunk.chunk.attribution.citations);
            } else if (chunk.attribution?.citations) {
              citations.push(...chunk.attribution.citations);
            }

            if (chunk.trace) {
              trace = chunk.trace;
            }
          }
        } catch (iteratorError) {
          logger.debug("Iterator approach failed:", iteratorError.message);
        }
      }

      // If still no text, try direct property access
      if (!fullText) {
        if (response.text) {
          fullText = response.text;
        } else if (response.output) {
          fullText = response.output;
        } else if (response.completion?.text) {
          fullText = response.completion.text;
        }
      }

      const responseTime = Date.now() - startTime;

      logger.debug("Alternative processing result:", {
        textLength: fullText.length,
        citationCount: citations.length,
        responseTime: `${responseTime}ms`,
      });

      // Process the text response through HTML processor (alternative processing)
      const processedResponse = htmlProcessor.processBedrockResponse(fullText.trim(), {
        enhanceFormatting: true,
        addMetadata: false // We'll add metadata later in buildFinalResponse
      });

      logger.debug('Alternative HTML processing result:', {
        format: processedResponse.format,
        processingTime: processedResponse.processingTime,
        enhanced: processedResponse.enhanced
      });

      return {
        text: processedResponse.originalText, // Keep original text for compatibility
        html: processedResponse.html, // Add processed HTML version
        htmlMetadata: {
          format: processedResponse.format,
          processingTime: processedResponse.processingTime,
          enhanced: processedResponse.enhanced
        },
        citations,
        trace,
        responseTime,
        tokensUsed,
      };
    } catch (error) {
      logger.error("Alternative processing failed:", error);
      return {
        text: "",
        citations: [],
        trace: null,
        responseTime: Date.now() - startTime,
        tokensUsed: 0,
      };
    }
  }

  /**
   * Invoke Bedrock Agent with streaming response
   * @param {string} query - User query
   * @param {string} sessionId - Session ID for conversation continuity
   * @param {Object} options - Additional options including dataSources filter, inference parameters, history settings
   * @param {Object} streamCallbacks - Streaming callback functions
   * @param {Function} streamCallbacks.onChunk - Called when text chunk is received
   * @param {Function} streamCallbacks.onCitation - Called when citation is received
   * @param {Function} streamCallbacks.onMetadata - Called when metadata is received
   * @param {Function} streamCallbacks.onComplete - Called when streaming is complete
   * @param {Function} streamCallbacks.onError - Called when error occurs
   * @returns {Promise<void>}
   */
  async invokeAgentStreaming(query, sessionId = null, options = {}, streamCallbacks = {}) {
    try {
      // Validate agent configuration
      if (!this.agentId) {
        throw new Error(
          "BEDROCK_AGENT_ID is not configured. Please set up a Bedrock Agent first."
        );
      }

      const startTime = Date.now();
      const {
        onChunk = () => {},
        onCitation = () => {},
        onMetadata = () => {},
        onComplete = () => {},
        onError = () => {}
      } = streamCallbacks;

      // Generate session ID if needed
      const actualSessionId = this.getSessionId(sessionId);

      // Analyze query and determine approach (no session context needed)
      const analysis = this.analyzeQuery(query, {});

      // Build conversation context if enabled
      const historyOptions = {
        enabled: true,
        maxMessages: 6,
        contextWeight: "balanced",
        ...options.history,
      };

      let conversationContext = null;
      if (historyOptions.enabled) {
        // Use direct conversation history if provided
        const shouldUseHistory = options.conversationHistory && 
          Array.isArray(options.conversationHistory) && 
          options.conversationHistory.length > 0;
          
        if (shouldUseHistory) {
          conversationContext = this.buildConversationContext(actualSessionId, {
            maxMessages: historyOptions.maxMessages,
            contextWeight: historyOptions.contextWeight,
            prioritizeRecent: true,
            directHistory: options.conversationHistory,
          });
        }
      }

      logger.info(`Invoking Streaming Bedrock Agent for query analysis:`, {
        sessionId: actualSessionId,
        queryLength: query.length,
        interactionStyle: analysis.interactionStyle,
        confidence: analysis.confidence,
        conversationHistoryLength: options.conversationHistory?.length || 0,
        hasConversationContext: !!conversationContext,
        hasDataSourceFilters: !!options.dataSources,
        streaming: true,
      });

      // Apply data source filtering to the query if specified
      let enhancedQuery =
        options.useEnhancement !== false ? analysis.queryEnhancement : query;

      // Add conversation context to enhance query with history
      if (conversationContext) {
        enhancedQuery = `CONVERSATION CONTEXT:
${conversationContext}

CURRENT QUERY: ${enhancedQuery}

Please answer the current query while being aware of the conversation context above. Prioritize the current query but use the conversation history to provide more relevant and coherent responses.`;
        logger.info("Applied conversation context to streaming query");
      }

      // Apply system prompt if provided
      if (options.systemPrompt) {
        enhancedQuery = `${options.systemPrompt}\n\nUser Query: ${enhancedQuery}`;
        logger.info("Applied custom system prompt to streaming query");
      }

      // Apply user context if userId is provided
      if (options.userId) {
        enhancedQuery = `USER CONTEXT:
User ID: ${options.userId}

CURRENT QUERY: ${enhancedQuery}

Please answer the current query in the context of the specified user. When the user asks about "my" orders, deliveries, or personal information, reference the User ID: ${options.userId} to provide personalized responses.`;
        logger.info(`Applied user context for streaming query with user ID: ${options.userId}`);
      }

      if (options.dataSources) {
        enhancedQuery = this.applyDataSourceFiltering(
          enhancedQuery,
          options.dataSources
        );
        logger.info("Applied data source filtering to streaming query");
      }

      // Validate that agentAliasId is provided in options for streaming
      if (!options.agentAliasId) {
        throw new Error('agentAliasId is required but not provided in options for streaming. Please ensure the latest alias is fetched before invoking the agent.');
      }

      // Build AWS native retrieval filters for strict data source filtering (streaming)
      const retrievalFilters = this.buildRetrievalFilters(options.dataSources);
      
      // Prepare session state with knowledge base configuration and filters for streaming
      let sessionState = { ...options.sessionState };
      
      // Add knowledge base configuration with filtering if filters are provided
      if (retrievalFilters && this.knowledgeBaseId) {
        sessionState.knowledgeBaseConfigurations = [{
          knowledgeBaseId: this.knowledgeBaseId,
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              filter: retrievalFilters,
              numberOfResults: 10, // Increase since we're filtering
              overrideSearchType: "HYBRID" // Use hybrid search for better results with filtering
            }
          }
        }];
        
        logger.info('Applied AWS native retrieval filters (streaming):', {
          filterCount: retrievalFilters.orAll?.length || 0,
          knowledgeBaseId: this.knowledgeBaseId,
          filterDetails: {
            websites: options.dataSources?.websites?.length || 0,
            pdfs: options.dataSources?.pdfs?.length || 0,
            documents: options.dataSources?.documents?.length || 0
          }
        });
      } else if (options.dataSources && Object.keys(options.dataSources).length > 0) {
        logger.warn('Data sources provided but no filters could be built or knowledge base ID missing (streaming):', {
          hasKnowledgeBaseId: !!this.knowledgeBaseId,
          dataSources: options.dataSources
        });
      }

      // Prepare agent invocation parameters with TRUE streaming enabled
      const agentParams = {
        agentId: this.agentId,
        agentAliasId: options.agentAliasId, // Use the dynamically provided aliasId
        sessionId: actualSessionId,
        inputText: enhancedQuery,
        enableTrace: process.env.NODE_ENV === "development",
        sessionState: sessionState, // Enhanced session state with knowledge base configuration and filters
        // CRITICAL: Enable true streaming from AWS (matching Python SDK format)
        streamingConfigurations: {
          streamFinalResponse: true
        },
        // Additional streaming parameters based on AWS docs
        endSession: false, // Keep session alive for follow-up
      };

      // Add inference configuration if temperature or topP is provided
      if (options.temperature !== null || options.topP !== null) {
        agentParams.inferenceConfiguration = {};

        if (options.temperature !== null) {
          agentParams.inferenceConfiguration.temperature = options.temperature;
        }

        if (options.topP !== null) {
          agentParams.inferenceConfiguration.topP = options.topP;
        }

        logger.info(
          "Added inference configuration to streaming agent params:",
          agentParams.inferenceConfiguration
        );
      }

      logger.info("🚀 STREAMING AGENT INVOCATION with streamingConfigurations", {
        agentId: this.agentId,
        agentAliasId: options.agentAliasId,
        sessionId: actualSessionId,
        queryPreview: enhancedQuery.substring(0, 150) + "...",
        enableTrace: agentParams.enableTrace,
        streamingConfigurations: agentParams.streamingConfigurations,
        filtersApplied: !!options.dataSources,
        hasInferenceConfig: !!agentParams.inferenceConfiguration,
        streaming: true,
      });

      // Create the invoke agent command
      const command = new InvokeAgentCommand(agentParams);

      // Add to rate limiting queue and execute with streaming
      await this.executeWithRateLimit(async () => {
        const response = await this.agentRuntimeClient.send(command);
        await this.processAgentResponseStreaming(response, {
          onChunk,
          onCitation,
          onMetadata,
          onComplete: (finalData) => {
            const totalTime = Date.now() - startTime;
            
            // Session-based storage removed - conversation history now managed by frontend

            onComplete({
              sessionId: actualSessionId,
              totalTime: `${totalTime}ms`,
              tokensUsed: finalData.tokensUsed || 0,
              citationCount: finalData.citationCount || 0,
              fullText: finalData.fullText || "",
              analysis: analysis,
              appliedFilters: options.dataSources || null,
            });
          },
          onError
        });
      });

    } catch (error) {
      logger.error("Streaming agent invocation failed:", {
        error: error.message,
        agentId: this.agentId,
        sessionId: sessionId,
        query: query.substring(0, 100) + "...",
        hasFilters: !!options.dataSources,
        streaming: true,
      });

      // Provide specific error handling for common issues
      if (error.name === "ResourceNotFoundException") {
        onError(new Error(
          `Bedrock Agent not found. Please verify BEDROCK_AGENT_ID: ${this.agentId}`
        ));
      } else if (error.name === "AccessDeniedException") {
        onError(new Error(
          "Access denied to Bedrock Agent. Please check IAM permissions."
        ));
      } else if (error.name === "ThrottlingException") {
        onError(new Error(
          "Agent request was throttled. Please try again in a moment."
        ));
      } else {
        onError(new Error(`Agent streaming invocation failed: ${error.message}`));
      }
    }
  }

  /**
   * Process the streaming agent response with real-time callbacks
   * @param {Object} response - Raw agent response
   * @param {Object} streamCallbacks - Streaming callback functions
   * @returns {Promise<void>}
   */
  async processAgentResponseStreaming(response, streamCallbacks) {
    const startTime = Date.now();
    let fullText = "";
    let citations = [];
    let trace = null;
    let tokensUsed = 0;
    let chunkCount = 0; // Track chunk count like Python version

    const {
      onChunk = () => {},
      onCitation = () => {},
      onMetadata = () => {},
      onComplete = () => {},
      onError = () => {}
    } = streamCallbacks;

    try {
      logger.info("🔍 ANALYZING AWS RESPONSE STRUCTURE:", {
        hasCompletion: !!response.completion,
        responseType: typeof response,
        responseKeys: Object.keys(response || {}),
        completionType: response.completion ? typeof response.completion : 'none',
        isAsyncIterable: response.completion ? Symbol.asyncIterator in response.completion : false
      });

      // Handle streaming response
      if (response.completion) {
        for await (const chunk of response.completion) {
          chunkCount++;
          const elapsed = Date.now() - startTime;
          
          logger.info(`📦 CHUNK #${chunkCount} (at ${elapsed}ms):`, {
            chunkKeys: Object.keys(chunk || {}),
            hasChunk: !!chunk.chunk,
            hasTrace: !!chunk.trace,
            chunkType: typeof chunk
          });

          // Process text chunks (simplified like Python version)
          if (chunk.chunk && chunk.chunk.bytes) {
            try {
              const textChunk = new TextDecoder().decode(chunk.chunk.bytes);
              fullText += textChunk;
              
              // Send chunk immediately to frontend
              onChunk(textChunk);
              
              logger.info("✅ TEXT CHUNK DECODED:", {
                length: textChunk.length,
                preview: textChunk.substring(0, 50) + (textChunk.length > 50 ? "..." : ""),
                totalSoFar: fullText.length
              });
              
            } catch (error) {
              logger.error("❌ Error decoding chunk:", error.message);
            }
          }

          // Process attribution/citations  
          if (chunk.chunk && chunk.chunk.attribution) {
            const newCitations = chunk.chunk.attribution.citations || [];
            citations.push(...newCitations);
            
            // Send citations to callback immediately
            newCitations.forEach(citation => {
              const processedCitation = {
                content: citation.generatedResponsePart?.textResponsePart?.text || '',
                metadata: citation.retrievedReferences || [],
                documentId: citation.retrievedReferences?.[0]?.location?.s3Location?.uri || '',
                relevanceScore: citation.retrievedReferences?.[0]?.metadata?.score || 0,
                title: citation.retrievedReferences?.[0]?.metadata?.title || 'Unknown Source',
                url: citation.retrievedReferences?.[0]?.location?.s3Location?.uri || '#'
              };
              onCitation(processedCitation);
            });
            
            logger.debug("Streamed citations:", { count: newCitations.length });
          }

          // Check for different chunk formats
          if (chunk.bytes) {
            logger.info("🔍 PROCESSING DIRECT CHUNK.BYTES");
            try {
              const textChunk = new TextDecoder().decode(chunk.bytes);
              fullText += textChunk;
              onChunk(textChunk);
              logger.info("✅ DIRECT BYTES CHUNK RECEIVED:", {
                length: textChunk.length,
                preview: textChunk.substring(0, 50) + "..."
              });
            } catch (error) {
              logger.error("❌ ERROR DECODING DIRECT BYTES:", error.message);
            }
          }

          // Process final response chunk
          if (chunk.finalResponse) {
            logger.info("🔍 PROCESSING FINAL RESPONSE:", {
              hasText: !!chunk.finalResponse.text,
              finalResponseKeys: Object.keys(chunk.finalResponse)
            });
            
            if (chunk.finalResponse.text) {
              const finalText = chunk.finalResponse.text;
              fullText += finalText;
              onChunk(finalText);
              logger.info("✅ FINAL RESPONSE TEXT RECEIVED:", {
                length: finalText.length,
                preview: finalText.substring(0, 50) + "..."
              });
            } else {
              logger.warn("⚠️ FINAL RESPONSE HAS NO TEXT:", chunk.finalResponse);
            }
          }

          // Process trace information (for debugging)
          if (chunk.trace) {
            trace = chunk.trace;
            onMetadata({ trace: chunk.trace });
            logger.debug("Streamed trace information");
          }

          // Track token usage if available
          if (chunk.metadata?.usage) {
            tokensUsed =
              chunk.metadata.usage.inputTokens +
              chunk.metadata.usage.outputTokens;
            onMetadata({ tokensUsed });
            logger.info("📊 TOKEN USAGE:", chunk.metadata.usage);
          }
          
          // Log if chunk doesn't match any expected patterns
          if (!chunk.chunk && !chunk.bytes && !chunk.finalResponse && !chunk.trace && !chunk.metadata?.usage) {
            logger.warn("❓ UNKNOWN CHUNK FORMAT:", {
              chunkKeys: Object.keys(chunk),
              chunkType: typeof chunk
            });
          }
        }
      }

      // If no text was captured, check if response has direct text
      if (!fullText && response.output) {
        fullText = response.output;
        onChunk(fullText);
        logger.debug("Streamed direct output:", { length: fullText.length });
      }

      // Alternative handling: If streaming didn't work, try immediate chunking
      if (!fullText && response.completion) {
        logger.warn("⚠️ No streaming chunks detected, attempting alternative processing");
        try {
          const completionArray = [];
          for await (const chunk of response.completion) {
            completionArray.push(chunk);
          }
          
          if (completionArray.length === 1 && completionArray[0].chunk?.bytes) {
            // Single large chunk - simulate streaming
            const fullResponse = new TextDecoder().decode(completionArray[0].chunk.bytes);
            logger.info("🔄 SIMULATING STREAMING from single chunk:", { length: fullResponse.length });
            
            // Stream word by word with short delays
            const words = fullResponse.split(' ');
            for (let i = 0; i < words.length; i++) {
              const word = i === 0 ? words[i] : ' ' + words[i];
              onChunk(word);
              fullText += word;
              await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
            }
          }
        } catch (altError) {
          logger.error("Alternative streaming failed:", altError);
        }
      }

      const responseTime = Date.now() - startTime;

      logger.info("Streaming agent response completed:", {
        textLength: fullText.length,
        citationCount: citations.length,
        responseTime: `${responseTime}ms`,
        tokensUsed,
        hasText: !!fullText,
      });

      // Call completion callback with final data
      onComplete({
        fullText,
        citations,
        trace,
        responseTime,
        tokensUsed,
        citationCount: citations.length
      });

    } catch (error) {
      logger.error("Error processing streaming agent response:", error);
      onError(new Error(`Failed to process streaming agent response: ${error.message}`));
    }
  }

  /**
   * Build final response object
   * @param {string} sessionId - Session identifier
   * @param {Object} agentResponse - Processed agent response
   * @param {Object} analysis - Query analysis
   * @param {Object} dataSources - Data sources used for filtering (if any)
   * @param {Object} inferenceParams - Inference parameters used (temperature, topP, model, systemPrompt)
   * @returns {Object} - Final response
   */
  buildFinalResponse(
    sessionId,
    agentResponse,
    analysis,
    dataSources,
    inferenceParams = {}
  ) {
    // Session context tracking removed - now using direct conversation history

    return {
      sessionId: sessionId,
      answer: agentResponse.text || "",
      answerHTML: agentResponse.html || agentResponse.text || "", // Add HTML version
      citations: agentResponse.citations || [],
      trace: agentResponse.trace,
      analysis: analysis,
      session: {
        interactionStyle: analysis.interactionStyle,
        // Session information simplified - no server-side session tracking
        conversationHistory: {
          // Frontend manages conversation history now
        },
      },
      metadata: {
        agentId: this.agentId,
        agentAliasId: inferenceParams.agentAliasId || 'unknown', // Use the alias from inference params
        responseTime: agentResponse.responseTime,
        tokensUsed: agentResponse.tokensUsed,
        timestamp: new Date().toISOString(),
        dataSourcesUsed: dataSources || [],
        conversationContextUsed:
          inferenceParams.conversationContextUsed || false,
        historySettings: inferenceParams.historyOptions || {},
        inferenceParameters: {
          temperature: inferenceParams.temperature,
          topP: inferenceParams.topP,
          model: inferenceParams.model,
          hasSystemPrompt: !!inferenceParams.systemPrompt,
        },
        // Add HTML processing metadata
        htmlFormatting: agentResponse.htmlMetadata || {
          format: 'text',
          processingTime: 0,
          enhanced: false
        },
      },
    };
  }
}

module.exports = new BedrockAgentService();

