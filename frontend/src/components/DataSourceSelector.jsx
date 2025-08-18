import React, { useState, useEffect } from 'react';
import { ChevronDown, X, Globe, FileText, File, Filter } from 'lucide-react';
import { dataManagementAPI } from '../utils/api';

const DataSourceSelector = ({ selectedDataSources, onDataSourcesChange, disabled = false }) => {
  const [availableDataSources, setAvailableDataSources] = useState({
    websites: [],
    pdfs: [],
    documents: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetchAvailableDataSources();
  }, []);

  const fetchAvailableDataSources = async () => {
    try {
      setLoading(true);
      const response = await dataManagementAPI.getAvailableDataSources();
      
      if (response.success && response.data) {
        const { dataSources } = response.data;
        setAvailableDataSources({
          websites: dataSources?.websites?.items || [],
          pdfs: dataSources?.pdfs?.items || [],
          documents: dataSources?.documents?.items || []
        });
      }
    } catch (err) {
      console.error('Failed to fetch data sources:', err);
      setError('Failed to load data sources');
    } finally {
      setLoading(false);
    }
  };

  const handleSourceToggle = (type, sourceName) => {
    const currentSources = selectedDataSources[type] || [];
    const isSelected = currentSources.includes(sourceName);
    
    let newSources;
    if (isSelected) {
      newSources = currentSources.filter(s => s !== sourceName);
    } else {
      newSources = [...currentSources, sourceName];
    }
    
    onDataSourcesChange({
      ...selectedDataSources,
      [type]: newSources
    });
  };

  const clearAllFilters = () => {
    onDataSourcesChange({
      websites: [],
      pdfs: [],
      documents: []
    });
  };

  const getSelectedCount = () => {
    return (selectedDataSources.websites?.length || 0) +
           (selectedDataSources.pdfs?.length || 0) +
           (selectedDataSources.documents?.length || 0);
  };

  const hasAnySelection = () => getSelectedCount() > 0;

  const getSourceIcon = (type) => {
    switch (type) {
      case 'websites': return Globe;
      case 'pdfs': return FileText;
      case 'documents': return File;
      default: return File;
    }
  };

  const formatSourceName = (source, type) => {
    if (type === 'websites') {
      return source.domain;
    }
    // Use displayName if available (meaningful name), otherwise fall back to fileName
    return source.displayName || source.originalName || source.fileName;
  };

  const getSourceIdentifier = (source, type) => {
    if (type === 'websites') {
      return source.domain;
    }
    // Use displayName for consistent identification
    return source.displayName || source.fileName;
  };

  const formatSourceSize = (source) => {
    return source.sizeFormatted || '';
  };

  if (loading) {
    return (
      <div className="flex items-center space-x-2 text-sm text-gray-500">
        <Filter size={16} className="animate-pulse" />
        <span>Loading data sources...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center space-x-2 text-sm text-red-500">
        <Filter size={16} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Selected Sources Display */}
      {hasAnySelection() && (
        <div className="mb-3 flex flex-wrap gap-2">
          {selectedDataSources.websites?.map((website) => (
            <span key={`website-${website}`} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              <Globe size={12} className="mr-1" />
              {website}
              <button
                onClick={() => handleSourceToggle('websites', website)}
                className="ml-1 text-blue-600 hover:text-blue-800"
                disabled={disabled}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {selectedDataSources.pdfs?.map((pdf) => (
            <span key={`pdf-${pdf}`} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              <FileText size={12} className="mr-1" />
              {pdf}
              <button
                onClick={() => handleSourceToggle('pdfs', pdf)}
                className="ml-1 text-red-600 hover:text-red-800"
                disabled={disabled}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {selectedDataSources.documents?.map((doc) => (
            <span key={`doc-${doc}`} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <File size={12} className="mr-1" />
              {doc}
              <button
                onClick={() => handleSourceToggle('documents', doc)}
                className="ml-1 text-green-600 hover:text-green-800"
                disabled={disabled}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
            disabled={disabled}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Dropdown Toggle */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={disabled}
          className="flex items-center justify-between w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center space-x-2">
            <Filter size={16} className="text-gray-500" />
            <span>
              {hasAnySelection() 
                ? `${getSelectedCount()} data source${getSelectedCount() > 1 ? 's' : ''} selected`
                : 'Filter by data sources'
              }
            </span>
          </div>
          <ChevronDown size={16} className={`text-gray-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown Menu */}
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-96 overflow-y-auto">
            {/* Websites Section */}
            {availableDataSources.websites.length > 0 && (
              <div className="p-3 border-b border-gray-200">
                <div className="flex items-center space-x-2 mb-2">
                  <Globe size={16} className="text-blue-600" />
                  <h4 className="text-sm font-medium text-gray-900">Websites</h4>
                  <span className="text-xs text-gray-500">({availableDataSources.websites.length})</span>
                </div>
                <div className="space-y-1">
                  {availableDataSources.websites.map((website) => (
                    <label key={`website-${website.domain}`} className="flex items-center space-x-2 text-sm hover:bg-gray-50 p-1 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDataSources.websites?.includes(website.domain) || false}
                        onChange={() => handleSourceToggle('websites', website.domain)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        disabled={disabled}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-900 truncate">{website.domain}</span>
                          <span className="text-xs text-gray-500 ml-2">{formatSourceSize(website)}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {website.files} file{website.files > 1 ? 's' : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* PDFs Section */}
            {availableDataSources.pdfs.length > 0 && (
              <div className="p-3 border-b border-gray-200">
                <div className="flex items-center space-x-2 mb-2">
                  <FileText size={16} className="text-red-600" />
                  <h4 className="text-sm font-medium text-gray-900">PDF Documents</h4>
                  <span className="text-xs text-gray-500">({availableDataSources.pdfs.length})</span>
                </div>
                <div className="space-y-1">
                  {availableDataSources.pdfs.map((pdf) => {
                    const sourceId = getSourceIdentifier(pdf, 'pdfs');
                    return (
                      <label key={`pdf-${sourceId}`} className="flex items-center space-x-2 text-sm hover:bg-gray-50 p-1 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedDataSources.pdfs?.includes(sourceId) || false}
                          onChange={() => handleSourceToggle('pdfs', sourceId)}
                          className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                          disabled={disabled}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-900 truncate">{formatSourceName(pdf, 'pdfs')}</span>
                            <span className="text-xs text-gray-500 ml-2">{formatSourceSize(pdf)}</span>
                          </div>
                          <div className="text-xs text-gray-500">PDF</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Documents Section */}
            {availableDataSources.documents.length > 0 && (
              <div className="p-3">
                <div className="flex items-center space-x-2 mb-2">
                  <File size={16} className="text-green-600" />
                  <h4 className="text-sm font-medium text-gray-900">Documents</h4>
                  <span className="text-xs text-gray-500">({availableDataSources.documents.length})</span>
                </div>
                <div className="space-y-1">
                  {availableDataSources.documents.map((doc) => {
                    const sourceId = getSourceIdentifier(doc, 'documents');
                    return (
                      <label key={`doc-${sourceId}`} className="flex items-center space-x-2 text-sm hover:bg-gray-50 p-1 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedDataSources.documents?.includes(sourceId) || false}
                          onChange={() => handleSourceToggle('documents', sourceId)}
                          className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                          disabled={disabled}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-900 truncate">{formatSourceName(doc, 'documents')}</span>
                            <span className="text-xs text-gray-500 ml-2">{formatSourceSize(doc)}</span>
                          </div>
                          <div className="text-xs text-gray-500">{doc.type?.toUpperCase() || 'DOC'}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No Data Sources Message */}
            {availableDataSources.websites.length === 0 && 
             availableDataSources.pdfs.length === 0 && 
             availableDataSources.documents.length === 0 && (
              <div className="p-4 text-center text-gray-500">
                <Filter size={24} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No data sources available</p>
                <p className="text-xs">Upload documents or scrape websites to see filtering options</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Click outside handler */}
      {showDropdown && (
        <div 
          className="fixed inset-0 z-5" 
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
};

export default DataSourceSelector;
