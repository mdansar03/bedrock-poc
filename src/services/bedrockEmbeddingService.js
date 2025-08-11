const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const logger = require('../utils/logger');

class BedrockEmbeddingService {
  constructor() {
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });
    
    this.embeddingModel = process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
    
    // Rate limiting for embeddings
    this.lastRequestTime = 0;
    this.minInterval = 100; // 100ms between embedding requests
  }

  /**
   * Generate embeddings for text (replaces OpenAI text-embedding-3-large)
   * @param {string} text - Text to embed
   * @returns {Promise<Array>} - Embedding vector
   */
  async generateEmbedding(text) {
    try {
      // Rate limiting
      await this.enforceRateLimit();
      
      const body = JSON.stringify({
        inputText: text.substring(0, 8000), // Titan V2 limit
        dimensions: 1024, // Titan V2 default (can be 256, 512, 1024)
        normalize: true
      });

      const command = new InvokeModelCommand({
        modelId: this.embeddingModel,
        body: body,
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      logger.debug(`Generated embedding for text length: ${text.length}`);
      return responseBody.embedding;
    } catch (error) {
      logger.error('Error generating embedding:', {
        error: error.message,
        textLength: text.length,
        model: this.embeddingModel
      });
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts with batch processing
   * @param {Array<string>} texts - Array of texts to embed
   * @param {Object} options - Options for batch processing
   * @returns {Promise<Array<Array>>} - Array of embedding vectors
   */
  async generateEmbeddings(texts, options = {}) {
    const { batchSize = 5, concurrency = 2 } = options;
    const embeddings = [];
    
    logger.info(`Generating embeddings for ${texts.length} texts`);
    
    // Process in batches to avoid rate limits
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.generateEmbedding(text));
      
      // Limit concurrency
      const batchResults = await this.processConcurrently(batchPromises, concurrency);
      embeddings.push(...batchResults);
      
      logger.debug(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
    }
    
    return embeddings;
  }

  /**
   * Process promises with limited concurrency
   * @param {Array<Promise>} promises - Array of promises
   * @param {number} concurrency - Maximum concurrent operations
   * @returns {Promise<Array>} - Results
   */
  async processConcurrently(promises, concurrency) {
    const results = [];
    
    for (let i = 0; i < promises.length; i += concurrency) {
      const batch = promises.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Enforce rate limiting between requests
   */
  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Get embedding model information
   * @returns {Object} - Model information
   */
  getModelInfo() {
    return {
      modelId: this.embeddingModel,
      dimensions: 1024, // Titan V2 default
      maxInputLength: 8000,
      provider: 'Amazon'
    };
  }

  /**
   * Compare embeddings using cosine similarity
   * @param {Array} embedding1 - First embedding vector
   * @param {Array} embedding2 - Second embedding vector
   * @returns {number} - Cosine similarity score (0-1)
   */
  cosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }
}

module.exports = new BedrockEmbeddingService();