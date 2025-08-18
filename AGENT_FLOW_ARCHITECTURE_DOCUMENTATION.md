# Agent Flow Architecture Documentation

## Executive Summary

This document provides a comprehensive overview of the AWS Bedrock Agent implementation with Knowledge Base and Action Groups integration. The system is designed as an intelligent AI assistant that can:

1. **Query Knowledge Base**: Retrieve information from processed documents and scraped web content
2. **Execute Action Groups**: Call external APIs to perform operations or fetch real-time data
3. **Maintain Context**: Handle conversational sessions with memory and context awareness

---

## System Architecture Overview

### Core Components

```mermaid
graph TB
    subgraph "Frontend Layer"
        UI[React UI]
        ChatPage[Chat Interface]
        ActionPage[Action Group Config]
        DataViewer[Data Management]
    end
    
    subgraph "Backend Services"
        Router[Express Routes]
        AgentService[Bedrock Agent Service]
        ActionGroupService[Action Group Service]
        KnowledgeService[Knowledge Base Service]
        ScrapingService[External Scraping Service]
    end
    
    subgraph "AWS Services"
        BedrockAgent[AWS Bedrock Agent]
        KnowledgeBase[AWS Bedrock Knowledge Base]
        Lambda[AWS Lambda Functions]
        S3[AWS S3 Storage]
    end
    
    subgraph "External Services"
        APIs[External APIs]
        ScrapingAPI[Scraping Service]
    end
    
    UI --> Router
    Router --> AgentService
    Router --> ActionGroupService
    Router --> KnowledgeService
    Router --> ScrapingService
    
    AgentService --> BedrockAgent
    ActionGroupService --> Lambda
    KnowledgeService --> KnowledgeBase
    ScrapingService --> ScrapingAPI
    
    BedrockAgent --> KnowledgeBase
    BedrockAgent --> Lambda
    Lambda --> APIs
    KnowledgeBase --> S3
    ScrapingService --> S3
```

---

## 1. Agent Query Flow with Knowledge Base

### Overview
When a user submits a query, the system routes it through the Bedrock Agent, which intelligently determines whether to search the knowledge base, execute action groups, or both.

### Flow Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant R as Chat Route
    participant AS as Agent Service
    participant BA as Bedrock Agent
    participant KB as Knowledge Base
    participant AG as Action Groups
    
    U->>F: Submit Query
    F->>R: POST /api/chat/query
    Note over R: useAgent = true
    
    R->>AS: invokeAgent(query, sessionId)
    AS->>AS: analyzeQuery() - Determine intent
    AS->>AS: getOrCreateSession() - Session management
    AS->>AS: applyQueryEnhancement() - Optimize query
    
    AS->>BA: InvokeAgentCommand
    Note over BA: Bedrock Agent processes query
    
    BA->>KB: Search knowledge base
    KB-->>BA: Return relevant documents
    
    opt If Action Required
        BA->>AG: Execute action group
        AG-->>BA: Return API results
    end
    
    BA-->>AS: Streaming response with citations
    AS->>AS: processAgentResponse() - Parse chunks
    AS->>AS: buildFinalResponse() - Format output
    AS-->>R: Structured response
    R-->>F: JSON response
    F-->>U: Display answer with sources
```

### Technical Implementation Details

#### 1.1 Query Analysis and Enhancement
```javascript
// Location: src/services/bedrockAgentService.js:116-180
analyzeQuery(query, context) {
    // Determine interaction style (conversational, analytical, technical)
    // Analyze conversation history and user intent
    // Apply context-aware query enhancement
    // Return optimized query with metadata
}
```

**Why this happens**: The system analyzes user queries to provide more contextually relevant responses and maintain conversation continuity.

#### 1.2 Session Management
```javascript
// Location: src/services/bedrockAgentService.js:85-108
getOrCreateSession(sessionId, sessionConfig) {
    // Create or retrieve existing conversation session
    // Maintain conversation context and preferences
    // Handle session timeout and cleanup
}
```

**Why this happens**: Sessions enable multi-turn conversations where the agent remembers previous interactions and maintains context.

#### 1.3 Bedrock Agent Invocation
```javascript
// Location: src/services/bedrockAgentService.js:295-321
const agentParams = {
    agentId: this.agentId,
    agentAliasId: this.agentAliasId,
    sessionId: session.id,
    inputText: enhancedQuery,
    enableTrace: process.env.NODE_ENV === 'development'
};
```

**Why this happens**: This is the core integration point with AWS Bedrock Agent, which handles the intelligent processing and decision-making.

---

## 2. Action Group Integration Flow

### Overview
Action Groups enable the Bedrock Agent to call external APIs as functions, extending its capabilities beyond static knowledge retrieval to dynamic data access and operations.

### Flow Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AR as Action Routes
    participant AGS as Action Group Service
    participant OAS as OpenAPI Service
    participant L as Lambda
    participant BA as Bedrock Agent
    participant API as External API
    
    Note over U,API: Action Group Creation Flow
    
    U->>F: Configure API (ActionGroupPage)
    F->>AR: POST /api/action-groups/create
    AR->>AGS: validateApiConfiguration()
    AR->>OAS: generateSchema(apiConfig)
    OAS-->>AR: OpenAPI Schema
    
    AR->>AGS: createActionGroup(config, schema)
    AGS->>AGS: createLambdaFunction()
    AGS->>AGS: generateLambdaCode()
    AGS->>L: Deploy Lambda Function
    
    AGS->>BA: CreateAgentActionGroupCommand
    Note over BA: Register action group with agent
    
    AGS->>AGS: prepareAgent()
    AGS-->>AR: Action Group Created
    
    Note over U,API: Action Group Execution Flow
    
    U->>F: Query requiring API call
    F->>AGS: Agent processes query
    BA->>BA: Determine action needed
    BA->>L: Invoke Lambda Function
    L->>API: HTTP Request
    API-->>L: API Response
    L-->>BA: Formatted Response
    BA-->>F: Final Answer with API data
```

