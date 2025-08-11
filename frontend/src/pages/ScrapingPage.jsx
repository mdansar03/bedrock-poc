import React, { useState, useEffect } from 'react'
import { Globe, CheckCircle, AlertCircle, Clock, ExternalLink, Wifi, WifiOff } from 'lucide-react'
import { scrapingAPI } from '../utils/api'

const ScrapingPage = () => {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [jobStatus, setJobStatus] = useState(null) // For async crawl progress
  const [currentJobId, setCurrentJobId] = useState(null)
  const [serviceHealth, setServiceHealth] = useState({ available: true, checking: true })
  const [scrapingMode, setScrapingMode] = useState('single') // 'single' or 'crawl'
  const [crawlOptions, setCrawlOptions] = useState({
    maxPages: 1000, // Much higher default for comprehensive scraping
    delay: 3000, // Increased delay for better server respect and content loading
    followExternalLinks: false,
    batchSize: 3, // New: concurrent processing control
    deepExtraction: true // New: enable deep DOM extraction with scrolling
  })

  // Check service health on component mount
  useEffect(() => {
    checkServiceHealth()
    // Check health every 30 seconds
    const interval = setInterval(checkServiceHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const checkServiceHealth = async () => {
    try {
      const healthData = await scrapingAPI.checkHealth()
      setServiceHealth({
        available: healthData.externalService?.available || false,
        checking: false,
        health: healthData.externalService?.health,
        lastChecked: healthData.externalService?.lastChecked
      })
    } catch (error) {
      setServiceHealth({
        available: false,
        checking: false,
        error: error.message
      })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!url) {
      setError('Please enter a valid URL')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setJobStatus(null)
    setCurrentJobId(null)

    try {
      // Sanitize URL before sending
      const cleanUrl = sanitizeUrl(url)
      
      if (scrapingMode === 'crawl') {
        // Use async crawl for long-running operations
        const startResponse = await scrapingAPI.startAsyncCrawl(cleanUrl, crawlOptions)
        const jobId = startResponse.data.jobId
        
        setCurrentJobId(jobId)
        setJobStatus({
          status: 'pending',
          message: 'Starting crawl job...',
          percentage: 0
        })

        // Poll for completion
        const result = await scrapingAPI.pollCrawlCompletion(jobId, (progressData) => {
          setJobStatus({
            status: progressData.status,
            message: progressData.progress?.message || `Status: ${progressData.status}`,
            percentage: progressData.progress?.percentage || 0,
            phase: progressData.progress?.phase
          })
        })
        
        setResult(result.data)
      } else {
        // Single page scraping (still synchronous)
        const response = await scrapingAPI.scrapeWebsite(cleanUrl)
        setResult(response.data)
      }
      
    } catch (error) {
      console.error('Scraping error:', error)
      setError(error.response?.data?.message || error.message || 'Failed to scrape website')
    } finally {
      setLoading(false)
      setJobStatus(null)
      setCurrentJobId(null)
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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Globe className="w-8 h-8 text-blue-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900">Website Scraping</h1>
          </div>
          
          {/* Service Status Indicator */}
          <div className="flex items-center space-x-2">
            {serviceHealth.checking ? (
              <div className="flex items-center text-gray-500">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin mr-2"></div>
                <span className="text-sm">Checking service...</span>
              </div>
            ) : serviceHealth.available ? (
              <div className="flex items-center text-green-600">
                <Wifi className="w-4 h-4 mr-2" />
                <span className="text-sm font-medium">Service Online</span>
              </div>
            ) : (
              <div className="flex items-center text-red-600">
                <WifiOff className="w-4 h-4 mr-2" />
                <span className="text-sm font-medium">Service Offline</span>
              </div>
            )}
          </div>
        </div>
        <p className="text-gray-600">
          Enter a website URL to scrape and extract content for your knowledge base.
        </p>
        
        {/* Service Status Alert */}
        {!serviceHealth.checking && !serviceHealth.available && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-red-800 font-medium">External Scraping Service Unavailable</p>
                <p className="text-sm text-red-700 mt-1">
                  The external scraping service is currently offline. Please try again later or contact support if the issue persists.
                </p>
                {serviceHealth.error && (
                  <p className="text-xs text-red-600 mt-1">Error: {serviceHealth.error}</p>
                )}
              </div>
            </div>
          </div>
        )}
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
                  <strong>Enhanced External Scraping:</strong> Powered by advanced external scraping service with unlimited crawling capabilities. 
                  Automatically discovers ALL pages through intelligent sitemap analysis, robots.txt parsing, and comprehensive link crawling. 
                  Features professional-grade anti-detection, dynamic content handling, and optimized batch processing. 
                  Perfect for any website size - from simple blogs to complex e-commerce sites with thousands of pages.
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
                disabled={loading || !url || !isValidUrl(url) || !serviceHealth.available}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Loading State with Progress */}
      {loading && (
        <div className="card">
          <div className="flex items-center justify-center py-8">
            <div className="text-center w-full max-w-md">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {scrapingMode === 'crawl' ? 'Crawling Website' : 'Scraping Website'}
              </h3>
              
              {/* Job Progress Information */}
              {jobStatus && scrapingMode === 'crawl' && (
                <div className="space-y-3 mb-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${jobStatus.percentage}%` }}
                    ></div>
                  </div>
                  <div className="text-sm space-y-1">
                    <p className="font-medium text-gray-900">{jobStatus.message}</p>
                    {jobStatus.phase && (
                      <p className="text-gray-600 capitalize">Phase: {jobStatus.phase}</p>
                    )}
                    {currentJobId && (
                      <p className="text-xs text-gray-500">Job ID: {currentJobId}</p>
                    )}
                  </div>
                </div>
              )}
              
              <p className="text-gray-600">
                {scrapingMode === 'crawl' 
                  ? jobStatus 
                    ? 'Your crawl is running in the background. You can close this page and return later.'
                    : 'Starting crawl job... This may take several minutes while we discover and scrape all pages.'
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

          {/* Content Preview Card */}
          {(result.content?.preview || result.contentPreview) && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Content Preview</h3>
              
              {/* For single page scraping */}
              {result.content?.preview && (
                <div className="space-y-3">
                  <div className="bg-gray-50 border rounded-lg p-4">
                    <div className="text-sm text-gray-600 mb-2">Extracted Content (first 500 characters):</div>
                    <p className="text-gray-800 text-sm leading-relaxed">{result.content.preview}</p>
                  </div>
                  <div className="text-xs text-gray-500">
                    Total chunks extracted: {result.content.totalChunks || result.chunksExtracted}
                  </div>
                </div>
              )}
              
              {/* For crawling with multiple pages */}
              {result.contentPreview && result.contentPreview.length > 0 && (
                <div className="space-y-4">
                  <div className="text-sm text-gray-600 mb-3">
                    Sample content from the first {result.contentPreview.length} pages:
                  </div>
                  {result.contentPreview.map((page, index) => (
                    <div key={index} className="bg-gray-50 border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-900 truncate">{page.title || 'Untitled'}</h4>
                        <span className="text-xs text-gray-500">{page.chunksCount} chunks</span>
                      </div>
                      <p className="text-xs text-blue-600 mb-2 truncate">{page.url}</p>
                      <p className="text-gray-700 text-sm leading-relaxed">{page.preview}</p>
                    </div>
                  ))}
                  <div className="text-xs text-gray-500">
                    Total pages with content: {result.contentPreview.length} / {result.totalPagesScraped}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Details Card */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scraping Details</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {result.domain ? 'Domain' : 'Page Title'}
                </label>
                <p className="text-gray-900">{result.domain || result.title}</p>
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

              {result.metadata?.contentHash && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Content Hash</label>
                  <p className="text-gray-600 font-mono text-sm">{result.metadata.contentHash}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scraped At</label>
                <p className="text-gray-600">{new Date(result.timestamp).toLocaleString()}</p>
              </div>
              
              {/* Show errors if any */}
              {result.errors && result.errors.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-red-700 mb-1">
                    Errors ({result.errors.length})
                  </label>
                  <div className="space-y-1">
                    {result.errors.slice(0, 3).map((error, index) => (
                      <p key={index} className="text-red-600 text-xs">
                        {error.url}: {error.error}
                      </p>
                    ))}
                    {result.errors.length > 3 && (
                      <p className="text-red-500 text-xs">... and {result.errors.length - 3} more errors</p>
                    )}
                  </div>
                </div>
              )}
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
              <p>Our advanced external scraping service extracts and processes the content with professional-grade capabilities</p>
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