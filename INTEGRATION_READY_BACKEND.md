# Integration-Ready Backend Structure

## 🚀 Quick Integration Guide

This document provides copy-paste ready function blocks and complete backend structure for integrating the AWS Bedrock Knowledge Base system into any application.

## 📋 Table of Contents

1. [Environment Setup](#environment-setup)
2. [Core Function Blocks](#core-function-blocks)
3. [API Endpoints](#api-endpoints)
4. [Integration Examples](#integration-examples)
5. [Complete Backend Structure](#complete-backend-structure)

## 🔧 Environment Setup

### Required Environment Variables

```bash
# Copy these environment variables to your .env file

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Bedrock Configuration
BEDROCK_KNOWLEDGE_BASE_ID=your_knowledge_base_id
BEDROCK_DATA_SOURCE_ID=your_data_source_id
BEDROCK_S3_BUCKET=your_s3_bucket_name
DEFAULT_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# External Scraping Service (Optional)
EXTERNAL_SCRAPER_URL=your_scraper_service_url

# Rate Limiting Configuration
BEDROCK_MAX_CONCURRENT=2
BEDROCK_MIN_INTERVAL=1500
BEDROCK_MAX_RETRIES=5

# File Upload Configuration
MAX_FILE_SIZE=52428800  # 50MB
MAX_FILES_PER_UPLOAD=10

# Server Configuration
PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### Package Dependencies

```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock": "^3.478.0",
    "@aws-sdk/client-bedrock-agent": "^3.478.0",
    "@aws-sdk/client-bedrock-agent-runtime": "^3.478.0",
    "@aws-sdk/client-bedrock-runtime": "^3.478.0",
    "@aws-sdk/client-s3": "^3.478.0",
    "express": "^4.18.2",
    "express-validator": "^7.0.1",
    "express-rate-limit": "^7.1.5",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.10.0",
    "xlsx": "^0.18.5",
    "cheerio": "^1.1.2",
    "axios": "^1.11.0",
    "winston": "^3.11.0",
    "uuid": "^9.0.1",
    "crypto": "^1.0.1"
  }
}
```

## 🧩 Core Function Blocks

### 1. Bedrock Query Function Block

```javascript
// Copy-paste ready function for AI queries
async function queryKnowledgeBase(message, sessionId = null, model = null) {
  const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
  
  const client = new BedrockAgentRuntimeClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  const params = {
    input: {
      text: message
    },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
        modelArn: model || process.env.DEFAULT_MODEL_ID,
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 10
          }
        }
      }
    }
  };

  if (sessionId) {
    params.sessionId = sessionId;
  }

  try {
    const command = new RetrieveAndGenerateCommand(params);
    const response = await client.send(command);
    
    return {
      answer: response.output.text,
      sources: response.citations || [],
      sessionId: response.sessionId || sessionId
    };
  } catch (error) {
    console.error('Bedrock query error:', error);
    throw new Error(`AI query failed: ${error.message}`);
  }
}
```

### 2. File Upload Processing Function Block

```javascript
// Copy-paste ready function for file processing
async function processUploadedFile(fileBuffer, fileName, metadata = {}) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const path = require('path');
  
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  // Extract text based on file type
  async function extractText(buffer, extension) {
    switch (extension) {
      case '.pdf':
        const pdf = require('pdf-parse');
        const pdfData = await pdf(buffer);
        return pdfData.text;
        
      case '.docx':
        const mammoth = require('mammoth');
        const docxResult = await mammoth.extractRawText({ buffer });
        return docxResult.value;
        
      case '.txt':
      case '.md':
        return buffer.toString('utf-8');
        
      case '.xlsx':
        const xlsx = require('xlsx');
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        let text = '';
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          text += xlsx.utils.sheet_to_txt(sheet) + '\n';
        });
        return text;
        
      default:
        throw new Error(`Unsupported file type: ${extension}`);
    }
  }

  // Create optimized chunks
  function createChunks(text, maxChunkSize = 1000, overlapSize = 100) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    
    for (const sentence of sentences) {
      const cleanSentence = sentence.trim();
      if (currentChunk.length + cleanSentence.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = currentChunk.slice(-overlapSize) + ' ' + cleanSentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + cleanSentence;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  try {
    const fileExtension = path.extname(fileName).toLowerCase();
    const textContent = await extractText(fileBuffer, fileExtension);
    const chunks = createChunks(textContent);
    
    // Store in S3 with proper structure
    const documentId = require('crypto').createHash('md5').update(fileName + Date.now()).digest('hex');
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Store processed document
    const documentKey = `documents/${timestamp}/${documentId}.txt`;
    const documentContent = chunks.join('\n\n--- CHUNK SEPARATOR ---\n\n');
    
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.BEDROCK_S3_BUCKET,
      Key: documentKey,
      Body: documentContent,
      ContentType: 'text/plain',
      Metadata: {
        originalFileName: fileName,
        documentId,
        chunkCount: String(chunks.length),
        processedAt: new Date().toISOString(),
        ...metadata
      }
    }));

    // Store original file backup
    const originalKey = `files/original/${timestamp}/${documentId}${fileExtension}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.BEDROCK_S3_BUCKET,
      Key: originalKey,
      Body: fileBuffer,
      ContentType: getContentType(fileExtension),
      Metadata: {
        documentId,
        originalFileName: fileName
      }
    }));

    return {
      documentId,
      fileName,
      chunkCount: chunks.length,
      contentLength: textContent.length,
      s3Keys: [documentKey, originalKey],
      processedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('File processing error:', error);
    throw new Error(`File processing failed: ${error.message}`);
  }
}

function getContentType(extension) {
  const types = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return types[extension] || 'application/octet-stream';
}
```

