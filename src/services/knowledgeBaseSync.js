const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
const logger = require('../utils/logger');

class KnowledgeBaseSyncService {
  constructor() {
    this.bedrockAgentClient = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: `https://bedrock-agent.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
      maxAttempts: 3,
    });

    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    this.dataSourceId = process.env.BEDROCK_DATA_SOURCE_ID;
  }

  /**
   * Trigger knowledge base data synchronization after scraping
   * @param {string} domain - Domain that was scraped
   * @returns {Promise<Object>} - Ingestion job result
   */
  async syncKnowledgeBase(domain) {
    try {
      logger.info(`Starting knowledge base sync for domain: ${domain}`);

      const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        description: `Sync scraped content from ${domain} - ${new Date().toISOString()}`
      });

      const response = await this.bedrockAgentClient.send(command);
      
      logger.info(`Knowledge base sync started. Job ID: ${response.ingestionJob.ingestionJobId}`);
      
      return {
        jobId: response.ingestionJob.ingestionJobId,
        status: response.ingestionJob.status,
        startedAt: response.ingestionJob.startedAt
      };

    } catch (error) {
      logger.error('Error starting knowledge base sync:', error);
      throw new Error(`Failed to sync knowledge base: ${error.message}`);
    }
  }

  /**
   * Check the status of a knowledge base ingestion job
   * @param {string} jobId - Ingestion job ID
   * @returns {Promise<Object>} - Job status
   */
  async checkSyncStatus(jobId) {
    try {
      const command = new GetIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        ingestionJobId: jobId
      });

      const response = await this.bedrockAgentClient.send(command);
      
      return {
        jobId: response.ingestionJob.ingestionJobId,
        status: response.ingestionJob.status,
        startedAt: response.ingestionJob.startedAt,
        updatedAt: response.ingestionJob.updatedAt,
        failureReasons: response.ingestionJob.failureReasons || []
      };

    } catch (error) {
      logger.error('Error checking sync status:', error);
      throw new Error(`Failed to check sync status: ${error.message}`);
    }
  }

  /**
   * Wait for ingestion job to complete
   * @param {string} jobId - Ingestion job ID
   * @param {number} maxWaitTime - Maximum wait time in milliseconds
   * @returns {Promise<Object>} - Final job status
   */
  async waitForSyncCompletion(jobId, maxWaitTime = 300000) { // 5 minutes default
    const startTime = Date.now();
    const pollInterval = 10000; // 10 seconds

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.checkSyncStatus(jobId);
        
        if (status.status === 'COMPLETE') {
          logger.info(`Knowledge base sync completed successfully. Job ID: ${jobId}`);
          return status;
        }
        
        if (status.status === 'FAILED') {
          logger.error(`Knowledge base sync failed. Job ID: ${jobId}`, status.failureReasons);
          throw new Error(`Sync failed: ${status.failureReasons.join(', ')}`);
        }
        
        logger.info(`Sync in progress... Status: ${status.status}`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        logger.error('Error waiting for sync completion:', error);
        throw error;
      }
    }
    
    throw new Error(`Sync timeout after ${maxWaitTime / 1000} seconds`);
  }

  /**
   * Full synchronization process with status monitoring
   * @param {string} domain - Domain that was scraped
   * @param {boolean} waitForCompletion - Whether to wait for completion
   * @returns {Promise<Object>} - Sync result
   */
  async fullSync(domain, waitForCompletion = false) {
    try {
      // Start the sync
      const syncResult = await this.syncKnowledgeBase(domain);
      
      if (waitForCompletion) {
        // Wait for completion
        const finalStatus = await this.waitForSyncCompletion(syncResult.jobId);
        return {
          ...syncResult,
          finalStatus: finalStatus.status,
          completedAt: finalStatus.updatedAt
        };
      }
      
      return syncResult;
      
    } catch (error) {
      logger.error('Error in full sync process:', error);
      throw error;
    }
  }
}

module.exports = new KnowledgeBaseSyncService();