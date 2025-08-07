/**
 * 🥷 STEALTH SCRAPING SERVICE
 * 
 * Advanced anti-detection scraping service designed to bypass:
 * - Bot detection systems
 * - Rate limiting
 * - CAPTCHA challenges
 * - IP blocking
 * - User agent detection
 * 
 * Implements multiple evasion techniques for successful scraping
 */

const puppeteer = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { generateHash, generateChunkId } = require('../utils/hash');
const logger = require('../utils/logger');

// Use stealth plugin
puppeteerExtra.use(StealthPlugin());

class StealthScrapingService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    
    this.bucket = process.env.BEDROCK_S3_BUCKET;
    this.browser = null;
    this.requestCount = 0;
    this.sessionStartTime = Date.now();
    
    // Realistic user agents pool
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    ];
    
    // Realistic screen resolutions
    this.viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 1600, height: 900 }
    ];
  }

  /**
   * Initialize stealth browser with anti-detection features
   */
  async initializeStealthBrowser() {
    if (!this.browser) {
      logger.info('🥷 Initializing stealth browser with anti-detection...');
      
      this.browser = await puppeteerExtra.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--disable-ipc-flooding-protection',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--enable-features=NetworkService,NetworkServiceLogging',
          '--force-color-profile=srgb',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-field-trial-config'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        ignoreHTTPSErrors: true
      });
      
      // Anti-detection: Remove webdriver property
      const pages = await this.browser.pages();
      for (const page of pages) {
        await this.setupStealthPage(page);
      }
    }
    return this.browser;
  }

  /**
   * Setup stealth configuration for a page
   */
  async setupStealthPage(page) {
    // Remove webdriver traces
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      return window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Cypress.env('NOTIFICATION_PERMISSION_STATE') || 'granted' }) :
          originalQuery(parameters)
      );
    });

    // Set random but realistic user agent
    const userAgent = this.getRandomUserAgent();
    await page.setUserAgent(userAgent);
    
    // Set random viewport
    const viewport = this.getRandomViewport();
    await page.setViewport(viewport);
    
    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    });
  }

  /**
   * Get random user agent
   */
  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Get random viewport
   */
  getRandomViewport() {
    return this.viewports[Math.floor(Math.random() * this.viewports.length)];
  }

  /**
   * Smart delay with human-like patterns
   */
  async smartDelay() {
    // Base delay: 2-8 seconds
    const baseDelay = 2000 + Math.random() * 6000;
    
    // Add extra delay based on request count (slow down if many requests)
    const rateDelay = Math.min(this.requestCount * 100, 5000);
    
    // Add session-based delay (slow down over time)
    const sessionDuration = Date.now() - this.sessionStartTime;
    const sessionDelay = Math.min(sessionDuration / 1000 / 60 * 100, 3000); // Add 100ms per minute
    
    const totalDelay = baseDelay + rateDelay + sessionDelay;
    
    logger.info(`🕒 Smart delay: ${Math.round(totalDelay)}ms (requests: ${this.requestCount})`);
    await new Promise(resolve => setTimeout(resolve, totalDelay));
    
    this.requestCount++;
  }

  /**
   * Human-like mouse movements and scrolling
   */
  async simulateHumanBehavior(page) {
    try {
      // Random mouse movements
      await page.mouse.move(
        Math.random() * 100 + 100,
        Math.random() * 100 + 100,
        { steps: 5 }
      );
      
      // Random scroll with pauses
      const scrollSteps = 3 + Math.floor(Math.random() * 5);
      for (let i = 0; i < scrollSteps; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, Math.random() * 500 + 200);
        });
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      }
      
      // Random click on a safe element (if exists)
      const safeElements = await page.$$('body, div, span');
      if (safeElements.length > 0) {
        const randomElement = safeElements[Math.floor(Math.random() * Math.min(safeElements.length, 3))];
        try {
          await randomElement.click();
          await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
        } catch (error) {
          // Ignore click errors
        }
      }
      
    } catch (error) {
      // Ignore simulation errors
      logger.warn('Human behavior simulation error:', error.message);
    }
  }

  /**
   * Handle common anti-bot measures
   */
  async handleAntiBot(page) {
    try {
      // Wait for potential loading/verification screens
      await page.waitForTimeout(2000);
      
      // Check for common blocking messages
      const content = await page.content();
      const blockingPhrases = [
        'request not permitted',
        'access denied',
        'blocked',
        'captcha',
        'robot',
        'bot detected',
        'verification required'
      ];
      
      const isBlocked = blockingPhrases.some(phrase => 
        content.toLowerCase().includes(phrase)
      );
      
      if (isBlocked) {
        logger.warn('🚫 Blocking detected on page');
        
        // Try refresh
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000));
        await page.reload({ waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return { blocked: true, retried: true };
      }
      
      // Handle cookie consent
      await this.handleCookieConsent(page);
      
      // Handle popups
      await this.handlePopups(page);
      
      return { blocked: false };
      
    } catch (error) {
      logger.warn('Anti-bot handling error:', error.message);
      return { blocked: false, error: error.message };
    }
  }

  /**
   * Handle cookie consent banners
   */
  async handleCookieConsent(page) {
    const cookieSelectors = [
      '[id*="cookie"] button',
      '[class*="cookie"] button',
      '[id*="consent"] button',
      '[class*="consent"] button',
      'button[aria-label*="Accept"]',
      'button[aria-label*="Agree"]',
      'button:contains("Accept")',
      'button:contains("Agree")',
      'button:contains("OK")',
      '.cookie-accept',
      '.consent-accept',
      '#accept-cookies',
      '#cookie-accept'
    ];
    
    for (const selector of cookieSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
          logger.info('🍪 Accepted cookie consent');
          break;
        }
      } catch (error) {
        // Continue to next selector
      }
    }
  }

  /**
   * Handle popups and overlays
   */
  async handlePopups(page) {
    const popupSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '.close',
      '.modal-close',
      '.popup-close',
      '[class*="close"]',
      '[id*="close"]',
      'button[title="Close"]',
      'button[aria-label*="close" i]'
    ];
    
    for (const selector of popupSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await new Promise(resolve => setTimeout(resolve, 500));
            logger.info('❌ Closed popup/overlay');
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }
  }

  /**
   * Enhanced page scraping with anti-detection
   */
  async scrapePage(url, options = {}) {
    let page = null;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        const cleanUrl = this.sanitizeUrl(url);
        logger.info(`🥷 Stealth scraping: ${cleanUrl} (attempt ${retryCount + 1})`);

        const browser = await this.initializeStealthBrowser();
        page = await browser.newPage();
        await this.setupStealthPage(page);
        
        // Smart delay before request
        await this.smartDelay();
        
        // Navigate with realistic options
        await page.goto(cleanUrl, { 
          waitUntil: ['domcontentloaded', 'networkidle0'], 
          timeout: 90000 
        });
        
        // Handle anti-bot measures
        const antiBot = await this.handleAntiBot(page);
        if (antiBot.blocked && !antiBot.retried) {
          logger.warn(`🚫 Page blocked, retrying... (${retryCount + 1}/${maxRetries})`);
          await page.close();
          retryCount++;
          
          // Longer delay before retry
          await new Promise(resolve => setTimeout(resolve, 10000 + Math.random() * 10000));
          continue;
        }
        
        // Simulate human behavior
        await this.simulateHumanBehavior(page);
        
        // Wait for dynamic content
        await page.waitForTimeout(3000 + Math.random() * 2000);
        
        // Extract content
        const html = await page.content();
        const title = await page.title();
        
        // Check if we got meaningful content
        if (html.length < 1000 || this.isBlockedContent(html)) {
          throw new Error('Received blocked or minimal content');
        }
        
        await page.close();
        
        // Process content
        const processedContent = this.extractContent(html, cleanUrl);
        
        const result = {
          url: cleanUrl,
          title,
          timestamp: new Date().toISOString(),
          content: processedContent,
          metadata: {
            scrapedAt: new Date().toISOString(),
            totalChunks: processedContent.chunks.length,
            contentHash: generateHash(processedContent.fullText),
            wordCount: processedContent.wordCount,
            userAgent: this.getRandomUserAgent(),
            retryCount
          }
        };

        // Store in S3
        await this.storePageContent(result);
        
        logger.info(`✅ Successfully scraped: ${cleanUrl} (${processedContent.chunks.length} chunks)`);
        return result;

      } catch (error) {
        logger.error(`❌ Error scraping page ${url} (attempt ${retryCount + 1}):`, error.message);
        
        if (page) {
          await page.close().catch(() => {});
        }
        
        retryCount++;
        
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to scrape ${url} after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Exponential backoff
        const delay = Math.min(30000, 5000 * Math.pow(2, retryCount)) + Math.random() * 5000;
        logger.info(`🔄 Retrying in ${Math.round(delay/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Check if content indicates blocking
   */
  isBlockedContent(html) {
    const blockingPhrases = [
      'request not permitted',
      'access denied',
      'blocked',
      'captcha required',
      'robot detected',
      'bot detected',
      'verification required',
      'cloudflare',
      'security check',
      'unusual traffic'
    ];
    
    const lowerHtml = html.toLowerCase();
    return blockingPhrases.some(phrase => lowerHtml.includes(phrase));
  }

  /**
   * Sanitize URL
   */
  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('URL must be a valid string');
    }

    let cleanUrl = url.trim().replace(/^[@#]+/, '');
    
    if (!cleanUrl.match(/^https?:\/\//)) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      new URL(cleanUrl);
      return cleanUrl;
    } catch (error) {
      throw new Error(`Invalid URL format: ${cleanUrl}`);
    }
  }

  /**
   * Extract and process content from HTML
   */
  extractContent(html, url) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .sidebar, .menu, .navigation').remove();
    $('[class*="ad"], [id*="ad"], [class*="banner"], [id*="banner"]').remove();
    $('[class*="popup"], [id*="popup"], [class*="modal"], [id*="modal"]').remove();
    
    // Extract main content
    let content = '';
    const contentSelectors = [
      'main',
      '[role="main"]',
      '.main-content',
      '.content',
      '.post-content',
      '.article-content',
      '.page-content',
      'article',
      '.entry-content',
      'body'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim().length > content.length) {
        content = element.text().trim();
      }
    }
    
    // Fallback to body text
    if (!content || content.length < 200) {
      content = $('body').text().trim();
    }
    
    // Clean up content
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    // Create chunks
    const chunks = this.createChunks(content, url);
    
    return {
      fullText: content,
      chunks: chunks,
      wordCount: content.split(/\s+/).length,
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Create content chunks
   */
  createChunks(content, url) {
    const chunks = [];
    const chunkSize = 2000;
    const overlap = 200;
    
    for (let i = 0; i < content.length; i += chunkSize - overlap) {
      const chunk = content.substring(i, i + chunkSize);
      if (chunk.trim().length > 100) {
        chunks.push({
          id: generateChunkId(url, i),
          content: chunk.trim(),
          position: i,
          wordCount: chunk.split(/\s+/).length
        });
      }
    }
    
    return chunks;
  }

  /**
   * Store content in S3
   */
  async storePageContent(result) {
    if (!this.bucket) {
      logger.warn('No S3 bucket configured, skipping storage');
      return;
    }

    try {
      const key = `scraped-content/${encodeURIComponent(result.url)}.json`;
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(result, null, 2),
        ContentType: 'application/json'
      });

      await this.s3Client.send(command);
      logger.info(`📦 Stored content in S3: ${key}`);
    } catch (error) {
      logger.error('Error storing content in S3:', error);
      throw error;
    }
  }

  /**
   * Cleanup browser
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('🧹 Stealth browser cleanup completed');
    }
  }

  /**
   * Get session stats
   */
  getSessionStats() {
    return {
      requestCount: this.requestCount,
      sessionDuration: Date.now() - this.sessionStartTime,
      averageDelay: this.requestCount > 0 ? (Date.now() - this.sessionStartTime) / this.requestCount : 0
    };
  }
}

module.exports = StealthScrapingService;