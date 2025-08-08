const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { generateHash, generateChunkId } = require('../utils/hash');
const logger = require('../utils/logger');
const knowledgeBaseSync = require('./knowledgeBaseSync');

class ExternalScrapingService {
  constructor() {
    this.externalApiUrl = process.env.EXTERNAL_SCRAPER_URL || 'https://scrapper.apps.kaaylabs.com/api';
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
      timeout: 120000, // 2 minutes timeout for crawling operations
      headers: {
        'Content-Type': 'application/json',
      },
      // Add retry configuration
      retries: 3,
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
        
        // Check if error is retryable (503, 502, 504, network errors)
        const retryableErrors = [502, 503, 504, 'ECONNRESET', 'ENOTFOUND', 'ECONNABORTED'];
        const isRetryable = retryableErrors.includes(error.response?.status) || 
                           retryableErrors.includes(error.code) ||
                           error.message.includes('timeout');
        
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
        selectors: {
          title: options.titleSelector || 'title, h1',
          description: options.descriptionSelector || 'meta[name="description"], meta[property="og:description"]',
          content: options.contentSelector || 'main, article, .content, #content, body'
        }
      };

      // Call external scraping service
      const response = await this.api.post('/scrape', requestPayload);
      
      if (!response.data.success) {
        throw new Error('External scraping service returned unsuccessful response');
      }

      const scrapedData = response.data.data;
      
      // Process and structure the data for our system
      const processedResult = await this.processScrapedData(cleanUrl, scrapedData);
      
      // Store in S3
      await this.storeInS3(processedResult);
      
      // Note: Knowledge base sync will be triggered manually or at the end of crawling process
      // to avoid concurrent ingestion job conflicts

      logger.info(`Successfully scraped and processed: ${cleanUrl}`);
      
