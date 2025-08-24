/**
 * Generic Lambda Handler for Bedrock Action Groups
 * 
 * This is a template/reference implementation of the Lambda function
 * that gets automatically generated for each action group.
 * 
 * The actual code is generated dynamically in actionGroupService.js
 * based on the user's API configuration.
 */

const https = require('https');
const http = require('http');
const url = require('url');

// API Configuration (embedded during generation)
const API_CONFIG = {
  apiName: "Example API",
  baseUrl: "https://api.example.com",
  endpoints: [
    {
      path: "/orders/{orderId}",
      method: "GET",
      description: "Get order information by ID",
      parameters: [
        {
          name: "orderId",
          type: "string",
          location: "path",
          required: true,
          description: "The order ID to track"
        }
      ],
      responseExample: `{
        "orderId": "12345",
        "status": "shipped",
        "trackingNumber": "TRK123456"
      }`
    }
  ],
  authentication: {
    type: "apiKey",
    location: "header",
    name: "X-API-Key",
    value: "your-api-key-here"
  }
};

/**
 * Main Lambda handler function
 * Receives events from Bedrock Agent and makes API calls
 */
// Lambda Version: v3.0.0 - CORRECT API SCHEMA RESPONSE FORMAT!
const LAMBDA_VERSION = "v3.0.0-api-schema-response-format";

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log(`=== LAMBDA VERSION: ${LAMBDA_VERSION} ===`);
  console.log(`=== COLD START INFO: remainingTimeInMillis=${context.getRemainingTimeInMillis()}, functionVersion=${context.functionVersion} ===`);
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract information from Bedrock agent event
    const { actionGroup, apiPath, httpMethod, parameters, inputText } = event;
    
    // Log ALL event properties to understand what Bedrock actually sends
    console.log('=== COMPLETE EVENT ANALYSIS ===');
    console.log('Available event properties:', Object.keys(event));
    for (const [key, value] of Object.entries(event)) {
      console.log(`${key}:`, typeof value === 'object' ? JSON.stringify(value) : value);
    }
    
    // Specifically look for any field that might contain the full operationId
    const possibleOperationIdFields = [
      'operationId', 'function', 'functionName', 'toolName', 'action', 'operation',
      'requestId', 'invocationId', 'toolUse', 'tool', 'methodName'
    ];
    
    console.log('=== SEARCHING FOR OPERATION ID ===');
    possibleOperationIdFields.forEach(field => {
      if (event[field] !== undefined) {
        console.log(`Found ${field}:`, event[field]);
      }
    });
    
    // Check if any nested objects contain operation info
    if (event.agent && typeof event.agent === 'object') {
      console.log('Agent object details:', JSON.stringify(event.agent, null, 2));
    }
    
    console.log('=== END EVENT ANALYSIS ===');
    
    // Look for the operation ID in various possible fields
    const operationId = event.operationId || event.function || event.functionName || event.toolName;
    console.log('OperationId found:', operationId);
    
    // If we don't have an operationId, generate it from apiPath and httpMethod
    let actualOperationId = operationId;
    
    if (!operationId && apiPath && httpMethod) {
      // Generate operationId the same way we do in OpenAPI schema generation
      const basicOperationId = generateOperationIdFromPath(apiPath, httpMethod);
      
      // Try different formats that Bedrock might expect
      const formats = [
        basicOperationId, // "getProductsProductid"
        `${httpMethod}::${actionGroup}::${basicOperationId}`, // "GET::Product_Catalog_Service_ActionGroup::getProductsProductid"
        `${httpMethod.toUpperCase()}::${actionGroup}::${basicOperationId}`, // Same with uppercase
        apiPath // fallback to original path
      ];
      
      console.log('Generated operation formats:', formats);
      
      // Let's try just the basic operationId that matches the OpenAPI schema
      actualOperationId = basicOperationId; // Use: "getProductsProductid" (matches OpenAPI)
      console.log('Selected operationId (BASIC - MATCHES OPENAPI):', actualOperationId);
    } else if (operationId && operationId.includes('::')) {
      // Format: "GET::Product_Catalog_Service_ActionGroup::getProductsProductid"
      const parts = operationId.split('::');
      actualOperationId = parts[parts.length - 1]; // Get the last part: "getProductsProductid"
      console.log('Extracted operation name:', actualOperationId);
    }
    
    console.log('Final actualOperationId to return:', actualOperationId);
    
    // Convert parameters array to object
    const params = {};
    if (parameters && Array.isArray(parameters)) {
      parameters.forEach(param => {
        params[param.name] = param.value;
      });
    }
    
    console.log('Extracted parameters:', params);
    console.log('API Path:', apiPath);
    console.log('HTTP Method:', httpMethod);
    
    // Find matching endpoint configuration using apiPath and httpMethod
    const endpoint = findMatchingEndpointByPath(apiPath, httpMethod, params);
    if (!endpoint) {
      throw new Error(`No matching endpoint found for path: ${apiPath} ${httpMethod}`);
    }
    
    console.log('Matched endpoint:', endpoint.path, endpoint.method);
    
    // Build API URL
    const apiUrl = buildApiUrl(endpoint, params);
    console.log('Built API URL:', apiUrl);
    
    // Make API call
    const apiResponse = await makeApiCall(apiUrl, endpoint.method, params, endpoint);
    console.log('API response received:', apiResponse.statusCode);
    console.log('API response data:', JSON.stringify(apiResponse.data));
    
    // Format response for Bedrock Agent
    const formattedResponse = formatResponseForAgent(apiResponse, endpoint, apiPath);
    console.log('Formatted response:', formattedResponse);
    
    const executionTime = Date.now() - startTime;
    console.log(`=== EXECUTION COMPLETED: ${executionTime}ms ===`);
    
    // AWS Bedrock expects specific response format for API Schema (not function details)
    const finalResponse = {
      messageVersion: "1.0",
      response: {
        actionGroup: actionGroup,
        apiPath: apiPath,              // Return the original apiPath
        httpMethod: httpMethod,        // Return the original httpMethod  
        httpStatusCode: 200,           // Success status code
        responseBody: {
          'application/json': {        // Content type for API response
            body: JSON.stringify({     // API response should be JSON string
              data: formattedResponse,
              success: true,
              executionTimeMs: executionTime // Add timing info for debugging
            })
          }
        }
      }
    };
    
    console.log('Response function field will be:', actualOperationId || operationId || apiPath);
    
    console.log('Final Lambda response:', JSON.stringify(finalResponse));
    return finalResponse;
    
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('Error processing request:', error);
    console.log(`=== EXECUTION FAILED: ${executionTime}ms ===`);
    
    return {
      messageVersion: "1.0",
      response: {
        actionGroup: event.actionGroup || 'unknown',
        apiPath: event.apiPath || 'unknown',
        httpMethod: event.httpMethod || 'unknown',
        httpStatusCode: 500,
        responseBody: {
          'application/json': {
            body: JSON.stringify({
              error: error.message,
              success: false,
              executionTimeMs: executionTime // Add timing info even for errors
            })
          }
        }
      }
    };
  }
};

