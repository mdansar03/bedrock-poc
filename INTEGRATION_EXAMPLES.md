# 🔧 Integration Examples: Replacing OpenAI + Pinecone with AWS Bedrock

## 📊 Before vs After Comparison

### Before (OpenAI + Pinecone)
```javascript
// OLD CODE - Replace this pattern
const openai = require('openai');
const pinecone = require('pinecone');

// In your scraping endpoint
const embedding = await openai.embeddings.create({
  model: "text-embedding-3-large",
  input: scrapedContent,
  encoding_format: "float"
});

await pinecone.upsert({
  vectors: [{
    id: generateId(),
    values: embedding.data[0].embedding,
    metadata: { title, url, content }
  }]
});

// In your query endpoint
const queryEmbedding = await openai.embeddings.create({
  model: "text-embedding-3-large", 
  input: userQuery
});

const searchResults = await pinecone.query({
  vector: queryEmbedding.data[0].embedding,
  topK: 5
});

const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{
    role: "system",
    content: "Answer based on context: " + searchResults.matches.map(m => m.metadata.content).join('\n')
  }, {
    role: "user", 
    content: userQuery
  }]
});
```

### After (AWS Bedrock)
```javascript
// NEW CODE - Use this pattern
const bedrockKnowledgeBaseService = require('../services/bedrockKnowledgeBaseService');
const bedrockService = require('../services/bedrockService');

// In your scraping endpoint - MUCH SIMPLER!
const document = {
  content: scrapedContent,
  title: pageTitle,
  url: scrapedUrl,
  metadata: { domain, scrapedAt: new Date() }
};

const result = await bedrockKnowledgeBaseService.storeDocument(document);

// In your query endpoint - MUCH SIMPLER!
const response = await bedrockService.queryKnowledgeBase(userQuery, sessionId, 'claude-3-sonnet');
```

## 🔄 Step-by-Step Migration Examples

### 1. Update Your Existing Scraping Route

**File: `src/routes/scraping.js` (or wherever your scraping endpoints are)**

```javascript
// Add this import at the top
const bedrockKnowledgeBaseService = require('../services/bedrockKnowledgeBaseService');

// REPLACE your existing storage logic in the scraping endpoint:

// OLD CODE - Remove this:
/*
const openai = require('openai');
const pinecone = require('pinecone');

const embedding = await openai.embeddings.create({...});
await pinecone.upsert({...});
*/

// NEW CODE - Add this:
const document = {
  content: processedResult.content, // Your existing scraped content
  title: processedResult.title,     // Your existing title extraction
  url: cleanUrl,                    // Your existing URL
  metadata: {
    domain: processedResult.domain,
    scrapedAt: processedResult.timestamp,
    source: 'web-scraper',
    // Add any other metadata you currently store
    contentLength: processedResult.content.length,
    chunkCount: processedResult.chunks?.length || 0
  }
};

// Store in Bedrock Knowledge Base instead of Pinecone
const kbResult = await bedrockKnowledgeBaseService.storeDocument(document);

// Update your response to include the new result
res.json({
  success: true,
  message: 'Website scraped and stored in Knowledge Base',
  data: {
    url: cleanUrl,
    title: document.title,
    timestamp: document.metadata.scrapedAt,
    knowledgeBase: {
      documentId: kbResult.documentId,
      chunkCount: kbResult.chunkCount,
      syncJobId: kbResult.syncJobId
    },
    // Keep any existing response fields your frontend expects
    content: {
      preview: document.content.substring(0, 500) + '...',
      totalLength: kbResult.processedLength
    }
  }
});
```

### 2. Update Your Existing Query/Chat Route

**File: `src/routes/chat.js` (or wherever your query endpoints are)**

```javascript
// The bedrockService we created already replaces OpenAI + Pinecone!
// Just update your existing query endpoint:

// OLD CODE - Remove this:
/*
const openai = require('openai');
const pinecone = require('pinecone');

const queryEmbedding = await openai.embeddings.create({...});
const searchResults = await pinecone.query({...});
const response = await openai.chat.completions.create({...});
*/

// NEW CODE - Replace with this single line:
const response = await bedrockService.queryKnowledgeBase(
  message, 
  sessionId, 
  'claude-3-sonnet',
  enhancementOptions // Use our enhanced prompting
);

// Your existing response format can stay the same:
res.json({
  success: true,
  data: {
    answer: response.answer,
    sources: response.sources,      // Bedrock provides better source citations
    sessionId: response.sessionId,
    model: 'claude-3-sonnet',
    timestamp: new Date().toISOString()
  }
});
```

### 3. Add File Upload Support to Your App

**File: `server.js` or `app.js` (your main server file)**

```javascript
// Add file upload routes
const fileRoutes = require('./src/routes/files');
app.use('/api/files', fileRoutes);
```

**Create a simple file upload test page** (optional):

