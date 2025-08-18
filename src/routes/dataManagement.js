const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const DataManagementService = require('../services/dataManagementService');
const logger = require('../utils/logger');

const router = express.Router();
const dataManagementService = new DataManagementService();

/**
 * @swagger
 * /api/data-management/domains:
 *   get:
 *     summary: Get comprehensive data sources summary
 *     description: Retrieve a summary of all data sources in the knowledge base including websites, PDFs, and documents with detailed metadata
 *     tags: [Data Management]
 *     responses:
 *       200:
 *         description: Successfully retrieved data sources summary
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
 *                   example: "Domains summary retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalDomains:
 *                       type: integer
 *                       example: 5
 *                       description: "Number of website domains (legacy field)"
 *                     domains:
 *                       type: array
 *                       description: "Website domains data (legacy format)"
 *                       items:
 *                         type: object
 *                         properties:
 *                           domain:
 *                             type: string
 *                             example: "example.com"
 *                           type:
 *                             type: string
 *                             example: "website"
 *                           documentCount:
 *                             type: integer
 *                             example: 15
 *                           totalFiles:
 *                             type: integer
 *                             example: 25
 *                           lastUpdate:
 *                             type: string
 *                             format: date-time
 *                           status:
 *                             type: string
 *                             example: "active"
 *                           sizeFormatted:
 *                             type: string
 *                             example: "2.5 MB"
 *                     dataSources:
 *                       type: object
 *                       description: "Enhanced breakdown by data source type"
 *                       properties:
 *                         websites:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 3
 *                             items:
 *                               type: array
 *                               items:
 *                                 type: object
 *                                 properties:
 *                                   domain:
 *                                     type: string
 *                                     example: "example.com"
 *                                   type:
 *                                     type: string
 *                                     example: "website"
 *                                   files:
 *                                     type: integer
 *                                     example: 15
 *                                   size:
 *                                     type: integer
 *                                     example: 2621440
 *                                   sizeFormatted:
 *                                     type: string
 *                                     example: "2.5 MB"
 *                                   lastUpdate:
 *                                     type: string
 *                                     format: date-time
 *                         pdfs:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 5
 *                             items:
 *                               type: array
 *                               items:
 *                                 type: object
 *                                 properties:
 *                                   fileName:
 *                                     type: string
 *                                     example: "user-manual"
 *                                   type:
 *                                     type: string
 *                                     example: "pdf"
 *                                   originalName:
 *                                     type: string
 *                                     example: "user-manual.pdf"
 *                                   fileId:
 *                                     type: string
 *                                     example: "abc123def456"
 *                                   size:
 *                                     type: integer
 *                                     example: 1048576
 *                                   sizeFormatted:
 *                                     type: string
 *                                     example: "1.0 MB"
 *                                   lastUpdate:
 *                                     type: string
 *                                     format: date-time
 *                         documents:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 7
 *                             items:
 *                               type: array
 *                               items:
 *                                 type: object
 *                                 properties:
 *                                   fileName:
 *                                     type: string
 *                                     example: "documentation"
 *                                   type:
 *                                     type: string
 *                                     example: "docx"
 *                                   category:
 *                                     type: string
 *                                     example: "docs"
 *                                   originalName:
 *                                     type: string
 *                                     example: "documentation.docx"
 *                                   fileId:
 *                                     type: string
 *                                     example: "xyz789abc012"
 *                                   size:
 *                                     type: integer
 *                                     example: 524288
 *                                   sizeFormatted:
 *                                     type: string
 *                                     example: "512 KB"
 *                                   lastUpdate:
 *                                     type: string
 *                                     format: date-time
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalDataSources:
 *                           type: integer
 *                           example: 15
 *                           description: "Total count of all data sources"
 *                         totalWebsites:
 *                           type: integer
 *                           example: 3
 *                         totalPdfs:
 *                           type: integer
 *                           example: 5
 *                         totalDocuments:
 *                           type: integer
 *                           example: 7
 *                         totalFiles:
 *                           type: integer
 *                           example: 120
 *                           description: "Total number of individual files"
 *                         totalSize:
 *                           type: integer
 *                           example: 10485760
 *                         totalSizeFormatted:
 *                           type: string
 *                           example: "10.0 MB"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/domains', async (req, res) => {
  try {
    logger.info('Getting domains summary');

    const summary = await dataManagementService.getAllDomainsSummary();

    res.json({
      success: true,
      message: 'Domains summary retrieved successfully',
      data: summary
    });

  } catch (error) {
    logger.error('Error getting domains summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get domains summary',
      message: error.message
    });
  }
});

/**
 * List all documents for a specific domain
 * GET /api/data-management/domains/:domain/documents
 */
