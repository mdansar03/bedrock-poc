const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand, ListIngestionJobsCommand } = require('@aws-sdk/client-bedrock-agent');
const { generateHash } = require('../utils/hash');
const logger = require('../utils/logger');

class BedrockKnowledgeBaseService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });

    this.bedrockAgent = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });

    this.bucket = process.env.BEDROCK_S3_BUCKET;
    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    this.dataSourceId = process.env.BEDROCK_DATA_SOURCE_ID;
    
    // Chunking configuration optimized for Bedrock
    this.chunkConfig = {
      maxChunkSize: 1000,     // Optimal for Bedrock retrieval
      overlapSize: 100,       // Character overlap between chunks
      minChunkSize: 100,      // Minimum viable chunk size
      separators: ['\n\n', '\n', '. ', '! ', '? ', '; ']
    };
  }

  /**
   * Store document in S3 and sync with Knowledge Base (replaces Pinecone storage)
   * @param {Object} document - Document object with content and metadata
   * @returns {Promise<Object>} - Storage result
   */
  async storeDocument(document) {
    try {
      const { content, metadata, title, url } = document;
      
      // Validate required fields
      if (!content || typeof content !== 'string') {
        throw new Error('Document content is required and must be a string');
      }
      
      // Clean and prepare content
      const cleanedContent = this.cleanContent(content);
      
      // Create optimized chunks
      const chunks = this.createOptimalChunks(cleanedContent);
      
      if (chunks.length === 0) {
        throw new Error('No valid chunks could be created from the content');
      }
      
      // Generate unique document ID
      const documentId = generateHash(url || title || content.substring(0, 100));
      const timestamp = new Date().toISOString();
      const s3Key = `documents/${timestamp.split('T')[0]}/${documentId}.txt`;
      
      // Format document for Bedrock
      const formattedContent = this.formatDocumentForBedrock(chunks, metadata, title, url);
      
      // Store in S3
      await this.uploadToS3(s3Key, formattedContent, {
        ...metadata,
        documentId,
        chunkCount: chunks.length,
        originalLength: content.length,
        processedLength: cleanedContent.length
      });
      
      // Trigger Knowledge Base sync (non-blocking)
      const syncJobId = await this.syncKnowledgeBase();
      
      logger.info(`Document stored successfully: ${s3Key}`, {
        documentId,
        chunkCount: chunks.length,
        syncJobId
      });
      
      return {
        documentId,
        s3Key,
        syncJobId,
        chunkCount: chunks.length,
        originalLength: content.length,
        processedLength: cleanedContent.length,
        success: true,
        timestamp
      };
    } catch (error) {
      logger.error('Error storing document:', {
        error: error.message,
        title: document.title,
        url: document.url
      });
      throw new Error(`Failed to store document: ${error.message}`);
    }
  }

  /**
   * Clean content for optimal processing
   * @param {string} content - Raw content
   * @returns {string} - Cleaned content
   */
  cleanContent(content) {
    let cleaned = content;
    
    // Remove excessive whitespace
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n/g, '\n\n');
    
    // Remove common navigation and boilerplate text
    const removePatterns = [
      /skip to (main )?content/gi,
      /cookie policy/gi,
      /privacy policy/gi,
      /terms of service/gi,
      /newsletter signup/gi,
      /follow us on/gi,
      /share this/gi,
      /copyright \d{4}/gi
    ];
    
    removePatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    // Ensure content starts and ends cleanly
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  /**
   * Create optimal chunks for Bedrock Knowledge Base
   * @param {string} content - Document content
   * @returns {Array} - Array of chunks
   */
  createOptimalChunks(content) {
    const { maxChunkSize, overlapSize, minChunkSize, separators } = this.chunkConfig;
    const chunks = [];
    
    // First, try to split by paragraphs
    let sections = content.split(/\n\s*\n/);
    
    // If paragraphs are too large, split by sentences
    const processedSections = [];
    for (const section of sections) {
      if (section.length <= maxChunkSize) {
        processedSections.push(section);
      } else {
        // Split large sections by sentences
        const sentences = this.splitBySentences(section);
        processedSections.push(...sentences);
      }
    }
    
    // Combine sections into chunks with overlap
    let currentChunk = '';
    let previousOverlap = '';
    
    for (const section of processedSections) {
      const testChunk = (currentChunk + (currentChunk ? '\n\n' : '') + section).trim();
      
      if (testChunk.length > maxChunkSize && currentChunk.length > minChunkSize) {
        // Current chunk is ready
        chunks.push(currentChunk.trim());
        
        // Create overlap for next chunk
        previousOverlap = this.createOverlap(currentChunk, overlapSize);
        currentChunk = previousOverlap + (previousOverlap ? '\n\n' : '') + section;
      } else {
        currentChunk = testChunk;
      }
    }
    
    // Add final chunk
    if (currentChunk.trim().length >= minChunkSize) {
      chunks.push(currentChunk.trim());
    }
    
    // Filter out chunks that are too small
    return chunks.filter(chunk => chunk.length >= minChunkSize);
  }

  /**
   * Split text by sentences
   * @param {string} text - Text to split
   * @returns {Array} - Array of sentences
   */
  splitBySentences(text) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const result = [];
    let current = '';
    
    for (const sentence of sentences) {
      if ((current + sentence).length > this.chunkConfig.maxChunkSize && current.length > 0) {
        result.push(current.trim());
        current = sentence;
      } else {
        current += (current ? ' ' : '') + sentence;
      }
    }
    
    if (current.trim()) {
      result.push(current.trim());
    }
    
    return result;
  }

  /**
   * Create overlap text from the end of a chunk
   * @param {string} chunk - Source chunk
   * @param {number} overlapSize - Desired overlap size
   * @returns {string} - Overlap text
   */
  createOverlap(chunk, overlapSize) {
    if (chunk.length <= overlapSize) {
      return chunk;
    }
    
    // Try to break at sentence boundary
    const endPortion = chunk.slice(-overlapSize * 2);
    const sentences = endPortion.split(/(?<=[.!?])\s+/);
    
    if (sentences.length > 1) {
      // Use complete sentences for overlap
      const lastSentences = sentences.slice(-2).join(' ');
      return lastSentences.length <= overlapSize ? lastSentences : chunk.slice(-overlapSize);
    }
    
    return chunk.slice(-overlapSize);
  }

  /**
   * Format document for Bedrock Knowledge Base with metadata
   * @param {Array} chunks - Document chunks
   * @param {Object} metadata - Document metadata
   * @param {string} title - Document title
   * @param {string} url - Document URL
   * @returns {string} - Formatted document
   */
  formatDocumentForBedrock(chunks, metadata, title, url) {
    const header = [
      `Title: ${title || 'Untitled'}`,
      `URL: ${url || 'N/A'}`,
      `Domain: ${metadata?.domain || 'N/A'}`,
      `Scraped: ${new Date().toISOString()}`,
      `Chunks: ${chunks.length}`,
      '',
      '---',
      ''
    ].join('\n');
    
    // Join chunks with clear separators
    const content = chunks
      .map((chunk, index) => `[Chunk ${index + 1}]\n${chunk}`)
      .join('\n\n---\n\n');
    
    return header + content;
  }

  /**
   * Upload document to S3 with proper metadata
   * @param {string} key - S3 key
   * @param {string} content - Document content
   * @param {Object} metadata - Document metadata
   */
  async uploadToS3(key, content, metadata) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: {
          title: (metadata.title || 'Untitled').substring(0, 1000),
          url: (metadata.url || '').substring(0, 1000),
          domain: (metadata.domain || '').substring(0, 200),
          documentId: metadata.documentId || '',
          chunkCount: String(metadata.chunkCount || 0),
          originalLength: String(metadata.originalLength || 0),
          processedLength: String(metadata.processedLength || 0),
          uploadedAt: new Date().toISOString()
        },
        // Add tags for better organization
        Tagging: `DocumentType=scraped&Domain=${encodeURIComponent(metadata.domain || 'unknown')}`
      });

      await this.s3Client.send(command);
      logger.debug(`Document uploaded to S3: ${key}`);
    } catch (error) {
      logger.error('S3 upload failed:', error);
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }

  /**
   * Trigger Knowledge Base synchronization
   * @returns {Promise<string|null>} - Sync job ID or null if failed
   */
  async syncKnowledgeBase() {
    try {
      if (!this.knowledgeBaseId || !this.dataSourceId) {
        logger.warn('Knowledge Base ID or Data Source ID not configured - skipping sync');
        return null;
      }

      const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        description: `Sync triggered at ${new Date().toISOString()}`
      });

      const response = await this.bedrockAgent.send(command);
      const jobId = response.ingestionJob.ingestionJobId;
      
      logger.info(`Knowledge Base sync started: ${jobId}`);
      return jobId;
    } catch (error) {
      logger.warn('Knowledge Base sync failed (non-blocking):', error.message);
      return null; // Non-blocking - sync can happen later
    }
  }

  /**
   * Check sync job status
   * @param {string} jobId - Sync job ID
   * @returns {Promise<Object|null>} - Job status
   */
  async getSyncStatus(jobId) {
    try {
      const command = new GetIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        ingestionJobId: jobId
      });

      const response = await this.bedrockAgent.send(command);
      return {
        jobId: response.ingestionJob.ingestionJobId,
        status: response.ingestionJob.status,
        createdAt: response.ingestionJob.createdAt,
        updatedAt: response.ingestionJob.updatedAt,
        statistics: response.ingestionJob.statistics
      };
    } catch (error) {
      logger.error('Error checking sync status:', error);
      return null;
    }
  }

  /**
   * Get recent sync jobs
   * @param {number} maxResults - Maximum number of results
   * @returns {Promise<Array>} - Array of recent sync jobs
   */
  async getRecentSyncJobs(maxResults = 10) {
    try {
      const command = new ListIngestionJobsCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        maxResults
      });

      const response = await this.bedrockAgent.send(command);
      return response.ingestionJobSummaries || [];
    } catch (error) {
      logger.error('Error getting sync jobs:', error);
      return [];
    }
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>} - Storage statistics
   */
  async getStorageStats() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'documents/',
        MaxKeys: 1000
      });

      const response = await this.s3Client.send(command);
      const objects = response.Contents || [];
      
      const totalSize = objects.reduce((sum, obj) => sum + (obj.Size || 0), 0);
      const totalDocuments = objects.length;
      
      // Group by date
      const byDate = {};
      objects.forEach(obj => {
        const date = obj.LastModified.toISOString().split('T')[0];
        byDate[date] = (byDate[date] || 0) + 1;
      });
      
      return {
        totalDocuments,
        totalSize,
        averageSize: totalDocuments > 0 ? Math.round(totalSize / totalDocuments) : 0,
        documentsByDate: byDate,
        bucket: this.bucket,
        prefix: 'documents/'
      };
    } catch (error) {
      logger.error('Error getting storage stats:', error);
      return {
        totalDocuments: 0,
        totalSize: 0,
        averageSize: 0,
        documentsByDate: {},
        bucket: this.bucket,
        error: error.message
      };
    }
  }
}

module.exports = new BedrockKnowledgeBaseService();