      return {
        url: cleanUrl,
        title: scrapedData.title || 'Untitled',
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

      // Use enhanced crawl for comprehensive discovery
      const requestPayload = {
        url: cleanUrl,
        maxDepth: options.maxDepth || 10
      };

      const response = await this.api.post('/crawl', requestPayload);
      
      if (!response.data.success) {
        throw new Error('External crawling service returned unsuccessful response');
      }

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
   * Crawl and scrape entire website using external service
   * @param {string} url - Base URL to crawl and scrape
   * @param {Object} options - Crawling and scraping options
   * @returns {Promise<Object>} - Complete crawling result
   */
  async crawlAndScrapeWebsite(url, options = {}) {
    try {
      const cleanUrl = this.sanitizeUrl(url);
      const domain = new URL(cleanUrl).hostname;
      
      logger.info(`Starting comprehensive crawl and scrape for: ${domain}`);

      // Step 1: Discover all URLs using enhanced crawl
      const discovery = await this.discoverWebsitePages(cleanUrl, options);
      
      let urlsToScrape = discovery.discoveredUrls;
      
      // Apply maxPages limit if specified
      if (options.maxPages && urlsToScrape.length > options.maxPages) {
        urlsToScrape = urlsToScrape.slice(0, options.maxPages);
        logger.info(`Limited scraping to ${options.maxPages} pages out of ${discovery.totalPages} discovered`);
      }

      logger.info(`Will scrape ${urlsToScrape.length} pages`);

      // Step 2: Scrape all discovered pages in batches
      const batchSize = options.batchSize || 3;
      const delay = options.delay || 2000;
      const results = [];
      const errors = [];

      for (let i = 0; i < urlsToScrape.length; i += batchSize) {
        const batch = urlsToScrape.slice(i, i + batchSize);
        logger.info(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urlsToScrape.length/batchSize)}`);

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

      // Step 3: Generate comprehensive summary
      const summary = this.generateCrawlSummary(domain, discovery, results, errors, options);
      
      // Step 4: Store crawl metadata
      await this.storeCrawlMetadata(summary);

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

      return summary;

    } catch (error) {
      logger.error('Error during comprehensive crawling via external service:', error);
      throw error;
    }
  }

  /**
   * Process scraped data into our system format
   * @param {string} url - Source URL
   * @param {Object} scrapedData - Raw scraped data from external service
   * @returns {Promise<Object>} - Processed data
   */
  async processScrapedData(url, scrapedData) {
    const domain = new URL(url).hostname;
    const timestamp = new Date().toISOString();
    
    // Extract and clean content
    const title = scrapedData.title || '';
    const description = scrapedData.description || '';
    const content = scrapedData.content || '';
    
    // Combine all content
    const fullContent = `${title}\n\n${description}\n\n${content}`.trim();
    
    // Generate content hash
    const contentHash = generateHash(fullContent);
    
    // Create chunks (split content into manageable pieces)
    const chunks = this.createContentChunks(fullContent, url, title);
    
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
        chunkCount: chunks.length
      }
    };
  }

  /**
   * Create content chunks for vector storage
   * @param {string} content - Full content text
   * @param {string} url - Source URL
   * @param {string} title - Page title
   * @returns {Array} - Array of chunks
   */
  createContentChunks(content, url, title) {
    const chunks = [];
    const chunkSize = 1000; // Characters per chunk
    const overlapSize = 100; // Overlap between chunks
    
    if (!content || content.length === 0) {
      return chunks;
    }

    // Split content into sentences for better chunking
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const sentence of sentences) {
      const sentenceWithPunctuation = sentence.trim() + '.';
      
      if (currentChunk.length + sentenceWithPunctuation.length > chunkSize && currentChunk.length > 0) {
        // Create chunk
        const chunkId = generateChunkId(url, chunkIndex);
        chunks.push({
          id: chunkId,
          content: currentChunk.trim(),
          metadata: {
            url,
            title,
            chunkIndex,
            contentLength: currentChunk.length,
            source: 'external-scraper'
          }
        });
        
        // Start new chunk with overlap
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(overlapSize / 5)); // Approximate word overlap
        currentChunk = overlapWords.join(' ') + ' ' + sentenceWithPunctuation;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentenceWithPunctuation;
      }
    }
    
    // Add final chunk if there's remaining content
    if (currentChunk.trim().length > 0) {
      const chunkId = generateChunkId(url, chunkIndex);
      chunks.push({
        id: chunkId,
        content: currentChunk.trim(),
        metadata: {
          url,
          title,
          chunkIndex,
          contentLength: currentChunk.length,
          source: 'external-scraper'
        }
      });
    }
    
    return chunks;
  }

  /**
   * Store processed data in S3
   * @param {Object} processedData - Processed scraping data
   */
  async storeInS3(processedData) {
    try {
      const domain = processedData.domain;
      const timestamp = processedData.timestamp;
      const urlHash = generateHash(processedData.url);
      
      // Store raw content
      const rawKey = `raw/${domain}/${timestamp.split('T')[0]}/${urlHash}.json`;
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: rawKey,
        Body: JSON.stringify({
          url: processedData.url,
          title: processedData.title,
          content: processedData.content,
          contentHash: processedData.contentHash,
          scrapedAt: timestamp,
          source: 'external-scraper'
        }),
        ContentType: 'application/json'
      }));
      
      // Store processed chunks
      const processedKey = `processed/${domain}/${timestamp.split('T')[0]}/${urlHash}.json`;
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: processedKey,
        Body: JSON.stringify({
          url: processedData.url,
          domain: processedData.domain,
          title: processedData.title,
          chunks: processedData.chunks,
          metadata: processedData.metadata,
          processedAt: timestamp
        }),
        ContentType: 'application/json'
      }));
      
      // Store Bedrock KB-friendly plain text files (per-chunk) under kb/ prefix
      // This enables the Bedrock Knowledge Base (with Pinecone) to ingest high-quality text directly
      const kbBasePrefix = `kb/${domain}/${timestamp.split('T')[0]}/${urlHash}`;
      // Full document file for context/debugging
      const fullDocKey = `${kbBasePrefix}/full.txt`;
      const fullDocBody = `Title: ${processedData.title || ''}\nURL: ${processedData.url}\n\n${processedData.content || ''}`;
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullDocKey,
        Body: fullDocBody,
        ContentType: 'text/plain',
        Metadata: {
          url: processedData.url,
          title: processedData.title || '',
          source: 'external-scraper'
        }
      }));

      // Write each chunk as a separate .txt object for optimal ingestion
      for (const chunk of processedData.chunks) {
        const idx = typeof chunk.metadata?.chunkIndex === 'number' ? chunk.metadata.chunkIndex : 0;
        const chunkKey = `${kbBasePrefix}/chunk-${String(idx).padStart(4, '0')}.txt`;
        await this.s3Client.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: chunkKey,
          Body: chunk.content || '',
          ContentType: 'text/plain',
          Metadata: {
            url: processedData.url,
            title: processedData.title || '',
            chunkindex: String(idx),
            source: 'external-scraper'
          }
        }));
      }

      logger.info(`Stored scraped data in S3: ${rawKey}, ${processedKey}`);
      logger.info(`Stored KB-ingestion assets in S3 under: ${kbBasePrefix}/`);
      
    } catch (error) {
      logger.error('Error storing data in S3:', error);
      throw error;
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