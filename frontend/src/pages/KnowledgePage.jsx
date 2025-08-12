import React, { useState, useEffect } from 'react'
import { Upload, Globe, CheckCircle, AlertCircle, Clock, ExternalLink, FileText, Wifi, WifiOff, Plus, X } from 'lucide-react'
import { scrapingAPI, filesAPI } from '../utils/api'

const KnowledgePage = () => {
  const [activeTab, setActiveTab] = useState('upload') // 'upload' or 'scrape'
  
  // File Upload State
  const [files, setFiles] = useState([])
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  
  // URL Scraping State
  const [url, setUrl] = useState('')
  const [scrapingLoading, setScrapingLoading] = useState(false)
  const [scrapingResult, setScrapingResult] = useState(null)
  const [scrapingError, setScrapingError] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [currentJobId, setCurrentJobId] = useState(null)
  const [serviceHealth, setServiceHealth] = useState({ available: true, checking: true })
  const [scrapingMode, setScrapingMode] = useState('single')
  const [crawlOptions, setCrawlOptions] = useState({
    maxPages: 1000,
    delay: 3000,
    followExternalLinks: false,
    batchSize: 3,
    deepExtraction: true
  })

  // Check service health on component mount
  useEffect(() => {
    checkServiceHealth()
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

  // File Upload Handlers
  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files)
    setFiles(prev => [...prev, ...selectedFiles])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    setFiles(prev => [...prev, ...droppedFiles])
  }

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleFileUpload = async () => {
    if (files.length === 0) {
      setUploadError('Please select at least one file')
      return
    }

    setUploadLoading(true)
    setUploadError(null)
    setUploadResult(null)

    try {
      const formData = new FormData()
      files.forEach(file => {
        formData.append('files', file)
      })

      const result = await filesAPI.uploadFiles(formData)

      if (result.success) {
        setUploadResult(result.data)
        setFiles([])
      } else {
        setUploadError(result.error || 'Upload failed')
      }
    } catch (error) {
      setUploadError(error.response?.data?.message || error.message || 'Upload failed')
    } finally {
      setUploadLoading(false)
    }
  }

  // URL Scraping Handlers
  const sanitizeUrl = (url) => {
    if (!url || typeof url !== 'string') return ''
    
    let cleanUrl = url.trim()
    cleanUrl = cleanUrl.replace(/^[@#]+/, '')
    
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

  const handleUrlSubmit = async (e) => {
    e.preventDefault()
    
    if (!url) {
      setScrapingError('Please enter a valid URL')
      return
    }

    setScrapingLoading(true)
    setScrapingError(null)
    setScrapingResult(null)
    setJobStatus(null)
    setCurrentJobId(null)

    try {
      const cleanUrl = sanitizeUrl(url)
      
      if (scrapingMode === 'crawl') {
        const startResponse = await scrapingAPI.startAsyncCrawl(cleanUrl, crawlOptions)
        const jobId = startResponse.data.jobId
        
        setCurrentJobId(jobId)
        setJobStatus({
          status: 'pending',
          message: 'Starting crawl job...',
          percentage: 0
        })

        const result = await scrapingAPI.pollCrawlCompletion(jobId, (progressData) => {
          setJobStatus({
            status: progressData.status,
            message: progressData.progress?.message || `Status: ${progressData.status}`,
            percentage: progressData.progress?.percentage || 0,
            phase: progressData.progress?.phase
          })
        })
        
        setScrapingResult(result.data)
      } else {
        const response = await scrapingAPI.scrapeWebsite(cleanUrl)
        setScrapingResult(response.data)
      }
      
    } catch (error) {
      console.error('Scraping error:', error)
      setScrapingError(error.response?.data?.message || error.message || 'Failed to scrape website')
    } finally {
      setScrapingLoading(false)
      setJobStatus(null)
      setCurrentJobId(null)
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
              <span className="text-white font-bold text-sm">K</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Knowledge Base</h1>
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
          Add content to your knowledge base by uploading documents or scraping websites.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-8">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'upload'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Upload size={18} />
                <span>Upload Documents</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('scrape')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'scrape'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Globe size={18} />
                <span>Scrape Websites</span>
              </div>
            </button>
          </nav>
        </div>
      </div>

      {/* File Upload Tab */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          {/* Upload Area */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Documents</h3>
            
            {/* Drag & Drop Area */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragOver
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                Drag and drop files here, or click to browse
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Supports PDF, DOCX, TXT, MD, CSV, XLSX files up to 50MB each
              </p>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.rtf"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="btn-primary cursor-pointer inline-flex items-center space-x-2"
              >
                <Plus size={18} />
                <span>Select Files</span>
              </label>
            </div>

            {/* Selected Files */}
            {files.length > 0 && (
              <div className="mt-6">
                <h4 className="text-md font-medium text-gray-900 mb-3">
                  Selected Files ({files.length})
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{file.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeFile(index)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleFileUpload}
                    disabled={uploadLoading}
                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload size={18} className="mr-2" />
                        Upload Files
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Upload Results */}
          {uploadError && (
            <div className="card border-red-200 bg-red-50">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-medium text-red-800 mb-1">Upload Failed</h3>
                  <p className="text-sm text-red-700">{uploadError}</p>
                </div>
              </div>
            </div>
          )}

          {uploadResult && (
            <div className="card border-green-200 bg-green-50">
              <div className="flex items-start">
                <CheckCircle className="w-6 h-6 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-green-800 mb-2">Files Uploaded Successfully!</h3>
                  <p className="text-green-700 mb-4">
                    {uploadResult.successfulFiles} of {uploadResult.totalFiles} files processed and added to your knowledge base.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="bg-white rounded-lg p-3">
                      <div className="font-medium text-gray-900">Files Processed</div>
                      <div className="text-2xl font-bold text-green-600">{uploadResult.successfulFiles}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="font-medium text-gray-900">Total Chunks</div>
                      <div className="text-2xl font-bold text-green-600">{uploadResult.totalChunks}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="font-medium text-gray-900">Content Length</div>
                      <div className="text-sm text-gray-600">{uploadResult.totalContentLength} chars</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Website Scraping Tab */}
      {activeTab === 'scrape' && (
        <div className="space-y-6">
          {/* Service Status Alert */}
          {!serviceHealth.checking && !serviceHealth.available && (
            <div className="card border-red-200 bg-red-50">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mr-2 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-red-800 font-medium">External Scraping Service Unavailable</p>
                  <p className="text-sm text-red-700 mt-1">
                    The external scraping service is currently offline. Please try again later.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Scraping Form */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scrape Website Content</h3>
            
            <form onSubmit={handleUrlSubmit} className="space-y-6">
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
                        <h4 className="font-medium text-gray-900">Single Page</h4>
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
                        <h4 className="font-medium text-gray-900">Full Website Crawl</h4>
                        <p className="text-sm text-gray-600">Discover and scrape all pages</p>
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
                        Max Pages
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
                        disabled={scrapingLoading}
                      />
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
                        disabled={scrapingLoading}
                      />
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
                        disabled={scrapingLoading}
                      >
                        <option value={1}>1 (Slowest)</option>
                        <option value={2}>2 (Conservative)</option>
                        <option value={3}>3 (Balanced)</option>
                        <option value={5}>5 (Aggressive)</option>
                      </select>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="followExternalLinks"
                          checked={crawlOptions.followExternalLinks}
                          onChange={(e) => setCrawlOptions(prev => ({
                            ...prev,
                            followExternalLinks: e.target.checked
                          }))}
                          className="mr-2"
                          disabled={scrapingLoading}
                        />
                        <label htmlFor="followExternalLinks" className="text-sm text-gray-700">
                          External links
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
                          disabled={scrapingLoading}
                        />
                        <label htmlFor="deepExtraction" className="text-sm text-gray-700">
                          Deep extraction
                        </label>
                      </div>
                    </div>
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
                      inputUrl = inputUrl.replace(/[@]/g, '')
                      setUrl(inputUrl)
                    }}
                    placeholder="https://example.com"
                    className="input-field flex-1"
                    disabled={scrapingLoading}
                  />
                  <button
                    type="submit"
                    disabled={scrapingLoading || !url || !isValidUrl(url) || !serviceHealth.available}
                    className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {scrapingLoading ? (
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
                
                {!isValidUrl(url) && url && (
                  <p className="text-sm text-red-600 mt-1">Please enter a valid URL starting with http:// or https://</p>
                )}
              </div>
            </form>
          </div>

          {/* Scraping Progress */}
          {scrapingLoading && (
            <div className="card">
              <div className="flex items-center justify-center py-8">
                <div className="text-center w-full max-w-md">
                  <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    {scrapingMode === 'crawl' ? 'Crawling Website' : 'Scraping Website'}
                  </h3>
                  
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
                      </div>
                    </div>
                  )}
                  
                  <p className="text-gray-600">
                    {scrapingMode === 'crawl' 
                      ? 'This may take several minutes while we discover and scrape all pages.'
                      : 'Processing the content...'
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Scraping Results */}
          {scrapingError && (
            <div className="card border-red-200 bg-red-50">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-medium text-red-800 mb-1">Scraping Failed</h3>
                  <p className="text-sm text-red-700">{scrapingError}</p>
                </div>
              </div>
            </div>
          )}

          {scrapingResult && (
            <div className="card border-green-200 bg-green-50">
              <div className="flex items-start">
                <CheckCircle className="w-6 h-6 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-green-800 mb-2">Website Scraped Successfully!</h3>
                  <p className="text-green-700 mb-4">
                    Content has been extracted and added to your knowledge base.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="bg-white rounded-lg p-3">
                      <div className="font-medium text-gray-900">
                        {scrapingResult.summary?.pagesScraped ? 'Pages Scraped' : 'Chunks Extracted'}
                      </div>
                      <div className="text-2xl font-bold text-green-600">
                        {scrapingResult.summary?.pagesScraped || scrapingResult.totalPagesScraped || scrapingResult.chunksExtracted}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="font-medium text-gray-900">
                        {scrapingResult.totalChunks ? 'Total Chunks' : 'Processing Time'}
                      </div>
                      <div className={scrapingResult.totalChunks ? "text-2xl font-bold text-green-600" : "text-sm text-gray-600 flex items-center"}>
                        {scrapingResult.totalChunks ? (
                          scrapingResult.totalChunks
                        ) : (
                          <>
                            <Clock size={14} className="mr-1" />
                            {new Date(scrapingResult.timestamp).toLocaleTimeString()}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="font-medium text-gray-900">
                        {scrapingResult.successRate ? 'Success Rate' : 'Status'}
                      </div>
                      <div className="text-sm text-green-600 font-medium">
                        {scrapingResult.successRate || 'Ready for Chat'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Next Steps */}
      {(uploadResult || scrapingResult) && (
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
      )}

      {/* Instructions */}
      {!uploadLoading && !scrapingLoading && !uploadResult && !scrapingResult && !uploadError && !scrapingError && (
        <div className="card bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">How it works</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                1
              </div>
              <p>Upload documents or enter website URLs to add content to your knowledge base</p>
            </div>
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                2
              </div>
              <p>Content is automatically processed, chunked, and stored in S3 with proper formatting</p>
            </div>
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                3
              </div>
              <p>The system syncs with AWS Bedrock Knowledge Base for vector embeddings</p>
            </div>
            <div className="flex items-start">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-3 mt-0.5 text-xs font-bold">
                4
              </div>
              <p>Chat with our AI about your content using foundation models for intelligent responses</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default KnowledgePage