/**
 * Find the endpoint that matches the API path and HTTP method from Bedrock
 * @param {string} apiPath - The API path from Bedrock (e.g., "/products/{orderId}")
 * @param {string} httpMethod - The HTTP method from Bedrock (e.g., "GET")
 * @param {Object} params - Parameters from Bedrock
 * @returns {Object} Matching endpoint configuration
 */
function findMatchingEndpointByPath(apiPath, httpMethod, params) {
  console.log('Looking for endpoint matching path:', apiPath, 'method:', httpMethod);
  
  // Direct path and method matching
  for (const endpoint of API_CONFIG.endpoints) {
    if (endpoint.path === apiPath && endpoint.method.toUpperCase() === httpMethod.toUpperCase()) {
      console.log('Found exact match by path and method');
      return endpoint;
    }
  }
  
  // Fallback: try to match path patterns (handling parameter substitution)
  for (const endpoint of API_CONFIG.endpoints) {
    if (endpoint.method.toUpperCase() === httpMethod.toUpperCase()) {
      // Check if paths match with parameter substitution
      const pathPattern = endpoint.path.replace(/\{[^}]+\}/g, '[^/]+');
      const regex = new RegExp(`^${pathPattern}$`);
      
      if (regex.test(apiPath)) {
        console.log('Found match by path pattern and method');
        return endpoint;
      }
    }
  }
  
  // Ultimate fallback: return first endpoint that matches method
  for (const endpoint of API_CONFIG.endpoints) {
    if (endpoint.method.toUpperCase() === httpMethod.toUpperCase()) {
      console.log('Found match by HTTP method only');
      return endpoint;
    }
  }
  
  // Last resort: return first endpoint
  console.log('Using first endpoint as fallback');
  return API_CONFIG.endpoints[0] || null;
}

