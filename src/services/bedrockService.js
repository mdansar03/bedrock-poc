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
    
    // Enhanced prompting templates and configurations
    this.promptTemplates = {
      systemInstructions: {
        general: `You are an advanced AI assistant with access to a comprehensive knowledge base. Your goal is to provide detailed, accurate, and helpful responses.

RESPONSE GUIDELINES:
- Provide comprehensive and well-structured answers
- Include relevant details, examples, and context when available
- Use clear formatting with bullet points, numbered lists, or sections when appropriate
- Cite specific sources or references when available
- If information is not available in the knowledge base, clearly state this limitation
- Be conversational but professional in tone
- Break down complex topics into digestible sections
- Provide actionable insights when relevant

RESPONSE STRUCTURE:
1. Start with a direct answer to the main question
2. Provide detailed explanation with supporting information
3. Include relevant examples or use cases when applicable
4. Mention any important considerations or limitations
5. Suggest related topics or next steps when helpful`,

        technical: `You are a technical expert AI assistant with access to specialized documentation and knowledge. Focus on providing detailed, accurate technical information.

TECHNICAL RESPONSE GUIDELINES:
- Provide step-by-step instructions when applicable
- Include code examples, configurations, or technical specifications
- Explain technical concepts clearly for different skill levels
- Mention prerequisites, dependencies, or requirements
- Include troubleshooting tips or common pitfalls
- Reference specific documentation or best practices
- Use proper technical terminology while ensuring clarity
- Provide alternative approaches when relevant`,

        business: `You are a business-focused AI assistant with access to industry knowledge and best practices. Provide strategic and actionable business insights.

BUSINESS RESPONSE GUIDELINES:
- Focus on practical applications and business value
- Include market context and industry trends when relevant
- Provide strategic recommendations with clear rationale
- Mention potential risks, benefits, and considerations
- Include implementation timelines or resource requirements
- Reference industry standards or benchmarks
- Suggest metrics or KPIs for measuring success
- Consider different business scenarios or use cases`
      },
      
      enhancementPrompts: {
        elaboration: "Please provide a comprehensive and detailed response that includes:",
        structure: "Organize your response with clear sections and formatting:",
        context: "Consider the broader context and provide relevant background information:",
        examples: "Include specific examples, use cases, or practical applications:",
        actionable: "Make your response actionable with specific steps or recommendations:"
      }
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
   * Enhance query with detailed instructions for better responses
   * @param {string} originalQuery - Original user query
   * @param {Object} options - Enhancement options
   * @returns {string} - Enhanced query with instructions
   */
  enhanceQuery(originalQuery, options = {}) {
    const {
      responseType = 'auto', // auto, general, technical, business
      includeExamples = true,
      requestElaboration = true,
      structureResponse = true
    } = options;
    
    // Determine response type
    const template = responseType === 'auto' 
      ? this.analyzeQueryIntent(originalQuery)
      : responseType;
    
    const systemInstructions = this.promptTemplates.systemInstructions[template] || 
                              this.promptTemplates.systemInstructions.general;
    
    // Build enhancement instructions
    let enhancementInstructions = [];
    
    if (requestElaboration) {
      enhancementInstructions.push(this.promptTemplates.enhancementPrompts.elaboration);
      enhancementInstructions.push("- In-depth analysis of the topic");
      enhancementInstructions.push("- Relevant background information and context");
      enhancementInstructions.push("- Multiple perspectives or approaches when applicable");
    }
    
    if (structureResponse) {
      enhancementInstructions.push(this.promptTemplates.enhancementPrompts.structure);
      enhancementInstructions.push("- Clear headings and sections");
      enhancementInstructions.push("- Bullet points or numbered lists for key information");
      enhancementInstructions.push("- Logical flow from overview to details");
    }
    
    if (includeExamples) {
      enhancementInstructions.push(this.promptTemplates.enhancementPrompts.examples);
      enhancementInstructions.push("- Real-world scenarios or case studies");
      enhancementInstructions.push("- Specific implementation details");
      enhancementInstructions.push("- Code snippets or configuration examples (if technical)");
    }
    
    // Add actionable elements
    enhancementInstructions.push(this.promptTemplates.enhancementPrompts.actionable);
    enhancementInstructions.push("- Next steps or recommendations");
    enhancementInstructions.push("- Best practices or important considerations");
    enhancementInstructions.push("- Resources for further learning");
    
    // Construct the enhanced query
    const enhancedQuery = `${systemInstructions}

USER QUERY: "${originalQuery}"

${enhancementInstructions.join('\n')}

Please provide a comprehensive response that addresses all aspects of the query while following the guidelines above.`;
    
    logger.debug('Enhanced query:', {
      originalLength: originalQuery.length,
      enhancedLength: enhancedQuery.length,
      template: template,
      options: options
    });
    
    return enhancedQuery;
  }

  /**
   * Create enhanced query specifically for RAG systems
   * @param {string} originalQuery - Original user query
   * @param {Object} options - Enhancement options
   * @returns {string} - Enhanced query optimized for RAG
   */
  createEnhancedRAGQuery(originalQuery, options = {}) {
    const {
      responseType = 'auto',
      includeExamples = true,
      requestElaboration = true,
      structureResponse = true,
      includeContext = true
    } = options;
    
    // Determine the intent/domain of the query
    const intent = this.analyzeQueryIntent(originalQuery);
    
    // Build context-specific instructions that work well with RAG
    let instructions = [];
    
    // Add domain-specific context
    if (intent === 'technical') {
      instructions.push("Focus on technical details, implementation steps, and best practices.");
      if (includeExamples) {
        instructions.push("Include code examples, configurations, or technical specifications when available.");
      }
    } else if (intent === 'business') {
      instructions.push("Provide business-focused insights with strategic recommendations.");
      if (includeExamples) {
        instructions.push("Include business cases, ROI considerations, and implementation strategies.");
      }
    } else {
      instructions.push("Provide comprehensive information with practical insights.");
      if (includeExamples) {
        instructions.push("Include relevant examples and real-world applications.");
      }
    }
    
    // Add response structure instructions
    if (structureResponse) {
      instructions.push("Structure your response with clear sections and organized information.");
    }
    
    if (requestElaboration) {
      instructions.push("Provide detailed explanations with supporting context and background information.");
    }
    
    if (includeContext) {
      instructions.push("Include relevant context, considerations, and related topics that would be helpful.");
    }
    
    // Add actionable elements
    instructions.push("Include actionable recommendations, next steps, or best practices when applicable.");
    
    // Construct the enhanced query for RAG
    const enhancedQuery = `${originalQuery}

Please provide a comprehensive and detailed response that: ${instructions.join(' ')} Make sure to cite relevant sources and provide specific details from the knowledge base.`;
    
    return enhancedQuery;
  }

  /**
   * Post-process response to enhance readability and structure
   * @param {string} response - Raw response from the model
   * @param {Object} options - Enhancement options
   * @returns {string} - Enhanced response
   */
  postProcessResponse(response, options = {}) {
    if (!response || typeof response !== 'string') {
      return response;
    }
    
    let enhanced = response;
    
    // Add proper formatting and structure
    if (options.structureResponse !== false) {
      enhanced = this.improveResponseStructure(enhanced);
    }
    
    // Add emphasis to important points
    if (options.emphasizeKey !== false) {
      enhanced = this.emphasizeKeyPoints(enhanced);
    }
    
    // Ensure proper conclusion
    if (options.addConclusion !== false) {
      enhanced = this.ensureConclusion(enhanced);
    }
    
    return enhanced.trim();
  }

  /**
   * Improve response structure with better formatting
   * @param {string} response - Raw response
   * @returns {string} - Structured response
   */
  improveResponseStructure(response) {
    let structured = response;
    
    // Ensure proper spacing around sections
    structured = structured.replace(/([.!?])\s*([A-Z][^.!?]*:)/g, '$1\n\n**$2**');
    
    // Format numbered lists properly
    structured = structured.replace(/(\d+\.)\s*([A-Z])/g, '\n$1 **$2');
    structured = structured.replace(/\*\*([^*]+)\*\*([^*\n]+)/g, '**$1**$2**');
    
    // Ensure bullet points are properly formatted
    structured = structured.replace(/(?:^|\n)[\s]*[-•]\s*/gm, '\n• ');
    
    // Add spacing around paragraphs
    structured = structured.replace(/([.!?])\s*([A-Z][a-z])/g, '$1\n\n$2');
    
    return structured;
  }

  /**
   * Emphasize key points in the response
   * @param {string} response - Response text
   * @returns {string} - Response with emphasized key points
   */
  emphasizeKeyPoints(response) {
    let emphasized = response;
    
    // Emphasize important phrases
    const keyPhrases = [
      /\b(important|crucial|essential|critical|key|vital|significant)\b/gi,
      /\b(note that|remember|keep in mind|be aware)\b/gi,
      /\b(best practice|recommended|should|must)\b/gi
    ];
    
    keyPhrases.forEach(pattern => {
      emphasized = emphasized.replace(pattern, '**$&**');
    });
    
    return emphasized;
  }

  /**
   * Ensure response has a proper conclusion if needed
   * @param {string} response - Response text
   * @returns {string} - Response with conclusion
   */
  ensureConclusion(response) {
    // Check if response already has a conclusion
    const conclusionIndicators = [
      'in conclusion', 'to summarize', 'in summary', 'overall',
      'to conclude', 'finally', 'in the end', 'key takeaways'
    ];
    
    const hasConclusion = conclusionIndicators.some(indicator => 
      response.toLowerCase().includes(indicator)
    );
    
    // If it's a long response without conclusion, suggest next steps
    if (!hasConclusion && response.length > 500) {
      const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 3) {
        return response + '\n\n**Next Steps**: Consider exploring related topics or implementing the suggestions above based on your specific requirements.';
      }
    }
    
    return response;
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