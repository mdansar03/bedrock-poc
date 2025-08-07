const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const logger = require('../utils/logger');

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
   * Query the knowledge base using RAG
   * @param {string} query - User query
   * @param {string} sessionId - Session ID for conversation tracking
   * @param {string} modelKey - Model to use (optional)
   * @returns {Promise<Object>} - Response from Bedrock
   */
  async queryKnowledgeBase(query, sessionId = null, modelKey = null) {
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

      // Create command without sessionId for new sessions
      const commandParams = {
        input: {
          text: query,
        },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: this.knowledgeBaseId,
            modelArn: `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/${selectedModelId}`,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 5,
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

      logger.info('Sending command to Bedrock...');
      const command = new RetrieveAndGenerateCommand(commandParams);
      const response = await this.agentRuntimeClient.send(command);
      
      logger.info('Successfully received response from Bedrock Knowledge Base');
      logger.info(`Response contains ${response.citations?.length || 0} citations`);
      
      return {
        answer: response.output?.text || 'No answer generated',
        sources: response.citations || [],
        sessionId: response.sessionId,
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
   * Direct model invocation for simple queries
   * @param {string} prompt - The prompt to send to the model
   * @param {string} modelKey - Model to use (optional, defaults to defaultModelId)
   * @returns {Promise<string>} - Response from the model
   */
  async invokeModel(prompt, modelKey = null) {
    try {
      const selectedModelId = this.getModelId(modelKey);
      logger.info('Invoking Bedrock model directly');
      logger.info(`Using model: ${selectedModelId}`);

      const body = JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      const command = new InvokeModelCommand({
        modelId: selectedModelId,
        body: body,
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.runtimeClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      logger.info('Successfully received response from Bedrock model');
      
      return responseBody.content[0].text;
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
      const response = await this.invokeModel(testPrompt, this.defaultModelId);
      
      logger.info('Bedrock health check completed successfully');
      return response && response.length > 0;
    } catch (error) {
      logger.error('Bedrock health check failed:', error);
      return false;
    }
  }
}

module.exports = new BedrockService();