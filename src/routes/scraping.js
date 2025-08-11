const express = require('express');
const { body, validationResult } = require('express-validator');
const externalScrapingService = require('../services/externalScrapingService');

const knowledgeBaseSync = require('../services/knowledgeBaseSync');
const jobRegistry = require('../services/jobRegistry');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Scrape a single page
 * POST /api/scraping/scrape
 */
router.post('/scrape', [
  body('url')
    .isURL()
    .withMessage('Must be a valid URL')
    .customSanitizer(value => {
      // Remove @ symbols and other unwanted characters from the beginning
      let cleanUrl = value.trim().replace(/^[@#]+/, '');
      
      // Ensure it starts with http:// or https://
      if (!cleanUrl.match(/^https?:\/\//)) {
        cleanUrl = 'https://' + cleanUrl;
      }
      
      return cleanUrl;
    }),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { url, options = {} } = req.body;

    logger.info(`Received scraping request for: ${url}`);

    // Start scraping via external service
    const result = await externalScrapingService.scrapeWebsite(url, options);

    res.json({
      success: true,
      message: 'Website scraped successfully',
      data: {
        url: result.url,
        title: result.title,
        timestamp: result.timestamp,
        metadata: result.metadata,
        chunksExtracted: result.content.chunks.length,
        content: {
          preview: result.content.chunks.length > 0 ? 
            result.content.chunks[0].content.substring(0, 500) + '...' : 
            'No content extracted',
          totalChunks: result.content.chunks.length,
          chunks: result.content.chunks
        }
      }
    });

  } catch (error) {
    logger.error('Scraping error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to scrape website',
      message: error.message
    });
  }
});

/**
 * Get scraping status
 * GET /api/scraping/status/:domain?
 */
router.get('/status/:domain?', async (req, res) => {
  try {
    const { domain } = req.params;

    if (domain) {
      const history = await externalScrapingService.getScrapingHistory(domain);
      res.json({
        success: true,
        domain,
        history
      });
    } else {
      res.json({
        success: true,
        message: 'Scraping service is running',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logger.error('Error getting scraping status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get scraping status',
      message: error.message
    });
  }
});

/**
 * Check external scraping service health
 * GET /api/scraping/health
 */
router.get('/health', async (req, res) => {
  try {
    const isAvailable = await externalScrapingService.isExternalServiceAvailable();
    const externalHealth = await externalScrapingService.getExternalServiceHealth();
    
    res.json({
      success: true,
      externalService: {
        available: isAvailable,
        health: externalHealth,
        endpoint: process.env.EXTERNAL_SCRAPER_URL || 'https://scrapper.apps.kaaylabs.com/api',
        lastChecked: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error checking external service health:', error);
    res.status(503).json({
      success: false,
      error: 'External scraping service health check failed',
      message: error.message,
      externalService: {
        available: false,
        health: { status: 'unhealthy' },
        endpoint: process.env.EXTERNAL_SCRAPER_URL || 'https://scrapper.apps.kaaylabs.com/api',
        lastChecked: new Date().toISOString()
      }
    });
  }
});

/**
 * Get available scraping options and external service info
 * GET /api/scraping/options
 */
router.get('/options', async (req, res) => {
  try {
    // Get external service presets
    const externalPresets = await externalScrapingService.getExternalServicePresets();
    const externalHealth = await externalScrapingService.getExternalServiceHealth();
    
    res.json({
      success: true,
      options: {
        maxPages: 10000,
        delay: 2000,
        batchSize: 3,
        followExternalLinks: false,
        deepExtraction: true,
        chunkSize: 1000,
        supportedFormats: ['html', 'text', 'json']
      },
      externalService: {
        health: externalHealth,
        presets: externalPresets,
        endpoint: process.env.EXTERNAL_SCRAPER_URL || 'https://scrapper.apps.kaaylabs.com/api'
      }
    });
  } catch (error) {
    logger.error('Error getting scraping options:', error);
    res.json({
      success: true,
      options: {
        maxPages: 10000,
        delay: 2000,
        batchSize: 3,
        followExternalLinks: false,
        deepExtraction: true,
        chunkSize: 1000,
        supportedFormats: ['html', 'text', 'json']
      },
      externalService: {
        health: { status: 'unknown' },
        presets: null,
        endpoint: process.env.EXTERNAL_SCRAPER_URL || 'https://scrapper.apps.kaaylabs.com/api'
      }
    });
  }
});

/**
 * Discover all pages on a website
 * POST /api/scraping/discover
 */
router.post('/discover', [
  body('url')
    .isURL()
    .withMessage('Must be a valid URL')
    .customSanitizer(value => {
      // Remove @ symbols and other unwanted characters from the beginning
      let cleanUrl = value.trim().replace(/^[@#]+/, '');
      
      // Ensure it starts with http:// or https://
      if (!cleanUrl.match(/^https?:\/\//)) {
        cleanUrl = 'https://' + cleanUrl;
      }
      
      return cleanUrl;
    }),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { url, options = {} } = req.body;

    logger.info(`Received page discovery request for: ${url}`);

    // Start page discovery via external service
    const result = await externalScrapingService.discoverWebsitePages(url, options);

    res.json({
      success: true,
      message: 'Page discovery completed successfully',
              data: {
          domain: result.domain,
          totalPages: result.totalPages,
          sitemapPages: result.sitemapPages,
          crawledPages: result.crawledPages,
          discoveredUrls: result.discoveredUrls.slice(0, 10), // Show first 10 URLs as sample
          recommendation: {
            suggestedMaxPages: result.totalPages,
            estimatedTime: Math.ceil(result.totalPages * 2), // Rough estimate: 2 seconds per page
            message: `Found ${result.totalPages} pages. Consider setting maxPages if you want to limit scraping.`
          }
        }
    });

  } catch (error) {
    logger.error('Page discovery error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to discover pages',
      message: error.message
    });
  }
});

/**
 * Crawl and scrape entire website
 * POST /api/scraping/crawl
 */
router.post('/enhanced-crawl', [
  body('url')
    .isURL()
    .withMessage('Must be a valid URL')
    .customSanitizer(value => {
      // Remove @ symbols and other unwanted characters from the beginning
      let cleanUrl = value.trim().replace(/^[@#]+/, '');
      
      // Ensure it starts with http:// or https://
      if (!cleanUrl.match(/^https?:\/\//)) {
        cleanUrl = 'https://' + cleanUrl;
      }
      
      return cleanUrl;
    }),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object'),
  body('options.maxPages')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Max pages must be between 1 and 10,000'),
  body('options.delay')
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage('Delay must be between 0 and 10000ms'),
  body('options.followExternalLinks')
    .optional()
    .isBoolean()
    .withMessage('Follow external links must be boolean'),
  body('options.batchSize')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Batch size must be between 1 and 10'),
  body('options.deepExtraction')
    .optional()
    .isBoolean()
    .withMessage('Deep extraction must be a boolean'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { url, options = {} } = req.body;

    logger.info(`Received comprehensive crawling request for: ${url}`);

    // Set default crawling options
    const crawlOptions = {
      maxPages: options.maxPages || 50,
      delay: options.delay || 1000,
      followExternalLinks: options.followExternalLinks || false,
      respectRobots: options.respectRobots !== false,
      ...options
    };


    console.log(crawlOptions, "crawlOptions --->");

    // Start comprehensive crawling and scraping via external service
    const result = await externalScrapingService.crawlAndScrapeWebsite(url, crawlOptions);

    console.log(result, "result --->");

    // Calculate content preview from scraped pages
    const contentPreview = result.scrapedPages
      .filter(page => page.content?.chunks?.length > 0)
      .slice(0, 3) // First 3 pages with content
      .map(page => ({
        url: page.url,
        title: page.title,
        chunksCount: page.content.chunks.length,
        preview: page.content.chunks[0]?.content?.substring(0, 200) + '...' || 'No content'
      }));

    res.json({
      success: true,
      message: 'Website crawling completed successfully',
      data: {
        domain: result.domain,
        timestamp: result.timestamp,
        crawlingStats: result.crawlingStats,
        contentStats: result.contentStats,
        discoveryStats: result.discoveryStats,
        totalPagesScraped: result.scrapedPages.length,
        totalChunks: result.contentStats.totalChunks,
        successRate: result.crawlingStats.successRate,
        errors: result.errors.length > 0 ? result.errors.slice(0, 5) : [], // Show first 5 errors
        contentPreview,
        summary: {
          pagesDiscovered: result.discoveryStats?.totalPagesDiscovered || result.crawlingStats.totalPagesDiscovered,
          pagesScraped: result.scrapedPages.length,
          limitApplied: result.discoveryStats?.limitApplied || false,
          efficiency: `${result.crawlingStats.successRate} success rate`
        },
        // Include all scraped data for debugging (can be removed in production)
        scrapedPages: result.scrapedPages.map(page => ({
          url: page.url,
          title: page.title,
          timestamp: page.timestamp,
          metadata: page.metadata,
          contentChunks: page.content?.chunks?.length || 0,
          contentPreview: page.content?.chunks?.[0]?.content?.substring(0, 300) || 'No content'
        }))
      }
    });

  } catch (error) {
    logger.error('Comprehensive crawling error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to crawl website',
      message: error.message
    });
  }
});

/**
 * Start async crawl job (returns immediately with jobId)
 * POST /api/scraping/crawl-async
 */
router.post('/crawl-async', [
  body('url')
    .isURL()
    .withMessage('Must be a valid URL')
    .customSanitizer(value => {
      let cleanUrl = value.trim().replace(/^[@#]+/, '');
      if (!cleanUrl.match(/^https?:\/\//)) {
        cleanUrl = 'https://' + cleanUrl;
      }
      return cleanUrl;
    }),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object'),
  body('options.maxPages')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Max pages must be between 1 and 10,000'),
  body('options.delay')
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage('Delay must be between 0 and 10000ms'),
  body('options.followExternalLinks')
    .optional()
    .isBoolean()
    .withMessage('Follow external links must be boolean'),
  body('options.batchSize')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Batch size must be between 1 and 10'),
  body('options.deepExtraction')
    .optional()
    .isBoolean()
    .withMessage('Deep extraction must be a boolean'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { url, options = {} } = req.body;

    // Set default crawling options
    const crawlOptions = {
      maxPages: options.maxPages || 50,
      delay: options.delay || 1000,
      followExternalLinks: options.followExternalLinks || false,
      respectRobots: options.respectRobots !== false,
      ...options
    };

    // Create job and return immediately
    const jobId = jobRegistry.createJob('crawl', { url, options: crawlOptions });

    logger.info(`Started async crawl job ${jobId} for: ${url}`);

    // Start crawling in background (don't await)
    setImmediate(async () => {
      try {
        jobRegistry.updateJob(jobId, {
          status: 'running',
          progress: {
            phase: 'discovery',
            message: 'Discovering pages...',
            percentage: 10
          }
        });

        const result = await externalScrapingService.crawlAndScrapeWebsite(url, crawlOptions, (progress) => {
          // Update job progress in real-time
          jobRegistry.updateJob(jobId, {
            progress: {
              phase: progress.phase,
              message: progress.message,
              percentage: progress.percentage
            }
          });
        });
        
        jobRegistry.completeJob(jobId, {
          domain: result.domain,
          timestamp: result.timestamp,
          crawlingStats: result.crawlingStats,
          contentStats: result.contentStats,
          discoveryStats: result.discoveryStats,
          totalPagesScraped: result.scrapedPages.length,
          totalChunks: result.contentStats.totalChunks,
          successRate: result.crawlingStats.successRate,
          errors: result.errors.length > 0 ? result.errors.slice(0, 5) : [],
          summary: {
            pagesDiscovered: result.discoveryStats?.totalPagesDiscovered || result.crawlingStats.totalPagesDiscovered,
            pagesScraped: result.scrapedPages.length,
            limitApplied: result.discoveryStats?.limitApplied || false,
            efficiency: `${result.crawlingStats.successRate} success rate`
          }
        });

        logger.info(`Async crawl job ${jobId} completed successfully`);

      } catch (error) {
        logger.error(`Async crawl job ${jobId} failed:`, error);
        jobRegistry.failJob(jobId, error);
      }
    });

    // Return job ID immediately
    res.json({
      success: true,
      message: 'Crawl job started',
      data: {
        jobId,
        status: 'pending',
        estimatedTime: '2-5 minutes',
        progressUrl: `/api/scraping/crawl/status/${jobId}`
      }
    });

  } catch (error) {
    logger.error('Error starting async crawl:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start crawl job',
      message: error.message
    });
  }
});

/**
 * Get crawl job status and progress
 * GET /api/scraping/crawl/status/:jobId
 */
router.get('/crawl/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  const job = jobRegistry.getJob(jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
      message: `No crawl job found with ID: ${jobId}`
    });
  }

  res.json({
    success: true,
    data: {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.result || null,
      error: job.error || null
    }
  });
});

/**
 * Check knowledge base sync status
 * GET /api/scraping/sync/status/:jobId
 */
router.get('/sync/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const status = await knowledgeBaseSync.checkSyncStatus(jobId);
    
    res.json({
      success: true,
      data: {
        jobId: status.jobId,
        status: status.status,
        startedAt: status.startedAt,
        updatedAt: status.updatedAt,
        failureReasons: status.failureReasons,
        isComplete: status.status === 'COMPLETE',
        isFailed: status.status === 'FAILED',
        isInProgress: ['IN_PROGRESS', 'STARTING'].includes(status.status)
      }
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
 * Trigger manual knowledge base sync
 * POST /api/scraping/sync
 */
router.post('/sync', [
  body('domain')
    .isString()
    .withMessage('Domain is required')
    .trim(),
  body('waitForAvailability')
    .optional()
    .isBoolean()
    .withMessage('waitForAvailability must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { domain, waitForAvailability = true } = req.body;
    
    logger.info(`Manual knowledge base sync requested for: ${domain} (waitForAvailability: ${waitForAvailability})`);
    
    const result = await knowledgeBaseSync.fullSync(domain, false, waitForAvailability);
    
    res.json({
      success: true,
      message: 'Knowledge base sync initiated successfully',
      data: {
        jobId: result.jobId,
        status: result.status,
        startedAt: result.startedAt,
        domain,
        waitedForAvailability: waitForAvailability
      }
    });
    
  } catch (error) {
    logger.error('Error initiating manual sync:', error);
    
    // Provide specific error handling for common issues
    if (error.message.includes('already in use') || error.message.includes('ongoing ingestion job')) {
      res.status(409).json({
        success: false,
        error: 'Knowledge base busy',
        message: 'Knowledge base is currently processing data. Please wait for the current job to complete and try again.',
        suggestion: 'You can check the status of ongoing jobs using GET /api/scraping/sync/status/{jobId}'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to initiate sync',
        message: error.message
      });
    }
  }
});

module.exports = router;