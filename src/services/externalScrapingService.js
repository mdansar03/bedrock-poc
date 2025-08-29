const axios = require('axios');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { generateHash, generateChunkId } = require('../utils/hash');
const logger = require('../utils/logger');
const knowledgeBaseSync = require('./knowledgeBaseSync');
const bedrockKnowledgeBaseService = require('./bedrockKnowledgeBaseService');
const bedrockCompliantStorage = require('./bedrockCompliantStorage');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { convert } = require('html-to-text');

class ExternalScrapingService {
  constructor() {
    this.externalApiUrl = process.env.EXTERNAL_SCRAPER_URL || 'http://localhost:3358/api';
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = process.env.BEDROCK_S3_BUCKET;
    
    // Create axios instance for external API
    this.api = axios.create({
      baseURL: this.externalApiUrl,
      // Allow long-running crawl operations (configurable via env)
      timeout: parseInt(process.env.EXTERNAL_SCRAPER_TIMEOUT_MS || '', 10) || 1200000, // 20 minutes
      headers: {
        'Content-Type': 'application/json',
      },
      // Add retry configuration - increase retries for long crawls
      retries: 5,
      retryDelay: (retryCount) => retryCount * 2000, // Exponential backoff
    });

    // Add retry interceptor
    this.setupRetryInterceptor();
  }