router.get('/domains/:domain/documents', [
  param('domain')
    .isLength({ min: 1 })
    .withMessage('Domain is required')
    .matches(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .withMessage('Must be a valid domain name')
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

    const { domain } = req.params;

    logger.info(`Listing documents for domain: ${domain}`);

    const documents = await dataManagementService.listDocumentsByDomain(domain);

    res.json({
      success: true,
      message: `Documents for domain ${domain} retrieved successfully`,
      data: documents
    });

  } catch (error) {
    logger.error(`Error listing documents for domain ${req.params.domain}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to list documents',
      message: error.message
    });
  }
});

/**
 * List all documents for a specific URL
 * GET /api/data-management/urls/documents
 */
router.get('/urls/documents', [
  query('url')
    .isURL()
    .withMessage('Must be a valid URL')
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

    const { url } = req.query;

    logger.info(`Listing documents for URL: ${url}`);

    const documents = await dataManagementService.listDocumentsByUrl(url);

    res.json({
      success: true,
      message: `Documents for URL ${url} retrieved successfully`,
      data: documents
    });

  } catch (error) {
    logger.error(`Error listing documents for URL ${req.query.url}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to list documents',
      message: error.message
    });
  }
});

/**
 * Delete all data for a specific domain (with dry-run support)
 * DELETE /api/data-management/domains/:domain
 */
router.delete('/domains/:domain', [
  param('domain')
    .isLength({ min: 1 })
    .withMessage('Domain is required')
    .matches(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .withMessage('Must be a valid domain name'),
  query('dryRun')
    .optional()
    .isBoolean()
    .withMessage('dryRun must be a boolean'),
  query('syncKnowledgeBase')
    .optional()
    .isBoolean()
    .withMessage('syncKnowledgeBase must be a boolean'),
  query('confirm')
    .optional()
    .isString()
    .withMessage('confirm must be a string')
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

    const { domain } = req.params;
    const dryRun = req.query.dryRun === 'true';
    const syncKnowledgeBase = req.query.syncKnowledgeBase !== 'false'; // Default to true
    const confirm = req.query.confirm;

    // Safety check - require confirmation for actual deletion
    if (!dryRun && confirm !== domain) {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required',
        message: `To delete data for ${domain}, add ?confirm=${domain} to the URL. Use ?dryRun=true to preview what will be deleted.`,
        example: `DELETE /api/data-management/domains/${domain}?confirm=${domain}`
      });
    }

    logger.info(`${dryRun ? 'DRY RUN: ' : ''}Deleting data for domain: ${domain}`);

    const result = await dataManagementService.deleteDomainData(domain, {
      dryRun,
      syncKnowledgeBase
    });

    const statusCode = result.deleted || result.dryRun ? 200 : 404;
    const message = dryRun 
      ? `Dry run completed for domain ${domain}`
      : result.deleted 
        ? `All data for domain ${domain} deleted successfully`
        : `No data found for domain ${domain}`;

    res.status(statusCode).json({
      success: true,
      message,
      data: result
    });

  } catch (error) {
    logger.error(`Error deleting domain data for ${req.params.domain}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete domain data',
      message: error.message
    });
  }
});

/**
 * Delete all data for a specific URL (with dry-run support)
 * DELETE /api/data-management/urls
 */
router.delete('/urls', [
  query('url')
    .isURL()
    .withMessage('Must be a valid URL'),
  query('dryRun')
    .optional()
    .isBoolean()
    .withMessage('dryRun must be a boolean'),
  query('syncKnowledgeBase')
    .optional()
    .isBoolean()
    .withMessage('syncKnowledgeBase must be a boolean'),
  query('confirm')
    .optional()
    .isString()
    .withMessage('confirm must be a string')
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

    const { url } = req.query;
    const dryRun = req.query.dryRun === 'true';
    const syncKnowledgeBase = req.query.syncKnowledgeBase !== 'false'; // Default to true
    const confirm = req.query.confirm;

    // Safety check - require confirmation for actual deletion
    const urlHash = Buffer.from(url).toString('base64').slice(0, 8);
    if (!dryRun && confirm !== urlHash) {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required',
        message: `To delete data for this URL, add ?confirm=${urlHash} to the URL. Use ?dryRun=true to preview what will be deleted.`,
        confirmationCode: urlHash,
        example: `DELETE /api/data-management/urls?url=${encodeURIComponent(url)}&confirm=${urlHash}`
      });
    }

    logger.info(`${dryRun ? 'DRY RUN: ' : ''}Deleting data for URL: ${url}`);

    const result = await dataManagementService.deleteUrlData(url, {
      dryRun,
      syncKnowledgeBase
    });

    const statusCode = result.deleted || result.dryRun ? 200 : 404;
    const message = dryRun 
      ? `Dry run completed for URL ${url}`
      : result.deleted 
        ? `All data for URL ${url} deleted successfully`
        : `No data found for URL ${url}`;

    res.status(statusCode).json({
      success: true,
      message,
      data: result
    });

  } catch (error) {
    logger.error(`Error deleting URL data for ${req.query.url}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete URL data',
      message: error.message
    });
  }
});

