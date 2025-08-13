const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { generateHash, generateChunkId } = require('../utils/hash');
const logger = require('../utils/logger');
const knowledgeBaseSync = require('./knowledgeBaseSync');
const bedrockKnowledgeBaseService = require('./bedrockKnowledgeBaseService');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { convert } = require('html-to-text');

class ExternalScrapingService {
  constructor() {
    this.externalApiUrl = process.env.EXTERNAL_SCRAPER_URL || 'http://localhost:4000/api';
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
        // selectors: {
        //   title: options.titleSelector || 'title, h1',
        //   description: options.descriptionSelector || 'meta[name="description"], meta[property="og:description"]',
        //   content: options.contentSelector || 'main, article, .content, #content, body'
        // }
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
        contentPreview: typeof rawContent === 'string' ? rawContent.substring(0, 200) + '...' : 'N/A'
      });

      // Validate that we have content
      if (!rawContent || (typeof rawContent === 'string' && rawContent.trim().length === 0)) {
        throw new Error('No content could be extracted from this URL. The page might be empty, blocked, or require authentication.');
      }
      
      // Process and extract content using proper libraries
      const processedResult = await this.extractAndProcessContent(cleanUrl, rawContent);
      
      // Store in S3
      await this.storeInS3(processedResult);
      
      // Note: Knowledge base sync will be triggered manually or at the end of crawling process
      // to avoid concurrent ingestion job conflicts

      logger.info(`Successfully scraped and processed: ${cleanUrl}`);
      
      return {
        url: cleanUrl,
        title: processedResult.title || 'Untitled',
        timestamp: new Date().toISOString(),
        metadata: {
          contentHash: processedResult.contentHash,
          domain: processedResult.domain,
          source: 'external-scraper'
        },
        content: {
          chunks: processedResult.chunks
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
          maxDepth: options.maxDepth || 1
        };

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
   * Process plain text content from external scraping service
   * @param {string} url - Source URL
   * @param {string} plainText - Plain text content
   * @returns {Promise<Object>} - Processed data
   */
  async processPlainTextContent(url, plainText) {
    const domain = new URL(url).hostname;
    const timestamp = new Date().toISOString();
    
    logger.debug('Processing plain text content from:', url);
    
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
          { selector: '.sr-only', format: 'skip' }
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
            { selector: 'style', format: 'skip' },
            { selector: 'form', format: 'skip' },
            { selector: 'input', format: 'skip' },
            { selector: 'button', format: 'skip' }
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
          { selector: 'style', format: 'skip' },
          { selector: 'nav', format: 'skip' },
          { selector: 'header', format: 'skip' },
          { selector: 'footer', format: 'skip' },
          { selector: 'form', format: 'skip' },
          { selector: 'input', format: 'skip' },
          { selector: 'button', format: 'skip' },
          { selector: '[class*="osano"]', format: 'skip' },
          { selector: '[class*="cookie"]', format: 'skip' }
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
    
    // Remove embedded script data sections completely - enhanced pattern
    cleaned = cleaned.replace(/---EMBEDDED SCRIPT DATA---[\s\S]*?(?=---[^-]|$)/gi, '');
    cleaned = cleaned.replace(/---[\s\S]*?---/gi, ''); // Remove any remaining --- sections
    
    // Remove script blocks and any remaining JavaScript code - more aggressive
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/\bvar\s+\w+[\s\S]*?;/gi, ''); // Remove var declarations
    cleaned = cleaned.replace(/\bfunction\s+\w+[\s\S]*?\}/gi, ''); // Remove function definitions
    cleaned = cleaned.replace(/\$\([^)]*\)[\s\S]*?;/gi, ''); // Remove jQuery calls
    cleaned = cleaned.replace(/document\.[^;]*;?/gi, ''); // Remove document calls
    cleaned = cleaned.replace(/window\.[^;]*;?/gi, ''); // Remove window calls
    
    // Remove JavaScript patterns more selectively
    cleaned = cleaned.replace(/\bvar\s+\w+\s*=\s*[^;]*;?/gi, ''); // Variable assignments starting with var
    cleaned = cleaned.replace(/for\s*\([^)]*\)[^}]*\}/gi, ''); // for loops
    cleaned = cleaned.replace(/if\s*\([^)]*\)[^}]*\}/gi, ''); // if statements
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
    
    // Remove email addresses and any remaining URLs
    cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');
    
    // Normalize whitespace and remove empty lines
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n/g, '\n');
    cleaned = cleaned.replace(/\s+\n/g, '\n');
    cleaned = cleaned.replace(/\n\s+/g, '\n');
    
    // Remove lines that are mostly punctuation or symbols
    cleaned = cleaned.split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (trimmed.length < 3) return false;
        const alphaChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
        return alphaChars / trimmed.length > 0.3; // At least 30% alphabetic characters
      })
      .join('\n');
    
    // Final cleanup
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }

  /**
   * Create intelligent content chunks for vector storage
   * Optimized for Pinecone's 40KB metadata limit to maximize content density
   * @param {string} content - Full content text
   * @param {string} url - Source URL
   * @param {string} title - Page title
   * @returns {Array} - Array of chunks
   */
  createContentChunks(content, url, title) {
    const chunks = [];
    
    // Enhanced chunking strategy for maximum Pinecone utilization
    // Pinecone metadata limit: 40KB per record
    // Strategy: Create larger, semantically rich chunks with hierarchical content
    const primaryChunkSize = 15000; // Primary content (15KB)
    const contextChunkSize = 20000; // Additional context (20KB) 
    const totalMaxSize = 35000; // Reserve 5KB for metadata overhead
    const overlapSize = 500; // Larger overlap for better context continuity
    
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
   * Create an enhanced chunk object with maximum content density for Pinecone
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
    
    // Ensure we don't exceed Pinecone's 40KB metadata limit
    const maxContentSize = 35000; // Reserve 5KB for metadata overhead
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
        contentDensity: Math.round((finalContent.length / 40000) * 100), // Percentage of Pinecone limit used
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
    
    // Quality checks
    const hasMinimumContent = content.length >= 200; // Increased minimum for dense chunks
    const hasReasonableWordsRatio = (content.match(/[a-zA-Z]{3,}/g) || []).length / content.length > 0.05;
    const hasMetadata = metadata.url && metadata.title;
    const hasGoodDensity = metadata.contentDensity && metadata.contentDensity > 0.5; // At least 0.5% of Pinecone limit
    
    return hasMinimumContent && hasReasonableWordsRatio && hasMetadata && hasGoodDensity;
  }

  /**
   * Store processed data using Bedrock Knowledge Base Service (optimized S3 format)
   * @param {Object} processedData - Processed scraping data
   */
  async storeInS3(processedData) {
    try {
      const domain = processedData.domain;
      const timestamp = processedData.timestamp;
      const urlHash = generateHash(processedData.url);
      
      // Store raw content backup for reference (follows correct S3 structure)
      const rawKey = `raw-content/web-scrapes/${domain}/${timestamp.split('T')[0]}/${urlHash}.json`;
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: rawKey,
        Body: JSON.stringify({
          content_id: urlHash,
          source_type: 'web_scrape',
          source_url: processedData.url,
          title: processedData.title,
          content: processedData.content,
          chunks: processedData.chunks.map((chunk, index) => ({
            chunk_id: `${urlHash}-${index + 1}`,
            content: chunk.content,
            chunk_index: index + 1,
            word_count: chunk.content.split(/\s+/).length,
            metadata: {
              section: `chunk-${index + 1}`,
              chunkId: chunk.chunkId
            }
          })),
          processed_timestamp: timestamp,
          content_hash: processedData.contentHash,
          file_type: 'html',
          language: 'en'
        }),
        ContentType: 'application/json',
        Metadata: {
          domain: domain,
          url: processedData.url,
          title: processedData.title || 'Untitled',
          contentHash: processedData.contentHash,
          chunkCount: String(processedData.chunks.length),
          scrapedAt: timestamp,
          source: 'external-scraper'
        }
      }));
      
      // Use the optimized Bedrock Knowledge Base Service for main storage
      const document = {
        content: processedData.content,
        title: processedData.title,
        url: processedData.url,
        metadata: {
          ...processedData.metadata,
          domain: domain,
          contentHash: processedData.contentHash,
          scrapedAt: timestamp,
          source: 'external-scraper',
          extractionMethod: 'web-scraping'
        }
      };
      
      const kbResult = await bedrockKnowledgeBaseService.storeDocument(document);
      
      logger.info(`Stored scraped content optimally: ${kbResult.s3Key} with ${kbResult.chunkCount} chunks`);
      
      return {
        ...kbResult,
        rawKey,
        domain,
        chunkCount: kbResult.chunkCount
      };
      
    } catch (error) {
      logger.error('Error storing data in S3:', error);
      throw new Error(`Failed to store data in S3: ${error.message}`);
    }
  }

  /**
   * Generate comprehensive crawl summary
   */
  generateCrawlSummary(domain, discovery, results, errors, options) {
    const totalScraped = results.length;
    const totalChunks = results.reduce((sum, result) => sum + (result.content?.chunks?.length || 0), 0);
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
        totalChunks,
        averageChunksPerPage: totalScraped > 0 ? Math.round(totalChunks / totalScraped) : 0
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
   * Store crawl metadata
   */
  async storeCrawlMetadata(summary) {
    try {
      const metadataKey = `metadata/${summary.domain}/${summary.timestamp.split('T')[0]}/crawl-summary.json`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: metadataKey,
        Body: JSON.stringify(summary),
        ContentType: 'application/json'
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
