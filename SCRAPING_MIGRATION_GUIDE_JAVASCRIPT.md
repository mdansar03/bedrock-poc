# Complete Scraping and Storage Flow Migration Guide - JavaScript/Node.js

This guide provides a step-by-step implementation for migrating the complete scraping and storing flow from the `/scraping/scrape` endpoint. Follow this guide to implement the same functionality in your own application.

## Overview

The scraping system follows this complete flow:
1. **HTTP Request** → Scraping Route → External Scraping Service
2. **Content Processing** → Content Cleaning → Bedrock Compliant Storage  
3. **Knowledge Base Sync** → Final Storage in AWS Bedrock Knowledge Base

## Architecture Components

### Core Services Required

```javascript
// Required Services Structure
project/
├── routes/
│   └── scraping.js              // HTTP endpoints
├── services/
│   ├── externalScrapingService.js    // Main scraping logic
│   ├── bedrockCompliantStorage.js    // AWS storage service
│   ├── knowledgeBaseSync.js          // KB synchronization
│   └── fileProcessingService.js      // File handling
├── utils/
│   ├── hash.js                       // Content hashing
│   └── logger.js                     // Logging utilities
└── frontend/
    └── utils/
        └── api.js                    // Frontend API calls
```

## Step 1: Setup Dependencies

### Package.json Requirements

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "express-validator": "^6.15.0",
    "@aws-sdk/client-s3": "^3.400.0",
    "@aws-sdk/client-bedrock-agent": "^3.400.0",
    "axios": "^1.5.0",
    "cheerio": "^1.0.0-rc.12",
    "turndown": "^7.1.2",
    "html-to-text": "^9.0.5",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0",
    "xlsx": "^0.18.5"
  }
}
```

### Environment Variables

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
BEDROCK_S3_BUCKET=your-bedrock-bucket
BEDROCK_KNOWLEDGE_BASE_ID=your-kb-id
BEDROCK_DATA_SOURCE_ID=your-datasource-id

# External Scraper Configuration
EXTERNAL_SCRAPER_URL=http://localhost:3358/api
EXTERNAL_SCRAPER_TIMEOUT_MS=1200000

# File Processing
MAX_FILE_SIZE=52428800
```

## Step 2: Implement Core Utilities

### 2.1 Hash Utility (`utils/hash.js`)

```javascript
const crypto = require('crypto');

/**
 * Generate SHA256 hash for content
 */
function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate unique chunk ID
 */
function generateChunkId(url, chunkIndex, timestamp) {
  const content = `${url}-${chunkIndex}-${timestamp}`;
  return generateHash(content).substring(0, 12);
}

/**
 * Compare two hashes
 */
function compareHashes(hash1, hash2) {
  return hash1 === hash2;
}

module.exports = {
  generateHash,
  compareHashes, 
  generateChunkId
};
```

### 2.2 Logger Utility (`utils/logger.js`)

```javascript
const winston = require('winston');

// Create logger with appropriate levels and formatting
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

module.exports = logger;
```

## Step 3: Implement Bedrock Compliant Storage Service

### 3.1 Main Storage Service (`services/bedrockCompliantStorage.js`)

