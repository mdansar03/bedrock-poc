# 🚀 Step-by-Step Implementation Guide

This guide provides a complete step-by-step implementation for building the scraping service from scratch.

## 📋 Quick Start Checklist

- [ ] **Environment Setup** (Node.js, AWS, Dependencies)
- [ ] **Basic Scraper Implementation** (Single page)
- [ ] **Batch Processing Setup** (Multiple URLs)
- [ ] **AWS Integration** (S3 Storage + Bedrock)
- [ ] **API Development** (Express endpoints)
- [ ] **Frontend Interface** (React dashboard)
- [ ] **Production Deployment** (Docker + Monitoring)

---

## 🏗️ Step 1: Environment Setup

### Prerequisites
```bash
# Install Node.js 18+
node --version  # Should be 18.0.0 or higher

# Install Git
git --version

# AWS CLI (optional but recommended)
aws --version
```

### Create Project Structure
```bash
mkdir my-scraping-service
cd my-scraping-service

# Initialize Node.js project
npm init -y

# Create folder structure
mkdir -p src/{services,routes,utils,middleware}
mkdir -p logs
mkdir -p frontend/src/{components,pages,services}
mkdir -p tests
mkdir -p docs
mkdir -p config
```

### Install Dependencies
```bash
# Core scraping dependencies
npm install puppeteer cheerio axios xml2js

# AWS SDK
npm install @aws-sdk/client-s3 @aws-sdk/client-bedrock-agent-runtime

# Express server
npm install express cors helmet express-rate-limit express-validator

# Utilities
npm install crypto uuid winston dotenv

# Development dependencies
npm install --save-dev nodemon concurrently
```

### Environment Configuration
```bash
# Create .env file
cat > .env << EOF
# Application
NODE_ENV=development
PORT=3002

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
BEDROCK_KNOWLEDGE_BASE_ID=your-kb-id
BEDROCK_DATA_SOURCE_ID=your-data-source-id
BEDROCK_S3_BUCKET=your-bucket-name

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Browser Configuration
MAX_BROWSER_INSTANCES=3
BROWSER_TIMEOUT=60000
SCRAPING_DELAY=3000
EOF
```

---

## 🔧 Step 2: Core Service Implementation

### 2.1 Create Hash Utility
```javascript
// src/utils/hash.js
const crypto = require('crypto');

function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function generateChunkId(url, index) {
  const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
  return `${urlHash}_chunk_${index}`;
}

module.exports = {
  generateHash,
  generateChunkId
};
```

### 2.2 Create Logger
```javascript
// src/utils/logger.js
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join('logs', 'combined.log') 
    })
  ]
});

module.exports = logger;
```

