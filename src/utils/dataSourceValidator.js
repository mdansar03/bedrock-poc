const logger = require('./logger');

/**
 * Data Source Validation Utility
 * Validates and normalizes data sources from frontend selection against available knowledge base sources
 */
class DataSourceValidator {
  constructor() {
    // Keep a reference to data management service for validation
    this.dataManagementService = null;
  }

  /**
   * Set the data management service instance
   * @param {DataManagementService} service - Data management service instance
   */
  setDataManagementService(service) {
    this.dataManagementService = service;
  }

  /**
   * Validate and normalize data sources from frontend selection
   * @param {Object} dataSources - Raw data sources from frontend
   * @param {Array} dataSources.websites - Array of website domains
   * @param {Array} dataSources.pdfs - Array of PDF file names
   * @param {Array} dataSources.documents - Array of document file names
   * @returns {Promise<Object>} - Validated data sources and warnings
   */
  async validateDataSources(dataSources) {
    if (!dataSources) {
      return { validatedDataSources: null, warnings: [], sourceCount: 0 };
    }

    // If no data management service is set, skip validation but allow the data sources through
    if (!this.dataManagementService) {
      logger.warn('Data management service not set, skipping validation');
      return { 
        validatedDataSources: dataSources, 
        warnings: ['Data source validation skipped - service not available'], 
        sourceCount: this.countDataSources(dataSources)
      };
    }

    const warnings = [];
    const validated = {};
    let totalSources = 0;

    try {
      // Get available data sources from knowledge base
      const availableSources = await this.dataManagementService.getAllDomainsSummary();
      
      // Validate websites
      if (dataSources.websites && Array.isArray(dataSources.websites) && dataSources.websites.length > 0) {
        const availableWebsites = availableSources.dataSources?.websites?.items?.map(w => w.domain) || [];
        const validWebsites = dataSources.websites.filter(site => {
          const isValid = availableWebsites.includes(site);
          if (!isValid) {
            warnings.push(`Website "${site}" not found in knowledge base`);
          }
          return isValid;
        });
        
        if (validWebsites.length > 0) {
          validated.websites = validWebsites;
          totalSources += validWebsites.length;
          logger.info(`Validated ${validWebsites.length} website sources:`, validWebsites);
        }
      }

      // Validate PDFs  
      if (dataSources.pdfs && Array.isArray(dataSources.pdfs) && dataSources.pdfs.length > 0) {
        const availablePdfs = availableSources.dataSources?.pdfs?.items?.map(p => p.fileName) || [];
        const validPdfs = dataSources.pdfs.filter(pdf => {
          const isValid = availablePdfs.includes(pdf);
          if (!isValid) {
            warnings.push(`PDF "${pdf}" not found in knowledge base`);
          }
          return isValid;
        });
        
        if (validPdfs.length > 0) {
          validated.pdfs = validPdfs;
          totalSources += validPdfs.length;
          logger.info(`Validated ${validPdfs.length} PDF sources:`, validPdfs);
        }
      }

      // Validate documents
      if (dataSources.documents && Array.isArray(dataSources.documents) && dataSources.documents.length > 0) {
        const availableDocs = availableSources.dataSources?.documents?.items?.map(d => d.fileName) || [];
        const validDocs = dataSources.documents.filter(doc => {
          const isValid = availableDocs.includes(doc);
          if (!isValid) {
            warnings.push(`Document "${doc}" not found in knowledge base`);
          }
          return isValid;
        });
        
        if (validDocs.length > 0) {
          validated.documents = validDocs;
          totalSources += validDocs.length;
          logger.info(`Validated ${validDocs.length} document sources:`, validDocs);
        }
      }

      // Check if no valid sources were found
      if (totalSources === 0 && this.countDataSources(dataSources) > 0) {
        warnings.push('No valid data sources found in knowledge base. All selected sources will be ignored.');
      }

      return { 
        validatedDataSources: totalSources > 0 ? validated : null, 
        warnings,
        sourceCount: totalSources,
        originalCount: this.countDataSources(dataSources)
      };

    } catch (error) {
      logger.error('Data source validation failed:', error);
      warnings.push(`Data source validation failed: ${error.message}`);
      
      // Return original data sources as fallback
      return { 
        validatedDataSources: dataSources, 
        warnings, 
        sourceCount: this.countDataSources(dataSources),
        validationError: true
      };
    }
  }

  /**
   * Count total number of data sources in an object
   * @param {Object} dataSources - Data sources object
   * @returns {number} - Total count of data sources
   */
  countDataSources(dataSources) {
    if (!dataSources) return 0;
    
    let count = 0;
    if (dataSources.websites) count += dataSources.websites.length;
    if (dataSources.pdfs) count += dataSources.pdfs.length;
    if (dataSources.documents) count += dataSources.documents.length;
    
    return count;
  }

  /**
   * Validate data source format and structure
   * @param {Object} dataSources - Data sources to validate
   * @returns {Array} - Array of validation errors
   */
  validateDataSourceFormat(dataSources) {
    const errors = [];
    
    if (!dataSources || typeof dataSources !== 'object') {
      return ['Data sources must be an object'];
    }

    // Validate websites array
    if (dataSources.websites !== undefined) {
      if (!Array.isArray(dataSources.websites)) {
        errors.push('Websites must be an array');
      } else {
        dataSources.websites.forEach((website, index) => {
          if (typeof website !== 'string') {
            errors.push(`Website at index ${index} must be a string`);
          }
        });
      }
    }

    // Validate PDFs array
    if (dataSources.pdfs !== undefined) {
      if (!Array.isArray(dataSources.pdfs)) {
        errors.push('PDFs must be an array');
      } else {
        dataSources.pdfs.forEach((pdf, index) => {
          if (typeof pdf !== 'string') {
            errors.push(`PDF at index ${index} must be a string`);
          }
        });
      }
    }

    // Validate documents array
    if (dataSources.documents !== undefined) {
      if (!Array.isArray(dataSources.documents)) {
        errors.push('Documents must be an array');
      } else {
        dataSources.documents.forEach((document, index) => {
          if (typeof document !== 'string') {
            errors.push(`Document at index ${index} must be a string`);
          }
        });
      }
    }

    return errors;
  }
}

// Create a singleton instance
const dataSourceValidator = new DataSourceValidator();

module.exports = dataSourceValidator;


