# 🚀 Complete Migration Guide: OpenAI + Pinecone → AWS Bedrock

## Overview
This guide provides step-by-step instructions to migrate from OpenAI embeddings + Pinecone vector storage to AWS Bedrock Knowledge Base with S3 storage.

## 📋 Migration Strategy

### Current Architecture (Before)
```
Scraped Data → OpenAI Embeddings (text-embedding-3-large) → Pinecone Vector DB → OpenAI Chat → Response
```

### New Architecture (After)
```
Scraped Data → AWS Bedrock Knowledge Base (S3 + Vector Store) → Claude Foundation Models → Response
Files/PDFs → S3 → Bedrock Knowledge Base Sync → Claude → Response
```

## 🔧 Step 1: AWS Setup & Configuration

### 1.1 Environment Variables
Add these to your `.env` file:

```bash
# AWS Bedrock Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Bedrock Knowledge Base
BEDROCK_KNOWLEDGE_BASE_ID=your_kb_id
BEDROCK_S3_BUCKET=your-knowledge-base-bucket

# Model Configuration
DEFAULT_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
BEDROCK_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
```

### 1.2 Required AWS Services
- ✅ Amazon Bedrock (Knowledge Base + Foundation Models)
- ✅ Amazon S3 (Document Storage)
- ✅ Amazon OpenSearch Serverless (Vector Store)
- ✅ IAM Roles and Policies

### 1.3 IAM Permissions
Create IAM role with these policies:
- `AmazonBedrockFullAccess`
- `AmazonS3FullAccess`
- `AmazonOpenSearchServerlessAPIAccessAll`

## 🔄 Step 2: Service Migration

### 2.1 Replace OpenAI Embedding Service

Create: `src/services/bedrockEmbeddingService.js`

```javascript
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const logger = require('../utils/logger');

class BedrockEmbeddingService {
  constructor() {
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.embeddingModel = process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
  }

  /**
   * Generate embeddings for text (replaces OpenAI embeddings)
   * @param {string} text - Text to embed
   * @returns {Promise<Array>} - Embedding vector
   */
  async generateEmbedding(text) {
    try {
      const body = JSON.stringify({
        inputText: text,
        dimensions: 1024, // Titan V2 default (adjust based on your needs)
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
      
      return responseBody.embedding;
    } catch (error) {
      logger.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts
   * @param {Array<string>} texts - Array of texts to embed
   * @returns {Promise<Array<Array>>} - Array of embedding vectors
   */
  async generateEmbeddings(texts) {
    const embeddings = [];
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }
}

module.exports = new BedrockEmbeddingService();
```

### 2.2 Replace Pinecone with Bedrock Knowledge Base

Create: `src/services/bedrockKnowledgeBaseService.js`

```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
const { generateHash } = require('../utils/hash');
const logger = require('../utils/logger');

class BedrockKnowledgeBaseService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.bedrockAgent = new BedrockAgentClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.bucket = process.env.BEDROCK_S3_BUCKET;
    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
  }

  /**
   * Store document in S3 and sync with Knowledge Base (replaces Pinecone storage)
   * @param {Object} document - Document object with content and metadata
   * @returns {Promise<Object>} - Storage result
   */
  async storeDocument(document) {
    try {
      const { content, metadata, title, url } = document;
      
      // Create chunks from content
      const chunks = this.createOptimalChunks(content);
      
      // Generate unique key for S3
      const documentId = generateHash(url || title);
      const s3Key = `documents/${documentId}.txt`;
      
      // Prepare document for S3 storage
      const documentContent = this.formatDocumentForBedrock(chunks, metadata, title, url);
      
      // Store in S3
      await this.uploadToS3(s3Key, documentContent, metadata);
      
      // Trigger Knowledge Base sync
      const syncJobId = await this.syncKnowledgeBase();
      
      logger.info(`Document stored successfully: ${s3Key}`);
      
      return {
        documentId,
        s3Key,
        syncJobId,
        chunkCount: chunks.length,
        success: true
      };
    } catch (error) {
      logger.error('Error storing document:', error);
      throw new Error(`Failed to store document: ${error.message}`);
    }
  }

  /**
   * Create optimal chunks for Bedrock Knowledge Base
   * @param {string} content - Document content
   * @returns {Array} - Array of chunks
   */
  createOptimalChunks(content) {
    const maxChunkSize = 1000; // Optimal for Bedrock
    const overlap = 100; // Character overlap between chunks
    const chunks = [];
    
    // Split by paragraphs first
    const paragraphs = content.split(/\n\s*\n/);
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Add overlap from previous chunk
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-20).join(' '); // Last 20 words as overlap
        currentChunk = overlapWords + ' ' + paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  /**
   * Format document for Bedrock Knowledge Base
   * @param {Array} chunks - Document chunks
   * @param {Object} metadata - Document metadata
   * @param {string} title - Document title
   * @param {string} url - Document URL
   * @returns {string} - Formatted document
   */
  formatDocumentForBedrock(chunks, metadata, title, url) {
    const header = `Title: ${title}\nURL: ${url}\nScraped: ${new Date().toISOString()}\n\n`;
    const content = chunks.join('\n\n---\n\n');
    return header + content;
  }

  /**
   * Upload document to S3
   * @param {string} key - S3 key
   * @param {string} content - Document content
   * @param {Object} metadata - Document metadata
   */
  async uploadToS3(key, content, metadata) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
      Metadata: {
        title: metadata.title || 'Untitled',
        url: metadata.url || '',
        domain: metadata.domain || '',
        scrapedAt: new Date().toISOString()
      }
    });

    await this.s3Client.send(command);
  }

  /**
   * Trigger Knowledge Base synchronization
   * @returns {Promise<string>} - Sync job ID
   */
  async syncKnowledgeBase() {
    try {
      const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: process.env.BEDROCK_DATA_SOURCE_ID // Configure this in AWS Console
      });

      const response = await this.bedrockAgent.send(command);
      return response.ingestionJob.ingestionJobId;
    } catch (error) {
      logger.warn('Knowledge Base sync failed:', error.message);
      return null; // Non-blocking - sync can happen later
    }
  }

  /**
   * Check sync job status
   * @param {string} jobId - Sync job ID
   * @returns {Promise<Object>} - Job status
   */
  async getSyncStatus(jobId) {
    try {
      const command = new GetIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: process.env.BEDROCK_DATA_SOURCE_ID,
        ingestionJobId: jobId
      });

      const response = await this.bedrockAgent.send(command);
      return response.ingestionJob;
    } catch (error) {
      logger.error('Error checking sync status:', error);
      return null;
    }
  }
}

module.exports = new BedrockKnowledgeBaseService();
```