### 3. URL Scraping Function Block

```javascript
// Copy-paste ready function for URL scraping
async function scrapeWebsiteContent(url, options = {}) {
  const axios = require('axios');
  const cheerio = require('cheerio');
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  // Clean and extract text content
  function extractTextContent(html) {
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .navigation, .menu, .sidebar').remove();
    
    // Extract main content
    const mainContent = $('main, article, .content, .post, .entry').first();
    const content = mainContent.length > 0 ? mainContent.text() : $('body').text();
    
    return content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  // Create optimized chunks
  function createChunks(text, maxChunkSize = 1000, overlapSize = 100) {
    const chunks = [];
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = currentChunk.slice(-overlapSize) + '\n\n' + paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  try {
    // Fetch webpage content
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const title = $('title').text().trim() || new URL(url).hostname;
    const textContent = extractTextContent(response.data);
    const chunks = createChunks(textContent);

    if (chunks.length === 0) {
      throw new Error('No meaningful content could be extracted from the URL');
    }

    // Store in S3
    const documentId = require('crypto').createHash('md5').update(url + Date.now()).digest('hex');
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Store processed content
    const documentKey = `documents/${timestamp}/${documentId}.txt`;
    const documentContent = chunks.join('\n\n--- CHUNK SEPARATOR ---\n\n');
    
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.BEDROCK_S3_BUCKET,
      Key: documentKey,
      Body: documentContent,
      ContentType: 'text/plain',
      Metadata: {
        sourceUrl: url,
        title,
        documentId,
        chunkCount: String(chunks.length),
        scrapedAt: new Date().toISOString(),
        contentType: 'web-scrape'
      }
    }));

    // Store raw HTML backup
    const rawKey = `raw-content/web-scrapes/${timestamp}/${documentId}.html`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.BEDROCK_S3_BUCKET,
      Key: rawKey,
      Body: response.data,
      ContentType: 'text/html',
      Metadata: {
        sourceUrl: url,
        documentId
      }
    }));

    return {
      url,
      title,
      documentId,
      chunkCount: chunks.length,
      contentLength: textContent.length,
      chunks: chunks.map((chunk, index) => ({
        index: index + 1,
        content: chunk,
        wordCount: chunk.split(/\s+/).length
      })),
      s3Keys: [documentKey, rawKey],
      processedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Scraping error:', error);
    throw new Error(`Website scraping failed: ${error.message}`);
  }
}
```

### 4. Knowledge Base Sync Function Block

