const logger = require('../utils/logger');

/**
 * OpenAPI Schema Generator Service
 * Converts user-provided API configuration to OpenAPI 3.0 specification
 * for use with AWS Bedrock Action Groups
 */
class OpenApiGeneratorService {
  constructor() {
    this.supportedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    this.supportedParamTypes = ['string', 'integer', 'number', 'boolean'];
    this.supportedParamLocations = ['path', 'query', 'header'];
    this.supportedAuthTypes = ['none', 'apiKey', 'bearer', 'basic'];
  }

  /**
   * Generate OpenAPI 3.0 schema from API configuration
   * @param {Object} apiConfig - API configuration object
   * @returns {Object} OpenAPI 3.0 schema
   */
  async generateSchema(apiConfig) {
    try {
      logger.info(`Generating OpenAPI schema for: ${apiConfig.apiName}`);

      // Base OpenAPI structure
      const schema = {
        openapi: '3.0.0',
        info: {
          title: apiConfig.apiName,
          description: apiConfig.description || `Auto-generated OpenAPI schema for ${apiConfig.apiName}`,
          version: '1.0.0',
          'x-generated-by': 'Oralia AI Action Group Generator',
          'x-generated-at': new Date().toISOString()
        },
        servers: [
          {
            url: this.normalizeBaseUrl(apiConfig.baseUrl),
            description: 'API Server'
          }
        ],
        paths: {},
        components: {
          schemas: {},
          securitySchemes: {}
        }
      };

      // Add security schemes if authentication is configured
      if (apiConfig.authentication && apiConfig.authentication.type !== 'none') {
        this.addSecuritySchemes(schema, apiConfig.authentication);
      }

      // Process each endpoint
      for (const endpoint of apiConfig.endpoints) {
        this.addEndpointToSchema(schema, endpoint, apiConfig);
      }

      // Add common response schemas
      this.addCommonSchemas(schema);

      // Validate the generated schema
      this.validateGeneratedSchema(schema);

      logger.info(`OpenAPI schema generated successfully with ${Object.keys(schema.paths).length} paths`);
      return schema;

    } catch (error) {
      logger.error('Error generating OpenAPI schema:', error);
      throw new Error(`Failed to generate OpenAPI schema: ${error.message}`);
    }
  }

