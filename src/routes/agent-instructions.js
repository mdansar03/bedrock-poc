const express = require('express');
const { body, validationResult } = require('express-validator');
const { BedrockAgentClient, GetAgentCommand, UpdateAgentCommand, PrepareAgentCommand } = require('@aws-sdk/client-bedrock-agent');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize Bedrock Agent Client
const bedrockAgentClient = new BedrockAgentClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  maxAttempts: 3,
});

// Default agent instructions
const DEFAULT_INSTRUCTIONS = `You are an intelligent AI assistant with access to a comprehensive knowledge base containing documents, PDFs, and website content. Your primary role is to provide accurate, helpful responses based on the information available in your knowledge base.

CORE RESPONSIBILITIES:
- Search the knowledge base thoroughly for relevant information
- Provide accurate answers based on available content
- Cite sources when referencing specific documents or information
- Be transparent about what information is or isn't available
- Maintain a helpful and professional tone

RESPONSE GUIDELINES:
- Always search your knowledge base before responding
- Provide comprehensive answers when information is available
- If information is not available, clearly state this limitation
- Include relevant examples or context when helpful
- Structure your responses clearly and logically

When users ask questions, search your knowledge base for relevant information and provide the best possible answer based on the available content.`;

/**
 * @swagger
 * /api/agent-instructions/current:
 *   get:
 *     summary: Get current agent instructions
 *     description: Retrieve the current instructions configured for the Bedrock Agent
 *     tags: [Agent Instructions]
 *     responses:
 *       200:
 *         description: Current instructions retrieved successfully
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
 *                     instructions:
 *                       type: string
 *                       example: "You are an intelligent AI assistant..."
 *                     agentId:
 *                       type: string
 *                       example: "A0KZ8F8S9T"
 *                     agentName:
 *                       type: string
 *                       example: "Knowledge Assistant"
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Agent not found or not configured
 *       500:
 *         description: Server error
 */
