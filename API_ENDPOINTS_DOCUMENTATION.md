# Complete API Endpoints Documentation

## 📋 Table of Contents

1. [API Overview](#api-overview)
2. [Authentication](#authentication)
3. [Chat Endpoints](#chat-endpoints)
4. [File Management Endpoints](#file-management-endpoints)
5. [Web Scraping Endpoints](#web-scraping-endpoints)
6. [Data Management Endpoints](#data-management-endpoints)
7. [Health & Status Endpoints](#health--status-endpoints)
8. [Error Responses](#error-responses)
9. [Rate Limiting](#rate-limiting)
10. [Integration Examples](#integration-examples)

## 🚀 API Overview

**Base URL:** `http://localhost:3002/api`  
**Content-Type:** `application/json`  
**Rate Limit:** 100 requests per 15 minutes per IP

### Common Response Format

```json
{
  "success": true|false,
  "message": "Human-readable message",
  "data": { ... },
  "error": "Error message (if success is false)",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 🔐 Authentication

Currently using AWS IAM credentials from environment variables. No additional authentication required for API calls.

### Required Environment Variables
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
BEDROCK_KNOWLEDGE_BASE_ID=your_kb_id
```

---

## 💬 Chat Endpoints

### 1. Query Knowledge Base with RAG
**POST** `/api/chat/query`

Query the knowledge base using RAG (Retrieval Augmented Generation) with foundation models.

#### Request Body
```json
{
  "message": "What is machine learning?",
  "sessionId": "user-session-123",
  "model": "anthropic.claude-3-sonnet-20240229-v1:0",
  "enhancementOptions": {
    "responseType": "technical",
    "includeExamples": true,
    "requestElaboration": true,
    "structureResponse": true,
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
```

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| message | string | ✅ | Query message (1-2000 characters) |
| sessionId | string | ❌ | Session ID for conversation continuity |
| model | string | ❌ | Foundation model ID (defaults to Claude 3 Sonnet) |
| enhancementOptions | object | ❌ | Response enhancement configuration |

#### Enhancement Options
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| responseType | enum | "auto" | Response style: auto, general, technical, business |
| includeExamples | boolean | true | Include examples and code snippets |
| requestElaboration | boolean | true | Request detailed explanations |
| structureResponse | boolean | true | Use structured formatting |
| temperature | number | 0.7 | Creativity level (0-1) |
| maxTokens | number | 2000 | Maximum response length |

#### Response
```json
{
  "success": true,
  "data": {
    "answer": "Machine learning is a subset of artificial intelligence...",
    "sources": [
      {
        "content": "Reference content snippet",
        "metadata": {
          "source": "document-title.pdf",
          "score": 0.95
        }
      }
    ],
    "sessionId": "user-session-123",
    "model": "anthropic.claude-3-sonnet-20240229-v1:0",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Error Responses
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "retryAfter": 30,
  "queueInfo": {
    "position": 3,
    "estimatedWait": 4500
  }
}
```

### 2. Direct Model Invocation
**POST** `/api/chat/direct`

Invoke foundation model directly without knowledge base retrieval.

#### Request Body
```json
{
  "prompt": "Explain quantum computing in simple terms",
  "model": "anthropic.claude-3-sonnet-20240229-v1:0",
  "enhancementOptions": {
    "temperature": 0.8,
    "maxTokens": 1500
  }
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "answer": "Quantum computing is a revolutionary technology...",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. Get Available Models
**GET** `/api/chat/models`

Retrieve list of available foundation models.

#### Response
```json
{
  "success": true,
  "data": {
    "models": [
      {
        "id": "anthropic.claude-3-sonnet-20240229-v1:0",
        "name": "Claude 3 Sonnet",
        "provider": "Anthropic",
        "description": "High-performance model for complex reasoning",
        "capabilities": ["text_generation", "analysis", "reasoning"]
      }
    ],
    "defaultModel": "anthropic.claude-3-sonnet-20240229-v1:0"
  }
}
```

### 4. Get Enhancement Options
**GET** `/api/chat/enhancement-options`

Get available response enhancement options and their descriptions.

#### Response
```json
{
  "success": true,
  "data": {
    "responseTypes": {
      "auto": {
        "description": "Automatically detect query intent and optimize response style",
        "default": true
      },
      "technical": {
        "description": "Technical responses with code examples and implementation details",
        "default": false
      }
    },
    "options": {
      "temperature": {
        "type": "number",
        "default": 0.7,
        "range": [0, 1],
        "description": "Response creativity level"
      }
    }
  }
}
```

### 5. Service Status
**GET** `/api/chat/status`

Get Bedrock service status and rate limiting information.

#### Response
```json
{
  "success": true,
  "data": {
    "status": "ready",
    "isRateLimited": false,
    "queue": {
      "length": 0,
      "running": 1,
      "maxConcurrent": 2,
      "minInterval": 1500
    },
    "timing": {
      "lastRequestTime": 1705315800000,
      "timeSinceLastRequest": 3000,
      "canMakeRequest": true
    }
  }
}
```

### 6. Test Knowledge Base
**GET** `/api/chat/test`

Test knowledge base connectivity and functionality.

#### Response
```json
{
  "success": true,
  "message": "Knowledge base test successful",
  "data": {
    "query": "What information is available in the knowledge base?",
    "answer": "The knowledge base contains...",
    "sources": [],
    "sessionId": "test-session"
  }
}
```

---

## 📁 File Management Endpoints

### 1. Upload Files
**POST** `/api/files/upload`

Upload and process multiple files for knowledge base ingestion.

#### Request (Multipart Form Data)
```
Content-Type: multipart/form-data

files: [File objects] (max 10 files, 50MB each)
title: "Optional document title"
description: "Optional description"
category: "general"
tags: ["ai", "machine-learning"]
```

#### Supported File Types
- **PDF** (.pdf)
- **Word Documents** (.docx, .doc)
- **Text Files** (.txt, .md)
- **Excel Spreadsheets** (.xlsx)
- **CSV Files** (.csv)
- **RTF Documents** (.rtf)

#### Response
```json
{
  "success": true,
  "message": "Processed 3 of 3 files successfully",
  "data": {
    "files": [
      {
        "documentId": "abc123def456",
        "fileName": "document.pdf",
        "contentLength": 12450,
        "chunkCount": 8,
        "s3Keys": [
          "documents/2024-01-15/abc123def456.txt",
          "files/original/2024-01-15/abc123def456.pdf"
        ],
        "processedAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "totalFiles": 3,
    "successfulFiles": 3,
    "failedFiles": 0,
    "totalContentLength": 35420,
    "totalChunks": 24
  }
}
```

#### Error Response (Partial Failure)
```json
{
  "success": true,
  "message": "Processed 2 of 3 files successfully",
  "warning": "1 files failed to process",
  "data": { ... },
  "errors": [
    {
      "fileName": "corrupted-file.pdf",
      "error": "Failed to extract text content"
    }
  ]
}
```

### 2. Get File Processing Info
**GET** `/api/files/info`

Get information about file processing capabilities and limits.

#### Response
```json
{
  "success": true,
  "data": {
    "supportedTypes": [".pdf", ".docx", ".txt", ".md", ".xlsx", ".csv"],
    "capabilities": {
      "textExtraction": true,
      "chunkingOptimization": true,
      "metadataEnrichment": true,
      "automaticSync": true
    },
    "uploadLimits": {
      "maxFiles": 10,
      "maxFileSize": 52428800,
      "maxFileSizeMB": 50
    },
    "processingOptions": {
      "chunkSize": 1000,
      "overlapSize": 100,
      "minChunkSize": 100
    }
  }
}
```

### 3. Check Sync Status
**GET** `/api/files/sync-status/{jobId}`

Check the status of a knowledge base sync job.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| jobId | string | Sync job ID from sync response |

#### Response
```json
{
  "success": true,
  "data": {
    "jobId": "sync-job-123",
    "status": "COMPLETE",
    "startedAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z",
    "statistics": {
      "numberOfDocumentsScanned": 50,
      "numberOfDocumentsIndexed": 48,
      "numberOfDocumentsFailed": 2
    }
  }
}
```

#### Status Values
- `STARTING` - Job is initializing
- `IN_PROGRESS` - Job is processing
- `COMPLETE` - Job completed successfully
- `FAILED` - Job failed

### 4. Get Recent Sync Jobs
**GET** `/api/files/sync-jobs?limit=10`

Get list of recent sync jobs.

#### Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | integer | 10 | Number of jobs to return (1-50) |

#### Response
```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "jobId": "sync-job-123",
        "status": "COMPLETE",
        "startedAt": "2024-01-15T10:30:00.000Z",
        "documentsProcessed": 48
      }
    ],
    "total": 5,
    "limit": 10
  }
}
```

### 5. Get Storage Statistics
**GET** `/api/files/stats`

Get storage usage and document statistics.

#### Response
```json
{
  "success": true,
  "data": {
    "totalDocuments": 156,
    "totalSizeBytes": 45678912,
    "totalSizeMB": 43.54,
    "documentsByType": {
      "pdf": 45,
      "docx": 32,
      "txt": 79
    },
    "storageBreakdown": {
      "processedDocuments": 35.2,
      "originalFiles": 8.34
    },
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  }
}
```

### 6. Trigger Manual Sync
**POST** `/api/files/sync`

Manually trigger knowledge base synchronization.

#### Response
```json
{
  "success": true,
  "message": "Knowledge Base sync started",
  "data": {
    "syncJobId": "sync-job-456",
    "startedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 7. Health Check
**GET** `/api/files/health`

Check health of file processing services.

#### Response
```json
{
  "success": true,
  "status": "healthy",
  "data": {
    "fileProcessing": {
      "status": "healthy",
      "capabilities": ["pdf", "docx", "txt"],
      "supportedTypes": 6
    },
    "storage": {
      "status": "healthy",
      "bucket": "your-s3-bucket",
      "totalDocuments": 156
    },
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## 🌐 Web Scraping Endpoints

### 1. Scrape Single Page
**POST** `/api/scraping/scrape`

Scrape content from a single webpage.

#### Request Body
```json
{
  "url": "https://example.com/article",
  "options": {
    "maxContentLength": 50000,
    "includeMetadata": true,
    "followRedirects": true,
    "timeout": 30000
  }
}
```

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string (URL) | ✅ | URL to scrape |
| options | object | ❌ | Scraping configuration options |

#### Options
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| maxContentLength | integer | 50000 | Maximum content length to extract |
| includeMetadata | boolean | true | Include page metadata |
| followRedirects | boolean | true | Follow HTTP redirects |
| timeout | integer | 30000 | Request timeout in milliseconds |

#### Response
```json
{
  "success": true,
  "message": "Website scraped successfully",
  "data": {
    "url": "https://example.com/article",
    "title": "Article Title",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "documentId": "def789ghi012",
    "metadata": {
      "author": "John Doe",
      "publishDate": "2024-01-10",
      "description": "Article description",
      "keywords": ["tech", "ai"]
    },
    "chunksExtracted": 12,
    "content": {
      "preview": "This is the beginning of the article content...",
      "totalChunks": 12,
      "chunks": [
        {
          "index": 1,
          "content": "Full chunk content here...",
          "wordCount": 245
        }
      ]
    },
    "s3Keys": [
      "documents/2024-01-15/def789ghi012.txt",
      "raw-content/web-scrapes/2024-01-15/def789ghi012.html"
    ],
    "contentLength": 8940
  }
}
```

### 2. Crawl Entire Website
**POST** `/api/scraping/crawl`

Crawl multiple pages of a website.

#### Request Body
```json
{
  "baseUrl": "https://example.com",
  "options": {
    "maxPages": 50,
    "maxDepth": 3,
    "stayOnDomain": true,
    "includePatterns": ["/docs/", "/blog/"],
    "excludePatterns": ["/admin/", "/private/"],
    "delay": 1000,
    "respectRobotsTxt": true
  }
}
```

#### Options
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| maxPages | integer | 50 | Maximum pages to crawl |
| maxDepth | integer | 3 | Maximum crawl depth |
| stayOnDomain | boolean | true | Only crawl pages on same domain |
| includePatterns | array | [] | URL patterns to include |
| excludePatterns | array | [] | URL patterns to exclude |
| delay | integer | 1000 | Delay between requests (ms) |
| respectRobotsTxt | boolean | true | Respect robots.txt file |

#### Response
```json
{
  "success": true,
  "message": "Website crawl started",
  "data": {
    "crawlId": "crawl-789",
    "baseUrl": "https://example.com",
    "estimatedPages": 45,
    "status": "in_progress",
    "startedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. Get Crawl Status
**GET** `/api/scraping/crawl-status/{crawlId}`

Check the status of a website crawl operation.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| crawlId | string | Crawl ID from crawl response |

#### Response
```json
{
  "success": true,
  "data": {
    "crawlId": "crawl-789",
    "status": "completed",
    "baseUrl": "https://example.com",
    "progress": {
      "pagesProcessed": 42,
      "pagesTotal": 45,
      "percentage": 93.3
    },
    "results": {
      "successfulPages": 40,
      "failedPages": 2,
      "totalContent": 156780,
      "documentsCreated": 40
    },
    "startedAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:45:00.000Z"
  }
}
```

### 4. Get Scraping History
**GET** `/api/scraping/status/{domain}`

Get scraping history for a specific domain.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| domain | string | Domain name (e.g., "example.com") |

#### Response
```json
{
  "success": true,
  "domain": "example.com",
  "history": [
    {
      "url": "https://example.com/page1",
      "scrapedAt": "2024-01-15T10:30:00.000Z",
      "status": "success",
      "contentLength": 8940,
      "chunkCount": 12
    },
    {
      "url": "https://example.com/page2",
      "scrapedAt": "2024-01-15T09:15:00.000Z",
      "status": "failed",
      "error": "Content too short"
    }
  ]
}
```

### 5. Cancel Crawl Operation
**DELETE** `/api/scraping/crawl/{crawlId}`

Cancel an ongoing crawl operation.

#### Response
```json
{
  "success": true,
  "message": "Crawl operation cancelled",
  "data": {
    "crawlId": "crawl-789",
    "status": "cancelled",
    "pagesProcessed": 15,
    "cancelledAt": "2024-01-15T10:35:00.000Z"
  }
}
```

---

## 🗄️ Data Management Endpoints

### 1. Get Domain Summary
**GET** `/api/data-management/domains`

Get summary of all domains in the knowledge base.

#### Response
```json
{
  "success": true,
  "message": "Domains summary retrieved successfully",
  "data": {
    "domains": [
      {
        "domain": "example.com",
        "documentCount": 25,
        "totalSize": 1048576,
        "lastUpdated": "2024-01-15T10:30:00.000Z",
        "urls": [
          "https://example.com/page1",
          "https://example.com/page2"
        ]
      }
    ],
    "totalDomains": 5,
    "totalDocuments": 156,
    "totalSize": 45678912
  }
}
```

### 2. List Documents by Domain
**GET** `/api/data-management/domains/{domain}/documents`

List all documents for a specific domain.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| domain | string | Domain name (e.g., "example.com") |

#### Response
```json
{
  "success": true,
  "message": "Documents for domain example.com retrieved successfully",
  "data": {
    "domain": "example.com",
    "documents": [
      {
        "documentId": "doc-123",
        "title": "Article Title",
        "url": "https://example.com/article",
        "contentLength": 8940,
        "chunkCount": 12,
        "processedAt": "2024-01-15T10:30:00.000Z",
        "s3Key": "documents/2024-01-15/doc-123.txt"
      }
    ],
    "totalDocuments": 25,
    "totalContentLength": 234567
  }
}
```

### 3. List Documents by URL
**GET** `/api/data-management/urls/documents?url={url}`

List all documents for a specific URL.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string (URL) | ✅ | Full URL to search for |

#### Response
```json
{
  "success": true,
  "message": "Documents for URL retrieved successfully",
  "data": {
    "url": "https://example.com/specific-page",
    "documents": [
      {
        "documentId": "doc-456",
        "title": "Specific Page Title",
        "contentLength": 5640,
        "chunkCount": 8,
        "processedAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "totalDocuments": 1
  }
}
```

### 4. Delete Domain Data
**DELETE** `/api/data-management/domains/{domain}?confirm={domain}`

Delete all data for a specific domain.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| domain | string | Domain name to delete |

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| confirm | string | ✅ | Must match domain name for confirmation |
| dryRun | boolean | ❌ | Preview deletion without actually deleting |
| syncKnowledgeBase | boolean | ❌ | Sync KB after deletion (default: true) |

#### Example URLs
```
DELETE /api/data-management/domains/example.com?confirm=example.com
DELETE /api/data-management/domains/example.com?dryRun=true
```

#### Response
```json
{
  "success": true,
  "message": "All data for domain example.com deleted successfully",
  "data": {
    "domain": "example.com",
    "deleted": true,
    "documentsDeleted": 25,
    "filesDeleted": [
      "documents/2024-01-15/doc-123.txt",
      "raw-content/web-scrapes/2024-01-15/doc-123.html"
    ],
    "syncJobId": "sync-job-delete-123",
    "deletedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 5. Delete URL Data
**DELETE** `/api/data-management/urls?url={url}&confirm={confirmCode}`

Delete all data for a specific URL.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string (URL) | ✅ | URL to delete data for |
| confirm | string | ✅ | Confirmation code (8-char hash) |
| dryRun | boolean | ❌ | Preview deletion without actually deleting |
| syncKnowledgeBase | boolean | ❌ | Sync KB after deletion (default: true) |

#### Getting Confirmation Code
First call the deletion preview endpoint to get the confirmation code:
```
GET /api/data-management/urls/deletion-preview?url=https://example.com/page
```

#### Response
```json
{
  "success": true,
  "message": "All data for URL deleted successfully",
  "data": {
    "url": "https://example.com/page",
    "deleted": true,
    "documentsDeleted": 1,
    "filesDeleted": ["documents/2024-01-15/doc-456.txt"],
    "syncJobId": "sync-job-delete-456"
  }
}
```

### 6. Get Deletion Preview for Domain
**GET** `/api/data-management/domains/{domain}/deletion-preview`

Preview what would be deleted for a domain without actually deleting.

#### Response
```json
{
  "success": true,
  "message": "Deletion preview for domain example.com",
  "data": {
    "domain": "example.com",
    "dryRun": true,
    "documentsFound": 25,
    "filesToDelete": [
      "documents/2024-01-15/doc-123.txt",
      "raw-content/web-scrapes/2024-01-15/doc-123.html"
    ],
    "totalSizeBytes": 1048576,
    "warning": "This is a preview only. No files have been deleted.",
    "toActuallyDelete": "DELETE /api/data-management/domains/example.com?confirm=example.com"
  }
}
```

### 7. Get Deletion Preview for URL
**GET** `/api/data-management/urls/deletion-preview?url={url}`

Preview what would be deleted for a URL without actually deleting.

#### Response
```json
{
  "success": true,
  "message": "Deletion preview for URL",
  "data": {
    "url": "https://example.com/page",
    "dryRun": true,
    "documentsFound": 1,
    "filesToDelete": ["documents/2024-01-15/doc-456.txt"],
    "confirmationCode": "a8b9c0d1",
    "warning": "This is a preview only. No files have been deleted.",
    "toActuallyDelete": "DELETE /api/data-management/urls?url=https://example.com/page&confirm=a8b9c0d1"
  }
}
```

---

## 🏥 Health & Status Endpoints

### 1. General Health Check
**GET** `/api/health`

Check overall system health.

#### Response
```json
{
  "success": true,
  "status": "healthy",
  "message": "All systems operational",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 86400,
  "services": {
    "bedrock": "healthy",
    "s3": "healthy",
    "fileProcessing": "healthy",
    "webScraping": "healthy"
  }
}
```

### 2. Detailed Service Status
**GET** `/api/health/detailed`

Get detailed health information for all services.

#### Response
```json
{
  "success": true,
  "status": "healthy",
  "services": {
    "bedrock": {
      "status": "healthy",
      "knowledgeBaseId": "kb-12345",
      "region": "us-east-1",
      "lastQuery": "2024-01-15T10:25:00.000Z",
      "queueStatus": {
        "length": 0,
        "running": 0,
        "maxConcurrent": 2
      }
    },
    "s3": {
      "status": "healthy",
      "bucket": "your-s3-bucket",
      "region": "us-east-1",
      "totalDocuments": 156,
      "lastUpload": "2024-01-15T10:20:00.000Z"
    },
    "fileProcessing": {
      "status": "healthy",
      "supportedTypes": [".pdf", ".docx", ".txt", ".md", ".xlsx"],
      "maxFileSize": 52428800,
      "processingQueue": 0
    },
    "webScraping": {
      "status": "healthy",
      "activeCrawls": 0,
      "lastScrape": "2024-01-15T10:15:00.000Z"
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## ⚠️ Error Responses

### Standard Error Format
```json
{
  "success": false,
  "error": "Error category",
  "message": "Detailed error message",
  "details": {
    "field": "specific field that caused error",
    "code": "ERROR_CODE"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Common HTTP Status Codes

#### 400 Bad Request
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "message",
      "message": "Message must be between 1 and 2000 characters"
    }
  ]
}
```

#### 401 Unauthorized
```json
{
  "success": false,
  "error": "Authentication failed",
  "message": "Invalid AWS credentials or insufficient permissions"
}
```

#### 403 Forbidden
```json
{
  "success": false,
  "error": "Access denied",
  "message": "Insufficient permissions to access this resource"
}
```

#### 404 Not Found
```json
{
  "success": false,
  "error": "Resource not found",
  "message": "The requested endpoint or resource was not found"
}
```

#### 413 Payload Too Large
```json
{
  "success": false,
  "error": "File too large",
  "message": "File size exceeds the maximum limit of 50MB",
  "details": {
    "maxSize": 52428800,
    "receivedSize": 67108864
  }
}
```

#### 429 Too Many Requests
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please wait and try again.",
  "retryAfter": 30,
  "queueInfo": {
    "position": 3,
    "estimatedWait": 4500
  }
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Internal server error",
  "message": "An unexpected error occurred while processing your request",
  "requestId": "req-123456"
}
```

#### 503 Service Unavailable
```json
{
  "success": false,
  "error": "Service unavailable",
  "message": "Bedrock service is temporarily unavailable. Please try again later.",
  "retryAfter": 60
}
```

---

## 🚦 Rate Limiting

### Default Limits
- **General API**: 100 requests per 15 minutes per IP
- **Chat Endpoints**: 50 requests per hour per session
- **File Upload**: 20 uploads per hour per IP
- **Web Scraping**: 10 crawls per hour per IP

### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705316700
X-RateLimit-Window: 900
```

### Rate Limit Response
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "message": "Too many requests from this IP, please try again later.",
  "retryAfter": 900,
  "limits": {
    "requests": 100,
    "window": 900,
    "remaining": 0,
    "resetTime": "2024-01-15T11:00:00.000Z"
  }
}
```

---

## 🔗 Integration Examples

### JavaScript/Node.js Example
```javascript
const axios = require('axios');

class KnowledgeBaseAPI {
  constructor(baseURL = 'http://localhost:3002/api') {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async queryKnowledgeBase(message, sessionId = null) {
    try {
      const response = await this.client.post('/chat/query', {
        message,
        sessionId,
        enhancementOptions: {
          responseType: 'technical',
          includeExamples: true
        }
      });
      return response.data;
    } catch (error) {
      console.error('Query failed:', error.response?.data || error.message);
      throw error;
    }
  }

  async uploadFile(fileBuffer, fileName) {
    const formData = new FormData();
    formData.append('files', new Blob([fileBuffer]), fileName);
    
    try {
      const response = await this.client.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return response.data;
    } catch (error) {
      console.error('Upload failed:', error.response?.data || error.message);
      throw error;
    }
  }

  async scrapeWebsite(url) {
    try {
      const response = await this.client.post('/scraping/scrape', { url });
      return response.data;
    } catch (error) {
      console.error('Scraping failed:', error.response?.data || error.message);
      throw error;
    }
  }
}

// Usage
const kb = new KnowledgeBaseAPI();

// Query the knowledge base
kb.queryKnowledgeBase('What is machine learning?')
  .then(result => console.log(result.data.answer))
  .catch(error => console.error(error));
```

### Python Example
```python
import requests
import json

class KnowledgeBaseAPI:
    def __init__(self, base_url='http://localhost:3002/api'):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
    
    def query_knowledge_base(self, message, session_id=None):
        """Query the knowledge base with RAG"""
        payload = {
            'message': message,
            'sessionId': session_id,
            'enhancementOptions': {
                'responseType': 'technical',
                'includeExamples': True
            }
        }
        
        response = self.session.post(f'{self.base_url}/chat/query', 
                                   json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    
    def upload_file(self, file_path):
        """Upload a file for processing"""
        with open(file_path, 'rb') as f:
            files = {'files': f}
            response = self.session.post(f'{self.base_url}/files/upload',
                                       files=files, timeout=60)
        response.raise_for_status()
        return response.json()
    
    def scrape_website(self, url):
        """Scrape a website"""
        payload = {'url': url}
        response = self.session.post(f'{self.base_url}/scraping/scrape',
                                   json=payload, timeout=60)
        response.raise_for_status()
        return response.json()

# Usage
kb = KnowledgeBaseAPI()

# Query the knowledge base
result = kb.query_knowledge_base('What is machine learning?')
print(result['data']['answer'])
```

### cURL Examples
```bash
# Query knowledge base
curl -X POST http://localhost:3002/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is machine learning?",
    "enhancementOptions": {
      "responseType": "technical",
      "includeExamples": true
    }
  }'

# Upload file
curl -X POST http://localhost:3002/api/files/upload \
  -F "files=@document.pdf" \
  -F "title=Machine Learning Guide"

# Scrape website
curl -X POST http://localhost:3002/api/scraping/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article"}'

# Check service health
curl http://localhost:3002/api/health

# Get storage statistics
curl http://localhost:3002/api/files/stats

# List documents by domain
curl http://localhost:3002/api/data-management/domains/example.com/documents
```

---

## 📚 Complete API Reference Summary

| Endpoint Category | Method | Endpoint | Description |
|------------------|--------|----------|-------------|
| **Chat** | POST | `/api/chat/query` | Query with RAG |
| | POST | `/api/chat/direct` | Direct model invocation |
| | GET | `/api/chat/models` | Available models |
| | GET | `/api/chat/status` | Service status |
| **Files** | POST | `/api/files/upload` | Upload files |
| | GET | `/api/files/info` | Processing info |
| | GET | `/api/files/sync-status/{jobId}` | Sync status |
| | POST | `/api/files/sync` | Manual sync |
| | GET | `/api/files/stats` | Storage stats |
| **Scraping** | POST | `/api/scraping/scrape` | Scrape single page |
| | POST | `/api/scraping/crawl` | Crawl website |
| | GET | `/api/scraping/crawl-status/{id}` | Crawl status |
| | GET | `/api/scraping/status/{domain}` | Scraping history |
| **Data Mgmt** | GET | `/api/data-management/domains` | Domain summary |
| | GET | `/api/data-management/domains/{domain}/documents` | Domain documents |
| | DELETE | `/api/data-management/domains/{domain}` | Delete domain |
| | GET | `/api/data-management/urls/documents` | URL documents |
| | DELETE | `/api/data-management/urls` | Delete URL data |
| **Health** | GET | `/api/health` | System health |
| | GET | `/api/health/detailed` | Detailed status |

This API documentation provides complete integration guidance for the AWS Bedrock Knowledge Base system with all endpoints, parameters, responses, and examples needed for successful implementation.