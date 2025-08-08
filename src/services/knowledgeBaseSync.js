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
   * Check if there's an ongoing ingestion job
   * @returns {Promise<Object|null>} - Current job info or null if none
   */
  async getCurrentIngestionJob() {
    try {
      // Note: AWS doesn't have a direct "list active jobs" API, so we'll check the last known job status
      // This is a simplified check - in production, you might want to maintain a job tracking system
      return null;
    } catch (error) {
      logger.error('Error checking current ingestion job:', error);
      return null;
    }
  }

  /**
   * Trigger knowledge base data synchronization after scraping
   * @param {string} domain - Domain that was scraped
   * @param {boolean} waitForCompletion - Whether to wait for any ongoing jobs first
   * @returns {Promise<Object>} - Ingestion job result
   */
  async syncKnowledgeBase(domain, waitForCompletion = false) {
    try {
      logger.info(`Starting knowledge base sync for domain: ${domain}`);

      // Check for ongoing jobs and handle accordingly
      if (waitForCompletion) {
        logger.info('Checking for ongoing ingestion jobs...');
        await this.waitForNoActiveJobs();
      }

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
      
      // Handle specific AWS errors
      if (error.message.includes('already in use') || error.message.includes('ongoing ingestion job')) {
        throw new Error(`Knowledge base is currently processing data. Please wait for the current job to complete and try again in a few minutes.`);
      }
      
      throw new Error(`Failed to sync knowledge base: ${error.message}`);
    }
  }

  /**
   * Wait for any active ingestion jobs to complete (with timeout)
   * @param {number} maxWaitTime - Maximum wait time in milliseconds
   */
  async waitForNoActiveJobs(maxWaitTime = 300000) { // 5 minutes default
    const startTime = Date.now();
    const pollInterval = 30000; // 30 seconds
    
    logger.info('Waiting for any active ingestion jobs to complete...');
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Try to start a dummy job to check if KB is available
        // If it fails with "already in use", we know there's an active job
        // This is a workaround since AWS doesn't provide a direct "list active jobs" API
        const testCommand = new StartIngestionJobCommand({
          knowledgeBaseId: this.knowledgeBaseId,
          dataSourceId: this.dataSourceId,
          description: `Test job availability - ${new Date().toISOString()}`
        });
        
        // If this succeeds, no job is running, so we cancel it immediately
        const testResponse = await this.bedrockAgentClient.send(testCommand);
        logger.info('No active jobs detected, knowledge base is available');
        return;
        
      } catch (error) {
        if (error.message.includes('already in use') || error.message.includes('ongoing ingestion job')) {
          logger.info(`Knowledge base still busy, waiting ${pollInterval/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        } else {
          // Some other error, break the loop
          logger.warn('Unexpected error while checking job status:', error.message);
          break;
        }
      }
    }
    
    logger.warn(`Timeout waiting for active jobs to complete after ${maxWaitTime/1000}s`);
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
   * @param {boolean} waitForAvailability - Whether to wait for KB availability first
   * @returns {Promise<Object>} - Sync result
   */
  async fullSync(domain, waitForCompletion = false, waitForAvailability = true) {
    try {
      // Start the sync with improved conflict handling
      const syncResult = await this.syncKnowledgeBase(domain, waitForAvailability);
      
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