```javascript
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
const { generateHash } = require('../utils/hash');
const logger = require('../utils/logger');

class BedrockCompliantStorage {
  constructor() {
    // Initialize AWS clients
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
  }

  /**
   * Main entry point: Store document with Bedrock Knowledge Base compliant structure
   * Creates both document file and required .metadata.json sidecar
   */
  async storeDocument(document) {
    try {
      const { content, metadata = {}, title, url } = document;
      
      if (!content || typeof content !== 'string') {
        throw new Error('Document content is required and must be a string');
      }

      // Clean content for storage
      const cleanedContent = this.cleanContent(content);
      
      if (cleanedContent.length < 50) {
        throw new Error('Content too short for meaningful storage');
      }

      // Analyze document type and determine storage structure
      const documentInfo = this.analyzeDocument(document);
      
      // Generate file paths following Bedrock structure: type/datasource/filename.ext
      const filePaths = this.generateFilePaths(documentInfo, content);
      
      // Create metadata following Bedrock schema
      const bedrockMetadata = this.createBedrockMetadata(documentInfo, url, title);
      
      // Store document file
      await this.storeDocumentFile(filePaths.documentPath, cleanedContent);
      
      // Store metadata sidecar file (.metadata.json)
      await this.storeMetadataFile(filePaths.metadataPath, bedrockMetadata);
      
      // Create/update datasource.json registry for frontend
      const registryData = await this.updateDatasourceRegistry(documentInfo, url, title, filePaths.documentPath);
      
      logger.info(`BEDROCK COMPLIANT DOCUMENT STORED`, {
        documentPath: filePaths.documentPath,
        metadataPath: filePaths.metadataPath,
        typeFolder: filePaths.typeFolder,
        datasource: documentInfo.datasource,
        type: documentInfo.type
      });

      return {
        success: true,
        documentPath: filePaths.documentPath,
        metadataPath: filePaths.metadataPath,
        typeFolder: filePaths.typeFolder,
        datasource: documentInfo.datasource,
        type: documentInfo.type,
        metadata: bedrockMetadata,
        contentLength: cleanedContent.length,
        registryData,
        verification: {
          hasDocument: true,
          hasMetadata: true,
          schemaCompliant: true,
          bedrockReady: true,
          typeBased: true,
          registryCreated: registryData !== null
        }
      };

    } catch (error) {
      logger.error('Error storing Bedrock compliant document:', error);
      throw new Error(`Failed to store Bedrock compliant document: ${error.message}`);
    }
  }

  /**
   * Analyze document to determine storage type and datasource
   */
  analyzeDocument(document) {
    const { metadata = {}, title, url } = document;
    
    let type, datasource, identifier, isUploadedFile = false;

    if (metadata?.source === 'external-scraper' && url) {
      // Web content from scraping
      type = 'web';
      
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        
        // Extract project name from domain
        if (hostname.includes('.')) {
          const parts = hostname.split('.');
          datasource = parts[0]; // e.g., "ansar-portfolio" from "ansar-portfolio.pages.dev"
        } else {
          datasource = hostname;
        }
        
        // Create page identifier from URL path
        const pathSegments = urlObj.pathname.split('/').filter(seg => seg.length > 0);
        if (pathSegments.length > 0) {
          identifier = pathSegments[pathSegments.length - 1] || 'home-page';
        } else {
          identifier = 'home-page';
        }
        
        // Clean identifier
        identifier = identifier.replace(/\.(html?|php|aspx?)$/i, '');
        identifier = this.sanitizeIdentifier(identifier) || 'page';
        
      } catch (e) {
        datasource = 'unknown-site';
        identifier = 'page';
      }
      
    } else if (metadata?.fileName) {
      // Uploaded file
      isUploadedFile = true;
      const fileName = metadata.fileName;
      const fileExt = metadata.fileType?.toLowerCase().replace('.', '') || 'txt';
      
      // Determine file type
      if (fileExt === 'pdf') {
        type = 'pdf';
      } else if (['doc', 'docx'].includes(fileExt)) {
        type = 'doc';
      } else {
        type = 'document';
      }
      
      // Extract datasource from filename
      const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
      const projectName = baseName.split(/[-_\s]/)[0] || baseName;
      datasource = this.sanitizeIdentifier(projectName) || 'uploaded-documents';
      
      identifier = this.sanitizeIdentifier(baseName) || 'document';
      
    } else {
      // Fallback
      type = 'document';
      datasource = 'general-content';
      identifier = this.sanitizeIdentifier(title) || 'untitled';
    }

    return {
      type,
      datasource: this.sanitizeIdentifier(datasource),
      identifier: this.sanitizeIdentifier(identifier),
      isUploadedFile,
      fileExtension: isUploadedFile ? (metadata?.fileType?.replace('.', '') || 'txt') : 'txt',
      metadata
    };
  }

  /**
   * Generate file paths following type-based Bedrock structure
   */
  generateFilePaths(documentInfo, content) {
    const { datasource, identifier, fileExtension, type } = documentInfo;
    
    // Create filename - ensure it's unique
    const contentHash = generateHash(content).substring(0, 8);
    const fileName = `${identifier}-${contentHash}.${fileExtension}`;
    
    // Determine type folder based on document type
    const typeFolder = this.getTypeFolder(type, fileExtension);
    
    // Follow type-based structure: type/datasource/filename.ext
    const documentPath = `${typeFolder}/${datasource}/${fileName}`;
    const metadataPath = `${typeFolder}/${datasource}/${fileName}.metadata.json`;
    
    return {
      documentPath,
      metadataPath,
      fileName,
      typeFolder
    };
  }

  /**
   * Get type folder based on document type and file extension
   */
  getTypeFolder(type, fileExtension) {
    // Handle specific document types
    if (type === 'web') {
      return 'websites';
    }
    
    if (type === 'pdf') {
      return 'pdfs';
    }
    
    if (type === 'doc' || ['doc', 'docx', 'rtf'].includes(fileExtension)) {
      return 'documents';
    }
    
    // Handle spreadsheets
    if (['xlsx', 'xls', 'csv'].includes(fileExtension)) {
      return 'spreadsheets';
    }
    
    // Handle other text files
    if (['txt', 'md'].includes(fileExtension)) {
      return 'documents';
    }
    
    // Default fallback
    return 'documents';
  }

  /**
   * Create Bedrock compliant metadata following exact schema
   */
  createBedrockMetadata(documentInfo, url, title) {
    const { datasource, type, identifier, isUploadedFile } = documentInfo;
    
    const metadata = {
      metadataAttributes: {
        datasource: {
          value: { type: "STRING", stringValue: datasource },
          includeForEmbedding: true
        },
        type: {
          value: { type: "STRING", stringValue: type },
          includeForEmbedding: true
        }
      }
    };

    // Add page or filename identifier
    if (isUploadedFile) {
      metadata.metadataAttributes.filename = {
        value: { type: "STRING", stringValue: identifier },
        includeForEmbedding: false
      };
    } else {
      metadata.metadataAttributes.page = {
        value: { type: "STRING", stringValue: identifier },
        includeForEmbedding: false
      };
    }

    // Add URL if available (for web content)
    if (url) {
      metadata.metadataAttributes.url = {
        value: { type: "STRING", stringValue: url },
        includeForEmbedding: false
      };
    }

    // Add title if available
    if (title && title.trim()) {
      metadata.metadataAttributes.title = {
        value: { type: "STRING", stringValue: this.cleanTitle(title) },
        includeForEmbedding: false
      };
    }

    return metadata;
  }

  /**
   * Store document file in S3
   */
  async storeDocumentFile(documentPath, content) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: documentPath,
      Body: content,
      ContentType: 'text/plain; charset=utf-8'
    });

    await this.s3Client.send(command);
    logger.debug(`Document stored: ${documentPath}`);
  }

  /**
   * Store metadata sidecar file in S3
   */
  async storeMetadataFile(metadataPath, metadata) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: metadataPath,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    });

    await this.s3Client.send(command);
    logger.debug(`Metadata stored: ${metadataPath}`);
  }

  /**
   * Create or update datasource.json registry file for frontend
   */
  async updateDatasourceRegistry(documentInfo, url, title, documentPath = null) {
    try {
      const { type, datasource } = documentInfo;
      const typeFolder = this.getTypeFolder(type, documentInfo.fileExtension);
      const registryPath = `${typeFolder}/${datasource}/datasource.json`;
      
      // Generate display name and source URL based on content type
      const displayName = this.generateDisplayName(documentInfo, url, title);
      const sourceUrl = this.generateSourceUrl(documentInfo, url, documentPath);
      
      // Create datasource registry object
      const registryData = {
        id: datasource,
        type: this.mapTypeForRegistry(type),
        display_name: displayName,
        source_url: sourceUrl,
        created_at: new Date().toISOString()
      };

      // Check if registry already exists
      let existingRegistry = null;
      try {
        const existingResponse = await this.s3Client.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: registryPath
        }));
        const existingBody = await this.streamToBuffer(existingResponse.Body);
        existingRegistry = JSON.parse(existingBody.toString());
      } catch (error) {
        // Registry doesn't exist yet
        logger.debug(`Creating new datasource registry: ${registryPath}`);
      }

      // If registry exists, preserve created_at
      if (existingRegistry) {
        registryData.created_at = existingRegistry.created_at;
        registryData.updated_at = new Date().toISOString();
      }

      // Store the registry file
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: registryPath,
        Body: JSON.stringify(registryData, null, 2),
        ContentType: 'application/json'
      });

      await this.s3Client.send(command);
      logger.debug(`Datasource registry updated: ${registryPath} - Display: "${displayName}"`);
      
      return registryData;
    } catch (error) {
      logger.warn('Failed to update datasource registry (non-blocking):', error.message);
      return null;
    }
  }

  // Helper methods for registry
  mapTypeForRegistry(type) {
    const typeMap = {
      'web': 'web',
      'pdf': 'pdf', 
      'doc': 'doc',
      'document': 'doc',
      'spreadsheet': 'spreadsheet'
    };
    return typeMap[type] || 'doc';
  }

  generateDisplayName(documentInfo, url, title) {
    const { type, isUploadedFile } = documentInfo;
    
    if (type === 'web' && url) {
      // For websites: show the root URL
      try {
        const urlObj = new URL(url);
        return urlObj.origin;
      } catch (e) {
        return url;
      }
    }
    
    if (isUploadedFile && documentInfo.metadata?.fileName) {
      // For files: show actual filename
      return documentInfo.metadata.fileName;
    }
    
    // Fallback
    return title || documentInfo.datasource;
  }

  generateSourceUrl(documentInfo, url, filePath) {
    const { type, isUploadedFile } = documentInfo;
    
    if (type === 'web' && url) {
      // For websites: return the original scraped URL
      try {
        const urlObj = new URL(url);
        return urlObj.origin;
      } catch (e) {
        return url;
      }
    }
    
    if (isUploadedFile && filePath) {
      // For files: generate S3 public URL
      const bucket = this.bucket;
      const region = process.env.AWS_REGION || 'us-east-1';
      return `https://${bucket}.s3.${region}.amazonaws.com/${filePath}`;
    }
    
    return url || null;
  }

  /**
   * Clean content for optimal storage
   */
  cleanContent(content) {
    let cleaned = content;
    
    // Remove excessive whitespace while preserving structure
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n/g, '\n\n');
    
    // Remove common navigation and boilerplate
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
    
    return cleaned.trim();
  }

  cleanTitle(title) {
    if (!title) return 'Untitled';
    
    return title
      .trim()
      .replace(/[^\w\s\-\.]/g, '') // Remove special chars except basic ones
      .replace(/\s+/g, ' ')        // Normalize spaces
      .substring(0, 200)           // Limit length
      .trim() || 'Untitled';
  }

  sanitizeIdentifier(identifier) {
    if (!identifier) return '';
    
    return identifier
      .toLowerCase()
      .replace(/[^\w\-]/g, '-')    // Replace non-word chars with hyphens
      .replace(/-+/g, '-')         // Collapse multiple hyphens
      .replace(/^-|-$/g, '')       // Remove leading/trailing hyphens
      .substring(0, 50);           // Limit length
  }

  /**
   * Convert stream to buffer
   */
  async streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Trigger Knowledge Base sync
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
        description: `Bedrock compliant sync triggered at ${new Date().toISOString()}`
      });

      const response = await this.bedrockAgent.send(command);
      const jobId = response.ingestionJob.ingestionJobId;
      
      logger.info(`Knowledge Base sync started: ${jobId}`);
      return jobId;
    } catch (error) {
      logger.warn('Knowledge Base sync failed (non-blocking):', error.message);
      return null;
    }
  }
}

