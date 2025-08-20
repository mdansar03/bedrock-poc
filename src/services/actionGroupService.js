const {
  BedrockAgentClient,
  CreateAgentActionGroupCommand,
  GetAgentActionGroupCommand,
  UpdateAgentActionGroupCommand,
  DeleteAgentActionGroupCommand,
  ListAgentActionGroupsCommand,
  PrepareAgentCommand,
  GetAgentCommand,
  CreateAgentAliasCommand,
  ListAgentAliasesCommand,
} = require("@aws-sdk/client-bedrock-agent");
const {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime");
const {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  GetFunctionCommand,
  InvokeFunctionCommand,
  AddPermissionCommand,
} = require("@aws-sdk/client-lambda");
const {
  IAMClient,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  GetRoleCommand,
} = require("@aws-sdk/client-iam");
const openApiGeneratorService = require("./openApiGeneratorService");
const logger = require("../utils/logger");
const crypto = require("crypto");

/**
 * Action Group Service
 * Manages automated creation and management of AWS Bedrock Action Groups
 */
class ActionGroupService {
  constructor() {
    this.bedrockAgentClient = new BedrockAgentClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.bedrockRuntimeClient = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.iamClient = new IAMClient({
      region: process.env.AWS_REGION || "us-east-1",
    });

    this.agentId = process.env.BEDROCK_AGENT_ID;
    if (!this.agentId) {
      logger.warn(
        "BEDROCK_AGENT_ID not configured. Some action group features may not work."
      );
    }

    // In-memory storage for action group metadata and execution history
    this.actionGroups = new Map();
    this.executionHistory = new Map();
  }

  /**
   * Create a new action group with automated Lambda function and OpenAPI schema
   * @param {Object} apiConfig - User-provided API configuration
   * @param {Object} openApiSchema - Generated OpenAPI schema
   * @returns {Object} Created action group details
   */
  async createActionGroup(apiConfig, openApiSchema) {
    try {
      logger.info(`Creating action group for: ${apiConfig.apiName}`);

      // Step 1: Create or update Lambda function for API handling
      const lambdaFunction = await this.createLambdaFunction(apiConfig);

      // Step 2: Generate action group name
      const actionGroupName = this.generateActionGroupName(apiConfig.apiName);

      // Step 3: Create action group in Bedrock
      const createCommand = new CreateAgentActionGroupCommand({
        agentId: this.agentId,
        agentVersion: "DRAFT",
        actionGroupName: actionGroupName,
        description: `Auto-generated action group for ${apiConfig.apiName}`,
        actionGroupExecutor: {
          lambda: lambdaFunction.functionArn,
        },
        apiSchema: {
          payload: JSON.stringify(openApiSchema),
        },
        actionGroupState: "ENABLED",
      });

      const response = await this.bedrockAgentClient.send(createCommand);
      logger.info(
        "Bedrock action group creation response:",
        JSON.stringify(response, null, 2)
      );

      const actionGroup =
        response.agentActionGroup ||
        response.actionGroup ||
        response.AgentActionGroup ||
        response;
      if (!actionGroup) {
        logger.error("No action group data in response:", response);
        throw new Error(
          "Invalid response from Bedrock - no action group data found"
        );
      }
      const actionGroupId =
        actionGroup.actionGroupId ||
        actionGroup.ActionGroupId ||
        actionGroup.id;
      if (!actionGroupId) {
        logger.error(
          "No action group ID found in response. ActionGroup object:",
          JSON.stringify(actionGroup, null, 2)
        );
        throw new Error(
          "Invalid response from Bedrock - no action group ID found"
        );
      }

      // Step 4: Store API configuration for Lambda function
      await this.storeApiConfiguration(actionGroupId, apiConfig);

      // Step 5: Prepare agent with new action group
      await this.prepareAgent();
      logger.info("Waiting for agent preparation to complete...");
      await new Promise((resolve) => setTimeout(resolve, 30000));

      // Step 6: Create Alias if aliasName is provided
      let aliasResult = null;
      if (
        apiConfig.aliasName &&
        typeof apiConfig.aliasName === "string" &&
        apiConfig.aliasName.trim()
      ) {
        try {
          logger.info(
            `Creating alias "${apiConfig.aliasName}" for agent ${this.agentId}...`
          );
          const aliasCommand = new CreateAgentAliasCommand({
            agentId: this.agentId,
            agentAliasName: apiConfig.aliasName.trim(),
            description: `Alias for action group ${actionGroupName}`,
            // FIXED: Removed routingConfiguration entirely - AWS will handle this automatically
          });
          const aliasResponse = await this.bedrockAgentClient.send(
            aliasCommand
          );
          logger.info(
            "Alias created successfully:",
            aliasResponse.agentAlias?.agentAliasId
          );
          aliasResult = {
            aliasId: aliasResponse.agentAlias?.agentAliasId,
            aliasName: aliasResponse.agentAlias?.agentAliasName,
            status: aliasResponse.agentAlias?.agentAliasStatus,
            createdAt: aliasResponse.agentAlias?.createdAt,
          };
        } catch (aliasError) {
          logger.error("Failed to create alias:", aliasError);
          // Optionally: throw or just log and continue
          aliasResult = { error: aliasError.message };
        }
      }

      logger.info(`Action group created successfully: ${actionGroupId}`);

      return {
        actionGroupId: actionGroupId,
        actionGroupName:
          actionGroup.actionGroupName ||
          actionGroup.ActionGroupName ||
          apiConfig.apiName,
        status:
          actionGroup.actionGroupState ||
          actionGroup.ActionGroupState ||
          "ENABLED",
        lambdaFunction: {
          functionName: lambdaFunction.functionName,
          functionArn: lambdaFunction.functionArn,
        },
        agentStatus: "PREPARED",
        createdAt:
          actionGroup.createdAt ||
          actionGroup.CreatedAt ||
          new Date().toISOString(),
        openApiSchema: openApiSchema,
        alias: aliasResult,
      };
    } catch (error) {
      logger.error("Error creating action group:", error);
      throw new Error(`Failed to create action group: ${error.message}`);
    }
  }

  /**
   * Create or update Lambda function for API handling
   * @param {Object} apiConfig - API configuration
   * @returns {Object} Lambda function details
   */
  async createLambdaFunction(apiConfig) {
    const functionName = this.generateLambdaFunctionName(apiConfig.apiName);

    try {
      // Check if function already exists
      const getCommand = new GetFunctionCommand({ FunctionName: functionName });
      const existingFunction = await this.lambdaClient.send(getCommand);

      // Update existing function
      logger.info(`Updating existing Lambda function: ${functionName}`);

      try {
        const zipFile = await this.generateLambdaCode(apiConfig);
        logger.info(
          `Generated new Lambda code, ZIP size: ${zipFile.length} bytes`
        );

        const updateCommand = new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ZipFile: zipFile,
        });

        const updateResult = await this.lambdaClient.send(updateCommand);
        logger.info(
          `Lambda function updated successfully. New version: ${updateResult.Version}`
        );

        // Wait a moment for the update to propagate
        logger.info("Waiting for Lambda update to propagate...");
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second wait
      } catch (updateError) {
        logger.error(
          `Failed to update Lambda function ${functionName}:`,
          updateError.message
        );
        throw new Error(`Lambda update failed: ${updateError.message}`);
      }

      // Ensure Bedrock has permission to invoke the function (in case it was missing)
      await this.grantBedrockInvokePermission(
        functionName,
        existingFunction.Configuration.FunctionArn
      );

      return {
        functionName: functionName,
        functionArn: existingFunction.Configuration.FunctionArn,
      };
    } catch (error) {
      if (error.name === "ResourceNotFoundException") {
        // Create new function
        logger.info(`Creating new Lambda function: ${functionName}`);
        return await this.createNewLambdaFunction(functionName, apiConfig);
      } else if (
        error.name === "AccessDeniedException" ||
        error.message.includes("not authorized")
      ) {
        // Handle permission errors gracefully
        logger.error("Lambda permissions error:", error.message);
        throw new Error(`Insufficient Lambda permissions. Please ensure your AWS user has the following permissions:
- lambda:GetFunction
- lambda:CreateFunction
- lambda:UpdateFunctionCode
- lambda:UpdateFunctionConfiguration
- iam:CreateRole
- iam:AttachRolePolicy
- iam:PassRole

Current error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Create a new Lambda function
   * @param {string} functionName - Function name
   * @param {Object} apiConfig - API configuration
   * @returns {Object} Lambda function details
   */
  async createNewLambdaFunction(functionName, apiConfig) {
    // Create IAM role for Lambda function
    const roleName = `${functionName}-execution-role`;
    const role = await this.createLambdaExecutionRole(roleName);

    const createCommand = new CreateFunctionCommand({
      FunctionName: functionName,
      Runtime: "nodejs18.x",
      Role: role.arn,
      Handler: "index.handler",
      Code: {
        ZipFile: await this.generateLambdaCode(apiConfig),
      },
      Description: `Auto-generated Lambda function for ${apiConfig.apiName}`,
      Timeout: 30,
      MemorySize: 256,
      Environment: {
        Variables: {
          API_BASE_URL: apiConfig.baseUrl,
          API_NAME: apiConfig.apiName,
          API_CONFIG: JSON.stringify(apiConfig),
        },
      },
      Tags: {
        Project: "Oralia-ActionGroups",
        ApiName: apiConfig.apiName,
      },
    });

    // Retry Lambda creation with exponential backoff
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `Creating Lambda function: ${functionName} (attempt ${attempt}/${maxRetries})`
        );
        const response = await this.lambdaClient.send(createCommand);

        logger.info(
          `Successfully created Lambda function: ${response.FunctionArn}`
        );

        // Grant Bedrock permission to invoke the Lambda function
        await this.grantBedrockInvokePermission(
          functionName,
          response.FunctionArn
        );

        return {
          functionName: functionName,
          functionArn: response.FunctionArn,
        };
      } catch (error) {
        lastError = error;

        if (
          error.message &&
          error.message.includes("cannot be assumed by Lambda")
        ) {
          if (attempt < maxRetries) {
            const waitTime = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s
            logger.warn(
              `Lambda creation failed (role assumption issue), retrying in ${
                waitTime / 1000
              }s... (attempt ${attempt}/${maxRetries})`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        }

        // If it's not a role assumption error, don't retry
        break;
      }
    }

    // If we get here, all retries failed
    throw new Error(
      `Failed to create Lambda function after ${maxRetries} attempts. Last error: ${lastError.message}`
    );
  }

  /**
   * Create IAM execution role for Lambda function
   * @param {string} roleName - Role name
   * @returns {Object} IAM role
   */
  async createLambdaExecutionRole(roleName) {
    try {
      // Check if role exists
      const getCommand = new GetRoleCommand({ RoleName: roleName });
      const existingRole = await this.iamClient.send(getCommand);
      logger.info(`Using existing IAM role: ${roleName}`);
      return { arn: existingRole.Role.Arn };
    } catch (error) {
      if (error.name === "NoSuchEntityException") {
        logger.info(`Creating new IAM role: ${roleName}`);

        // Create new role with proper trust policy
        const assumeRolePolicyDocument = {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "lambda.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        };

        const createRoleCommand = new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument),
          Description:
            "Execution role for auto-generated action group Lambda function",
          Tags: [
            {
              Key: "Project",
              Value: "Oralia-ActionGroups",
            },
            {
              Key: "Purpose",
              Value: "Lambda-Execution",
            },
          ],
        });

        const roleResponse = await this.iamClient.send(createRoleCommand);
        logger.info(`Created IAM role: ${roleResponse.Role.Arn}`);

        // Attach basic Lambda execution policy
        const attachPolicyCommand = new AttachRolePolicyCommand({
          RoleName: roleName,
          PolicyArn:
            "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        });

        await this.iamClient.send(attachPolicyCommand);
        logger.info(`Attached execution policy to role: ${roleName}`);

        // Wait for role to propagate (AWS eventual consistency)
        logger.info("Waiting for IAM role to propagate...");
        await this.waitForRoleAvailability(roleName, 30000); // 30 seconds max

        return { arn: roleResponse.Role.Arn };
      }
      throw error;
    }
  }

  /**
   * Grant Bedrock service permission to invoke Lambda function
   * @param {string} functionName - Lambda function name
   * @param {string} functionArn - Lambda function ARN
   */
  async grantBedrockInvokePermission(functionName, functionArn) {
    try {
      // Generate a unique statement ID
      const statementId = `bedrock-invoke-${Date.now()}`;

      const addPermissionCommand = new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: statementId,
        Action: "lambda:InvokeFunction",
        Principal: "bedrock.amazonaws.com",
        SourceArn: `arn:aws:bedrock:${
          process.env.AWS_REGION
        }:${this.getAccountId()}:agent/${this.agentId}`,
      });

      await this.lambdaClient.send(addPermissionCommand);
      logger.info(
        `Granted Bedrock permission to invoke Lambda function: ${functionName}`
      );
    } catch (error) {
      if (error.name === "ResourceConflictException") {
        // Permission already exists
        logger.info(
          `Bedrock permission already exists for Lambda function: ${functionName}`
        );
      } else {
        logger.error(
          `Failed to grant Bedrock permission for Lambda function ${functionName}:`,
          error.message
        );
        // Don't throw error - this is not critical for basic functionality
        // The user can manually add permissions if needed
      }
    }
  }

  /**
   * Get AWS account ID from current context
   * @returns {string} Account ID
   */
  getAccountId() {
    // Extract account ID from existing environment or agent configuration
    // This is a simplified approach - in production, you might want to use STS to get caller identity
    const region = process.env.AWS_REGION || "us-east-1";

    // Try to extract from agent service role if available
    if (process.env.BEDROCK_AGENT_SERVICE_ROLE) {
      const match =
        process.env.BEDROCK_AGENT_SERVICE_ROLE.match(/arn:aws:iam::(\d+):/);
      console.log("match===>", match);
      if (match) {
        return match[1];
      }
    }

    // Fallback: assume account ID can be extracted from agent ID context
    // In a real implementation, you might want to use AWS STS GetCallerIdentity
    return "288704464456"; // Your account ID from the error message
  }

  /**
   * Wait for IAM role to be available for Lambda to assume
   * @param {string} roleName - Role name
   * @param {number} maxWaitTime - Maximum wait time in milliseconds
   */
  async waitForRoleAvailability(roleName, maxWaitTime = 30000) {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < maxWaitTime) {
      attempt++;
      try {
        // Try to get the role - if it's available, this should succeed consistently
        const getCommand = new GetRoleCommand({ RoleName: roleName });
        await this.iamClient.send(getCommand);

        // Additional check: simulate what Lambda service does
        // Wait a bit more to ensure role is fully propagated
        if (attempt < 3) {
          logger.info(`Role availability check ${attempt}/3 - waiting...`);
          await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
          continue;
        }

        logger.info(`IAM role ${roleName} is ready for use`);
        return;
      } catch (error) {
        if (Date.now() - startTime >= maxWaitTime) {
          throw new Error(
            `Timeout waiting for IAM role ${roleName} to become available`
          );
        }
        logger.info(
          `Waiting for role ${roleName} to be available... (attempt ${attempt})`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      }
    }
  }

  /**
   * Generate Lambda function code for API handling
   * @param {Object} apiConfig - API configuration
   * @returns {Buffer} ZIP file buffer containing Lambda code
   */
  async generateLambdaCode(apiConfig) {
    const lambdaCode = this.generateLambdaCodeString(apiConfig);
    const AdmZip = require("adm-zip");

    const zip = new AdmZip();
    zip.addFile("index.js", Buffer.from(lambdaCode, "utf8"));

    return zip.toBuffer();
  }

  /**
   * Generate Lambda function code as string
   * @param {Object} apiConfig - API configuration
   * @returns {string} Lambda function code
   */
  generateLambdaCodeString(apiConfig) {
    const fs = require("fs");
    const path = require("path");

    // Read the template file
    const templatePath = path.join(
      __dirname,
      "../../lambda-templates/generic-api-handler.js"
    );
    let lambdaTemplate;

    try {
      lambdaTemplate = fs.readFileSync(templatePath, "utf8");
      logger.info(`Successfully read Lambda template from: ${templatePath}`);
      logger.info(`Template file size: ${lambdaTemplate.length} characters`);
    } catch (error) {
      logger.error(
        `Failed to read template file from ${templatePath}:`,
        error.message
      );
      logger.warn("Template file not found, using embedded code");
      // Fallback to embedded code with fixes
      return `
const https = require('https');
const http = require('http');
const url = require('url');

// API Configuration embedded in function
const API_CONFIG = ${JSON.stringify(apiConfig, null, 2)};

exports.handler = async (event, context) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    try {
        // Extract information from Bedrock agent event
        // Bedrock sends: actionGroup, apiPath, httpMethod, parameters, inputText
        const { actionGroup, apiPath, httpMethod, parameters, inputText } = event;
        
        // Extract parameters
        const params = {};
        if (parameters && Array.isArray(parameters)) {
            parameters.forEach(param => {
                params[param.name] = param.value;
            });
        }
        
        console.log('Extracted parameters:', params);
        console.log('API Path:', apiPath);
        console.log('HTTP Method:', httpMethod);
        
        // Find matching endpoint by path and method
        const endpoint = findMatchingEndpointByPath(apiPath, httpMethod, params);
        if (!endpoint) {
            throw new Error(\`No matching endpoint found for path: \${apiPath} \${httpMethod}\`);
        }
        
        console.log('Matched endpoint:', endpoint.path, endpoint.method);
        
        // Build API URL
        const apiUrl = buildApiUrl(endpoint, params);
        
        // Make API call
        const apiResponse = await makeApiCall(apiUrl, endpoint.method, params, endpoint);
        
        // Format response for Bedrock Agent
        const formattedResponse = formatResponseForAgent(apiResponse, endpoint, apiPath);
        
        return {
            response: {
                actionGroup: actionGroup,
                function: apiPath,
                functionResponse: {
                    responseBody: {
                        'TEXT': {
                            body: formattedResponse
                        }
                    }
                }
            }
        };
        
    } catch (error) {
        console.error('Error processing request:', error);
        
        return {
            response: {
                actionGroup: event.actionGroup,
                function: event.apiPath,
                functionResponse: {
                    responseBody: {
                        'TEXT': {
                            body: \`Sorry, I encountered an error while processing your request: \${error.message}\`
                        }
                    }
                }
            }
        };
    }
};

// Find endpoint by path and method
function findMatchingEndpointByPath(apiPath, httpMethod, params) {
    console.log('Looking for endpoint matching path:', apiPath, 'method:', httpMethod);
    
    for (const endpoint of API_CONFIG.endpoints) {
        if (endpoint.path === apiPath && endpoint.method.toUpperCase() === httpMethod.toUpperCase()) {
            console.log('Found exact match by path and method');
            return endpoint;
        }
    }
    
    // Fallback: return first endpoint
    console.log('Using first endpoint as fallback');
    return API_CONFIG.endpoints[0] || null;
}

// Build API URL with parameters
function buildApiUrl(endpoint, params) {
    let apiUrl = API_CONFIG.baseUrl + endpoint.path;
    
    // Replace path parameters
    for (const [key, value] of Object.entries(params)) {
        apiUrl = apiUrl.replace(\`{\${key}}\`, encodeURIComponent(value));
    }
    
    console.log('Built API URL:', apiUrl);
    return apiUrl;
}

// Make API call
async function makeApiCall(apiUrl, method, params, endpoint) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(apiUrl);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method.toUpperCase(),
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Bedrock-Action-Group/1.0'
            }
        };
        
        // Add authentication if configured
        if (API_CONFIG.authentication) {
            if (API_CONFIG.authentication.type === 'apiKey') {
                options.headers[API_CONFIG.authentication.name] = API_CONFIG.authentication.value;
            }
        }
        
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: jsonData,
                        headers: res.headers
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        data: data,
                        headers: res.headers
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.end();
    });
}

// Format response for agent
function formatResponseForAgent(apiResponse, endpoint, functionName) {
    if (apiResponse.statusCode >= 200 && apiResponse.statusCode < 300) {
        const data = apiResponse.data;
        
        if (typeof data === 'object') {
            // Format object response
            if (Array.isArray(data)) {
                return \`Found \${data.length} results: \${JSON.stringify(data.slice(0, 3), null, 2)}\`;
            } else {
                return JSON.stringify(data, null, 2);
            }
        } else {
            return String(data);
        }
    } else {
        return \`API request failed with status \${apiResponse.statusCode}: \${JSON.stringify(apiResponse.data)}\`;
    }
}
`;
    }

    // Use template file and replace placeholder
    const finalCode = lambdaTemplate.replace(
      /const API_CONFIG = \{[\s\S]*?\};/,
      `const API_CONFIG = ${JSON.stringify(apiConfig, null, 2)};`
    );

    // Log debugging info about the generated code
    const hasOperationIdDetection = finalCode.includes(
      "Available event properties"
    );
    const hasNewEventParsing = finalCode.includes(
      "operationId || event.function"
    );
    logger.info(
      `Generated Lambda code - Has operation ID detection: ${hasOperationIdDetection}`
    );
    logger.info(
      `Generated Lambda code - Has new event parsing: ${hasNewEventParsing}`
    );

    return finalCode;
  }

  /**
   * Generate unique action group name
   * @param {string} apiName - API name
   * @returns {string} Action group name
   */
  generateActionGroupName(apiName) {
    const normalized = apiName
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_");

    return `${normalized}_ActionGroup`;
  }

  /**
   * Generate unique Lambda function name
   * @param {string} apiName - API name
   * @returns {string} Lambda function name
   */
  generateLambdaFunctionName(apiName) {
    const normalized = apiName
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .toLowerCase();

    return `oralia-action-group-${normalized}`;
  }

  /**
   * Store API configuration for runtime use
   * @param {string} actionGroupId - Action group ID
   * @param {Object} apiConfig - API configuration
   */
  async storeApiConfiguration(actionGroupId, apiConfig) {
    this.actionGroups.set(actionGroupId, {
      id: actionGroupId,
      apiConfig: apiConfig,
      createdAt: new Date(),
      status: "active",
    });

    logger.info(`Stored API configuration for action group: ${actionGroupId}`);
  }

  /**
   * Prepare agent with new action group
   */
  async prepareAgent() {
    try {
      const prepareCommand = new PrepareAgentCommand({
        agentId: this.agentId,
      });

      await this.bedrockAgentClient.send(prepareCommand);
      logger.info("Agent prepared successfully");
    } catch (error) {
      logger.error("Failed to prepare agent:", error.message);
      throw error;
    }
  }

  /**
   * List all action groups for the agent
   * @param {Object} filters - Filtering options
   * @returns {Object} List of action groups
   */
  async listActionGroups(filters = {}) {
    try {
      const command = new ListAgentActionGroupsCommand({
        agentId: this.agentId,
        agentVersion: "DRAFT",
      });

      const response = await this.bedrockAgentClient.send(command);
      let actionGroups = response.actionGroupSummaries || [];

      // Apply filters
      if (filters.status) {
        actionGroups = actionGroups.filter(
          (ag) => ag.actionGroupState === filters.status
        );
      }

      return {
        actionGroups: actionGroups,
        totalCount: actionGroups.length,
      };
    } catch (error) {
      logger.error("Error listing action groups:", error);
      throw new Error(`Failed to list action groups: ${error.message}`);
    }
  }

  /**
   * Utility method to fix multiple ENABLED action groups
   * Run this once to clean up the current state
   */
  async fixMultipleEnabledActionGroups() {
    try {
      logger.info("🔧 Fixing multiple ENABLED action groups...");

      const allGroups = await this.listActionGroups();
      const enabledGroups = allGroups.actionGroups.filter(
        (ag) => ag.actionGroupState === "ENABLED"
      );

      if (enabledGroups.length <= 1) {
        logger.info("✅ No multiple ENABLED groups found. State is correct.");
        return { fixed: false, message: "No issues found" };
      }

      logger.info(`Found ${enabledGroups.length} ENABLED groups. Fixing...`);

      // Keep the most recently updated one enabled, disable the rest
      enabledGroups.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime; // Most recent first
      });

      const keepEnabled = enabledGroups[0];
      const toDisable = enabledGroups.slice(1);

      logger.info(`Keeping ENABLED: ${keepEnabled.actionGroupName}`);
      logger.info(`Disabling ${toDisable.length} other groups...`);

      // Disable all except the most recent one
      for (const ag of toDisable) {
        try {
          logger.info(`Disabling: ${ag.actionGroupName} (${ag.actionGroupId})`);
          await this.updateActionGroup(ag.actionGroupId, {
            actionGroupState: "DISABLED",
          });
          logger.info(`✅ Disabled: ${ag.actionGroupName}`);
        } catch (error) {
          logger.error(
            `❌ Failed to disable ${ag.actionGroupName}: ${error.message}`
          );
        }
      }

      logger.info("🎉 Fixed multiple ENABLED action groups!");
      return {
        fixed: true,
        keptEnabled: keepEnabled.actionGroupName,
        disabled: toDisable.map((ag) => ag.actionGroupName),
      };
    } catch (error) {
      logger.error("Error fixing multiple ENABLED groups:", error);
      throw error;
    }
  }

  /**
   * Get action group details
   * @param {string} actionGroupId - Action group ID
   * @returns {Object} Action group details
   */
  async getActionGroup(actionGroupId) {
    // AWS Bedrock sometimes has issues with GetAgentActionGroup for certain action groups
    // Use list as primary method and GetAgentActionGroup as fallback
    try {
      logger.info(
        `Getting action group: ${actionGroupId} for agent: ${this.agentId}`
      );

      // Primary approach: Get from list (more reliable)
      try {
        const listResult = await this.listActionGroups();
        const actionGroup = listResult.actionGroups.find(
          (ag) => ag.actionGroupId === actionGroupId
        );
        if (actionGroup) {
          logger.info(`Found action group ${actionGroupId} via list`);

          // Try to enhance with detailed information from GetAgentActionGroup
          try {
            const command = new GetAgentActionGroupCommand({
              agentId: this.agentId,
              agentVersion: "DRAFT",
              actionGroupId: actionGroupId,
            });

            const detailResponse = await this.bedrockAgentClient.send(command);
            
            // Debug: Log more detailed response structure
            logger.info(`Detailed response for ${actionGroupId}:`, {
              responseKeys: Object.keys(detailResponse),
              hasAgentActionGroup: !!detailResponse.agentActionGroup,
              actionGroupKeys: detailResponse.agentActionGroup ? Object.keys(detailResponse.agentActionGroup) : null,
              hasApiSchema: !!(detailResponse.agentActionGroup && detailResponse.agentActionGroup.apiSchema),
              hasFunctionSchema: !!(detailResponse.agentActionGroup && detailResponse.agentActionGroup.functionSchema),
              apiSchemaKeys: (detailResponse.agentActionGroup && detailResponse.agentActionGroup.apiSchema) 
                ? Object.keys(detailResponse.agentActionGroup.apiSchema) : null,
              hasPayload: !!(detailResponse.agentActionGroup && detailResponse.agentActionGroup.apiSchema && detailResponse.agentActionGroup.apiSchema.payload)
            });
            
            // If we have a schema, log a snippet of it
            if (detailResponse.agentActionGroup && detailResponse.agentActionGroup.apiSchema && detailResponse.agentActionGroup.apiSchema.payload) {
              logger.info(`API Schema payload found for ${actionGroupId}:`, {
                payloadLength: detailResponse.agentActionGroup.apiSchema.payload.length,
                payloadStart: detailResponse.agentActionGroup.apiSchema.payload.substring(0, 100)
              });
            }
            
            logger.info(
              `Enhanced action group ${actionGroupId} with detailed information`
            );

            // Return the detailed response directly - AWS uses 'agentActionGroup' not 'actionGroup'
            const detailedActionGroup = detailResponse.agentActionGroup;
            
            // Debug: Log what we're actually returning
            logger.info(`Returning detailed action group for ${actionGroupId}:`, {
              keys: Object.keys(detailedActionGroup),
              hasApiSchema: !!detailedActionGroup.apiSchema,
              hasApiSchemaPayload: !!(detailedActionGroup.apiSchema && detailedActionGroup.apiSchema.payload),
              apiSchemaType: typeof detailedActionGroup.apiSchema
            });
            
            return detailedActionGroup;
          } catch (detailError) {
            logger.error(
              `Could not get detailed info for ${actionGroupId}:`,
              {
                errorName: detailError.name,
                errorMessage: detailError.message,
                errorStack: detailError.stack
              }
            );
            return actionGroup;
          }
        }
      } catch (listError) {
        logger.warn(
          "List approach failed, trying direct GetAgentActionGroup:",
          listError.message
        );
      }

      // Fallback approach: Direct GetAgentActionGroup call
      const command = new GetAgentActionGroupCommand({
        agentId: this.agentId,
        agentVersion: "DRAFT",
        actionGroupId: actionGroupId,
      });

      const response = await this.bedrockAgentClient.send(command);
      logger.info(
        `Successfully retrieved action group via direct call: ${actionGroupId}`
      );
      return response.agentActionGroup; // AWS uses 'agentActionGroup' not 'actionGroup'
    } catch (error) {
      logger.error(`Error getting action group ${actionGroupId}:`, {
        errorName: error.name,
        errorMessage: error.message,
        agentId: this.agentId,
        actionGroupId: actionGroupId,
      });

      if (error.name === "ResourceNotFoundException") {
        return null;
      }

      throw new Error(`Failed to get action group: ${error.message}`);
    }
  }

  /**
   * Get action group details with API configuration
   * @param {string} actionGroupId - Action group ID
   * @returns {Object} Action group with parsed API configuration
   */
  async getActionGroupWithConfig(actionGroupId) {
    try {
      const actionGroup = await this.getActionGroup(actionGroupId);
      if (!actionGroup) {
        return null;
      }

      // Try to extract the original API configuration from stored metadata
      const storedConfig = this.actionGroups.get(actionGroupId);

      let apiConfig = null;
      if (storedConfig) {
        apiConfig = storedConfig.apiConfig;
      } else {
        // If not in memory, try to parse from OpenAPI schema
        try {
          if (actionGroup.apiSchema && actionGroup.apiSchema.payload) {
            const openApiSchema = JSON.parse(actionGroup.apiSchema.payload);
            apiConfig = this.extractApiConfigFromOpenAPI(openApiSchema);
          }
        } catch (error) {
          logger.warn(
            "Failed to parse OpenAPI schema for action group:",
            actionGroupId
          );
        }
      }

      return {
        ...actionGroup,
        apiConfig: apiConfig,
        editable: !!apiConfig, // Can only edit if we have the original config
      };
    } catch (error) {
      logger.error("Error getting action group with config:", error);
      throw new Error(
        `Failed to get action group configuration: ${error.message}`
      );
    }
  }

  /**
   * Extract API configuration from OpenAPI schema (basic implementation)
   * @param {Object} openApiSchema - OpenAPI schema
   * @returns {Object} Reconstructed API configuration
   */
  extractApiConfigFromOpenAPI(openApiSchema) {
    try {
      const apiConfig = {
        apiName: openApiSchema.info?.title || "Imported API",
        description: openApiSchema.info?.description || "",
        baseUrl: openApiSchema.servers?.[0]?.url || "",
        endpoints: [],
        authentication: {
          type: "none",
          location: "header",
          name: "",
          value: "",
        },
      };

      // Extract authentication info
      if (openApiSchema.security && openApiSchema.security.length > 0) {
        const securityScheme = openApiSchema.security[0];
        const schemeKey = Object.keys(securityScheme)[0];
        const scheme = openApiSchema.components?.securitySchemes?.[schemeKey];

        if (scheme) {
          if (scheme.type === "apiKey") {
            apiConfig.authentication = {
              type: "apiKey",
              location: scheme.in === "header" ? "header" : "query",
              name: scheme.name || "",
              value: "", // Don't expose the actual value
            };
          } else if (scheme.type === "http" && scheme.scheme === "bearer") {
            apiConfig.authentication = {
              type: "bearer",
              location: "header",
              name: "Authorization",
              value: "",
            };
          }
        }
      }

      // Extract endpoints
      if (openApiSchema.paths) {
        for (const [path, pathItem] of Object.entries(openApiSchema.paths)) {
          for (const [method, operation] of Object.entries(pathItem)) {
            if (
              ["get", "post", "put", "delete", "patch"].includes(
                method.toLowerCase()
              )
            ) {
              const endpoint = {
                path: path,
                method: method.toUpperCase(),
                description: operation.summary || operation.description || "",
                parameters: [],
                responseExample: "",
              };

              // Extract parameters
              if (operation.parameters) {
                operation.parameters.forEach((param) => {
                  endpoint.parameters.push({
                    name: param.name,
                    type: param.schema?.type || "string",
                    location: param.in,
                    required: param.required || false,
                    description: param.description || "",
                  });
                });
              }

              // Try to generate response example from schema
              const successResponse = operation.responses?.["200"];
              if (successResponse?.content?.["application/json"]?.schema) {
                try {
                  endpoint.responseExample = JSON.stringify(
                    this.generateExampleFromSchema(
                      successResponse.content["application/json"].schema
                    ),
                    null,
                    2
                  );
                } catch (e) {
                  // Failed to generate example, leave empty
                }
              }

              apiConfig.endpoints.push(endpoint);
            }
          }
        }
      }

      return apiConfig;
    } catch (error) {
      logger.error("Error extracting API config from OpenAPI schema:", error);
      return null;
    }
  }

  /**
   * Resolve an incoming identifier to a concrete action group summary.
   * Accepts either actionGroupId or actionGroupName and returns a summary if found.
   * @param {string} identifier
   * @returns {Promise<object|null>}
   */
  async resolveActionGroup(identifier) {
    if (!identifier) return null;

    const normalizedId = String(identifier).trim();

    try {
      // Try direct by ID first
      const byId = await this.getActionGroup(normalizedId);
      if (byId) {
        logger.info(`Found action group by direct ID: ${normalizedId}`);
        return byId;
      }
    } catch (error) {
      logger.debug(
        `Direct ID lookup failed for ${normalizedId}: ${error.message}`
      );
    }

    try {
      const { actionGroups } = await this.listActionGroups();

      // Exact ID match from list
      let found = actionGroups.find(
        (ag) => String(ag.actionGroupId).trim() === normalizedId
      );
      if (found) {
        logger.info(`Found action group by ID from list: ${normalizedId}`);
        return found;
      }

      // Exact name match
      found = actionGroups.find((ag) => ag.actionGroupName === normalizedId);
      if (found) {
        logger.info(`Found action group by exact name: ${normalizedId}`);
        return found;
      }

      // Case-insensitive name match
      found = actionGroups.find(
        (ag) => ag.actionGroupName?.toLowerCase() === normalizedId.toLowerCase()
      );
      if (found) {
        logger.info(
          `Found action group by case-insensitive name: ${normalizedId}`
        );
        return found;
      }

      // Partial contains match
      found = actionGroups.find((ag) =>
        ag.actionGroupName?.toLowerCase().includes(normalizedId.toLowerCase())
      );
      if (found) {
        logger.info(`Found action group by partial name: ${normalizedId}`);
        return found;
      }

      logger.warn(`No action group found for identifier: ${normalizedId}`);
      return null;
    } catch (e) {
      logger.error("Failed to resolve action group identifier:", e.message);
      return null;
    }
  }

  /**
   * Reconstruct actionGroupExecutor if missing
   * @param {string} actionGroupId
   * @param {Object} actionGroup - Current action group details (may be partial)
   * @returns {Promise<Object|null>} executor object or null
   */
  async reconstructExecutor(actionGroupId, actionGroup) {
    try {
      // If executor exists, return as-is
      if (actionGroup && actionGroup.actionGroupExecutor) {
        return actionGroup.actionGroupExecutor;
      }

      // Try from in-memory stored config
      const stored = this.actionGroups.get(actionGroupId);
      let apiName = stored?.apiConfig?.apiName;

      // Try to parse OpenAPI payload for title if present
      if (!apiName && actionGroup?.apiSchema?.payload) {
        try {
          const openApi = JSON.parse(actionGroup.apiSchema.payload);
          apiName = openApi?.info?.title;
        } catch (_) {}
      }

      // Last resort: derive from actionGroupName (strip _ActionGroup suffix)
      if (!apiName) {
        const rawName = actionGroup?.actionGroupName;
        if (rawName) {
          apiName = rawName.replace(/_ActionGroup$/i, "");
          logger.info(
            `Derived apiName '${apiName}' from actionGroupName '${rawName}'`
          );
        }
      }

      if (!apiName) return null;

      // Derive Lambda function name and fetch ARN
      const functionName = this.generateLambdaFunctionName(apiName);
      try {
        const { GetFunctionCommand } = require("@aws-sdk/client-lambda");
        const res = await this.lambdaClient.send(
          new GetFunctionCommand({ FunctionName: functionName })
        );
        if (res?.Configuration?.FunctionArn) {
          return { lambda: res.Configuration.FunctionArn };
        }
      } catch (e) {
        // Swallow and return null so caller can decide a fallback
        logger.warn(
          `Could not resolve Lambda ARN for ${functionName}: ${e.message}`
        );
      }
      return null;
    } catch (error) {
      logger.warn("Failed to reconstruct executor:", error.message);
      return null;
    }
  }

  /**
   * Reconstruct apiSchema if missing
   * @param {string} actionGroupId
   * @param {Object} actionGroup - Current action group details (may be partial)
   * @returns {Promise<Object|null>} apiSchema object or null
   */
  async reconstructApiSchema(actionGroupId, actionGroup) {
    try {
      if (actionGroup?.apiSchema?.payload) {
        return actionGroup.apiSchema;
      }

      // Try from stored config by regenerating OpenAPI
      const stored = this.actionGroups.get(actionGroupId);
      if (stored?.apiConfig) {
        try {
          const schema = await openApiGeneratorService.generateSchema(
            stored.apiConfig
          );
          return { payload: JSON.stringify(schema) };
        } catch (e) {
          logger.warn(
            "Could not regenerate OpenAPI from stored config:",
            e.message
          );
        }
      }

      // Minimal fallback schema to satisfy AWS validation during DISABLE
      const title =
        actionGroup?.actionGroupName ||
        stored?.apiConfig?.apiName ||
        "Legacy API";
      const minimal = {
        openapi: "3.0.0",
        info: {
          title,
          version: "1.0.0",
          description: "Auto-generated minimal schema for state update",
        },
        paths: {
          "/health": {
            get: {
              operationId: "health",
              summary: "Health endpoint",
              responses: {
                200: {
                  description: "OK",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { ok: { type: "boolean" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      return { payload: JSON.stringify(minimal) };
    } catch (error) {
      logger.warn("Failed to reconstruct apiSchema:", error.message);
      return null;
    }
  }

  /**
   * Generate example data from JSON schema
   * @param {Object} schema - JSON schema
   * @returns {*} Example data
   */
  generateExampleFromSchema(schema) {
    if (schema.example !== undefined) {
      return schema.example;
    }

    switch (schema.type) {
      case "object":
        const obj = {};
        if (schema.properties) {
          for (const [key, propSchema] of Object.entries(schema.properties)) {
            obj[key] = this.generateExampleFromSchema(propSchema);
          }
        }
        return obj;

      case "array":
        return schema.items
          ? [this.generateExampleFromSchema(schema.items)]
          : [];

      case "string":
        return "example string";

      case "integer":
        return 123;

      case "number":
        return 123.45;

      case "boolean":
        return true;

      default:
        return "example";
    }
  }

  /**
   * Update action group - always include required fields for AWS Bedrock.
   * Only the following fields are required for enable/disable:
   *   - actionGroupName
   *   - description
   *   - actionGroupExecutor
   *   - apiSchema or functionSchema
   *   - actionGroupState (ENABLED or DISABLED)
   * Other fields (parentActionGroupSignature, parentActionGroupSignatureParams) are not required and are not sent unless present in the current action group.
   */
  async updateActionGroup(actionGroupId, updates) {
    try {
      logger.info(
        `Updating action group ${actionGroupId} with:`,
        JSON.stringify(updates, null, 2)
      );

      // Resolve the action group
      const resolved = await this.resolveActionGroup(actionGroupId);
      if (!resolved) {
        throw new Error("Action group not found during resolution");
      }

      const realActionGroupId = String(resolved.actionGroupId).trim();
      logger.info(`Using resolved action group ID: ${realActionGroupId}`);

      // Get current action group details - try detailed first, then fallback
      let currentActionGroup = null;
      try {
        logger.info("Attempting GetAgentActionGroup call...");
        const detailed = await this.bedrockAgentClient.send(
          new GetAgentActionGroupCommand({
            agentId: this.agentId,
            agentVersion: "DRAFT",
            actionGroupId: realActionGroupId,
          })
        );
        currentActionGroup = detailed?.actionGroup;
        logger.info("✅ GetAgentActionGroup successful");
      } catch (e) {
        logger.warn(`GetAgentActionGroup failed: ${e.message}`);
        logger.info("Falling back to list-based approach...");
        currentActionGroup = await this.getActionGroup(realActionGroupId);
      }

      if (!currentActionGroup) {
        throw new Error("Action group not found in detailed lookup");
      }

      logger.info("Current action group details:", {
        id: currentActionGroup.actionGroupId,
        name: currentActionGroup.actionGroupName,
        state: currentActionGroup.actionGroupState,
        hasExecutor: !!currentActionGroup.actionGroupExecutor,
        hasApiSchema: !!currentActionGroup.apiSchema,
        hasFunctionSchema: !!currentActionGroup.functionSchema,
      });

      // Build update command with ALL required fields
      const updateParams = {
        agentId: this.agentId,
        agentVersion: "DRAFT",
        actionGroupId: realActionGroupId,
        actionGroupName: currentActionGroup.actionGroupName,
        description:
          currentActionGroup.description ||
          `Auto-generated action group for ${currentActionGroup.actionGroupName}`,
        ...updates, // Only actionGroupState is typically updated for enable/disable
      };

      // CRITICAL: Ensure executor is present
      if (currentActionGroup.actionGroupExecutor) {
        updateParams.actionGroupExecutor =
          currentActionGroup.actionGroupExecutor;
        logger.info("✅ Using existing executor");
      } else {
        logger.warn("❌ No executor found, attempting reconstruction...");
        const reconstructedExecutor = await this.reconstructExecutor(
          realActionGroupId,
          currentActionGroup
        );
        if (reconstructedExecutor) {
          updateParams.actionGroupExecutor = reconstructedExecutor;
          logger.info("✅ Reconstructed executor successfully");
        } else {
          // Try to copy from another action group
          try {
            const allGroups = await this.listActionGroups();
            const donor = allGroups.actionGroups.find(
              (ag) =>
                ag.actionGroupExecutor && ag.actionGroupId !== realActionGroupId
            );
            if (donor) {
              updateParams.actionGroupExecutor = donor.actionGroupExecutor;
              logger.info(`✅ Copied executor from: ${donor.actionGroupName}`);
            }
          } catch (e) {
            logger.warn(
              "Failed to copy executor from other groups:",
              e.message
            );
          }
        }
      }

      // CRITICAL: Ensure schema is present (either apiSchema or functionSchema)
      if (currentActionGroup.apiSchema) {
        updateParams.apiSchema = currentActionGroup.apiSchema;
        logger.info("✅ Using existing apiSchema");
      } else if (currentActionGroup.functionSchema) {
        updateParams.functionSchema = currentActionGroup.functionSchema;
        logger.info("✅ Using existing functionSchema");
      } else {
        logger.warn("❌ No schema found, attempting reconstruction...");
        const rebuiltSchema = await this.reconstructApiSchema(
          realActionGroupId,
          currentActionGroup
        );
        if (rebuiltSchema) {
          updateParams.apiSchema = rebuiltSchema;
          logger.info("✅ Reconstructed apiSchema successfully");
        }
      }

      // Only include parentActionGroupSignature/Params if present in currentActionGroup
      if (currentActionGroup.parentActionGroupSignature) {
        updateParams.parentActionGroupSignature =
          currentActionGroup.parentActionGroupSignature;
      }
      if (currentActionGroup.parentActionGroupSignatureParams) {
        updateParams.parentActionGroupSignatureParams =
          currentActionGroup.parentActionGroupSignatureParams;
      }

      // Final validation - ensure critical fields are present
      if (!updateParams.actionGroupExecutor) {
        throw new Error(
          "Cannot update action group: missing actionGroupExecutor (Lambda ARN)"
        );
      }

      if (!updateParams.apiSchema && !updateParams.functionSchema) {
        throw new Error(
          "Cannot update action group: missing both apiSchema and functionSchema"
        );
      }

      // Log the payload (without sensitive data)
      const logPayload = { ...updateParams };
      if (logPayload.apiSchema?.payload) {
        logPayload.apiSchema = {
          payloadSize:
            Buffer.byteLength(logPayload.apiSchema.payload, "utf8") + " bytes",
        };
      }

      logger.info(
        "Final UpdateAgentActionGroup payload:",
        JSON.stringify(logPayload, null, 2)
      );

      // Send the update command
      logger.info("🚀 Sending UpdateAgentActionGroup command...");
      const updateCommand = new UpdateAgentActionGroupCommand(updateParams);
      const response = await this.bedrockAgentClient.send(updateCommand);

      logger.info("✅ UpdateAgentActionGroup command successful!");

      // Prepare agent
      logger.info("🔄 Preparing agent...");
      await this.prepareAgent();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      logger.info("✅ Agent prepared successfully");

      return response.actionGroup;
    } catch (error) {
      logger.error("❌ UpdateAgentActionGroup failed:", {
        actionGroupId,
        updates,
        errorMessage: error.message,
        errorName: error.name,
        errorCode: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
      });

      // Enhanced error message
      let enhancedMessage = `Failed to update action group: ${error.message}`;
      if (error.message.includes("not found")) {
        enhancedMessage +=
          ". The action group may have been deleted by another process or may be in an inconsistent state.";
      }

      throw new Error(enhancedMessage);
    }
  }
  /**
   * Enable action group
   * Only updates actionGroupState to ENABLED, keeping all other required fields.
   * @param {string} actionGroupId - Action group ID to enable
   * @returns {Object} Updated action group
   */
  async enableActionGroup(actionGroupId) {
    try {
      logger.info(
        `🟢 Enabling action group: ${actionGroupId} and disabling others`
      );

      // Normalize the ID for comparison
      const normalizedId = String(actionGroupId).trim();

      // Resolve the action group first
      const resolved = await this.resolveActionGroup(normalizedId);
      if (!resolved) {
        throw new Error("Action group not found");
      }

      const realActionGroupId = String(resolved.actionGroupId).trim();
      logger.info(`Resolved action group ID: ${realActionGroupId}`);

      // List all action groups
      const allGroups = await this.listActionGroups();

      // Disable all enabled action groups except the one to enable
      for (const ag of allGroups.actionGroups) {
        if (
          String(ag.actionGroupId).trim() !== realActionGroupId &&
          ag.actionGroupState === "ENABLED"
        ) {
          try {
            logger.info(`Disabling action group: ${ag.actionGroupId}`);
            await this.updateActionGroup(ag.actionGroupId, {
              actionGroupState: "DISABLED",
            });
          } catch (e) {
            logger.warn(
              `Failed to disable action group ${ag.actionGroupId}: ${e.message}`
            );
          }
        }
      }

      // Enable the selected action group
      const result = await this.updateActionGroup(realActionGroupId, {
        actionGroupState: "ENABLED",
      });

      logger.info(`✅ Action group enabled successfully: ${realActionGroupId}`);
      return result;
    } catch (error) {
      logger.error(
        `❌ Failed to enable action group ${actionGroupId}: ${error.message}`
      );
      throw new Error(`Failed to enable action group: ${error.message}`);
    }
  }

  /**
   * Disable action group
   * Only updates actionGroupState to DISABLED, keeping all other required fields.
   * @param {string} actionGroupId - Action group ID
   * @returns {Object} Updated action group
   */
  async disableActionGroup(actionGroupId) {
    try {
      logger.info(`🔴 Disabling action group: ${actionGroupId}`);

      // Normalize the ID for comparison
      const normalizedId = String(actionGroupId).trim();

      // Resolve the action group first
      const resolved = await this.resolveActionGroup(normalizedId);
      if (!resolved) {
        throw new Error("Action group not found");
      }

      const realActionGroupId = String(resolved.actionGroupId).trim();
      logger.info(`Resolved action group ID: ${realActionGroupId}`);

      const result = await this.updateActionGroup(realActionGroupId, {
        actionGroupState: "DISABLED",
      });

      logger.info(
        `✅ Action group disabled successfully: ${realActionGroupId}`
      );
      return result;
    } catch (error) {
      logger.error(
        `❌ Failed to disable action group ${actionGroupId}: ${error.message}`
      );
      throw new Error(`Failed to disable action group: ${error.message}`);
    }
  }
  /**
   * Delete action group in AWS Bedrock and locally
   * @param {string} actionGroupId - Action group ID
   */
  async deleteActionGroup(actionGroupId) {
    try {
      logger.info(`🗑️ Starting deletion for: ${actionGroupId}`);

      // Step 1: Resolve and check existence
      const resolved = await this.resolveActionGroup(actionGroupId);
      if (!resolved) {
        logger.info(
          "✅ Action group not found - already deleted or doesn't exist"
        );
        this.actionGroups.delete(actionGroupId);
        this.executionHistory.delete(actionGroupId);
        return { deleted: true, reason: "not_found" };
      }

      const realActionGroupId = String(resolved.actionGroupId).trim();
      logger.info(`Resolved action group ID: ${realActionGroupId}`);

      // Step 2: Get full action group details
      const actionGroup = await this.getActionGroup(realActionGroupId);
      if (!actionGroup) {
        logger.info(
          "✅ Action group details not found - considering as deleted"
        );
        this.actionGroups.delete(actionGroupId);
        this.actionGroups.delete(realActionGroupId);
        this.executionHistory.delete(actionGroupId);
        this.executionHistory.delete(realActionGroupId);
        return { deleted: true, reason: "details_not_found" };
      }

      // Step 3: If enabled, disable first
      if (actionGroup.actionGroupState === "ENABLED") {
        logger.info("🔄 Action group is ENABLED - disabling before delete...");
        try {
          await this.disableActionGroup(realActionGroupId);
          // Wait for state to propagate
          await new Promise((resolve) => setTimeout(resolve, 3000));
          logger.info("✅ Action group disabled successfully");
        } catch (disableError) {
          logger.warn(
            `Failed to disable before delete: ${disableError.message}`
          );
          // Continue with deletion anyway
        }
      }

      // Step 4: Delete from AWS Bedrock
      logger.info("🔥 Deleting from AWS Bedrock...");
      try {
        const deleteCommand = new DeleteAgentActionGroupCommand({
          agentId: this.agentId,
          agentVersion: "DRAFT",
          actionGroupId: realActionGroupId,
        });

        await this.bedrockAgentClient.send(deleteCommand);
        logger.info("✅ Successfully deleted from AWS Bedrock");
      } catch (awsError) {
        if (awsError.name === "ResourceNotFoundException") {
          logger.info(
            "✅ Action group not found in AWS - considering as already deleted"
          );
        } else {
          logger.error(`AWS deletion failed: ${awsError.message}`);
          throw new Error(
            `Failed to delete from AWS Bedrock: ${awsError.message}`
          );
        }
      }

      // Step 5: Local cleanup
      this.actionGroups.delete(actionGroupId);
      this.actionGroups.delete(realActionGroupId);
      this.executionHistory.delete(actionGroupId);
      this.executionHistory.delete(realActionGroupId);

      // Step 6: Prepare agent to sync changes
      try {
        await this.prepareAgent();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        logger.info("✅ Agent prepared successfully after deletion");
      } catch (prepareError) {
        logger.warn(
          `Failed to prepare agent after deletion: ${prepareError.message}`
        );
        // Don't fail the deletion for this
      }

      logger.info("🎉 Action group deletion completed successfully!");
      return {
        deleted: true,
        actionGroupId: realActionGroupId,
        deletedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`❌ Action group deletion failed: ${error.message}`);

      // Clean up local state even if AWS deletion failed
      this.actionGroups.delete(actionGroupId);
      this.executionHistory.delete(actionGroupId);

      throw new Error(`Failed to delete action group: ${error.message}`);
    }
  }
  /**
   * Test action group functionality
   * @param {string} actionGroupId - Action group ID
   * @param {Object} testData - Test data
   * @returns {Object} Test results
   */
  async testActionGroup(actionGroupId, testData = {}) {
    try {
      const startTime = Date.now();

      // Get action group details
      const actionGroup = await this.getActionGroup(actionGroupId);
      if (!actionGroup) {
        throw new Error("Action group not found");
      }

      // Test with agent invocation
      const testMessage =
        testData.testMessage ||
        `Test the ${actionGroup.actionGroupName} functionality`;

      const command = new InvokeAgentCommand({
        agentId: this.agentId,
        agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || "TSTALIASID",
        sessionId: `test-${Date.now()}`,
        inputText: testMessage,
      });

      const response = await this.bedrockRuntimeClient.send(command);
      const executionTime = Date.now() - startTime;

      // Process response
      let testResult = "";
      if (response.completion) {
        for await (const chunk of response.completion) {
          if (chunk.chunk && chunk.chunk.bytes) {
            const chunkData = JSON.parse(
              new TextDecoder().decode(chunk.chunk.bytes)
            );
            if (chunkData.type === "chunk" && chunkData.bytes) {
              testResult += new TextDecoder().decode(
                new Uint8Array(
                  chunkData.bytes
                    .match(/.{1,2}/g)
                    .map((byte) => parseInt(byte, 16))
                )
              );
            }
          }
        }
      }

      // Store execution in history
      this.addExecutionHistory(actionGroupId, {
        type: "test",
        input: testMessage,
        output: testResult,
        executionTime,
        timestamp: new Date().toISOString(),
      });

      return {
        testResult,
        executionTime,
        status: "success",
        actionGroupId,
      };
    } catch (error) {
      logger.error("Error testing action group:", error);

      return {
        testResult: `Test failed: ${error.message}`,
        executionTime: 0,
        status: "error",
        actionGroupId,
        error: error.message,
      };
    }
  }

  /**
   * Add execution to history
   * @param {string} actionGroupId - Action group ID
   * @param {Object} execution - Execution details
   */
  addExecutionHistory(actionGroupId, execution) {
    if (!this.executionHistory.has(actionGroupId)) {
      this.executionHistory.set(actionGroupId, []);
    }

    const history = this.executionHistory.get(actionGroupId);
    history.unshift({
      executionId: crypto.randomUUID(),
      ...execution,
    });

    // Keep only last 100 executions
    if (history.length > 100) {
      history.splice(100);
    }
  }

  /**
   * Get execution history for action group
   * @param {string} actionGroupId - Action group ID
   * @param {number} limit - Maximum number of records
   * @returns {Array} Execution history
   */
  async getExecutionHistory(actionGroupId, limit = 50) {
    const history = this.executionHistory.get(actionGroupId) || [];
    return history.slice(0, limit);
  }

  /**
   * Sync action group with agent
   * @param {string} actionGroupId - Action group ID
   * @returns {Object} Sync result
   */
  async syncActionGroupWithAgent(actionGroupId) {
    try {
      await this.prepareAgent();

      return {
        syncStatus: "completed",
        agentStatus: "PREPARED",
        syncedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error syncing action group with agent:", error);
      throw new Error(`Failed to sync action group: ${error.message}`);
    }
  }

  /**
   * Get agent information
   * @returns {Object} Agent information
   */
  async getAgentInfo() {
    try {
      const command = new GetAgentCommand({
        agentId: this.agentId,
      });

      const response = await this.bedrockAgentClient.send(command);
      const agent = response.agent;

      // Get action groups count
      const actionGroups = await this.listActionGroups();

      return {
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: agent.agentStatus,
        configured: !!this.agentId,
        actionGroupsCount: actionGroups.totalCount,
        lastUpdated: agent.updatedAt,
      };
    } catch (error) {
      logger.error("Error getting agent info:", error);
      return {
        agentId: this.agentId,
        configured: !!this.agentId,
        status: "UNKNOWN",
        actionGroupsCount: 0,
        error: error.message,
      };
    }
  }

  /**
   * Validate API configuration
   * @param {Object} apiConfig - API configuration to validate
   * @returns {Object} Validation result
   */
  async validateApiConfiguration(apiConfig) {
    const errors = [];
    const warnings = [];
    const suggestions = [];

    // Required fields validation
    if (!apiConfig.apiName || apiConfig.apiName.trim().length === 0) {
      errors.push("API name is required");
    }

    if (!apiConfig.baseUrl || !this.isValidUrl(apiConfig.baseUrl)) {
      errors.push("Valid base URL is required");
    }

    if (
      !apiConfig.endpoints ||
      !Array.isArray(apiConfig.endpoints) ||
      apiConfig.endpoints.length === 0
    ) {
      errors.push("At least one endpoint is required");
    }

    // Endpoint validation
    if (apiConfig.endpoints) {
      apiConfig.endpoints.forEach((endpoint, index) => {
        if (!endpoint.path || endpoint.path.trim().length === 0) {
          errors.push(`Endpoint ${index + 1}: Path is required`);
        }

        if (
          !endpoint.method ||
          !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(
            endpoint.method.toUpperCase()
          )
        ) {
          errors.push(`Endpoint ${index + 1}: Valid HTTP method is required`);
        }

        if (!endpoint.description || endpoint.description.trim().length === 0) {
          errors.push(`Endpoint ${index + 1}: Description is required`);
        }

        // Response example validation
        if (endpoint.responseExample) {
          try {
            JSON.parse(endpoint.responseExample);
          } catch (e) {
            warnings.push(
              `Endpoint ${index + 1}: Invalid JSON in response example`
            );
          }
        } else {
          suggestions.push(
            `Endpoint ${
              index + 1
            }: Consider adding a response example for better schema generation`
          );
        }

        // Parameter validation
        if (endpoint.parameters) {
          endpoint.parameters.forEach((param, paramIndex) => {
            if (!param.name || param.name.trim().length === 0) {
              errors.push(
                `Endpoint ${index + 1}, Parameter ${
                  paramIndex + 1
                }: Name is required`
              );
            }

            if (
              !param.type ||
              !["string", "integer", "number", "boolean"].includes(param.type)
            ) {
              errors.push(
                `Endpoint ${index + 1}, Parameter ${
                  paramIndex + 1
                }: Valid type is required`
              );
            }

            if (
              !param.location ||
              !["path", "query", "header"].includes(param.location)
            ) {
              errors.push(
                `Endpoint ${index + 1}, Parameter ${
                  paramIndex + 1
                }: Valid location is required`
              );
            }
          });
        }
      });
    }

    // Authentication validation
    if (apiConfig.authentication && apiConfig.authentication.type !== "none") {
      if (
        !apiConfig.authentication.name ||
        apiConfig.authentication.name.trim().length === 0
      ) {
        errors.push(
          "Authentication name/key is required when authentication is enabled"
        );
      }

      if (
        !apiConfig.authentication.value ||
        apiConfig.authentication.value.trim().length === 0
      ) {
        warnings.push(
          "Authentication value is empty - this may cause API calls to fail"
        );
      }
    }

    // Suggestions
    if (apiConfig.endpoints && apiConfig.endpoints.length > 10) {
      suggestions.push(
        "Consider grouping related endpoints into separate action groups for better organization"
      );
    }

    if (!apiConfig.description || apiConfig.description.trim().length === 0) {
      suggestions.push(
        "Adding a description helps users understand the API purpose"
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Check if URL is valid
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all agent aliases for the current agent
   * @returns {Promise<Array>} List of aliases with id, name, status, createdAt, updatedAt
   */
  async getAllAgentAliases() {
    // Fetch all aliases for the configured agent
    try {
      if (!this.agentId) throw new Error("Agent ID not configured");
      const command = new ListAgentAliasesCommand({
        agentId: this.agentId,
        maxResults: 50, // adjust as needed
      });
      const response = await this.bedrockAgentClient.send(command);
      // Each alias: { agentAliasId, agentAliasName, agentAliasStatus, createdAt, updatedAt }
      return (response.agentAliasSummaries || []).map((alias) => ({
        aliasId: alias.agentAliasId,
        aliasName: alias.agentAliasName,
        status: alias.agentAliasStatus,
        createdAt: alias.createdAt,
        updatedAt: alias.updatedAt,
      }));
    } catch (error) {
      logger.error("Failed to fetch agent aliases:", error);
      throw new Error(`Failed to fetch agent aliases: ${error.message}`);
    }
  }

  /**
   * Get the latest (most recently updated) agent alias for the current agent
   * @returns {Promise<Object|null>} Latest alias object or null if none
   */
  async getLatestAgentAlias() {
    try {
      const aliases = await this.getAllAgentAliases();
      if (!aliases.length) return null;
      // Sort by updatedAt (fallback to createdAt if updatedAt missing)
      aliases.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
      return aliases[0];
    } catch (error) {
      logger.error("Failed to get latest agent alias:", error);
      throw error;
    }
  }
}

module.exports = new ActionGroupService();
