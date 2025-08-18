# Technical Flows Documentation

This document provides detailed technical explanations of the three core flows in the POC Bedrock application with exact function names, endpoints, and implementation details.

## Table of Contents
1. [Action Group Creation Flow](#1-action-group-creation-flow)
2. [Agent Query Retrieval Flow](#2-agent-query-retrieval-flow)
3. [Scraper and Knowledge Base Storage Flow](#3-scraper-and-knowledge-base-storage-flow)

---

## 1. Action Group Creation Flow

### Overview
This flow allows users to create AWS Bedrock Action Groups by configuring external APIs through a web interface. The system automatically generates OpenAPI schemas, creates Lambda functions, and integrates with Bedrock Agent.

### Endpoint
**`POST /api/action-groups/create`**

### Technical Implementation Flow

#### 1.1 Frontend Layer (`frontend/src/pages/ActionGroupPage.jsx`)
```javascript
// User configures API through form interface
const apiConfig = {
  apiName: "Order Tracking API",
  description: "API for tracking orders", 
  baseUrl: "https://api.example.com",
  endpoints: [...],
  authentication: {...}
}

// Submission via API utility
actionGroupAPI.createActionGroup(apiConfig)
```

#### 1.2 API Layer (`frontend/src/utils/api.js`)
```javascript
// actionGroupAPI.createActionGroup() function
const response = await api.post('/action-groups/create', apiConfig);
```

#### 1.3 Route Handler (`src/routes/actionGroups.js:210-296`)
```javascript
router.post('/create', [...validators], async (req, res) => {
  // Step 1: Input validation using express-validator
  const errors = validationResult(req);
  
  // Step 2: Validate API configuration
  const configValidation = await actionGroupService.validateApiConfiguration(apiConfig);
  
  // Step 3: Generate OpenAPI schema
  const openApiSchema = await openApiGeneratorService.generateSchema(apiConfig);
  
  // Step 4: Create action group in AWS Bedrock
  const result = await actionGroupService.createActionGroup(apiConfig, openApiSchema);
})
```

#### 1.4 Action Group Service (`src/services/actionGroupService.js:47-115`)
```javascript
async createActionGroup(apiConfig, openApiSchema) {
  // Step 1: Create Lambda function for API handling
  const lambdaFunction = await this.createLambdaFunction(apiConfig);
  
  // Step 2: Generate unique action group name
  const actionGroupName = this.generateActionGroupName(apiConfig.apiName);
  
  // Step 3: Create action group in Bedrock
  const createCommand = new CreateAgentActionGroupCommand({
    agentId: this.agentId,
    agentVersion: 'DRAFT',
    actionGroupName: actionGroupName,
    actionGroupExecutor: { lambda: lambdaFunction.functionArn },
    apiSchema: { payload: JSON.stringify(openApiSchema) },
    actionGroupState: 'ENABLED'
  });
  
  const response = await this.bedrockAgentClient.send(createCommand);
  
  // Step 4: Store API configuration for Lambda
  await this.storeApiConfiguration(actionGroupId, apiConfig);
  
  // Step 5: Prepare agent with new action group
  await this.prepareAgent();
}
```

#### 1.5 Lambda Function Creation (`src/services/actionGroupService.js:122-183`)
```javascript
async createLambdaFunction(apiConfig) {
  const functionName = this.generateLambdaFunctionName(apiConfig.apiName);
  
  try {
    // Check if function exists
    const getCommand = new GetFunctionCommand({ FunctionName: functionName });
    const existingFunction = await this.lambdaClient.send(getCommand);
    
    // Update existing function code
    const zipFile = await this.generateLambdaCode(apiConfig);
    const updateCommand = new UpdateFunctionCodeCommand({
      FunctionName: functionName,
      ZipFile: zipFile
    });
    
    await this.lambdaClient.send(updateCommand);
    
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      // Create new function using CreateFunctionCommand
      return await this.createNewLambdaFunction(functionName, apiConfig);
    }
  }
}
```

#### 1.6 Lambda Code Generation
- Uses template from `lambda-templates/generic-api-handler.js`
- Injects API configuration into Lambda runtime
- Handles authentication, request routing, and response formatting
- Supports various HTTP methods and parameter types

---

## 2. Agent Query Retrieval Flow

### Overview
This flow processes user queries through AWS Bedrock Agent, which intelligently retrieves information from the knowledge base and can execute action groups when needed.

### Endpoints
- **`POST /api/chat/query`** (with `useAgent: true`)
- **`POST /api/chat/agent`** (direct agent endpoint)

### Technical Implementation Flow

#### 2.1 Frontend Query Submission (`frontend/src/pages/ChatPage.jsx`)
```javascript
// User sends message through chat interface
const response = await chatAPI.sendMessage(message, sessionId, model, useAgent, enhancementOptions);

// Alternative direct agent call
const response = await agentAPI.sendMessage(message, sessionId, options);
```

#### 2.2 Chat Route Handler (`src/routes/chat.js:332-504`)
```javascript
router.post('/query', [...validators], async (req, res) => {
  const { message, sessionId, model, useAgent, enhancementOptions } = req.body;
  
  if (useAgent) {
    // Route to Bedrock Agent for intelligent knowledge retrieval
    response = await bedrockAgentService.invokeAgent(message, sessionId, {
      useEnhancement: enhancementOptions.includeContext,
      sessionConfig: { enableTrace: process.env.NODE_ENV === 'development' }
    });
  } else {
    // Direct knowledge base query (fallback)
    response = await bedrockService.queryKnowledgeBase(message, sessionId, model, enhancementOptions);
  }
});
```

#### 2.3 Agent Route Handler (`src/routes/agent.js:88-219`)
```javascript
router.post('/', [...validators], async (req, res) => {
  const { message, sessionId, options } = req.body;
  
  // Direct invocation of Bedrock Agent
  const response = await bedrockAgentService.invokeAgent(message, sessionId, options);
  
  // Map citations to sources format for consistency
  const sources = response.citations?.map(citation => ({
    documentId: citation.retrievedReferences?.[0]?.location?.s3Location?.uri,
    relevanceScore: citation.retrievedReferences?.[0]?.metadata?.relevanceScore,
    excerpt: citation.generatedResponsePart?.textResponsePart?.text
  })) || [];
});
```

#### 2.4 Bedrock Agent Service Core Logic (`src/services/bedrockAgentService.js:271-382`)
```javascript
async invokeAgent(query, sessionId = null, options = {}) {
  // Step 1: Validate agent configuration
  if (!this.agentId) {
    throw new Error('BEDROCK_AGENT_ID is not configured');
  }
  
  // Step 2: Get or create session for conversation continuity
  const session = this.getOrCreateSession(sessionId, options.sessionConfig);
  
  // Step 3: Analyze query and determine enhancement approach
  const analysis = this.analyzeQuery(query, session.context);
  
  // Step 4: Apply query enhancement if needed
  const finalQuery = options.useEnhancement !== false ? 
    analysis.queryEnhancement : query;
  
  // Step 5: Prepare agent invocation parameters
  const agentParams = {
    agentId: this.agentId,
    agentAliasId: this.agentAliasId,
    sessionId: session.id,
    inputText: finalQuery,
    enableTrace: process.env.NODE_ENV === 'development',
    sessionState: options.sessionState || {}
  };
  
  // Step 6: Create and send command with rate limiting
  const command = new InvokeAgentCommand(agentParams);
  const response = await this.executeWithRateLimit(async () => {
    return await this.agentRuntimeClient.send(command);
  });
  
  // Step 7: Process streaming response
  const agentResponse = await this.processAgentResponse(response);
  
  // Step 8: Build final response with session context
  return this.buildFinalResponse(session, agentResponse, analysis);
}
```

#### 2.5 Response Processing (`src/services/bedrockAgentService.js:389-700`)
```javascript
async processAgentResponse(response) {
  let fullText = '';
  let citations = [];
  let trace = null;
  let tokensUsed = 0;
  
  try {
    // Process streaming response from AWS
    if (response.completion) {
      for await (const chunkEvent of response.completion) {
        if (chunkEvent.chunk?.bytes) {
          const chunkData = JSON.parse(Buffer.from(chunkEvent.chunk.bytes).toString());
          
          // Extract text content
          if (chunkData.type === 'text') {
            fullText += chunkData.text || '';
          }
          
          // Extract citations for source attribution
          if (chunkData.type === 'citation') {
            citations.push(chunkData.citation);
          }
          
          // Extract trace information for debugging
          if (chunkData.type === 'trace') {
            trace = chunkData.trace;
          }
        }
      }
    }
    
    return { text: fullText, citations, trace, tokensUsed };
  } catch (error) {
    // Fallback processing methods
    return await this.processAgentResponseAlternative(response);
  }
}
```

#### 2.6 Session Management and Context
```javascript
getOrCreateSession(sessionId, sessionConfig = {}) {
  if (sessionId && this.activeSessions.has(sessionId)) {
    return this.activeSessions.get(sessionId);
  }
  
  const newSession = {
    id: sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    messageCount: 0,
    context: [],
    config: sessionConfig
  };
  
  this.activeSessions.set(newSession.id, newSession);
  return newSession;
}
```

---

## 3. Scraper and Knowledge Base Storage Flow

### Overview
This flow crawls websites using an external scraping service, processes the content, and stores it in AWS Bedrock Knowledge Base for intelligent retrieval.

### Endpoints
- **`POST /api/scraping/enhanced-crawl`** (comprehensive website crawling)
- **`POST /api/scraping/scrape`** (single page scraping)
- **`POST /api/scraping/discover`** (page discovery only)

### Technical Implementation Flow

#### 3.1 Frontend Scraping Initiation (`frontend/src/pages/DataViewerPage.jsx`)
```javascript
// User submits URL and crawling options
const crawlOptions = {
  maxPages: 50,
  delay: 1000,
  followExternalLinks: false,
  respectRobots: true,
  deepExtraction: true
};

// Initiate comprehensive crawling
const result = await scrapingAPI.crawlWebsite(url, crawlOptions);
```

#### 3.2 Scraping Route Handler (`src/routes/scraping.js:375-450`)
```javascript
router.post('/enhanced-crawl', [...validators], async (req, res) => {
  const { url, options = {} } = req.body;
  
  // Set default crawling options
  const crawlOptions = {
    maxPages: options.maxPages || 50,
    delay: options.delay || 1000,
    followExternalLinks: options.followExternalLinks || false,
    respectRobots: options.respectRobots !== false,
    ...options
  };
  
  // Start comprehensive crawling and scraping via external service
  const result = await externalScrapingService.crawlAndScrapeWebsite(url, crawlOptions);
  
  // Return detailed crawling statistics and content preview
  res.json({
    success: true,
    data: {
      domain: result.domain,
      crawlingStats: result.crawlingStats,
      contentStats: result.contentStats,
      totalPagesScraped: result.scrapedPages.length,
      totalChunks: result.contentStats.totalChunks,
      successRate: result.crawlingStats.successRate
    }
  });
});
```

#### 3.3 External Scraping Service Core Logic (`src/services/externalScrapingService.js:326-400`)
```javascript
async crawlAndScrapeWebsite(url, options = {}, progressCallback = null) {
  const cleanUrl = this.sanitizeUrl(url);
  const domain = new URL(cleanUrl).hostname;
  
  // Step 1: Discover all URLs using enhanced crawl
  const discovery = await this.discoverWebsitePages(cleanUrl, options);
  let urlsToScrape = discovery.discoveredUrls;
  
  // Step 2: Apply maxPages limit if specified
  if (options.maxPages && urlsToScrape.length > options.maxPages) {
    urlsToScrape = urlsToScrape.slice(0, options.maxPages);
  }
  
  // Step 3: Scrape discovered pages in batches
  const scrapedPages = [];
  const errors = [];
  const batchSize = options.batchSize || 5;
  
  for (let i = 0; i < urlsToScrape.length; i += batchSize) {
    const batch = urlsToScrape.slice(i, i + batchSize);
    const batchResults = await this.scrapeBatch(batch, options);
    
    scrapedPages.push(...batchResults.successful);
    errors.push(...batchResults.errors);
    
    // Progress callback for frontend updates
    if (progressCallback) {
      progressCallback({
        phase: 'scraping',
        completed: i + batch.length,
        total: urlsToScrape.length,
        percentage: Math.round(((i + batch.length) / urlsToScrape.length) * 80) + 20
      });
    }
  }
  
  // Step 4: Store all scraped content in knowledge base
  const storageResults = await this.storeScrapedContent(scrapedPages, domain);
  
  return this.generateCrawlSummary(domain, discovery, scrapedPages, errors, options);
}
```

#### 3.4 Page Discovery Process (`src/services/externalScrapingService.js:198-261`)
```javascript
async discoverWebsitePages(url, options = {}) {
  const cleanUrl = this.sanitizeUrl(url);
  const domain = new URL(cleanUrl).hostname;
  
  // Check if external service is available
  const isAvailable = await this.isExternalServiceAvailable();
  if (!isAvailable) {
    throw new Error('External scraping service is currently unavailable');
  }
  
  try {
    // Try comprehensive discovery with external service
    const requestPayload = {
      url: cleanUrl,
      maxDepth: options.maxDepth || 1
    };
    
    const response = await this.api.post('/enhanced-crawl', requestPayload, {
      timeout: 1200000 // 20 minutes for large sites
    });
    
    if (response.data?.success) {
      return {
        domain: domain,
        totalPages: response.data.count,
        discoveredUrls: response.data.data || [],
        strategy: response.data.strategy,
        sitemap: response.data.sitemap,
        robots: response.data.robots
      };
    }
  } catch (crawlError) {
    // Fallback: Use direct scraping with common page patterns
    return await this.discoverPagesWithFallback(cleanUrl, options);
  }
}
```

#### 3.5 Content Processing and Storage (`src/services/externalScrapingService.js:1218-1292`)
```javascript
async storeInS3(processedData) {
  const domain = new URL(processedData.url).hostname;
  const timestamp = new Date().toISOString();
  
  // Store raw scraped data for backup
  const rawKey = `raw-scraped-content/${domain}/${generateHash(processedData.url)}.json`;
  await this.s3Client.send(new PutObjectCommand({
    Bucket: this.bucket,
    Key: rawKey,
    Body: JSON.stringify(processedData),
    ContentType: 'application/json'
  }));
  
  // Prepare document for optimized Bedrock Knowledge Base storage
  const document = {
    content: processedData.content,
    title: processedData.title,
    url: processedData.url,
    metadata: {
      ...processedData.metadata,
      domain: domain,
      contentHash: processedData.contentHash,
      scrapedAt: timestamp,
      source: 'external-scraper',
      extractionMethod: 'web-scraping'
    }
  };
  
  // Store using optimized Bedrock Knowledge Base Service
  const kbResult = await bedrockKnowledgeBaseService.storeDocument(document);
  
  return {
    ...kbResult,
    rawKey,
    domain,
    chunkCount: kbResult.chunkCount
  };
}
```

#### 3.6 Bedrock Knowledge Base Service (`src/services/bedrockKnowledgeBaseService.js:44-199`)
```javascript
async storeDocument(document) {
  const { content, metadata, title, url } = document;
  
  // Step 1: Clean and prepare content
  const cleanedContent = this.cleanContent(content);
  
  // Step 2: Create optimized chunks for search
  const chunks = this.createOptimalChunks(cleanedContent);
  
  // Step 3: Generate unique document ID
  const documentId = generateHash(url || title || content.substring(0, 100));
  const timestamp = new Date().toISOString();
  
  // Step 4: Store individual chunks in S3 with proper structure
  const sourceType = metadata?.source === 'external-scraper' ? 'web-content' : 'document-content';
  const chunkKeys = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = generateChunkId(documentId, i);
    const chunkKey = `${sourceType}/${documentId}/chunk-${i}.json`;
    
    const chunkDocument = {
      id: chunkId,
      content: chunk,
      metadata: {
        ...metadata,
        documentId,
        chunkIndex: i,
        totalChunks: chunks.length,
        chunkId,
        createdAt: timestamp
      }
    };
    
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: chunkKey,
      Body: JSON.stringify(chunkDocument),
      ContentType: 'application/json'
    }));
    
    chunkKeys.push(chunkKey);
  }
  
  // Step 5: Trigger knowledge base synchronization
  try {
    const syncResult = await knowledgeBaseSync.syncKnowledgeBase(
      metadata?.domain || 'unknown-domain',
      false // Don't wait for completion
    );
  } catch (syncError) {
    logger.warn('Knowledge base sync warning:', syncError.message);
  }
  
  return {
    documentId,
    s3Key: `${sourceType}/${documentId}/`,
    chunkCount: chunks.length,
    chunkKeys,
    timestamp
  };
}
```

#### 3.7 Knowledge Base Synchronization (`src/services/knowledgeBaseSync.js:41-77`)
```javascript
async syncKnowledgeBase(domain, waitForCompletion = false) {
  // Check for ongoing jobs if wait is requested
  if (waitForCompletion) {
    await this.waitForNoActiveJobs();
  }
  
  // Start ingestion job to sync new content
  const command = new StartIngestionJobCommand({
    knowledgeBaseId: this.knowledgeBaseId,
    dataSourceId: this.dataSourceId,
    description: `Sync scraped content from ${domain} - ${new Date().toISOString()}`
  });
  
  const response = await this.bedrockAgentClient.send(command);
  
  return {
    jobId: response.ingestionJob.ingestionJobId,
    status: response.ingestionJob.status,
    startedAt: response.ingestionJob.startedAt
  };
}
```

#### 3.8 Content Chunking Strategy
```javascript
createOptimalChunks(content) {
  const maxChunkSize = this.chunkingConfig.maxChunkSize; // 1000 chars
  const chunkOverlap = this.chunkingConfig.chunkOverlap; // 200 chars
  const separators = this.chunkingConfig.separators; // ['\n\n', '\n', '. ', '! ', '? ', '; ']
  
  // Implement recursive text splitting for optimal chunk boundaries
  // Preserve sentence/paragraph boundaries when possible
  // Ensure chunks are meaningful and searchable
}
```

---

## Integration Points and Data Flow

### Key Integration Points

1. **Content Flow**: External Scraper → S3 Storage → Bedrock Knowledge Base → Agent Retrieval
2. **Query Flow**: User Query → Bedrock Agent → Knowledge Base Search → Action Group Execution → Cited Response
3. **Action Group Flow**: User Configuration → Lambda Function → OpenAPI Schema → Bedrock Agent Integration

### AWS Services Used

- **AWS Bedrock Agent**: Core AI agent for query processing and action execution
- **AWS Bedrock Knowledge Base**: Document storage and retrieval system
- **AWS Lambda**: Serverless functions for action group API handling
- **AWS S3**: Object storage for documents and processed content
- **AWS IAM**: Permission management for service integration

### External Dependencies

- **External Scraping Service**: `https://scrapper.apps.kaaylabs.com/api`
- **Node.js Libraries**: `cheerio`, `turndown`, `axios`, `express-validator`
- **AWS SDK**: `@aws-sdk/client-bedrock-agent`, `@aws-sdk/client-lambda`, `@aws-sdk/client-s3`

---

## Error Handling and Monitoring

### Error Handling Strategies

1. **Graceful Degradation**: Fallback methods when primary services fail
2. **Rate Limiting**: Queue management for AWS API calls
3. **Retry Logic**: Exponential backoff for network requests
4. **Validation**: Input validation at multiple layers

### Monitoring Points

1. **Action Group Creation**: Lambda deployment success, Bedrock integration status
2. **Agent Queries**: Response time, citation accuracy, session management
3. **Scraping Operations**: Success rates, content quality, storage efficiency

This documentation provides the complete technical understanding of how each component interacts and processes data through the system.