```javascript
// Copy-paste ready function for triggering KB sync
async function syncKnowledgeBase() {
  const { BedrockAgentClient, StartIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
  
  const client = new BedrockAgentClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  try {
    const command = new StartIngestionJobCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
      dataSourceId: process.env.BEDROCK_DATA_SOURCE_ID,
      description: `Sync job started at ${new Date().toISOString()}`
    });

    const response = await client.send(command);
    
    return {
      jobId: response.ingestionJob.ingestionJobId,
      status: response.ingestionJob.status,
      startedAt: response.ingestionJob.startedAt
    };
    
  } catch (error) {
    console.error('Sync error:', error);
    throw new Error(`Knowledge Base sync failed: ${error.message}`);
  }
}

// Check sync status
async function getSyncStatus(jobId) {
  const { BedrockAgentClient, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
  
  const client = new BedrockAgentClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  try {
    const command = new GetIngestionJobCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
      dataSourceId: process.env.BEDROCK_DATA_SOURCE_ID,
      ingestionJobId: jobId
    });

    const response = await client.send(command);
    
    return {
      jobId: response.ingestionJob.ingestionJobId,
      status: response.ingestionJob.status,
      startedAt: response.ingestionJob.startedAt,
      updatedAt: response.ingestionJob.updatedAt,
      statistics: response.ingestionJob.statistics
    };
    
  } catch (error) {
    console.error('Status check error:', error);
    throw new Error(`Failed to check sync status: ${error.message}`);
  }
}
```

### 5. Data Management Function Block

```javascript
// Copy-paste ready function for data management
async function manageKnowledgeBaseData() {
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  // List all documents in knowledge base
  async function listAllDocuments() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: process.env.BEDROCK_S3_BUCKET,
        Prefix: 'documents/'
      });

      const response = await s3Client.send(command);
      
      return response.Contents?.map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        documentId: obj.Key.split('/').pop().replace('.txt', '')
      })) || [];
      
    } catch (error) {
      console.error('List documents error:', error);
      throw new Error(`Failed to list documents: ${error.message}`);
    }
  }

  // Delete documents by domain
  async function deleteByDomain(domain, dryRun = true) {
    try {
      const allDocuments = await listAllDocuments();
      const documentsToDelete = allDocuments.filter(doc => 
        doc.key.includes(domain) || doc.documentId.includes(domain)
      );

      if (dryRun) {
        return {
          dryRun: true,
          documentsFound: documentsToDelete.length,
          documents: documentsToDelete
        };
      }

      // Actually delete the documents
      const deletePromises = documentsToDelete.map(doc => 
        s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.BEDROCK_S3_BUCKET,
          Key: doc.key
        }))
      );

      await Promise.all(deletePromises);

      return {
        deleted: true,
        documentsDeleted: documentsToDelete.length,
        documents: documentsToDelete
      };
      
    } catch (error) {
      console.error('Delete by domain error:', error);
      throw new Error(`Failed to delete by domain: ${error.message}`);
    }
  }

  // Get storage statistics
  async function getStorageStats() {
    try {
      const documents = await listAllDocuments();
      const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
      
      return {
        totalDocuments: documents.length,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        lastUpdated: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Storage stats error:', error);
      throw new Error(`Failed to get storage stats: ${error.message}`);
    }
  }

  return {
    listAllDocuments,
    deleteByDomain,
    getStorageStats
  };
}
```

## 🌐 Express Route Setup

### Complete Express Server Template

