const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * In-memory job registry for tracking background crawl operations
 * In production, use Redis or a database for persistence
 */
class JobRegistry {
  constructor() {
    this.jobs = new Map();
    this.maxJobs = 100; // Prevent memory leaks
    
    // Clean up completed jobs every 30 minutes
    setInterval(() => this.cleanupOldJobs(), 30 * 60 * 1000);
  }

  /**
   * Create a new job
   * @param {string} type - Job type (e.g., 'crawl')
   * @param {Object} params - Job parameters
   * @returns {string} - Job ID
   */
  createJob(type, params = {}) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      status: 'pending',
      params,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: {
        phase: 'starting',
        message: 'Job created',
        percentage: 0
      }
    };

    this.jobs.set(jobId, job);
    this.enforceMaxJobs();
    
    logger.info(`Created ${type} job: ${jobId}`);
    return jobId;
  }

  /**
   * Update job status and progress
   * @param {string} jobId - Job ID
   * @param {Object} updates - Updates to apply
   */
  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn(`Attempted to update non-existent job: ${jobId}`);
      return false;
    }

    Object.assign(job, updates, {
      updatedAt: new Date().toISOString()
    });

    if (updates.progress) {
      Object.assign(job.progress, updates.progress);
    }

    this.jobs.set(jobId, job);
    logger.debug(`Updated job ${jobId}: ${job.status}`);
    return true;
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} - Job object or null if not found
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Mark job as completed with result
   * @param {string} jobId - Job ID
   * @param {Object} result - Job result
   */
  completeJob(jobId, result) {
    this.updateJob(jobId, {
      status: 'completed',
      result,
      progress: {
        phase: 'completed',
        message: 'Job completed successfully',
        percentage: 100
      }
    });
  }

  /**
   * Mark job as failed with error
   * @param {string} jobId - Job ID
   * @param {Error|string} error - Error information
   */
  failJob(jobId, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.updateJob(jobId, {
      status: 'failed',
      error: errorMessage,
      progress: {
        phase: 'failed',
        message: errorMessage,
        percentage: 0
      }
    });
  }

  /**
   * Get all jobs (for debugging)
   * @returns {Array} - Array of all jobs
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up old completed/failed jobs
   */
  cleanupOldJobs() {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 2); // Remove jobs older than 2 hours
    
    let cleaned = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if ((job.status === 'completed' || job.status === 'failed') && 
          new Date(job.updatedAt) < cutoffTime) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old jobs`);
    }
  }

  /**
   * Enforce maximum number of jobs to prevent memory leaks
   */
  enforceMaxJobs() {
    if (this.jobs.size <= this.maxJobs) return;

    // Remove oldest completed/failed jobs first
    const sortedJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.status === 'completed' || job.status === 'failed')
      .sort(([_, a], [__, b]) => new Date(a.updatedAt) - new Date(b.updatedAt));

    const toRemove = this.jobs.size - this.maxJobs + 10; // Remove extra for buffer
    for (let i = 0; i < toRemove && i < sortedJobs.length; i++) {
      this.jobs.delete(sortedJobs[i][0]);
    }
  }
}

module.exports = new JobRegistry();