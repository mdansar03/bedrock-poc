const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockAgentClient, GetAgentCommand, CreateAgentCommand, UpdateAgentCommand, PrepareAgentCommand } = require('@aws-sdk/client-bedrock-agent');
const logger = require('../utils/logger');

/**
 * Enhanced Bedrock Agent Service for intelligent knowledge retrieval
 * This service manages Bedrock Agents that can access knowledge bases,
 * perform reasoning, and provide contextual responses.
 */
class BedrockAgentService {
  constructor() {
    // Initialize Bedrock Agent Runtime Client for agent interactions
    this.agentRuntimeClient = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent-runtime.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
      maxAttempts: 3,
    });

    // Initialize Bedrock Agent Client for agent management
    this.agentClient = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
      maxAttempts: 3,
    });

    // Agent configuration
    this.agentId = process.env.BEDROCK_AGENT_ID;
    this.agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID'; // Default test alias
    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    
    // Log configuration for debugging
    logger.debug('Bedrock Agent Service Configuration:', {
      hasAgentId: !!this.agentId,
      agentId: this.agentId ? `${this.agentId.substring(0, 8)}...` : 'Not configured',
      agentAliasId: this.agentAliasId,
      hasKnowledgeBaseId: !!this.knowledgeBaseId,
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    // Session management
    this.activeSessions = new Map();
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
    
    // Rate limiting configuration
    this.requestQueue = [];
    this.activeRequests = 0;
    this.maxConcurrentRequests = 2;
    this.rateLimitDelay = 1000; // 1 second between requests
    
    // Use centralized prompt manager for all instructions

    // Initialize cleanup interval for expired sessions
    this.initializeSessionCleanup();
  }

  /**
   * Initialize session cleanup to remove expired sessions
   */
  initializeSessionCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (now - session.lastActivity > this.sessionTimeout) {
          this.activeSessions.delete(sessionId);
          logger.debug(`Cleaned up expired session: ${sessionId}`);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Get or create a session for conversation continuity
   * @param {string} sessionId - Session identifier
   * @param {Object} sessionConfig - Session configuration
   * @returns {Object} - Session object
   */
  getOrCreateSession(sessionId, sessionConfig = {}) {
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    if (!this.activeSessions.has(sessionId)) {
      this.activeSessions.set(sessionId, {
        id: sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        context: {
          topics: [],
          preferences: {},
          ...sessionConfig
        },
        // Enhanced conversation history storage
        conversationHistory: [],
        historyMetadata: {
          totalMessages: 0,
          firstMessageAt: Date.now(),
          lastMessageAt: Date.now(),
          avgResponseTime: 0,
          totalTokensUsed: 0
        }
      });
      logger.debug(`Created new agent session: ${sessionId}`);
    }

    const session = this.activeSessions.get(sessionId);
    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Add message to conversation history
   * @param {string} sessionId - Session identifier
   * @param {Object} messageData - Message data to store
   */
  addToConversationHistory(sessionId, messageData) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      logger.warn(`Attempted to add history to non-existent session: ${sessionId}`);
      return;
    }

    const historyEntry = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: messageData.type, // 'user' or 'assistant'
      content: messageData.content,
      metadata: messageData.metadata || {},
      ...messageData
    };

    session.conversationHistory.push(historyEntry);
    session.historyMetadata.totalMessages++;
    session.historyMetadata.lastMessageAt = Date.now();

    // Keep only last 50 messages to prevent memory issues
    if (session.conversationHistory.length > 50) {
      session.conversationHistory = session.conversationHistory.slice(-50);
    }

    // Update metadata
    if (messageData.responseTime) {
      const currentAvg = session.historyMetadata.avgResponseTime;
      const count = session.historyMetadata.totalMessages;
      session.historyMetadata.avgResponseTime = 
        (currentAvg * (count - 1) + messageData.responseTime) / count;
    }

    if (messageData.tokensUsed) {
      session.historyMetadata.totalTokensUsed += messageData.tokensUsed;
    }

    logger.debug(`Added ${messageData.type} message to session ${sessionId} history`);
  }

  /**
   * Get conversation history for a session
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Retrieval options
   * @returns {Object} - Conversation history and metadata
   */
  getConversationHistory(sessionId, options = {}) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return {
        history: [],
        metadata: null,
        error: 'Session not found'
      };
    }

    const {
      limit = 20,
      includeMetadata = true,
      messageType = null, // 'user', 'assistant', or null for all
      fromTimestamp = null,
      toTimestamp = null
    } = options;

    let history = [...session.conversationHistory];

    // Filter by message type if specified
    if (messageType) {
      history = history.filter(msg => msg.type === messageType);
    }

    // Filter by timestamp range if specified
    if (fromTimestamp) {
      history = history.filter(msg => new Date(msg.timestamp) >= new Date(fromTimestamp));
    }
    if (toTimestamp) {
      history = history.filter(msg => new Date(msg.timestamp) <= new Date(toTimestamp));
    }

    // Apply limit (get most recent messages)
    history = history.slice(-limit);

    const result = {
      sessionId: sessionId,
      history: history,
      totalMessages: session.conversationHistory.length,
      filtered: history.length !== session.conversationHistory.length
    };

    if (includeMetadata) {
      result.metadata = {
        ...session.historyMetadata,
        sessionAge: Date.now() - session.createdAt,
        lastActivity: session.lastActivity
      };
    }

    return result;
  }

  /**
   * Build conversation context for agent prompt enhancement
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Context building options
   * @returns {string} - Formatted conversation context
   */
  buildConversationContext(sessionId, options = {}) {
    const {
      maxMessages = 6, // Include last 6 messages (3 exchanges)
      includeTimestamps = false,
      prioritizeRecent = true,
      contextWeight = 'balanced' // 'light', 'balanced', 'heavy'
    } = options;

    const historyData = this.getConversationHistory(sessionId, { 
      limit: maxMessages,
      includeMetadata: true 
    });

    if (!historyData.history || historyData.history.length === 0) {
      return null;
    }

    let contextLines = [];

    // Add session context summary
    if (contextWeight !== 'light') {
      const topics = this.activeSessions.get(sessionId)?.context?.topics?.slice(-3) || [];
      if (topics.length > 0) {
        contextLines.push(`Previous conversation topics: ${topics.join(', ')}`);
      }
    }

    // Format conversation history
    contextLines.push('\nRecent conversation history:');
    
    historyData.history.forEach((msg, index) => {
      const isRecent = index >= historyData.history.length - 2; // Last 2 messages
      const weight = prioritizeRecent && isRecent ? '[RECENT] ' : '';
      const timestamp = includeTimestamps ? 
        `[${new Date(msg.timestamp).toLocaleTimeString()}] ` : '';
      
      const role = msg.type === 'user' ? 'Human' : 'Assistant';
      const content = msg.content.length > 200 ? 
        msg.content.substring(0, 200) + '...' : msg.content;
      
      contextLines.push(`${weight}${timestamp}${role}: ${content}`);
    });

    return contextLines.join('\n');
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
      'tell me more', 'what else', 'continue', 'also', 'additionally',
      'furthermore', 'can you explain', 'what about', 'how about'
    ];
    
    // Analytical indicators
    const analyticalIndicators = [
      'analyze', 'compare', 'evaluate', 'assess', 'review', 'examine',
      'pros and cons', 'advantages', 'disadvantages', 'benefits', 'risks',
      'strategy', 'approach', 'methodology', 'framework', 'best practices'
    ];
    
    // Technical indicators
    const technicalIndicators = [
      'implement', 'code', 'setup', 'configure', 'install', 'deploy',
      'api', 'function', 'method', 'class', 'algorithm', 'syntax',
      'debugging', 'error', 'troubleshoot', 'performance'
    ];
    
    // Determine interaction style
    let interactionStyle = 'knowledgeQuery'; // default
    let confidence = 0.5;
    
    const conversationalScore = conversationalIndicators.filter(indicator => 
      lowerQuery.includes(indicator)
    ).length;
    
    const analyticalScore = analyticalIndicators.filter(indicator => 
      lowerQuery.includes(indicator)
    ).length;
    
    const technicalScore = technicalIndicators.filter(indicator => 
      lowerQuery.includes(indicator)
    ).length;
    
    // Consider conversation history
    const hasContext = context.messageCount > 0;
    
    if (conversationalScore > 0 || hasContext) {
      interactionStyle = 'conversational';
      confidence = Math.min(0.9, 0.6 + (conversationalScore * 0.1) + (hasContext ? 0.2 : 0));
    } else if (analyticalScore > analyticalScore && analyticalScore > 0) {
      interactionStyle = 'analytical';
      confidence = Math.min(0.9, 0.6 + (analyticalScore * 0.15));
    }
    
    // Enhanced query construction based on analysis
    const queryEnhancement = this.buildQueryEnhancement(query, interactionStyle, context);
    
    return {
      originalQuery: query,
      interactionStyle,
      confidence,
      queryEnhancement,
      suggestedPrompt: null, // Simplified - no complex prompt management
      technicalScore,
      conversationalScore,
      analyticalScore,
      hasContext
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
      const recentTopics = context.topics.slice(-3).join(', ');
      enhancement += `\n\nContext from our conversation: We've been discussing ${recentTopics}.`;
    }
    
    // Add style-specific enhancements
    switch (style) {
      case 'conversational':
        enhancement += `\n\nPlease provide a conversational response that builds on our discussion.`;
        break;
      case 'analytical':
        enhancement += `\n\nPlease provide a comprehensive analytical response with multiple perspectives, pros/cons, and strategic insights.`;
        break;
      default:
        enhancement += `\n\nPlease provide a detailed, well-structured response with relevant examples and context.`;
    }
    
    return enhancement;
  }

  /**
   * Apply data source filtering to enhance the query with specific source constraints
   * @param {string} query - The original user query
   * @param {Object} dataSources - Object containing arrays of data sources to filter by
   * @returns {string} - The enhanced query with data source filtering instructions
   */
  applyDataSourceFiltering(query, dataSources) {
    if (!dataSources || (
      (!dataSources.websites || dataSources.websites.length === 0) &&
      (!dataSources.pdfs || dataSources.pdfs.length === 0) &&
      (!dataSources.documents || dataSources.documents.length === 0)
    )) {
      return query;
    }

    let filterInstructions = [];
    
    // Build specific filtering instructions for each data source type
    if (dataSources.websites && dataSources.websites.length > 0) {
      filterInstructions.push(`From websites: ${dataSources.websites.join(', ')}`);
    }
    
    if (dataSources.pdfs && dataSources.pdfs.length > 0) {
      filterInstructions.push(`From PDF documents: ${dataSources.pdfs.join(', ')}`);
    }
    
    if (dataSources.documents && dataSources.documents.length > 0) {
      filterInstructions.push(`From uploaded documents: ${dataSources.documents.join(', ')}`);
    }

    const sourceFilterInstruction = `
    
IMPORTANT DATA SOURCE RESTRICTIONS:
Please ONLY use information from the following specified data sources:
${filterInstructions.join('\n')}

If the information you need to answer the question is not available in these specific data sources, you MUST clearly state that the information is not available in the selected sources and suggest expanding the search to other sources if needed.

Do NOT use information from any other data sources not explicitly listed above.`;

    return query + sourceFilterInstruction;
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
  async invokeAgent(query, sessionId = null, options = {}) {
    try {
      // Validate agent configuration
      if (!this.agentId) {
        throw new Error('BEDROCK_AGENT_ID is not configured. Please set up a Bedrock Agent first.');
      }

      const startTime = Date.now();

      // Get or create session
      const session = this.getOrCreateSession(sessionId, options.sessionConfig);
      
      // Store user message in conversation history
      this.addToConversationHistory(session.id, {
        type: 'user',
        content: query,
        metadata: {
          hasDataSourceFilters: !!options.dataSources,
          hasCustomModel: !!options.model,
          hasSystemPrompt: !!options.systemPrompt,
          temperature: options.temperature,
          topP: options.topP,
          timestamp: new Date().toISOString()
        }
      });
      
      // Analyze query and determine approach
      const analysis = this.analyzeQuery(query, session.context);
      
      // Build conversation context if enabled
      const historyOptions = {
        enabled: true,
        maxMessages: 6,
        contextWeight: 'balanced',
        ...options.history
      };
      
      let conversationContext = null;
      if (historyOptions.enabled && session.conversationHistory.length > 1) {
        conversationContext = this.buildConversationContext(session.id, {
          maxMessages: historyOptions.maxMessages,
          contextWeight: historyOptions.contextWeight,
          prioritizeRecent: true
        });
      }
      
      logger.info(`Invoking Bedrock Agent for query analysis:`, {
        sessionId: session.id,
        queryLength: query.length,
        interactionStyle: analysis.interactionStyle,
        confidence: analysis.confidence,
        messageCount: session.messageCount,
        conversationHistoryLength: session.conversationHistory.length,
        hasConversationContext: !!conversationContext,
        hasDataSourceFilters: !!options.dataSources,
        hasCustomModel: !!options.model,
        hasSystemPrompt: !!options.systemPrompt,
        temperature: options.temperature,
        topP: options.topP,
        historyEnabled: historyOptions.enabled
      });

      // Apply data source filtering to the query if specified
      let enhancedQuery = options.useEnhancement !== false ? 
        analysis.queryEnhancement : query;

      // Add conversation context to enhance query with history
      if (conversationContext) {
        enhancedQuery = `CONVERSATION CONTEXT:
${conversationContext}

CURRENT QUERY: ${enhancedQuery}

Please answer the current query while being aware of the conversation context above. Prioritize the current query but use the conversation history to provide more relevant and coherent responses.`;
        logger.info('Applied conversation context to query');
      }

      // Apply system prompt if provided
      if (options.systemPrompt) {
        enhancedQuery = `${options.systemPrompt}\n\nUser Query: ${enhancedQuery}`;
        logger.info('Applied custom system prompt to query');
      }

      if (options.dataSources) {
        enhancedQuery = this.applyDataSourceFiltering(enhancedQuery, options.dataSources);
        logger.info('Applied data source filtering to query');
      }

      // Prepare agent invocation parameters
      const agentParams = {
        agentId: this.agentId,
        agentAliasId: this.agentAliasId,
        sessionId: session.id,
        inputText: enhancedQuery,
        // Enable trace for debugging (optional)
        enableTrace: process.env.NODE_ENV === 'development',
        // Session state (if any)
        sessionState: options.sessionState || {}
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
        
        logger.info('Added inference configuration to agent params:', agentParams.inferenceConfiguration);
      }

      // Add foundation model override if provided
      if (options.model) {
        // Model override is typically handled at the agent level, not per-invocation
        // But we'll log it for debugging purposes
        logger.info('Model override requested (handled at agent configuration level):', options.model);
      }

      logger.debug('Agent invocation parameters:', {
        agentId: this.agentId,
        agentAliasId: this.agentAliasId,
        sessionId: session.id,
        queryPreview: enhancedQuery.substring(0, 150) + '...',
        enableTrace: agentParams.enableTrace,
        filtersApplied: !!options.dataSources,
        hasInferenceConfig: !!agentParams.inferenceConfiguration,
        inferenceConfig: agentParams.inferenceConfiguration,
        customModel: options.model,
        hasSystemPrompt: !!options.systemPrompt
      });

      // Create the invoke agent command
      const command = new InvokeAgentCommand(agentParams);
      
      // Add to rate limiting queue
      const response = await this.executeWithRateLimit(async () => {
        return await this.agentRuntimeClient.send(command);
      });

      logger.debug('Raw AWS response received:', {
        hasCompletion: !!response.completion,
        responseType: typeof response,
        responseKeys: Object.keys(response || {})
      });

      // Process the streaming response
      const agentResponse = await this.processAgentResponse(response);

      // If no text was captured, try alternative processing
      if (!agentResponse.text) {
        logger.warn('No text in initial response processing, trying alternative methods...');
        const alternativeResponse = await this.processAgentResponseAlternative(response);
        if (alternativeResponse.text) {
          logger.info('Alternative processing successful, using alternative response');
          return this.buildFinalResponse(session, alternativeResponse, analysis, options.dataSources, {
            temperature: options.temperature,
            topP: options.topP,
            model: options.model,
            systemPrompt: options.systemPrompt
          });
        } else {
          // Final fallback - provide an informative response
          logger.error('All processing methods failed, providing fallback response');
          const fallbackResponse = {
            text: `I apologize, but I'm having trouble processing your query "${analysis.originalQuery}" at the moment. This could be due to a temporary service issue or configuration problem. Please try rephrasing your question or contact support if the issue persists.`,
            citations: [],
            trace: null,
            responseTime: Date.now() - Date.parse(new Date().toISOString()),
            tokensUsed: 0
          };
          return this.buildFinalResponse(session, fallbackResponse, analysis, options.dataSources, {
            temperature: options.temperature,
            topP: options.topP,
            model: options.model,
            systemPrompt: options.systemPrompt
          });
        }
      }

      logger.info('Agent response processed successfully:', {
        sessionId: session.id,
        responseLength: agentResponse.text?.length || 0,
        citationCount: agentResponse.citations?.length || 0,
        traceAvailable: !!agentResponse.trace,
        filtersApplied: !!options.dataSources,
        conversationContextUsed: !!conversationContext
      });

      const responseTime = Date.now() - startTime;

      // Store assistant response in conversation history
      this.addToConversationHistory(session.id, {
        type: 'assistant',
        content: agentResponse.text || '',
        responseTime: responseTime,
        tokensUsed: agentResponse.tokensUsed || 0,
        metadata: {
          citationCount: agentResponse.citations?.length || 0,
          hasTrace: !!agentResponse.trace,
          filtersApplied: !!options.dataSources,
          conversationContextUsed: !!conversationContext,
          inferenceParams: {
            temperature: options.temperature,
            topP: options.topP,
            model: options.model,
            hasSystemPrompt: !!options.systemPrompt
          },
          timestamp: new Date().toISOString()
        }
      });

      return this.buildFinalResponse(session, agentResponse, analysis, options.dataSources, {
        temperature: options.temperature,
        topP: options.topP,
        model: options.model,
        systemPrompt: options.systemPrompt,
        conversationContextUsed: !!conversationContext,
        historyOptions: historyOptions
      });

    } catch (error) {
      logger.error('Agent invocation failed:', {
        error: error.message,
        agentId: this.agentId,
        sessionId: sessionId,
        query: query.substring(0, 100) + '...',
        hasFilters: !!options.dataSources
      });
      
      // Provide specific error handling for common issues
      if (error.name === 'ResourceNotFoundException') {
        throw new Error(`Bedrock Agent not found. Please verify BEDROCK_AGENT_ID: ${this.agentId}`);
      } else if (error.name === 'AccessDeniedException') {
        throw new Error('Access denied to Bedrock Agent. Please check IAM permissions.');
      } else if (error.name === 'ThrottlingException') {
        throw new Error('Agent request was throttled. Please try again in a moment.');
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
    let fullText = '';
    let citations = [];
    let trace = null;
    let tokensUsed = 0;

    try {
      logger.debug('Raw agent response structure:', {
        hasCompletion: !!response.completion,
        responseKeys: Object.keys(response || {})
      });

      // Handle streaming response
      if (response.completion) {
        for await (const chunk of response.completion) {
          logger.debug('Processing chunk:', {
            chunkType: typeof chunk,
            hasChunk: !!chunk.chunk,
            hasTrace: !!chunk.trace,
            chunkKeys: Object.keys(chunk || {})
          });

          // Process chunk data
          if (chunk.chunk) {
            const chunkData = chunk.chunk;
            
            // Process text chunks
            if (chunkData.bytes) {
              const textChunk = new TextDecoder().decode(chunkData.bytes);
              fullText += textChunk;
              logger.debug('Added text chunk:', { length: textChunk.length, preview: textChunk.substring(0, 100) });
            }
            
            // Process attribution/citations
            if (chunkData.attribution) {
              const newCitations = chunkData.attribution.citations || [];
              citations.push(...newCitations);
              logger.debug('Added citations:', { count: newCitations.length });
            }
          }

          // Check for different chunk formats
          if (chunk.bytes) {
            const textChunk = new TextDecoder().decode(chunk.bytes);
            fullText += textChunk;
            logger.debug('Added direct bytes chunk:', { length: textChunk.length });
          }

          // Process final response chunk
          if (chunk.finalResponse) {
            if (chunk.finalResponse.text) {
              fullText += chunk.finalResponse.text;
              logger.debug('Added final response text:', { length: chunk.finalResponse.text.length });
            }
          }
          
          // Process trace information (for debugging)
          if (chunk.trace) {
            trace = chunk.trace;
            logger.debug('Trace information captured');
          }
          
          // Track token usage if available
          if (chunk.metadata?.usage) {
            tokensUsed = chunk.metadata.usage.inputTokens + chunk.metadata.usage.outputTokens;
          }
        }
      }

      // If no text was captured, check if response has direct text
      if (!fullText && response.output) {
        fullText = response.output;
        logger.debug('Using direct output:', { length: fullText.length });
      }

      const responseTime = Date.now() - startTime;

      logger.info('Agent response processed:', {
        textLength: fullText.length,
        citationCount: citations.length,
        responseTime: `${responseTime}ms`,
        tokensUsed,
        hasText: !!fullText
      });

      // If still no text, log the full response structure for debugging
      if (!fullText) {
        logger.warn('No text captured from agent response. Full response structure:', {
          response: JSON.stringify(response, null, 2).substring(0, 1000)
        });
      }

      return {
        text: fullText.trim(),
        citations,
        trace,
        responseTime,
        tokensUsed
      };

    } catch (error) {
      logger.error('Error processing agent response:', error);
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
            const { requestFn: nextRequestFn, resolve: nextResolve, reject: nextReject } = this.requestQueue.shift();
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
    const words = query.toLowerCase().split(' ');
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'how', 'what', 'where', 'when', 'why', 'can', 'could', 'would', 'should'];
    
    const keyWords = words
      .filter(word => word.length > 3 && !stopWords.includes(word))
      .slice(0, 3); // Take first 3 key words
    
    return keyWords.join(' ') || 'general';
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
          error: 'No agent ID configured'
        };
      }

      const command = new GetAgentCommand({
        agentId: this.agentId
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
        agentAliasId: this.agentAliasId
      };

    } catch (error) {
      logger.error('Error getting agent info:', error);
      return {
        configured: false,
        error: error.message,
        agentId: this.agentId
      };
    }
  }

  /**
   * Get active sessions summary
   * @returns {Object} - Sessions summary
   */
  getSessionsSummary() {
    const sessions = Array.from(this.activeSessions.values());
    const now = Date.now();
    
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => now - s.lastActivity < 5 * 60 * 1000).length, // Active in last 5 minutes
      oldestSession: sessions.length > 0 ? Math.min(...sessions.map(s => s.createdAt)) : null,
      averageMessages: sessions.length > 0 ? sessions.reduce((sum, s) => sum + s.messageCount, 0) / sessions.length : 0,
      sessionTimeout: this.sessionTimeout,
      rateLimitConfig: {
        maxConcurrent: this.maxConcurrentRequests,
        activeRequests: this.activeRequests,
        queueLength: this.requestQueue.length,
        rateLimitDelay: this.rateLimitDelay
      }
    };
  }

  /**
   * Health check for the agent service
   * @returns {Promise<Object>} - Health status
   */
  async healthCheck() {
    try {
      const agentInfo = await this.getAgentInfo();
      const sessionsSummary = this.getSessionsSummary();
      
      const isHealthy = agentInfo.configured && agentInfo.status === 'PREPARED';
      
      return {
        healthy: isHealthy,
        agent: agentInfo,
        sessions: sessionsSummary,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Agent health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Test agent with a simple query
   * @returns {Promise<Object>} - Test result
   */
  async testAgent() {
    try {
      const testQuery = "Hello, can you tell me what information is available in your knowledge base?";
      
      logger.info('Testing agent with simple query...');
      
      const response = await this.invokeAgent(testQuery, 'agent-test-session', {
        useEnhancement: false,
        sessionConfig: { testMode: true }
      });
      
      return {
        success: true,
        query: testQuery,
        response: response.answer.substring(0, 200) + '...',
        sessionId: response.sessionId,
        citationCount: response.citations.length,
        responseTime: response.metadata.responseTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Agent test failed:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
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
    let fullText = '';
    let citations = [];
    let trace = null;
    let tokensUsed = 0;

    try {
      logger.debug('Trying alternative response processing...');

      // Check for different response structures
      if (response.completion) {
        // Try to process as async iterator
        try {
          const chunks = [];
          for await (const chunk of response.completion) {
            chunks.push(chunk);
          }
          
          logger.debug('Collected chunks:', { count: chunks.length });
          
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
          logger.debug('Iterator approach failed:', iteratorError.message);
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

      logger.debug('Alternative processing result:', {
        textLength: fullText.length,
        citationCount: citations.length,
        responseTime: `${responseTime}ms`
      });

      return {
        text: fullText.trim(),
        citations,
        trace,
        responseTime,
        tokensUsed
      };

    } catch (error) {
      logger.error('Alternative processing failed:', error);
      return {
        text: '',
        citations: [],
        trace: null,
        responseTime: Date.now() - startTime,
        tokensUsed: 0
      };
    }
  }

  /**
   * Build final response object
   * @param {Object} session - Session object
   * @param {Object} agentResponse - Processed agent response
   * @param {Object} analysis - Query analysis
   * @param {Object} dataSources - Data sources used for filtering (if any)
   * @param {Object} inferenceParams - Inference parameters used (temperature, topP, model, systemPrompt)
   * @returns {Object} - Final response
   */
  buildFinalResponse(session, agentResponse, analysis, dataSources, inferenceParams = {}) {
    // Update session context
    session.messageCount++;
    session.context.topics.push(this.extractTopicFromQuery(analysis.originalQuery));
    if (session.context.topics.length > 10) {
      session.context.topics = session.context.topics.slice(-10);
    }

    // Get current conversation history for response
    const currentHistory = this.getConversationHistory(session.id, { 
      limit: 10, 
      includeMetadata: false 
    });

    return {
      sessionId: session.id,
      answer: agentResponse.text || '',
      citations: agentResponse.citations || [],
      trace: agentResponse.trace,
      analysis: analysis,
      session: {
        messageCount: session.messageCount,
        topics: session.context.topics,
        interactionStyle: analysis.interactionStyle,
        // Enhanced session information with conversation history
        conversationHistory: {
          totalMessages: currentHistory.totalMessages,
          recentMessages: currentHistory.history?.slice(-4) || [], // Last 4 messages
          sessionAge: Date.now() - session.createdAt,
          avgResponseTime: session.historyMetadata?.avgResponseTime || 0
        }
      },
      metadata: {
        agentId: this.agentId,
        agentAliasId: this.agentAliasId,
        responseTime: agentResponse.responseTime,
        tokensUsed: agentResponse.tokensUsed,
        timestamp: new Date().toISOString(),
        dataSourcesUsed: dataSources || [],
        conversationContextUsed: inferenceParams.conversationContextUsed || false,
        historySettings: inferenceParams.historyOptions || {},
        inferenceParameters: {
          temperature: inferenceParams.temperature,
          topP: inferenceParams.topP,
          model: inferenceParams.model,
          hasSystemPrompt: !!inferenceParams.systemPrompt
        }
      }
    };
  }
}

module.exports = new BedrockAgentService();