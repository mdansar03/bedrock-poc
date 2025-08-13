import React, { useState, useEffect } from 'react'
import { Database, Globe, Calendar, FileText, Search, Trash2, Eye, ExternalLink, RefreshCw, Filter, Download, AlertTriangle } from 'lucide-react'
import { dataManagementAPI } from '../utils/api'

const DataViewerPage = () => {
  const [domains, setDomains] = useState([])
  const [selectedDomain, setSelectedDomain] = useState(null)
  const [domainDocuments, setDomainDocuments] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState('domains') // 'domains' or 'documents'
  const [error, setError] = useState(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingDomain, setDeletingDomain] = useState(null)
  const [deletePreview, setDeletePreview] = useState(null)
  const [expandedUrls, setExpandedUrls] = useState(new Set())

  useEffect(() => {
    loadDomains()
  }, [])

  const loadDomains = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await dataManagementAPI.getDomains()
      if (response.success) {
        setDomains(response.data?.domains || [])
      } else {
        setError('Failed to load domains')
      }
    } catch (error) {
      console.error('Error loading domains:', error)
      setError(error.response?.data?.message || error.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const loadDomainDocuments = async (domain) => {
    try {
      setLoading(true)
      setError(null)
      const response = await dataManagementAPI.getDocumentsByDomain(domain)
      if (response.success) {
        setDomainDocuments(response.data)
        setSelectedDomain(domain)
        setViewMode('documents')
      } else {
        setError(`Failed to load documents for ${domain}`)
      }
    } catch (error) {
      console.error('Error loading domain documents:', error)
      setError(error.response?.data?.message || error.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteDomain = async (domain) => {
    try {
      // Get deletion preview first
      const preview = await dataManagementAPI.getDomainDeletionPreview(domain)
      setDeletePreview(preview.data)
      setDeletingDomain(domain)
      setDeleteDialogOpen(true)
    } catch (error) {
      setError(error.response?.data?.message || error.message || 'Failed to get deletion preview')
    }
  }

  const confirmDelete = async () => {
    try {
      setLoading(true)
      await dataManagementAPI.deleteDomainData(deletingDomain, { confirm: deletingDomain })
      setDeleteDialogOpen(false)
      setDeletingDomain(null)
      setDeletePreview(null)
      // Refresh domains list
      await loadDomains()
      // If we were viewing this domain, go back to domains view
      if (selectedDomain === deletingDomain) {
        setSelectedDomain(null)
        setDomainDocuments(null)
        setViewMode('domains')
      }
    } catch (error) {
      setError(error.response?.data?.message || error.message || 'Failed to delete domain data')
    } finally {
      setLoading(false)
    }
  }

  const toggleUrlExpansion = (url) => {
    const newExpanded = new Set(expandedUrls)
    if (newExpanded.has(url)) {
      newExpanded.delete(url)
    } else {
      newExpanded.add(url)
    }
    setExpandedUrls(newExpanded)
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const filteredDomains = domains.filter(domain =>
    domain.domain?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    domain.totalFiles?.toString().includes(searchTerm) ||
    domain.totalSize?.toString().includes(searchTerm)
  )

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center mr-3">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Data Viewer</h1>
              <p className="text-gray-600 mt-1">Browse and manage your scraped content</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={loadDomains}
              disabled={loading}
              className="btn-secondary flex items-center space-x-2"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            
            {viewMode === 'documents' && (
              <button
                onClick={() => {
                  setViewMode('domains')
                  setSelectedDomain(null)
                  setDomainDocuments(null)
                }}
                className="btn-primary"
              >
                Back to Domains
              </button>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center space-x-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={viewMode === 'domains' ? "Search domains..." : "Search documents..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field pl-10"
            />
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <Filter size={16} />
            <span>
              {viewMode === 'domains' 
                ? `${filteredDomains.length} domains` 
                : `${domainDocuments?.summary?.rawContentFiles || 0} documents`
              }
            </span>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="card border-red-200 bg-red-50 mb-6">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800 mb-1">Error</h3>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="card">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600">Loading your data...</p>
            </div>
          </div>
        </div>
      )}

      {/* Domains View */}
      {!loading && viewMode === 'domains' && (
        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="card text-center">
              <div className="text-2xl font-bold text-purple-600">
                {domains.length}
              </div>
              <div className="text-sm text-gray-600">Total Domains</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-blue-600">
                {domains.reduce((sum, d) => sum + (d.totalFiles || 0), 0)}
              </div>
              <div className="text-sm text-gray-600">Total Files</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-green-600">
                {formatFileSize(domains.reduce((sum, d) => sum + (d.totalSize || 0), 0))}
              </div>
              <div className="text-sm text-gray-600">Total Size</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-orange-600">
                {domains.filter(d => d.lastScraped && 
                  new Date(d.lastScraped) > new Date(Date.now() - 24 * 60 * 60 * 1000)).length}
              </div>
              <div className="text-sm text-gray-600">Recent (24h)</div>
            </div>
          </div>

          {/* Domains List */}
          {filteredDomains.length === 0 ? (
            <div className="card text-center py-12">
              <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Data Found</h3>
              <p className="text-gray-600 mb-4">
                {searchTerm 
                  ? 'No domains match your search criteria.'
                  : 'No websites have been scraped yet.'
                }
              </p>
              {!searchTerm && (
                <a href="/knowledge" className="btn-primary">
                  Start Scraping Websites
                </a>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredDomains.map((domain, index) => (
                <div key={index} className="card hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Globe className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 text-lg">
                          {domain.domain}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {domain.totalFiles || 0} files • {formatFileSize(domain.totalSize)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => loadDomainDocuments(domain.domain)}
                        className="p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="View Documents"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteDomain(domain.domain)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Domain Data"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Last Scraped:</span>
                      <span className="font-medium">
                        {domain.lastScraped ? formatDate(domain.lastScraped) : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">File Types:</span>
                      <span className="font-medium">
                        {domain.fileTypes?.join(', ') || 'HTML'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <button
                      onClick={() => loadDomainDocuments(domain.domain)}
                      className="w-full btn-primary text-sm py-2"
                    >
                      View {domain.totalFiles || 0} Documents
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Documents View */}
      {!loading && viewMode === 'documents' && domainDocuments && (
        <div className="space-y-6">
          {/* Domain Header */}
          <div className="card bg-purple-50 border-purple-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center">
                  <Globe className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedDomain}</h2>
                  <p className="text-purple-700">
                    {domainDocuments.summary?.rawContentFiles || 0} documents • 
                    {domainDocuments.summary?.processedChunks || 0} chunks processed
                  </p>
                </div>
              </div>
              <a
                href={`https://${selectedDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary flex items-center space-x-2"
              >
                <ExternalLink size={16} />
                <span>Visit Site</span>
              </a>
            </div>
          </div>

          {/* Document Categories */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Raw Content */}
            <div className="card">
              <div className="flex items-center space-x-2 mb-4">
                <FileText className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Raw Content</h3>
              </div>
              <div className="text-2xl font-bold text-blue-600 mb-2">
                {domainDocuments.documents?.rawContent?.length || 0}
              </div>
              <p className="text-sm text-gray-600">Original scraped files</p>
            </div>

            {/* Processed Chunks */}
            <div className="card">
              <div className="flex items-center space-x-2 mb-4">
                <Database className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-gray-900">Processed Chunks</h3>
              </div>
              <div className="text-2xl font-bold text-green-600 mb-2">
                {domainDocuments.documents?.processedChunks?.length || 0}
              </div>
              <p className="text-sm text-gray-600">AI-ready content chunks</p>
            </div>

            {/* Formatted Documents */}
            <div className="card">
              <div className="flex items-center space-x-2 mb-4">
                <Calendar className="w-5 h-5 text-purple-600" />
                <h3 className="font-semibold text-gray-900">KB Documents</h3>
              </div>
              <div className="text-2xl font-bold text-purple-600 mb-2">
                {domainDocuments.documents?.formattedDocuments?.length || 0}
              </div>
              <p className="text-sm text-gray-600">Knowledge base ready</p>
            </div>
          </div>

          {/* Raw Content Details */}
          {domainDocuments.documents?.rawContent?.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Scraped Pages</h3>
              <div className="space-y-3">
                {domainDocuments.documents.rawContent.map((doc, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 mb-1">
                          {doc.title || 'Untitled Document'}
                        </h4>
                        <p className="text-sm text-gray-600 mb-2">
                          {doc.sourceUrl || `File: ${doc.Key}`}
                        </p>
                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                          <span>Size: {formatFileSize(doc.Size)}</span>
                          <span>Modified: {formatDate(doc.LastModified)}</span>
                          {doc.contentId && <span>ID: {doc.contentId}</span>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {doc.sourceUrl && (
                          <a
                            href={doc.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Visit Original Page"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => toggleUrlExpansion(doc.Key)}
                          className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                          title="View Details"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    </div>
                    
                    {expandedUrls.has(doc.Key) && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="bg-gray-50 rounded p-3">
                          <p className="text-xs text-gray-600 font-mono">
                            S3 Path: {doc.Key}
                          </p>
                          {doc.metadata && (
                            <div className="mt-2 text-xs text-gray-600">
                              <strong>Metadata:</strong>
                              <pre className="mt-1 whitespace-pre-wrap">
                                {JSON.stringify(doc.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {domainDocuments.documents?.rawContent?.length === 0 && (
            <div className="card text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Documents Found</h3>
              <p className="text-gray-600">No scraped content found for this domain.</p>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Delete Domain Data</h3>
                <p className="text-sm text-gray-600">This action cannot be undone</p>
              </div>
            </div>
            
            <div className="mb-6">
              <p className="text-gray-700 mb-4">
                Are you sure you want to delete all data for <strong>{deletingDomain}</strong>?
              </p>
              
              {deletePreview && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <h4 className="font-medium text-red-800 mb-2">Files to be deleted:</h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    <li>• {deletePreview.summary?.filesToDelete || 0} raw content files</li>
                    <li>• {deletePreview.summary?.chunksToDelete || 0} processed chunks</li>
                    <li>• {deletePreview.summary?.documentsToDelete || 0} formatted documents</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setDeleteDialogOpen(false)
                  setDeletingDomain(null)
                  setDeletePreview(null)
                }}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete All Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DataViewerPage