```javascript
// Copy-paste ready Express server setup
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// File upload setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'), // 50MB
    files: parseInt(process.env.MAX_FILES_PER_UPLOAD || '10')
  }
});

// Import function blocks (put the functions above in separate files)
const { queryKnowledgeBase } = require('./functions/bedrock-query');
const { processUploadedFile } = require('./functions/file-processing');
const { scrapeWebsiteContent } = require('./functions/web-scraping');
const { syncKnowledgeBase, getSyncStatus } = require('./functions/kb-sync');
const { manageKnowledgeBaseData } = require('./functions/data-management');

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Chat endpoints
app.post('/api/chat/query', async (req, res) => {
  try {
    const { message, sessionId, model } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    const result = await queryKnowledgeBase(message, sessionId, model);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// File upload endpoints
app.post('/api/files/upload', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const results = await Promise.all(
      req.files.map(file => 
        processUploadedFile(file.buffer, file.originalname, {
          title: req.body.title,
          description: req.body.description
        })
      )
    );

    res.json({
      success: true,
      message: `Processed ${results.length} files successfully`,
      data: { files: results }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Web scraping endpoints
app.post('/api/scraping/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const result = await scrapeWebsiteContent(url);
    
    res.json({
      success: true,
      message: 'Website scraped successfully',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Knowledge base sync endpoints
app.post('/api/kb/sync', async (req, res) => {
  try {
    const result = await syncKnowledgeBase();
    
    res.json({
      success: true,
      message: 'Knowledge Base sync started',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/kb/sync-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await getSyncStatus(jobId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Data management endpoints
app.get('/api/data/documents', async (req, res) => {
  try {
    const dataManager = manageKnowledgeBaseData();
    const documents = await dataManager.listAllDocuments();
    
    res.json({
      success: true,
      data: { documents }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/data/stats', async (req, res) => {
  try {
    const dataManager = manageKnowledgeBaseData();
    const stats = await dataManager.getStorageStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Route not found' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🔧 AWS Region: ${process.env.AWS_REGION}`);
  console.log(`📚 Knowledge Base ID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
});

module.exports = app;
```

## 🔗 Complete Integration Example

### Ready-to-Use Integration Code

```javascript
// integration-example.js - Complete working example
const express = require('express');
require('dotenv').config();

// Copy all function blocks from above or import them
const { queryKnowledgeBase } = require('./bedrock-functions');

const app = express();
app.use(express.json());

// Single endpoint that demonstrates the complete flow
app.post('/api/complete-flow', async (req, res) => {
  try {
    const { action, data } = req.body;
    
    switch (action) {
      case 'chat':
        const chatResult = await queryKnowledgeBase(data.message, data.sessionId);
        return res.json({ success: true, type: 'chat', data: chatResult });
        
      case 'upload':
        // Handle file upload (assuming file is base64 encoded)
        const fileBuffer = Buffer.from(data.fileContent, 'base64');
        const uploadResult = await processUploadedFile(fileBuffer, data.fileName);
        return res.json({ success: true, type: 'upload', data: uploadResult });
        
      case 'scrape':
        const scrapeResult = await scrapeWebsiteContent(data.url);
        return res.json({ success: true, type: 'scrape', data: scrapeResult });
        
      case 'sync':
        const syncResult = await syncKnowledgeBase();
        return res.json({ success: true, type: 'sync', data: syncResult });
        
      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(3002, () => {
  console.log('🚀 Complete integration server running on port 3002');
});
```

## 📊 Testing the Integration

### Test Commands

```bash
# Test chat functionality
curl -X POST http://localhost:3002/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{"message": "What information is available in the knowledge base?"}'

# Test file upload
curl -X POST http://localhost:3002/api/files/upload \
  -F "files=@your-document.pdf"

# Test web scraping
curl -X POST http://localhost:3002/api/scraping/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Test knowledge base sync
curl -X POST http://localhost:3002/api/kb/sync

# Check storage statistics
curl http://localhost:3002/api/data/stats
```

## 🎯 Integration Checklist

- [ ] Environment variables configured
- [ ] AWS credentials set up
- [ ] S3 bucket created and configured
- [ ] Bedrock Knowledge Base created
- [ ] Dependencies installed
- [ ] Function blocks copied and configured
- [ ] Express routes set up
- [ ] Error handling implemented
- [ ] Rate limiting configured
- [ ] Testing completed

## 🔧 Customization Options

### Modify Chunking Strategy
```javascript
// Adjust chunk configuration in function blocks
const chunkConfig = {
  maxChunkSize: 1500,    // Increase for larger chunks
  overlapSize: 150,      // Increase overlap for better context
  minChunkSize: 200,     // Minimum chunk size
  separators: ['\n\n', '\n', '. ', '! ', '? ', '; ']
};
```

### Add Custom File Types
```javascript
// Extend supported file types
const customFileProcessors = {
  '.xml': (buffer) => {
    // Custom XML processing logic
    return extractTextFromXML(buffer);
  },
  '.json': (buffer) => {
    // Custom JSON processing logic
    return JSON.stringify(JSON.parse(buffer.toString()), null, 2);
  }
};
```

### Configure Rate Limiting
```javascript
// Adjust rate limiting for your needs
const customRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 200, // Increase for higher traffic
  message: 'Custom rate limit message'
});
```

## 🚀 Ready for Production

This integration package provides:
- ✅ Complete copy-paste function blocks
- ✅ Ready-to-use Express server setup
- ✅ Comprehensive error handling
- ✅ Rate limiting and security
- ✅ File upload processing
- ✅ Web scraping capabilities
- ✅ Knowledge base management
- ✅ AWS Bedrock integration
- ✅ Testing examples
- ✅ Production-ready configuration

Simply copy the required function blocks, configure your environment variables, and start integrating!