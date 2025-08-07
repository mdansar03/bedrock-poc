import React, { useState } from 'react'
import { Globe, CheckCircle, AlertCircle, Clock, ExternalLink } from 'lucide-react'
import { scrapingAPI } from '../utils/api'

const ScrapingPage = () => {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [scrapingMode, setScrapingMode] = useState('single') // 'single' or 'crawl'
  const [crawlOptions, setCrawlOptions] = useState({
    maxPages: 1000, // Much higher default for comprehensive scraping
    delay: 3000, // Increased delay for better server respect and content loading
    followExternalLinks: false,
    batchSize: 3, // New: concurrent processing control
    deepExtraction: true // New: enable deep DOM extraction with scrolling
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!url) {
      setError('Please enter a valid URL')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // Sanitize URL before sending
      const cleanUrl = sanitizeUrl(url)
      
      let response;
      if (scrapingMode === 'crawl') {
        // For crawl mode, the backend will automatically discover all pages
        // and scrape them without needing a separate discovery step
        response = await scrapingAPI.crawlWebsite(cleanUrl, crawlOptions)
      } else {
        response = await scrapingAPI.scrapeWebsite(cleanUrl)
      }
      
      setResult(response.data)
    } catch (error) {
      console.error('Scraping error:', error)
      setError(error.response?.data?.message || error.message || 'Failed to scrape website')
    } finally {
      setLoading(false)
    }
  }

  const sanitizeUrl = (url) => {
    if (!url || typeof url !== 'string') return ''
    
    // Remove leading/trailing whitespace
    let cleanUrl = url.trim()
    
    // Remove @ symbols and other unwanted characters from the beginning
    cleanUrl = cleanUrl.replace(/^[@#]+/, '')
    
    // Ensure it starts with http:// or https://
    if (cleanUrl && !cleanUrl.match(/^https?:\/\//)) {
      cleanUrl = 'https://' + cleanUrl
    }
    
    return cleanUrl
  }

  const isValidUrl = (string) => {
    if (!string) return false
    
    try {
      const cleanUrl = sanitizeUrl(string)
      new URL(cleanUrl)
      return true
    } catch (_) {
      return false
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center mb-4">
          <Globe className="w-8 h-8 text-blue-600 mr-3" />
          <h1 className="text-3xl font-bold text-gray-900">Website Scraping</h1>
        </div>
        <p className="text-gray-600">
          Enter a website URL to scrape and extract content for your knowledge base.
        </p>
      </div>

      {/* Scraping Form */}
      <div className="card mb-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Scraping Mode Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Scraping Mode
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div 
                className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                  scrapingMode === 'single' 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setScrapingMode('single')}
              >
                <div className="flex items-center">
                  <input
                    type="radio"
                    name="scrapingMode"
                    value="single"
                    checked={scrapingMode === 'single'}
                    onChange={() => setScrapingMode('single')}
                    className="mr-3"
                  />
                  <div>
                    <h3 className="font-medium text-gray-900">Single Page</h3>
                    <p className="text-sm text-gray-600">Scrape only the specified page</p>
                  </div>
                </div>
              </div>
              
              <div 
                className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                  scrapingMode === 'crawl' 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setScrapingMode('crawl')}
              >
                <div className="flex items-center">
                  <input
                    type="radio"
                    name="scrapingMode"
                    value="crawl"
                    checked={scrapingMode === 'crawl'}
                    onChange={() => setScrapingMode('crawl')}
                    className="mr-3"
                  />
                  <div>
                    <h3 className="font-medium text-gray-900">Full Website Crawl</h3>
                    <p className="text-sm text-gray-600">Discover and scrape all pages from sitemap and links</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Crawl Options */}
          {scrapingMode === 'crawl' && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-4">
              <h4 className="font-medium text-gray-900 mb-3">Crawling Options</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="maxPages" className="block text-sm font-medium text-gray-700 mb-1">
                    Max Pages Limit
                  </label>
                  <input
                    type="number"
                    id="maxPages"
                    min="1"
                    max="10000"
                    value={crawlOptions.maxPages}
                    onChange={(e) => setCrawlOptions(prev => ({
                      ...prev,
                      maxPages: parseInt(e.target.value) || 1000
                    }))}
                    className="input-field"
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Auto-discover all pages, scrape up to this limit (max: 10,000)
                  </p>
                </div>
                
                <div>
                  <label htmlFor="delay" className="block text-sm font-medium text-gray-700 mb-1">
                    Delay (ms)
                  </label>
                  <input
                    type="number"
                    id="delay"
                    min="1000"
                    max="10000"
                    step="500"
                    value={crawlOptions.delay}
                    onChange={(e) => setCrawlOptions(prev => ({
                      ...prev,
                      delay: parseInt(e.target.value) || 3000
                    }))}
                    className="input-field"
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-500 mt-1">Delay between batches (recommended: 3000ms+)</p>
                </div>
                
                <div>
                  <label htmlFor="batchSize" className="block text-sm font-medium text-gray-700 mb-1">
                    Batch Size
                  </label>
                  <select
                    id="batchSize"
                    value={crawlOptions.batchSize}
                    onChange={(e) => setCrawlOptions(prev => ({
                      ...prev,
                      batchSize: parseInt(e.target.value)
                    }))}
                    className="input-field"
                    disabled={loading}
                  >
                    <option value={1}>1 (Slowest, safest)</option>
                    <option value={2}>2 (Conservative)</option>
                    <option value={3}>3 (Balanced)</option>
                    <option value={5}>5 (Aggressive)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Concurrent page processing</p>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Advanced Options
                    </label>
                    <div className="flex items-center mt-2">
                      <input
                        type="checkbox"
                        id="followExternalLinks"
                        checked={crawlOptions.followExternalLinks}
                        onChange={(e) => setCrawlOptions(prev => ({
                          ...prev,
                          followExternalLinks: e.target.checked
                        }))}
                        className="mr-2"
                        disabled={loading}
                      />
                      <label htmlFor="followExternalLinks" className="text-sm text-gray-700">
                        Follow external links
                      </label>
                    </div>
                    
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="deepExtraction"
                        checked={crawlOptions.deepExtraction}
                        onChange={(e) => setCrawlOptions(prev => ({
                          ...prev,
                          deepExtraction: e.target.checked
                        }))}
                        className="mr-2"
                        disabled={loading}
                      />
                      <label htmlFor="deepExtraction" className="text-sm text-gray-700">
                        Deep extraction (scrolling + dynamic content)
                      </label>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Enhanced extraction with content loading</p>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>Enhanced Scraping:</strong> Automatically discovers ALL pages through sitemaps and internal links (up to 10,000). 
                  Deep DOM extraction with scrolling simulation, dynamic content loading, popup handling, and batch processing with retry logic. 
                  Perfect for complex e-commerce sites with hundreds of products, recipes, and detailed content.
                </p>
              </div>
            </div>
          )}

          {/* URL Input */}
          <div>
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
              Website URL
            </label>
            <div className="flex space-x-4">
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => {
                  let inputUrl = e.target.value
                  // Remove @ symbols as user types
                  inputUrl = inputUrl.replace(/[@]/g, '')
                  setUrl(inputUrl)
                }}
                placeholder="https://example.com"
                className="input-field flex-1"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !url || !isValidUrl(url)}
                className="btn-primary flex items-center space-x-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>{scrapingMode === 'crawl' ? 'Crawling...' : 'Scraping...'}</span>
                  </>
                ) : (
                  <>
                    <Globe size={18} />
                    <span>{scrapingMode === 'crawl' ? 'Crawl Website' : 'Scrape Page'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
          
          {!isValidUrl(url) && url && (
            <p className="text-sm text-red-600">Please enter a valid URL starting with http:// or https://</p>
          )}
        </form>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card">
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {scrapingMode === 'crawl' ? 'Crawling Website' : 'Scraping Website'}
              </h3>
              <p className="text-gray-600">
                {scrapingMode === 'crawl' 
                  ? 'This may take several minutes while we discover and scrape all pages...'
                  : 'This may take a few moments while we extract and process the content...'
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card border-red-200 bg-red-50">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800 mb-1">Scraping Failed</h3>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Success State */}
      {result && (
        <div className="space-y-6">
          {/* Summary Card */}
          <div className="card border-green-200 bg-green-50">
            <div className="flex items-start">
              <CheckCircle className="w-6 h-6 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-green-800 mb-2">Website Scraped Successfully!</h3>
                <p className="text-green-700 mb-4">
                  Content has been extracted and processed for your knowledge base.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="bg-white rounded-lg p-3">
                    <div className="font-medium text-gray-900">
                      {result.summary?.pagesScraped ? 'Pages Scraped' : 'Chunks Extracted'}
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {result.summary?.pagesScraped || result.totalPagesScraped || result.chunksExtracted}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="font-medium text-gray-900">
                      {result.totalChunks ? 'Total Chunks' : 'Processing Time'}
                    </div>
                    <div className={result.totalChunks ? "text-2xl font-bold text-green-600" : "text-sm text-gray-600 flex items-center"}>
                      {result.totalChunks ? (
                        result.totalChunks
                      ) : (
                        <>
                          <Clock size={14} className="mr-1" />
                          {new Date(result.timestamp).toLocaleTimeString()}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="font-medium text-gray-900">
                      {result.successRate ? 'Success Rate' : 'Status'}
                    </div>
                    <div className="text-sm text-green-600 font-medium">
                      {result.successRate || 'Ready for Chat'}
                    </div>
                  </div>
                </div>
                
                {/* Discovery Stats */}
                {result.summary?.pagesDiscovered && (
                  <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <h6 className="text-sm font-medium text-blue-900 mb-2">Discovery Summary</h6>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-blue-700">Pages Found:</span>
                        <div className="font-bold text-blue-900">{result.summary.pagesDiscovered}</div>
                      </div>
                      <div>
                        <span className="text-blue-700">Pages Scraped:</span>
                        <div className="font-bold text-blue-900">{result.summary.pagesScraped}</div>
                      </div>
                      <div>
                        <span className="text-blue-700">Limit Applied:</span>
                        <div className="font-bold text-blue-900">{result.summary.limitApplied ? 'Yes' : 'No'}</div>
                      </div>
                      <div>
                        <span className="text-blue-700">Efficiency:</span>
                        <div className="font-bold text-blue-900">{result.summary.efficiency}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Details Card */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scraping Details</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Page Title</label>
                <p className="text-gray-900">{result.title}</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source URL</label>
                <div className="flex items-center space-x-2">
                  <p className="text-gray-900 flex-1 truncate">{result.url}</p>
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Content Hash</label>
                <p className="text-gray-600 font-mono text-sm">{result.metadata?.contentHash}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scraped At</label>
                <p className="text-gray-600">{new Date(result.timestamp).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Next Steps */}
          <div className="card bg-blue-50 border-blue-200">
            <h3 className="text-lg font-semibold text-blue-900 mb-3">What's Next?</h3>
            <p className="text-blue-800 mb-4">
              Your content has been successfully processed and is now available in your knowledge base.
            </p>
            <a
              href="/chat"
              className="btn-primary"
            >
              Start Chatting About This Content
            </a>
          </div>
        </div>
      )}

      {/* Instructions */}
      {!loading && !result && !error && (
        <div className="card bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">How it works</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                1
              </div>
              <p>Enter the URL of the website you want to scrape</p>
            </div>
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                2
              </div>
              <p>Our system will extract and clean the content from the page</p>
            </div>
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                3
              </div>
              <p>Content is automatically chunked and stored in your knowledge base</p>
            </div>
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                4
              </div>
              <p>You can then chat with our AI about the scraped content</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ScrapingPage