/**
 * Find the endpoint that matches the function name (legacy)
 * Uses intelligent matching to map Bedrock function names to API endpoints
 */
function findMatchingEndpoint(functionName, params) {
  console.log('Looking for endpoint matching function:', functionName);
  
  // First, try exact operation ID matching
  for (const endpoint of API_CONFIG.endpoints) {
    const operationId = generateOperationId(endpoint.path, endpoint.method);
    if (operationId === functionName) {
      console.log('Found exact match by operation ID');
      return endpoint;
    }
  }
  
  // Fallback: intelligent path matching
  for (const endpoint of API_CONFIG.endpoints) {
    const normalizedPath = endpoint.path
      .replace(/[{}]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();
    
    const normalizedFunction = functionName.toLowerCase();
    
    // Check if function name contains path elements
    if (normalizedFunction.includes(normalizedPath) || 
        normalizedPath.includes(normalizedFunction.replace(/^(get|post|put|delete|patch)/, ''))) {
      console.log('Found match by path similarity');
      return endpoint;
    }
  }
  
  // Final fallback: return first endpoint that matches HTTP method
  const methodFromFunction = extractMethodFromFunction(functionName);
  for (const endpoint of API_CONFIG.endpoints) {
    if (endpoint.method.toLowerCase() === methodFromFunction) {
      console.log('Found match by HTTP method');
      return endpoint;
    }
  }
  
  // Ultimate fallback: return first endpoint
  console.log('Using first endpoint as fallback');
  return API_CONFIG.endpoints[0];
}

/**
 * Generate operation ID from path and method (matches OpenAPI generation)
 */
function generateOperationId(path, method) {
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
 * Extract HTTP method from function name
 */
function extractMethodFromFunction(functionName) {
  const lowerName = functionName.toLowerCase();
  if (lowerName.startsWith('get')) return 'get';
  if (lowerName.startsWith('post') || lowerName.startsWith('create')) return 'post';
  if (lowerName.startsWith('put') || lowerName.startsWith('update')) return 'put';
  if (lowerName.startsWith('delete') || lowerName.startsWith('remove')) return 'delete';
  if (lowerName.startsWith('patch')) return 'patch';
  return 'get'; // default
}

/**
 * Build the complete API URL with parameters
 */
function buildApiUrl(endpoint, params) {
  let url = API_CONFIG.baseUrl + endpoint.path;
  
  // Replace path parameters
  for (const [key, value] of Object.entries(params)) {
    const paramPattern = `{${key}}`;
    if (url.includes(paramPattern)) {
      url = url.replace(paramPattern, encodeURIComponent(value));
    }
  }
  
  // Add query parameters
  const queryParams = [];
  if (endpoint.parameters) {
    endpoint.parameters
      .filter(p => p.location === 'query' && params[p.name] !== undefined)
      .forEach(p => {
        queryParams.push(`${p.name}=${encodeURIComponent(params[p.name])}`);
      });
  }
  
  if (queryParams.length > 0) {
    url += (url.includes('?') ? '&' : '?') + queryParams.join('&');
  }
  
  return url;
}

/**
 * Make HTTP request to the target API
 */
async function makeApiCall(apiUrl, method, params, endpoint) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(apiUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Oralia-AI-Agent/1.0',
        'Accept': 'application/json'
      }
    };
    
    // Add authentication headers (may also modify URL for query-based auth)
    apiUrl = addAuthenticationHeaders(options.headers, apiUrl);
    
    // Re-parse URL in case it was modified for query authentication
    const updatedUrl = url.parse(apiUrl);
    options.path = updatedUrl.path;
    
    // Add custom headers from parameters
    if (endpoint.parameters) {
      endpoint.parameters
        .filter(p => p.location === 'header' && params[p.name] !== undefined)
        .forEach(p => {
          options.headers[p.name] = params[p.name];
        });
    }
    
    console.log('Making request with options:', {
      url: apiUrl,
      method: options.method,
      headers: Object.keys(options.headers)
    });
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          let responseData;
          
          // Try to parse as JSON
          try {
            responseData = JSON.parse(data);
          } catch (parseError) {
            responseData = data; // Keep as string if not JSON
          }
          
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: responseData
          });
        } catch (error) {
          reject(new Error(`Error processing response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
    
    // Increased timeout to handle cold starts and slow external APIs
    const timeoutMs = process.env.LAMBDA_HTTP_TIMEOUT_MS || 30000; // 30 seconds default
    req.setTimeout(timeoutMs, () => {
      req.abort();
      reject(new Error(`Request timeout after ${timeoutMs/1000} seconds`));
    });
    
    // Add request body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      const requestBody = buildRequestBody(params, endpoint);
      if (requestBody) {
        req.write(JSON.stringify(requestBody));
      }
    }
    
    req.end();
  });
}

/**
 * Add authentication headers based on configuration
 */
function addAuthenticationHeaders(headers, apiUrl) {
  if (!API_CONFIG.authentication || API_CONFIG.authentication.type === 'none') {
    return apiUrl;
  }
  
  const auth = API_CONFIG.authentication;
  console.log('Adding authentication:', auth.type);
  
  switch (auth.type) {
    case 'apiKey':
      if (auth.location === 'header') {
        headers[auth.name] = auth.value;
        console.log(`Added API key to header: ${auth.name}`);
      } else if (auth.location === 'query') {
        // Add to URL query parameters
        const urlObj = new URL(apiUrl);
        urlObj.searchParams.set(auth.name, auth.value);
        console.log(`Added API key to query: ${auth.name}`);
        return urlObj.toString();
      }
      break;
      
    case 'bearer':
      // Ensure proper Bearer format - if token doesn't start with 'Bearer ', add it
      const token = auth.value;
      const bearerToken = token && token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
      headers['Authorization'] = bearerToken;
      console.log('Added Bearer token to Authorization header');
      break;
      
    case 'basic':
      // Basic authentication - expect username:password format
      let credentials;
      if (auth.value.includes(':')) {
        // Already in username:password format
        credentials = Buffer.from(auth.value).toString('base64');
      } else {
        // Assume it's already base64 encoded
        credentials = auth.value;
      }
      headers['Authorization'] = `Basic ${credentials}`;
      console.log('Added Basic auth to Authorization header');
      break;
  }
  
  return apiUrl;
}

/**
 * Build request body for POST/PUT/PATCH requests
 */
function buildRequestBody(params, endpoint) {
  const bodyParams = {};
  
  if (endpoint.parameters) {
    // Include parameters that are not path, query, or header
    endpoint.parameters
      .filter(p => !['path', 'query', 'header'].includes(p.location) && params[p.name] !== undefined)
      .forEach(p => {
        bodyParams[p.name] = params[p.name];
      });
  }
  
  // If no specific body parameters, include all non-path/query/header params
  if (Object.keys(bodyParams).length === 0) {
    const reservedParams = new Set();
    
    if (endpoint.parameters) {
      endpoint.parameters
        .filter(p => ['path', 'query', 'header'].includes(p.location))
        .forEach(p => reservedParams.add(p.name));
    }
    
    for (const [key, value] of Object.entries(params)) {
      if (!reservedParams.has(key)) {
        bodyParams[key] = value;
      }
    }
  }
  
  return Object.keys(bodyParams).length > 0 ? bodyParams : null;
}

/**
 * Format the API response for the Bedrock Agent
 */
function formatResponseForAgent(apiResponse, endpoint, functionName) {
  if (apiResponse.statusCode < 200 || apiResponse.statusCode >= 300) {
    return formatErrorResponse(apiResponse, endpoint);
  }
  
  const data = apiResponse.data;
  
  // Handle different response types
  if (typeof data === 'string') {
    return data;
  }
  
  if (typeof data === 'object' && data !== null) {
    return formatObjectResponse(data, endpoint, functionName);
  }
  
  return JSON.stringify(data);
}

/**
 * Format error responses in a user-friendly way
 */
function formatErrorResponse(apiResponse, endpoint) {
  const statusCode = apiResponse.statusCode;
  const data = apiResponse.data;
  
  let errorMessage = `API request failed with status ${statusCode}`;
  
  if (data) {
    if (typeof data === 'object') {
      // Extract error message from common error response formats
      const errorText = data.error || data.message || data.detail || 
                       (data.errors && data.errors[0]) || JSON.stringify(data);
      errorMessage += `: ${errorText}`;
    } else {
      errorMessage += `: ${data}`;
    }
  }
  
  // Provide user-friendly messages for common status codes
  switch (statusCode) {
    case 400:
      return `I couldn't process that request because some information was missing or invalid. ${errorMessage}`;
    case 401:
      return `I don't have permission to access that information. Please check the authentication settings.`;
    case 403:
      return `Access to that resource is forbidden. You may not have the necessary permissions.`;
    case 404:
      return `I couldn't find the requested information. Please check if the ID or reference is correct.`;
    case 429:
      return `The service is currently busy. Please try again in a few moments.`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `The service is temporarily unavailable. Please try again later.`;
    default:
      return errorMessage;
  }
}

/**
 * Format object responses in a natural, readable way
 */
function formatObjectResponse(data, endpoint, functionName) {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return "No results found.";
    }
    
    if (data.length === 1) {
      return formatSingleObject(data[0], endpoint);
    }
    
    return formatArrayResponse(data, endpoint);
  }
  
  return formatSingleObject(data, endpoint);
}

