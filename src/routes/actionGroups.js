const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const actionGroupService = require("../services/actionGroupService");
const openApiGeneratorService = require("../services/openApiGeneratorService");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     ApiConfiguration:
 *       type: object
 *       required:
 *         - apiName
 *         - baseUrl
 *         - endpoints
 *       properties:
 *         apiName:
 *           type: string
 *           description: Name of the API
 *           example: "Order Tracking API"
 *         description:
 *           type: string
 *           description: API description
 *           example: "API for tracking order status and delivery information"
 *         baseUrl:
 *           type: string
 *           format: uri
 *           description: Base URL of the API
 *           example: "https://api.example.com"
 *         endpoints:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ApiEndpoint'
 *         authentication:
 *           $ref: '#/components/schemas/ApiAuthentication'
 *
 *     ApiEndpoint:
 *       type: object
 *       required:
 *         - path
 *         - method
 *         - description
 *       properties:
 *         path:
 *           type: string
 *           description: API endpoint path
 *           example: "/orders/{orderId}"
 *         method:
 *           type: string
 *           enum: [GET, POST, PUT, DELETE, PATCH]
 *           description: HTTP method
 *           example: "GET"
 *         description:
 *           type: string
 *           description: Endpoint description
 *           example: "Get order information by ID"
 *         parameters:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ApiParameter'
 *         responseExample:
 *           type: string
 *           description: JSON response example
 *           example: '{"orderId": "12345", "status": "shipped"}'
 *
 *     ApiParameter:
 *       type: object
 *       required:
 *         - name
 *         - type
 *         - location
 *       properties:
 *         name:
 *           type: string
 *           description: Parameter name
 *           example: "orderId"
 *         type:
 *           type: string
 *           enum: [string, integer, number, boolean]
 *           description: Parameter type
 *           example: "string"
 *         location:
 *           type: string
 *           enum: [path, query, header]
 *           description: Parameter location
 *           example: "path"
 *         required:
 *           type: boolean
 *           description: Whether parameter is required
 *           example: true
 *         description:
 *           type: string
 *           description: Parameter description
 *           example: "The order ID to track"
 *
 *     ApiAuthentication:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum: [none, apiKey, bearer, basic]
 *           description: Authentication type
 *           example: "apiKey"
 *         location:
 *           type: string
 *           enum: [header, query]
 *           description: Authentication location
 *           example: "header"
 *         name:
 *           type: string
 *           description: Authentication field name
 *           example: "X-API-Key"
 *         value:
 *           type: string
 *           description: Authentication value (will be encrypted)
 *           example: "your-api-key-here"
 *
 *     ActionGroup:
 *       type: object
 *       properties:
 *         actionGroupId:
 *           type: string
 *           description: Action group identifier
 *         actionGroupName:
 *           type: string
 *           description: Action group name
 *         description:
 *           type: string
 *           description: Action group description
 *         actionGroupState:
 *           type: string
 *           enum: [ENABLED, DISABLED]
 *           description: Action group state
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *         agentId:
 *           type: string
 *           description: Associated agent ID
 *         lambdaArn:
 *           type: string
 *           description: Lambda function ARN for execution
 */

/**
 * @swagger
 * /api/action-groups/create:
 *   post:
 *     summary: Create a new action group
 *     description: Automatically creates an action group from API configuration, generates OpenAPI schema, and deploys to AWS Bedrock
 *     tags: [Action Groups]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiConfiguration'
 *     responses:
 *       200:
 *         description: Action group created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Action group created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     actionGroupId:
 *                       type: string
 *                       example: "AG123456789"
 *                     actionGroupName:
 *                       type: string
 *                       example: "Order_Tracking_API_ActionGroup"
 *                     status:
 *                       type: string
 *                       example: "ENABLED"
 *                     openApiSchema:
 *                       type: object
 *                       description: Generated OpenAPI schema
 *                     lambdaFunction:
 *                       type: object
 *                       properties:
 *                         functionName:
 *                           type: string
 *                         functionArn:
 *                           type: string
 *                     agentStatus:
 *                       type: string
 *                       example: "PREPARED"
 *       400:
 *         description: Invalid input data
 *       500:
 *         description: Server error
 */
