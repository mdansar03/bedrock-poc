const { S3Client, ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockAgentClient, StartIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
const logger = require('../utils/logger');

class DataManagementService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });

    this.bedrockAgent = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });

    this.bucket = process.env.BEDROCK_S3_BUCKET;
    this.knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    this.dataSourceId = process.env.BEDROCK_DATA_SOURCE_ID;
  }

  /**
   * List all documents for a specific domain
   * @param {string} domain - Domain to list documents for
   * @returns {Promise<Object>} - Documents information
   */
  async listDocumentsByDomain(domain) {
    try {
      logger.info(`Listing documents for domain: ${domain}`);

      const documents = {
        rawContent: [],
        processedChunks: [],
        formattedDocuments: [],
        metadata: []
      };

      // Search for raw content files
      const rawContentPrefix = `raw-content/web-scrapes/${domain}/`;
      const rawFiles = await this.listS3Objects(rawContentPrefix);
      documents.rawContent = rawFiles;

      // Search for processed chunks
      const chunksPrefix = `processed-chunks/web-content/`;
      const chunkFiles = await this.listS3Objects(chunksPrefix);
      
      // Filter chunks by domain (need to check content since domain isn't in path)
      for (const chunk of chunkFiles) {
        try {
          const content = await this.getS3Object(chunk.Key);
          const chunkData = JSON.parse(content);
          const chunkDomain = chunkData.source_url ? new URL(chunkData.source_url).hostname : null;
          
          if (chunkDomain === domain) {
            documents.processedChunks.push({
              ...chunk,
              documentId: chunkData.document_id,
              sourceUrl: chunkData.source_url,
              title: chunkData.title
            });
          }
        } catch (error) {
          logger.warn(`Failed to parse chunk file ${chunk.Key}:`, error.message);
        }
      }

      // Search for formatted documents
      const documentsPrefix = `documents/`;
      const docFiles = await this.listS3Objects(documentsPrefix);
      
      // Filter documents by domain using metadata
      for (const doc of docFiles) {
        if (doc.Metadata && doc.Metadata.domain === domain) {
          documents.formattedDocuments.push(doc);
        }
      }

      // Search for metadata files
      const metadataPrefix = `metadata/${domain}/`;
      const metadataFiles = await this.listS3Objects(metadataPrefix);
      documents.metadata = metadataFiles;

      const totalFiles = documents.rawContent.length + 
                        documents.processedChunks.length + 
                        documents.formattedDocuments.length + 
                        documents.metadata.length;

      logger.info(`Found ${totalFiles} files for domain ${domain}`, {
        rawContent: documents.rawContent.length,
        processedChunks: documents.processedChunks.length,
        formattedDocuments: documents.formattedDocuments.length,
        metadata: documents.metadata.length
      });

      return {
        domain,
        totalFiles,
        documents,
        summary: {
          rawContentFiles: documents.rawContent.length,
          processedChunks: documents.processedChunks.length,
          formattedDocuments: documents.formattedDocuments.length,
          metadataFiles: documents.metadata.length
        }
      };

    } catch (error) {
      logger.error(`Error listing documents for domain ${domain}:`, error);
      throw new Error(`Failed to list documents: ${error.message}`);
    }
  }

  /**
   * List all documents for a specific URL
   * @param {string} url - URL to list documents for
   * @returns {Promise<Object>} - Documents information
   */
  async listDocumentsByUrl(url) {
    try {
      const domain = new URL(url).hostname;
      logger.info(`Listing documents for URL: ${url} (domain: ${domain})`);

      const documents = {
        rawContent: [],
        processedChunks: [],
        formattedDocuments: []
      };

      // Search for raw content files
      const rawContentPrefix = `raw-content/web-scrapes/${domain}/`;
      const rawFiles = await this.listS3Objects(rawContentPrefix);
      
      // Filter by URL
      for (const file of rawFiles) {
        try {
          const content = await this.getS3Object(file.Key);
          const fileData = JSON.parse(content);
          if (fileData.source_url === url) {
            documents.rawContent.push({
              ...file,
              contentId: fileData.content_id,
              sourceUrl: fileData.source_url,
              title: fileData.title
            });
          }
        } catch (error) {
          logger.warn(`Failed to parse raw file ${file.Key}:`, error.message);
        }
      }

      // Search for processed chunks
      const chunksPrefix = `processed-chunks/web-content/`;
      const chunkFiles = await this.listS3Objects(chunksPrefix);
      
      for (const chunk of chunkFiles) {
        try {
          const content = await this.getS3Object(chunk.Key);
          const chunkData = JSON.parse(content);
          if (chunkData.source_url === url) {
            documents.processedChunks.push({
              ...chunk,
              documentId: chunkData.document_id,
              sourceUrl: chunkData.source_url,
              title: chunkData.title,
              chunkIndex: chunkData.chunk_index
            });
          }
        } catch (error) {
          logger.warn(`Failed to parse chunk file ${chunk.Key}:`, error.message);
        }
      }

      // Search for formatted documents by metadata
      const documentsPrefix = `documents/`;
      const docFiles = await this.listS3Objects(documentsPrefix);
      
      for (const doc of docFiles) {
        if (doc.Metadata && doc.Metadata.url === url) {
          documents.formattedDocuments.push(doc);
        }
      }

      const totalFiles = documents.rawContent.length + 
                        documents.processedChunks.length + 
                        documents.formattedDocuments.length;

      logger.info(`Found ${totalFiles} files for URL ${url}`);

      return {
        url,
        domain,
        totalFiles,
        documents,
        summary: {
          rawContentFiles: documents.rawContent.length,
          processedChunks: documents.processedChunks.length,
          formattedDocuments: documents.formattedDocuments.length
        }
      };

    } catch (error) {
      logger.error(`Error listing documents for URL ${url}:`, error);
      throw new Error(`Failed to list documents: ${error.message}`);
    }
  }

  /**
   * Delete all data for a specific domain
   * @param {string} domain - Domain to delete data for
   * @param {Object} options - Deletion options
   * @returns {Promise<Object>} - Deletion result
   */
  async deleteDomainData(domain, options = {}) {
    try {
      const { dryRun = false, syncKnowledgeBase = true } = options;
      
      logger.info(`${dryRun ? 'DRY RUN: ' : ''}Deleting all data for domain: ${domain}`);

      // First, list all documents for this domain
      const domainData = await this.listDocumentsByDomain(domain);
      
      if (domainData.totalFiles === 0) {
        return {
          domain,
          deleted: false,
          reason: 'No files found for this domain',
          filesDeleted: 0
        };
      }

      const filesToDelete = [];

      // Collect all files to delete
      domainData.documents.rawContent.forEach(file => filesToDelete.push(file.Key));
      domainData.documents.processedChunks.forEach(file => filesToDelete.push(file.Key));
      domainData.documents.formattedDocuments.forEach(file => filesToDelete.push(file.Key));
      domainData.documents.metadata.forEach(file => filesToDelete.push(file.Key));

      if (dryRun) {
        logger.info(`DRY RUN: Would delete ${filesToDelete.length} files for domain ${domain}`);
        return {
          domain,
          dryRun: true,
          filesFound: filesToDelete.length,
          filesToDelete: filesToDelete.slice(0, 10), // Show first 10 as preview
          totalFiles: filesToDelete.length
        };
      }

      // Delete files in batches (S3 allows up to 1000 objects per batch)
      const batchSize = 1000;
      let deletedCount = 0;
      const deletionErrors = [];

      for (let i = 0; i < filesToDelete.length; i += batchSize) {
        const batch = filesToDelete.slice(i, i + batchSize);
        
        try {
          await this.deleteS3ObjectsBatch(batch);
          deletedCount += batch.length;
          logger.info(`Deleted batch ${Math.floor(i/batchSize) + 1}, ${batch.length} files`);
        } catch (error) {
          logger.error(`Failed to delete batch starting at ${i}:`, error);
          deletionErrors.push({
            batch: Math.floor(i/batchSize) + 1,
            error: error.message
          });
        }
      }

      // Trigger knowledge base sync if requested
      let syncJobId = null;
      if (syncKnowledgeBase && deletedCount > 0) {
        try {
          const syncResult = await this.triggerKnowledgeBaseSync(domain);
          syncJobId = syncResult.jobId;
        } catch (error) {
          logger.warn(`Failed to trigger knowledge base sync: ${error.message}`);
        }
      }

      logger.info(`Completed deletion for domain ${domain}: ${deletedCount}/${filesToDelete.length} files deleted`);

      return {
        domain,
        deleted: true,
        filesFound: filesToDelete.length,
        filesDeleted: deletedCount,
        deletionErrors: deletionErrors.length > 0 ? deletionErrors : undefined,
        syncJobId,
        success: deletedCount === filesToDelete.length
      };

    } catch (error) {
      logger.error(`Error deleting domain data for ${domain}:`, error);
      throw new Error(`Failed to delete domain data: ${error.message}`);
    }
  }

  /**
   * Delete all data for a specific URL
   * @param {string} url - URL to delete data for
   * @param {Object} options - Deletion options
   * @returns {Promise<Object>} - Deletion result
   */
  async deleteUrlData(url, options = {}) {
    try {
      const { dryRun = false, syncKnowledgeBase = true } = options;
      const domain = new URL(url).hostname;
      
      logger.info(`${dryRun ? 'DRY RUN: ' : ''}Deleting data for URL: ${url}`);

      // List all documents for this URL
      const urlData = await this.listDocumentsByUrl(url);
      
      if (urlData.totalFiles === 0) {
        return {
          url,
          domain,
          deleted: false,
          reason: 'No files found for this URL',
          filesDeleted: 0
        };
      }

      const filesToDelete = [];

      // Collect all files to delete
      urlData.documents.rawContent.forEach(file => filesToDelete.push(file.Key));
      urlData.documents.processedChunks.forEach(file => filesToDelete.push(file.Key));
      urlData.documents.formattedDocuments.forEach(file => filesToDelete.push(file.Key));

      if (dryRun) {
        logger.info(`DRY RUN: Would delete ${filesToDelete.length} files for URL ${url}`);
        return {
          url,
          domain,
          dryRun: true,
          filesFound: filesToDelete.length,
          filesToDelete: filesToDelete,
          totalFiles: filesToDelete.length
        };
      }

      // Delete files
      let deletedCount = 0;
      const deletionErrors = [];

      if (filesToDelete.length <= 1000) {
        // Single batch
        try {
          await this.deleteS3ObjectsBatch(filesToDelete);
          deletedCount = filesToDelete.length;
        } catch (error) {
          deletionErrors.push({ error: error.message });
        }
      } else {
        // Multiple batches
        const batchSize = 1000;
        for (let i = 0; i < filesToDelete.length; i += batchSize) {
          const batch = filesToDelete.slice(i, i + batchSize);
          try {
            await this.deleteS3ObjectsBatch(batch);
            deletedCount += batch.length;
          } catch (error) {
            deletionErrors.push({
              batch: Math.floor(i/batchSize) + 1,
              error: error.message
            });
          }
        }
      }

      // Trigger knowledge base sync if requested
      let syncJobId = null;
      if (syncKnowledgeBase && deletedCount > 0) {
        try {
          const syncResult = await this.triggerKnowledgeBaseSync(domain);
          syncJobId = syncResult.jobId;
        } catch (error) {
          logger.warn(`Failed to trigger knowledge base sync: ${error.message}`);
        }
      }

      logger.info(`Completed deletion for URL ${url}: ${deletedCount}/${filesToDelete.length} files deleted`);

      return {
        url,
        domain,
        deleted: true,
        filesFound: filesToDelete.length,
        filesDeleted: deletedCount,
        deletionErrors: deletionErrors.length > 0 ? deletionErrors : undefined,
        syncJobId,
        success: deletedCount === filesToDelete.length
      };

    } catch (error) {
      logger.error(`Error deleting URL data for ${url}:`, error);
      throw new Error(`Failed to delete URL data: ${error.message}`);
    }
  }

  /**
   * List all S3 objects with a given prefix
   * @param {string} prefix - S3 prefix to search
   * @returns {Promise<Array>} - List of S3 objects
   */
  async listS3Objects(prefix) {
    const objects = [];
    let continuationToken = null;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      });

      const response = await this.s3Client.send(command);
      
      if (response.Contents) {
        objects.push(...response.Contents.map(obj => ({
          Key: obj.Key,
          Size: obj.Size,
          LastModified: obj.LastModified,
          Metadata: obj.Metadata || {}
        })));
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return objects;
  }

  /**
   * Get S3 object content
   * @param {string} key - S3 object key
   * @returns {Promise<string>} - Object content
   */
  async getS3Object(key) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const response = await this.s3Client.send(command);
    return await this.streamToString(response.Body);
  }

  /**
   * Delete multiple S3 objects in a batch
   * @param {Array<string>} keys - Array of S3 object keys to delete
   * @returns {Promise<void>}
   */
  async deleteS3ObjectsBatch(keys) {
    if (keys.length === 0) return;

    if (keys.length === 1) {
      // Single object deletion
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: keys[0]
      });
      await this.s3Client.send(command);
    } else {
      // Batch deletion
      const command = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: false
        }
      });
      
      const response = await this.s3Client.send(command);
      
      if (response.Errors && response.Errors.length > 0) {
        logger.warn(`Some files failed to delete:`, response.Errors);
        throw new Error(`Failed to delete ${response.Errors.length} files`);
      }
    }
  }

  /**
   * Trigger knowledge base synchronization
   * @param {string} domain - Domain that was affected
   * @returns {Promise<Object>} - Sync job info
   */
  async triggerKnowledgeBaseSync(domain) {
    const command = new StartIngestionJobCommand({
      knowledgeBaseId: this.knowledgeBaseId,
      dataSourceId: this.dataSourceId,
      description: `Re-sync after deleting data for ${domain} - ${new Date().toISOString()}`
    });

    const response = await this.bedrockAgent.send(command);
    
    return {
      jobId: response.ingestionJob.ingestionJobId,
      status: response.ingestionJob.status,
      startedAt: response.ingestionJob.startedAt
    };
  }

  /**
   * Convert stream to string
   * @param {Stream} stream - Stream to convert
   * @returns {Promise<string>} - String content
   */
  async streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  /**
   * Get comprehensive summary of all domains and data sources
   * @returns {Promise<Object>} - Complete summary including web content, PDFs, and documents
   */
  async getAllDomainsSummary() {
    try {
      logger.info('Getting comprehensive summary of all domains and data sources');

      const domains = new Map();
      const dataSources = {
        websites: new Map(),
        pdfs: new Map(),
        documents: new Map()
      };

      // 1. Scan raw content from web scrapes
      const rawContentObjects = await this.listS3Objects('raw-content/web-scrapes/');
      rawContentObjects.forEach(obj => {
        const pathParts = obj.Key.split('/');
        if (pathParts.length >= 3) {
          const domain = pathParts[2];
          if (!domains.has(domain)) {
            domains.set(domain, { 
              type: 'website',
              rawFiles: 0, 
              processedFiles: 0, 
              documentFiles: 0, 
              totalSize: 0,
              lastUpdate: obj.LastModified
            });
          }
          if (!dataSources.websites.has(domain)) {
            dataSources.websites.set(domain, {
              domain,
              type: 'website',
              files: 0,
              size: 0,
              lastUpdate: obj.LastModified
            });
          }
          domains.get(domain).rawFiles++;
          domains.get(domain).totalSize += obj.Size;
          dataSources.websites.get(domain).files++;
          dataSources.websites.get(domain).size += obj.Size;
          
          // Update last modified date if newer
          if (obj.LastModified > domains.get(domain).lastUpdate) {
            domains.get(domain).lastUpdate = obj.LastModified;
            dataSources.websites.get(domain).lastUpdate = obj.LastModified;
          }
        }
      });

      // 2. Scan PDF files
      const pdfObjects = await this.listS3Objects('raw-content/documents/pdfs/');
      for (const obj of pdfObjects) {
        const fileName = obj.Key.split('/').pop();
        const fileBaseName = fileName.replace(/\.[^/.]+$/, ""); // Remove extension from S3 filename
        
        // Try to get file metadata for more information
        let pdfInfo = {
          fileName: fileBaseName, // This will be the sanitized S3 filename without extension
          type: 'pdf',
          size: obj.Size,
          lastUpdate: obj.LastModified,
          originalName: fileName, // S3 filename with extension
          s3Key: obj.Key
        };

        if (obj.Metadata) {
          // Use original name from metadata if available, otherwise use S3 filename
          pdfInfo.originalName = obj.Metadata.originalName || fileName;
          pdfInfo.fileId = obj.Metadata.fileId;
          pdfInfo.sanitizedName = obj.Metadata.sanitizedName || fileName;
          
          // For display purposes, use the original filename without extension
          if (obj.Metadata.originalName) {
            const originalBase = obj.Metadata.originalName.replace(/\.[^/.]+$/, "");
            pdfInfo.displayName = originalBase;
          } else {
            pdfInfo.displayName = fileBaseName;
          }
        } else {
          pdfInfo.displayName = fileBaseName;
        }

        // Use displayName as the key for better user experience
        const mapKey = pdfInfo.displayName || fileBaseName;
        dataSources.pdfs.set(mapKey, pdfInfo);
      }

      // 3. Scan other document files (docs, txt, etc.)
      const docTypes = ['docs', 'others'];
      for (const docType of docTypes) {
        const docObjects = await this.listS3Objects(`raw-content/documents/${docType}/`);
        for (const obj of docObjects) {
          const fileName = obj.Key.split('/').pop();
          const fileBaseName = fileName.replace(/\.[^/.]+$/, ""); // Remove extension from S3 filename
          const fileExtension = fileName.split('.').pop().toLowerCase();
          
          let docInfo = {
            fileName: fileBaseName, // Sanitized S3 filename without extension
            type: fileExtension,
            category: docType,
            size: obj.Size,
            lastUpdate: obj.LastModified,
            originalName: fileName, // S3 filename with extension
            s3Key: obj.Key
          };

          if (obj.Metadata) {
            // Use original name from metadata if available
            docInfo.originalName = obj.Metadata.originalName || fileName;
            docInfo.fileId = obj.Metadata.fileId;
            docInfo.sanitizedName = obj.Metadata.sanitizedName || fileName;
            
            // For display purposes, use the original filename without extension
            if (obj.Metadata.originalName) {
              const originalBase = obj.Metadata.originalName.replace(/\.[^/.]+$/, "");
              docInfo.displayName = originalBase;
            } else {
              docInfo.displayName = fileBaseName;
            }
          } else {
            docInfo.displayName = fileBaseName;
          }

          // Use displayName as the key for better user experience
          const mapKey = docInfo.displayName || fileBaseName;
          dataSources.documents.set(mapKey, docInfo);
        }
      }

      // 4. Scan formatted documents (processed content)
      const documentObjects = await this.listS3Objects('documents/');
      for (const obj of documentObjects) {
        if (obj.Metadata && obj.Metadata.domain) {
          const domain = obj.Metadata.domain;
          if (!domains.has(domain)) {
            domains.set(domain, { 
              type: 'website',
              rawFiles: 0, 
              processedFiles: 0, 
              documentFiles: 0, 
              totalSize: 0,
              lastUpdate: obj.LastModified
            });
          }
          domains.get(domain).documentFiles++;
          domains.get(domain).totalSize += obj.Size;
          
          if (obj.LastModified > domains.get(domain).lastUpdate) {
            domains.get(domain).lastUpdate = obj.LastModified;
          }
        }
      }

      // Convert domains to array and sort by total size
      const domainList = Array.from(domains.entries())
        .map(([domain, stats]) => ({
          domain,
          ...stats,
          totalFiles: stats.rawFiles + stats.processedFiles + stats.documentFiles,
          sizeFormatted: this.formatBytes(stats.totalSize),
          status: stats.totalFiles > 0 ? 'active' : 'inactive'
        }))
        .sort((a, b) => b.totalSize - a.totalSize);

      // Convert data sources to arrays
      const websitesList = Array.from(dataSources.websites.values())
        .map(source => ({
          ...source,
          sizeFormatted: this.formatBytes(source.size)
        }))
        .sort((a, b) => b.size - a.size);

      const pdfsList = Array.from(dataSources.pdfs.values())
        .map(source => ({
          ...source,
          sizeFormatted: this.formatBytes(source.size)
        }))
        .sort((a, b) => b.size - a.size);

      const documentsList = Array.from(dataSources.documents.values())
        .map(source => ({
          ...source,
          sizeFormatted: this.formatBytes(source.size)
        }))
        .sort((a, b) => b.size - a.size);

      // Calculate totals
      const totalWebsites = websitesList.length;
      const totalPdfs = pdfsList.length;
      const totalDocuments = documentsList.length;
      const totalFiles = domainList.reduce((sum, d) => sum + d.totalFiles, 0) + totalPdfs + totalDocuments;
      const totalSize = domainList.reduce((sum, d) => sum + d.totalSize, 0) + 
                       pdfsList.reduce((sum, p) => sum + p.size, 0) + 
                       documentsList.reduce((sum, d) => sum + d.size, 0);

      return {
        // Legacy domains format for backward compatibility
        totalDomains: domainList.length,
        domains: domainList,
        
        // Enhanced data sources breakdown
        dataSources: {
          websites: {
            count: totalWebsites,
            items: websitesList
          },
          pdfs: {
            count: totalPdfs,
            items: pdfsList
          },
          documents: {
            count: totalDocuments,
            items: documentsList
          }
        },
        
        // Overall summary
        summary: {
          totalDataSources: totalWebsites + totalPdfs + totalDocuments,
          totalWebsites,
          totalPdfs,
          totalDocuments,
          totalFiles,
          totalSize,
          totalSizeFormatted: this.formatBytes(totalSize)
        }
      };

    } catch (error) {
      logger.error('Error getting domains summary:', error);
      throw new Error(`Failed to get domains summary: ${error.message}`);
    }
  }

  /**
   * Format bytes to human readable format
   * @param {number} bytes - Bytes to format
   * @returns {string} - Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = DataManagementService;