```html
<!-- test-upload.html -->
<!DOCTYPE html>
<html>
<head>
    <title>File Upload Test</title>
</head>
<body>
    <h1>Upload Files to Knowledge Base</h1>
    <form action="/api/files/upload" method="POST" enctype="multipart/form-data">
        <input type="file" name="files" multiple accept=".pdf,.docx,.txt,.md">
        <input type="text" name="title" placeholder="Document title (optional)">
        <input type="text" name="description" placeholder="Description (optional)">
        <button type="submit">Upload</button>
    </form>
</body>
</html>
```

## 🚀 Quick Migration Checklist

### Phase 1: Basic Migration (Keep existing API)
- [ ] Install new dependencies: `npm install @aws-sdk/client-bedrock-runtime @aws-sdk/client-bedrock-agent @aws-sdk/client-bedrock-agent-runtime @aws-sdk/client-s3`
- [ ] Add the 4 new service files we created
- [ ] Set up AWS environment variables
- [ ] Replace storage logic in scraping endpoints
- [ ] Replace query logic in chat endpoints
- [ ] Test that existing frontend still works

### Phase 2: Add File Upload (New feature)
- [ ] Install file processing dependencies: `npm install pdf-parse mammoth xlsx multer`
- [ ] Add file upload routes
- [ ] Test file upload functionality
- [ ] Add frontend file upload UI (optional)

### Phase 3: Enhanced Features (Optional)
- [ ] Use enhanced prompting options for better responses
- [ ] Add monitoring dashboards using the stats endpoints
- [ ] Implement user-specific file organization
- [ ] Add batch processing for large file uploads

## 🔧 Environment Variables Setup

Create a `.env` file or add to your existing one:

```bash
# AWS Bedrock Configuration (REQUIRED)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

# Bedrock Knowledge Base (REQUIRED)
BEDROCK_KNOWLEDGE_BASE_ID=your_knowledge_base_id
BEDROCK_DATA_SOURCE_ID=your_data_source_id
BEDROCK_S3_BUCKET=your-s3-bucket-name

# Model Configuration (OPTIONAL - has defaults)
DEFAULT_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
BEDROCK_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0

# File Upload Limits (OPTIONAL - has defaults)
MAX_FILE_SIZE=52428800  # 50MB in bytes
```

## 📋 Testing Your Migration

### Test 1: Scraping Still Works
```bash
# Test your existing scraping endpoint
curl -X POST http://localhost:3000/api/scraping/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Should return success with new Knowledge Base fields
```

### Test 2: Querying Still Works  
```bash
# Test your existing chat/query endpoint
curl -X POST http://localhost:3000/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{"message": "What information do you have?"}'

# Should return Claude response with better quality
```

### Test 3: File Upload Works
```bash
# Test new file upload
curl -X POST http://localhost:3000/api/files/upload \
  -F "files=@test-document.pdf" \
  -F "title=Test Document"

# Should return success with file processing details
```

## 🔍 Troubleshooting Common Issues

### Issue 1: "Knowledge Base ID not configured"
**Solution**: Make sure `BEDROCK_KNOWLEDGE_BASE_ID` is set in your environment variables.

### Issue 2: "Access denied" errors
**Solution**: Check your AWS IAM permissions include Bedrock, S3, and OpenSearch access.

### Issue 3: "PDF processing not available"
**Solution**: Install optional dependencies: `npm install pdf-parse mammoth xlsx`

### Issue 4: Queries return "No answer generated"
**Solution**: Ensure Knowledge Base sync has completed. Check sync status with `/api/files/sync-status/:jobId`

### Issue 5: File uploads fail
**Solution**: Check S3 bucket permissions and that `BEDROCK_S3_BUCKET` environment variable is set.

## 🎯 Performance Comparison

| Aspect | OpenAI + Pinecone | AWS Bedrock |
|--------|------------------|-------------|
| **Setup Complexity** | High (2 services, embeddings, chunking) | Low (single service) |
| **API Calls** | 3 calls per query (embed + search + chat) | 1 call per query |
| **Response Quality** | Good | Better (longer context, citations) |
| **Cost** | Higher (multiple API calls) | Lower (single service) |
| **Latency** | Higher (multiple hops) | Lower (integrated service) |
| **Scaling** | Manual (manage embeddings/chunks) | Automatic (AWS managed) |

## 🚀 Ready to Go!

Your migration is now complete! The new system provides:

✅ **Better Performance**: Single API call instead of 3  
✅ **Better Quality**: Claude models with enhanced prompting  
✅ **Lower Cost**: Integrated AWS service pricing  
✅ **File Support**: PDF, DOCX, Excel processing out of the box  
✅ **Better Monitoring**: Built-in sync status and statistics  
✅ **Enterprise Ready**: AWS security and compliance  

Your existing frontend code should work without changes, but now with better responses and new file upload capabilities!