router.post(
  "/create",
  [
    body("apiName")
      .notEmpty()
      .withMessage("API name is required")
      .isLength({ min: 3, max: 100 })
      .withMessage("API name must be between 3 and 100 characters"),

    body("baseUrl")
      .notEmpty()
      .withMessage("Valid base URL is required"),

    body("endpoints")
      .isArray({ min: 1 })
      .withMessage("At least one endpoint is required"),

    body("endpoints.*.path")
      .notEmpty()
      .withMessage("Endpoint path is required"),

    body("endpoints.*.method")
      .isIn(["GET", "POST", "PUT", "DELETE", "PATCH"])
      .withMessage("Valid HTTP method is required"),

    body("endpoints.*.description")
      .notEmpty()
      .withMessage("Endpoint description is required"),

    body("authentication.type")
      .optional()
      .isIn(["none", "apiKey", "bearer", "basic"])
      .withMessage("Valid authentication type is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const apiConfig = req.body;
      logger.info("Creating action group for API:", apiConfig.apiName);

      // Step 1: Validate API configuration
      const configValidation =
        await actionGroupService.validateApiConfiguration(apiConfig);
      if (!configValidation.valid) {
        return res.status(400).json({
          success: false,
          error: "API configuration validation failed",
          details: configValidation.errors,
        });
      }

      // Step 2: Generate OpenAPI schema
      const openApiSchema = await openApiGeneratorService.generateSchema(
        apiConfig
      );

      // Step 3: Create action group in AWS Bedrock
      const result = await actionGroupService.createActionGroup(
        apiConfig,
        openApiSchema
      );

      res.json({
        success: true,
        message: "Action group created successfully",
        data: {
          actionGroupId: result.actionGroupId,
          actionGroupName: result.actionGroupName,
          status: result.status,
          openApiSchema: openApiSchema,
          lambdaFunction: result.lambdaFunction,
          agentStatus: result.agentStatus,
          createdAt: result.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error creating action group:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create action group",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups:
 *   get:
 *     summary: List all action groups
 *     description: Get a list of all action groups for the configured agent
 *     tags: [Action Groups]
 *     parameters:
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *         description: Filter by specific agent ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ENABLED, DISABLED]
 *         description: Filter by action group status
 *     responses:
 *       200:
 *         description: List of action groups
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     actionGroups:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ActionGroup'
 *                     totalCount:
 *                       type: integer
 *                       example: 5
 */
router.get(
  "/",
  [
    query("agentId").optional().isString(),
    query("status").optional().isIn(["ENABLED", "DISABLED"]),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { agentId, status } = req.query;
      const result = await actionGroupService.listActionGroups({
        agentId,
        status,
      });

      res.json({
        success: true,
        data: {
          actionGroups: result.actionGroups,
          totalCount: result.totalCount,
        },
      });
    } catch (error) {
      logger.error("Error listing action groups:", error);
      res.status(500).json({
        success: false,
        error: "Failed to list action groups",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/agent-info:
 *   get:
 *     summary: Get agent information
 *     description: Get information about the current Bedrock agent
 *     tags: [Action Groups]
 *     responses:
 *       200:
 *         description: Agent information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     agent:
 *                       type: object
 *                       properties:
 *                         agentId:
 *                           type: string
 *                         agentName:
 *                           type: string
 *                         status:
 *                           type: string
 *                         configured:
 *                           type: boolean
 *                         actionGroupsCount:
 *                           type: integer
 */
router.get("/agent-info", async (req, res) => {
  try {
    const agentInfo = await actionGroupService.getAgentInfo();

    res.json({
      success: true,
      data: {
        agent: agentInfo,
      },
    });
  } catch (error) {
    logger.error("Error getting agent info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get agent information",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/aliases/latest:
 *   get:
 *     summary: Get the latest agent alias
 *     description: Fetch the most recently updated agent alias for the current agent
 *     tags: [Action Groups]
 *     responses:
 *       200:
 *         description: Action group schema definition
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     schemas:
 *                       type: object
 *                       description: Complete schema definitions
 *                     version:
 *                       type: string
 *                       example: "1.0.0"
 *                     endpoints:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Available action group endpoints
 */
router.get("/schema", async (req, res) => {
  try {
    const schemas = {
      ActionGroup: {
        type: "object",
        properties: {
          actionGroupId: {
            type: "string",
            description: "Action group identifier",
          },
          actionGroupName: {
            type: "string",
            description: "Action group name",
          },
          description: {
            type: "string",
            description: "Action group description",
          },
          actionGroupState: {
            type: "string",
            enum: ["ENABLED", "DISABLED"],
            description: "Action group state",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "Last update timestamp",
          },
          agentId: {
            type: "string",
            description: "Associated agent ID",
          },
          lambdaArn: {
            type: "string",
            description: "Lambda function ARN for execution",
          },
          apiSchema: {
            type: "object",
            description: "OpenAPI schema for the action group",
          },
        },
      },
      ApiConfiguration: {
        type: "object",
        required: ["apiName", "baseUrl", "endpoints"],
        properties: {
          apiName: {
            type: "string",
            description: "Name of the API",
            example: "Order Tracking API",
          },
          description: {
            type: "string",
            description: "API description",
          },
          baseUrl: {
            type: "string",
            format: "uri",
            description: "Base URL of the API",
          },
          endpoints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "API endpoint path",
                },
                method: {
                  type: "string",
                  enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
                },
                description: {
                  type: "string",
                },
                parameters: {
                  type: "array",
                  items: {
                    type: "object",
                  },
                },
              },
            },
          },
          authentication: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["none", "apiKey", "bearer", "basic"],
              },
            },
          },
        },
      },
    };

    const endpoints = [
      "GET /api/action-groups - List all action groups",
      "POST /api/action-groups/create - Create new action group",
      "GET /api/action-groups/{id} - Get specific action group",
      "PUT /api/action-groups/{id} - Update action group",
      "DELETE /api/action-groups/{id} - Delete action group",
      "GET /api/action-groups/{id}/config - Get action group with configuration",
      "POST /api/action-groups/{id}/test - Test action group",
      "GET /api/action-groups/{id}/history - Get execution history",
      "POST /api/action-groups/{id}/sync - Sync with agent",
      "POST /api/action-groups/preview-schema - Preview OpenAPI schema",
      "POST /api/action-groups/validate - Validate API configuration",
      "GET /api/action-groups/agent-info - Get agent information",
      "GET /api/action-groups/schema - Get schema definitions",
      "GET /api/action-groups/data - Get comprehensive data",
      "GET /api/action-groups/templates - Get configuration templates",
      "GET /api/action-groups/aliases/latest - Get latest agent alias",
    ];

    res.json({
      success: true,
      data: {
        schemas,
        version: "1.0.0",
        endpoints,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting action group schema:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get action group schema",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/data:
 *   get:
 *     summary: Get comprehensive action groups data
 *     description: Returns action groups with additional metadata, statistics, and health information
 *     tags: [Action Groups]
 *     parameters:
 *       - in: query
 *         name: includeStats
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include statistics and metadata
 *       - in: query
 *         name: includeHistory
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include execution history summary
 *     responses:
 *       200:
 *         description: Comprehensive action groups data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     actionGroups:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ActionGroup'
 *                     statistics:
 *                       type: object
 *                       properties:
 *                         totalActionGroups:
 *                           type: integer
 *                         enabledCount:
 *                           type: integer
 *                         disabledCount:
 *                           type: integer
 *                         recentlyCreated:
 *                           type: integer
 *                         averageExecutionsPerDay:
 *                           type: number
 *                     agentInfo:
 *                       type: object
 *                     systemHealth:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                         lastCheck:
 *                           type: string
 *                           format: date-time
 */
router.get("/data", async (req, res) => {
  try {
    const { includeStats = "true", includeHistory = "false" } = req.query;
    const includeStatsFlag = includeStats === "true";
    const includeHistoryFlag = includeHistory === "true";

    // Get basic action groups data
    const actionGroupsResult = await actionGroupService.listActionGroups();
    const actionGroups = actionGroupsResult.actionGroups;

    let statistics = null;
    if (includeStatsFlag) {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      statistics = {
        totalActionGroups: actionGroups.length,
        enabledCount: actionGroups.filter(
          (ag) => ag.actionGroupState === "ENABLED"
        ).length,
        disabledCount: actionGroups.filter(
          (ag) => ag.actionGroupState === "DISABLED"
        ).length,
        recentlyCreated: actionGroups.filter((ag) => {
          const createdAt = new Date(ag.createdAt || ag.updatedAt || 0);
          return createdAt > sevenDaysAgo;
        }).length,
        averageExecutionsPerDay: 0, // Would need execution tracking to calculate
        lastCalculated: now.toISOString(),
      };
    }

    // Get agent information
    const agentInfo = await actionGroupService.getAgentInfo();

    // Enhanced action groups with additional metadata
    const enhancedActionGroups = await Promise.all(
      actionGroups.map(async (ag) => {
        const enhanced = { ...ag };

        if (includeHistoryFlag) {
          try {
            const history = await actionGroupService.getExecutionHistory(
              ag.actionGroupId,
              5
            );
            enhanced.recentExecutions = history.length;
            enhanced.lastExecution =
              history.length > 0 ? history[0].timestamp : null;
          } catch (error) {
            enhanced.recentExecutions = 0;
            enhanced.lastExecution = null;
          }
        }

        // Add health status
        enhanced.healthStatus =
          ag.actionGroupState === "ENABLED" ? "healthy" : "disabled";

        return enhanced;
      })
    );

    const systemHealth = {
      status: agentInfo.status === "UNKNOWN" ? "warning" : "healthy",
      lastCheck: new Date().toISOString(),
      agentConfigured: agentInfo.configured,
      totalEndpoints: 16, // Number of available endpoints
    };

    res.json({
      success: true,
      data: {
        actionGroups: enhancedActionGroups,
        statistics: includeStatsFlag ? statistics : undefined,
        agentInfo,
        systemHealth,
        metadata: {
          generatedAt: new Date().toISOString(),
          includeStats: includeStatsFlag,
          includeHistory: includeHistoryFlag,
        },
      },
    });
  } catch (error) {
    logger.error("Error getting comprehensive action groups data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get comprehensive data",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/templates:
 *   get:
 *     summary: Get action group configuration templates
 *     description: Returns example configurations and templates for creating action groups
 *     tags: [Action Groups]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [simple, ecommerce, social, financial, all]
 *           default: all
 *         description: Type of templates to return
 *     responses:
 *       200:
 *         description: Configuration templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     templates:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           category:
 *                             type: string
 *                           description:
 *                             type: string
 *                           config:
 *                             $ref: '#/components/schemas/ApiConfiguration'
 */
router.get("/templates", async (req, res) => {
  try {
    const { type = "all" } = req.query;

    const allTemplates = {
      simple: {
        name: "Simple REST API",
        category: "basic",
        description: "Basic REST API template with common CRUD operations",
        config: {
          apiName: "Simple API",
          description: "A basic REST API for demonstration purposes",
          baseUrl: "https://api.example.com",
          endpoints: [
            {
              path: "/items",
              method: "GET",
              description: "Get all items",
              parameters: [
                {
                  name: "limit",
                  type: "integer",
                  location: "query",
                  required: false,
                  description: "Maximum number of items to return",
                },
              ],
              responseExample:
                '{"items": [{"id": 1, "name": "Item 1"}], "total": 1}',
            },
            {
              path: "/items/{id}",
              method: "GET",
              description: "Get item by ID",
              parameters: [
                {
                  name: "id",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Item ID",
                },
              ],
              responseExample:
                '{"id": "1", "name": "Item 1", "status": "active"}',
            },
          ],
          authentication: {
            type: "none",
          },
        },
      },
      ecommerce: {
        name: "E-commerce Order Tracking",
        category: "ecommerce",
        description:
          "Order tracking and management API for e-commerce platforms",
        config: {
          apiName: "E-commerce Order API",
          description: "API for tracking orders, payments, and shipments",
          baseUrl: "https://api.ecommerce-store.com",
          endpoints: [
            {
              path: "/orders/{orderId}",
              method: "GET",
              description: "Get order details by ID",
              parameters: [
                {
                  name: "orderId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Order ID to track",
                },
              ],
              responseExample:
                '{"orderId": "ORD123", "status": "shipped", "items": 3, "total": 299.99}',
            },
            {
              path: "/orders/{orderId}/status",
              method: "GET",
              description: "Get order status",
              parameters: [
                {
                  name: "orderId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Order ID",
                },
              ],
              responseExample:
                '{"status": "shipped", "trackingNumber": "TR123456", "estimatedDelivery": "2024-01-25"}',
            },
          ],
          authentication: {
            type: "apiKey",
            location: "header",
            name: "X-API-Key",
            value: "your-api-key-here",
          },
        },
      },
      social: {
        name: "Social Media Analytics",
        category: "social",
        description: "Social media analytics and engagement tracking API",
        config: {
          apiName: "Social Analytics API",
          description: "Track social media posts, engagement, and analytics",
          baseUrl: "https://api.socialanalytics.com",
          endpoints: [
            {
              path: "/posts/{postId}/analytics",
              method: "GET",
              description: "Get post analytics",
              parameters: [
                {
                  name: "postId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Social media post ID",
                },
              ],
              responseExample:
                '{"likes": 150, "shares": 25, "comments": 30, "reach": 5000}',
            },
            {
              path: "/user/{userId}/engagement",
              method: "GET",
              description: "Get user engagement metrics",
              parameters: [
                {
                  name: "userId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "User ID",
                },
              ],
              responseExample:
                '{"totalPosts": 45, "avgLikes": 120, "followerGrowth": 15}',
            },
          ],
          authentication: {
            type: "bearer",
            location: "header",
            name: "Authorization",
            value: "your-bearer-token-here",
          },
        },
      },
      financial: {
        name: "Financial Transactions",
        category: "financial",
        description: "Banking and financial transaction tracking API",
        config: {
          apiName: "Financial API",
          description: "Track transactions, balances, and financial data",
          baseUrl: "https://api.financialservice.com",
          endpoints: [
            {
              path: "/accounts/{accountId}/balance",
              method: "GET",
              description: "Get account balance",
              parameters: [
                {
                  name: "accountId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Account ID",
                },
              ],
              responseExample:
                '{"accountId": "ACC123", "balance": 2500.00, "currency": "USD"}',
            },
            {
              path: "/transactions/{transactionId}",
              method: "GET",
              description: "Get transaction details",
              parameters: [
                {
                  name: "transactionId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Transaction ID",
                },
              ],
              responseExample:
                '{"id": "TXN456", "amount": -50.00, "merchant": "Coffee Shop", "date": "2024-01-20"}',
            },
          ],
          authentication: {
            type: "apiKey",
            location: "header",
            name: "X-Bank-API-Key",
            value: "secure-bank-api-key",
          },
        },
      },
    };

    let templates = [];
    if (type === "all") {
      templates = Object.values(allTemplates);
    } else if (allTemplates[type]) {
      templates = [allTemplates[type]];
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid template type",
        validTypes: Object.keys(allTemplates).concat(["all"]),
      });
    }

    res.json({
      success: true,
      data: {
        templates,
        availableTypes: Object.keys(allTemplates),
        totalTemplates: templates.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting action group templates:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get templates",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/{actionGroupId}:
 *   get:
 *     summary: Get action group details
 *     description: Retrieve detailed information about a specific action group
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Action group details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ActionGroup'
 *       404:
 *         description: Action group not found
 */
router.get(
  "/:actionGroupId",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      const result = await actionGroupService.getActionGroup(actionGroupId);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: "Action group not found",
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Error getting action group:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get action group",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/debug:
 *   get:
 *     summary: Debug action group AWS response
 *     description: Debug endpoint to see raw AWS response for action group
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 */
router.get(
  "/:actionGroupId/debug",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const { actionGroupId } = req.params;

      // Direct AWS API call to see raw response
      const {
        BedrockAgentClient,
        GetAgentActionGroupCommand,
      } = require("@aws-sdk/client-bedrock-agent");
      const client = new BedrockAgentClient({
        region: process.env.AWS_REGION || "us-east-1",
      });

      const command = new GetAgentActionGroupCommand({
        agentId: process.env.BEDROCK_AGENT_ID,
        agentVersion: "DRAFT",
        actionGroupId: actionGroupId,
      });

      const rawResponse = await client.send(command);

      res.json({
        success: true,
        data: {
          actionGroupId: actionGroupId,
          rawResponse: rawResponse,
          responseKeys: Object.keys(rawResponse),
          actionGroupKeys: rawResponse.actionGroup
            ? Object.keys(rawResponse.actionGroup)
            : null,
          hasApiSchema: !!(
            rawResponse.actionGroup && rawResponse.actionGroup.apiSchema
          ),
          hasActionGroupExecutor: !!(
            rawResponse.actionGroup &&
            rawResponse.actionGroup.actionGroupExecutor
          ),
          apiSchema: rawResponse.actionGroup
            ? rawResponse.actionGroup.apiSchema
            : null,
          actionGroupExecutor: rawResponse.actionGroup
            ? rawResponse.actionGroup.actionGroupExecutor
            : null,
        },
      });
    } catch (error) {
      logger.error("Error in debug endpoint:", error);
      res.status(500).json({
        success: false,
        error: "Debug failed",
        message: error.message,
        stack: error.stack,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/schema:
 *   get:
 *     summary: Get action group OpenAPI schema
 *     description: Retrieve the OpenAPI schema for a specific action group
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Action group OpenAPI schema
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     actionGroupId:
 *                       type: string
 *                     actionGroupName:
 *                       type: string
 *                     openApiSchema:
 *                       type: object
 *                       description: The OpenAPI 3.0 schema for this action group
 *                     schemaVersion:
 *                       type: string
 *                       example: "3.0.0"
 *       404:
 *         description: Action group not found
 */
router.get(
  "/:actionGroupId/schema",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;

      // Use the exact same direct AWS call as the working debug endpoint
      const {
        BedrockAgentClient,
        GetAgentActionGroupCommand,
      } = require("@aws-sdk/client-bedrock-agent");
      const client = new BedrockAgentClient({
        region: process.env.AWS_REGION || "us-east-1",
      });

      const command = new GetAgentActionGroupCommand({
        agentId: process.env.BEDROCK_AGENT_ID,
        agentVersion: "DRAFT",
        actionGroupId: actionGroupId,
      });

      let rawResponse;
      let actionGroup;

      try {
        rawResponse = await client.send(command);
        actionGroup = rawResponse.agentActionGroup; // AWS returns 'agentActionGroup' not 'actionGroup'

        logger.info(`AWS response for ${actionGroupId}:`, {
          hasResponse: !!rawResponse,
          responseKeys: rawResponse ? Object.keys(rawResponse) : null,
          hasActionGroup: !!actionGroup,
          actionGroupKeys: actionGroup ? Object.keys(actionGroup) : null,
        });
      } catch (awsError) {
        logger.error(`AWS API error for ${actionGroupId}:`, {
          errorName: awsError.name,
          errorMessage: awsError.message,
          errorCode: awsError.$metadata?.httpStatusCode,
        });
        return res.status(500).json({
          success: false,
          error: "Failed to retrieve action group from AWS",
          message: awsError.message,
        });
      }

      if (!actionGroup) {
        logger.warn(`Action group ${actionGroupId} not found in AWS response`);
        return res.status(404).json({
          success: false,
          error: "Action group not found",
          rawResponse: rawResponse, // Add for debugging
        });
      }

      let openApiSchema = null;
      let debugInfo = {};

      // Debug: Log the full action group structure
      logger.info(`Action group structure for ${actionGroupId}:`, {
        keys: Object.keys(actionGroup),
        hasApiSchema: !!actionGroup.apiSchema,
        apiSchemaKeys: actionGroup.apiSchema
          ? Object.keys(actionGroup.apiSchema)
          : null,
      });

      // Try to extract the OpenAPI schema from the action group
      if (actionGroup.apiSchema && actionGroup.apiSchema.payload) {
        try {
          openApiSchema = JSON.parse(actionGroup.apiSchema.payload);
          debugInfo.parseSuccess = true;
          debugInfo.payloadLength = actionGroup.apiSchema.payload.length;
        } catch (error) {
          logger.warn(
            `Failed to parse OpenAPI schema for action group ${actionGroupId}:`,
            error.message
          );
          openApiSchema = {
            error: "Failed to parse schema",
            raw: actionGroup.apiSchema.payload,
          };
          debugInfo.parseError = error.message;
        }
      } else {
        // Check for alternative schema locations
        debugInfo.apiSchemaCheck = {
          hasApiSchema: !!actionGroup.apiSchema,
          hasPayload: !!(
            actionGroup.apiSchema && actionGroup.apiSchema.payload
          ),
          apiSchemaType: typeof actionGroup.apiSchema,
          payloadType: actionGroup.apiSchema
            ? typeof actionGroup.apiSchema.payload
            : null,
        };

        // Try alternative schema locations that might exist in AWS Bedrock
        if (actionGroup.functionSchema) {
          debugInfo.foundFunctionSchema = true;
          openApiSchema = actionGroup.functionSchema;
        } else if (
          actionGroup.actionGroupExecutor &&
          actionGroup.actionGroupExecutor.customControl
        ) {
          debugInfo.foundCustomControl = true;
        }
      }

      res.json({
        success: true,
        data: {
          actionGroupId: actionGroup.actionGroupId,
          actionGroupName: actionGroup.actionGroupName,
          openApiSchema: openApiSchema,
          schemaVersion: openApiSchema?.openapi || "Unknown",
          hasSchema: !!openApiSchema,
          retrievedAt: new Date().toISOString(),
          debugInfo: debugInfo,
          // Include raw action group data for debugging (remove in production)
          rawActionGroup: actionGroup,
        },
      });
    } catch (error) {
      logger.error("Error getting action group schema:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get action group schema",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/config:
 *   get:
 *     summary: Get action group with editable configuration
 *     description: Retrieve action group details with parsed API configuration for editing
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Action group with configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     actionGroupId:
 *                       type: string
 *                     actionGroupName:
 *                       type: string
 *                     apiConfig:
 *                       $ref: '#/components/schemas/ApiConfiguration'
 *                     editable:
 *                       type: boolean
 *                       description: Whether this action group can be edited
 *       404:
 *         description: Action group not found
 */
router.get(
  "/:actionGroupId/config",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      const result = await actionGroupService.getActionGroupWithConfig(
        actionGroupId
      );

      if (!result) {
        return res.status(404).json({
          success: false,
          error: "Action group not found",
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Error getting action group config:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get action group configuration",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}:
 *   put:
 *     summary: Update action group
 *     description: Update an existing action group configuration
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *                 description: Updated description
 *               actionGroupState:
 *                 type: string
 *                 enum: [ENABLED, DISABLED]
 *                 description: Action group state
 *               apiConfiguration:
 *                 $ref: '#/components/schemas/ApiConfiguration'
 *     responses:
 *       200:
 *         description: Action group updated successfully
 *       404:
 *         description: Action group not found
 */
router.put(
  "/:actionGroupId",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
    body("description").optional().isString(),
    body("actionGroupName").optional().isString(),
    body("apiConfig").optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      const updates = req.body;

      // Remove actionGroupState from updates - use dedicated enable/disable endpoints
      if (updates.actionGroupState) {
        delete updates.actionGroupState;
        logger.warn(
          "actionGroupState removed from update - use /enabled or /disabled endpoints"
        );
      }

      // If apiConfig is present, validate it
      if (updates.apiConfig) {
        const configValidation =
          await actionGroupService.validateApiConfiguration(updates.apiConfig);
        if (!configValidation.valid) {
          return res.status(400).json({
            success: false,
            error: "API configuration validation failed",
            details: configValidation.errors,
          });
        }
      }

      // Use the new editActionGroupConfig for full config update
      const result = await actionGroupService.editActionGroupConfig(
        actionGroupId,
        updates
      );

      res.json({
        success: true,
        message: "Action group updated successfully",
        data: result,
      });
    } catch (error) {
      logger.error("Error updating action group:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update action group",
        message: error.message,
      });
    }
  }
);
/**
 * @swagger
 * /api/action-groups/{actionGroupId}/enabled:
 *   post:
 *     summary: Enable action group
 *     description: Enable a specific action group
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Action group enabled successfully
 *       404:
 *         description: Action group not found
 */
router.post(
  "/:actionGroupId/enabled",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      logger.info(`🟢 ENABLE request for action group: ${actionGroupId}`);

      const result = await actionGroupService.enableActionGroup(actionGroupId);

      res.json({
        success: true,
        message: "Action group enabled successfully", 
      });
    } catch (error) {
      logger.error(`Error enabling action group ${req.params.actionGroupId}:`, {
        message: error.message,
        stack: error.stack,
      });

      let statusCode = 500;
      let errorMessage = "Failed to enable action group";

      if (error.message.includes("not found")) {
        statusCode = 404;
        errorMessage = "Action group not found";
      }

      res.status(statusCode).json({
        success: false,
        error: errorMessage,
        message: error.message,
        actionGroupId: req.params.actionGroupId,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/disable:
 *   post:
 *     summary: Disable action group
 *     description: Disable a specific action group
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Action group disabled successfully
 *       404:
 *         description: Action group not found
 */
router.post(
  "/:actionGroupId/disabled",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      logger.info(`🔴 DISABLE request for action group: ${actionGroupId}`);

      const result = await actionGroupService.disableActionGroup(actionGroupId);

      res.json({
        success: true,
        message: "Action group disabled successfully",
        data: result,
      });
    } catch (error) {
      logger.error(
        `Error disabling action group ${req.params.actionGroupId}:`,
        {
          message: error.message,
          stack: error.stack,
        }
      );

      let statusCode = 500;
      let errorMessage = "Failed to disable action group";

      if (error.message.includes("not found")) {
        statusCode = 404;
        errorMessage = "Action group not found";
      }

      res.status(statusCode).json({
        success: false,
        error: errorMessage,
        message: error.message,
        actionGroupId: req.params.actionGroupId,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}:
 *   delete:
 *     summary: Delete action group
 *     description: Delete an action group and clean up associated resources
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Action group deleted successfully
 *       404:
 *         description: Action group not found
 */
// actiongroup.js
router.delete(
  "/:actionGroupId",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      logger.info(
        `🗑️ DELETE request for action group: ${req.params.actionGroupId}`
      );

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.error("Validation errors:", errors.array());
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;

      if (!actionGroupId || actionGroupId.trim() === "") {
        logger.error("Empty action group ID provided");
        return res.status(400).json({
          success: false,
          error: "Invalid action group ID provided",
        });
      }

      logger.info(`Starting deletion of action group: ${actionGroupId}`);

      const result = await actionGroupService.deleteActionGroup(actionGroupId);

      logger.info(`Successfully deleted action group: ${actionGroupId}`);

      res.json({
        success: true,
        message: "Action group deleted successfully",
        data: {
          actionGroupId: result.actionGroupId || actionGroupId,
          deleted: result.deleted,
          deletedAt: result.deletedAt || new Date().toISOString(),
          reason: result.reason,
        },
      });
    } catch (error) {
      logger.error(
        `Error in DELETE route for action group ${req.params.actionGroupId}:`,
        {
          error: error.message,
          stack: error.stack,
          params: req.params,
        }
      );

      let statusCode = 500;
      let errorMessage = "Failed to delete action group";

      if (
        error.message.includes("not found") ||
        error.message.includes("ResourceNotFoundException")
      ) {
        statusCode = 404;
        errorMessage = "Action group not found";
      }

      res.status(statusCode).json({
        success: false,
        error: errorMessage,
        message: error.message,
        details: {
          actionGroupId: req.params.actionGroupId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/test:
 *   post:
 *     summary: Test action group
 *     description: Test an action group with sample data
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               testMessage:
 *                 type: string
 *                 description: Test message for the agent
 *                 example: "What is the status of order 12345?"
 *               parameters:
 *                 type: object
 *                 description: Test parameters
 *     responses:
 *       200:
 *         description: Test results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     testResult:
 *                       type: string
 *                       description: Test execution result
 *                     executionTime:
 *                       type: number
 *                       description: Execution time in milliseconds
 *                     lambdaResponse:
 *                       type: object
 *                       description: Lambda function response
 */
router.post(
  "/:actionGroupId/test",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      const { testMessage, parameters } = req.body;

      const result = await actionGroupService.testActionGroup(actionGroupId, {
        testMessage,
        parameters,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Error testing action group:", error);
      res.status(500).json({
        success: false,
        error: "Failed to test action group",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/preview-schema:
 *   post:
 *     summary: Preview OpenAPI schema
 *     description: Generate and preview OpenAPI schema without creating action group
 *     tags: [Action Groups]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiConfiguration'
 *     responses:
 *       200:
 *         description: Generated OpenAPI schema
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     openApiSchema:
 *                       type: object
 *                       description: Generated OpenAPI 3.0 schema
 *                     validation:
 *                       type: object
 *                       properties:
 *                         valid:
 *                           type: boolean
 *                         errors:
 *                           type: array
 *                           items:
 *                             type: string
 */
router.post(
  "/preview-schema",
  [
    body("apiName").notEmpty().withMessage("API name is required"),
    body("baseUrl").isURL().withMessage("Valid base URL is required"),
    body("endpoints")
      .isArray({ min: 1 })
      .withMessage("At least one endpoint is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const apiConfig = req.body;

      // Generate OpenAPI schema
      const openApiSchema = await openApiGeneratorService.generateSchema(
        apiConfig
      );

      // Validate the generated schema
      const validation = await openApiGeneratorService.validateSchema(
        openApiSchema
      );

      res.json({
        success: true,
        data: {
          openApiSchema,
          validation,
        },
      });
    } catch (error) {
      logger.error("Error generating schema preview:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate schema preview",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/validate:
 *   post:
 *     summary: Validate API configuration
 *     description: Validate API configuration before creating action group
 *     tags: [Action Groups]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApiConfiguration'
 *     responses:
 *       200:
 *         description: Validation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     valid:
 *                       type: boolean
 *                       example: true
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     warnings:
 *                       type: array
 *                       items:
 *                         type: string
 *                     suggestions:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.post("/validate", async (req, res) => {
  try {
    const apiConfig = req.body;
    const validation = await actionGroupService.validateApiConfiguration(
      apiConfig
    );

    res.json({
      success: true,
      data: validation,
    });
  } catch (error) {
    logger.error("Error validating API configuration:", error);
    res.status(500).json({
      success: false,
      error: "Failed to validate API configuration",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/history:
 *   get:
 *     summary: Get action group execution history
 *     description: Retrieve execution history for an action group
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of records to return
 *     responses:
 *       200:
 *         description: Execution history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     executions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           executionId:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                           function:
 *                             type: string
 *                           parameters:
 *                             type: object
 *                           result:
 *                             type: object
 *                           duration:
 *                             type: number
 *                           status:
 *                             type: string
 */
router.get(
  "/:actionGroupId/history",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      const { limit = 50 } = req.query;

      const history = await actionGroupService.getExecutionHistory(
        actionGroupId,
        limit
      );

      res.json({
        success: true,
        data: {
          executions: history,
        },
      });
    } catch (error) {
      logger.error("Error getting execution history:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get execution history",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/{actionGroupId}/sync:
 *   post:
 *     summary: Sync action group with agent
 *     description: Synchronize action group changes with the Bedrock agent
 *     tags: [Action Groups]
 *     parameters:
 *       - in: path
 *         name: actionGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Action group ID
 *     responses:
 *       200:
 *         description: Sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Action group synchronized successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     syncStatus:
 *                       type: string
 *                     agentStatus:
 *                       type: string
 *                     syncedAt:
 *                       type: string
 *                       format: date-time
 */
router.post(
  "/:actionGroupId/sync",
  [
    param("actionGroupId")
      .notEmpty()
      .withMessage("Action group ID is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { actionGroupId } = req.params;
      const result = await actionGroupService.syncActionGroupWithAgent(
        actionGroupId
      );

      res.json({
        success: true,
        message: "Action group synchronized successfully",
        data: result,
      });
    } catch (error) {
      logger.error("Error syncing action group:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync action group",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/action-groups/schema:
 *   get:
 *     summary: Get action group schema definition
 *     description: Returns the complete OpenAPI schema definition for action groups and related data structures
 *     tags: [Action Groups]
 *     responses:
 *       200:
 *         description: Action group schema definition
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     schemas:
 *                       type: object
 *                       description: Complete schema definitions
 *                     version:
 *                       type: string
 *                       example: "1.0.0"
 *                     endpoints:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Available action group endpoints
 */
router.get("/schema", async (req, res) => {
  try {
    const schemas = {
      ActionGroup: {
        type: "object",
        properties: {
          actionGroupId: {
            type: "string",
            description: "Action group identifier",
          },
          actionGroupName: {
            type: "string",
            description: "Action group name",
          },
          description: {
            type: "string",
            description: "Action group description",
          },
          actionGroupState: {
            type: "string",
            enum: ["ENABLED", "DISABLED"],
            description: "Action group state",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "Last update timestamp",
          },
          agentId: {
            type: "string",
            description: "Associated agent ID",
          },
          lambdaArn: {
            type: "string",
            description: "Lambda function ARN for execution",
          },
          apiSchema: {
            type: "object",
            description: "OpenAPI schema for the action group",
          },
        },
      },
      ApiConfiguration: {
        type: "object",
        required: ["apiName", "baseUrl", "endpoints"],
        properties: {
          apiName: {
            type: "string",
            description: "Name of the API",
            example: "Order Tracking API",
          },
          description: {
            type: "string",
            description: "API description",
          },
          baseUrl: {
            type: "string",
            format: "uri",
            description: "Base URL of the API",
          },
          endpoints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "API endpoint path",
                },
                method: {
                  type: "string",
                  enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
                },
                description: {
                  type: "string",
                },
                parameters: {
                  type: "array",
                  items: {
                    type: "object",
                  },
                },
              },
            },
          },
          authentication: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["none", "apiKey", "bearer", "basic"],
              },
            },
          },
        },
      },
    };

    const endpoints = [
      "GET /api/action-groups - List all action groups",
      "POST /api/action-groups/create - Create new action group",
      "GET /api/action-groups/{id} - Get specific action group",
      "PUT /api/action-groups/{id} - Update action group",
      "DELETE /api/action-groups/{id} - Delete action group",
      "GET /api/action-groups/{id}/config - Get action group with configuration",
      "POST /api/action-groups/{id}/test - Test action group",
      "GET /api/action-groups/{id}/history - Get execution history",
      "POST /api/action-groups/{id}/sync - Sync with agent",
      "POST /api/action-groups/preview-schema - Preview OpenAPI schema",
      "POST /api/action-groups/validate - Validate API configuration",
      "GET /api/action-groups/agent-info - Get agent information",
      "GET /api/action-groups/schema - Get schema definitions",
      "GET /api/action-groups/data - Get comprehensive data",
      "GET /api/action-groups/templates - Get configuration templates",
      "GET /api/action-groups/aliases/latest - Get latest agent alias",
    ];

    res.json({
      success: true,
      data: {
        schemas,
        version: "1.0.0",
        endpoints,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting action group schema:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get action group schema",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/data:
 *   get:
 *     summary: Get comprehensive action groups data
 *     description: Returns action groups with additional metadata, statistics, and health information
 *     tags: [Action Groups]
 *     parameters:
 *       - in: query
 *         name: includeStats
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include statistics and metadata
 *       - in: query
 *         name: includeHistory
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include execution history summary
 *     responses:
 *       200:
 *         description: Comprehensive action groups data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     actionGroups:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ActionGroup'
 *                     statistics:
 *                       type: object
 *                       properties:
 *                         totalActionGroups:
 *                           type: integer
 *                         enabledCount:
 *                           type: integer
 *                         disabledCount:
 *                           type: integer
 *                         recentlyCreated:
 *                           type: integer
 *                         averageExecutionsPerDay:
 *                           type: number
 *                     agentInfo:
 *                       type: object
 *                     systemHealth:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                         lastCheck:
 *                           type: string
 *                           format: date-time
 */
router.get("/data", async (req, res) => {
  try {
    const { includeStats = "true", includeHistory = "false" } = req.query;
    const includeStatsFlag = includeStats === "true";
    const includeHistoryFlag = includeHistory === "true";

    // Get basic action groups data
    const actionGroupsResult = await actionGroupService.listActionGroups();
    const actionGroups = actionGroupsResult.actionGroups;

    let statistics = null;
    if (includeStatsFlag) {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      statistics = {
        totalActionGroups: actionGroups.length,
        enabledCount: actionGroups.filter(
          (ag) => ag.actionGroupState === "ENABLED"
        ).length,
        disabledCount: actionGroups.filter(
          (ag) => ag.actionGroupState === "DISABLED"
        ).length,
        recentlyCreated: actionGroups.filter((ag) => {
          const createdAt = new Date(ag.createdAt || ag.updatedAt || 0);
          return createdAt > sevenDaysAgo;
        }).length,
        averageExecutionsPerDay: 0, // Would need execution tracking to calculate
        lastCalculated: now.toISOString(),
      };
    }

    // Get agent information
    const agentInfo = await actionGroupService.getAgentInfo();

    // Enhanced action groups with additional metadata
    const enhancedActionGroups = await Promise.all(
      actionGroups.map(async (ag) => {
        const enhanced = { ...ag };

        if (includeHistoryFlag) {
          try {
            const history = await actionGroupService.getExecutionHistory(
              ag.actionGroupId,
              5
            );
            enhanced.recentExecutions = history.length;
            enhanced.lastExecution =
              history.length > 0 ? history[0].timestamp : null;
          } catch (error) {
            enhanced.recentExecutions = 0;
            enhanced.lastExecution = null;
          }
        }

        // Add health status
        enhanced.healthStatus =
          ag.actionGroupState === "ENABLED" ? "healthy" : "disabled";

        return enhanced;
      })
    );

    const systemHealth = {
      status: agentInfo.status === "UNKNOWN" ? "warning" : "healthy",
      lastCheck: new Date().toISOString(),
      agentConfigured: agentInfo.configured,
      totalEndpoints: 16, // Number of available endpoints
    };

    res.json({
      success: true,
      data: {
        actionGroups: enhancedActionGroups,
        statistics: includeStatsFlag ? statistics : undefined,
        agentInfo,
        systemHealth,
        metadata: {
          generatedAt: new Date().toISOString(),
          includeStats: includeStatsFlag,
          includeHistory: includeHistoryFlag,
        },
      },
    });
  } catch (error) {
    logger.error("Error getting comprehensive action groups data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get comprehensive data",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/templates:
 *   get:
 *     summary: Get action group configuration templates
 *     description: Returns example configurations and templates for creating action groups
 *     tags: [Action Groups]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [simple, ecommerce, social, financial, all]
 *           default: all
 *         description: Type of templates to return
 *     responses:
 *       200:
 *         description: Configuration templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     templates:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           category:
 *                             type: string
 *                           description:
 *                             type: string
 *                           config:
 *                             $ref: '#/components/schemas/ApiConfiguration'
 */
router.get("/templates", async (req, res) => {
  try {
    const { type = "all" } = req.query;

    const allTemplates = {
      simple: {
        name: "Simple REST API",
        category: "basic",
        description: "Basic REST API template with common CRUD operations",
        config: {
          apiName: "Simple API",
          description: "A basic REST API for demonstration purposes",
          baseUrl: "https://api.example.com",
          endpoints: [
            {
              path: "/items",
              method: "GET",
              description: "Get all items",
              parameters: [
                {
                  name: "limit",
                  type: "integer",
                  location: "query",
                  required: false,
                  description: "Maximum number of items to return",
                },
              ],
              responseExample:
                '{"items": [{"id": 1, "name": "Item 1"}], "total": 1}',
            },
            {
              path: "/items/{id}",
              method: "GET",
              description: "Get item by ID",
              parameters: [
                {
                  name: "id",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Item ID",
                },
              ],
              responseExample:
                '{"id": "1", "name": "Item 1", "status": "active"}',
            },
          ],
          authentication: {
            type: "none",
          },
        },
      },
      ecommerce: {
        name: "E-commerce Order Tracking",
        category: "ecommerce",
        description:
          "Order tracking and management API for e-commerce platforms",
        config: {
          apiName: "E-commerce Order API",
          description: "API for tracking orders, payments, and shipments",
          baseUrl: "https://api.ecommerce-store.com",
          endpoints: [
            {
              path: "/orders/{orderId}",
              method: "GET",
              description: "Get order details by ID",
              parameters: [
                {
                  name: "orderId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Order ID to track",
                },
              ],
              responseExample:
                '{"orderId": "ORD123", "status": "shipped", "items": 3, "total": 299.99}',
            },
            {
              path: "/orders/{orderId}/status",
              method: "GET",
              description: "Get order status",
              parameters: [
                {
                  name: "orderId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Order ID",
                },
              ],
              responseExample:
                '{"status": "shipped", "trackingNumber": "TR123456", "estimatedDelivery": "2024-01-25"}',
            },
          ],
          authentication: {
            type: "apiKey",
            location: "header",
            name: "X-API-Key",
            value: "your-api-key-here",
          },
        },
      },
      social: {
        name: "Social Media Analytics",
        category: "social",
        description: "Social media analytics and engagement tracking API",
        config: {
          apiName: "Social Analytics API",
          description: "Track social media posts, engagement, and analytics",
          baseUrl: "https://api.socialanalytics.com",
          endpoints: [
            {
              path: "/posts/{postId}/analytics",
              method: "GET",
              description: "Get post analytics",
              parameters: [
                {
                  name: "postId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Social media post ID",
                },
              ],
              responseExample:
                '{"likes": 150, "shares": 25, "comments": 30, "reach": 5000}',
            },
            {
              path: "/user/{userId}/engagement",
              method: "GET",
              description: "Get user engagement metrics",
              parameters: [
                {
                  name: "userId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "User ID",
                },
              ],
              responseExample:
                '{"totalPosts": 45, "avgLikes": 120, "followerGrowth": 15}',
            },
          ],
          authentication: {
            type: "bearer",
            location: "header",
            name: "Authorization",
            value: "your-bearer-token-here",
          },
        },
      },
      financial: {
        name: "Financial Transactions",
        category: "financial",
        description: "Banking and financial transaction tracking API",
        config: {
          apiName: "Financial API",
          description: "Track transactions, balances, and financial data",
          baseUrl: "https://api.financialservice.com",
          endpoints: [
            {
              path: "/accounts/{accountId}/balance",
              method: "GET",
              description: "Get account balance",
              parameters: [
                {
                  name: "accountId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Account ID",
                },
              ],
              responseExample:
                '{"accountId": "ACC123", "balance": 2500.00, "currency": "USD"}',
            },
            {
              path: "/transactions/{transactionId}",
              method: "GET",
              description: "Get transaction details",
              parameters: [
                {
                  name: "transactionId",
                  type: "string",
                  location: "path",
                  required: true,
                  description: "Transaction ID",
                },
              ],
              responseExample:
                '{"id": "TXN456", "amount": -50.00, "merchant": "Coffee Shop", "date": "2024-01-20"}',
            },
          ],
          authentication: {
            type: "apiKey",
            location: "header",
            name: "X-Bank-API-Key",
            value: "secure-bank-api-key",
          },
        },
      },
    };

    let templates = [];
    if (type === "all") {
      templates = Object.values(allTemplates);
    } else if (allTemplates[type]) {
      templates = [allTemplates[type]];
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid template type",
        validTypes: Object.keys(allTemplates).concat(["all"]),
      });
    }

    res.json({
      success: true,
      data: {
        templates,
        availableTypes: Object.keys(allTemplates),
        totalTemplates: templates.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting action group templates:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get templates",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/action-groups/aliases/latest:
 *   get:
 *     summary: Get the latest agent alias
 *     description: Fetch the most recently updated agent alias for the current agent
 *     tags: [Action Groups]
 *     responses:
 *       200:
 *         description: Latest agent alias
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     aliasId:
 *                       type: string
 *                     aliasName:
 *                       type: string
 *                     status:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                     updatedAt:
 *                       type: string
 *       404:
 *         description: No aliases found
 *       500:
 *         description: Server error
 */
// Get the latest agent alias (by updatedAt/createdAt)
router.get("/aliases/latest", async (req, res) => {
  try {
    const latestAlias = await actionGroupService.getLatestAgentAlias();
    if (!latestAlias) {
      return res.status(404).json({
        success: false,
        error: "No aliases found",
      });
    }
    res.json({
      success: true,
      data: latestAlias,
    });
  } catch (error) {
    logger.error("Error fetching latest agent alias:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch latest agent alias",
      message: error.message,
    });
  }
});

// Catch-all error handler for async errors
router.use((err, req, res, next) => {
  logger.error("Unhandled error in actionGroups route:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: err && err.message ? err.message : "Unknown error",
  });
});

module.exports = router;
