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

    body("baseUrl").isURL().withMessage("Valid base URL is required"),

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
    body("actionGroupState").optional().isIn(["ENABLED", "DISABLED"]),
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

      const result = await actionGroupService.updateActionGroup(
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
router.delete(
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
      await actionGroupService.deleteActionGroup(actionGroupId);

      res.json({
        success: true,
        message: "Action group deleted successfully",
      });
    } catch (error) {
      logger.error("Error deleting action group:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete action group",
        message: error.message,
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

module.exports = router;
