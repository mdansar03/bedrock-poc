const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const logger = require('../utils/logger');

// Rate limiting and queue management
class RequestQueue {
  constructor(maxConcurrent = 3, minInterval = 1000) {
    this.maxConcurrent = maxConcurrent;
    this.minInterval = minInterval; // Minimum time between requests in milliseconds
    this.queue = [];
    this.running = 0;
    this.lastRequestTime = 0;
  }

  async add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const { requestFn, resolve, reject } = this.queue.shift();
    this.running++;

    try {
      // Ensure minimum interval between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.minInterval) {
        await new Promise(resolve => setTimeout(resolve, this.minInterval - timeSinceLastRequest));
      }
      this.lastRequestTime = Date.now();

      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      // Process next item in queue
      setTimeout(() => this.process(), 100);
    }
  }
}

class BedrockService {
  constructor() {
    this.agentRuntimeClient = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent-runtime.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
      maxAttempts: 3,
    });

    this.runtimeClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-runtime.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
      maxAttempts: 3,
    });

    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    this.defaultModelId = process.env.DEFAULT_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
    
    // Rate limiting and retry configuration
    this.requestQueue = new RequestQueue(
      parseInt(process.env.BEDROCK_MAX_CONCURRENT || '2', 10), // Max 2 concurrent requests
      parseInt(process.env.BEDROCK_MIN_INTERVAL || '1500', 10) // 1.5 seconds between requests
    );
    
    this.retryConfig = {
      maxRetries: parseInt(process.env.BEDROCK_MAX_RETRIES || '5', 10),
      baseDelay: parseInt(process.env.BEDROCK_BASE_DELAY || '2000', 10), // 2 seconds
      maxDelay: parseInt(process.env.BEDROCK_MAX_DELAY || '30000', 10), // 30 seconds
      jitterFactor: 0.1 // Add 10% random jitter
    };
    

    
    // Available foundation models
    this.availableModels = {
      'claude-3-sonnet': {
        id: 'anthropic.claude-3-sonnet-20240229-v1:0',
        name: 'Claude 3 Sonnet',
        provider: 'Anthropic',
        description: 'Balanced performance and speed'
      },
      'claude-3-haiku': {
        id: 'anthropic.claude-3-haiku-20240307-v1:0',
        name: 'Claude 3 Haiku',
        provider: 'Anthropic',
        description: 'Fast and efficient'
      },
      'titan-text-express': {
        id: 'amazon.titan-text-express-v1',
        name: 'Titan Text G1 - Express',
        provider: 'Amazon',
        description: 'Fast text generation'
      },
      'titan-embeddings': {
        id: 'amazon.titan-embed-text-v2:0',
        name: 'Titan Text Embeddings V2',
        provider: 'Amazon',
        description: 'Text embeddings model'
      }
    };
  }

  /**
   * Get available foundation models
   * @returns {Object} - Available models
   */
  getAvailableModels() {
    return this.availableModels;
  }

  /**
   * Check if error is retryable (rate limiting, throttling, or temporary failures)
   * @param {Error} error - The error to check
   * @returns {boolean} - Whether the error is retryable
   */
  isRetryableError(error) {
    // Check for rate limiting and throttling errors
    const retryableConditions = [
      error.name === 'ThrottlingException',
      error.name === 'TooManyRequestsException',
      error.code === 'TooManyRequestsException',
      error.code === 'ThrottlingException',
      error.message?.includes('rate is too high'),
      error.message?.includes('throttling'),
      error.message?.includes('too many requests'),
      error.$metadata?.httpStatusCode === 429,
      error.$metadata?.httpStatusCode === 503,
      error.$metadata?.httpStatusCode === 502,
      error.$metadata?.httpStatusCode === 504
    ];

    return retryableConditions.some(condition => condition);
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} retryCount - Current retry attempt (0-based)
   * @returns {number} - Delay in milliseconds
   */
  calculateRetryDelay(retryCount) {
    const { baseDelay, maxDelay, jitterFactor } = this.retryConfig;
    
    // Exponential backoff: delay = baseDelay * (2 ^ retryCount)
    let delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    
    // Add jitter to avoid thundering herd
    const jitter = delay * jitterFactor * Math.random();
    delay += jitter;
    
    return Math.floor(delay);
  }

  /**
   * Execute request with retry logic and rate limiting
   * @param {Function} requestFn - Function that makes the actual request
   * @param {string} operationName - Name of the operation for logging
   * @returns {Promise} - Request result
   */
  async executeWithRetry(requestFn, operationName = 'Bedrock request') {
    let lastError;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Add request to queue for rate limiting
        return await this.requestQueue.add(requestFn);
      } catch (error) {
        lastError = error;
        
        // Check if this is the last attempt
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          logger.warn(`${operationName} failed with non-retryable error:`, error.message);
          throw error;
        }
        
        // Calculate delay and wait
        const delay = this.calculateRetryDelay(attempt);
        logger.warn(`${operationName} attempt ${attempt + 1} failed (rate limited), retrying in ${delay}ms:`, {
          error: error.message,
          statusCode: error.$metadata?.httpStatusCode,
          retryAfter: delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // All retries exhausted
    logger.error(`${operationName} failed after ${this.retryConfig.maxRetries + 1} attempts:`, {
      finalError: lastError.message,
      statusCode: lastError.$metadata?.httpStatusCode
    });
    
    throw new Error(`${operationName} failed after multiple retries due to rate limiting. Please try again later.`);
  }

  /**
   * Get current queue status and rate limiting metrics
   * @returns {Object} - Queue status information
   */
  getQueueStatus() {
    return {
      queueLength: this.requestQueue.queue.length,
      runningRequests: this.requestQueue.running,
      maxConcurrent: this.requestQueue.maxConcurrent,
      minInterval: this.requestQueue.minInterval,
      lastRequestTime: this.requestQueue.lastRequestTime,
      timeSinceLastRequest: Date.now() - this.requestQueue.lastRequestTime,
      retryConfig: this.retryConfig
    };
  }

  /**
   * Check if service is currently being rate limited
   * @returns {boolean} - Whether service is experiencing rate limiting
   */
  isRateLimited() {
    const status = this.getQueueStatus();
    return status.queueLength > 0 || status.runningRequests >= status.maxConcurrent;
  }

  /**
   * Analyze query intent and determine appropriate prompt template
   * @param {string} query - User query
   * @returns {string} - Template type (general, technical, business)
   */
  analyzeQueryIntent(query) {
    const lowerQuery = query.toLowerCase();
    
    // Technical keywords
    const technicalKeywords = [
      'api', 'code', 'programming', 'development', 'implementation', 'configuration',
      'setup', 'install', 'deploy', 'technical', 'architecture', 'database',
      'server', 'framework', 'library', 'algorithm', 'debugging', 'error',
      'function', 'method', 'class', 'variable', 'syntax', 'compile',
      'aws', 'cloud', 'docker', 'kubernetes', 'git', 'github'
    ];
    
    // Business keywords
    const businessKeywords = [
      'strategy', 'market', 'business', 'revenue', 'profit', 'cost',
      'roi', 'investment', 'budget', 'pricing', 'customer', 'client',
      'sales', 'marketing', 'growth', 'scale', 'competitive', 'analysis',
      'workflow', 'process', 'efficiency', 'productivity', 'management',
      'leadership', 'team', 'project', 'milestone', 'deadline'
    ];
    
    const technicalMatches = technicalKeywords.filter(keyword => lowerQuery.includes(keyword)).length;
    const businessMatches = businessKeywords.filter(keyword => lowerQuery.includes(keyword)).length;
    
    if (technicalMatches > businessMatches && technicalMatches > 0) {
      return 'technical';
    } else if (businessMatches > 0) {
      return 'business';
    }
    
    return 'general';
  }

  /**
   * Simple query enhancement (simplified version)
   * @param {string} originalQuery - Original user query
   * @param {Object} options - Enhancement options (unused in simplified version)
   * @returns {string} - The original query (no complex enhancement)
   */
  enhanceQuery(originalQuery, options = {}) {
    // Simplified version - just return the original query
    // Complex prompt management has been removed
    return originalQuery;
  }

  /**
   * Create enhanced query specifically for RAG systems
   * @param {string} originalQuery - Original user query
   * @param {Object} options - Enhancement options
   * @returns {string} - Enhanced query optimized for RAG
   */
  createEnhancedRAGQuery(originalQuery, options = {}) {
    // Simplified version - just return the original query
    // Complex prompt management has been removed
    return originalQuery;
  }

  /**
   * Post-process response to enhance readability and structure
   * @param {string} response - Raw response from the model
   * @param {Object} options - Enhancement options
   * @returns {string} - Enhanced response
   */
  postProcessResponse(response, options = {}) {
    // Simplified version - just return the response as is
    // Complex post-processing has been removed
    if (!response || typeof response !== 'string') {
      return response;
    }
    return response.trim();
  }



  /**
   * Validate and get model ID
   * @param {string} modelKey - Model key or full model ID
   * @returns {string} - Full model ID
   */
  getModelId(modelKey) {
    if (!modelKey) {
      return this.defaultModelId;
    }
    
    // If it's a full model ID, use it directly
    if (modelKey.includes('.') || modelKey.includes(':')) {
      return modelKey;
    }
    
    // If it's a key, look it up
    const model = this.availableModels[modelKey];
    return model ? model.id : this.defaultModelId;
  }

  /**
   * Query the knowledge base using RAG with enhanced prompting
   * @param {string} query - User query
   * @param {string} sessionId - Session ID for conversation tracking
   * @param {string} modelKey - Model to use (optional)
   * @param {Object} enhancementOptions - Options for query enhancement
   * @returns {Promise<Object>} - Response from Bedrock
   */
  async queryKnowledgeBase(query, sessionId = null, modelKey = null, enhancementOptions = {}) {
    try {
      const selectedModelId = this.getModelId(modelKey);
      logger.info(`Querying knowledge base with: ${query}`);
      logger.info(`Using Knowledge Base ID: ${this.knowledgeBaseId}`);
      logger.info(`Using Model: ${selectedModelId}`);
      logger.info(`AWS Region: ${process.env.AWS_REGION}`);

      // Validate required configuration
      if (!this.knowledgeBaseId) {
        throw new Error('BEDROCK_KNOWLEDGE_BASE_ID is not configured');
      }

      // Enhance the query for more detailed responses
      const enhancedQuery = this.createEnhancedRAGQuery(query, enhancementOptions);
      
      logger.debug('Enhanced query for RAG:', {
        originalQuery: query,
        enhancedLength: enhancedQuery.length,
        options: enhancementOptions
      });

      // Create command without sessionId for new sessions
      const commandParams = {
        input: {
          text: enhancedQuery,
        },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: this.knowledgeBaseId,
            modelArn: `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/${selectedModelId}`,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 10,
              },
            },
          },
        },
      };

      // Only add sessionId if it's provided and not a health check
      if (sessionId && !sessionId.includes('health-check')) {
        commandParams.sessionId = sessionId;
        logger.info(`Using session ID: ${sessionId}`);
      }

      logger.info('Sending command to Bedrock with rate limiting...');
      const command = new RetrieveAndGenerateCommand(commandParams);
      
      // Execute with retry logic and rate limiting
      const response = await this.executeWithRetry(
        async () => await this.agentRuntimeClient.send(command),
        'Knowledge Base Query'
      );
      
      logger.info('Successfully received response from Bedrock Knowledge Base');
      logger.info(`Response contains ${response.citations?.length || 0} citations`);

      logger.debug('RAG response received:', {
        hasOutput: !!response.output?.text,
        citationCount: response.citations?.length || 0,
        sessionId: response.sessionId
      });
      
      const rawAnswer = response.output?.text || 'No answer generated';
      
      // Apply post-processing enhancement if enabled
      const enhancedAnswer = enhancementOptions.postProcess !== false 
        ? this.postProcessResponse(rawAnswer, enhancementOptions)
        : rawAnswer;
      
      return {
        answer: enhancedAnswer,
        sources: response.citations || [],
        sessionId: response.sessionId,
        metadata: {
          originalLength: rawAnswer.length,
          enhancedLength: enhancedAnswer.length,
          postProcessed: enhancementOptions.postProcess !== false
        }
      };
    } catch (error) {
      logger.error('Error querying knowledge base:', error);
      logger.error('Error details:', {
        message: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
        knowledgeBaseId: this.knowledgeBaseId,
        region: process.env.AWS_REGION
      });
      throw new Error(`Failed to query knowledge base: ${error.message}`);
    }
  }

  /**
   * Direct model invocation with enhanced prompting
   * @param {string} prompt - The prompt to send to the model
   * @param {string} modelKey - Model to use (optional, defaults to defaultModelId)
   * @param {Object} enhancementOptions - Options for prompt enhancement
   * @returns {Promise<string>} - Response from the model
   */
  async invokeModel(prompt, modelKey = null, enhancementOptions = {}) {
    try {
      const selectedModelId = this.getModelId(modelKey);
      logger.info('Invoking Bedrock model directly');
      logger.info(`Using model: ${selectedModelId}`);

      // Enhance the prompt if options are provided
      const enhancedPrompt = enhancementOptions.enhance !== false 
        ? this.enhanceQuery(prompt, enhancementOptions)
        : prompt;

      logger.debug('Enhanced prompt for direct invocation:', {
        originalLength: prompt.length,
        enhancedLength: enhancedPrompt.length,
        options: enhancementOptions
      });

      const body = JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: enhancementOptions.maxTokens || 2000, // Increased for more detailed responses
        messages: [
          {
            role: "user",
            content: enhancedPrompt
          }
        ],
        temperature: enhancementOptions.temperature || 0.7,
        top_p: enhancementOptions.topP || 0.9
      });

      const command = new InvokeModelCommand({
        modelId: selectedModelId,
        body: body,
        contentType: 'application/json',
        accept: 'application/json',
      });

      // Execute with retry logic and rate limiting
      const response = await this.executeWithRetry(
        async () => await this.runtimeClient.send(command),
        'Direct Model Invocation'
      );
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      logger.info('Successfully received response from Bedrock model');
      
      const rawResponse = responseBody.content[0].text;
      
      // Apply post-processing enhancement if enabled
      const enhancedResponse = enhancementOptions.postProcess !== false 
        ? this.postProcessResponse(rawResponse, enhancementOptions)
        : rawResponse;
      
      logger.debug('Direct model response processed:', {
        originalLength: rawResponse.length,
        enhancedLength: enhancedResponse.length,
        postProcessed: enhancementOptions.postProcess !== false
      });
      
      return enhancedResponse;
    } catch (error) {
      logger.error('Error invoking model:', error);
      throw new Error(`Failed to invoke model: ${error.message}`);
    }
  }

  /**
   * Health check for Bedrock service
   * @returns {Promise<boolean>} - Service health status
   */
  async healthCheck() {
    try {
      // Use direct model invocation for health check instead of knowledge base
      logger.info('Starting Bedrock health check...');
      logger.info(`Using default model: ${this.defaultModelId}`);
      
      const testPrompt = "Hello, respond with 'OK' if you can hear me.";
      const response = await this.invokeModel(testPrompt, this.defaultModelId, { enhance: false });
      
      logger.info('Bedrock health check completed successfully');
      return response && response.length > 0;
    } catch (error) {
      logger.error('Bedrock health check failed:', error);
      return false;
    }
  }
}

module.exports = new BedrockService();