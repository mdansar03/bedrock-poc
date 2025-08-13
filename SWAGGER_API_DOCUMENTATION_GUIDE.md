# Swagger API Documentation Guide

## Overview

This document provides a comprehensive guide to the newly implemented Swagger/OpenAPI documentation for the Oralia AI Chatbot API. The Swagger documentation provides interactive API documentation with sample requests, responses, and the ability to test endpoints directly from the browser.

## 🚀 Quick Start

### Accessing the Swagger UI

Once your server is running, you can access the interactive API documentation at:

```
http://localhost:3002/api-docs
```

For production environments, replace `localhost:3002` with your actual server URL.

### API Specification JSON

The raw OpenAPI 3.0 specification is available at:

```
http://localhost:3002/api-docs/swagger.json
```

## 📋 Available API Categories

### 1. Health Check
- **GET /api/health** - Check system health and service status

### 2. Chat Endpoints
- **GET /api/chat/models** - Get available AI foundation models
- **GET /api/chat/enhancement-options** - Get response enhancement options
- **POST /api/chat/query** - Chat with AI using RAG (with agent support)

### 3. Agent Endpoints
- **POST /api/chat/agent** - Chat with Bedrock Agent for knowledge base queries
- **GET /api/chat/agent/info** - Get agent information and session summary
- **GET /api/chat/agent/test** - Test agent connectivity
- **GET /api/chat/agent/health** - Get agent health status
- **GET /api/chat/agent/sessions** - Get active sessions information
- **POST /api/chat/agent/setup** - Create a new Bedrock Agent

### 4. File Processing
- **POST /api/files/upload** - Upload and process files for knowledge base

### 5. Web Scraping
- **POST /api/scraping/scrape** - Scrape a single web page
- **POST /api/scraping/crawl** - Crawl an entire domain (documented separately)

### 6. Data Management
- **GET /api/data-management/domains** - Get domains summary
- **GET /api/data-management/domains/{domain}/documents** - List domain documents
- **DELETE /api/data-management/domains/{domain}** - Delete domain and documents

## 🔧 Key Features

### Interactive Testing
- Test endpoints directly from the Swagger UI
- Pre-filled example requests for each endpoint
- Real-time response viewing
- Parameter validation and error handling

### Comprehensive Documentation
- Detailed descriptions for all endpoints
- Request/response schemas with examples
- Parameter validation rules
- Error response formats

### Multiple Request Examples
Each endpoint includes multiple example requests:
- Basic usage examples
- Advanced configuration examples
- Real-world use case scenarios

## 📝 Example API Calls

### 1. Basic Chat Query

```bash
curl -X POST "http://localhost:3002/api/chat/query" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is artificial intelligence?",
    "enhancementOptions": {
      "responseType": "technical",
      "includeExamples": true
    }
  }'
```

### 2. Agent Knowledge Base Query

```bash
curl -X POST "http://localhost:3002/api/chat/agent" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Find information about system requirements",
    "sessionId": "agent-session-001",
    "options": {
      "useEnhancement": true
    }
  }'
```

### 3. File Upload

```bash
curl -X POST "http://localhost:3002/api/files/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "files=@document.pdf" \
  -F "title=Technical Documentation" \
  -F "category=documentation" \
  -F "tags[]=technical,manual"
```

### 4. Web Scraping

```bash
curl -X POST "http://localhost:3002/api/scraping/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "options": {
      "maxDepth": 2,
      "respectRobots": true
    }
  }'
```

## 🛠 Authentication & Security

Currently, the API uses:
- Rate limiting (configurable via environment variables)
- CORS protection
- Input validation
- Helmet.js security headers

Future authentication schemes (JWT, API keys) can be easily added to the Swagger configuration.

## 🌐 Environment Configuration

The Swagger documentation automatically adapts to your environment:

### Development
```
API Base URL: http://localhost:3002
Environment: development
```

### Production
Update the `API_BASE_URL` environment variable or modify `src/config/swagger.js` servers configuration.

## 📊 Response Formats

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    // Response data here
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message",
  "details": [
    // Validation errors or additional details
  ]
}
```

## 🚀 Integration with Frontend

### Frontend Integration Benefits
1. **Type Safety**: Generate TypeScript interfaces from OpenAPI specification
2. **API Client Generation**: Auto-generate API client libraries
3. **Real-time Testing**: Test API changes during development
4. **Documentation Sync**: Always up-to-date API documentation

### Recommended Integration Tools
- **OpenAPI Generator**: Generate client SDKs
- **Swagger Codegen**: Generate API clients in multiple languages
- **Postman**: Import OpenAPI spec for testing

## 📁 File Structure

```
src/
├── config/
│   └── swagger.js          # Swagger configuration and schemas
├── routes/
│   ├── chat.js            # Chat endpoints (documented)
│   ├── agent.js           # Agent endpoints (documented)
│   ├── files.js           # File processing (documented)
│   ├── scraping.js        # Web scraping (documented)
│   ├── dataManagement.js  # Data management (documented)
│   └── health.js          # Health check (documented)
└── server.js              # Main server with Swagger integration
```

## 🔄 Updating Documentation

When adding new endpoints:

1. Add Swagger JSDoc comments above route handlers:
```javascript
/**
 * @swagger
 * /api/new-endpoint:
 *   post:
 *     summary: Description
 *     tags: [Category]
 *     // ... rest of documentation
 */
```

2. Define request/response schemas in `src/config/swagger.js`
3. The documentation will automatically update when the server restarts

## 🐛 Troubleshooting

### Common Issues

1. **Swagger UI not loading**: Check server logs for startup errors
2. **Missing endpoints**: Ensure route files are included in `swagger.js` apis array
3. **Schema validation errors**: Verify JSDoc syntax and indentation

### Debug Mode
Set `NODE_ENV=development` to see detailed error messages in Swagger UI.

## 📈 Performance Considerations

- Swagger documentation is generated once at startup
- No runtime performance impact on API endpoints
- UI assets are served statically for optimal loading

## 🎯 Next Steps

1. **Add Authentication**: Implement JWT or API key authentication
2. **Rate Limiting Documentation**: Document rate limiting rules per endpoint
3. **Webhook Documentation**: Add webhook endpoint documentation
4. **API Versioning**: Implement API versioning strategy
5. **Custom Themes**: Customize Swagger UI appearance

## 🤝 Contributing

When adding new endpoints:
- Follow existing documentation patterns
- Include comprehensive examples
- Test documentation in Swagger UI
- Update this guide if adding new categories

---

## 📞 Support

For questions about the API documentation:
1. Check the interactive Swagger UI at `/api-docs`
2. Review this guide
3. Check server logs for detailed error information

The Swagger documentation ensures better frontend integration, easier testing, and comprehensive API understanding for all developers working with the Oralia AI Chatbot system.