## 📁 Step 3: File Upload & Processing Service

Create: `src/services/fileProcessingService.js`

```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pdf = require('pdf-parse');
const mammoth = require('mammoth'); // For DOCX files
const logger = require('../utils/logger');
const bedrockKnowledgeBaseService = require('./bedrockKnowledgeBaseService');

class FileProcessingService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = process.env.BEDROCK_S3_BUCKET;
  }

  /**
   * Configure multer for file uploads
   */
  getUploadConfig() {
    return multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.docx', '.txt', '.md'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error(`File type ${ext} not supported. Allowed: ${allowedTypes.join(', ')}`));
        }
      }
    });
  }

  /**
   * Process uploaded file and store in Knowledge Base
   * @param {Object} file - Uploaded file
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - Processing result
   */
  async processUploadedFile(file, metadata = {}) {
    try {
      logger.info(`Processing uploaded file: ${file.originalname}`);
      
      // Extract text content based on file type
      const textContent = await this.extractTextContent(file);
      
      // Prepare document for storage
      const document = {
        content: textContent,
        title: metadata.title || file.originalname,
        url: `file://${file.originalname}`,
        metadata: {
          ...metadata,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          uploadedAt: new Date().toISOString()
        }
      };
      
      // Store in Knowledge Base
      const result = await bedrockKnowledgeBaseService.storeDocument(document);
      
      // Also store original file in S3 for reference
      await this.storeOriginalFile(file, result.documentId);
      
      return {
        ...result,
        fileName: file.originalname,
        contentLength: textContent.length,
        fileType: path.extname(file.originalname)
      };
    } catch (error) {
      logger.error('Error processing uploaded file:', error);
      throw new Error(`Failed to process file: ${error.message}`);
    }
  }

  /**
   * Extract text content from different file types
   * @param {Object} file - File buffer
   * @returns {Promise<string>} - Extracted text
   */
  async extractTextContent(file) {
    const ext = path.extname(file.originalname).toLowerCase();
    
    switch (ext) {
      case '.pdf':
        return await this.extractPdfText(file.buffer);
      case '.docx':
        return await this.extractDocxText(file.buffer);
      case '.txt':
      case '.md':
        return file.buffer.toString('utf-8');
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Extract text from PDF
   * @param {Buffer} buffer - PDF buffer
   * @returns {Promise<string>} - Extracted text
   */
  async extractPdfText(buffer) {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (error) {
      throw new Error(`PDF extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from DOCX
   * @param {Buffer} buffer - DOCX buffer
   * @returns {Promise<string>} - Extracted text
   */
  async extractDocxText(buffer) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      throw new Error(`DOCX extraction failed: ${error.message}`);
    }
  }

  /**
   * Store original file in S3 for reference
   * @param {Object} file - Original file
   * @param {string} documentId - Document ID
   */
  async storeOriginalFile(file, documentId) {
    const key = `files/original/${documentId}${path.extname(file.originalname)}`;
    
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        originalName: file.originalname,
        documentId: documentId,
        uploadedAt: new Date().toISOString()
      }
    });

    await this.s3Client.send(command);
  }
}

module.exports = new FileProcessingService();
```

## 🔄 Step 4: API Endpoint Migration

### 4.1 Update Existing Scraping Endpoints

In your existing scraping route, replace the storage logic:

```javascript
// OLD: Pinecone storage
// const vector = await openAIService.generateEmbedding(content);
// await pineconeService.upsert(vector, metadata);

// NEW: Bedrock Knowledge Base storage
const bedrockKnowledgeBaseService = require('../services/bedrockKnowledgeBaseService');

// In your scraping endpoint:
const document = {
  content: scrapedContent,
  title: pageTitle,
  url: scrapedUrl,
  metadata: {
    domain: domain,
    scrapedAt: new Date().toISOString(),
    // ... other metadata
  }
};

const result = await bedrockKnowledgeBaseService.storeDocument(document);
```

### 4.2 Add File Upload Endpoints

Create: `src/routes/files.js`

```javascript
const express = require('express');
const { body, validationResult } = require('express-validator');
const fileProcessingService = require('../services/fileProcessingService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Upload and process files
 * POST /api/files/upload
 */
router.post('/upload', 
  fileProcessingService.getUploadConfig().array('files', 10), // Max 10 files
  [
    body('title').optional().isString().withMessage('Title must be a string'),
    body('description').optional().isString().withMessage('Description must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files uploaded'
        });
      }

      const results = [];
      const { title, description } = req.body;

      for (const file of req.files) {
        const metadata = {
          title: title || file.originalname,
          description: description || '',
          uploadedBy: req.user?.id || 'anonymous' // Add user context if available
        };

        const result = await fileProcessingService.processUploadedFile(file, metadata);
        results.push(result);
      }

      res.json({
        success: true,
        message: `Successfully processed ${results.length} file(s)`,
        data: {
          files: results,
          totalFiles: results.length,
          totalContentLength: results.reduce((sum, r) => sum + r.contentLength, 0)
        }
      });

    } catch (error) {
      logger.error('File upload error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process files',
        message: error.message
      });
    }
  }
);

module.exports = router;
```

### 4.3 Update Query Endpoints

Your existing query endpoints should work with the POC bedrockService.js we already created, just make sure to use:

```javascript
// Replace OpenAI chat with Bedrock Claude
const bedrockService = require('../services/bedrockService');

// In your query endpoint:
const response = await bedrockService.queryKnowledgeBase(userQuery, sessionId, 'claude-3-sonnet');
```

## 📦 Step 5: Dependencies

Update your `package.json`:

```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.x.x",
    "@aws-sdk/client-bedrock-agent": "^3.x.x",
    "@aws-sdk/client-bedrock-agent-runtime": "^3.x.x",
    "@aws-sdk/client-s3": "^3.x.x",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0",
    "multer": "^1.4.5"
  }
}
```

Install dependencies:
```bash
npm install @aws-sdk/client-bedrock-runtime @aws-sdk/client-bedrock-agent @aws-sdk/client-bedrock-agent-runtime @aws-sdk/client-s3 pdf-parse mammoth multer
```

## 🚀 Step 6: Integration Steps

### 6.1 Replace Services One by One

1. **Start with embeddings**: Replace OpenAI embedding calls with `bedrockEmbeddingService`
2. **Replace storage**: Replace Pinecone storage with `bedrockKnowledgeBaseService`
3. **Replace queries**: Replace OpenAI chat with `bedrockService` (already done in POC)
4. **Add file support**: Add file upload endpoints using `fileProcessingService`

### 6.2 Testing Migration

1. Test scraping endpoints store to Bedrock Knowledge Base
2. Test queries return similar quality responses
3. Test file upload and processing
4. Test knowledge base sync status

### 6.3 Gradual Migration (Optional)

You can implement feature flags to gradually migrate:

```javascript
const USE_BEDROCK = process.env.USE_BEDROCK === 'true';

if (USE_BEDROCK) {
  // Use Bedrock services
} else {
  // Use existing OpenAI + Pinecone
}
```

## ✅ Final Checklist

- [ ] AWS services configured (Bedrock, S3, OpenSearch)
- [ ] Environment variables set
- [ ] IAM permissions configured
- [ ] Bedrock services implemented
- [ ] File processing service added
- [ ] API endpoints updated
- [ ] Dependencies installed
- [ ] Testing completed
- [ ] Knowledge base sync working

This migration maintains your existing API structure while upgrading to AWS Bedrock for better performance, cost efficiency, and enterprise-grade capabilities.