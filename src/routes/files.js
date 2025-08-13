const express = require('express');
const { body, validationResult, query } = require('express-validator');
const fileProcessingService = require('../services/fileProcessingService');
const bedrockKnowledgeBaseService = require('../services/bedrockKnowledgeBaseService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * /api/files/upload:
 *   post:
 *     summary: Upload and process files
 *     description: Upload multiple files (PDF, DOCX, TXT, etc.) and process them for knowledge base integration
 *     tags: [Files]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: "Files to upload (max 10 files)"
 *               title:
 *                 type: string
 *                 example: "Technical Documentation"
 *                 description: "Optional title for the uploaded files"
 *               description:
 *                 type: string
 *                 example: "User manuals and API documentation"
 *                 description: "Optional description of the files"
 *               category:
 *                 type: string
 *                 example: "documentation"
 *                 description: "Optional category classification"
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["manual", "api", "technical"]
 *                 description: "Optional tags for file classification"
 *     responses:
 *       200:
 *         description: Files uploaded and processed successfully
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
 *                   example: "Files processed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     processed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           status:
 *                             type: string
 *                           documentId:
 *                             type: string
 *                           s3Key:
 *                             type: string
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           error:
 *                             type: string
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         successful:
 *                           type: integer
 *                         failed:
 *                           type: integer
 *       400:
 *         description: Validation error or no files uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error during file processing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/upload', 
  fileProcessingService.getUploadConfig().array('files', 10), // Max 10 files
  [
    body('title').optional().isString().withMessage('Title must be a string'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('category').optional().isString().withMessage('Category must be a string'),
    body('tags').optional().isArray().withMessage('Tags must be an array')
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationErrors.array()
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files uploaded'
        });
      }

      const { title, description, category, tags } = req.body;
      const results = [];
      const processingErrors = [];

      logger.info(`Processing ${req.files.length} uploaded files`);

      // Process files concurrently with error handling
      const processingPromises = req.files.map(async (file, index) => {
        try {
          const metadata = {
            title: title || file.originalname,
            description: description || '',
            category: category || 'general',
            tags: tags || [],
            uploadedBy: req.user?.id || 'anonymous', // Add user context if available
            uploadIndex: index
          };

          const result = await fileProcessingService.processUploadedFile(file, metadata);
          return { success: true, result };
        } catch (error) {
          logger.error(`Error processing file ${file.originalname}:`, error);
          return { 
            success: false, 
            error: error.message, 
            fileName: file.originalname 
          };
        }
      });

      const processingResults = await Promise.all(processingPromises);

      // Separate successful and failed results
      processingResults.forEach(result => {
        if (result.success) {
          results.push(result.result);
        } else {
          processingErrors.push({
            fileName: result.fileName,
            error: result.error
          });
        }
      });

      const response = {
        success: results.length > 0,
        message: `Processed ${results.length} of ${req.files.length} files successfully`,
        data: {
          files: results,
          totalFiles: req.files.length,
          successfulFiles: results.length,
          failedFiles: processingErrors.length,
          totalContentLength: results.reduce((sum, r) => sum + (r.contentLength || 0), 0),
          totalChunks: results.reduce((sum, r) => sum + (r.chunkCount || 0), 0)
        }
      };

      if (processingErrors.length > 0) {
        response.errors = processingErrors;
        response.warning = `${processingErrors.length} files failed to process`;
      }

      const statusCode = results.length > 0 ? 200 : 400;
      res.status(statusCode).json(response);

    } catch (error) {
      logger.error('File upload error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process files',
        message: error.message
      });
    }
  }
);

/**
 * Get file processing capabilities and supported types
 * GET /api/files/info
 */
router.get('/info', (req, res) => {
  try {
    const processingInfo = fileProcessingService.getProcessingInfo();
    
    res.json({
      success: true,
      data: {
        ...processingInfo,
        uploadLimits: {
          maxFiles: 10,
          maxFileSize: processingInfo.maxFileSize,
          maxFileSizeMB: Math.round(processingInfo.maxFileSize / (1024 * 1024))
        }
      }
    });
  } catch (error) {
    logger.error('Error getting file processing info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get processing info',
      message: error.message
    });
  }
});

/**
 * Check Knowledge Base sync status
 * GET /api/files/sync-status/:jobId
 */
router.get('/sync-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }

    const status = await bedrockKnowledgeBaseService.getSyncStatus(jobId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Sync job not found'
      });
    }

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Error checking sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check sync status',
      message: error.message
    });
  }
});

/**
 * Get recent sync jobs
 * GET /api/files/sync-jobs
 */
router.get('/sync-jobs', [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const limit = parseInt(req.query.limit) || 10;
    const jobs = await bedrockKnowledgeBaseService.getRecentSyncJobs(limit);

    res.json({
      success: true,
      data: {
        jobs,
        total: jobs.length,
        limit
      }
    });

  } catch (error) {
    logger.error('Error getting sync jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync jobs',
      message: error.message
    });
  }
});

/**
 * Get storage statistics
 * GET /api/files/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await bedrockKnowledgeBaseService.getStorageStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting storage stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get storage statistics',
      message: error.message
    });
  }
});

/**
 * Trigger manual Knowledge Base sync
 * POST /api/files/sync
 */
router.post('/sync', async (req, res) => {
  try {
    logger.info('Manual Knowledge Base sync requested');
    
    const syncJobId = await bedrockKnowledgeBaseService.syncKnowledgeBase();
    
    if (!syncJobId) {
      return res.status(400).json({
        success: false,
        error: 'Failed to start sync job',
        message: 'Knowledge Base sync could not be initiated. Check configuration.'
      });
    }

    res.json({
      success: true,
      message: 'Knowledge Base sync started',
      data: {
        syncJobId,
        startedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error starting manual sync:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sync',
      message: error.message
    });
  }
});

/**
 * Health check for file processing services
 * GET /api/files/health
 */
router.get('/health', async (req, res) => {
  try {
    const processingInfo = fileProcessingService.getProcessingInfo();
    const stats = await bedrockKnowledgeBaseService.getStorageStats();
    
    const health = {
      fileProcessing: {
        status: 'healthy',
        capabilities: processingInfo.capabilities,
        supportedTypes: processingInfo.supportedTypes.length
      },
      storage: {
        status: stats.error ? 'degraded' : 'healthy',
        bucket: processingInfo.bucket,
        totalDocuments: stats.totalDocuments || 0
      },
      timestamp: new Date().toISOString()
    };

    const overallStatus = health.fileProcessing.status === 'healthy' && 
                         health.storage.status === 'healthy' ? 'healthy' : 'degraded';

    res.json({
      success: true,
      status: overallStatus,
      data: health
    });

  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: 'Health check failed',
      message: error.message
    });
  }
});

module.exports = router;