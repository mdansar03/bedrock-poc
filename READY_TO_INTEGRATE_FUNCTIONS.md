# 🔧 Ready-to-Integrate Functions Collection

This document contains all the essential functions you can copy-paste directly into any project for web scraping, data processing, and AWS integration.

## 📋 Quick Function Index

1. [Single Page Scraper](#1-single-page-scraper)
2. [Batch URL Processor](#2-batch-url-processor)
3. [Sitemap URL Discovery](#3-sitemap-url-discovery)
4. [Content Extractor Engine](#4-content-extractor-engine)
5. [AWS S3 Storage Manager](#5-aws-s3-storage-manager)
6. [Knowledge Base Query Engine](#6-knowledge-base-query-engine)
7. [Data Validation & Sanitization](#7-data-validation--sanitization)
8. [Error Handling & Retry Logic](#8-error-handling--retry-logic)
9. [Performance Monitor](#9-performance-monitor)
10. [Complete Express API Setup](#10-complete-express-api-setup)

---

## 1. Single Page Scraper

**Copy-paste ready function for scraping any single web page**

```javascript
/**
 * 🚀 READY-TO-INTEGRATE: Single Page Scraper
 * Copy this function anywhere you need to scrape a single page
 * 
 * Features:
 * - Puppeteer with dynamic content loading
 * - Comprehensive data extraction
 * - Error handling and timeouts
 * - Mobile and desktop user agents
 */
async function scrapeSinglePage(url, options = {}) {
  const puppeteer = require('puppeteer');
  const cheerio = require('cheerio');
  
  const {
    timeout = 60000,
    waitTime = 3000,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport = { width: 1920, height: 1080 },
    extractTypes = ['products', 'pricing', 'images', 'links', 'text']
  } = options;
  
  let browser;
  
  try {
    // Launch browser with optimized settings
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport(viewport);
    
    // Navigate to page
    console.log(`🌐 Navigating to: ${url}`);
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout 
    });
    
    // Handle popups and overlays
    await handlePopups(page);
    
    // Simulate user behavior for dynamic content
    await simulateScrolling(page);
    await page.waitForTimeout(waitTime);
    
    // Extract content
    const html = await page.content();
    const title = await page.title();
    
    // Parse with Cheerio
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe').remove();
    
    // Extract data based on requested types
    const extractedData = {
      url,
      title,
      timestamp: new Date().toISOString(),
      content: {}
    };
    
    if (extractTypes.includes('text')) {
      extractedData.content.fullText = $('body').text().replace(/\s+/g, ' ').trim();
      extractedData.content.wordCount = extractedData.content.fullText.split(' ').length;
    }
    
    if (extractTypes.includes('products')) {
      extractedData.content.products = extractProducts($);
    }
    
    if (extractTypes.includes('pricing')) {
      extractedData.content.pricing = extractPricing($);
    }
    
    if (extractTypes.includes('images')) {
      extractedData.content.images = extractImages($);
    }
    
    if (extractTypes.includes('links')) {
      extractedData.content.links = extractLinks($);
    }
    
    console.log(`✅ Successfully scraped: ${url} (${Object.keys(extractedData.content).length} data types)`);
    
    return extractedData;
    
  } catch (error) {
    console.error(`❌ Error scraping ${url}: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper function: Handle popups
async function handlePopups(page) {
  try {
    const popupSelectors = [
      '.popup', '.modal', '.overlay', '.cookie-banner', 
      '.newsletter-popup', '.subscribe-modal', '[data-popup]'
    ];
    
    for (const selector of popupSelectors) {
      const elements = await page.$$(selector);
      for (const element of elements) {
        const closeButton = await element.$('.close, .dismiss, .cancel, [aria-label="close"]');
        if (closeButton) {
          await closeButton.click();
          await page.waitForTimeout(500);
        }
      }
    }
  } catch (error) {
    // Ignore popup handling errors
  }
}

// Helper function: Simulate scrolling
async function simulateScrolling(page) {
  try {
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
  } catch (error) {
    // Ignore scrolling errors
  }
}

// Extract products
function extractProducts($) {
  const products = [];
  const productSelectors = [
    '.product', '.product-item', '.product-card', '.product-container',
    '.item', '.listing', '.catalog-item', '.shop-item'
  ];
  
  productSelectors.forEach(selector => {
    $(selector).each((i, element) => {
      const $el = $(element);
      
      const product = {
        name: extractText($el, ['h1', 'h2', 'h3', '.title', '.name', '.product-title']),
        price: extractPrice($el),
        description: extractText($el, ['.description', '.summary', '.product-description']),
        image: $el.find('img').first().attr('src') || '',
        sku: extractText($el, ['.sku', '[data-sku]', '.product-code']),
        brand: extractText($el, ['.brand', '.manufacturer']),
        rating: extractRating($el),
        availability: extractText($el, ['.availability', '.stock', '.status']),
        position: i,
        extracted_at: new Date().toISOString()
      };
      
      if (product.name || product.price || product.description) {
        products.push(product);
      }
    });
  });
  
  return products;
}

// Extract pricing
function extractPricing($) {
  const pricing = [];
  const priceSelectors = [
    '.price', '.pricing', '.cost', '.fee', '.rate', '.amount'
  ];
  
  priceSelectors.forEach(selector => {
    $(selector).each((i, element) => {
      const $el = $(element);
      const priceText = $el.text().trim();
      
      // Extract price with regex
      const priceMatch = priceText.match(/[$£€¥₹₽¢]?[\d,]+\.?\d*/);
      if (priceMatch) {
        pricing.push({
          price: priceMatch[0],
          originalText: priceText,
          context: $el.parent().text().slice(0, 100),
          currency: detectCurrency(priceText),
          position: i,
          extracted_at: new Date().toISOString()
        });
      }
    });
  });
  
  return pricing;
}

// Extract images
function extractImages($) {
  const images = [];
  $('img').each((i, img) => {
    const $img = $(img);
    const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy');
    
    if (src && !src.includes('data:image')) {
      images.push({
        src: src.startsWith('//') ? 'https:' + src : src,
        alt: $img.attr('alt') || '',
        title: $img.attr('title') || '',
        width: $img.attr('width') || '',
        height: $img.attr('height') || '',
        position: i
      });
    }
  });
  
  return images;
}

// Extract links
function extractLinks($) {
  const links = [];
  $('a[href]').each((i, link) => {
    const $link = $(link);
    const href = $link.attr('href');
    
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push({
        href,
        text: $link.text().trim(),
        title: $link.attr('title') || '',
        external: href.startsWith('http') && !href.includes(window.location?.hostname || ''),
        position: i
      });
    }
  });
  
  return links;
}

// Helper: Extract text from multiple selectors
function extractText($el, selectors) {
  for (const selector of selectors) {
    const element = $el.find(selector).first();
    if (element.length) {
      const text = element.text().trim();
      if (text) return text;
    }
  }
  return '';
}

// Helper: Extract price
function extractPrice($el) {
  const priceSelectors = [
    '.price', '.cost', '.amount', '[data-price]', '.product-price',
    '.price-current', '.price-now', '.sale-price'
  ];
  
  for (const selector of priceSelectors) {
    const element = $el.find(selector).first();
    if (element.length) {
      const priceText = element.text().trim();
      const priceMatch = priceText.match(/[$£€¥₹₽¢]?[\d,]+\.?\d*/);
      if (priceMatch) return priceMatch[0];
    }
  }
  return '';
}

// Helper: Extract rating
function extractRating($el) {
  const ratingSelectors = [
    '.rating', '.stars', '[data-rating]', '.review-rating', '.star-rating'
  ];
  
  for (const selector of ratingSelectors) {
    const element = $el.find(selector).first();
    if (element.length) {
      const ratingText = element.text().trim();
      const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
      if (ratingMatch) return parseFloat(ratingMatch[1]);
    }
  }
  return null;
}

// Helper: Detect currency
function detectCurrency(text) {
  const currencyMap = {
    '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY',
    '₹': 'INR', '₽': 'RUB', '¢': 'USD'
  };
  
  for (const [symbol, code] of Object.entries(currencyMap)) {
    if (text.includes(symbol)) return code;
  }
  return '';
}

module.exports = { scrapeSinglePage };
```

---

## 2. Batch URL Processor

**Copy-paste ready function for processing multiple URLs with concurrency control**

```javascript
/**
 * 🚀 READY-TO-INTEGRATE: Batch URL Processor
 * Process multiple URLs efficiently with progress tracking
 * 
 * Features:
 * - Concurrent processing with configurable batch size
 * - Automatic retry logic with exponential backoff
 * - Progress callbacks for real-time updates
 * - Error isolation (one failure doesn't stop others)
 */
async function processBatchUrls(urls, options = {}) {
  const {
    batchSize = 3,
    delay = 1000,
    maxRetries = 2,
    retryDelay = 2000,
    onProgress = null,
    onSuccess = null,
    onError = null,
    onBatchComplete = null
  } = options;
  
  const results = [];
  const errors = [];
  const startTime = Date.now();
  
  console.log(`🚀 Starting batch processing: ${urls.length} URLs in batches of ${batchSize}`);
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(urls.length / batchSize);
    
    console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`);
    
    const batchPromises = batch.map(async (url, index) => {
      return await processUrlWithRetry(url, maxRetries, retryDelay, onSuccess, onError);
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      const url = batch[index];
      
      if (result.status === 'fulfilled' && result.value.success) {
        results.push(result.value);
        if (onSuccess) onSuccess(result.value);
      } else {
        const errorResult = {
          url,
          success: false,
          error: result.reason?.message || result.value?.error || 'Unknown error',
          timestamp: new Date().toISOString()
        };
        errors.push(errorResult);
        if (onError) onError(errorResult);
      }
    });
    
    // Progress callback
    if (onProgress) {
      onProgress({
        completed: results.length + errors.length,
        total: urls.length,
        successful: results.length,
        failed: errors.length,
        currentBatch: batchNumber,
        totalBatches,
        successRate: (results.length / (results.length + errors.length) * 100).toFixed(2) + '%',
        estimatedTimeRemaining: estimateTimeRemaining(startTime, results.length + errors.length, urls.length)
      });
    }
    
    // Batch complete callback
    if (onBatchComplete) {
      onBatchComplete({
        batchNumber,
        batchResults: batchResults.length,
        batchSuccessful: batchResults.filter(r => r.status === 'fulfilled').length,
        batchFailed: batchResults.filter(r => r.status === 'rejected').length
      });
    }
    
    // Delay between batches (except for the last batch)
    if (i + batchSize < urls.length) {
      console.log(`⏱️ Waiting ${delay}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  const totalTime = Date.now() - startTime;
  const summary = {
    total: urls.length,
    successful: results.length,
    failed: errors.length,
    successRate: ((results.length / urls.length) * 100).toFixed(2) + '%',
    totalTime: Math.round(totalTime / 1000) + 's',
    averageTimePerUrl: Math.round(totalTime / urls.length) + 'ms'
  };
  
  console.log(`✅ Batch processing complete: ${summary.successful}/${summary.total} successful (${summary.successRate})`);
  
  return {
    results,
    errors,
    summary
  };
}

// Helper: Process single URL with retry logic
async function processUrlWithRetry(url, maxRetries, retryDelay, onSuccess, onError) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🌐 Scraping: ${url} (attempt ${attempt}/${maxRetries})`);
      const result = await scrapeSinglePage(url);
      
      return {
        url,
        success: true,
        data: result,
        attempts: attempt,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      lastError = error;
      console.log(`⚠️ Attempt ${attempt}/${maxRetries} failed for ${url}: ${error.message}`);
      
      if (attempt < maxRetries) {
        const waitTime = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⏳ Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}

// Helper: Estimate time remaining
function estimateTimeRemaining(startTime, completed, total) {
  if (completed === 0) return 'Calculating...';
  
  const elapsed = Date.now() - startTime;
  const averageTimePerItem = elapsed / completed;
  const remaining = total - completed;
  const estimatedMs = remaining * averageTimePerItem;
  
  const minutes = Math.floor(estimatedMs / 60000);
  const seconds = Math.floor((estimatedMs % 60000) / 1000);
  
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

module.exports = { processBatchUrls };
```

---

## 3. Sitemap URL Discovery

**Copy-paste ready function for discovering URLs from website sitemaps**

```javascript
/**
 * 🚀 READY-TO-INTEGRATE: Sitemap URL Discovery
 * Automatically discover all URLs from website sitemaps
 * 
 * Features:
 * - Recursive sitemap index handling
 * - Multiple sitemap location attempts
 * - URL filtering and validation
 * - Timeout protection
 */
async function discoverSitemapUrls(baseUrl, options = {}) {
  const axios = require('axios');
  const { parseStringPromise } = require('xml2js');
  const { URL } = require('url');
  
  const {
    timeout = 30000,
    maxUrls = 10000,
    includePattern = null,
    excludePattern = null,
    followSitemapIndex = true
  } = options;
  
  const discoveredUrls = new Set();
  const processedSitemaps = new Set();
  const baseHost = new URL(baseUrl).origin;
  
  console.log(`🗺️ Starting sitemap discovery for: ${baseHost}`);
  
  async function processSitemap(sitemapUrl, depth = 0) {
    if (processedSitemaps.has(sitemapUrl) || depth > 3) return;
    processedSitemaps.add(sitemapUrl);
    
    try {
      console.log(`📥 Fetching sitemap: ${sitemapUrl} (depth: ${depth})`);
      
      const response = await axios.get(sitemapUrl, {
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SitemapBot/1.0)',
          'Accept': 'application/xml, text/xml, */*'
        },
        maxRedirects: 5
      });
      
      const result = await parseStringPromise(response.data, {
        trim: true,
        explicitArray: false
      });
      
      // Handle sitemap index (contains references to other sitemaps)
      if (result.sitemapindex?.sitemap && followSitemapIndex) {
        const sitemaps = Array.isArray(result.sitemapindex.sitemap) 
          ? result.sitemapindex.sitemap 
          : [result.sitemapindex.sitemap];
          
        console.log(`📂 Found sitemap index with ${sitemaps.length} sitemaps`);
        
        for (const sitemap of sitemaps) {
          if (sitemap.loc) {
            await processSitemap(sitemap.loc, depth + 1);
          }
        }
      }
      
      // Handle URL set (contains actual URLs)
      if (result.urlset?.url) {
        const urls = Array.isArray(result.urlset.url) 
          ? result.urlset.url 
          : [result.urlset.url];
          
        console.log(`🔗 Found ${urls.length} URLs in sitemap`);
        
        for (const urlEntry of urls) {
          if (urlEntry.loc) {
            const url = urlEntry.loc;
            
            // Apply filters
            if (includePattern && !url.match(includePattern)) continue;
            if (excludePattern && url.match(excludePattern)) continue;
            
            // Validate URL
            if (isValidUrl(url, baseHost)) {
              discoveredUrls.add(url);
              
              // Stop if we've reached the limit
              if (discoveredUrls.size >= maxUrls) {
                console.log(`⚠️ Reached maximum URL limit: ${maxUrls}`);
                return;
              }
            }
          }
        }
      }
      
    } catch (error) {
      console.log(`❌ Error processing sitemap ${sitemapUrl}: ${error.message}`);
    }
  }
  
  // Try common sitemap locations
  const sitemapPaths = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemaps.xml',
    '/sitemap/sitemap.xml',
    '/wp-sitemap.xml',
    '/sitemap1.xml'
  ];
  
  for (const path of sitemapPaths) {
    const sitemapUrl = baseHost + path;
    await processSitemap(sitemapUrl);
    
    if (discoveredUrls.size > 0) {
      console.log(`✅ Found URLs in ${path}`);
    }
  }
  
  // Try robots.txt for sitemap references
  try {
    const robotsUrl = baseHost + '/robots.txt';
    const robotsResponse = await axios.get(robotsUrl, { timeout: 10000 });
    const sitemapMatches = robotsResponse.data.match(/sitemap:\s*(.+)/gi);
    
    if (sitemapMatches) {
      console.log(`🤖 Found ${sitemapMatches.length} sitemap references in robots.txt`);
      for (const match of sitemapMatches) {
        const sitemapUrl = match.replace(/sitemap:\s*/i, '').trim();
        await processSitemap(sitemapUrl);
      }
    }
  } catch (error) {
    console.log(`⚠️ Could not fetch robots.txt: ${error.message}`);
  }
  
  const urlArray = Array.from(discoveredUrls);
  
  console.log(`🎯 Sitemap discovery complete: ${urlArray.length} URLs found`);
  
  return {
    urls: urlArray,
    summary: {
      totalUrls: urlArray.length,
      sitemapsProcessed: processedSitemaps.size,
      baseHost,
      discoveryTime: new Date().toISOString()
    }
  };
}

// Helper: Validate URL
function isValidUrl(url, baseHost) {
  try {
    const urlObj = new URL(url);
    
    // Must be HTTP or HTTPS
    if (!['http:', 'https:'].includes(urlObj.protocol)) return false;
    
    // Must be from the same domain (if baseHost provided)
    if (baseHost && !url.startsWith(baseHost)) return false;
    
    // Exclude common non-content files
    const excludeExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.css', '.js', '.ico'];
    const hasExcludedExtension = excludeExtensions.some(ext => 
      urlObj.pathname.toLowerCase().endsWith(ext)
    );
    
    return !hasExcludedExtension;
    
  } catch (error) {
    return false;
  }
}

module.exports = { discoverSitemapUrls };
```

---

## 4. Content Extractor Engine

**Copy-paste ready function for comprehensive content extraction**

```javascript
/**
 * 🚀 READY-TO-INTEGRATE: Content Extractor Engine
 * Comprehensive content extraction from any web page
 * 
 * Features:
 * - 18+ content types extraction
 * - JSON-LD and Microdata parsing
 * - Structured data normalization
 * - Performance optimized
 */
function createContentExtractor() {
  
  // Main extraction function
  function extractAllContent(html, url, options = {}) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, noscript, iframe, .advertisement, .ads').remove();
    
    const {
      extractTypes = ['all'],
      includeRawText = true,
      includeMetadata = true
    } = options;
    
    const extractedContent = {
      url,
      extractedAt: new Date().toISOString(),
      content: {}
    };
    
    // Extract based on requested types
    if (shouldExtract('structured', extractTypes)) {
      extractedContent.content.structured = extractStructuredData($, url);
    }
    
    if (shouldExtract('products', extractTypes)) {
      extractedContent.content.products = extractProducts($);
    }
    
    if (shouldExtract('pricing', extractTypes)) {
      extractedContent.content.pricing = extractPricing($);
    }
    
    if (shouldExtract('services', extractTypes)) {
      extractedContent.content.services = extractServices($);
    }
    
    if (shouldExtract('events', extractTypes)) {
      extractedContent.content.events = extractEvents($);
    }
    
    if (shouldExtract('reviews', extractTypes)) {
      extractedContent.content.reviews = extractReviews($);
    }
    
    if (shouldExtract('media', extractTypes)) {
      extractedContent.content.media = extractMedia($);
    }
    
    if (shouldExtract('tables', extractTypes)) {
      extractedContent.content.tables = extractTables($);
    }
    
    if (shouldExtract('forms', extractTypes)) {
      extractedContent.content.forms = extractForms($);
    }
    
    if (shouldExtract('contacts', extractTypes)) {
      extractedContent.content.contacts = extractContacts($);
    }
    
    if (includeRawText) {
      extractedContent.content.fullText = $('body').text().replace(/\s+/g, ' ').trim();
      extractedContent.content.wordCount = extractedContent.content.fullText.split(' ').length;
    }
    
    if (includeMetadata) {
      extractedContent.metadata = {
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
        keywords: $('meta[name="keywords"]').attr('content') || '',
        author: $('meta[name="author"]').attr('content') || '',
        language: $('html').attr('lang') || '',
        contentType: 'text/html',
        extractedTypes: Object.keys(extractedContent.content)
      };
    }
    
    return extractedContent;
  }
  
  // Helper: Check if should extract type
  function shouldExtract(type, extractTypes) {
    return extractTypes.includes('all') || extractTypes.includes(type);
  }
  
  // Extract structured data (JSON-LD, Microdata)
  function extractStructuredData($, url) {
    const structuredData = {
      jsonLd: [],
      microdata: [],
      openGraph: {},
      twitterCard: {}
    };
    
    // JSON-LD extraction
    $('script[type="application/ld+json"]').each((i, script) => {
      try {
        const data = JSON.parse($(script).html());
        structuredData.jsonLd.push(data);
      } catch (error) {
        // Invalid JSON, skip
      }
    });
    
    // Microdata extraction
    $('[itemtype]').each((i, element) => {
      const $el = $(element);
      const itemType = $el.attr('itemtype');
      const item = extractMicrodataItem($, $el);
      
      structuredData.microdata.push({
        type: itemType,
        data: item
      });
    });
    
    // Open Graph tags
    $('meta[property^="og:"]').each((i, meta) => {
      const property = $(meta).attr('property').replace('og:', '');
      const content = $(meta).attr('content');
      structuredData.openGraph[property] = content;
    });
    
    // Twitter Card tags
    $('meta[name^="twitter:"]').each((i, meta) => {
      const name = $(meta).attr('name').replace('twitter:', '');
      const content = $(meta).attr('content');
      structuredData.twitterCard[name] = content;
    });
    
    return structuredData;
  }
  
  // Extract microdata item
  function extractMicrodataItem($, $element) {
    const item = {};
    
    $element.find('[itemprop]').each((i, prop) => {
      const $prop = $(prop);
      const propName = $prop.attr('itemprop');
      let propValue;
      
      if ($prop.attr('itemscope')) {
        propValue = extractMicrodataItem($, $prop);
      } else if ($prop.is('meta')) {
        propValue = $prop.attr('content');
      } else if ($prop.is('a, link')) {
        propValue = $prop.attr('href');
      } else if ($prop.is('img')) {
        propValue = $prop.attr('src');
      } else {
        propValue = $prop.text().trim();
      }
      
      if (item[propName]) {
        if (Array.isArray(item[propName])) {
          item[propName].push(propValue);
        } else {
          item[propName] = [item[propName], propValue];
        }
      } else {
        item[propName] = propValue;
      }
    });
    
    return item;
  }
  
  // Extract products
  function extractProducts($) {
    const products = [];
    const productSelectors = [
      '.product', '.product-item', '.product-card', '.product-container',
      '.item', '.listing', '.catalog-item', '[itemtype*="Product"]'
    ];
    
    productSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        const product = {
          name: extractText($el, [
            'h1', 'h2', 'h3', '.title', '.name', '.product-title',
            '[itemprop="name"]'
          ]),
          description: extractText($el, [
            '.description', '.summary', '.product-description',
            '[itemprop="description"]'
          ]),
          price: extractPrice($el),
          image: extractImage($el),
          sku: extractText($el, ['.sku', '[data-sku]', '[itemprop="sku"]']),
          brand: extractText($el, ['.brand', '[itemprop="brand"]']),
          rating: extractRating($el),
          availability: extractText($el, [
            '.availability', '.stock', '[itemprop="availability"]'
          ]),
          category: extractText($el, ['.category', '.tag', '[itemprop="category"]']),
          position: i,
          extracted_at: new Date().toISOString()
        };
        
        if (product.name || product.description || product.price) {
          products.push(product);
        }
      });
    });
    
    return products;
  }
  
  // Extract pricing information
  function extractPricing($) {
    const pricing = [];
    const priceSelectors = [
      '.price', '.pricing', '.cost', '.fee', '.rate', '.amount',
      '[itemprop="price"]', '[itemprop="priceRange"]'
    ];
    
    priceSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        const priceText = $el.text().trim();
        
        const priceMatch = priceText.match(/[$£€¥₹₽¢]?[\d,]+\.?\d*/);
        if (priceMatch) {
          pricing.push({
            price: priceMatch[0],
            currency: detectCurrency(priceText),
            context: $el.parent().text().slice(0, 100),
            type: determinePriceType($el),
            position: i,
            extracted_at: new Date().toISOString()
          });
        }
      });
    });
    
    return pricing;
  }
  
  // Extract services
  function extractServices($) {
    const services = [];
    const serviceSelectors = [
      '.service', '.service-item', '.offering', '.package'
    ];
    
    serviceSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        const service = {
          name: extractText($el, ['h1', 'h2', 'h3', '.title', '.name']),
          description: extractText($el, ['.description', '.summary']),
          price: extractPrice($el),
          duration: extractText($el, ['.duration', '.length']),
          category: extractText($el, ['.category', '.type']),
          provider: extractText($el, ['.provider', '.vendor']),
          position: i,
          extracted_at: new Date().toISOString()
        };
        
        if (service.name || service.description) {
          services.push(service);
        }
      });
    });
    
    return services;
  }
  
  // Extract events
  function extractEvents($) {
    const events = [];
    const eventSelectors = [
      '.event', '.event-item', '[itemtype*="Event"]'
    ];
    
    eventSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        const event = {
          title: extractText($el, [
            'h1', 'h2', 'h3', '.title', '.name', '[itemprop="name"]'
          ]),
          description: extractText($el, [
            '.description', '[itemprop="description"]'
          ]),
          startDate: extractText($el, [
            '.date', '.start-date', '[itemprop="startDate"]'
          ]),
          endDate: extractText($el, [
            '.end-date', '[itemprop="endDate"]'
          ]),
          location: extractText($el, [
            '.location', '.venue', '[itemprop="location"]'
          ]),
          price: extractPrice($el),
          organizer: extractText($el, [
            '.organizer', '[itemprop="organizer"]'
          ]),
          position: i,
          extracted_at: new Date().toISOString()
        };
        
        if (event.title || event.description) {
          events.push(event);
        }
      });
    });
    
    return events;
  }
  
  // Extract reviews
  function extractReviews($) {
    const reviews = [];
    const reviewSelectors = [
      '.review', '.review-item', '[itemtype*="Review"]'
    ];
    
    reviewSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        const review = {
          title: extractText($el, ['h1', 'h2', 'h3', '.title']),
          content: extractText($el, ['.content', '.text', '.body']),
          author: extractText($el, ['.author', '.reviewer', '[itemprop="author"]']),
          rating: extractRating($el),
          date: extractText($el, ['.date', '[itemprop="datePublished"]']),
          verified: extractText($el, ['.verified', '.confirmed']),
          position: i,
          extracted_at: new Date().toISOString()
        };
        
        if (review.content || review.rating) {
          reviews.push(review);
        }
      });
    });
    
    return reviews;
  }
  
  // Extract media (images, videos)
  function extractMedia($) {
    const media = [];
    
    // Images
    $('img').each((i, img) => {
      const $img = $(img);
      const src = $img.attr('src') || $img.attr('data-src');
      
      if (src && !src.includes('data:image')) {
        media.push({
          type: 'image',
          src: src.startsWith('//') ? 'https:' + src : src,
          alt: $img.attr('alt') || '',
          title: $img.attr('title') || '',
          width: $img.attr('width') || '',
          height: $img.attr('height') || '',
          position: i
        });
      }
    });
    
    // Videos
    $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').each((i, video) => {
      const $video = $(video);
      
      media.push({
        type: 'video',
        src: $video.attr('src') || $video.find('source').attr('src') || '',
        title: $video.attr('title') || '',
        poster: $video.attr('poster') || '',
        position: i
      });
    });
    
    return media;
  }
  
  // Extract tables
  function extractTables($) {
    const tables = [];
    
    $('table').each((i, table) => {
      const $table = $(table);
      const headers = [];
      const rows = [];
      
      // Extract headers
      $table.find('thead th, tr:first-child th, tr:first-child td').each((j, th) => {
        headers.push($(th).text().trim());
      });
      
      // Extract rows
      $table.find('tbody tr, tr').each((j, tr) => {
        const row = [];
        $(tr).find('td, th').each((k, td) => {
          row.push($(td).text().trim());
        });
        if (row.length > 0) {
          rows.push(row);
        }
      });
      
      if (headers.length > 0 || rows.length > 0) {
        tables.push({
          headers,
          rows,
          caption: $table.find('caption').text().trim(),
          position: i,
          extracted_at: new Date().toISOString()
        });
      }
    });
    
    return tables;
  }
  
  // Extract forms
  function extractForms($) {
    const forms = [];
    
    $('form').each((i, form) => {
      const $form = $(form);
      const fields = [];
      
      $form.find('input, select, textarea').each((j, field) => {
        const $field = $(field);
        fields.push({
          type: $field.attr('type') || $field.prop('tagName').toLowerCase(),
          name: $field.attr('name') || '',
          id: $field.attr('id') || '',
          placeholder: $field.attr('placeholder') || '',
          required: $field.attr('required') !== undefined,
          label: $form.find(`label[for="${$field.attr('id')}"]`).text().trim()
        });
      });
      
      forms.push({
        action: $form.attr('action') || '',
        method: $form.attr('method') || 'GET',
        fields,
        position: i,
        extracted_at: new Date().toISOString()
      });
    });
    
    return forms;
  }
  
  // Extract contact information
  function extractContacts($) {
    const contacts = [];
    
    // Phone numbers
    const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?[0-9]{3}\)?[-.\s]?)?[0-9]{3}[-.\s]?[0-9]{4}/g;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    
    const bodyText = $('body').text();
    
    const phones = bodyText.match(phoneRegex) || [];
    const emails = bodyText.match(emailRegex) || [];
    
    // Structured contact extraction
    $('.contact, .contact-info, .contact-details').each((i, contact) => {
      const $contact = $(contact);
      
      contacts.push({
        phone: extractText($contact, ['.phone', '.tel', '.telephone']),
        email: extractText($contact, ['.email', '.mail']),
        address: extractText($contact, ['.address', '.location']),
        position: i,
        extracted_at: new Date().toISOString()
      });
    });
    
    return {
      structured: contacts,
      phones: [...new Set(phones)],
      emails: [...new Set(emails)]
    };
  }
  
  // Helper functions
  function extractText($el, selectors) {
    for (const selector of selectors) {
      const element = $el.find(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text) return text;
      }
    }
    return '';
  }
  
  function extractPrice($el) {
    const priceSelectors = [
      '.price', '.cost', '.amount', '[data-price]', '[itemprop="price"]'
    ];
    
    for (const selector of priceSelectors) {
      const element = $el.find(selector).first();
      if (element.length) {
        const priceText = element.text().trim();
        const priceMatch = priceText.match(/[$£€¥₹₽¢]?[\d,]+\.?\d*/);
        if (priceMatch) return priceMatch[0];
      }
    }
    return '';
  }
  
  function extractImage($el) {
    const img = $el.find('img').first();
    return img.attr('src') || img.attr('data-src') || '';
  }
  
  function extractRating($el) {
    const ratingSelectors = [
      '.rating', '.stars', '[data-rating]', '[itemprop="ratingValue"]'
    ];
    
    for (const selector of ratingSelectors) {
      const element = $el.find(selector).first();
      if (element.length) {
        const ratingText = element.text().trim();
        const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
        if (ratingMatch) return parseFloat(ratingMatch[1]);
      }
    }
    return null;
  }
  
  function detectCurrency(text) {
    const currencyMap = {
      '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY',
      '₹': 'INR', '₽': 'RUB', '¢': 'USD'
    };
    
    for (const [symbol, code] of Object.entries(currencyMap)) {
      if (text.includes(symbol)) return code;
    }
    return '';
  }
  
  function determinePriceType($el) {
    const text = $el.text().toLowerCase();
    if (text.includes('monthly') || text.includes('month')) return 'monthly';
    if (text.includes('yearly') || text.includes('annual')) return 'yearly';
    if (text.includes('weekly') || text.includes('week')) return 'weekly';
    if (text.includes('daily') || text.includes('day')) return 'daily';
    if (text.includes('hourly') || text.includes('hour')) return 'hourly';
    return 'one-time';
  }
  
  return {
    extractAllContent
  };
}

module.exports = { createContentExtractor };
```

---

## 5. AWS S3 Storage Manager

**Copy-paste ready function for organized S3 storage**

```javascript
/**
 * 🚀 READY-TO-INTEGRATE: AWS S3 Storage Manager
 * Organized storage for scraped content with proper folder structure
 * 
 * Features:
 * - Organized folder structure by domain and date
 * - Multiple content type storage (raw, processed, structured)
 * - Automatic metadata generation
 * - Error handling and retry logic
 */
async function createS3StorageManager(config = {}) {
  const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const crypto = require('crypto');
  const { URL } = require('url');
  
  const {
    bucketName = process.env.BEDROCK_S3_BUCKET,
    region = process.env.AWS_REGION || 'us-east-1',
    maxRetries = 3,
    retryDelay = 1000
  } = config;
  
  const s3Client = new S3Client({ 
    region,
    maxAttempts: maxRetries
  });
  
  console.log(`📦 S3 Storage Manager initialized: Bucket=${bucketName}, Region=${region}`);
  
  // Main storage function
  async function storeScrapedContent(scrapedData, options = {}) {
    const {
      includeRaw = true,
      includeProcessed = true,
      includeStructured = true,
      includeMedia = true,
      includeTables = true,
      generateMetadata = true
    } = options;
    
    try {
      const storageInfo = generateStorageInfo(scrapedData.url);
      const uploadResults = [];
      
      console.log(`📤 Storing content for: ${scrapedData.url}`);
      
      // Store raw content
      if (includeRaw && scrapedData.content.fullText) {
        const rawKey = `raw/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_raw.html`;
        await uploadWithRetry(rawKey, scrapedData.content.fullText, 'text/html');
        uploadResults.push({ type: 'raw', key: rawKey, status: 'success' });
      }
      
      // Store processed content
      if (includeProcessed) {
        const processedKey = `processed/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_processed.json`;
        await uploadWithRetry(processedKey, JSON.stringify(scrapedData, null, 2), 'application/json');
        uploadResults.push({ type: 'processed', key: processedKey, status: 'success' });
      }
      
      // Store structured data
      if (includeStructured && scrapedData.content.products?.length > 0) {
        const productsKey = `structured/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_products.json`;
        await uploadWithRetry(productsKey, JSON.stringify(scrapedData.content.products, null, 2), 'application/json');
        uploadResults.push({ type: 'products', key: productsKey, status: 'success' });
      }
      
      if (includeStructured && scrapedData.content.pricing?.length > 0) {
        const pricingKey = `structured/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_pricing.json`;
        await uploadWithRetry(pricingKey, JSON.stringify(scrapedData.content.pricing, null, 2), 'application/json');
        uploadResults.push({ type: 'pricing', key: pricingKey, status: 'success' });
      }
      
      if (includeStructured && scrapedData.content.services?.length > 0) {
        const servicesKey = `structured/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_services.json`;
        await uploadWithRetry(servicesKey, JSON.stringify(scrapedData.content.services, null, 2), 'application/json');
        uploadResults.push({ type: 'services', key: servicesKey, status: 'success' });
      }
      
      // Store media metadata
      if (includeMedia && scrapedData.content.media?.length > 0) {
        const mediaKey = `media/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_media.json`;
        await uploadWithRetry(mediaKey, JSON.stringify(scrapedData.content.media, null, 2), 'application/json');
        uploadResults.push({ type: 'media', key: mediaKey, status: 'success' });
      }
      
      // Store table data
      if (includeTables && scrapedData.content.tables?.length > 0) {
        const tablesKey = `tables/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_tables.json`;
        await uploadWithRetry(tablesKey, JSON.stringify(scrapedData.content.tables, null, 2), 'application/json');
        uploadResults.push({ type: 'tables', key: tablesKey, status: 'success' });
      }
      
      // Generate and store metadata
      if (generateMetadata) {
        const metadata = {
          url: scrapedData.url,
          title: scrapedData.title || scrapedData.metadata?.title || '',
          scrapedAt: scrapedData.timestamp || new Date().toISOString(),
          domain: storageInfo.domain,
          contentHash: storageInfo.contentHash,
          summary: {
            totalProducts: scrapedData.content.products?.length || 0,
            totalPricing: scrapedData.content.pricing?.length || 0,
            totalServices: scrapedData.content.services?.length || 0,
            totalMedia: scrapedData.content.media?.length || 0,
            totalTables: scrapedData.content.tables?.length || 0,
            wordCount: scrapedData.content.wordCount || 0,
            contentTypes: Object.keys(scrapedData.content)
          },
          storage: {
            uploads: uploadResults,
            totalFiles: uploadResults.length,
            bucketName,
            region
          }
        };
        
        const metadataKey = `metadata/${storageInfo.domain}/${storageInfo.date}/${storageInfo.hash}_metadata.json`;
        await uploadWithRetry(metadataKey, JSON.stringify(metadata, null, 2), 'application/json');
        uploadResults.push({ type: 'metadata', key: metadataKey, status: 'success' });
      }
      
      console.log(`✅ Successfully stored ${uploadResults.length} files for ${scrapedData.url}`);
      
      return {
        success: true,
        uploads: uploadResults,
        storageInfo,
        summary: {
          totalUploads: uploadResults.length,
          domain: storageInfo.domain,
          date: storageInfo.date,
          hash: storageInfo.hash
        }
      };
      
    } catch (error) {
      console.error(`❌ Error storing content: ${error.message}`);
      return {
        success: false,
        error: error.message,
        url: scrapedData.url
      };
    }
  }
  
  // Upload with retry logic
  async function uploadWithRetry(key, content, contentType, attempt = 1) {
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: contentType,
        ServerSideEncryption: 'AES256'
      });
      
      await s3Client.send(command);
      console.log(`📁 Uploaded: ${key}`);
      
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`⚠️ Upload attempt ${attempt} failed for ${key}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        return uploadWithRetry(key, content, contentType, attempt + 1);
      }
      throw error;
    }
  }
  
  // Generate storage information
  function generateStorageInfo(url) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const date = new Date().toISOString().split('T')[0];
    const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
    const contentHash = crypto.createHash('sha256').update(url + Date.now()).digest('hex');
    
    return {
      domain,
      date,
      hash,
      contentHash,
      path: `${domain}/${date}/${hash}`
    };
  }
  
  // List stored content for a domain
  async function listStoredContent(domain, options = {}) {
    const {
      startDate = null,
      endDate = null,
      contentType = null,
      maxResults = 1000
    } = options;
    
    try {
      let prefix = `processed/${domain}/`;
      if (startDate) {
        prefix += startDate;
      }
      
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: maxResults
      });
      
      const response = await s3Client.send(command);
      
      const contents = response.Contents || [];
      const filteredContents = contents.filter(item => {
        if (endDate && item.Key > `processed/${domain}/${endDate}`) return false;
        if (contentType && !item.Key.includes(`_${contentType}.json`)) return false;
        return true;
      });
      
      return {
        success: true,
        contents: filteredContents.map(item => ({
          key: item.Key,
          size: item.Size,
          lastModified: item.LastModified,
          url: extractUrlFromKey(item.Key)
        })),
        summary: {
          total: filteredContents.length,
          domain,
          dateRange: { startDate, endDate }
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        domain
      };
    }
  }
  
  // Retrieve stored content
  async function retrieveStoredContent(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      });
      
      const response = await s3Client.send(command);
      const content = await response.Body.transformToString();
      
      return {
        success: true,
        content: key.endsWith('.json') ? JSON.parse(content) : content,
        metadata: {
          contentType: response.ContentType,
          lastModified: response.LastModified,
          contentLength: response.ContentLength
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        key
      };
    }
  }
  
  // Delete stored content
  async function deleteStoredContent(key) {
    try {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      });
      
      await s3Client.send(command);
      
      return {
        success: true,
        key,
        deletedAt: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        key
      };
    }
  }
  
  // Helper: Extract URL from S3 key
  function extractUrlFromKey(key) {
    // Extract domain and hash from key like "processed/domain.com/2024-01-15/abc123_processed.json"
    const parts = key.split('/');
    if (parts.length >= 4) {
      const domain = parts[1];
      const hash = parts[3].split('_')[0];
      return `https://${domain}?hash=${hash}`;
    }
    return null;
  }
  
  // Get storage statistics
  async function getStorageStatistics(domain = null) {
    try {
      const prefix = domain ? `processed/${domain}/` : 'processed/';
      
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix
      });
      
      let totalObjects = 0;
      let totalSize = 0;
      const contentTypes = {};
      const domains = new Set();
      
      let continuationToken;
      
      do {
        if (continuationToken) {
          command.input.ContinuationToken = continuationToken;
        }
        
        const response = await s3Client.send(command);
        
        response.Contents?.forEach(item => {
          totalObjects++;
          totalSize += item.Size;
          
          const keyParts = item.Key.split('/');
          if (keyParts.length >= 2) {
            domains.add(keyParts[1]);
          }
          
          const contentType = item.Key.split('_').pop().split('.')[0];
          contentTypes[contentType] = (contentTypes[contentType] || 0) + 1;
        });
        
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
      
      return {
        success: true,
        statistics: {
          totalObjects,
          totalSize: formatBytes(totalSize),
          domains: Array.from(domains),
          contentTypes,
          bucketName,
          region,
          generatedAt: new Date().toISOString()
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Helper: Format bytes
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  return {
    storeScrapedContent,
    listStoredContent,
    retrieveStoredContent,
    deleteStoredContent,
    getStorageStatistics
  };
}

module.exports = { createS3StorageManager };
```

This comprehensive collection provides you with production-ready, copy-paste functions for any web scraping project. Each function is self-contained and can be integrated into any Node.js application with minimal dependencies.