router.get('/current', async (req, res) => {
  try {
    const agentId = process.env.BEDROCK_AGENT_ID;
    
    if (!agentId) {
      return res.status(404).json({
        success: false,
        error: 'Agent not configured',
        message: 'BEDROCK_AGENT_ID is not set in environment variables'
      });
    }

    // Get current agent details
    const command = new GetAgentCommand({ agentId });
    const response = await bedrockAgentClient.send(command);

    console.log(response.agent.instruction,"response.agent.instruction");
    
    res.json({
      success: true,
      data: {
        instructions: response.agent.instruction || DEFAULT_INSTRUCTIONS,
        agentId: response.agent.agentId,
        agentName: response.agent.agentName,
        agentStatus: response.agent.agentStatus,
        lastUpdated: response.agent.updatedAt
      }
    });

  } catch (error) {
    logger.error('Error getting current instructions:', error);
    
    if (error.name === 'ResourceNotFoundException') {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
        message: `Agent with ID ${process.env.BEDROCK_AGENT_ID} not found`
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to get current instructions',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/agent-instructions/update-default:
 *   post:
 *     summary: Update agent to use default instructions
 *     description: Sets the agent instructions to the predefined default instructions
 *     tags: [Agent Instructions]
 *     responses:
 *       200:
 *         description: Agent updated to default instructions successfully
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
 *                   example: "Agent updated to default instructions successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     agentId:
 *                       type: string
 *                       example: "A0KZ8F8S9T"
 *                     instructions:
 *                       type: string
 *                       example: "You are an intelligent AI assistant..."
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Server error
 */
router.post('/update-default', async (req, res) => {
  try {
    const agentId = process.env.BEDROCK_AGENT_ID;
    
    if (!agentId) {
      return res.status(404).json({
        success: false,
        error: 'Agent not configured',
        message: 'BEDROCK_AGENT_ID is not set in environment variables'
      });
    }

    // Get current agent configuration
    const getCommand = new GetAgentCommand({ agentId });
    const currentAgent = await bedrockAgentClient.send(getCommand);

    // Update with default instructions
    const updateCommand = new UpdateAgentCommand({
      agentId,
      agentName: currentAgent.agent.agentName,
      description: currentAgent.agent.description,
      instruction: DEFAULT_INSTRUCTIONS,
      foundationModel: currentAgent.agent.foundationModel,
      agentResourceRoleArn: currentAgent.agent.agentResourceRoleArn,
      idleSessionTTLInSeconds: currentAgent.agent.idleSessionTTLInSeconds
    });

    const updateResponse = await bedrockAgentClient.send(updateCommand);
    
    // Prepare the agent to make changes effective
    const prepareCommand = new PrepareAgentCommand({ agentId });
    await bedrockAgentClient.send(prepareCommand);
    
    logger.info(`Agent ${agentId} updated to default instructions`);
    
    res.json({
      success: true,
      message: 'Agent updated to default instructions successfully',
      data: {
        agentId: updateResponse.agent.agentId,
        instructions: DEFAULT_INSTRUCTIONS,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error updating to default instructions:', error);
    
    if (error.name === 'ResourceNotFoundException') {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
        message: `Agent with ID ${process.env.BEDROCK_AGENT_ID} not found`
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to update to default instructions',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/agent-instructions/update-custom:
 *   post:
 *     summary: Update agent with custom instructions
 *     description: Sets custom user-defined instructions for the agent
 *     tags: [Agent Instructions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - instructions
 *             properties:
 *               instructions:
 *                 type: string
 *                 minLength: 50
 *                 maxLength: 5000
 *                 description: The custom instructions for the agent
 *                 example: "You are a specialized AI assistant focused on technical documentation..."
 *     responses:
 *       200:
 *         description: Agent updated with custom instructions successfully
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
 *                   example: "Agent updated with custom instructions successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     agentId:
 *                       type: string
 *                       example: "A0KZ8F8S9T"
 *                     instructions:
 *                       type: string
 *                       example: "Your custom instructions..."
 *                     instructionsLength:
 *                       type: number
 *                       example: 1250
 *       400:
 *         description: Validation error
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Server error
 */
router.post('/update-custom', [
  body('instructions')
    .isString()
    .isLength({ min: 50, max: 5000 })
    .withMessage('Instructions must be between 50 and 5000 characters')
    .trim()
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const agentId = process.env.BEDROCK_AGENT_ID;
    const { instructions } = req.body;
    
    if (!agentId) {
      return res.status(404).json({
        success: false,
        error: 'Agent not configured',
        message: 'BEDROCK_AGENT_ID is not set in environment variables'
      });
    }

    // Get current agent configuration
    const getCommand = new GetAgentCommand({ agentId });
    const currentAgent = await bedrockAgentClient.send(getCommand);

    // Update with custom instructions
    const updateCommand = new UpdateAgentCommand({
      agentId,
      agentName: currentAgent.agent.agentName,
      description: currentAgent.agent.description,
      instruction: instructions,
      foundationModel: currentAgent.agent.foundationModel,
      agentResourceRoleArn: currentAgent.agent.agentResourceRoleArn,
      idleSessionTTLInSeconds: currentAgent.agent.idleSessionTTLInSeconds
    });

    const updateResponse = await bedrockAgentClient.send(updateCommand);
    
    // Prepare the agent to make changes effective
    const prepareCommand = new PrepareAgentCommand({ agentId });
    await bedrockAgentClient.send(prepareCommand);
    
    logger.info(`Agent ${agentId} updated with custom instructions`);
    
    res.json({
      success: true,
      message: 'Agent updated with custom instructions successfully',
      data: {
        agentId: updateResponse.agent.agentId,
        instructions: instructions,
        instructionsLength: instructions.length,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error updating with custom instructions:', error);
    
    if (error.name === 'ResourceNotFoundException') {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
        message: `Agent with ID ${process.env.BEDROCK_AGENT_ID} not found`
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to update with custom instructions',
      message: error.message
    });
  }
});

module.exports = router;
