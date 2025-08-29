const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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
    
    // Chunking configuration optimized for vector search and retrieval
    this.chunkConfig = {
      maxChunkSize: 2000,     // Optimal size for embedding models and retrieval
      overlapSize: 200,       // Character overlap between chunks for context preservation
      minChunkSize: 150,      // Reduced minimum for short content like contact pages
      separators: ['\n\n', '\n', '. ', '! ', '? ', '; ']
    };
  }

  /**
   * Store document in S3 and sync with Knowledge Base for vector search
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
      
      // Enhanced debugging for chunk creation
      logger.info(`Content processing for: ${url || title}`, {
        originalLength: content.length,
        cleanedLength: cleanedContent.length,
        chunksCreated: chunks.length,
        contentPreview: cleanedContent.substring(0, 200) + (cleanedContent.length > 200 ? '...' : '')
      });
      
      if (chunks.length === 0) {
        logger.error(`Failed to create chunks for: ${url || title}`, {
          originalLength: content.length,
          cleanedLength: cleanedContent.length,
          cleanedContent: cleanedContent.substring(0, 500)
        });
        throw new Error(`No valid chunks could be created from the content. Original: ${content.length} chars, Cleaned: ${cleanedContent.length} chars`);
      }
      
      // Generate unique document ID
      const documentId = generateHash(url || title || content.substring(0, 100));
      const timestamp = new Date().toISOString();
      
      // Build comprehensive source metadata for AWS compliance
      const sourceInfo = this.buildSourceMetadata(document, documentId, timestamp);
      
      // Store individual chunks first
      const chunkKeys = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = generateHash(`${documentId}-chunk-${i + 1}`);
        const chunkKey = `processed-chunks/${sourceInfo.sourceType}/${chunkId}.json`;
        
        const chunkData = {
          chunk_id: chunkId,
          document_id: documentId,
          source_type: sourceInfo.sourceType,
          source_url: url || metadata?.url,
          title: title,
          content: chunk,
          chunk_index: i + 1,
          total_chunks: chunks.length,
          word_count: chunk.split(/\s+/).length,
          processed_timestamp: timestamp,
          metadata: {
            "datasource": sourceInfo.sourceIdentifier, // domain for web, filename for PDFs/docs
            "type": sourceInfo.sourceType === 'web-content' ? 'web' : (sourceInfo.fileType === 'pdf' ? 'pdf' : 'document'),
            "documentId": documentId
          }
        };
        
        // S3-Compatible Metadata Structure for Filtering
        const awsMetadata = {
          // S3-compatible keys (no x-amz prefix needed - S3 adds automatically)
          "bedrock-source-uri": `s3://${this.bucket}/${chunkKey}`,
          "bedrock-data-source-id": this.dataSourceId,
          "bedrock-content-type": sourceInfo.contentType,
          "bedrock-created-date": timestamp,
          "bedrock-modified-date": timestamp,
          
          // Filtering-specific metadata
          "source-type": sourceInfo.sourceType,
          "source-identifier": this.sanitizeMetadataValue(sourceInfo.sourceIdentifier, 100),
          "datasource": this.sanitizeMetadataValue(sourceInfo.sourceIdentifier, 100), // New field for easy filtering
          "type": sourceInfo.sourceType === 'web-content' ? 'web' : (sourceInfo.fileType === 'pdf' ? 'pdf' : 'document'),
          "domain": this.sanitizeMetadataValue(sourceInfo.domain, 100) || 'none',
          "file-name": this.sanitizeMetadataValue(sourceInfo.fileName, 150) || 'none',
          "file-type": sourceInfo.fileType,
          "document-id": documentId,
          "chunk-index": String(i + 1),
          "total-chunks": String(chunks.length),
          "category": sourceInfo.category,
          "title": this.sanitizeMetadataValue(title, 200)
        };

        await this.s3Client.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: chunkKey,
          Body: JSON.stringify(chunkData, null, 2),
          ContentType: 'application/json',
          Metadata: awsMetadata
        }));
        
        chunkKeys.push(chunkKey);
      }
      
      // Store metadata index
      const metadataKey = `metadata/content-index.json`;
      const indexEntry = {
        document_id: documentId,
        title: title,
        source_url: url || metadata?.url,
        source_type: sourceInfo.sourceType,
        chunk_count: chunks.length,
        total_word_count: chunks.reduce((sum, chunk) => sum + chunk.split(/\s+/).length, 0),
        processed_timestamp: timestamp,
        chunk_keys: chunkKeys,
        metadata: {
          ...metadata,
          originalLength: content.length,
          processedLength: cleanedContent.length
        }
      };
      
      // Read existing index, add new entry, and write back
      let existingIndex = [];
      try {
        const getCommand = new GetObjectCommand({
          Bucket: this.bucket,
          Key: metadataKey
        });
        const response = await this.s3Client.send(getCommand);
        const body = await this.streamToBuffer(response.Body);
        existingIndex = JSON.parse(body.toString());
      } catch (error) {
        // File doesn't exist yet, start with empty array
        if (error.name !== 'NoSuchKey') {
          logger.warn('Could not read existing index:', error.message);
        }
      }
      
      existingIndex.push(indexEntry);
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: metadataKey,
        Body: JSON.stringify(existingIndex, null, 2),
        ContentType: 'application/json',
        Metadata: {
          lastUpdated: timestamp,
          totalDocuments: String(existingIndex.length)
        }
      }));
      
      // Also create the traditional documents format for Bedrock KB compatibility
      const s3Key = `documents/${timestamp.split('T')[0]}/${documentId}.txt`;
      const formattedContent = this.formatDocumentForBedrock(chunks, metadata, title, url);
      
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
   * Build comprehensive source metadata for AWS compliance and filtering
   * @param {Object} document - Document object
   * @param {string} documentId - Generated document ID
   * @param {string} timestamp - Processing timestamp
   * @returns {Object} - Source metadata structure
   */
  buildSourceMetadata(document, documentId, timestamp) {
    const { content, metadata = {}, title, url } = document;
    
    // Determine source type and create comprehensive metadata
    let sourceType, sourceIdentifier, domain, fileName, fileType, category, contentType;
    
    if (metadata?.source === 'external-scraper') {
      // Web scraping source
      sourceType = 'web-content';
      category = 'website';
      contentType = 'text/html';
      
      if (url) {
        try {
          const urlObj = new URL(url);
          domain = urlObj.hostname.replace(/^www\./, '');
          sourceIdentifier = domain;
        } catch (e) {
          domain = 'unknown-domain';
          sourceIdentifier = 'unknown-source';
        }
      } else {
        domain = 'unknown-domain';
        sourceIdentifier = 'unknown-source';
      }
      
      fileName = null;
      fileType = 'html';
      
    } else if (metadata?.fileType) {
      // Uploaded file source
      sourceType = 'document-content';
      category = 'document';
      
      fileName = metadata?.fileName || title || 'unknown-file';
      fileType = metadata?.fileType?.replace('.', '') || 'txt';
      
      // Determine content type based on file extension
      if (fileType.includes('pdf')) {
        contentType = 'application/pdf';
      } else if (fileType.includes('doc')) {
        contentType = 'application/msword';
      } else if (fileType.includes('txt') || fileType.includes('md')) {
        contentType = 'text/plain';
      } else {
        contentType = 'text/plain';
      }
      
      sourceIdentifier = fileName;
      domain = null;
      
    } else {
      // Future source types or unknown
      sourceType = 'other-content';
      category = 'other';
      contentType = 'text/plain';
      sourceIdentifier = title || documentId;
      domain = null;
      fileName = null;
      fileType = 'txt';
    }
    
    return {
      sourceType,
      sourceIdentifier,
      domain,
      fileName,
      fileType,
      category,
      contentType
    };
  }

  /**
   * Sanitize metadata value for S3 header compatibility
   * @param {string} value - Value to sanitize
   * @param {number} maxLength - Maximum length (default 1000)
   * @returns {string} - Sanitized value
   */
  sanitizeMetadataValue(value, maxLength = 1000) {
    if (!value) return 'Unknown';
    
    return String(value)
      .replace(/[^\w\s\-\.\/\:]/g, '')  // Remove special characters
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .trim()                          // Remove leading/trailing whitespace
      .substring(0, maxLength) || 'Untitled';
  }

  /**
   * Sanitize metadata specifically for S3 headers (stricter requirements)
   * S3 metadata headers can only contain ASCII printable characters (0x20-0x7E)
   * @param {string} value - Value to sanitize
   * @param {number} maxLength - Maximum length
   * @returns {string} - S3-safe sanitized value
   */
  sanitizeMetadataForS3(value, maxLength = 1000) {
    if (!value) return 'Unknown';
    
    return String(value)
      // Only keep ASCII printable characters (space to tilde: 0x20-0x7E)
      .replace(/[^\x20-\x7E]/g, '')
      // Remove problematic characters for S3 headers
      .replace(/["\r\n\t\f\v]/g, ' ')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Remove leading/trailing whitespace
      .trim()
      // Limit length
      .substring(0, maxLength) || 'Unknown';
  }

  /**
   * Validate content quality to prevent corrupted/encoded content storage
   * @param {string} content - Content to validate
   * @returns {boolean} - True if content is valid for storage
   */
  isValidContent(content) {
    if (!content || typeof content !== 'string') {
      return false;
    }
    
    const trimmedContent = content.trim();
    
    // Check minimum length
    if (trimmedContent.length < 100) {
      logger.warn('Content too short for storage:', { length: trimmedContent.length });
      return false;
    }
    
    // Check for corrupted content patterns from the terminal output
    const corruptedPatterns = [
      /^#content\s*!\s*base64,/i,          // "#content ! base64," pattern
      /^[A-Za-z0-9+\/=]{50,}\+{2,}/,       // Base64-like with multiple + signs
      /CiAgPGRlZnM|PHN0eWxl|PGc/i,         // Specific base64 HTML patterns
      /^\+CiAg/,                           // Starting with "+CiAg" pattern
      /^data:[\w\/\+]+;base64,/i,          // Data URL with base64
    ];
    
    // Check if content matches corrupted patterns
    if (corruptedPatterns.some(pattern => pattern.test(trimmedContent))) {
      logger.warn('Corrupted content pattern detected:', { 
        contentPreview: trimmedContent.substring(0, 100) 
      });
      return false;
    }
    
    // Check content quality - should have reasonable text content
    const alphaChars = (trimmedContent.match(/[a-zA-Z]/g) || []).length;
    const alphaRatio = alphaChars / trimmedContent.length;
    
    if (alphaRatio < 0.3) {
      logger.warn('Content has too few alphabetic characters:', { 
        alphaRatio: alphaRatio.toFixed(3),
        contentPreview: trimmedContent.substring(0, 100)
      });
      return false;
    }
    
    return true;
  }

  /**
   * Check if a title appears to be corrupted or is navigation text
   * @param {string} title - Title to check
   * @returns {boolean} - True if title appears corrupted
   */
  isTitleCorrupted(title) {
    if (!title || typeof title !== 'string') {
      return true;
    }
    
    const trimmedTitle = title.trim();
    
    // Check for corrupted title patterns
    const corruptedTitlePatterns = [
      /^#content\s*!\s*base64,/i,          // "#content ! base64," pattern
      /^[A-Za-z0-9+\/=]{20,}/,             // Looks like base64 encoding
      /CiAgPGRlZnM|PHN0eWxl|PGc/i,         // Specific base64 HTML patterns
      /^\+{2,}/,                           // Starts with multiple + signs
      /^data:[\w\/\+]+;base64,/i,          // Data URL with base64
      /^''+\s*Home\s*\/.*\/.*Projects/i,   // Navigation menu text pattern
      /^Home\s*\/\s*About\s*\/.*\/.*Contact/i, // Common nav pattern
      /\/about\s+\/experience\s+\/projects/i,  // Specific nav pattern from example
    ];
    
    if (corruptedTitlePatterns.some(pattern => pattern.test(trimmedTitle))) {
      return true;
    }
    
    // Check for navigation-like patterns (multiple "/" with short words)
    const slashCount = (trimmedTitle.match(/\//g) || []).length;
    if (slashCount >= 3 && trimmedTitle.length < 100) {
      // Likely navigation breadcrumbs
      return true;
    }
    
    // Check if title is mostly non-alphabetic characters
    const alphaChars = (trimmedTitle.match(/[a-zA-Z]/g) || []).length;
    const alphaRatio = alphaChars / trimmedTitle.length;
    
    // Title should have reasonable amount of alphabetic characters
    return alphaRatio < 0.4;
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
    
    // For very short content, just return it as a single chunk with relaxed minimum
    if (content.length <= minChunkSize * 1.5) {
      // Allow content as short as 50 characters for web content
      if (content.length >= 50) {
        return [content.trim()];
      } else {
        return []; // Still too short to be meaningful
      }
    }
    
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
    
    // Add final chunk with relaxed minimum for the last chunk
    const finalChunk = currentChunk.trim();
    if (finalChunk.length >= 50) { // Relaxed minimum for final chunk
      chunks.push(finalChunk);
    }
    
    // Filter out chunks that are too small, but with more flexible rules
    return chunks.filter(chunk => {
      const chunkLength = chunk.length;
      // For very short chunks, be more lenient
      if (chunkLength >= 50) {
        return true;
      }
      return false;
    });
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
   * Sanitize metadata value for S3 headers
   * @param {string} value - The metadata value to sanitize
   * @param {number} maxLength - Maximum length (default 1000)
   * @returns {string} - Sanitized value safe for S3 metadata
   */
  sanitizeMetadataValue(value, maxLength = 1000) {
    if (!value) return 'Untitled';
    
    // Convert to string and remove invalid characters for S3 metadata
    return String(value)
      // Remove non-ASCII characters
      .replace(/[^\x20-\x7E]/g, '')
      // Remove control characters and problematic chars
      .replace(/[\r\n\t\f\v]/g, ' ')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim()
      // Limit length
      .substring(0, maxLength) || 'Untitled';
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
          // S3-compatible keys for Bedrock format documents
          "bedrock-source-uri": `s3://${this.bucket}/${key}`,
          "bedrock-data-source-id": this.dataSourceId,
          "bedrock-content-type": 'text/plain',
          "bedrock-created-date": new Date().toISOString(),
          "bedrock-modified-date": new Date().toISOString(),
          
          // Document metadata
          "title": this.sanitizeMetadataValue(metadata.title, 200),
          "url": this.sanitizeMetadataValue(metadata.url, 500),
          "domain": this.sanitizeMetadataValue(metadata.domain, 100),
          "document-id": this.sanitizeMetadataValue(metadata.documentId, 100),
          "chunk-count": String(metadata.chunkCount || 0),
          "original-length": String(metadata.originalLength || 0),
          "processed-length": String(metadata.processedLength || 0),
          "uploaded-at": new Date().toISOString(),
          "format": "bedrock-document"
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

  /**
   * Store document with exact metadata schema compliance for AWS Bedrock Knowledge Base
   * Follows strict requirements: plain text storage, exact metadata schema, lowercase keys
   * @param {Object} document - Document object with content and metadata
   * @returns {Promise<Object>} - Storage result with verification info
   */
  async storeDocumentCompliant(document) {
    try {
      const { content, metadata = {}, title, url } = document;
      
      if (!content || typeof content !== 'string') {
        throw new Error('Document content is required and must be a string');
      }
      
      if (!url) {
        throw new Error('URL is required for compliant storage');
      }
      
      // Validate content quality to prevent corrupted/encoded content storage
      if (!this.isValidContent(content)) {
        throw new Error('Content appears to be corrupted, encoded, or insufficient for storage');
      }
      
      // Generate hash from URL for consistent file naming
      const urlHash = generateHash(url);
      const timestamp = new Date().toISOString();
      const dateOnly = timestamp.split('T')[0]; // YYYY-MM-DD format
      
      // Determine document type and source first
      let docType = 'web'; // default for scraped content
      let isUploadedFile = false;
      
      if (metadata?.fileType) {
        isUploadedFile = true;
        const fileExt = metadata.fileType.toLowerCase().replace('.', '');
        if (fileExt === 'pdf') docType = 'pdf';
        else if (['doc', 'docx'].includes(fileExt)) docType = 'doc';
        else if (fileExt === 'rtf') docType = 'doc';
        else if (metadata.isFaq) docType = 'faq';
        else docType = fileExt; // csv, txt, xlsx, etc.
      }
      
      // Extract domain from URL (for web content) or set appropriate values for uploaded files
      let domain, datasource;
      
      if (isUploadedFile) {
        // For uploaded files, use filename-based datasource and 'document' for domain
        domain = 'document';
        if (metadata?.fileName) {
          // Extract main project name from filename (e.g., "recipe-book" from "Recipe-Book-1-2.pdf")
          const fileName = metadata.fileName;
          const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
          // Get first meaningful part (before numbers/versions)
          const projectName = baseName.split(/[-_\s]/)[0] || baseName;
          datasource = projectName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
        } else {
          datasource = 'uploaded-file';
        }
      } else {
        // For web content, extract from URL
        try {
          const urlObj = new URL(url);
          domain = urlObj.hostname.toLowerCase(); // e.g., www.kaaylabs.com
          
          // Extract project/company name from domain (e.g., "ansar-portfolio" from "ansar-portfolio.pages.dev")
          const hostParts = urlObj.hostname.replace(/^www\./, '').split('.');
          let projectName;
          if (hostParts.length >= 2) {
            // For domains like "ansar-portfolio.pages.dev", "kaaylabs.com"
            projectName = hostParts[0];
          } else {
            projectName = hostParts[0] || 'unknown';
          }
          datasource = projectName.toLowerCase();
        } catch (e) {
          domain = 'unknown.domain';
          datasource = 'unknown';
        }
      }
      
      // Clean title with fallback - detect and handle corrupted titles
      let cleanTitle = title?.trim() || 'Unknown Title';
      
      if (isUploadedFile) {
        // For uploaded files, create a clean title from filename
        if (metadata?.fileName) {
          const fileName = metadata.fileName;
          const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
          cleanTitle = baseName
            .replace(/[-_]/g, ' ')           // Replace dashes/underscores with spaces
            .replace(/\b\w/g, l => l.toUpperCase())  // Title case
            .trim();
        }
      } else {
        // For web content, check if title appears to be corrupted (nav text, base64, etc.)
        if (this.isTitleCorrupted(cleanTitle)) {
          // Try to extract a title from the URL path as fallback
          try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(seg => seg.length > 0);
            if (pathSegments.length > 0) {
              // Use the last meaningful path segment as title
              const lastSegment = pathSegments[pathSegments.length - 1];
              cleanTitle = lastSegment
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase())
                .trim() || 'Unknown Title';
            } else {
              cleanTitle = 'Unknown Title';
            }
          } catch (e) {
            cleanTitle = 'Unknown Title';
          }
        }
      }
      
      // Create S3 key following exact pattern: documents/{YYYY-MM-DD}/{hash(url)}.txt
      const s3Key = `documents/${dateOnly}/${urlHash}.txt`;
      
      // Store as plain text UTF-8 (no formatting, no headers, no chunk separators)
      const plainTextContent = content.trim();
      
      // Create exact metadata schema - ALL LOWERCASE except url and title
      // S3 metadata headers have strict character requirements
      const compliantMetadata = {
        "type": docType,
        "datasource": datasource,
        "domain": domain,
        "url": this.sanitizeMetadataForS3(url, 500), // Sanitize URL for S3 headers
        "title": this.sanitizeMetadataForS3(cleanTitle, 200), // Sanitize title for S3 headers
        "uploaded-at": timestamp,
        "original-length": String(content.length)
      };
      
      // Upload to S3 with compliant metadata
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: plainTextContent,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: compliantMetadata
      });

      await this.s3Client.send(command);
      
      // Also store in original folder structure for data management and filtering
      await this.storeInOriginalStructure(document, urlHash, timestamp, domain, datasource, docType);
      
      // Print verification info as requested
      console.log('📄 DOCUMENT STORED - VERIFICATION:');
      console.log(`S3 Key: ${s3Key}`);
      console.log('Metadata:');
      Object.entries(compliantMetadata).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
      console.log('---');
      
      logger.info(`Document stored with compliant schema: ${s3Key}`, {
        urlHash,
        domain,
        datasource,
        contentLength: content.length,
        type: docType
      });
      
      return {
        success: true,
        s3Key,
        urlHash,
        metadata: compliantMetadata,
        contentLength: content.length,
        timestamp,
        verification: {
          pattern: 'documents/{YYYY-MM-DD}/{hash(url)}.txt',
          schemaCompliant: true,
          allLowercase: true
        }
      };
      
    } catch (error) {
      logger.error('Error storing document with compliant schema:', {
        error: error.message,
        title: document.title,
        url: document.url
      });
      throw new Error(`Failed to store document with compliant schema: ${error.message}`);
    }
  }

  /**
   * Store document in original folder structure for data management and filtering
   * @param {Object} document - Document object
   * @param {string} urlHash - URL hash for the document
   * @param {string} timestamp - Upload timestamp
   * @param {string} domain - Domain name
   * @param {string} datasource - Data source identifier
   * @param {string} docType - Document type
   */
  async storeInOriginalStructure(document, urlHash, timestamp, domain, datasource, docType) {
    try {
      const { content, metadata = {}, title, url } = document;
      const dateOnly = timestamp.split('T')[0];
      
      // 1. Store raw content backup in raw-content/web-scrapes/{domain}/
      if (metadata.source === 'external-scraper') {
        const rawKey = `raw-content/web-scrapes/${domain}/${dateOnly}/${urlHash}.json`;
        const rawContent = {
          content_id: urlHash,
          source_type: 'web_scrape',
          source_url: url,
          title: title,
          content: content,
          processed_timestamp: timestamp,
          content_hash: generateHash(content),
          file_type: 'html',
          language: 'en'
        };
        
        await this.s3Client.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: rawKey,
          Body: JSON.stringify(rawContent, null, 2),
          ContentType: 'application/json',
          Metadata: {
            "source-type": 'web-content',
            "source-identifier": domain,
            "datasource": datasource,
            "type": 'web',
            "domain": domain,
            "document-id": urlHash,
            "category": 'website-backup',
            "is-raw-backup": 'true',
            "scraped-at": timestamp
          }
        }));
        
        logger.debug(`Raw backup stored: ${rawKey}`);
      }
      
      // 2. Store processed chunk in processed-chunks/ for potential future use
      const chunkKey = `processed-chunks/${docType === 'web' ? 'web-content' : 'document-content'}/${urlHash}.json`;
      const chunkData = {
        chunk_id: urlHash,
        document_id: urlHash,
        source_type: docType === 'web' ? 'web-content' : 'document-content',
        source_url: url,
        title: title,
        content: content,
        chunk_index: 1,
        total_chunks: 1,
        word_count: content.split(/\s+/).length,
        processed_timestamp: timestamp,
        metadata: {
          "datasource": datasource,
          "type": docType,
          "documentId": urlHash
        }
      };
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: chunkKey,
        Body: JSON.stringify(chunkData, null, 2),
        ContentType: 'application/json',
        Metadata: {
          "source-type": docType === 'web' ? 'web-content' : 'document-content',
          "source-identifier": datasource,
          "datasource": datasource,
          "type": docType,
          "domain": domain || 'none',
          "document-id": urlHash,
          "category": docType === 'web' ? 'website' : 'document',
          "title": this.sanitizeMetadataForS3(title, 200)
        }
      }));
      
      logger.debug(`Processed chunk stored: ${chunkKey}`);
      
      // 3. Update metadata index
      const metadataKey = `metadata/content-index.json`;
      const indexEntry = {
        document_id: urlHash,
        title: title,
        source_url: url,
        source_type: docType === 'web' ? 'web-content' : 'document-content',
        chunk_count: 1,
        total_word_count: content.split(/\s+/).length,
        processed_timestamp: timestamp,
        compliant_s3_key: `documents/${dateOnly}/${urlHash}.txt`,
        raw_backup_key: docType === 'web' ? `raw-content/web-scrapes/${domain}/${dateOnly}/${urlHash}.json` : null,
        processed_chunk_key: chunkKey,
        metadata: {
          ...metadata,
          originalLength: content.length
        }
      };
      
      // Read existing index, add new entry, and write back
      let existingIndex = [];
      try {
        const getCommand = new GetObjectCommand({
          Bucket: this.bucket,
          Key: metadataKey
        });
        const response = await this.s3Client.send(getCommand);
        const body = await this.streamToBuffer(response.Body);
        existingIndex = JSON.parse(body.toString());
      } catch (error) {
        if (error.name !== 'NoSuchKey') {
          logger.warn('Could not read existing index:', error.message);
        }
      }
      
      existingIndex.push(indexEntry);
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: metadataKey,
        Body: JSON.stringify(existingIndex, null, 2),
        ContentType: 'application/json',
        Metadata: {
          lastUpdated: timestamp,
          totalDocuments: String(existingIndex.length)
        }
      }));
      
      logger.debug(`Metadata index updated: ${metadataKey}`);
      
    } catch (error) {
      logger.warn('Failed to store in original structure (non-blocking):', error.message);
      // Don't throw - this is supplementary storage
    }
  }

  /**
   * Convert stream to buffer
   * @param {ReadableStream} stream - Stream to convert
   * @returns {Promise<Buffer>} - Buffer
   */
  async streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

module.exports = new BedrockKnowledgeBaseService();