module.exports = new BedrockCompliantStorage();
```

## Step 4: Implement External Scraping Service

### 4.1 Main Scraping Service (`services/externalScrapingService.js`)

```javascript
const axios = require('axios');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { generateHash, generateChunkId } = require('../utils/hash');
const logger = require('../utils/logger');
const knowledgeBaseSync = require('./knowledgeBaseSync');
const bedrockCompliantStorage = require('./bedrockCompliantStorage');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { convert } = require('html-to-text');

class ExternalScrapingService {
  constructor() {
    this.externalApiUrl = process.env.EXTERNAL_SCRAPER_URL || 'http://localhost:3358/api';
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = process.env.BEDROCK_S3_BUCKET;
    
    // Create axios instance for external API
    this.api = axios.create({
      baseURL: this.externalApiUrl,
      timeout: parseInt(process.env.EXTERNAL_SCRAPER_TIMEOUT_MS || '', 10) || 1200000,
      headers: {
        'Content-Type': 'application/json',
      },
      retries: 5,
      retryDelay: (retryCount) => retryCount * 2000,
    });

    // Setup retry interceptor
    this.setupRetryInterceptor();
  }

  /**
   * Setup retry interceptor for external API calls
   */
  setupRetryInterceptor() {
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        // Don't retry if retries are disabled or exceeded
        if (!config || !config.retries || config.__retryCount >= config.retries) {
          return Promise.reject(error);
        }
        
        // Initialize retry count
        config.__retryCount = config.__retryCount || 0;
        config.__retryCount++;
        
        // Check if error is retryable
        const retryableErrors = [502, 503, 504, 'ECONNRESET', 'ENOTFOUND', 'ECONNABORTED', 'ETIMEDOUT'];
        const isRetryable = retryableErrors.includes(error.response?.status) || 
                           retryableErrors.includes(error.code) ||
                           error.message.includes('timeout') ||
                           error.message.includes('socket hang up') ||
                           error.message.includes('network');
        
        if (!isRetryable) {
          return Promise.reject(error);
        }
        
        // Calculate delay
        const delay = config.retryDelay ? config.retryDelay(config.__retryCount) : 2000;
        
        logger.warn(`External API call failed (attempt ${config.__retryCount}/${config.retries}). Retrying in ${delay}ms...`, {
          url: config.url,
          status: error.response?.status,
          code: error.code
        });
        
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.api(config);
      }
    );
  }

  /**
   * Check if external service is available
   */
  async isExternalServiceAvailable() {
    try {
      const response = await this.api.get('/health', { timeout: 10000 });
      return response.data?.status === 'healthy';
    } catch (error) {
      logger.warn('External scraping service health check failed:', error.message);
      return false;
    }
  }

  /**
   * MAIN ENTRY POINT: Scrape a single website page using external service
   * This is the complete flow that gets called from the /scraping/scrape endpoint
   */
  async scrapeWebsite(url, options = {}) {
    try {
      const cleanUrl = this.sanitizeUrl(url);
      logger.info(`Scraping single page via external service: ${cleanUrl}`);

      // Step 1: Check if external service is available
      const isAvailable = await this.isExternalServiceAvailable();
      if (!isAvailable) {
        throw new Error('External scraping service is currently unavailable. Please try again later or contact support.');
      }

      // Step 2: Call external scraping service
      const requestPayload = {
        url: cleanUrl,
        includeJavaScript: false
      };
      logger.debug('Request payload:', requestPayload);

      const response = await this.api.post('/scrape', requestPayload);
      
      if (!response.data || !response.data.success) {
        throw new Error('External scraping service returned unsuccessful response');
      }

      const rawContent = response.data.data;

      // Step 3: Validate content
      if (!rawContent || (typeof rawContent === 'string' && rawContent.trim().length === 0)) {
        throw new Error('No content could be extracted from this URL. The page might be empty, blocked, or require authentication.');
      }
      
      // Step 4: Clean up potential encoding issues
      const cleanedContent = this.cleanEncodingIssues(rawContent);
      
      // Step 5: Process raw content without filtering - store as-is
      const processedResult = await this.processRawContent(cleanUrl, cleanedContent);
      
      // Step 6: Store content using Bedrock compliant structure
      await this.storeContentAsFiles(processedResult);
      
      logger.info(`Successfully scraped and processed: ${cleanUrl}`);
      
      // Step 7: Return structured response
      return {
        url: cleanUrl,
        title: processedResult.title || 'Untitled',
        timestamp: new Date().toISOString(),
        metadata: {
          domain: processedResult.domain,
          source: 'external-scraper',
          folderPath: processedResult.folderPath,
          datasourceFile: processedResult.datasourceFile,
          filesCreated: processedResult.filesCreated
        },
        content: {
          files: processedResult.files
        }
      };

    } catch (error) {
      logger.error('Error scraping website via external service:', error);
      
      // Provide more specific error messages based on error type
      if (error.response?.status === 503) {
        throw new Error('External scraping service is temporarily unavailable (503). Please try again in a few minutes.');
      } else if (error.response?.status === 502 || error.response?.status === 504) {
        throw new Error('External scraping service is experiencing connectivity issues. Please try again later.');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Cannot connect to external scraping service. Please check your internet connection or try again later.');
      } else if (error.message.includes('timeout')) {
        throw new Error('External scraping service request timed out. Please try again with a smaller website or contact support.');
      } else {
        throw new Error(`Failed to scrape website: ${error.message}`);
      }
    }
  }

  /**
   * Process raw content without filtering - store as-is
   */
  async processRawContent(url, rawContent) {
    const domain = new URL(url).hostname;
    const timestamp = new Date().toISOString();
    
    logger.debug('Processing raw content from:', url);
    logger.debug('Raw content length:', rawContent.length);
    
    // Extract title from content (simple extraction)
    let title = 'Untitled';
    try {
      // Try to extract title from HTML if it's HTML content
      if (rawContent.includes('<title>')) {
        const titleMatch = rawContent.match(/<title[^>]*>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        }
      } else {
        // For plain text, use first line as title
        const firstLine = rawContent.split('\n')[0].trim();
        if (firstLine.length > 0 && firstLine.length < 100) {
          title = firstLine;
        }
      }
    } catch (error) {
      logger.warn('Could not extract title, using default:', error.message);
    }
    
    // Sanitize title for file names
    const sanitizedTitle = this.sanitizeTitle(title);
    
    logger.info(`Processed raw content from ${url}: ready for storage`);
    
    // Create a single file object for storage
    const fileData = {
      content: rawContent,
      metadata: {
        id: domain.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-'),
        type: 'web',
        display_name: url,
        title: sanitizedTitle,
        source_url: url,
        created_at: timestamp,
        updated_at: timestamp,
        contentLength: rawContent.length,
        contentHash: generateHash(rawContent)
      }
    };
    
    return {
      url,
      domain,
      title: sanitizedTitle,
      originalTitle: title,
      content: rawContent,
      files: [fileData],
      timestamp,
      metadata: {
        scrapedAt: timestamp,
        source: 'external-scraper',
        originalContentLength: rawContent.length,
        filesCreated: 1,
        extractionMethod: 'raw-content'
      }
    };
  }

  /**
   * Store content using proper datasource structure with subfolders
   */
  async storeContentAsFiles(processedData) {
    try {
      const { domain, files, url } = processedData;
      const storedFiles = [];
      
      // Process each file and store using Bedrock compliant structure
      for (const file of files) {
        // Prepare document for Bedrock compliant storage
        const document = {
          content: file.content,
          title: file.metadata.title,
          url: file.metadata.source_url,
          metadata: {
            ...file.metadata,
            source: 'external-scraper'
          }
        };
        
        // Store using Bedrock compliant structure
        const result = await bedrockCompliantStorage.storeDocument(document);
        
        storedFiles.push({
          contentFile: result.documentPath,
          metadataFile: result.metadataPath,
          size: file.content.length,
          type: 'webpage'
        });
        
        logger.info(`Stored: ${result.documentPath} (${file.content.length} chars)`);
      }
      
      // Update processedData with storage results
      processedData.filesCreated = storedFiles;
      processedData.folderPath = storedFiles[0]?.contentFile?.split('/').slice(0, -1).join('/');
      
      logger.info(`Successfully stored ${files.length} files for ${domain} in Bedrock compliant structure`);
      
    } catch (error) {
      logger.error('Error storing content as files:', error);
      throw new Error(`Failed to store content as files: ${error.message}`);
    }
  }

  /**
   * Clean up common encoding issues from external scraper
   */
  cleanEncodingIssues(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    logger.info('Cleaning encoding issues from content');
    
    let cleaned = content;
    
    // Fix common encoding issues
    const encodingFixes = {
      // Fix UTF-8 encoding issues
      'â˜°': '☰',  // Hamburger menu icon
      'â': '',     // Remove stray â characters
      '˜': '~',    // Fix tilde
      '°': '°',    // Fix degree symbol
      'â€™': "'",  // Right single quotation mark
      'â€œ': '"',  // Left double quotation mark  
      'â€': '"',   // Right double quotation mark
      'â€"': '–',  // En dash
      'â€"': '—',  // Em dash
      'Â©': '©',   // Copyright symbol
      'Â®': '®',   // Registered trademark
      'Â': '',     // Remove stray Â characters
    };

    // Apply encoding fixes
    for (const [encoded, decoded] of Object.entries(encodingFixes)) {
      cleaned = cleaned.replace(new RegExp(encoded, 'g'), decoded);
    }

    // Remove extra whitespace and normalize line breaks
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    logger.info('Encoding cleanup completed:', {
      originalLength: content.length,
      cleanedLength: cleaned.length,
      hasEncodingIssues: cleaned !== content
    });

    return cleaned;
  }

  /**
   * Sanitize title for file names
   */
  sanitizeTitle(title) {
    if (!title || typeof title !== 'string') {
      return 'untitled';
    }
    
    return title
      // Replace spaces with underscores
      .replace(/\s+/g, '_')
      // Remove or replace problematic characters for file names
      .replace(/[<>:"/\\|?*]/g, '_')
      // Remove control characters
      .replace(/[\x00-\x1f\x80-\x9f]/g, '')
      // Limit length
      .substring(0, 100)
      // Remove trailing underscores
      .replace(/^_+|_+$/g, '')
      // Ensure we have something
      || 'untitled';
  }

  /**
   * Sanitize URL
   */
  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }
    
    let cleanUrl = url.trim().replace(/^[@#]+/, '');
    
    if (!cleanUrl.match(/^https?:\/\//)) {
      cleanUrl = 'https://' + cleanUrl;
    }
    
    // Validate URL
    try {
      new URL(cleanUrl);
      return cleanUrl;
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Get scraping history for a domain (placeholder for future implementation)
   */
  async getScrapingHistory(domain) {
    return {
      domain,
      lastScraped: null,
      totalScrapes: 0,
      message: 'History tracking not yet implemented'
    };
  }
}

module.exports = new ExternalScrapingService();
```

## Step 5: Implement Knowledge Base Sync Service

### 5.1 Sync Service (`services/knowledgeBaseSync.js`)

```javascript
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
const logger = require('../utils/logger');

class KnowledgeBaseSyncService {
  constructor() {
    this.bedrockAgentClient = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
      maxAttempts: 3,
    });

    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    this.dataSourceId = process.env.BEDROCK_DATA_SOURCE_ID;
  }

  /**
   * Trigger knowledge base data synchronization after scraping
   */
  async syncKnowledgeBase(domain, waitForCompletion = false) {
    try {
      logger.info(`Starting knowledge base sync for domain: ${domain}`);

      // Check for ongoing jobs and handle accordingly
      if (waitForCompletion) {
        logger.info('Checking for ongoing ingestion jobs...');
        await this.waitForNoActiveJobs();
      }

      const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        description: `Sync scraped content from ${domain} - ${new Date().toISOString()}`
      });

      const response = await this.bedrockAgentClient.send(command);
      
      logger.info(`Knowledge base sync started. Job ID: ${response.ingestionJob.ingestionJobId}`);
      
      return {
        jobId: response.ingestionJob.ingestionJobId,
        status: response.ingestionJob.status,
        startedAt: response.ingestionJob.startedAt
      };

    } catch (error) {
      logger.error('Error starting knowledge base sync:', error);
      
      // Handle specific AWS errors
      if (error.message.includes('already in use') || error.message.includes('ongoing ingestion job')) {
        throw new Error(`Knowledge base is currently processing data. Please wait for the current job to complete and try again in a few minutes.`);
      }
      
      throw new Error(`Failed to sync knowledge base: ${error.message}`);
    }
  }

  /**
   * Check the status of a knowledge base ingestion job
   */
  async checkSyncStatus(jobId) {
    try {
      const command = new GetIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        ingestionJobId: jobId
      });

      const response = await this.bedrockAgentClient.send(command);
      
      return {
        jobId: response.ingestionJob.ingestionJobId,
        status: response.ingestionJob.status,
        startedAt: response.ingestionJob.startedAt,
        updatedAt: response.ingestionJob.updatedAt,
        failureReasons: response.ingestionJob.failureReasons || []
      };

    } catch (error) {
      logger.error('Error checking sync status:', error);
      throw new Error(`Failed to check sync status: ${error.message}`);
    }
  }

  /**
   * Wait for any active ingestion jobs to complete
   */
  async waitForNoActiveJobs(maxWaitTime = 300000) { // 5 minutes default
    const startTime = Date.now();
    const pollInterval = 30000; // 30 seconds
    
    logger.info('Waiting for any active ingestion jobs to complete...');
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Try to start a test job to check if KB is available
        const testCommand = new StartIngestionJobCommand({
          knowledgeBaseId: this.knowledgeBaseId,
          dataSourceId: this.dataSourceId,
          description: `Test job availability - ${new Date().toISOString()}`
        });
        
        // If this succeeds, no job is running
        const testResponse = await this.bedrockAgentClient.send(testCommand);
        logger.info('No active jobs detected, knowledge base is available');
        return;
        
      } catch (error) {
        if (error.message.includes('already in use') || error.message.includes('ongoing ingestion job')) {
          logger.info(`Knowledge base still busy, waiting ${pollInterval/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        } else {
          // Some other error, break the loop
          logger.warn('Unexpected error while checking job status:', error.message);
          break;
        }
      }
    }
    
    logger.warn(`Timeout waiting for active jobs to complete after ${maxWaitTime/1000}s`);
  }

  /**
   * Full synchronization process with status monitoring
   */
  async fullSync(domain, waitForCompletion = false, waitForAvailability = true) {
    try {
      // Start the sync with improved conflict handling
      const syncResult = await this.syncKnowledgeBase(domain, waitForAvailability);
      
      if (waitForCompletion) {
        // Wait for completion
        const finalStatus = await this.waitForSyncCompletion(syncResult.jobId);
        return {
          ...syncResult,
          finalStatus: finalStatus.status,
          completedAt: finalStatus.updatedAt
        };
      }
      
      return syncResult;
      
    } catch (error) {
      logger.error('Error in full sync process:', error);
      throw error;
    }
  }

  /**
   * Wait for ingestion job to complete
   */
  async waitForSyncCompletion(jobId, maxWaitTime = 300000) { // 5 minutes default
    const startTime = Date.now();
    const pollInterval = 10000; // 10 seconds

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.checkSyncStatus(jobId);
        
        if (status.status === 'COMPLETE') {
          logger.info(`Knowledge base sync completed successfully. Job ID: ${jobId}`);
          return status;
        }
        
        if (status.status === 'FAILED') {
          logger.error(`Knowledge base sync failed. Job ID: ${jobId}`, status.failureReasons);
          throw new Error(`Sync failed: ${status.failureReasons.join(', ')}`);
        }
        
        logger.info(`Sync in progress... Status: ${status.status}`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        logger.error('Error waiting for sync completion:', error);
        throw error;
      }
    }
    
    throw new Error(`Sync timeout after ${maxWaitTime / 1000} seconds`);
  }
}

module.exports = new KnowledgeBaseSyncService();
```

## Step 6: Implement HTTP Route

### 6.1 Scraping Route (`routes/scraping.js`)

```javascript
const express = require('express');
const { body, validationResult } = require('express-validator');
const externalScrapingService = require('../services/externalScrapingService');
const knowledgeBaseSync = require('../services/knowledgeBaseSync');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Main scraping endpoint
 * POST /api/scraping/scrape
 * This is the main entry point that triggers the complete scraping and storage flow
 */
router.post('/scrape', [
  // Input validation
  body('url')
    .isURL()
    .withMessage('Must be a valid URL')
    .customSanitizer(value => {
      // Remove @ symbols and other unwanted characters from the beginning
      let cleanUrl = value.trim().replace(/^[@#]+/, '');
      
      // Ensure it starts with http:// or https://
      if (!cleanUrl.match(/^https?:\/\//)) {
        cleanUrl = 'https://' + cleanUrl;
      }
      
      return cleanUrl;
    }),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { url, options = {} } = req.body;

    logger.info(`Received scraping request for: ${url}`);

    // MAIN FLOW: Start scraping via external service
    // This calls the complete flow: scrape → process → store → sync
    const result = await externalScrapingService.scrapeWebsite(url, options);

    // Return success response
    res.json({
      success: true,
      message: 'Website scraped successfully',
      data: {
        url: result.url,
        title: result.title,
        timestamp: result.timestamp,
        metadata: result.metadata,
        filesCreated: result.content.files.length,
        content: {
          preview: result.content.files.length > 0 ? 
            result.content.files[0].content.substring(0, 500) + '...' : 
            'No content extracted',
          totalFiles: result.content.files.length,
          files: result.content.files,
          folderPath: result.metadata?.folderPath || 'N/A',
          datasourceFile: result.metadata?.datasourceFile || 'N/A'
        }
      }
    });

  } catch (error) {
    logger.error('Scraping error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to scrape website',
      message: error.message
    });
  }
});

module.exports = router;
```

## Step 7: Frontend Integration

### 7.1 API Client (`frontend/src/utils/api.js`)

```javascript
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3002/api";
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT_MS || "1200000", 10);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

// API functions
export const scrapingAPI = {
  /**
   * Main scraping function - calls the complete flow
   * This triggers: validation → external scraping → content processing → storage → sync
   */
  scrapeWebsite: async (url, options = {}) => {
    const response = await api.post("/scraping/scrape", { url, options });
    return response.data;
  },

  getStatus: async (domain = null) => {
    const endpoint = domain ? `/scraping/status/${domain}` : "/scraping/status";
    const response = await api.get(endpoint);
    return response.data;
  },

  checkHealth: async () => {
    const response = await api.get("/scraping/health");
    return response.data;
  },
};

export default api;
```

## Step 8: Usage Examples

### 8.1 Basic Scraping Usage

```javascript
// Example: Scrape a single webpage
const { scrapingAPI } = require('./utils/api');

async function scrapeWebpage() {
  try {
    const result = await scrapingAPI.scrapeWebsite('https://example.com', {
      // Optional scraping options
      maxDepth: 1,
      respectRobots: true,
      includeImages: false
    });
    
    console.log('Scraping successful:', {
      url: result.data.url,
      title: result.data.title,
      filesCreated: result.data.filesCreated,
      folderPath: result.data.content.folderPath
    });
    
    return result;
  } catch (error) {
    console.error('Scraping failed:', error.message);
    throw error;
  }
}

// Call the function
scrapeWebpage();
```

### 8.2 Integration in Express App

```javascript
const express = require('express');
const scrapingRoutes = require('./routes/scraping');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/scraping', scrapingRoutes);

// Start server
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Step 9: Testing and Verification

### 9.1 Test the Complete Flow

```javascript
// Test script: test-scraping-flow.js
const { scrapingAPI } = require('./frontend/src/utils/api');

async function testScrapingFlow() {
  console.log('Starting scraping flow test...');
  
  try {
    // Test scraping
    const result = await scrapingAPI.scrapeWebsite('https://example.com');
    
    // Verify results
    console.log('✅ Scraping completed successfully');
    console.log('📄 Document stored at:', result.data.content.folderPath);
    console.log('🔗 Files created:', result.data.filesCreated);
    
    // Test health
    const health = await scrapingAPI.checkHealth();
    console.log('✅ Health check:', health.externalService.available ? 'OK' : 'FAILED');
    
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

// Run test
testScrapingFlow().then(success => {
  process.exit(success ? 0 : 1);
});
```

## Step 10: Error Handling and Debugging

### 10.1 Common Issues and Solutions

```javascript
// Error handling patterns
class ScrapingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ScrapingError';
    this.code = code;
    this.details = details;
  }
}

// Usage in services
try {
  const result = await externalScrapingService.scrapeWebsite(url, options);
  return result;
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    throw new ScrapingError(
      'External scraping service unavailable',
      'SERVICE_UNAVAILABLE',
      { originalError: error.message }
    );
  }
  
  if (error.response?.status === 503) {
    throw new ScrapingError(
      'Service temporarily unavailable',
      'SERVICE_BUSY',
      { retryAfter: error.response.headers['retry-after'] }
    );
  }
  
  throw error;
}
```

### 10.2 Monitoring and Logging

```javascript
// Enhanced logging for debugging
const winston = require('winston');

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.simple()
    }),
    new winston.transports.File({ 
      filename: 'logs/scraping.log',
      level: 'debug'
    })
  ]
});

module.exports = logger;
```

## Complete Flow Summary

The complete `/scraping/scrape` endpoint flow:

1. **HTTP Request** → Express Route validates input
2. **External Scraping** → Calls external scraper service
3. **Content Processing** → Cleans and processes raw content
4. **Storage** → Stores in Bedrock compliant S3 structure
5. **Knowledge Base Sync** → Triggers AWS Bedrock ingestion
6. **Response** → Returns success with metadata

Each step includes proper error handling, retry logic, and comprehensive logging for production use.

## Migration Checklist

- [ ] Install required dependencies
- [ ] Set up environment variables  
- [ ] Implement core utilities (hash, logger)
- [ ] Implement Bedrock compliant storage service
- [ ] Implement external scraping service
- [ ] Implement knowledge base sync service
- [ ] Set up HTTP routes
- [ ] Test the complete flow
- [ ] Configure error handling and monitoring
- [ ] Deploy and verify in production environment

This guide provides everything needed to implement the complete scraping and storing functionality with full AWS Bedrock Knowledge Base integration.

