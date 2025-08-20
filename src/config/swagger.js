const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Oralia AI Chatbot API',
      version: '1.0.0',
      description: 'Comprehensive API documentation for Oralia AI Chatbot with AWS Bedrock integration, web scraping, file processing, and data management capabilities.',
      contact: {
        name: 'API Support',
        email: 'support@oralia.ai'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3002',
        description: 'Development server'
      },
      {
        url: 'https://your-production-url.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'An error occurred'
            },
            message: {
              type: 'string',
              example: 'Detailed error message'
            },
            details: {
              type: 'array',
              items: {
                type: 'object'
              }
            }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Operation completed successfully'
            },
            data: {
              type: 'object'
            }
          }
        },
        ChatMessage: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              minLength: 1,
              maxLength: 2000,
              example: 'What is artificial intelligence?'
            },
            sessionId: {
              type: 'string',
              example: 'session-123-456-789'
            },
            modelId: {
              type: 'string',
              example: 'anthropic.claude-3-sonnet-20240229-v1:0'
            },
            options: {
              type: 'object',
              properties: {
                responseType: {
                  type: 'string',
                  enum: ['auto', 'general', 'detailed', 'concise', 'technical', 'creative'],
                  example: 'auto'
                },
                useEnhancement: {
                  type: 'boolean',
                  example: true
                },
                maxTokens: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 4096,
                  example: 1000
                },
                temperature: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  example: 0.7
                }
              }
            }
          }
        },
        ChatResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                response: {
                  type: 'string',
                  example: 'Artificial intelligence (AI) is a branch of computer science...'
                },
                sessionId: {
                  type: 'string',
                  example: 'session-123-456-789'
                },
                modelUsed: {
                  type: 'string',
                  example: 'anthropic.claude-3-sonnet-20240229-v1:0'
                },
                tokensUsed: {
                  type: 'object',
                  properties: {
                    input: {
                      type: 'integer',
                      example: 150
                    },
                    output: {
                      type: 'integer',
                      example: 800
                    }
                  }
                },
                processingTime: {
                  type: 'string',
                  example: '2.5s'
                }
              }
            }
          }
        },
        AgentMessage: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              minLength: 1,
              maxLength: 2000,
              example: 'Find information about machine learning in the knowledge base'
            },
            sessionId: {
              type: 'string',
              example: 'agent-session-123'
            },
            dataSources: {
              type: 'object',
              description: 'Optional data source filtering to restrict search to specific sources',
              properties: {
                websites: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of website domains to include in search',
                  example: ['docs.example.com', 'api.example.com']
                },
                pdfs: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of PDF file names to include in search',
                  example: ['user-manual', 'api-guide']
                },
                documents: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of document file names to include in search',
                  example: ['technical-specs', 'requirements-doc']
                }
              }
            },
            model: {
              type: 'string',
              description: 'Foundation model to use for inference',
              example: 'anthropic.claude-3-sonnet-20240229-v1:0'
            },
            temperature: {
              type: 'number',
              minimum: 0.0,
              maximum: 1.0,
              description: 'Controls randomness in response generation (0.0 = deterministic, 1.0 = very random)',
              example: 0.7
            },
            topP: {
              type: 'number',
              minimum: 0.0,
              maximum: 1.0,
              description: 'Controls nucleus sampling probability (percentage of probability distribution to consider)',
              example: 0.9
            },
            systemPrompt: {
              type: 'string',
              minLength: 1,
              maxLength: 4000,
              description: 'Custom system prompt to provide context and instructions to the agent',
              example: 'You are a technical documentation expert. Provide detailed, structured responses with examples.'
            },
            options: {
              type: 'object',
              properties: {
                useEnhancement: {
                  type: 'boolean',
                  example: true
                },
                sessionConfig: {
                  type: 'object',
                  properties: {
                    enableTrace: {
                      type: 'boolean',
                      example: false
                    }
                  }
                }
              }
            }
          }
        },
        FileUpload: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              example: 'Technical Documentation'
            },
            description: {
              type: 'string',
              example: 'Product specifications and user manual'
            },
            category: {
              type: 'string',
              example: 'documentation'
            },
            tags: {
              type: 'array',
              items: {
                type: 'string'
              },
              example: ['technical', 'manual', 'product']
            }
          }
        },
        ScrapingRequest: {
          type: 'object',
          required: ['url'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://example.com/article'
            },
            options: {
              type: 'object',
              properties: {
                maxDepth: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 10,
                  example: 3
                },
                respectRobots: {
                  type: 'boolean',
                  example: true
                },
                includeImages: {
                  type: 'boolean',
                  example: false
                },
                customSelectors: {
                  type: 'object',
                  properties: {
                    content: {
                      type: 'string',
                      example: '.main-content'
                    },
                    title: {
                      type: 'string',
                      example: 'h1'
                    }
                  }
                }
              }
            }
          }
        },
        CrawlRequest: {
          type: 'object',
          required: ['domain'],
          properties: {
            domain: {
              type: 'string',
              example: 'example.com'
            },
            startUrl: {
              type: 'string',
              format: 'uri',
              example: 'https://example.com'
            },
            options: {
              type: 'object',
              properties: {
                maxPages: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 1000,
                  example: 100
                },
                crawlDelay: {
                  type: 'integer',
                  minimum: 0,
                  example: 1000
                },
                includePatterns: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  example: ['/docs/', '/articles/']
                },
                excludePatterns: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  example: ['/admin/', '/login/']
                }
              }
            }
          }
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'healthy'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-15T10:30:00Z'
            },
            version: {
              type: 'string',
              example: '1.0.0'
            },
            services: {
              type: 'object',
              properties: {
                bedrock: {
                  type: 'string',
                  example: 'connected'
                },
                s3: {
                  type: 'string',
                  example: 'connected'
                },
                knowledgeBase: {
                  type: 'string',
                  example: 'connected'
                }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check and system status endpoints'
      },
      {
        name: 'Chat',
        description: 'Direct chat with AI models and foundation model management'
      },
      {
        name: 'Streaming Chat',
        description: 'Real-time streaming chat with Server-Sent Events (SSE) for faster responses'
      },
      {
        name: 'Agent',
        description: 'Bedrock Agent integration for knowledge base queries'
      },
      {
        name: 'Files',
        description: 'File upload and processing operations'
      },
      {
        name: 'Scraping',
        description: 'Web scraping and crawling operations'
      },
      {
        name: 'Data Management',
        description: 'Knowledge base data management and domain operations'
      },
      {
        name: 'Action Groups',
        description: 'Automated Action Group creation and management for AWS Bedrock Agents'
      }
    ]
  },
  apis: [
    './src/routes/*.js', // Path to the API routes
    './server.js'        // Include main server file if it has documented routes
  ]
};

const specs = swaggerJsdoc(options);

module.exports = {
  specs,
  swaggerUi,
  swaggerUiOptions: {
    explorer: true,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      requestInterceptor: (req) => {
        // Add any global request modifications here
        return req;
      }
    },
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 50px 0 }
      .swagger-ui .scheme-container { 
        background: #fafafa; 
        padding: 20px; 
        border-radius: 5px; 
        margin: 20px 0; 
      }
    `,
    customSiteTitle: 'Oralia AI Chatbot API Documentation'
  }
};