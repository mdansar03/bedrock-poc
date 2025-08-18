const { 
  BedrockAgentClient, 
  CreateAgentCommand, 
  UpdateAgentCommand, 
  PrepareAgentCommand,
  CreateAgentAliasCommand,
  UpdateAgentAliasCommand,
  AssociateAgentKnowledgeBaseCommand,
  CreateAgentActionGroupCommand,
  ListAgentsCommand,
  GetAgentCommand
} = require('@aws-sdk/client-bedrock-agent');

const logger = require('./logger');

/**
 * Bedrock Agent Setup and Configuration Utility
 * Handles the creation, configuration, and management of Bedrock Agents
 */
class AgentSetupUtility {
  constructor() {
    this.agentClient = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });

    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    this.foundationModel = process.env.DEFAULT_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
    this.serviceRole = process.env.BEDROCK_AGENT_SERVICE_ROLE; // IAM role for the agent
  }

  /**
   * Create a comprehensive Bedrock Agent with knowledge base integration
   * @param {Object} agentConfig - Agent configuration
   * @returns {Promise<Object>} - Created agent details
   */
  async createKnowledgeAgent(agentConfig = {}) {
    try {
      const {
        agentName = 'Knowledge-Assistant-Agent',
        description = 'Intelligent assistant agent with access to knowledge base for comprehensive question answering',
        instructions = this.getDefaultAgentInstructions(),
        idleSessionTTLInSeconds = 1800, // 30 minutes
        customerEncryptionKeyArn = null,
        tags = {}
      } = agentConfig;

      logger.info('Creating Bedrock Agent with knowledge base integration...');

      // Validate required configuration
      if (!this.serviceRole) {
        throw new Error('BEDROCK_AGENT_SERVICE_ROLE environment variable is required');
      }

      if (!this.knowledgeBaseId) {
        throw new Error('BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
      }

      // Create the agent
      const createAgentCommand = new CreateAgentCommand({
        agentName,
        description,
        foundationModel: this.foundationModel,
        instruction: instructions,
        agentResourceRoleArn: this.serviceRole,
        idleSessionTTLInSeconds,
        customerEncryptionKeyArn,
        tags: Object.entries(tags).map(([key, value]) => ({ key, value }))
      });

      logger.debug('Creating agent with configuration:', {
        agentName,
        foundationModel: this.foundationModel,
        serviceRole: this.serviceRole,
        idleSessionTTL: idleSessionTTLInSeconds
      });

      const agentResponse = await this.agentClient.send(createAgentCommand);
      const agentId = agentResponse.agent.agentId;

      logger.info(`Agent created successfully with ID: ${agentId}`);

      // Associate knowledge base with the agent
      await this.associateKnowledgeBase(agentId);

      // Create action group for knowledge base queries (optional)
      await this.createKnowledgeActionGroup(agentId);

      // Prepare the agent
      const preparedAgent = await this.prepareAgent(agentId);

      // Create agent alias
      const agentAlias = await this.createAgentAlias(agentId, 'production');

      logger.info('Agent setup completed successfully', {
        agentId,
        agentAliasId: agentAlias.agentAliasId,
        status: preparedAgent.agentStatus
      });

      return {
        agentId,
        agentAliasId: agentAlias.agentAliasId,
        agentName,
        status: preparedAgent.agentStatus,
        knowledgeBaseId: this.knowledgeBaseId,
        foundationModel: this.foundationModel,
        createdAt: agentResponse.agent.createdAt,
        setupComplete: true
      };

    } catch (error) {
      logger.error('Failed to create knowledge agent:', error);
      throw new Error(`Agent creation failed: ${error.message}`);
    }
  }



  /**
   * Associate knowledge base with the agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} - Association result
   */
  async associateKnowledgeBase(agentId) {
    try {
      logger.info(`Associating knowledge base ${this.knowledgeBaseId} with agent ${agentId}...`);

      const associateCommand = new AssociateAgentKnowledgeBaseCommand({
        agentId,
        agentVersion: 'DRAFT',
        knowledgeBaseId: this.knowledgeBaseId,
        description: 'Primary knowledge base for agent queries',
        knowledgeBaseState: 'ENABLED'
      });

      const response = await this.agentClient.send(associateCommand);
      
      logger.info('Knowledge base associated successfully with agent');
      
      return response.agentKnowledgeBase;

    } catch (error) {
      logger.error('Failed to associate knowledge base with agent:', error);
      throw new Error(`Knowledge base association failed: ${error.message}`);
    }
  }

  /**
   * Create action group for knowledge base operations
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} - Action group details
   */
  async createKnowledgeActionGroup(agentId) {
    try {
      logger.info('Creating knowledge action group for agent...');

      const actionGroupCommand = new CreateAgentActionGroupCommand({
        agentId,
        agentVersion: 'DRAFT',
        actionGroupName: 'KnowledgeBaseActions',
        description: 'Actions for querying and retrieving information from the knowledge base',
        actionGroupState: 'ENABLED',
        // Define the action group schema
        actionGroupExecutor: {
          // This would be configured based on your specific needs
          // For basic knowledge retrieval, the default agent capabilities might be sufficient
        }
      });

      const response = await this.agentClient.send(actionGroupCommand);
      
      logger.info('Knowledge action group created successfully');
      
      return response.agentActionGroup;

    } catch (error) {
      logger.warn('Failed to create action group (this is optional):', error.message);
      // Action groups are optional for basic knowledge base queries
      return null;
    }
  }

  /**
   * Prepare the agent for use
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} - Prepared agent details
   */
  async prepareAgent(agentId) {
    try {
      logger.info(`Preparing agent ${agentId}...`);

      const prepareCommand = new PrepareAgentCommand({
        agentId
      });

      const response = await this.agentClient.send(prepareCommand);
      
      logger.info('Agent prepared successfully', {
        agentId,
        status: response.agentStatus,
        preparedAt: response.preparedAt
      });
      
      return response;

    } catch (error) {
      logger.error('Failed to prepare agent:', error);
      throw new Error(`Agent preparation failed: ${error.message}`);
    }
  }

  /**
   * Create an agent alias
   * @param {string} agentId - Agent ID
   * @param {string} aliasName - Alias name
   * @returns {Promise<Object>} - Agent alias details
   */
  async createAgentAlias(agentId, aliasName = 'production') {
    try {
      logger.info(`Creating agent alias: ${aliasName}`);

      const aliasCommand = new CreateAgentAliasCommand({
        agentId,
        agentAliasName: aliasName,
        description: `${aliasName} alias for the knowledge assistant agent`,
        routingConfiguration: [
          {
            agentVersion: 'DRAFT'
          }
        ]
      });

      const response = await this.agentClient.send(aliasCommand);
      
      logger.info('Agent alias created successfully', {
        agentAliasId: response.agentAlias.agentAliasId,
        agentAliasName: response.agentAlias.agentAliasName
      });
      
      return response.agentAlias;

    } catch (error) {
      logger.error('Failed to create agent alias:', error);
      throw new Error(`Agent alias creation failed: ${error.message}`);
    }
  }

  /**
   * Update existing agent configuration
   * @param {string} agentId - Agent ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} - Updated agent details
   */
  async updateAgent(agentId, updates = {}) {
    try {
      logger.info(`Updating agent ${agentId}...`);

      // Get current agent configuration
      const getAgentCommand = new GetAgentCommand({ agentId });
      const currentAgent = await this.agentClient.send(getAgentCommand);

      const updateCommand = new UpdateAgentCommand({
        agentId,
        agentName: updates.agentName || currentAgent.agent.agentName,
        description: updates.description || currentAgent.agent.description,
        instruction: updates.instructions || currentAgent.agent.instruction,
        foundationModel: updates.foundationModel || currentAgent.agent.foundationModel,
        agentResourceRoleArn: updates.serviceRole || currentAgent.agent.agentResourceRoleArn,
        idleSessionTTLInSeconds: updates.idleSessionTTL || currentAgent.agent.idleSessionTTLInSeconds
      });

      const response = await this.agentClient.send(updateCommand);
      
      // Re-prepare the agent after updates
      await this.prepareAgent(agentId);
      
      logger.info('Agent updated successfully');
      
      return response.agent;

    } catch (error) {
      logger.error('Failed to update agent:', error);
      throw new Error(`Agent update failed: ${error.message}`);
    }
  }

  /**
   * List existing agents
   * @param {number} maxResults - Maximum number of results
   * @returns {Promise<Array>} - List of agents
   */
  async listAgents(maxResults = 50) {
    try {
      const listCommand = new ListAgentsCommand({
        maxResults
      });

      const response = await this.agentClient.send(listCommand);
      
      return response.agentSummaries || [];

    } catch (error) {
      logger.error('Failed to list agents:', error);
      return [];
    }
  }

  /**
   * Check if agent is properly configured and ready
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} - Agent status
   */
  async checkAgentStatus(agentId) {
    try {
      const getAgentCommand = new GetAgentCommand({ agentId });
      const response = await this.agentClient.send(getAgentCommand);
      
      const agent = response.agent;
      const isReady = agent.agentStatus === 'PREPARED';
      
      return {
        agentId,
        agentName: agent.agentName,
        status: agent.agentStatus,
        isReady,
        foundationModel: agent.foundationModel,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        knowledgeBaseAssociated: !!this.knowledgeBaseId
      };

    } catch (error) {
      logger.error('Failed to check agent status:', error);
      return {
        agentId,
        status: 'ERROR',
        isReady: false,
        error: error.message
      };
    }
  }

  /**
   * Generate environment variables for agent configuration
   * @param {Object} agentDetails - Agent details from creation
   * @returns {string} - Environment variables as string
   */
  generateEnvVars(agentDetails) {
    return `
# Bedrock Agent Configuration
BEDROCK_AGENT_ID=${agentDetails.agentId}
BEDROCK_AGENT_ALIAS_ID=${agentDetails.agentAliasId}
BEDROCK_AGENT_NAME="${agentDetails.agentName}"

# Add these to your .env file to enable agent functionality
# Make sure to also have the following existing variables:
# BEDROCK_KNOWLEDGE_BASE_ID=${this.knowledgeBaseId}
# BEDROCK_AGENT_SERVICE_ROLE=${this.serviceRole}
# DEFAULT_MODEL_ID=${this.foundationModel}
`.trim();
  }

  /**
   * Complete agent setup wizard
   * @param {Object} config - Setup configuration
   * @returns {Promise<Object>} - Complete setup result
   */
  async setupComplete(config = {}) {
    try {
      logger.info('Starting complete agent setup...');

      // Step 1: Create the agent
      const agentDetails = await this.createKnowledgeAgent(config);

      // Step 2: Verify setup
      const status = await this.checkAgentStatus(agentDetails.agentId);

      // Step 3: Generate configuration
      const envVars = this.generateEnvVars(agentDetails);

      logger.info('Complete agent setup finished successfully');

      return {
        success: true,
        agent: agentDetails,
        status,
        configuration: {
          envVars,
          nextSteps: [
            'Add the generated environment variables to your .env file',
            'Restart your application to load the new configuration',
            'Test the agent using the /api/chat/agent/test endpoint',
            'Start using agent-based queries instead of direct knowledge base calls'
          ]
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Complete agent setup failed:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new AgentSetupUtility();