### Technical Implementation Details

#### 2.1 Action Group Creation
```javascript
// Location: src/services/actionGroupService.js:47-115
async createActionGroup(apiConfig, openApiSchema) {
    // Step 1: Create Lambda function for API handling
    const lambdaFunction = await this.createLambdaFunction(apiConfig);
    
    // Step 2: Generate action group name
    const actionGroupName = this.generateActionGroupName(apiConfig.apiName);
    
    // Step 3: Create action group in Bedrock
    const createCommand = new CreateAgentActionGroupCommand({
        agentId: this.agentId,
        actionGroupExecutor: { lambda: lambdaFunction.functionArn },
        apiSchema: { payload: JSON.stringify(openApiSchema) }
    });
}
```

**Why this happens**: Action Groups bridge the gap between the AI agent and external systems, allowing real-time data access and operations.

#### 2.2 Lambda Function Generation
```javascript
// Location: src/services/actionGroupService.js:441-655
generateLambdaCodeString(apiConfig) {
    // Read template from lambda-templates/generic-api-handler.js
    // Inject API configuration into Lambda runtime
    // Handle authentication, request routing, response formatting
    // Return deployable Lambda code
}
```

**Why this happens**: Lambda functions act as secure, scalable adapters between the Bedrock Agent and external APIs, handling authentication and data transformation.

---

## 3. Knowledge Base Storage and Retrieval Flow

### Overview
The system continuously ingests content from web scraping and document uploads, processes it into searchable chunks, and stores it in the Bedrock Knowledge Base for intelligent retrieval.

### Flow Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant SR as Scraping Routes
    participant ESS as External Scraping Service
    participant BKBS as Bedrock KB Service
    participant S3 as AWS S3
    participant KB as Knowledge Base
    participant BA as Bedrock Agent
    
    Note over U,BA: Content Ingestion Flow
    
    U->>F: Submit URL for scraping
    F->>SR: POST /api/scraping/enhanced-crawl
    SR->>ESS: crawlAndScrapeWebsite()
    
    ESS->>ESS: discoverWebsitePages() - Find all pages
    ESS->>ESS: scrapeBatch() - Extract content
    ESS->>ESS: processContent() - Clean and structure
    
    ESS->>BKBS: storeDocument() for each page
    BKBS->>BKBS: cleanContent() - Remove noise
    BKBS->>BKBS: createOptimalChunks() - Split content
    BKBS->>S3: Store chunks with metadata
    BKBS->>KB: Trigger knowledge base sync
    
    Note over U,BA: Content Retrieval Flow
    
    U->>F: Submit query
    F->>BA: Agent processes query
    BA->>KB: Search for relevant content
    KB->>S3: Retrieve matching documents
    S3-->>KB: Document chunks with metadata
    KB-->>BA: Ranked results with citations
    BA-->>F: Answer with source citations
