const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const xml2js = require('xml2js');
const { URL } = require('url');
const logger = require('../utils/logger');

class WebsiteCrawler {
  constructor(options = {}) {
    this.visited = new Set();
    this.toVisit = new Set();
    this.discovered = new Set();
    this.domain = null;
    this.baseUrl = null;
    this.maxPages = options.maxPages || null; // null means discover all pages first
    this.maxDepth = options.maxDepth || 3;
    this.delay = options.delay || 1000; // 1 second between requests
    this.respectRobots = options.respectRobots !== false;
    this.followExternalLinks = options.followExternalLinks || false;
    this.allowedExtensions = options.allowedExtensions || ['.html', '.htm', '.php', '.asp', '.aspx', '.jsp', ''];
    this.excludePatterns = options.excludePatterns || [
      /\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf|zip|exe|dmg)$/i,
      /\/(admin|login|wp-admin|dashboard)/i,
      /#/,
      /\?.*utm_/i // Exclude UTM tracking URLs
    ];
    this.discoveryOnly = options.discoveryOnly || false;
  }

  /**
   * Discover all available pages without scraping content
   * @param {string} startUrl - Starting URL
   * @returns {Promise<Object>} - Discovery results with all found URLs
   */
  async discoverAllPages(startUrl) {
    try {
      this.baseUrl = this.sanitizeUrl(startUrl);
      this.domain = new URL(this.baseUrl).hostname;
      
      logger.info(`Starting comprehensive page discovery for domain: ${this.domain}`);
      
      // Reset state
      this.visited.clear();
      this.toVisit.clear();
      this.discovered.clear();
      
      // Step 1: Try to find and parse sitemap
      const sitemapUrls = await this.discoverFromSitemap();
      logger.info(`Found ${sitemapUrls.length} URLs from sitemap`);
      
      // Step 2: Add starting URL and sitemap URLs to discovery set
      this.discovered.add(this.baseUrl);
      sitemapUrls.forEach(url => this.discovered.add(url));
      
      // Step 3: Crawl pages to discover more internal links (discovery mode)
      this.discoveryOnly = true;
      this.toVisit.add(this.baseUrl);
      sitemapUrls.forEach(url => this.toVisit.add(url));
      
      await this.crawlPages();
      
      // Combine all discovered URLs
      const allDiscoveredUrls = Array.from(this.discovered);
      
      logger.info(`Page discovery completed. Total pages found: ${allDiscoveredUrls.length}`);
      
      return {
        totalPages: allDiscoveredUrls.length,
        sitemapPages: sitemapUrls.length,
        crawledPages: this.visited.size,
        discoveredUrls: allDiscoveredUrls,
        domain: this.domain
      };
      
    } catch (error) {
      logger.error('Error during page discovery:', error);
      throw error;
    }
  }

  /**
   * Start crawling from a base URL
   * @param {string} startUrl - Starting URL
   * @param {boolean} useDiscoveredPages - Whether to use pre-discovered pages
   * @returns {Promise<Array>} - Array of discovered URLs
   */
  async crawlWebsite(startUrl, useDiscoveredPages = false) {
    try {
      this.baseUrl = this.sanitizeUrl(startUrl);
      this.domain = new URL(this.baseUrl).hostname;
      
      let discoveredUrls;
      
      if (useDiscoveredPages && this.discovered.size > 0) {
        // Use pre-discovered pages
        discoveredUrls = Array.from(this.discovered);
        logger.info(`Using pre-discovered pages. Total pages: ${discoveredUrls.length}`);
      } else {
        // Discover pages dynamically
        logger.info(`Starting website crawl for domain: ${this.domain}`);
        
        // Reset state
        this.visited.clear();
        this.toVisit.clear();
        this.discoveryOnly = false;
        
        // Step 1: Try to find and parse sitemap
        const sitemapUrls = await this.discoverFromSitemap();
        logger.info(`Found ${sitemapUrls.length} URLs from sitemap`);
        
        // Step 2: Add starting URL and sitemap URLs to visit queue
        this.toVisit.add(this.baseUrl);
        sitemapUrls.forEach(url => this.toVisit.add(url));
        
        // Step 3: Crawl pages to discover more internal links
        await this.crawlPages();
        
        discoveredUrls = Array.from(this.visited);
      }
      
      logger.info(`Crawling completed. Total pages discovered: ${discoveredUrls.length}`);
      return discoveredUrls;
      
    } catch (error) {
      logger.error('Error during website crawling:', error);
      throw error;
    }
  }

  /**
   * Discover URLs from sitemap.xml
   * @returns {Promise<Array>} - Array of URLs from sitemap
   */
  async discoverFromSitemap() {
    const sitemapUrls = [];
    const possibleSitemaps = [
      `${this.baseUrl}/sitemap.xml`,
      `${this.baseUrl}/sitemap_index.xml`,
      `${this.baseUrl}/sitemaps.xml`,
      `${this.baseUrl}/sitemap1.xml`
    ];

    for (const sitemapUrl of possibleSitemaps) {
      try {
        logger.info(`Checking sitemap: ${sitemapUrl}`);
        const response = await axios.get(sitemapUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WebCrawler/1.0)'
          }
        });

        if (response.status === 200 && response.data) {
          const urls = await this.parseSitemap(response.data);
          sitemapUrls.push(...urls);
          logger.info(`Found ${urls.length} URLs in ${sitemapUrl}`);
          break; // Stop after finding first valid sitemap
        }
      } catch (error) {
        logger.debug(`Sitemap not found or accessible: ${sitemapUrl}`);
      }
    }

    // Also check robots.txt for sitemap references
    try {
      const robotsUrl = `${this.baseUrl}/robots.txt`;
      const robotsResponse = await axios.get(robotsUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WebCrawler/1.0)'
        }
      });

      if (robotsResponse.status === 200) {
        const robotsContent = robotsResponse.data;
        const sitemapMatches = robotsContent.match(/Sitemap:\s*(https?:\/\/[^\s]+)/gi);
        
        if (sitemapMatches) {
          for (const match of sitemapMatches) {
            const sitemapUrl = match.replace(/Sitemap:\s*/i, '').trim();
            try {
              const response = await axios.get(sitemapUrl, { timeout: 10000 });
              if (response.status === 200) {
                const urls = await this.parseSitemap(response.data);
                sitemapUrls.push(...urls);
                logger.info(`Found ${urls.length} URLs from robots.txt sitemap: ${sitemapUrl}`);
              }
            } catch (error) {
              logger.debug(`Could not fetch sitemap from robots.txt: ${sitemapUrl}`);
            }
          }
        }
      }
    } catch (error) {
      logger.debug('Could not fetch robots.txt');
    }

    // Remove duplicates and filter valid URLs
    return [...new Set(sitemapUrls)].filter(url => this.isValidUrl(url));
  }

  /**
   * Parse sitemap XML and extract URLs
   * @param {string} xmlContent - Sitemap XML content
   * @returns {Promise<Array>} - Array of URLs
   */
  async parseSitemap(xmlContent) {
    try {
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlContent);
      const urls = [];

      // Handle sitemap index (contains references to other sitemaps)
      if (result.sitemapindex && result.sitemapindex.sitemap) {
        const sitemaps = Array.isArray(result.sitemapindex.sitemap) 
          ? result.sitemapindex.sitemap 
          : [result.sitemapindex.sitemap];
        
        for (const sitemap of sitemaps) {
          if (sitemap.loc && sitemap.loc[0]) {
            try {
              const response = await axios.get(sitemap.loc[0], { timeout: 10000 });
              if (response.status === 200) {
                const nestedUrls = await this.parseSitemap(response.data);
                urls.push(...nestedUrls);
              }
            } catch (error) {
              logger.debug(`Could not fetch nested sitemap: ${sitemap.loc[0]}`);
            }
          }
        }
      }

      // Handle regular sitemap (contains URLs)
      if (result.urlset && result.urlset.url) {
        const urlEntries = Array.isArray(result.urlset.url) 
          ? result.urlset.url 
          : [result.urlset.url];
        
        for (const urlEntry of urlEntries) {
          if (urlEntry.loc && urlEntry.loc[0]) {
            urls.push(urlEntry.loc[0]);
          }
        }
      }

      return urls;
    } catch (error) {
      logger.error('Error parsing sitemap:', error);
      return [];
    }
  }

  /**
   * Crawl pages to discover internal links
   */
  async crawlPages() {
    let browser;
    
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions']
      });

      // Remove discovery limit - allow comprehensive site discovery
      const crawlLimit = this.discoveryOnly ? (this.maxPages || 10000) : (this.maxPages || 1000);
      
      while (this.toVisit.size > 0 && this.visited.size < crawlLimit) {
        const currentUrl = this.toVisit.values().next().value;
        this.toVisit.delete(currentUrl);
        
        if (this.visited.has(currentUrl)) {
          continue;
        }

        try {
          const currentCount = this.visited.size + 1;
          const modeText = this.discoveryOnly ? 'Discovering' : 'Crawling';
          logger.info(`${modeText} page ${currentCount}: ${currentUrl}`);
          
          const links = await this.extractLinksFromPage(browser, currentUrl);
          this.visited.add(currentUrl);
          
          // Add to discovered set if in discovery mode
          if (this.discoveryOnly) {
            this.discovered.add(currentUrl);
          }
          
          // Add new links to appropriate sets
          for (const link of links) {
            if (this.isValidUrl(link)) {
              if (this.discoveryOnly) {
                // In discovery mode, add all valid links to discovered set
                this.discovered.add(link);
                
                // Only crawl further if we haven't visited this page yet
                if (!this.visited.has(link) && !this.toVisit.has(link)) {
                  this.toVisit.add(link);
                }
              } else {
                // In normal mode, add to visit queue
                if (!this.visited.has(link) && !this.toVisit.has(link)) {
                  this.toVisit.add(link);
                }
              }
            }
          }

          // Add delay between requests
          if (this.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.delay));
          }
          
        } catch (error) {
          logger.warn(`Error crawling page ${currentUrl}:`, error.message);
          this.visited.add(currentUrl); // Mark as visited to avoid retry
          
          if (this.discoveryOnly) {
            this.discovered.add(currentUrl); // Still add to discovered even if error
          }
        }
      }
      
      logger.info(`${this.discoveryOnly ? 'Discovery' : 'Crawling'} completed. Visited: ${this.visited.size}, Discovered: ${this.discovered.size}`);
      
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Extract links from a single page
   * @param {Object} browser - Puppeteer browser instance
   * @param {string} url - URL to extract links from
   * @returns {Promise<Array>} - Array of discovered links
   */
  async extractLinksFromPage(browser, url) {
    const page = await browser.newPage();
    const links = [];

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.setViewport({ width: 1280, height: 720 });
      
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Extract links from the page
      const pageLinks = await page.evaluate(() => {
        const links = [];
        const anchorElements = document.querySelectorAll('a[href]');
        
        anchorElements.forEach(anchor => {
          const href = anchor.getAttribute('href');
          if (href) {
            links.push(href);
          }
        });
        
        return links;
      });

      // Process and normalize links
      for (let link of pageLinks) {
        try {
          // Convert relative URLs to absolute
          const absoluteUrl = new URL(link, url).href;
          
          if (this.shouldIncludeUrl(absoluteUrl)) {
            links.push(absoluteUrl);
          }
        } catch (error) {
          // Skip invalid URLs
        }
      }

    } catch (error) {
      logger.warn(`Error extracting links from ${url}:`, error.message);
    } finally {
      await page.close();
    }

    return [...new Set(links)]; // Remove duplicates
  }

  /**
   * Check if URL should be included in crawling
   * @param {string} url - URL to check
   * @returns {boolean} - Whether to include the URL
   */
  shouldIncludeUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Check domain restrictions
      if (!this.followExternalLinks && urlObj.hostname !== this.domain) {
        return false;
      }

      // Check file extensions
      const pathname = urlObj.pathname.toLowerCase();
      const hasValidExtension = this.allowedExtensions.some(ext => 
        ext === '' ? !pathname.includes('.') || pathname.endsWith('/') : pathname.endsWith(ext)
      );
      
      if (!hasValidExtension) {
        return false;
      }

      // Check exclude patterns
      const fullUrl = url.toLowerCase();
      for (const pattern of this.excludePatterns) {
        if (pattern.test(fullUrl)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate URL format
   * @param {string} url - URL to validate
   * @returns {boolean} - Whether URL is valid
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sanitize and validate URL
   * @param {string} url - Raw URL input
   * @returns {string} - Clean, valid URL
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
   * Get crawling statistics
   * @returns {Object} - Crawling statistics
   */
  getStats() {
    return {
      visitedCount: this.visited.size,
      queueCount: this.toVisit.size,
      domain: this.domain,
      visitedUrls: Array.from(this.visited),
      queuedUrls: Array.from(this.toVisit)
    };
  }
}

module.exports = WebsiteCrawler;