  /**
   * Normalize base URL to ensure proper format
   * @param {string} baseUrl - Original base URL
   * @returns {string} Normalized base URL
   */
  normalizeBaseUrl(baseUrl) {
    // Remove trailing slash
    let normalized = baseUrl.replace(/\/$/, '');
    
    // Ensure it starts with http:// or https://
    if (!normalized.match(/^https?:\/\//)) {
      normalized = 'https://' + normalized;
    }
    
    return normalized;
  }

  /**
   * Add security schemes to the OpenAPI schema
   * @param {Object} schema - OpenAPI schema
   * @param {Object} authentication - Authentication configuration
   */
  addSecuritySchemes(schema, authentication) {
    switch (authentication.type) {
      case 'apiKey':
        schema.components.securitySchemes.ApiKeyAuth = {
          type: 'apiKey',
          in: authentication.location || 'header',
          name: authentication.name || 'X-API-Key',
          description: 'API Key authentication'
        };
        schema.security = [{ ApiKeyAuth: [] }];
        break;

      case 'bearer':
        schema.components.securitySchemes.BearerAuth = {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Bearer token authentication'
        };
        schema.security = [{ BearerAuth: [] }];
        break;

      case 'basic':
        schema.components.securitySchemes.BasicAuth = {
          type: 'http',
          scheme: 'basic',
          description: 'Basic HTTP authentication'
        };
        schema.security = [{ BasicAuth: [] }];
        break;
    }
  }

  /**
   * Add an endpoint to the OpenAPI schema
   * @param {Object} schema - OpenAPI schema
   * @param {Object} endpoint - Endpoint configuration
   * @param {Object} apiConfig - Full API configuration
   */
  addEndpointToSchema(schema, endpoint, apiConfig) {
    const path = this.normalizePath(endpoint.path);
    const method = endpoint.method.toLowerCase();

    // Initialize path if it doesn't exist
    if (!schema.paths[path]) {
      schema.paths[path] = {};
    }

    // Create operation object
    const operation = {
      summary: endpoint.description,
      description: endpoint.description,
      operationId: this.generateOperationId(endpoint.path, endpoint.method),
      tags: [apiConfig.apiName],
      parameters: [],
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: this.generateResponseSchema(endpoint.responseExample)
            }
          }
        },
        '400': {
          description: 'Bad Request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        '401': {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        '404': {
          description: 'Not Found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        '500': {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        }
      }
    };

    // Add parameters
    if (endpoint.parameters && endpoint.parameters.length > 0) {
      for (const param of endpoint.parameters) {
        operation.parameters.push(this.convertParameter(param));
      }
    }

    // Add request body for POST, PUT, PATCH methods
    if (['post', 'put', 'patch'].includes(method)) {
      operation.requestBody = this.generateRequestBody(endpoint);
    }

    // Add the operation to the schema
    schema.paths[path][method] = operation;
  }

  /**
   * Normalize API path for OpenAPI specification
   * @param {string} path - Original path
   * @returns {string} Normalized path
   */
  normalizePath(path) {
    // Ensure path starts with /
    let normalized = path.startsWith('/') ? path : '/' + path;
    
    // Convert {param} to OpenAPI format if needed (already in correct format)
    return normalized;
  }

  /**
   * Generate operation ID from path and method
   * @param {string} path - API path
   * @param {string} method - HTTP method
   * @returns {string} Operation ID
   */
  generateOperationId(path, method) {
    // Remove path parameters and special characters, then camelCase
    const cleanPath = path
      .replace(/[{}]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .split('_')
      .filter(part => part.length > 0)
      .map((part, index) => 
        index === 0 ? part.toLowerCase() : 
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      )
      .join('');

    const cleanMethod = method.toLowerCase();
    return `${cleanMethod}${cleanPath.charAt(0).toUpperCase()}${cleanPath.slice(1)}`;
  }

  /**
   * Convert parameter configuration to OpenAPI parameter
   * @param {Object} param - Parameter configuration
   * @returns {Object} OpenAPI parameter
   */
  convertParameter(param) {
    const openApiParam = {
      name: param.name,
      in: param.location,
      required: param.required || false,
      description: param.description || `${param.name} parameter`,
      schema: {
        type: param.type
      }
    };

    // Add format for specific types
    if (param.type === 'integer') {
      openApiParam.schema.format = 'int64';
    } else if (param.type === 'number') {
      openApiParam.schema.format = 'double';
    }

    // Add example if available
    if (param.example !== undefined) {
      openApiParam.example = param.example;
    }

    return openApiParam;
  }

  /**
   * Generate response schema from example response
   * @param {string|Object} responseExample - Response example
   * @returns {Object} OpenAPI schema
   */
  generateResponseSchema(responseExample) {
    if (!responseExample) {
      return {
        type: 'object',
        description: 'API response'
      };
    }

    try {
      // Parse JSON if it's a string
      const example = typeof responseExample === 'string' 
        ? JSON.parse(responseExample) 
        : responseExample;

      return this.inferSchemaFromExample(example);
    } catch (error) {
      logger.warn('Could not parse response example, using generic schema:', error.message);
      return {
        type: 'object',
        description: 'API response'
      };
    }
  }

  /**
   * Infer JSON schema from example data
   * @param {*} example - Example data
   * @returns {Object} JSON schema
   */
  inferSchemaFromExample(example) {
    if (example === null) {
      return { type: 'null' };
    }

    if (Array.isArray(example)) {
      return {
        type: 'array',
        items: example.length > 0 ? this.inferSchemaFromExample(example[0]) : { type: 'object' }
      };
    }

    if (typeof example === 'object') {
      const properties = {};
      const required = [];

      for (const [key, value] of Object.entries(example)) {
        properties[key] = this.inferSchemaFromExample(value);
        if (value !== null && value !== undefined) {
          required.push(key);
        }
      }

      const schema = {
        type: 'object',
        properties
      };

      if (required.length > 0) {
        schema.required = required;
      }

      return schema;
    }

    // Primitive types
    if (typeof example === 'string') {
      return { type: 'string', example };
    }
    if (typeof example === 'number') {
      return Number.isInteger(example) 
        ? { type: 'integer', example }
        : { type: 'number', example };
    }
    if (typeof example === 'boolean') {
      return { type: 'boolean', example };
    }

    return { type: 'string' };
  }

  /**
   * Generate request body schema for POST/PUT/PATCH methods
   * @param {Object} endpoint - Endpoint configuration
   * @returns {Object} OpenAPI request body
   */
  generateRequestBody(endpoint) {
    return {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: `Request body for ${endpoint.description}`,
            properties: {
              // Add properties based on parameters that might be in the body
              ...this.generateBodyPropertiesFromParameters(endpoint.parameters)
            }
          }
        }
      }
    };
  }

  /**
   * Generate body properties from parameters
   * @param {Array} parameters - Endpoint parameters
   * @returns {Object} Properties object
   */
  generateBodyPropertiesFromParameters(parameters = []) {
    const properties = {};
    
    // Add common properties that might be in request body
    parameters
      .filter(param => param.location === 'body' || param.location === 'form')
      .forEach(param => {
        properties[param.name] = {
          type: param.type,
          description: param.description
        };
      });

    // If no body parameters, add a generic data property
    if (Object.keys(properties).length === 0) {
      properties.data = {
        type: 'object',
        description: 'Request data'
      };
    }

    return properties;
  }

  /**
   * Add common schemas to the OpenAPI specification
   * @param {Object} schema - OpenAPI schema
   */
  addCommonSchemas(schema) {
    schema.components.schemas.Error = {
      type: 'object',
      required: ['error', 'message'],
      properties: {
        error: {
          type: 'string',
          description: 'Error type'
        },
        message: {
          type: 'string',
          description: 'Error message'
        },
        details: {
          type: 'object',
          description: 'Additional error details'
        }
      }
    };

    schema.components.schemas.Success = {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: {
          type: 'boolean',
          example: true
        },
        data: {
          type: 'object',
          description: 'Response data'
        },
        message: {
          type: 'string',
          description: 'Success message'
        }
      }
    };
  }

  /**
   * Validate the generated OpenAPI schema
   * @param {Object} schema - OpenAPI schema
   * @throws {Error} If schema is invalid
   */
  validateGeneratedSchema(schema) {
    // Basic validation checks
    if (!schema.openapi) {
      throw new Error('Missing openapi version');
    }

    if (!schema.info || !schema.info.title) {
      throw new Error('Missing API title');
    }

    if (!schema.paths || Object.keys(schema.paths).length === 0) {
      throw new Error('No paths defined');
    }

    // Validate each path
    for (const [path, pathItem] of Object.entries(schema.paths)) {
      if (!path.startsWith('/')) {
        throw new Error(`Path "${path}" must start with /`);
      }

      for (const [method, operation] of Object.entries(pathItem)) {
        if (!this.supportedMethods.map(m => m.toLowerCase()).includes(method)) {
          throw new Error(`Unsupported HTTP method: ${method}`);
        }

        if (!operation.operationId) {
          throw new Error(`Missing operationId for ${method.toUpperCase()} ${path}`);
        }
      }
    }

    logger.info('OpenAPI schema validation passed');
  }

  /**
   * Validate OpenAPI schema using external validator (placeholder)
   * @param {Object} schema - OpenAPI schema
   * @returns {Object} Validation result
   */
  async validateSchema(schema) {
    try {
      // Perform basic validation
      this.validateGeneratedSchema(schema);

      return {
        valid: true,
        errors: [],
        warnings: [],
        info: `Schema validation passed for ${Object.keys(schema.paths).length} endpoints`
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
        info: 'Schema validation failed'
      };
    }
  }

  /**
   * Convert OpenAPI schema to AWS Action Group format
   * @param {Object} schema - OpenAPI schema
   * @returns {Object} AWS Action Group compatible schema
   */
  convertToActionGroupFormat(schema) {
    // AWS Bedrock Action Groups expect the OpenAPI schema in a specific format
    // This might need additional transformations based on AWS requirements
    
    const actionGroupSchema = {
      ...schema,
      'x-amazon-bedrock-action-group': {
        version: '1.0',
        description: schema.info.description
      }
    };

    // Add any AWS-specific extensions or modifications here
    return actionGroupSchema;
  }

  /**
   * Generate example request/response for testing
   * @param {Object} endpoint - Endpoint configuration
   * @returns {Object} Test data
   */
  generateTestData(endpoint) {
    const testData = {
      endpoint: endpoint.path,
      method: endpoint.method,
      parameters: {},
      expectedResponse: null
    };

    // Generate test parameters
    if (endpoint.parameters) {
      endpoint.parameters.forEach(param => {
        testData.parameters[param.name] = this.generateTestValue(param.type);
      });
    }

    // Parse expected response
    if (endpoint.responseExample) {
      try {
        testData.expectedResponse = typeof endpoint.responseExample === 'string'
          ? JSON.parse(endpoint.responseExample)
          : endpoint.responseExample;
      } catch (error) {
        logger.warn('Could not parse response example for test data');
      }
    }

    return testData;
  }

  /**
   * Generate test value for parameter type
   * @param {string} type - Parameter type
   * @returns {*} Test value
   */
  generateTestValue(type) {
    switch (type) {
      case 'string':
        return 'test-value';
      case 'integer':
        return 123;
      case 'number':
        return 123.45;
      case 'boolean':
        return true;
      default:
        return 'test-value';
    }
  }

  /**
   * Get OpenAPI schema statistics
   * @param {Object} schema - OpenAPI schema
   * @returns {Object} Schema statistics
   */
  getSchemaStats(schema) {
    const stats = {
      totalPaths: Object.keys(schema.paths || {}).length,
      totalOperations: 0,
      operationsByMethod: {},
      hasAuthentication: !!(schema.security && schema.security.length > 0),
      totalSchemas: Object.keys(schema.components?.schemas || {}).length
    };

    // Count operations by method
    for (const pathItem of Object.values(schema.paths || {})) {
      for (const method of Object.keys(pathItem)) {
        stats.totalOperations++;
        stats.operationsByMethod[method.toUpperCase()] = 
          (stats.operationsByMethod[method.toUpperCase()] || 0) + 1;
      }
    }

    return stats;
  }
}

module.exports = new OpenApiGeneratorService();