```

### Technical Implementation Details

#### 3.1 Content Processing and Chunking
```javascript
// Location: src/services/bedrockKnowledgeBaseService.js:240-285
createOptimalChunks(content) {
    const maxChunkSize = 1000; // Optimal for Bedrock retrieval
    const overlapSize = 100;   // Character overlap between chunks
    
    // Split by paragraphs first, then sentences if needed
    // Maintain semantic boundaries for better search relevance
    // Create overlap between chunks for context preservation
}
```

**Why this happens**: Proper chunking ensures that search results are meaningful and contain sufficient context while staying within Bedrock's processing limits.

#### 3.2 Knowledge Base Synchronization
```javascript
// Location: src/services/bedrockKnowledgeBaseService.js:404-426
async syncKnowledgeBase() {
    const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        description: `Sync triggered at ${new Date().toISOString()}`
    });
    
    const response = await this.bedrockAgent.send(command);
    return response.ingestionJob.ingestionJobId;
}
```

**Why this happens**: Synchronization ensures that newly added content becomes available for agent queries, keeping the knowledge base current.

---

## 4. Complete Integration Flow

### The Full User Journey

```mermaid
graph TD
    A[User Submits Query] --> B{Agent Analysis}
    B --> C[Session Context Check]
    C --> D[Query Enhancement]
    D --> E[Bedrock Agent Processing]
    
    E --> F{Content Source Needed?}
    F -->|Yes| G[Knowledge Base Search]
    G --> H[Retrieve Relevant Documents]
    H --> I[Rank by Relevance]
    
    E --> J{Action Required?}
    J -->|Yes| K[Identify Action Group]
    K --> L[Execute Lambda Function]
    L --> M[Call External API]
    M --> N[Process API Response]
    
    I --> O[Combine Knowledge & Actions]
    N --> O
    O --> P[Generate Response]
    P --> Q[Add Citations & Sources]
    Q --> R[Update Session Context]
    R --> S[Return to User]
    
    style A fill:#e1f5fe
    style S fill:#c8e6c9
    style E fill:#fff3e0
    style G fill:#f3e5f5
    style L fill:#e8f5e8
```

---

## 5. Why This Architecture?

### Design Principles

1. **Intelligent Routing**: The Bedrock Agent automatically determines the best approach for each query
2. **Extensibility**: Action Groups allow seamless integration with any REST API
3. **Context Awareness**: Session management maintains conversation history and preferences
4. **Scalability**: Lambda functions and S3 storage scale automatically with demand
5. **Accuracy**: Citation tracking ensures responses are attributable to sources

### Benefits

1. **Unified Interface**: Single chat interface for both static knowledge and dynamic data
2. **Real-time Capabilities**: Action Groups enable current information and operations
3. **Intelligent Chunking**: Optimized content processing improves search relevance
4. **Session Continuity**: Conversations maintain context across multiple interactions
5. **Modular Design**: Components can be updated independently

---

## 6. Configuration Requirements

### Environment Variables

```bash
# Core AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Bedrock Agent Configuration
BEDROCK_AGENT_ID=your_agent_id
BEDROCK_AGENT_ALIAS_ID=your_alias_id
BEDROCK_KNOWLEDGE_BASE_ID=your_kb_id

# Storage Configuration
BEDROCK_S3_BUCKET=your_bucket_name
DEFAULT_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
```

### Key Endpoints

| Endpoint | Purpose | Flow |
|----------|---------|------|
| `POST /api/chat/query` | Primary chat interface | Agent Query Flow |
| `POST /api/chat/agent` | Direct agent communication | Agent Query Flow |
| `POST /api/action-groups/create` | Create new action group | Action Group Integration |
| `POST /api/scraping/enhanced-crawl` | Web content ingestion | Knowledge Base Storage |

---

## 7. Monitoring and Debugging

### Key Metrics to Monitor

1. **Agent Response Time**: Track query processing speed
2. **Knowledge Base Hit Rate**: Measure search effectiveness
3. **Action Group Success Rate**: Monitor API call reliability
4. **Session Management**: Track active conversations
5. **Content Processing**: Monitor scraping and storage operations

### Debug Endpoints

- `GET /api/chat/agent/health` - Agent connectivity status
- `GET /api/chat/agent/test` - Test agent functionality
- `GET /api/chat/status` - Overall system status

---

## 8. Next Steps and Recommendations

### Immediate Improvements

1. **Performance Optimization**: Implement caching for frequently accessed content
2. **Error Handling**: Enhance fallback mechanisms between services
3. **Monitoring**: Set up CloudWatch dashboards for system metrics
4. **Security**: Implement API key rotation for external services

### Future Enhancements

1. **Multi-modal Support**: Add image and document analysis capabilities
2. **Advanced Analytics**: Implement query pattern analysis
3. **Custom Models**: Fine-tune models for domain-specific knowledge
4. **Real-time Sync**: Implement webhooks for immediate content updates

---

This architecture provides a robust, scalable foundation for an intelligent AI assistant that can both access stored knowledge and interact with live systems through APIs. The modular design ensures maintainability while the integration with AWS Bedrock provides enterprise-grade AI capabilities.