/**
 * Get deletion preview for a domain (alias for dry-run)
 * GET /api/data-management/domains/:domain/deletion-preview
 */
router.get('/domains/:domain/deletion-preview', [
  param('domain')
    .isLength({ min: 1 })
    .withMessage('Domain is required')
    .matches(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .withMessage('Must be a valid domain name')
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

    const { domain } = req.params;

    logger.info(`Getting deletion preview for domain: ${domain}`);

    const result = await dataManagementService.deleteDomainData(domain, {
      dryRun: true,
      syncKnowledgeBase: false
    });

    res.json({
      success: true,
      message: `Deletion preview for domain ${domain}`,
      data: {
        ...result,
        warning: 'This is a preview only. No files have been deleted.',
        toActuallyDelete: `DELETE /api/data-management/domains/${domain}?confirm=${domain}`
      }
    });

  } catch (error) {
    logger.error(`Error getting deletion preview for domain ${req.params.domain}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get deletion preview',
      message: error.message
    });
  }
});

/**
 * Get deletion preview for a URL (alias for dry-run)
 * GET /api/data-management/urls/deletion-preview
 */
router.get('/urls/deletion-preview', [
  query('url')
    .isURL()
    .withMessage('Must be a valid URL')
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

    const { url } = req.query;

    logger.info(`Getting deletion preview for URL: ${url}`);

    const result = await dataManagementService.deleteUrlData(url, {
      dryRun: true,
      syncKnowledgeBase: false
    });

    const urlHash = Buffer.from(url).toString('base64').slice(0, 8);

    res.json({
      success: true,
      message: `Deletion preview for URL ${url}`,
      data: {
        ...result,
        warning: 'This is a preview only. No files have been deleted.',
        confirmationCode: urlHash,
        toActuallyDelete: `DELETE /api/data-management/urls?url=${encodeURIComponent(url)}&confirm=${urlHash}`
      }
    });

  } catch (error) {
    logger.error(`Error getting deletion preview for URL ${req.query.url}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get deletion preview',
      message: error.message
    });
  }
});

module.exports = router;