### 2.3 Create Basic Scraper Service
```javascript
// src/services/scrapingService.js
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { generateHash, generateChunkId } = require('../utils/hash');
const logger = require('../utils/logger');

class ScrapingService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.bucketName = process.env.BEDROCK_S3_BUCKET;
  }

  // Single page scraping
  async scrapeSinglePage(url, options = {}) {
    const {
      timeout = 60000,
      waitTime = 3000,
      extractTypes = ['products', 'pricing', 'text']
    } = options;

    let browser;

    try {
      logger.info(`Starting scrape for: ${url}`);

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout });
      await page.waitForTimeout(waitTime);

      const html = await page.content();
      const title = await page.title();

      const extractedContent = this.extractContent(html, url, extractTypes);

      const result = {
        url,
        title,
        timestamp: new Date().toISOString(),
        content: extractedContent
      };

      await this.storeContent(result);
      logger.info(`Successfully scraped: ${url}`);

      return result;

    } catch (error) {
      logger.error(`Error scraping ${url}: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  // Content extraction
  extractContent(html, url, extractTypes) {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();

    const content = {};

    if (extractTypes.includes('text')) {
      content.fullText = $('body').text().replace(/\s+/g, ' ').trim();
      content.wordCount = content.fullText.split(' ').length;
    }

    if (extractTypes.includes('products')) {
      content.products = this.extractProducts($);
    }

    if (extractTypes.includes('pricing')) {
      content.pricing = this.extractPricing($);
    }

    return content;
  }

  // Extract products
  extractProducts($) {
    const products = [];
    const selectors = ['.product', '.product-item', '.product-card'];

    selectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        const product = {
          name: $el.find('h1, h2, h3, .title, .name').first().text().trim(),
          price: this.extractPrice($el),
          description: $el.find('.description, .summary').first().text().trim(),
          image: $el.find('img').first().attr('src') || '',
          position: i,
          extracted_at: new Date().toISOString()
        };

        if (product.name || product.price) {
          products.push(product);
        }
      });
    });

    return products;
  }

  // Extract pricing
  extractPricing($) {
    const pricing = [];
    $('.price, .pricing, .cost').each((i, element) => {
      const $el = $(element);
      const priceText = $el.text().trim();
      const priceMatch = priceText.match(/[$£€¥₹₽¢]?[\d,]+\.?\d*/);

      if (priceMatch) {
        pricing.push({
          price: priceMatch[0],
          context: $el.parent().text().slice(0, 100),
          position: i,
          extracted_at: new Date().toISOString()
        });
      }
    });

    return pricing;
  }

  // Helper: Extract price
  extractPrice($el) {
    const priceSelectors = ['.price', '.cost', '.amount'];
    
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

  // Store content in S3
  async storeContent(scrapedData) {
    try {
      const domain = new URL(scrapedData.url).hostname;
      const date = new Date().toISOString().split('T')[0];
      const hash = generateHash(scrapedData.url).substring(0, 8);

      // Store processed content
      const processedKey = `processed/${domain}/${date}/${hash}_processed.json`;
      await this.uploadToS3(processedKey, JSON.stringify(scrapedData, null, 2));

      // Store raw text
      if (scrapedData.content.fullText) {
        const rawKey = `raw/${domain}/${date}/${hash}_raw.txt`;
        await this.uploadToS3(rawKey, scrapedData.content.fullText);
      }

      logger.info(`Stored content in S3: ${processedKey}`);

    } catch (error) {
      logger.error(`Error storing content: ${error.message}`);
    }
  }

  // Upload to S3
  async uploadToS3(key, content) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: content,
      ContentType: key.endsWith('.json') ? 'application/json' : 'text/plain'
    });

    await this.s3Client.send(command);
  }
}

module.exports = new ScrapingService();
```

---

## 🌐 Step 3: API Development

### 3.1 Create Express Server
```javascript
// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Routes
app.use('/api/scraping', require('./src/routes/scraping'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling
app.use((error, req, res, next) => {
  logger.error(`Server error: ${error.message}`);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📱 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🔧 AWS Region: ${process.env.AWS_REGION}`);
});
```

### 3.2 Create Scraping Routes
```javascript
// src/routes/scraping.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const scrapingService = require('../services/scrapingService');
const logger = require('../utils/logger');

const router = express.Router();

// Validation middleware
const validateScrapeRequest = [
  body('url')
    .isURL()
    .withMessage('Valid URL is required'),
  body('options.timeout')
    .optional()
    .isInt({ min: 5000, max: 120000 })
    .withMessage('Timeout must be between 5000 and 120000ms'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }
    next();
  }
];

// Single page scraping endpoint
router.post('/single', validateScrapeRequest, async (req, res) => {
  try {
    const { url, options = {} } = req.body;
    
    logger.info(`Received scraping request for: ${url}`);
    
    const result = await scrapingService.scrapeSinglePage(url, options);
    
    res.json({
      success: true,
      data: result,
      message: 'Page scraped successfully'
    });
    
  } catch (error) {
    logger.error(`Scraping error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      url: req.body.url
    });
  }
});

module.exports = router;
```

---

## 📱 Step 4: Frontend Development

### 4.1 Create React Frontend
```bash
# Create frontend folder structure
cd frontend
npm init -y