/**
 * Format a single object response
 */
function formatSingleObject(obj, endpoint) {
  const formatted = [];
  
  // Handle common object structures
  if (obj.id || obj.orderId || obj.customerId) {
    const id = obj.id || obj.orderId || obj.customerId;
    formatted.push(`ID: ${id}`);
  }
  
  if (obj.status) {
    formatted.push(`Status: ${obj.status}`);
  }
  
  if (obj.name || obj.title) {
    const name = obj.name || obj.title;
    formatted.push(`Name: ${name}`);
  }
  
  // Add other important fields
  for (const [key, value] of Object.entries(obj)) {
    if (['id', 'orderId', 'customerId', 'status', 'name', 'title'].includes(key)) {
      continue; // Already handled
    }
    
    if (typeof value === 'object' && value !== null) {
      formatted.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      formatted.push(`${key}: ${value}`);
    }
  }
  
  return formatted.length > 0 ? formatted.join(', ') : JSON.stringify(obj);
}

/**
 * Format array responses
 */
function formatArrayResponse(array, endpoint) {
  const itemCount = array.length;
  const maxItemsToShow = 5;
  
  let response = `Found ${itemCount} result${itemCount !== 1 ? 's' : ''}:\n\n`;
  
  const itemsToShow = array.slice(0, maxItemsToShow);
  
  itemsToShow.forEach((item, index) => {
    response += `${index + 1}. ${formatSingleObject(item, endpoint)}\n`;
  });
  
  if (itemCount > maxItemsToShow) {
    response += `\n... and ${itemCount - maxItemsToShow} more result${itemCount - maxItemsToShow !== 1 ? 's' : ''}`;
  }
  
  return response;
}

/**
 * Utility function to safely get nested object properties
 */
function getNestedProperty(obj, path) {
  return path.split('.').reduce((current, key) => current && current[key], obj);
}

/**
 * Validate required parameters are present
 */
function validateRequiredParameters(params, endpoint) {
  if (!endpoint.parameters) {
    return true;
  }
  
  const missingRequired = endpoint.parameters
    .filter(p => p.required && (params[p.name] === undefined || params[p.name] === ''))
    .map(p => p.name);
  
  if (missingRequired.length > 0) {
    throw new Error(`Missing required parameters: ${missingRequired.join(', ')}`);
  }
  
  return true;
}

/**
 * Generate operationId from API path and HTTP method
 * This matches the exact logic used in OpenAPI schema generation
 */
function generateOperationIdFromPath(path, method) {
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

// Export utility functions for testing
module.exports = {
  handler: exports.handler,
  findMatchingEndpoint,
  buildApiUrl,
  formatResponseForAgent,
  validateRequiredParameters,
  generateOperationIdFromPath
};