  /**
   * Setup retry interceptor for external API calls
   */
  setupRetryInterceptor() {
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        // Don't retry if retries are disabled or exceeded
        if (!config || !config.retries || config.__retryCount >= config.retries) {
          return Promise.reject(error);
        }
        
        // Initialize retry count
        config.__retryCount = config.__retryCount || 0;
        config.__retryCount++;
        
        // Check if error is retryable (503, 502, 504, network errors, timeouts)
        const retryableErrors = [502, 503, 504, 'ECONNRESET', 'ENOTFOUND', 'ECONNABORTED', 'ETIMEDOUT'];
        const isRetryable = retryableErrors.includes(error.response?.status) || 
                           retryableErrors.includes(error.code) ||
                           error.message.includes('timeout') ||
                           error.message.includes('socket hang up') ||
                           error.message.includes('network');
        
        if (!isRetryable) {
          return Promise.reject(error);
        }
        
        // Calculate delay
        const delay = config.retryDelay ? config.retryDelay(config.__retryCount) : 2000;
        
        logger.warn(`External API call failed (attempt ${config.__retryCount}/${config.retries}). Retrying in ${delay}ms...`, {
          url: config.url,
          status: error.response?.status,
          code: error.code
        });
        
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.api(config);
      }
    );
  }

  /**
   * Check if external service is available
   */
  async isExternalServiceAvailable() {
    try {
      const response = await this.api.get('/health', { timeout: 10000 });
      return response.data?.status === 'healthy';
    } catch (error) {
      logger.warn('External scraping service health check failed:', error.message);
      return false;
    }
  }

  /**
   * Scrape a single website page using external service
   * @param {string} url - URL to scrape
   * @param {Object} options - Scraping options
   * @returns {Promise<Object>} - Scraping result
   */
  async scrapeWebsite(url, options = {}) {
    try {
      const cleanUrl = this.sanitizeUrl(url);
      logger.info(`Scraping single page via external service: ${cleanUrl}`);

      // Check if external service is available
      const isAvailable = await this.isExternalServiceAvailable();
      if (!isAvailable) {
        throw new Error('External scraping service is currently unavailable. Please try again later or contact support.');
      }

      // Prepare request for external scraping service
      const requestPayload = {
        url: cleanUrl,
        includeJavaScript: false
      };
      logger.debug('Request payload:', requestPayload);

      // Call external scraping service
      const response = await this.api.post('/scrape', requestPayload);
      
      if (!response.data || !response.data.success) {
        throw new Error('External scraping service returned unsuccessful response');
      }

      const rawContent = response.data.data;

      logger.debug('External API response:', {
        hasData: !!rawContent,
        dataType: typeof rawContent,
        contentLength: typeof rawContent === 'string' ? rawContent.length : 'N/A',
        contentPreview: typeof rawContent === 'string' ? rawContent.substring(0, 200) + '...' : 'N/A',
        fullResponse: response.data // Log full response for debugging
      });

      // Enhanced debugging for content issues
      if (typeof rawContent === 'string') {
        logger.info('Content analysis:', {
          hasEncodedChars: /â|˜|°/.test(rawContent),
          hasJavaScript: rawContent.includes('You need to enable JavaScript'),
          encoding: 'checking for encoding issues',
          firstLine: rawContent.split('\n')[0],
          contentSample: rawContent.substring(0, 500)
        });
      }

      // Validate that we have content
      if (!rawContent || (typeof rawContent === 'string' && rawContent.trim().length === 0)) {
        throw new Error('No content could be extracted from this URL. The page might be empty, blocked, or require authentication.');
      }
      
      // Clean up potential encoding issues while preserving raw content structure
      const cleanedContent = this.cleanEncodingIssues(rawContent);
      
      // Process raw content without filtering - store as-is (with encoding fixes)
      const processedResult = await this.processRawContent(cleanUrl, cleanedContent);
      
      // Store in S3 with new folder structure
      await this.storeContentAsFiles(processedResult);
      
      // Note: Knowledge base sync will be triggered manually or at the end of crawling process
      // to avoid concurrent ingestion job conflicts

      logger.info(`Successfully scraped and processed: ${cleanUrl}`);
      
      return {
        url: cleanUrl,
        title: processedResult.title || 'Untitled',
        timestamp: new Date().toISOString(),
        metadata: {
          domain: processedResult.domain,
          source: 'external-scraper',
          folderPath: processedResult.folderPath,
          datasourceFile: processedResult.datasourceFile,
          filesCreated: processedResult.filesCreated
        },
        content: {
          files: processedResult.files
        }
      };

    } catch (error) {
      logger.error('Error scraping website via external service:', error);
      
      // Provide more specific error messages based on the error type
      if (error.response?.status === 503) {
        throw new Error('External scraping service is temporarily unavailable (503). Please try again in a few minutes.');
      } else if (error.response?.status === 502 || error.response?.status === 504) {
        throw new Error('External scraping service is experiencing connectivity issues. Please try again later.');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Cannot connect to external scraping service. Please check your internet connection or try again later.');
      } else if (error.message.includes('timeout')) {
        throw new Error('External scraping service request timed out. Please try again with a smaller website or contact support.');
      } else {
        throw new Error(`Failed to scrape website: ${error.message}`);
      }
    }
  }

  /**
   * Discover pages on a website using external crawling service
   * Uses a fallback strategy for large sites that timeout
   * @param {string} url - Base URL to crawl
   * @param {Object} options - Crawling options
   * @returns {Promise<Object>} - Discovery result
   */
  async discoverWebsitePages(url, options = {}) {
    try {
      const cleanUrl = this.sanitizeUrl(url);
      const domain = new URL(cleanUrl).hostname;
      
      logger.info(`Discovering pages via external service: ${domain}`);

      // Check if external service is available
      const isAvailable = await this.isExternalServiceAvailable();
      if (!isAvailable) {
        throw new Error('External scraping service is currently unavailable. Please try again later or contact support.');
      }

      // Try comprehensive discovery first with shorter timeout
      try {
        const requestPayload = {
          url: cleanUrl,
          maxDepth: options.maxDepth || 10,
          chunkSize: options.chunkSize || 10000
        };

        logger.debug('Enhanced crawl payload:', requestPayload);

        // Use 20-minute timeout for long-running crawl operations
        const response = await this.api.post('/enhanced-crawl', requestPayload, {
          timeout: 1200000 // 20 minutes - allow sufficient time for comprehensive crawling
        });
        
        if (response.data?.success) {
          const discoveryData = response.data;
          
          return {
            domain: domain,
            totalPages: discoveryData.count,
            discoveredUrls: discoveryData.data || [],
            strategy: discoveryData.strategy,
            sitemap: discoveryData.sitemap,
            robots: discoveryData.robots,
            errors: discoveryData.errors || [],
            unlimited: discoveryData.unlimited,
            timestamp: new Date().toISOString()
          };
        }
      } catch (crawlError) {
        logger.warn(`Full crawl failed for ${domain}, trying fallback strategy:`, crawlError.message);
        
        // Fallback: Use direct scraping with common page patterns
        return await this.discoverPagesWithFallback(cleanUrl, options);
      }

    } catch (error) {
      logger.error('Error discovering pages via external service:', error);
      
      // Provide more specific error messages
      if (error.response?.status === 503) {
        throw new Error('External scraping service is temporarily unavailable (503). Please try again in a few minutes.');
      } else if (error.response?.status === 502 || error.response?.status === 504) {
        throw new Error('External scraping service is experiencing connectivity issues. Please try again later.');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Cannot connect to external scraping service. Please check your internet connection or try again later.');
      } else if (error.message.includes('timeout')) {
        throw new Error('Page discovery request timed out. Please try again or contact support.');
      } else {
        throw new Error(`Failed to discover pages: ${error.message}`);
      }
    }
  }

  /**
   * Fallback discovery strategy for large sites
   * @param {string} url - Base URL
   * @param {Object} options - Options
   * @returns {Promise<Object>} - Discovery result with limited pages
   */
  async discoverPagesWithFallback(url, options = {}) {
    const domain = new URL(url).hostname;
    const maxPages = Math.min(options.maxPages || 50, 100); // Cap at 100 for fallback
    
    logger.info(`Using fallback discovery strategy for ${domain}, limited to ${maxPages} pages`);
    
    // Generate common page patterns for the domain
    const commonPatterns = [
      url, // Home page
      `${url}/about`,
      `${url}/contact`,
      `${url}/products`,
      `${url}/services`,
      `${url}/blog`,
      `${url}/news`,
      `${url}/support`,
      `${url}/help`,
      `${url}/faq`
    ];
    
    // For e-commerce sites, add category patterns
    if (domain.includes('shop') || domain.includes('store') || domain.includes('chef')) {
      commonPatterns.push(
        `${url}/category`,
        `${url}/shop`,
        `${url}/store`,
        `${url}/catalog`,
        `${url}/recipes`,
        `${url}/collections`
      );
    }
    
    // Limit to maxPages
    const discoveredUrls = commonPatterns.slice(0, maxPages);
    
    return {
      domain: domain,
      totalPages: discoveredUrls.length,
      discoveredUrls: discoveredUrls,
      strategy: 'fallback-patterns',
      sitemap: false,
      robots: false,
      errors: ['Full discovery timed out, using fallback strategy with common page patterns'],
      unlimited: false,
      timestamp: new Date().toISOString(),
      fallback: true,
      fallbackReason: 'External service timeout - using common page patterns'
    };
  }

  /**
   * Crawl and scrape entire website using external service
   * @param {string} url - Base URL to crawl and scrape
   * @param {Object} options - Crawling and scraping options
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} - Complete crawling result
   */
  async crawlAndScrapeWebsite(url, options = {}, progressCallback = null) {
    try {
      const cleanUrl = this.sanitizeUrl(url);
      const domain = new URL(cleanUrl).hostname;
      
      logger.info(`Starting comprehensive crawl and scrape for: ${domain}`);

      // Report progress: Starting discovery
      if (progressCallback) {
        progressCallback({
          phase: 'discovery',
          message: 'Discovering pages (this may take 5-10 minutes for large sites)...',
          percentage: 10
        });
      }

      // Step 1: Discover all URLs using enhanced crawl
      const discovery = await this.discoverWebsitePages(cleanUrl, options);
      
      let urlsToScrape = discovery.discoveredUrls;

      console.log(urlsToScrape, "urlsToScrape");
      
      // Apply maxPages limit if specified
      if (options.maxPages && urlsToScrape.length > options.maxPages) {
        urlsToScrape = urlsToScrape.slice(0, options.maxPages);
        logger.info(`Limited scraping to ${options.maxPages} pages out of ${discovery.totalPages} discovered`);
      }

      logger.info(`Will scrape ${urlsToScrape.length} pages`);

      // Report progress: Discovery complete, starting scraping
      if (progressCallback) {
        const discoveryMessage = discovery.fallback 
          ? `Used fallback strategy: found ${discovery.totalPages} common pages to scrape`
          : `Found ${discovery.totalPages} pages, starting to scrape ${urlsToScrape.length} pages`;
        
        progressCallback({
          phase: 'scraping',
          message: `${discoveryMessage}...`,
          percentage: 30
        });
      }

      // Step 2: Scrape all discovered pages in batches
      const batchSize = options.batchSize || 3;
      const delay = options.delay || 2000;
      const results = [];
      const errors = [];

      for (let i = 0; i < urlsToScrape.length; i += batchSize) {
        const batch = urlsToScrape.slice(i, i + batchSize);
        const batchNumber = Math.floor(i/batchSize) + 1;
        const totalBatches = Math.ceil(urlsToScrape.length/batchSize);
        
        logger.info(`Processing batch ${batchNumber}/${totalBatches}`);

        // Report batch progress
        if (progressCallback) {
          const scrapingProgress = 30 + ((batchNumber - 1) / totalBatches) * 50; // 30-80% for scraping
          progressCallback({
            phase: 'scraping',
            message: `Processing batch ${batchNumber}/${totalBatches} (${results.length}/${urlsToScrape.length} pages complete)`,
            percentage: Math.round(scrapingProgress)
          });
        }

        const batchPromises = batch.map(async (pageUrl) => {
          try {
            const result = await this.scrapeWebsite(pageUrl, options);
            return result;
          } catch (error) {
            logger.error(`Failed to scrape ${pageUrl}:`, error);
            errors.push({ url: pageUrl, error: error.message });
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));

        // Add delay between batches to be respectful
        if (i + batchSize < urlsToScrape.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      // Report progress: Scraping complete, processing results
      if (progressCallback) {
        progressCallback({
          phase: 'processing',
          message: `Scraping complete! Processing ${results.length} pages...`,
          percentage: 85
        });
      }

      // Step 3: Generate comprehensive summary
      const summary = this.generateCrawlSummary(domain, discovery, results, errors, options);
      
      // Step 4: Store crawl metadata
      await this.storeCrawlMetadata(summary);

      // Report progress: Starting knowledge base sync
      if (progressCallback) {
        progressCallback({
          phase: 'sync',
          message: 'Syncing with knowledge base...',
          percentage: 90
        });
      }

      // Step 5: Trigger knowledge base sync (final step to avoid conflicts)
      if (results.length > 0) {
        try {
          logger.info(`Triggering final knowledge base sync for ${domain}...`);
          const syncResult = await this.triggerKnowledgeBaseSync(domain, true);
          if (syncResult) {
            summary.knowledgeBaseSync = {
              jobId: syncResult.jobId,
              status: syncResult.status,
              startedAt: syncResult.startedAt
            };
            logger.info(`Knowledge base sync initiated: ${syncResult.jobId}`);
          }
        } catch (syncError) {
          logger.warn('Knowledge base sync failed, but scraping completed successfully:', syncError.message);
          summary.knowledgeBaseSync = {
            error: syncError.message,
            note: 'Sync can be triggered manually via /api/scraping/sync endpoint'
          };
        }
      }

      logger.info(`Crawling completed for ${domain}:`);
      logger.info(`  - URLs discovered: ${discovery.totalPages}`);
      logger.info(`  - Pages scraped: ${results.length}/${urlsToScrape.length}`);
      logger.info(`  - Success rate: ${((results.length / urlsToScrape.length) * 100).toFixed(1)}%`);

      // Report final completion
      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          message: `Crawl completed! Processed ${results.length} pages with ${((results.length / urlsToScrape.length) * 100).toFixed(1)}% success rate.`,
          percentage: 100
        });
      }

      return summary;

    } catch (error) {
      logger.error('Error during comprehensive crawling via external service:', error);
      throw error;
    }
  }

  /**
   * Check if content is HTML or plain text
   * @param {string} content - Content to analyze
   * @returns {boolean} - True if HTML, false if plain text
   */
  isHtmlContent(content) {
    if (!content || typeof content !== 'string') {
      return false;
    }
    
    // Check for common HTML tags and patterns
    const htmlPatterns = [
      /<html[\s>]/i,
      /<head[\s>]/i,
      /<body[\s>]/i,
      /<div[\s>]/i,
      /<p[\s>]/i,
      /<span[\s>]/i,
      /<script[\s>]/i,
      /<style[\s>]/i,
      /<meta[\s>]/i,
      /<title[\s>]/i,
      /<!DOCTYPE/i
    ];
    
    // If content contains multiple HTML patterns, it's likely HTML
    const htmlMatches = htmlPatterns.filter(pattern => pattern.test(content)).length;
    
    // Also check for DOCTYPE or opening HTML tags
    const hasDoctype = /<!DOCTYPE/i.test(content);
    const hasHtmlTag = /<html/i.test(content);
    const hasMultipleTags = (content.match(/<[^>]+>/g) || []).length > 3;
    
    return hasDoctype || hasHtmlTag || htmlMatches >= 2 || hasMultipleTags;
  }

  /**
   * Check if content appears to be corrupted or encoded
   * @param {string} content - Content to check
   * @returns {boolean} - True if content appears corrupted
   */
  isCorruptedContent(content) {
    if (!content || typeof content !== 'string') {
      return true;
    }
    
    // Check for corrupted content patterns (be more specific to avoid false positives)
    const corruptedPatterns = [
      /^#content\s*!\s*base64,/i,          // Exact base64 marker pattern (with comma)
      /^data:[\w\/\+]+;base64,/i,          // Data URL with base64
      /^[A-Za-z0-9+\/=]{100,}$/,           // Pure base64 string (100+ chars, longer threshold)
      /^[\+\/=\w]{30,}\+{3,}[\+\/=\w]*$/,  // Base64-like with 3+ consecutive + signs
      /^CiAgPGRlZnM+/i,                    // Specific base64 pattern we saw previously
      /^\s*\+CiAgPGRlZnM/i,               // The exact corrupted pattern from before
      /^[+]{3,}[A-Za-z0-9+\/=]{20,}/,     // Starts with 3+ plus signs
      /PGRlZnM.*PHN0eWxl.*PHNjcmlwdA/i,   // Multiple base64 HTML tags together
    ];

    // Check for suspicious patterns that indicate corrupted content
    const hasCorruptedPattern = corruptedPatterns.some(pattern => pattern.test(content.trim()));
    
    // Check for extremely low readable text ratio (include more characters as "readable")
    const readableChars = (content.match(/[a-zA-Z\s.,!?;:()'"\-\[\]#]/g) || []).length;
    const totalChars = content.length;
    const readableRatio = totalChars > 0 ? readableChars / totalChars : 0;
    
    // Content is corrupted only if it matches specific patterns OR has extremely low readable ratio
    const isCorrupted = hasCorruptedPattern || (totalChars > 50 && readableRatio < 0.2);
    
    if (isCorrupted) {
      logger.warn('Corrupted content detected:', {
        hasCorruptedPattern,
        readableRatio: readableRatio.toFixed(3),
        contentPreview: content.substring(0, 100)
      });
    }
    
    return isCorrupted;
  }

  /**
   * Process plain text content from external scraping service
   * @param {string} url - Source URL
   * @param {string} plainText - Plain text content
   * @returns {Promise<Object>} - Processed data
   */
  async processPlainTextContent(url, plainText) {
    const domain = new URL(url).hostname;
    const timestamp = new Date().toISOString();
    
    logger.debug('Processing plain text content from:', url);
    
    // Check for corrupted/encoded content patterns
    if (this.isCorruptedContent(plainText)) {
      logger.error(`Corrupted content detected from external API for: ${url}`, {
        contentPreview: plainText.substring(0, 200),
        contentLength: plainText.length
      });
      throw new Error(`External API returned corrupted/encoded content for ${url}. Content starts with: ${plainText.substring(0, 50)}`);
    }
    
    // Clean and normalize the plain text
    const cleanedContent = this.cleanExtractedText(plainText);
    
    // Try to extract a title from the first meaningful line
    const lines = cleanedContent.split('\n').filter(line => line.trim().length > 0);
    const title = lines.length > 0 ? lines[0].trim().substring(0, 100) : 'Untitled';
    
    // Use the cleaned content as the full content
    const fullContent = cleanedContent.trim();
    
    logger.debug('Plain text processing results:', {
      title: title.substring(0, 100),
      contentLength: fullContent.length,
      contentPreview: fullContent.substring(0, 200)
    });
    
    if (fullContent.length < 50) {
      logger.warn(`Very little content extracted from ${url}: ${fullContent.length} characters`);
      throw new Error('Insufficient content could be extracted from this page');
    }
    
    // Generate content hash
    const contentHash = generateHash(fullContent);
    
    // Create chunks
    const chunks = this.createContentChunks(fullContent, url, title);
    
    logger.info(`Successfully processed plain text from ${url}: ${chunks.length} chunks, ${fullContent.length} characters`);
    
    return {
      url,
      domain,
      title,
      description: '', // No description available from plain text
      content: fullContent,
      contentHash,
      chunks,
      timestamp,
      metadata: {
        scrapedAt: timestamp,
        source: 'external-scraper',
        contentLength: fullContent.length,
        chunkCount: chunks.length,
        originalContentLength: plainText.length,
        extractionMethod: 'plain-text'
      }
    };
  }

  /**
   * Extract and process content from raw HTML using proper libraries
   * @param {string} url - Source URL
   * @param {string} rawHtml - Raw HTML content from external service
   * @param {boolean} useBackupMethod - Whether to use html-to-text directly
   * @returns {Promise<Object>} - Processed data
   */
  async extractAndProcessContent(url, rawContent, useBackupMethod = false) {
    const domain = new URL(url).hostname;
    const timestamp = new Date().toISOString();
    
    logger.debug('Processing content from:', url);
    logger.debug('Raw content length:', rawContent.length);
    
    // Check for corrupted content first (before HTML/text detection)
    if (this.isCorruptedContent(rawContent)) {
      logger.error(`Corrupted content detected from external API for: ${url}`, {
        contentPreview: rawContent.substring(0, 200),
        contentLength: rawContent.length
      });
      throw new Error(`External API returned corrupted/encoded content for ${url}. Content starts with: ${rawContent.substring(0, 50)}`);
    }
    
    // Detect if content is HTML or plain text
    const isHtml = this.isHtmlContent(rawContent);
    logger.debug('Content type detected:', isHtml ? 'HTML' : 'Plain Text');
    
    // If it's plain text, process it directly
    if (!isHtml) {
      return await this.processPlainTextContent(url, rawContent);
    }
    
    // Load HTML into Cheerio for parsing
    const $ = cheerio.load(rawContent);
    
    // Extract metadata
    const title = $('title').text().trim() || 
                 $('meta[property="og:title"]').attr('content') || 
                 $('h1').first().text().trim() || 
                 'Untitled';
    
    const description = $('meta[name="description"]').attr('content') || 
                       $('meta[property="og:description"]').attr('content') || 
                       '';
    
    // Remove script and style elements completely
    $('script, style, noscript, link[rel="stylesheet"]').remove();
    
    // Remove common non-content elements and noise
    $('nav, header, footer, aside, .sidebar, .menu, .navigation, .ads, .advertisement').remove();
    $('[class*="cookie"], [class*="banner"], [class*="popup"], [class*="modal"]').remove();
    $('[class*="osano"], [id*="osano"]').remove(); // Remove Osano cookie consent
    $('.visually-hidden, .sr-only, .hidden').remove(); // Remove hidden elements
    
    // Remove JSON-LD structured data scripts
    $('script[type="application/ld+json"]').remove();
    $('script[type="application/json"]').remove();
    
    // Remove form elements that often contain technical noise
    $('form, input, select, textarea, button').remove();
    
    // Remove any remaining script-like content that might have been embedded as text
    $('*').each(function() {
      const text = $(this).text();
      if (text.includes('---EMBEDDED SCRIPT DATA---') || 
          text.includes('var ') || 
          text.includes('function ') ||
          text.includes('$(document)') ||
          text.includes('window.') ||
          text.match(/\w+\s*=\s*new\s+\w+/)) {
        $(this).remove();
      }
    });
    
    // Extract main content using multiple strategies
    let mainContent = '';
    
    if (useBackupMethod) {
      // Use html-to-text directly for better content extraction
      logger.debug('Using html-to-text backup method for content extraction');
      
      // Pre-process the raw content to remove embedded script sections
      let preprocessedContent = rawContent;
      preprocessedContent = preprocessedContent.replace(/---EMBEDDED SCRIPT DATA---[\s\S]*?(?=---|\n\n|\r\n\r\n|$)/gi, '');
      
      mainContent = convert(preprocessedContent, {
        wordwrap: false,
        ignoreHref: true,
        ignoreImage: true,
        preserveNewlines: false,
        singleNewLineParagraphs: true,
        uppercaseHeadings: false,
        selectors: [
          { selector: 'script', format: 'skip' },
          { selector: 'script[type="application/ld+json"]', format: 'skip' },
          { selector: 'script[type="application/json"]', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'nav', format: 'skip' },
          { selector: 'header', format: 'skip' },
          { selector: 'footer', format: 'skip' },
          { selector: 'form', format: 'skip' },
          { selector: 'input', format: 'skip' },
          { selector: 'button', format: 'skip' },
          { selector: '[class*="osano"]', format: 'skip' },
          { selector: '[class*="cookie"]', format: 'skip' },
          { selector: '.visually-hidden', format: 'skip' },
          { selector: '.sr-only', format: 'skip' },
          { selector: 'noscript', format: 'skip' },
          { selector: 'link', format: 'skip' }
        ]
      });
    } else {
      // Strategy 1: Look for main content containers
      const contentSelectors = [
        'main',
        'article', 
        '.content',
        '#content',
        '.main-content',
        '.post-content',
        '.entry-content',
        '.article-content',
        '.page-content'
      ];
      
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length && element.text().trim().length > mainContent.length) {
          mainContent = element.text().trim();
        }
      }
      
      // Strategy 2: If no main content found, get body content
      if (!mainContent || mainContent.length < 100) {
        mainContent = $('body').text().trim();
      }
      
      // Strategy 3: Use html-to-text for better text extraction as fallback
      if (!mainContent || mainContent.length < 100) {
        // Pre-process to remove embedded script sections
        let preprocessedContent = rawContent;
        preprocessedContent = preprocessedContent.replace(/---EMBEDDED SCRIPT DATA---[\s\S]*?(?=---|\n\n|\r\n\r\n|$)/gi, '');
        
        mainContent = convert(preprocessedContent, {
          wordwrap: false,
          ignoreHref: true,
          ignoreImage: true,
          preserveNewlines: false,
          singleNewLineParagraphs: true,
          uppercaseHeadings: false,
          selectors: [
            { selector: 'script', format: 'skip' },
            { selector: 'script[type="application/ld+json"]', format: 'skip' },
            { selector: 'script[type="application/json"]', format: 'skip' },
            { selector: 'style', format: 'skip' },
            { selector: 'nav', format: 'skip' },
            { selector: 'header', format: 'skip' },
            { selector: 'footer', format: 'skip' },
            { selector: 'form', format: 'skip' },
            { selector: 'input', format: 'skip' },
            { selector: 'button', format: 'skip' },
            { selector: 'noscript', format: 'skip' },
            { selector: 'link', format: 'skip' }
          ]
        });
      }
    }
    
    // Clean and normalize the content
    const cleanedContent = this.cleanExtractedText(mainContent);
    
    logger.debug('Extraction results:', {
      title: title.substring(0, 100),
      descriptionLength: description.length,
      cleanedContentLength: cleanedContent.length,
      contentPreview: cleanedContent.substring(0, 200)
    });
    
    // Combine all content
    const fullContent = [title, description, cleanedContent]
      .filter(part => part && part.trim().length > 0)
      .join('\n\n')
      .trim();
    
    // Validate content quality - check for CSS/JS patterns that suggest bad extraction
    const cssJsPatterns = [
      /font-family:/gi,
      /background-color:/gi,
      /border-radius:/gi,
      /osano-cm-/gi,
      /transition-/gi,
      /webkit-/gi,
      /---EMBEDDED SCRIPT DATA---/gi,
      /var\s+\w+\s*=/gi,
      /function\s+\w+\s*\(/gi,
      /document\.\w+/gi,
      /window\.\w+/gi,
      /\$\(document\)/gi,
      /googleGeocodeKey/gi,
      /SYNCHRONIZER_TOKEN/gi,
      /MM_\w+/gi,
      /mouseflow/gi,
      /issuuembed/gi
    ];
    
    const hasCssJs = cssJsPatterns.some(pattern => pattern.test(fullContent));
    const meaningfulWords = (fullContent.match(/[a-zA-Z]{3,}/g) || []).length;
    const totalChars = fullContent.length;
    
    logger.debug('Content quality check:', {
      length: totalChars,
      meaningfulWords,
      hasCssJs,
      ratio: meaningfulWords / totalChars * 100
    });
    
    if (fullContent.length < 50) {
      logger.warn(`Very little content extracted from ${url}: ${fullContent.length} characters`);
      throw new Error('Insufficient content could be extracted from this page');
    }
    
    if (hasCssJs || meaningfulWords / totalChars < 0.05) {
      logger.warn(`Poor content quality detected for ${url} - likely CSS/JS content`);
      logger.debug('Content preview:', fullContent.substring(0, 300));
      
      // Try html-to-text as backup method
      logger.debug('Attempting backup extraction with html-to-text...');
      
      // Pre-process to remove embedded script sections
      let preprocessedContent = rawContent;
      preprocessedContent = preprocessedContent.replace(/---EMBEDDED SCRIPT DATA---[\s\S]*?(?=---|\n\n|\r\n\r\n|$)/gi, '');
      
      const backupContent = convert(preprocessedContent, {
        wordwrap: false,
        ignoreHref: true,
        ignoreImage: true,
        preserveNewlines: false,
        singleNewLineParagraphs: true,
        uppercaseHeadings: false,
        selectors: [
          { selector: 'script', format: 'skip' },
          { selector: 'script[type="application/ld+json"]', format: 'skip' },
          { selector: 'script[type="application/json"]', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'nav', format: 'skip' },
          { selector: 'header', format: 'skip' },
          { selector: 'footer', format: 'skip' },
          { selector: 'form', format: 'skip' },
          { selector: 'input', format: 'skip' },
          { selector: 'button', format: 'skip' },
          { selector: '[class*="osano"]', format: 'skip' },
          { selector: '[class*="cookie"]', format: 'skip' },
          { selector: 'noscript', format: 'skip' },
          { selector: 'link', format: 'skip' }
        ]
      });
      
      const cleanedBackup = this.cleanExtractedText(backupContent);
      if (cleanedBackup.length > fullContent.length && !useBackupMethod) {
        logger.debug('Using backup extraction method');
        return await this.extractAndProcessContent(url, rawContent, true); // Recursive call with backup flag
      }
    }
    
    // Generate content hash
    const contentHash = generateHash(fullContent);
    
    // Create chunks
    const chunks = this.createContentChunks(fullContent, url, title);
    
    logger.info(`Successfully processed ${url}: ${chunks.length} chunks, ${fullContent.length} characters`);
    
    return {
      url,
      domain,
      title,
      description,
      content: fullContent,
      contentHash,
      chunks,
      timestamp,
      metadata: {
        scrapedAt: timestamp,
        source: 'external-scraper',
        contentLength: fullContent.length,
        chunkCount: chunks.length,
        originalContentLength: rawContent.length,
        extractionMethod: 'cheerio'
      }
    };
  }

  /**
   * Clean extracted text content
   * @param {string} text - Raw extracted text
   * @returns {string} - Cleaned text
   */
  cleanExtractedText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    let cleaned = text;
    
    // Remove JSON-LD structured data completely
    cleaned = cleaned.replace(/\{\s*["']@context["'][\s\S]*?\}/gi, '');
    cleaned = cleaned.replace(/\{\s*["']@type["'][\s\S]*?\}/gi, '');
    cleaned = cleaned.replace(/\{\s*["']@id["'][\s\S]*?\}/gi, '');
    
    // Remove script references and metadata
    cleaned = cleaned.replace(/JAVASCRIPT CONTENT[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/(EXTERNAL|INLINE)\s+SCRIPT\s+\d+/gi, '');
    cleaned = cleaned.replace(/--- Source:\s+Type:\s+[\w\/]+[\s\S]*$/gi, '');
    
    // Remove embedded script data sections completely - enhanced pattern
    cleaned = cleaned.replace(/---EMBEDDED SCRIPT DATA---[\s\S]*?(?=---[^-]|$)/gi, '');
    cleaned = cleaned.replace(/---[\s\S]*?---/gi, ''); // Remove any remaining --- sections
    
    // Remove script blocks and any remaining JavaScript code - more aggressive
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/\bvar\s+\w+[\s\S]*?;/gi, ''); // Remove var declarations
    cleaned = cleaned.replace(/\blet\s+\w+[\s\S]*?;/gi, ''); // Remove let declarations  
    cleaned = cleaned.replace(/\bconst\s+\w+[\s\S]*?;/gi, ''); // Remove const declarations
    cleaned = cleaned.replace(/\bfunction\s+\w+[\s\S]*?\}/gi, ''); // Remove function definitions
    cleaned = cleaned.replace(/\$\([^)]*\)[\s\S]*?;/gi, ''); // Remove jQuery calls
    cleaned = cleaned.replace(/document\.[^;]*;?/gi, ''); // Remove document calls
    cleaned = cleaned.replace(/window\.[^;]*;?/gi, ''); // Remove window calls
    cleaned = cleaned.replace(/elementorFrontend[\s\S]*?;/gi, ''); // Remove elementor code
    
    // Remove JavaScript operators and syntax patterns
    cleaned = cleaned.replace(/=>/gi, ''); // Arrow functions
    cleaned = cleaned.replace(/\{\s*\}/gi, ''); // Empty objects
    cleaned = cleaned.replace(/\[\s*\]/gi, ''); // Empty arrays
    cleaned = cleaned.replace(/\w+\s*=\s*\w+\s*=>/gi, ''); // Variable assignments with arrows
    cleaned = cleaned.replace(/\w+\.\w+\s*=\s*[^;]*;?/gi, ''); // Property assignments
    
    // Remove JavaScript patterns more selectively
    cleaned = cleaned.replace(/\bvar\s+\w+\s*=\s*[^;]*;?/gi, ''); // Variable assignments starting with var
    cleaned = cleaned.replace(/\blet\s+\w+\s*=\s*[^;]*;?/gi, ''); // Variable assignments starting with let
    cleaned = cleaned.replace(/\bconst\s+\w+\s*=\s*[^;]*;?/gi, ''); // Variable assignments starting with const
    cleaned = cleaned.replace(/for\s*\([^)]*\)[^}]*\}/gi, ''); // for loops
    cleaned = cleaned.replace(/if\s*\([^)]*\)[^}]*\}/gi, ''); // if statements
    cleaned = cleaned.replace(/else\s*\{[^}]*\}/gi, ''); // else blocks
    cleaned = cleaned.replace(/\w+\.\w+\([^)]*\)/gi, ''); // Object method calls like document.getElementById
    
    // Remove only code-like parentheses, not natural language ones
    cleaned = cleaned.replace(/\b\w+\([^)]*\)/gi, ''); // Function calls only
    
    // Remove CSS rules and properties more aggressively
    cleaned = cleaned.replace(/\.[\w-]+\s*\{[^}]*\}/g, ''); // CSS class rules
    cleaned = cleaned.replace(/#[\w-]+\s*\{[^}]*\}/g, ''); // CSS ID rules
    cleaned = cleaned.replace(/[\w-]+:\s*[^;{]+[;}]/gi, ''); // CSS properties
    
    // Remove API keys and security tokens
    cleaned = cleaned.replace(/\b[A-Za-z0-9]{20,}\b/g, ''); // Long alphanumeric strings (likely tokens/keys)
    cleaned = cleaned.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, ''); // Google API keys specifically
    cleaned = cleaned.replace(/SYNCHRONIZER_TOKEN[_\w]*\s*=\s*['""][^'"]*['""];?/gi, '');
    
    // Remove developer/technical noise more comprehensively
    const technicalPatterns = [
      // Remove JSON-LD patterns more comprehensively
      /"@context"[\s\S]*?"}/gi,
      /"@type"[\s\S]*?"}/gi,
      /"@id"[\s\S]*?"}/gi,
      /"isPartOf"[\s\S]*?"}/gi,
      /"primaryImageOfPage"[\s\S]*?"}/gi,
      /"breadcrumb"[\s\S]*?"}/gi,
      /"inLanguage"[\s\S]*?"}/gi,
      /"potentialAction"[\s\S]*?\]/gi,
      /"ImageObject"[\s\S]*?"}/gi,
      /"BreadcrumbList"[\s\S]*?"}/gi,
      /"ReadAction"[\s\S]*?\]/gi,
      
      // Remove script metadata and references
      /JAVASCRIPT CONTENT[\s\S]*/gi,
      /(EXTERNAL|INLINE)\s+SCRIPT\s+\d+/gi,
      /--- Source:\s+Type:[\s\S]*$/gi,
      /Type:\s+text\/javascript[\s\S]*$/gi,
      
      // Remove JavaScript code fragments  
      /let\s+\w+\s*=/gi,
      /const\s+\w+\s*=/gi,
      /var\s+\w+\s*=/gi,
      /\w+\s*=\s*\w+\s*=>/gi,
      /=>\s*\{/gi,
      /\}\s*\)/gi,
      /\)\s*=>/gi,
      /curr_item\./gi,
      /mega_item/gi,
      /mega_content/gi,
      /elementorFrontend/gi,
      /\.style\.display/gi,
      /ret_str/gi,
      /t_selector_options/gi,
      /phone_prefix_selectors/gi,
      /phoneNumberField/gi,
      /parentElement/gi,
      
      // Remove common developer patterns
      /MM_\w+\([^)]*\)/gi, // Legacy browser functions
      /\bretries?:\s*\d+/gi,
      /\btimeout:\s*\d+/gi,
      /\bsetInterval\([^)]*\)/gi,
      /\bsetTimeout\([^)]*\)/gi,
      /\bclearInterval\([^)]*\)/gi,
      /\bclearTimeout\([^)]*\)/gi,
      
      // Remove regex and technical strings
      /new\s+RegExp\([^)]*\)/gi,
      /\.replace\([^)]*\)/gi,
      /\.match\([^)]*\)/gi,
      /\.test\([^)]*\)/gi,
      /\\[nrtbfv\\'"]/gi, // Escape sequences
      
      // Remove URLs and technical identifiers
      /https?:\/\/[^\s)]+/gi,
      /\b\w+\.\w+\.\w+[\w.]*\b/gi, // Domain-like patterns
      /\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/gi, // UUIDs
      
      // Remove form field patterns
      /input\s+type\s*=\s*['"]\w+['"]/gi,
      /name\s*=\s*['"]\w+['"]/gi,
      /value\s*=\s*['""][^'"]*['"]/gi,
      
      // Common web noise
      /skip to (main )?content/gi,
      /click to expand/gi,
      /read more/gi,
      /show more/gi,
      /load more/gi,
      /cookie policy/gi,
      /privacy policy/gi,
      /terms of service/gi,
      /subscribe to newsletter/gi,
      /share on \w+/gi,
      /follow us on/gi,
      /newsletter signup/gi,
      /character\(s\)\s+over\s+limit/gi,
      /characters?\s+left/gi,
      /remaining\s+characters/gi,
      
      // Remove Osano and tracking related content
      /osano-cm-[\w-]+/gi,
      /webkit-[\w-]+/gi,
      /mouseflow[_\w]*/gi,
      /issuuembed[_\w]*/gi,
      /googleGeocodeKey/gi,
      /JSESSIONID/gi,
      /NOIBUJS/gi
    ];
    
    technicalPatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    // Additional aggressive cleaning for remaining structured data and code fragments
    cleaned = cleaned.replace(/\{[^}]*@[^}]*\}/gi, ''); // Any remaining JSON-LD objects
    cleaned = cleaned.replace(/\\"[^"]*\\"/gi, ''); // Escaped quotes in JSON
    cleaned = cleaned.replace(/\\u[0-9a-fA-F]{4}/gi, ''); // Unicode escape sequences
    cleaned = cleaned.replace(/[\{\}\[\]]/gi, ''); // Remove remaining braces and brackets that might be code
    cleaned = cleaned.replace(/[;,]\s*$/gmi, ''); // Remove trailing semicolons and commas at end of lines
    cleaned = cleaned.replace(/^\s*[;,]\s*/gmi, ''); // Remove leading semicolons and commas at start of lines
    cleaned = cleaned.replace(/\s*(=|=>|::|\|\||\&\&)\s*/gi, ' '); // Remove operators
    cleaned = cleaned.replace(/\s*(\(|\))\s*/gi, ' '); // Clean up remaining parentheses with spacing
    
    // Remove email addresses and any remaining URLs
    cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');
    
    // Normalize whitespace and remove empty lines
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n/g, '\n');
    cleaned = cleaned.replace(/\s+\n/g, '\n');
    cleaned = cleaned.replace(/\n\s+/g, '\n');
    
    // Remove lines that are mostly punctuation or symbols, or contain code patterns
    cleaned = cleaned.split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (trimmed.length < 3) return false;
        
        // Skip lines that look like code or structured data
        const codePatterns = [
          /@\w+/,  // @context, @type, etc.
          /^\s*[\{\}\[\],;]/,  // Lines starting with code punctuation
          /=>/,  // Arrow functions
          /\w+\.\w+\s*=/,  // Property assignments
          /^\s*(let|var|const|function)\s+/,  // Variable/function declarations
          /(EXTERNAL|INLINE)\s+SCRIPT/,  // Script references
          /Type:\s*text\/javascript/,  // Script type declarations
          /JAVASCRIPT\s+CONTENT/,  // Script content markers
          /elementorFrontend/,  // Specific framework code
          /curr_item|mega_item|ret_str/  // Specific variable names from the sample
        ];
        
        if (codePatterns.some(pattern => pattern.test(trimmed))) {
          return false;
        }
        
        const alphaChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
        return alphaChars / trimmed.length > 0.3; // At least 30% alphabetic characters
      })
      .join('\n');
    
    // Final cleanup
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }

  /**
   * Clean up common encoding issues from external scraper
   * @param {string} content - Raw content from external service
   * @returns {string} - Content with encoding issues fixed
   */
  cleanEncodingIssues(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    logger.info('Cleaning encoding issues from content');
    
    let cleaned = content;
    
    // Fix common encoding issues
    const encodingFixes = {
      // Fix UTF-8 encoding issues
      'â˜°': '☰',  // Hamburger menu icon
      'â': '',     // Remove stray â characters
      '˜': '~',    // Fix tilde
      '°': '°',    // Fix degree symbol
      'â€™': "'",  // Right single quotation mark
      'â€œ': '"',  // Left double quotation mark  
      'â€': '"',   // Right double quotation mark
      'â€"': '–',  // En dash
      'â€"': '—',  // Em dash
      'Â©': '©',   // Copyright symbol
      'Â®': '®',   // Registered trademark
      'Â': '',     // Remove stray Â characters
    };

    // Apply encoding fixes
    for (const [encoded, decoded] of Object.entries(encodingFixes)) {
      cleaned = cleaned.replace(new RegExp(encoded, 'g'), decoded);
    }

    // Remove extra whitespace and normalize line breaks
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    logger.info('Encoding cleanup completed:', {
      originalLength: content.length,
      cleanedLength: cleaned.length,
      hasEncodingIssues: cleaned !== content,
      sampleBefore: content.substring(0, 100),
      sampleAfter: cleaned.substring(0, 100)
    });

    return cleaned;
  }

  /**
   * Process raw content without filtering - store as-is
   * @param {string} url - Source URL
   * @param {string} rawContent - Raw content from external scraper
   * @returns {Promise<Object>} - Processed data for storage
   */
  async processRawContent(url, rawContent) {
    const domain = new URL(url).hostname;
    const timestamp = new Date().toISOString();
    
    logger.debug('Processing raw content from:', url);
    logger.debug('Raw content length:', rawContent.length);
    
    // Extract title from content (simple extraction)
    let title = 'Untitled';
    try {
      // Try to extract title from HTML if it's HTML content
      if (rawContent.includes('<title>')) {
        const titleMatch = rawContent.match(/<title[^>]*>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        }
      } else {
        // For plain text, use first line as title
        const firstLine = rawContent.split('\n')[0].trim();
        if (firstLine.length > 0 && firstLine.length < 100) {
          title = firstLine;
        }
      }
    } catch (error) {
      logger.warn('Could not extract title, using default:', error.message);
    }
    
    // Sanitize title for file names
    const sanitizedTitle = this.sanitizeTitle(title);
    
    logger.info(`Processed raw content from ${url}: ready for storage`);
    
    // Create a single file object that will be processed by storage function
    const fileData = {
      content: rawContent,
      metadata: {
        id: domain.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-'),
        type: 'web',
        display_name: url,
        title: sanitizedTitle,
        source_url: url,
        created_at: timestamp,
        updated_at: timestamp,
        contentLength: rawContent.length,
        contentHash: generateHash(rawContent)
      }
    };
    
    return {
      url,
      domain,
      title: sanitizedTitle,
      originalTitle: title,
      content: rawContent,
      files: [fileData], // Single file that will be chunked during storage
      timestamp,
      metadata: {
        scrapedAt: timestamp,
        source: 'external-scraper',
        originalContentLength: rawContent.length,
        filesCreated: 1,
        extractionMethod: 'raw-content'
      }
    };
  }

  /**
   * Sanitize title for file names
   * @param {string} title - Original title
   * @returns {string} - Sanitized title
   */
  sanitizeTitle(title) {
    if (!title || typeof title !== 'string') {
      return 'untitled';
    }
    
    return title
      // Replace spaces with underscores
      .replace(/\s+/g, '_')
      // Remove or replace problematic characters for file names
      .replace(/[<>:"/\\|?*]/g, '_')
      // Remove control characters
      .replace(/[\x00-\x1f\x80-\x9f]/g, '')
      // Limit length
      .substring(0, 100)
      // Remove trailing underscores
      .replace(/^_+|_+$/g, '')
      // Ensure we have something
      || 'untitled';
  }

  /**
   * Create simple content chunks based on character limits
   * @param {string} content - Full content
   * @param {string} url - Source URL  
   * @param {string} sanitizedTitle - Sanitized title
   * @param {string} domain - Domain name
   * @returns {Array} - Array of file objects
   */
  createSimpleChunks(content, url, sanitizedTitle, domain) {
    const files = [];
    const maxChunkSize = 15000; // Maximum 15,000 characters per file
    const minChunkSize = 10000; // Minimum 10,000 characters per file (when possible)
    
    if (!content || content.length === 0) {
      return files;
    }

    // If content is small enough, create single file
    if (content.length <= maxChunkSize) {
      const contentHash = generateHash(content);
      const currentTimestamp = new Date().toISOString();
      
      files.push({
        fileName: `${sanitizedTitle}.txt`,
        content: content,
        metadata: {
          id: domain.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-'),
          type: 'web',
          display_name: url,
          title: sanitizedTitle,
          source_url: url,
          created_at: currentTimestamp,
          updated_at: currentTimestamp,
          part: 1,
          totalParts: 1,
          contentLength: content.length,
          contentHash: contentHash
        }
      });
      return files;
    }

    // Split content into chunks
    let chunkIndex = 1;
    let startIndex = 0;
    
    while (startIndex < content.length) {
      let endIndex = Math.min(startIndex + maxChunkSize, content.length);
      
      // If we're not at the end, try to find a good break point
      if (endIndex < content.length) {
        // Look for paragraph breaks
        let breakPoint = content.lastIndexOf('\n\n', endIndex);
        if (breakPoint > startIndex + minChunkSize) {
          endIndex = breakPoint;
        } else {
          // Look for sentence breaks
          breakPoint = content.lastIndexOf('. ', endIndex);
          if (breakPoint > startIndex + minChunkSize) {
            endIndex = breakPoint + 1;
          } else {
            // Look for any line break
            breakPoint = content.lastIndexOf('\n', endIndex);
            if (breakPoint > startIndex + minChunkSize) {
              endIndex = breakPoint;
            }
            // Otherwise just split at maxChunkSize
          }
        }
      }
      
      const chunkContent = content.substring(startIndex, endIndex).trim();
      
      if (chunkContent.length > 0) {
        const totalParts = Math.ceil(content.length / maxChunkSize);
        const partSuffix = totalParts > 1 ? `-part${chunkIndex}` : '';
        const chunkHash = generateHash(chunkContent);
        const currentTimestamp = new Date().toISOString();
        
        files.push({
          fileName: `${sanitizedTitle}${partSuffix}.txt`,
          content: chunkContent,
          metadata: {
            id: domain.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-'),
            type: 'web',
            display_name: url,
            title: sanitizedTitle,
            source_url: url,
            created_at: currentTimestamp,
            updated_at: currentTimestamp,
            part: chunkIndex,
            totalParts: totalParts,
            contentLength: chunkContent.length,
            contentHash: chunkHash
          }
        });
        
        chunkIndex++;
      }
      
      startIndex = endIndex;
    }
    
    return files;
  }

  /**
   * Check if URL points to a document (PDF, DOC, etc.) vs webpage
   * @param {string} url - URL to check
   * @returns {boolean} - True if document, false if webpage
   */
  isDocumentUrl(url) {
    const documentExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'];
    const urlLower = url.toLowerCase();
    return documentExtensions.some(ext => urlLower.includes(ext));
  }

  /**
   * Generate clean filename from URL
   * @param {string} url - Source URL
   * @param {boolean} isDocument - Whether this is a document
   * @returns {string} - Clean filename
   */
  generateFileNameFromUrl(url, isDocument) {
    try {
      const urlObj = new URL(url);
      let path = urlObj.pathname;
      
      // Handle root/home page
      if (path === '/' || path === '') {
        return 'index';
      }
      
      // Remove leading slash and clean up path
      path = path.replace(/^\/+/, '').replace(/\/+$/, '');
      
      if (isDocument) {
        // For documents, use the filename without extension
        const fileName = path.split('/').pop();
        return fileName.replace(/\.[^.]+$/, ''); // Remove extension
      } else {
        // For webpages, use path segments
        return path.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-') || 'page';
      }
    } catch (error) {
      logger.warn(`Error generating filename from URL ${url}:`, error.message);
      return isDocument ? 'document' : 'page';
    }
  }

  /**
   * Create chunks from content with hashes
   * @param {string} content - Content to chunk
   * @returns {Array} - Array of chunks with hashes
   */
  createChunksFromContent(content) {
    const chunks = [];
    const maxChunkSize = 15000; // Same as before
    const minChunkSize = 10000;
    
    if (!content || content.length === 0) {
      return chunks;
    }

    // If content is small enough, create single chunk
    if (content.length <= maxChunkSize) {
      chunks.push({
        id: generateHash(content).substring(0, 12), // First 12 chars of hash as ID
        text: content,
        hash: generateHash(content)
      });
      return chunks;
    }

    // Split content into chunks
    let startIndex = 0;
    let chunkNumber = 1;
    
    while (startIndex < content.length) {
      let endIndex = Math.min(startIndex + maxChunkSize, content.length);
      
      // Try to find good break points (same logic as before)
      if (endIndex < content.length) {
        let breakPoint = content.lastIndexOf('\n\n', endIndex);
        if (breakPoint > startIndex + minChunkSize) {
          endIndex = breakPoint;
        } else {
          breakPoint = content.lastIndexOf('. ', endIndex);
          if (breakPoint > startIndex + minChunkSize) {
            endIndex = breakPoint + 1;
          } else {
            breakPoint = content.lastIndexOf('\n', endIndex);
            if (breakPoint > startIndex + minChunkSize) {
              endIndex = breakPoint;
            }
          }
        }
      }
      
      const chunkContent = content.substring(startIndex, endIndex).trim();
      
      if (chunkContent.length > 0) {
        const chunkHash = generateHash(chunkContent);
        chunks.push({
          id: `${chunkHash.substring(0, 8)}_${chunkNumber}`, // Short hash + number
          text: chunkContent,
          hash: chunkHash
        });
        chunkNumber++;
      }
      
      startIndex = endIndex;
    }
    
    return chunks;
  }

  /**
   * Store content using proper datasource structure with subfolders
   * @param {Object} processedData - Processed data from processRawContent
   */
  async storeContentAsFiles(processedData) {
    try {
      const { domain, files, url } = processedData;
      const storedFiles = [];
      
      // Create proper datasource structure: datasources/ansar-portfolio-pages-dev/
      const datasourceId = domain.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-');
      const datasourcePath = `datasources/${datasourceId}`;
      
      // Create datasource.json (master metadata)
      const datasourceKey = `${datasourcePath}/datasource.json`;
      const datasourceContent = {
        id: datasourceId,
        type: 'web',
        display_name: `https://${domain}`,
        source_url: url,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        documents: [] // Will be populated with actual document paths
      };
      
      // Process each file and organize by type
      const documentPaths = [];
      
      for (const file of files) {
        // Determine content type and subfolder
        const sourceUrl = file.metadata.source_url;
        const isDocument = this.isDocumentUrl(sourceUrl);
        const subfolder = isDocument ? 'documents' : 'webpages';
        
        // Generate filename based on URL path
        const fileName = this.generateFileNameFromUrl(sourceUrl, isDocument);
        const jsonKey = `${datasourcePath}/${subfolder}/${fileName}.json`;
        
        // Create chunked content structure
        const pageContent = {
          url: sourceUrl,
          title: file.metadata.title,
          chunks: this.createChunksFromContent(file.content),
          last_scraped: new Date().toISOString(),
          content_hash: file.metadata.contentHash,
          content_length: file.metadata.contentLength
        };
        
        // Store the page JSON file
        await this.s3Client.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: jsonKey,
          Body: JSON.stringify(pageContent, null, 2),
          ContentType: 'application/json',
          Metadata: {
            "source-type": isDocument ? 'document-content' : 'webpage-content',
            "domain": domain,
            "datasource": datasourceId,
            "type": 'content-json',
            "scraped-at": new Date().toISOString()
          }
        }));
        
        // Add to document paths for datasource.json
        documentPaths.push(`${subfolder}/${fileName}.json`);
        
        storedFiles.push({
          contentFile: jsonKey,
          size: file.content.length,
          type: isDocument ? 'document' : 'webpage'
        });
        
        logger.info(`Stored: ${jsonKey} (${file.content.length} chars)`);
      }
      
      // Update datasource.json with document paths
      datasourceContent.documents = documentPaths;
      
      // Create/update datasource.json 
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: datasourceKey,
        Body: JSON.stringify(datasourceContent, null, 2),
        ContentType: 'application/json',
        Metadata: {
          "source-type": 'datasource-config',
          "domain": domain,
          "datasource": datasourceId,
          "type": 'datasource',
          "created-at": new Date().toISOString()
        }
      }));
      
      // Update processedData with storage results
      processedData.filesCreated = storedFiles;
      processedData.datasourceFile = datasourceKey;
      processedData.folderPath = datasourcePath;
      
      logger.info(`Successfully stored ${files.length} files for ${domain} in datasource structure: ${datasourcePath}`);
      logger.info(`Datasource configuration: ${datasourceKey}`);
      logger.info(`Datasource ID: ${datasourceId}`);
      logger.info(`Document paths: ${documentPaths.join(', ')}`);
      
    } catch (error) {
      logger.error('Error storing content as files:', error);
      throw new Error(`Failed to store content as files: ${error.message}`);
    }
  }

  /**
   * Create intelligent content chunks for vector storage
   * Optimized for semantic search and retrieval with enhanced context preservation
   * @param {string} content - Full content text
   * @param {string} url - Source URL
   * @param {string} title - Page title
   * @returns {Array} - Array of chunks
   */
  createContentChunks(content, url, title) {
    const chunks = [];
    
    // Enhanced chunking strategy for optimal semantic search performance
    // Strategy: Create semantically rich chunks with hierarchical content and context
    const primaryChunkSize = 8000; // Primary content for optimal embedding performance
    const contextChunkSize = 4000; // Additional context for semantic understanding
    const maxChunkSize = 12000; // Total maximum size for efficient processing
    const overlapSize = 400; // Overlap for better context continuity
    
    if (!content || content.length === 0) {
      return chunks;
    }

    // Enhanced semantic chunking with hierarchical content organization
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    let currentChunk = '';
    let contextualContent = ''; // Additional context for better semantic understanding
    let chunkIndex = 0;
    
    // Create section-aware chunking for better semantic coherence
    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();
      
      // Check if this paragraph looks like a heading/section marker
      const isHeading = this.isLikelyHeading(trimmedParagraph);
      
      // If adding this paragraph would exceed our primary chunk size
      if (currentChunk.length + trimmedParagraph.length > primaryChunkSize && currentChunk.length > 0) {
        
        // Build contextual content from surrounding paragraphs for richer embedding
        const contextStartIdx = Math.max(0, paragraphs.indexOf(trimmedParagraph) - 3);
        const contextEndIdx = Math.min(paragraphs.length, paragraphs.indexOf(trimmedParagraph) + 3);
        const contextParagraphs = paragraphs.slice(contextStartIdx, contextEndIdx);
        contextualContent = contextParagraphs.join('\n\n').substring(0, contextChunkSize);
        
        // Create enhanced chunk with primary content + contextual information
        chunks.push(this.createEnhancedChunk(
          currentChunk.trim(), 
          contextualContent,
          url, 
          title, 
          chunkIndex,
          { isHeadingStart: isHeading }
        ));
        chunkIndex++;
        
        // Smart overlap strategy: preserve more context for headings
        if (currentChunk.length > overlapSize) {
          const words = currentChunk.split(' ');
          const overlapWords = isHeading ? 
            words.slice(-Math.floor(overlapSize / 3)) : // More overlap for headings
            words.slice(-Math.floor(overlapSize / 6));   // Standard overlap
          currentChunk = overlapWords.join(' ') + '\n\n' + trimmedParagraph;
        } else {
          currentChunk = trimmedParagraph;
        }
      } else {
        // Add paragraph to current chunk
        currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
      }
      
      // Handle very long paragraphs by splitting at sentence boundaries
      if (trimmedParagraph.length > primaryChunkSize) {
        const sentences = this.splitIntoSentences(trimmedParagraph);
        currentChunk = ''; // Reset current chunk
        
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length > primaryChunkSize && sentenceChunk.length > 0) {
            // Get contextual content for this sentence chunk
            const sentenceContext = this.buildSentenceContext(sentence, content, contextChunkSize);
            
            chunks.push(this.createEnhancedChunk(
              sentenceChunk.trim(), 
              sentenceContext,
              url, 
              title, 
              chunkIndex,
              { isLongParagraphSplit: true }
            ));
            chunkIndex++;
            
            // Add overlap for sentence chunks
            const words = sentenceChunk.split(' ');
            const overlapWords = words.slice(-Math.floor(overlapSize / 6));
            sentenceChunk = overlapWords.join(' ') + ' ' + sentence;
          } else {
            sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
          }
        }
        
        // Add remaining sentence chunk
        if (sentenceChunk.trim().length > 0) {
          currentChunk = sentenceChunk;
        }
      }
    }
    
    // Add final chunk if there's remaining content
    if (currentChunk.trim().length > 0) {
      // Build final contextual content
      const finalContext = content.substring(Math.max(0, content.length - contextChunkSize));
      
      chunks.push(this.createEnhancedChunk(
        currentChunk.trim(),
        finalContext,
        url,
        title,
        chunkIndex,
        { isFinalChunk: true }
      ));
    }
    
    // Filter out chunks that don't meet minimum quality threshold
    return chunks.filter(chunk => this.isValidChunk(chunk));
  }

  /**
   * Create an enhanced chunk object optimized for semantic search
   * @param {string} primaryContent - Main chunk content
   * @param {string} contextualContent - Additional contextual content
   * @param {string} url - Source URL
   * @param {string} title - Page title
   * @param {number} index - Chunk index
   * @param {Object} chunkMetadata - Additional chunk characteristics
   * @returns {Object} - Enhanced chunk object
   */
  createEnhancedChunk(primaryContent, contextualContent, url, title, index, chunkMetadata = {}) {
    const chunkId = generateChunkId(url, index);
    
    // Combine primary and contextual content with clear separation
    const fullContent = `PRIMARY CONTENT:\n${primaryContent}\n\nCONTEXTUAL INFORMATION:\n${contextualContent}`;
    
    // Ensure optimal chunk size for embedding and retrieval performance
    const maxContentSize = 12000; // Optimal size for most embedding models
    const finalContent = fullContent.length > maxContentSize ? 
      fullContent.substring(0, maxContentSize) + '...[TRUNCATED]' : 
      fullContent;
    
    return {
      id: chunkId,
      content: finalContent,
      metadata: {
        url,
        title,
        chunkIndex: index,
        primaryContentLength: primaryContent.length,
        contextualContentLength: contextualContent.length,
        totalContentLength: finalContent.length,
        source: 'external-scraper',
        createdAt: new Date().toISOString(),
        chunkType: 'enhanced-dense',
        contentDensity: Math.round((finalContent.length / maxContentSize) * 100), // Content utilization percentage
        ...chunkMetadata
      }
    };
  }

  /**
   * Check if a paragraph is likely a heading/section marker
   * @param {string} paragraph - Paragraph text
   * @returns {boolean} - Whether it's likely a heading
   */
  isLikelyHeading(paragraph) {
    if (!paragraph || paragraph.length === 0) return false;
    
    // Heuristics for heading detection
    const isShort = paragraph.length < 100;
    const hasCapitalization = /^[A-Z]/.test(paragraph);
    const endsWithoutPeriod = !paragraph.trim().endsWith('.');
    const hasHeadingWords = /^(chapter|section|part|step|\d+\.|\d+\))/i.test(paragraph);
    const isAllCaps = paragraph === paragraph.toUpperCase() && paragraph.length > 5;
    
    return (isShort && hasCapitalization && endsWithoutPeriod) || hasHeadingWords || isAllCaps;
  }

  /**
   * Split text into sentences more intelligently
   * @param {string} text - Text to split
   * @returns {Array} - Array of sentences
   */
  splitIntoSentences(text) {
    // Enhanced sentence splitting that handles abbreviations and edge cases
    const sentences = text
      .split(/(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|Inc|Ltd|Co|vs|etc|i\.e|e\.g)\.)(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 10);
    
    return sentences.map(s => s.trim());
  }

  /**
   * Build contextual information around a sentence
   * @param {string} sentence - Target sentence
   * @param {string} fullContent - Full document content
   * @param {number} maxContextSize - Maximum context size
   * @returns {string} - Contextual content
   */
  buildSentenceContext(sentence, fullContent, maxContextSize) {
    const sentenceIndex = fullContent.indexOf(sentence);
    if (sentenceIndex === -1) return sentence;
    
    // Get context before and after the sentence
    const contextBefore = fullContent.substring(
      Math.max(0, sentenceIndex - Math.floor(maxContextSize / 2)), 
      sentenceIndex
    );
    const contextAfter = fullContent.substring(
      sentenceIndex + sentence.length,
      Math.min(fullContent.length, sentenceIndex + sentence.length + Math.floor(maxContextSize / 2))
    );
    
    return (contextBefore + sentence + contextAfter).substring(0, maxContextSize);
  }

  /**
   * Validate if a chunk meets quality standards
   * @param {Object} chunk - Chunk object to validate
   * @returns {boolean} - Whether chunk is valid
   */
  isValidChunk(chunk) {
    if (!chunk || !chunk.content) return false;
    
    const content = chunk.content;
    const metadata = chunk.metadata || {};
    
    // Relaxed quality checks to match BedrockKnowledgeBaseService standards
    const hasMinimumContent = content.length >= 50; // Further reduced to match new chunking logic
    const hasReasonableWordsRatio = (content.match(/[a-zA-Z]{3,}/g) || []).length / content.length > 0.02; // More relaxed ratio
    const hasBasicMetadata = metadata.url || metadata.title; // Either URL or title is sufficient
    
    // For very short content (like contact pages), be more lenient
    if (content.length < 200) {
      return hasMinimumContent && hasReasonableWordsRatio && hasBasicMetadata;
    }
    
    // For longer content, maintain quality standards
    const hasGoodDensity = !metadata.contentDensity || metadata.contentDensity > 5; // More lenient density check
    return hasMinimumContent && hasReasonableWordsRatio && hasBasicMetadata && hasGoodDensity;
  }

  /**
   * Sanitize metadata value for S3 headers
   * @param {string} value - The metadata value to sanitize
   * @param {number} maxLength - Maximum length (default 1000)
   * @returns {string} - Sanitized value safe for S3 metadata
   */
  sanitizeMetadataValue(value, maxLength = 1000) {
    if (!value) return 'Untitled';
    
    // Convert to string and remove invalid characters for S3 metadata
    return String(value)
      // Remove non-ASCII characters
      .replace(/[^\x20-\x7E]/g, '')
      // Remove control characters and problematic chars
      .replace(/[\r\n\t\f\v]/g, ' ')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim()
      // Limit length
      .substring(0, maxLength) || 'Untitled';
  }

  /**
   * Store processed data using Bedrock Knowledge Base compliant structure
   * Creates both document and required .metadata.json sidecar files
   * @param {Object} processedData - Processed scraping data
   */
  async storeInS3(processedData) {
    try {
      // Use the new Bedrock compliant storage that creates proper datasource folders
      // and sidecar metadata files following exact Bedrock KB requirements
      const document = {
        content: processedData.content,
        title: processedData.title,
        url: processedData.url,
        metadata: {
          ...processedData.metadata,
          source: 'external-scraper'
        }
      };
      
      const result = await bedrockCompliantStorage.storeDocument(document);
      
      logger.info(`Stored scraped content with Bedrock compliant structure:`);
      logger.info(`  Document: ${result.documentPath}`);
      logger.info(`  Metadata: ${result.metadataPath}`);
      logger.info(`  Datasource: ${result.datasource}`);
      
      return {
        success: result.success,
        documentPath: result.documentPath,
        metadataPath: result.metadataPath,
        datasource: result.datasource,
        type: result.type,
        metadata: result.metadata,
        contentLength: result.contentLength,
        verification: result.verification,
        bedrockCompliant: true
      };
      
    } catch (error) {
      logger.error('Error storing data with Bedrock compliant structure:', error);
      throw new Error(`Failed to store data with Bedrock compliant structure: ${error.message}`);
    }
  }

  /**
   * Generate comprehensive crawl summary
   */
  generateCrawlSummary(domain, discovery, results, errors, options) {
    const totalScraped = results.length;
    const totalFiles = results.reduce((sum, result) => sum + (result.content?.files?.length || 0), 0);
    const successRate = `${((totalScraped / discovery.discoveredUrls.length) * 100).toFixed(1)}%`;
    
    return {
      domain,
      timestamp: new Date().toISOString(),
      discoveryStats: {
        totalPagesDiscovered: discovery.totalPages,
        strategy: discovery.strategy,
        sitemap: discovery.sitemap,
        robots: discovery.robots,
        unlimited: discovery.unlimited
      },
      crawlingStats: {
        totalPagesDiscovered: discovery.totalPages,
        totalPagesScraped: totalScraped,
        successRate,
        errors: errors.length
      },
      contentStats: {
        totalFiles,
        averageFilesPerPage: totalScraped > 0 ? Math.round(totalFiles / totalScraped) : 0,
        storageLocation: `datasources/${domain.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-')}/`,
        fileFormat: 'JSON files with chunked content in webpages/ and documents/ subfolders'
      },
      scrapedPages: results,
      errors,
      options,
      summary: {
        pagesDiscovered: discovery.totalPages,
        pagesScraped: totalScraped,
        limitApplied: options.maxPages && discovery.totalPages > options.maxPages,
        efficiency: successRate
      }
    };
  }

  /**
   * Store crawl metadata in metadata/{domain}/ folder
   */
  async storeCrawlMetadata(summary) {
    try {
      const metadataKey = `metadata/${summary.domain}/${summary.timestamp.split('T')[0]}/crawl-summary.json`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: metadataKey,
        Body: JSON.stringify(summary, null, 2),
        ContentType: 'application/json',
        Metadata: {
          "source-type": 'crawl-metadata',
          "domain": summary.domain,
          "datasource": summary.domain,
          "type": 'metadata',
          "category": 'crawl-summary',
          "total-pages-scraped": String(summary.crawlingStats?.totalPagesScraped || 0),
          "success-rate": summary.crawlingStats?.successRate || 'unknown',
          "crawled-at": summary.timestamp
        }
      }));
      
      logger.info(`Stored crawl metadata: ${metadataKey}`);
    } catch (error) {
      logger.error('Error storing crawl metadata:', error);
      throw error;
    }
  }

  /**
   * Trigger knowledge base synchronization
   * @param {string} domain - Domain that was scraped
   * @param {boolean} waitForAvailability - Whether to wait for KB availability first
   */
  async triggerKnowledgeBaseSync(domain, waitForAvailability = false) {
    try {
      const syncResult = await knowledgeBaseSync.fullSync(domain, false, waitForAvailability);
      logger.info(`Knowledge base sync initiated for ${domain}: ${syncResult.jobId}`);
      return syncResult;
    } catch (error) {
      logger.error('Error triggering knowledge base sync:', error);
      // Don't throw - this shouldn't fail the scraping operation
      return null;
    }
  }

  /**
   * Get external scraping service health
   */
  async getExternalServiceHealth() {
    try {
      const response = await this.api.get('/health');
      return response.data;
    } catch (error) {
      logger.error('Error checking external service health:', error);
      return { status: 'unhealthy', error: error.message };
    }
  }

  /**
   * Get external service presets/configuration
   */
  async getExternalServicePresets() {
    try {
      const response = await this.api.get('/presets');
      return response.data;
    } catch (error) {
      logger.error('Error getting external service presets:', error);
      return null;
    }
  }

  /**
   * Sanitize URL
   */
  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }
    
    let cleanUrl = url.trim().replace(/^[@#]+/, '');
    
    if (!cleanUrl.match(/^https?:\/\//)) {
      cleanUrl = 'https://' + cleanUrl;
    }
    
    // Validate URL
    try {
      new URL(cleanUrl);
      return cleanUrl;
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Get scraping history for a domain (placeholder for future implementation)
   */
  async getScrapingHistory(domain) {
    // This would query S3 metadata to get scraping history
    // For now, return a placeholder
    return {
      domain,
      lastScraped: null,
      totalScrapes: 0,
      message: 'History tracking not yet implemented'
    };
  }
}

module.exports = new ExternalScrapingService();