# Install React dependencies
npm install react react-dom vite @vitejs/plugin-react
npm install axios
```

### 4.2 Configure Vite
```javascript
// frontend/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true
      }
    }
  }
})
```

### 4.3 Create Main App Component
```jsx
// frontend/src/App.jsx
import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleScrape = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await axios.post('/api/scraping/single', {
        url,
        options: {
          extractTypes: ['products', 'pricing', 'text']
        }
      });

      setResult(response.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Scraping failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🕷️ Web Scraping Service</h1>
        <p>Extract comprehensive data from any website</p>
      </header>

      <main className="app-main">
        <form onSubmit={handleScrape} className="scrape-form">
          <div className="form-group">
            <label htmlFor="url">Website URL:</label>
            <input
              type="url"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              required
            />
          </div>
          
          <button type="submit" disabled={loading || !url}>
            {loading ? '🔄 Scraping...' : '🚀 Start Scraping'}
          </button>
        </form>

        {error && (
          <div className="error">
            <h3>❌ Error</h3>
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div className="results">
            <h3>✅ Scraping Results</h3>
            
            <div className="result-section">
              <h4>📄 Page Info</h4>
              <p><strong>URL:</strong> {result.url}</p>
              <p><strong>Title:</strong> {result.title}</p>
              <p><strong>Word Count:</strong> {result.content.wordCount}</p>
            </div>

            {result.content.products && result.content.products.length > 0 && (
              <div className="result-section">
                <h4>🛍️ Products ({result.content.products.length})</h4>
                <div className="products-grid">
                  {result.content.products.slice(0, 5).map((product, index) => (
                    <div key={index} className="product-card">
                      <h5>{product.name}</h5>
                      <p className="price">{product.price}</p>
                      <p className="description">{product.description?.slice(0, 100)}...</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.content.pricing && result.content.pricing.length > 0 && (
              <div className="result-section">
                <h4>💰 Pricing ({result.content.pricing.length})</h4>
                <div className="pricing-list">
                  {result.content.pricing.slice(0, 10).map((price, index) => (
                    <div key={index} className="price-item">
                      <span className="price">{price.price}</span>
                      <span className="context">{price.context?.slice(0, 50)}...</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
```

### 4.4 Add Styling
```css
/* frontend/src/App.css */
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.app-header {
  text-align: center;
  margin-bottom: 40px;
}

.app-header h1 {
  color: #2c3e50;
  font-size: 2.5rem;
  margin-bottom: 10px;
}

.app-header p {
  color: #7f8c8d;
  font-size: 1.2rem;
}

.scrape-form {
  background: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  margin-bottom: 30px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #2c3e50;
}

.form-group input {
  width: 100%;
  padding: 12px;
  border: 2px solid #e1e8ed;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 0.3s;
}

.form-group input:focus {
  outline: none;
  border-color: #3498db;
}

button {
  background: linear-gradient(135deg, #3498db, #2980b9);
  color: white;
  padding: 12px 30px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(52, 152, 219, 0.3);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  background: #fff5f5;
  border: 1px solid #fed7d7;
  color: #e53e3e;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.results {
  background: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.result-section {
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e1e8ed;
}

.result-section:last-child {
  border-bottom: none;
}

.result-section h4 {
  color: #2c3e50;
  margin-bottom: 15px;
  font-size: 1.3rem;
}

.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}

.product-card {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #e1e8ed;
}

.product-card h5 {
  color: #2c3e50;
  margin-bottom: 10px;
  font-size: 1.1rem;
}

.product-card .price {
  color: #27ae60;
  font-weight: 600;
  font-size: 1.2rem;
  margin-bottom: 10px;
  display: block;
}

.product-card .description {
  color: #7f8c8d;
  line-height: 1.4;
}

.pricing-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.price-item {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 6px;
}

.price-item .price {
  font-weight: 600;
  color: #27ae60;
}

.price-item .context {
  color: #7f8c8d;
  font-size: 0.9rem;
}
```

---

## 🔌 Step 5: AWS Integration

### 5.1 Setup AWS Bedrock Knowledge Base

```bash
# Install AWS CLI
pip install awscli

# Configure AWS credentials
aws configure
```

### 5.2 Create S3 Bucket
```bash
# Create S3 bucket
aws s3 mb s3://your-scraping-bucket --region us-east-1

# Set bucket policy for Bedrock access
aws s3api put-bucket-policy --bucket your-scraping-bucket --policy file://bucket-policy.json
```

### 5.3 Create Knowledge Base Query Service
```javascript
// src/services/knowledgeBaseService.js
const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const logger = require('../utils/logger');

class KnowledgeBaseService {
  constructor() {
    this.client = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
  }

  async queryKnowledgeBase(query, sessionId = null) {
    try {
      const commandParams = {
        input: { text: query },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: this.knowledgeBaseId,
            modelArn: `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 5,
              },
            },
          },
        },
      };

      if (sessionId) {
        commandParams.sessionId = sessionId;
      }

      const command = new RetrieveAndGenerateCommand(commandParams);
      const response = await this.client.send(command);

      return {
        success: true,
        answer: response.output?.text || '',
        sessionId: response.sessionId,
        citations: response.citations || []
      };

    } catch (error) {
      logger.error(`Knowledge base query error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new KnowledgeBaseService();
```

---

## 📦 Step 6: Production Deployment

### 6.1 Create Docker Configuration
```dockerfile
# Dockerfile
FROM node:18-alpine

# Install Puppeteer dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 3002

CMD ["npm", "start"]
```

### 6.2 Create Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  scraper-backend:
    build: .
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - AWS_REGION=${AWS_REGION}
      - BEDROCK_KNOWLEDGE_BASE_ID=${BEDROCK_KNOWLEDGE_BASE_ID}
      - BEDROCK_S3_BUCKET=${BEDROCK_S3_BUCKET}
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped

  scraper-frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    depends_on:
      - scraper-backend
    restart: unless-stopped
```

### 6.3 Create Package.json Scripts
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "dev:frontend": "cd frontend && npm run dev",
    "dev:all": "concurrently \"npm run dev\" \"npm run dev:frontend\"",
    "build": "cd frontend && npm run build",
    "docker:build": "docker-compose build",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "test": "echo \"No tests specified\" && exit 0"
  }
}
```

---

## 🧪 Step 7: Testing & Validation

### 7.1 Test Single Page Scraping
```bash
# Start the server
npm run dev:all

# Test with curl
curl -X POST http://localhost:3002/api/scraping/single \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "extractTypes": ["products", "pricing", "text"]
    }
  }'
```

### 7.2 Test Frontend Interface
1. Open browser to `http://localhost:5173`
2. Enter a URL (e.g., `https://amazon.com`)
3. Click "Start Scraping"
4. Verify results display correctly

### 7.3 Test AWS Integration
```bash
# Check S3 bucket contents
aws s3 ls s3://your-scraping-bucket/processed/ --recursive

# Test knowledge base query (if implemented)
curl -X POST http://localhost:3002/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What products were found?"}'
```

---

## 🚀 Step 8: Production Deployment

### 8.1 Deploy with Docker
```bash
# Build and deploy
docker-compose up -d

# Check logs
docker-compose logs -f scraper-backend
```

### 8.2 Environment-Specific Configuration
```bash
# Production environment variables
export NODE_ENV=production
export PORT=3002
export AWS_REGION=us-east-1
export BEDROCK_KNOWLEDGE_BASE_ID=your-production-kb-id
export BEDROCK_S3_BUCKET=your-production-bucket
```

### 8.3 Monitoring Setup
```javascript
// Add to server.js
app.get('/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});
```

---

## 🎯 Next Steps & Extensions

1. **Add Batch Processing**: Implement sitemap discovery and batch URL processing
2. **Enhanced Data Extraction**: Add more content types (events, reviews, etc.)
3. **Real-time Chat**: Integrate knowledge base querying with chat interface
4. **Monitoring**: Add metrics, alerts, and performance monitoring
5. **Authentication**: Add user authentication and rate limiting per user
6. **Caching**: Implement Redis caching for frequently accessed data
7. **Queue System**: Add job queue for long-running scraping tasks

---

## 🔧 Troubleshooting

### Common Issues

**Puppeteer Installation Issues**
```bash
# Linux/Ubuntu
sudo apt-get update
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libcairo2

# macOS with M1/M2
npm install puppeteer --platform=darwin --arch=arm64
```

**AWS Permissions Issues**
```bash
# Check AWS credentials
aws sts get-caller-identity

# Test S3 access
aws s3 ls s3://your-bucket-name
```

**Memory Issues**
```javascript
// Add to Puppeteer launch options
{
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--max-old-space-size=4096'
  ]
}
```

This implementation guide provides a complete foundation for building a production-ready web scraping service with AWS integration!