# Complete Integration Guide
## AWS Bedrock Knowledge Base System

## 🎯 Overview

This guide provides complete step-by-step instructions to integrate the AWS Bedrock Knowledge Base system into any application. The system provides:

- **AI-Powered Chat** with RAG (Retrieval Augmented Generation)
- **File Upload Processing** (PDF, DOCX, TXT, etc.)
- **Web Scraping** with intelligent content extraction
- **Knowledge Base Management** with AWS Bedrock
- **Data Management** with CRUD operations

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [AWS Setup](#aws-setup)
3. [Environment Configuration](#environment-configuration)
4. [Installation Steps](#installation-steps)
5. [Backend Integration](#backend-integration)
6. [Frontend Integration](#frontend-integration)
7. [Testing & Verification](#testing--verification)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)
10. [Advanced Configuration](#advanced-configuration)

---

## 🔧 Prerequisites

### System Requirements
- **Node.js** 18+ (LTS recommended)
- **npm** or **yarn** package manager
- **AWS Account** with Bedrock access
- **S3 Bucket** for document storage
- **Minimum 2GB RAM** for file processing

### AWS Services Required
- **AWS Bedrock** (Foundation Models + Knowledge Base)
- **Amazon S3** (Document storage)
- **AWS IAM** (Access management)
- **Amazon Bedrock Agent** (Knowledge Base operations)

### Development Environment
- **Code Editor** (VS Code, WebStorm, etc.)
- **Terminal/Command Line** access
- **Git** for version control
- **Postman** or similar for API testing

---

## ☁️ AWS Setup

### Step 1: Enable AWS Bedrock
1. **Login to AWS Console**
2. **Navigate to Amazon Bedrock**
3. **Request Model Access** (if not already enabled):
   - Go to "Model access" in Bedrock console
   - Request access to **Claude 3 Sonnet** and other desired models
   - Wait for approval (usually immediate for most models)

### Step 2: Create S3 Bucket
```bash
# Using AWS CLI
aws s3 mb s3://your-knowledge-base-bucket --region us-east-1

# Or create via AWS Console:
# 1. Go to S3 service
# 2. Click "Create bucket"
# 3. Name: your-knowledge-base-bucket
# 4. Region: us-east-1 (or your preferred region)
# 5. Keep default settings and create
```

### Step 3: Create Knowledge Base
1. **Go to Bedrock console** → Knowledge bases
2. **Click "Create knowledge base"**
3. **Configure Knowledge Base**:
   ```
   Name: your-knowledge-base
   Description: Knowledge base for AI-powered applications
   IAM Role: Create new service role
   ```

4. **Configure Data Source**:
   ```
   Data source name: s3-documents
   S3 URI: s3://your-knowledge-base-bucket/documents/
   Chunking strategy: Default chunking
   ```

5. **Configure Vector Database**:
   ```
   Vector database: Amazon OpenSearch Serverless (recommended)
   Collection name: knowledge-base-collection
   Vector index name: knowledge-base-index
   Vector field: bedrock-knowledge-base-default-vector
   Text field: AMAZON_BEDROCK_TEXT_CHUNK
   Metadata field: AMAZON_BEDROCK_METADATA
   ```

6. **Review and Create**

### Step 4: Configure IAM Permissions

Create IAM policy for application access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agent-runtime:RetrieveAndGenerate",
        "bedrock-agent-runtime:Retrieve"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agent:StartIngestionJob",
        "bedrock-agent:GetIngestionJob",
        "bedrock-agent:ListIngestionJobs"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-knowledge-base-bucket",
        "arn:aws:s3:::your-knowledge-base-bucket/*"
      ]
    }
  ]
}
```

### Step 5: Get Required IDs
After creating the Knowledge Base, note down:
- **Knowledge Base ID**: `kb-xxxxxxxxx`
- **Data Source ID**: `ds-xxxxxxxxx`
- **S3 Bucket Name**: `your-knowledge-base-bucket`

---

## 🔐 Environment Configuration

### Create Environment File
Create `.env` file in your project root:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# Bedrock Configuration
BEDROCK_KNOWLEDGE_BASE_ID=kb-your-kb-id-here
BEDROCK_DATA_SOURCE_ID=ds-your-ds-id-here
BEDROCK_S3_BUCKET=your-knowledge-base-bucket
DEFAULT_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# Server Configuration
PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Rate Limiting (Optional)
BEDROCK_MAX_CONCURRENT=2
BEDROCK_MIN_INTERVAL=1500
BEDROCK_MAX_RETRIES=5
BEDROCK_BASE_DELAY=2000
BEDROCK_MAX_DELAY=30000

# File Upload Configuration (Optional)
MAX_FILE_SIZE=52428800  # 50MB
MAX_FILES_PER_UPLOAD=10

# CORS Configuration (Optional)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# External Scraping Service (Optional)
EXTERNAL_SCRAPER_URL=https://your-scraper-service.com

# Logging (Optional)
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

### Environment Validation
Create a validation script to check your configuration:

```javascript
// validate-env.js
require('dotenv').config();

const requiredVars = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'BEDROCK_KNOWLEDGE_BASE_ID',
  'BEDROCK_DATA_SOURCE_ID',
  'BEDROCK_S3_BUCKET'
];

console.log('🔍 Validating environment configuration...\n');

const missing = requiredVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(varName => console.error(`   - ${varName}`));
  process.exit(1);
}

console.log('✅ All required environment variables are set');
console.log('\n📋 Configuration Summary:');
console.log(`   AWS Region: ${process.env.AWS_REGION}`);
console.log(`   Knowledge Base ID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
console.log(`   S3 Bucket: ${process.env.BEDROCK_S3_BUCKET}`);
console.log(`   Server Port: ${process.env.PORT || 3002}`);
console.log('\n🚀 Ready to start integration!');
```

Run validation:
```bash
node validate-env.js
```

---

## 📦 Installation Steps

### Step 1: Initialize Project
```bash
# Create new project or navigate to existing one
mkdir my-knowledge-base-app
cd my-knowledge-base-app

# Initialize package.json
npm init -y
```

### Step 2: Install Dependencies
```bash
# Core dependencies
npm install express cors helmet express-rate-limit express-validator
npm install @aws-sdk/client-bedrock @aws-sdk/client-bedrock-agent @aws-sdk/client-bedrock-agent-runtime @aws-sdk/client-bedrock-runtime @aws-sdk/client-s3
npm install multer pdf-parse mammoth xlsx cheerio axios winston uuid crypto dotenv

# Development dependencies
npm install --save-dev nodemon concurrently
```

### Step 3: Create Project Structure
```bash
# Create directory structure
mkdir -p src/{routes,services,utils}
mkdir -p functions
mkdir -p logs
mkdir -p public

# Create main files
touch server.js
touch src/routes/{chat.js,files.js,scraping.js,dataManagement.js,health.js}
touch src/services/{bedrockService.js,fileProcessingService.js,scrapingService.js}
touch src/utils/{logger.js,hash.js}
```

### Step 4: Update Package.json Scripts
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node validate-env.js",
    "logs": "tail -f logs/app.log"
  }
}
```

---

## 🖥️ Backend Integration

### Step 1: Create Utility Functions

**src/utils/logger.js**
```javascript
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(process.cwd(), 'logs', 'app.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

module.exports = logger;
```

**src/utils/hash.js**
```javascript
const crypto = require('crypto');

function generateHash(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function generateUUID() {
  return crypto.randomUUID();
}

module.exports = {
  generateHash,
  generateUUID
};
```

### Step 2: Create Core Services

Copy the function blocks from `INTEGRATION_READY_BACKEND.md` and organize them into these service files:

1. **src/services/bedrockService.js** - AI query functionality
2. **src/services/fileProcessingService.js** - File upload processing
3. **src/services/scrapingService.js** - Web scraping functionality

### Step 3: Create Route Handlers

**src/routes/chat.js**
```javascript
const express = require('express');
const { body, validationResult } = require('express-validator');
const bedrockService = require('../services/bedrockService');
const logger = require('../utils/logger');

const router = express.Router();

// Query knowledge base with RAG
router.post('/query', [
  body('message').isString().isLength({ min: 1, max: 2000 }).trim(),
  body('sessionId').optional().isString(),
  body('model').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { message, sessionId, model } = req.body;
    logger.info(`Processing query: ${message.substring(0, 100)}...`);

    const result = await bedrockService.queryKnowledgeBase(message, sessionId, model);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Chat query error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
```

### Step 4: Create Main Server

**server.js**
```javascript
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./src/utils/logger');

// Import routes
const chatRoutes = require('./src/routes/chat');
const filesRoutes = require('./src/routes/files');
const scrapingRoutes = require('./src/routes/scraping');
const dataManagementRoutes = require('./src/routes/dataManagement');
const healthRoutes = require('./src/routes/health');

const app = express();
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet());

// CORS configuration
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

// API routes
app.use('/api/health', healthRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/scraping', scrapingRoutes);
app.use('/api/data-management', dataManagementRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
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
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📱 Frontend URL: ${process.env.FRONTEND_URL}`);
  logger.info(`🔧 AWS Region: ${process.env.AWS_REGION}`);
  logger.info(`📚 Knowledge Base ID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
  });
});

module.exports = app;
```

---

## 🎨 Frontend Integration

### React Integration Example

**Install Frontend Dependencies**
```bash
# Navigate to frontend directory
cd frontend

# Install React dependencies
npm install axios react-query react-hook-form
```

**Create API Client**
```javascript
// src/services/api.js
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const chatAPI = {
  query: (message, sessionId = null) => 
    api.post('/chat/query', { message, sessionId }),
  
  getModels: () => 
    api.get('/chat/models'),
    
  getStatus: () => 
    api.get('/chat/status')
};

export const filesAPI = {
  upload: (files, metadata = {}) => {
    const formData = new FormData();
    Array.from(files).forEach(file => {
      formData.append('files', file);
    });
    Object.keys(metadata).forEach(key => {
      formData.append(key, metadata[key]);
    });
    
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  
  getStats: () => 
    api.get('/files/stats'),
    
  syncKnowledgeBase: () => 
    api.post('/files/sync')
};

export const scrapingAPI = {
  scrapeUrl: (url, options = {}) => 
    api.post('/scraping/scrape', { url, options }),
    
  getHistory: (domain) => 
    api.get(`/scraping/status/${domain}`)
};

export default api;
```

**Create React Hooks**
```javascript
// src/hooks/useKnowledgeBase.js
import { useState, useCallback } from 'react';
import { chatAPI } from '../services/api';

export const useKnowledgeBase = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const queryKnowledgeBase = useCallback(async (message, sessionId = null) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await chatAPI.query(message, sessionId);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { queryKnowledgeBase, loading, error };
};

export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFiles = useCallback(async (files, metadata = {}) => {
    setUploading(true);
    setProgress(0);
    
    try {
      const response = await filesAPI.upload(files, metadata);
      setProgress(100);
      return response.data;
    } catch (err) {
      throw err;
    } finally {
      setUploading(false);
    }
  }, []);

  return { uploadFiles, uploading, progress };
};
```

**Create Chat Component**
```javascript
// src/components/Chat.jsx
import React, { useState } from 'react';
import { useKnowledgeBase } from '../hooks/useKnowledgeBase';

const Chat = () => {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [sessionId] = useState(() => `session-${Date.now()}`);
  
  const { queryKnowledgeBase, loading, error } = useKnowledgeBase();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    const userMessage = { type: 'user', content: message, timestamp: Date.now() };
    setConversation(prev => [...prev, userMessage]);
    setMessage('');

    try {
      const response = await queryKnowledgeBase(message, sessionId);
      const aiMessage = {
        type: 'ai',
        content: response.data.answer,
        sources: response.data.sources,
        timestamp: Date.now()
      };
      setConversation(prev => [...prev, aiMessage]);
    } catch (err) {
      const errorMessage = {
        type: 'error',
        content: 'Failed to get response. Please try again.',
        timestamp: Date.now()
      };
      setConversation(prev => [...prev, errorMessage]);
    }
  };

  return (
    <div className="chat-container">
      <div className="conversation">
        {conversation.map((msg, index) => (
          <div key={index} className={`message ${msg.type}`}>
            <div className="content">{msg.content}</div>
            {msg.sources && (
              <div className="sources">
                <h4>Sources:</h4>
                {msg.sources.map((source, i) => (
                  <div key={i} className="source">
                    {source.metadata?.source} (Score: {source.metadata?.score})
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      
      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask a question..."
          disabled={loading}
        />
        <button type="submit" disabled={loading || !message.trim()}>
          {loading ? 'Thinking...' : 'Send'}
        </button>
      </form>
      
      {error && <div className="error">{error}</div>}
    </div>
  );
};

export default Chat;
```

**Create File Upload Component**
```javascript
// src/components/FileUpload.jsx
import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useFileUpload } from '../hooks/useKnowledgeBase';

const FileUpload = () => {
  const { uploadFiles, uploading, progress } = useFileUpload();

  const onDrop = useCallback(async (acceptedFiles) => {
    try {
      const result = await uploadFiles(acceptedFiles, {
        category: 'uploaded-documents'
      });
      console.log('Upload successful:', result);
      alert(`Successfully uploaded ${result.data.successfulFiles} files`);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed. Please try again.');
    }
  }, [uploadFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md']
    },
    maxFiles: 10,
    maxSize: 50 * 1024 * 1024 // 50MB
  });

  return (
    <div className="file-upload">
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        {uploading ? (
          <div className="upload-progress">
            <div>Uploading... {progress}%</div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <div>
            {isDragActive ? (
              <p>Drop the files here...</p>
            ) : (
              <p>Drag & drop files here, or click to select</p>
            )}
            <small>Supports PDF, DOCX, TXT, MD (max 50MB each)</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
```

### Vue.js Integration Example

**API Service**
```javascript
// src/services/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.VUE_APP_API_URL || 'http://localhost:3002/api',
  timeout: 30000,
});

export default {
  chat: {
    query: (message, sessionId) => api.post('/chat/query', { message, sessionId }),
    getModels: () => api.get('/chat/models')
  },
  files: {
    upload: (formData) => api.post('/files/upload', formData),
    getStats: () => api.get('/files/stats')
  },
  scraping: {
    scrapeUrl: (url) => api.post('/scraping/scrape', { url })
  }
};
```

**Chat Component**
```vue
<!-- src/components/Chat.vue -->
<template>
  <div class="chat-container">
    <div class="messages">
      <div v-for="message in messages" :key="message.id" :class="`message ${message.type}`">
        <div class="content">{{ message.content }}</div>
        <div v-if="message.sources" class="sources">
          <h4>Sources:</h4>
          <div v-for="source in message.sources" :key="source.id" class="source">
            {{ source.metadata?.source }}
          </div>
        </div>
      </div>
    </div>
    
    <form @submit.prevent="sendMessage" class="input-form">
      <input 
        v-model="currentMessage" 
        :disabled="loading"
        placeholder="Ask a question..."
      />
      <button type="submit" :disabled="loading || !currentMessage.trim()">
        {{ loading ? 'Thinking...' : 'Send' }}
      </button>
    </form>
  </div>
</template>

<script>
import api from '../services/api';

export default {
  name: 'Chat',
  data() {
    return {
      messages: [],
      currentMessage: '',
      loading: false,
      sessionId: `session-${Date.now()}`
    };
  },
  methods: {
    async sendMessage() {
      if (!this.currentMessage.trim()) return;
      
      this.messages.push({
        id: Date.now(),
        type: 'user',
        content: this.currentMessage
      });
      
      const userMessage = this.currentMessage;
      this.currentMessage = '';
      this.loading = true;
      
      try {
        const response = await api.chat.query(userMessage, this.sessionId);
        this.messages.push({
          id: Date.now(),
          type: 'ai',
          content: response.data.data.answer,
          sources: response.data.data.sources
        });
      } catch (error) {
        this.messages.push({
          id: Date.now(),
          type: 'error',
          content: 'Failed to get response. Please try again.'
        });
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
```

---

## 🧪 Testing & Verification

### Step 1: Start the Server
```bash
# Start backend server
npm run dev

# Check if server is running
curl http://localhost:3002/api/health
```

### Step 2: Test Core Functionality

**Test Chat Endpoint**
```bash
# Test knowledge base query
curl -X POST http://localhost:3002/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What information is available in the knowledge base?",
    "enhancementOptions": {
      "responseType": "general",
      "includeExamples": true
    }
  }'
```

**Test File Upload**
```bash
# Test file upload (replace with actual file)
curl -X POST http://localhost:3002/api/files/upload \
  -F "files=@test-document.pdf" \
  -F "title=Test Document" \
  -F "category=test"
```

**Test Web Scraping**
```bash
# Test web scraping
curl -X POST http://localhost:3002/api/scraping/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Step 3: Verify S3 Storage
```bash
# Check if files were uploaded to S3
aws s3 ls s3://your-knowledge-base-bucket/documents/ --recursive

# Check processed content
aws s3 ls s3://your-knowledge-base-bucket/raw-content/ --recursive
```

### Step 4: Test Knowledge Base Sync
```bash
# Trigger manual sync
curl -X POST http://localhost:3002/api/files/sync

# Check sync status (replace with actual job ID)
curl http://localhost:3002/api/files/sync-status/your-job-id
```

### Step 5: Automated Testing Script

**test-integration.js**
```javascript
const axios = require('axios');
const fs = require('fs');

const API_BASE = 'http://localhost:3002/api';

async function runTests() {
  console.log('🧪 Running integration tests...\n');

  try {
    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const health = await axios.get(`${API_BASE}/health`);
    console.log('   ✅ Health check passed');

    // Test 2: Chat query
    console.log('2. Testing chat query...');
    const chat = await axios.post(`${API_BASE}/chat/query`, {
      message: 'Hello, what can you tell me?'
    });
    console.log('   ✅ Chat query successful');
    console.log(`   📝 Response: ${chat.data.data.answer.substring(0, 100)}...`);

    // Test 3: Get models
    console.log('3. Testing models endpoint...');
    const models = await axios.get(`${API_BASE}/chat/models`);
    console.log(`   ✅ Found ${models.data.data.models.length} available models`);

    // Test 4: Storage stats
    console.log('4. Testing storage stats...');
    const stats = await axios.get(`${API_BASE}/files/stats`);
    console.log(`   ✅ Knowledge base has ${stats.data.data.totalDocuments} documents`);

    console.log('\n🎉 All tests passed! Integration is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

runTests();
```

Run the test:
```bash
node test-integration.js
```

---

## 🚀 Production Deployment

### Step 1: Environment Configuration

**Production Environment Variables**
```bash
# Production .env
NODE_ENV=production
PORT=3002

# AWS Configuration (use IAM roles in production)
AWS_REGION=us-east-1

# Bedrock Configuration
BEDROCK_KNOWLEDGE_BASE_ID=kb-your-production-kb-id
BEDROCK_DATA_SOURCE_ID=ds-your-production-ds-id
BEDROCK_S3_BUCKET=your-production-s3-bucket

# Security
CORS_ORIGINS=https://your-domain.com,https://your-app.com

# Rate Limiting (stricter for production)
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=50   # Lower limit

# Logging
LOG_LEVEL=warn
LOG_FILE=/var/log/knowledge-base/app.log
```

### Step 2: Docker Deployment

**Dockerfile**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Set permissions
RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/api/health || exit 1

# Start application
CMD ["npm", "start"]
```

**docker-compose.yml**
```yaml
version: '3.8'

services:
  knowledge-base-api:
    build: .
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - AWS_REGION=${AWS_REGION}
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - BEDROCK_KNOWLEDGE_BASE_ID=${BEDROCK_KNOWLEDGE_BASE_ID}
      - BEDROCK_DATA_SOURCE_ID=${BEDROCK_DATA_SOURCE_ID}
      - BEDROCK_S3_BUCKET=${BEDROCK_S3_BUCKET}
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - knowledge-base-api
    restart: unless-stopped
```

### Step 3: AWS ECS/Fargate Deployment

**task-definition.json**
```json
{
  "family": "knowledge-base-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::your-account:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::your-account:role/knowledge-base-task-role",
  "containerDefinitions": [
    {
      "name": "knowledge-base-api",
      "image": "your-ecr-repo/knowledge-base-api:latest",
      "portMappings": [
        {
          "containerPort": 3002,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "AWS_REGION",
          "value": "us-east-1"
        }
      ],
      "secrets": [
        {
          "name": "BEDROCK_KNOWLEDGE_BASE_ID",
          "valueFrom": "arn:aws:ssm:us-east-1:your-account:parameter/kb/knowledge-base-id"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/knowledge-base-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "curl -f http://localhost:3002/api/health || exit 1"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

### Step 4: Monitoring & Logging

**CloudWatch Monitoring**
```javascript
// monitoring/cloudwatch.js
const AWS = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch();

async function publishMetric(metricName, value, unit = 'Count') {
  const params = {
    Namespace: 'KnowledgeBase/API',
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date()
      }
    ]
  };

  try {
    await cloudwatch.putMetricData(params).promise();
  } catch (error) {
    console.error('Failed to publish metric:', error);
  }
}

module.exports = { publishMetric };
```

**Application Metrics**
```javascript
// Add to your route handlers
const { publishMetric } = require('../monitoring/cloudwatch');

// In chat route
router.post('/query', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // ... existing code ...
    
    await publishMetric('ChatQueries', 1);
    await publishMetric('ChatResponseTime', Date.now() - startTime, 'Milliseconds');
    
  } catch (error) {
    await publishMetric('ChatErrors', 1);
    throw error;
  }
});
```

---

## 🐛 Troubleshooting

### Common Issues and Solutions

#### 1. AWS Credentials Issues
```bash
# Verify AWS credentials
aws sts get-caller-identity

# Test Bedrock access
aws bedrock list-foundation-models --region us-east-1
```

**Solution:**
- Ensure IAM user has correct permissions
- Check environment variables are set correctly
- Verify region matches your Bedrock setup

#### 2. Knowledge Base Not Found
```json
{
  "error": "ValidationException",
  "message": "Knowledge base not found"
}
```

**Solution:**
- Verify `BEDROCK_KNOWLEDGE_BASE_ID` is correct
- Ensure Knowledge Base is in the same region
- Check IAM permissions for Bedrock Agent access

#### 3. S3 Access Denied
```json
{
  "error": "AccessDenied",
  "message": "Access Denied"
}
```

**Solution:**
- Verify S3 bucket permissions
- Check IAM policy includes S3 actions
- Ensure bucket name matches environment variable

#### 4. File Processing Errors
```bash
# Check if file processing dependencies are installed
npm list pdf-parse mammoth xlsx

# Test individual file processors
node -e "console.log(require('pdf-parse'))"
```

**Solution:**
- Install missing dependencies
- Check file format is supported
- Verify file is not corrupted

#### 5. Rate Limiting Issues
```json
{
  "error": "ThrottlingException",
  "message": "Rate exceeded"
}
```

**Solution:**
- Increase `BEDROCK_MIN_INTERVAL` in environment
- Reduce `BEDROCK_MAX_CONCURRENT` requests
- Implement exponential backoff

### Debug Mode Setup

**Enable Debug Logging**
```bash
# Set environment variable
export LOG_LEVEL=debug

# Or add to .env file
LOG_LEVEL=debug
```

**Debug Endpoint**
```javascript
// Add to your routes for debugging
router.get('/debug/config', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoint disabled in production' });
  }
  
  res.json({
    environment: process.env.NODE_ENV,
    awsRegion: process.env.AWS_REGION,
    knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID ? 'Set' : 'Not set',
    s3Bucket: process.env.BEDROCK_S3_BUCKET ? 'Set' : 'Not set',
    timestamp: new Date().toISOString()
  });
});
```

### Performance Optimization

**Database Connection Pooling**
```javascript
// For improved performance with multiple requests
const { BedrockAgentRuntimeClient } = require('@aws-sdk/client-bedrock-agent-runtime');

// Create a single client instance and reuse
const bedrockClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  maxAttempts: 3,
  requestHandler: {
    connectionTimeout: 30000,
    socketTimeout: 30000,
  }
});
```

**Caching Strategy**
```javascript
// Simple in-memory cache for frequent queries
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedResponse(query) {
  const cached = cache.get(query);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response;
  }
  return null;
}

function setCachedResponse(query, response) {
  cache.set(query, {
    response,
    timestamp: Date.now()
  });
}
```

---

## ⚙️ Advanced Configuration

### Custom Chunking Strategy
```javascript
// Advanced chunking configuration
const advancedChunkConfig = {
  maxChunkSize: 1500,
  overlapSize: 200,
  minChunkSize: 200,
  separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ', '],
  preserveFormatting: true,
  respectSentenceBoundaries: true,
  includeHeaders: true
};

function createAdvancedChunks(text, config = advancedChunkConfig) {
  // Implementation of advanced chunking logic
  // with semantic boundary detection
}
```

### Multi-Model Support
```javascript
// Support for multiple foundation models
const modelConfigs = {
  'claude-3-sonnet': {
    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
    maxTokens: 4000,
    temperature: 0.7,
    bestFor: ['reasoning', 'analysis', 'complex-queries']
  },
  'claude-3-haiku': {
    id: 'anthropic.claude-3-haiku-20240307-v1:0',
    maxTokens: 2000,
    temperature: 0.5,
    bestFor: ['quick-responses', 'simple-queries']
  }
};

function selectOptimalModel(query) {
  // Logic to select best model based on query type
  const complexity = analyzeQueryComplexity(query);
  return complexity > 0.7 ? 'claude-3-sonnet' : 'claude-3-haiku';
}
```

### Custom File Processors
```javascript
// Add support for custom file types
const customProcessors = {
  '.xml': async (buffer) => {
    const xml2js = require('xml2js');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(buffer.toString());
    return extractTextFromXML(result);
  },
  
  '.csv': async (buffer) => {
    const csv = require('csv-parser');
    // Custom CSV processing logic
    return processCSVContent(buffer);
  }
};
```

### Analytics Integration
```javascript
// Google Analytics or custom analytics
const analytics = {
  trackQuery: (query, responseTime, success) => {
    // Send analytics data
    console.log('Analytics:', { query, responseTime, success });
  },
  
  trackUpload: (fileType, fileSize, processingTime) => {
    // Track file upload metrics
    console.log('Upload analytics:', { fileType, fileSize, processingTime });
  }
};
```

---

## 🎉 Integration Complete!

You now have a fully functional AWS Bedrock Knowledge Base system with:

### ✅ Core Features
- **AI-Powered Chat** with RAG capabilities
- **File Upload Processing** for multiple formats
- **Web Scraping** with intelligent content extraction
- **Knowledge Base Management** with AWS Bedrock
- **Data Management** with CRUD operations

### ✅ Production-Ready Features
- **Security** with rate limiting and CORS
- **Error Handling** with comprehensive error responses
- **Logging** with Winston and CloudWatch integration
- **Monitoring** with health checks and metrics
- **Scalability** with queue management and caching

### ✅ Integration Ready
- **Copy-Paste Functions** for easy integration
- **Complete API Documentation** with examples
- **Frontend Examples** for React and Vue.js
- **Testing Scripts** for verification
- **Deployment Guides** for Docker and AWS

### 📚 Next Steps
1. Customize the system for your specific use case
2. Add additional file type support if needed
3. Implement user authentication if required
4. Scale horizontally with load balancers
5. Add more advanced analytics and monitoring

### 🔗 Quick Links
- [Function Blocks](INTEGRATION_READY_BACKEND.md)
- [API Documentation](API_ENDPOINTS_DOCUMENTATION.md)
- [Current Implementation](OPTIMIZED_ARCHITECTURE_SUMMARY.md)

Your AWS Bedrock Knowledge Base system is now ready for production use! 🚀