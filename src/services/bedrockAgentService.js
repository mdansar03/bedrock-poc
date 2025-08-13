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
    
    // Session management
    this.activeSessions = new Map();
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
    
    // Rate limiting configuration
    this.requestQueue = [];
    this.activeRequests = 0;
    this.maxConcurrentRequests = 2;
    this.rateLimitDelay = 1000; // 1 second between requests
    
    // Agent prompt templates for different interaction types
    this.agentPrompts = {
      knowledgeQuery: {
        system: `You are an intelligent AI assistant with access to a comprehensive knowledge base. Your primary function is to provide accurate, detailed, and helpful responses to user queries by leveraging the available knowledge sources.

CORE CAPABILITIES:
- Access and analyze information from connected knowledge bases
- Provide detailed explanations with proper context
- Cite sources and provide references when available
- Understand complex queries and break them down into actionable insights
- Offer follow-up suggestions and related information

RESPONSE GUIDELINES:
1. Always search the knowledge base thoroughly before responding
2. Provide comprehensive answers with proper structure
3. Include relevant examples, code snippets, or practical applications when applicable
4. Cite specific sources from the knowledge base when referencing information
5. If information is not available, clearly state the limitation
6. Suggest related topics or follow-up questions when helpful
7. Maintain a professional yet conversational tone
8. Break down complex topics into digestible sections

QUERY ANALYSIS:
- Identify the main intent and scope of the user's question
- Determine what type of information would be most helpful
- Consider multiple perspectives or approaches when relevant
- Look for opportunities to provide actionable insights`,

        conversational: `You are having a conversation with a user about topics related to the knowledge base. Maintain context from previous exchanges while providing helpful and accurate information.

CONVERSATIONAL GUIDELINES:
- Reference previous parts of the conversation when relevant
- Build upon earlier topics and questions
- Maintain continuity in the discussion
- Provide natural, flowing responses that feel like a genuine conversation
- Ask clarifying questions when the intent is unclear
- Suggest natural next steps or related topics
- Remember user preferences and context from the session`,

        analytical: `You are an analytical AI assistant focused on providing in-depth analysis and insights. When responding to queries, prioritize comprehensive analysis over simple answers.

ANALYTICAL APPROACH:
- Break down complex problems into component parts
- Provide multi-faceted analysis from different angles
- Include pros and cons, benefits and risks
- Offer strategic recommendations when appropriate
- Compare and contrast different approaches or solutions
- Provide quantitative insights when data is available
- Consider both short-term and long-term implications
- Include industry context and best practices`
      }
    };

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
        }
      });
      logger.debug(`Created new agent session: ${sessionId}`);
    }

    const session = this.activeSessions.get(sessionId);
    session.lastActivity = Date.now();
    return session;
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
      suggestedPrompt: this.agentPrompts.knowledgeQuery[interactionStyle],
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
   * Invoke Bedrock Agent with enhanced query processing
   * @param {string} query - User query
   * @param {string} sessionId - Session ID for conversation continuity
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Agent response
   */
  async invokeAgent(query, sessionId = null, options = {}) {
    try {
      // Validate agent configuration
      if (!this.agentId) {
        throw new Error('BEDROCK_AGENT_ID is not configured. Please set up a Bedrock Agent first.');
      }

      // Get or create session
      const session = this.getOrCreateSession(sessionId, options.sessionConfig);
      
      // Analyze query and determine approach
      const analysis = this.analyzeQuery(query, session.context);
      
      logger.info(`Invoking Bedrock Agent for query analysis:`, {
        sessionId: session.id,
        queryLength: query.length,
        interactionStyle: analysis.interactionStyle,
        confidence: analysis.confidence,
        messageCount: session.messageCount
      });

      // Use enhanced query if analysis suggests it
      const finalQuery = options.useEnhancement !== false ? 
        analysis.queryEnhancement : query;

      // Prepare agent invocation parameters
      const agentParams = {
        agentId: this.agentId,
        agentAliasId: this.agentAliasId,
        sessionId: session.id,
        inputText: finalQuery,
        // Enable trace for debugging (optional)
        enableTrace: process.env.NODE_ENV === 'development',
        // Session state (if any)
        sessionState: options.sessionState || {}
      };

      logger.debug('Agent invocation parameters:', {
        agentId: this.agentId,
        agentAliasId: this.agentAliasId,
        sessionId: session.id,
        queryPreview: finalQuery.substring(0, 100) + '...',
        enableTrace: agentParams.enableTrace
      });

      // Create the invoke agent command
      const command = new InvokeAgentCommand(agentParams);
      
      // Add to rate limiting queue
      const response = await this.executeWithRateLimit(async () => {
        return await this.agentRuntimeClient.send(command);
      });

      // Process the streaming response
      const agentResponse = await this.processAgentResponse(response);
      
      // Update session context
      session.messageCount++;
      session.context.topics.push(this.extractTopicFromQuery(query));
      if (session.context.topics.length > 10) {
        session.context.topics = session.context.topics.slice(-10); // Keep last 10 topics
      }

      logger.info('Agent response processed successfully:', {
        sessionId: session.id,
        responseLength: agentResponse.text?.length || 0,
        citationCount: agentResponse.citations?.length || 0,
        traceAvailable: !!agentResponse.trace
      });

      return {
        sessionId: session.id,
        answer: agentResponse.text,
        citations: agentResponse.citations || [],
        trace: agentResponse.trace,
        analysis: analysis,
        session: {
          messageCount: session.messageCount,
          topics: session.context.topics,
          interactionStyle: analysis.interactionStyle
        },
        metadata: {
          agentId: this.agentId,
          agentAliasId: this.agentAliasId,
          responseTime: agentResponse.responseTime,
          tokensUsed: agentResponse.tokensUsed,
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      logger.error('Agent invocation failed:', {
        error: error.message,
        agentId: this.agentId,
        sessionId: sessionId,
        query: query.substring(0, 100) + '...'
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
      // Handle streaming response
      if (response.completion) {
        for await (const chunk of response.completion) {
          if (chunk.chunk) {
            const chunkData = chunk.chunk;
            
            // Process text chunks
            if (chunkData.bytes) {
              const textChunk = new TextDecoder().decode(chunkData.bytes);
              fullText += textChunk;
            }
            
            // Process attribution/citations
            if (chunkData.attribution) {
              citations.push(...(chunkData.attribution.citations || []));
            }
          }
          
          // Process trace information (for debugging)
          if (chunk.trace) {
            trace = chunk.trace;
          }
          
          // Track token usage if available
          if (chunk.metadata?.usage) {
            tokensUsed = chunk.metadata.usage.inputTokens + chunk.metadata.usage.outputTokens;
          }
        }
      }

      const responseTime = Date.now() - startTime;

      logger.debug('Agent response processed:', {
        textLength: fullText.length,
        citationCount: citations.length,
        responseTime: `${responseTime}ms`,
        tokensUsed
      });

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
}

module.exports = new BedrockAgentService();