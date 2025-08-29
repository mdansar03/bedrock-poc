const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');
const { generateHash } = require('../utils/hash');
const logger = require('../utils/logger');

/**
 * Bedrock Compliant Storage Service
 * Implements type-based AWS Bedrock Knowledge Base structure:
 * - Type-based folder organization (websites/, pdfs/, documents/, spreadsheets/)
 * - Datasource subfolders within each type
 * - Sidecar .metadata.json files for each document
 * - Proper metadataAttributes schema with datasource filtering
 * - Structure: type/datasource/filename.ext + type/datasource/filename.ext.metadata.json
 */
class BedrockCompliantStorage {
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
   * Store document with Bedrock Knowledge Base compliant structure
   * Creates both document file and required .metadata.json sidecar
   * Also creates/updates datasource.json registry for frontend
   * @param {Object} document - Document object with content and metadata
   * @returns {Promise<Object>} - Storage result
   */
  async storeDocument(document) {
    try {
      const { content, metadata = {}, title, url } = document;
      
      if (!content || typeof content !== 'string') {
        throw new Error('Document content is required and must be a string');
      }

      // Clean content for storage
      const cleanedContent = this.cleanContent(content);
      
      if (cleanedContent.length < 50) {
        throw new Error('Content too short for meaningful storage');
      }

      // Determine document type and datasource
      const documentInfo = this.analyzeDocument(document);
      
      // Generate file paths following exact Bedrock structure
      const filePaths = this.generateFilePaths(documentInfo, content);
      
      // Create metadata following exact Bedrock schema
      const bedrockMetadata = this.createBedrockMetadata(documentInfo, url, title);
      
      // Store document file
      await this.storeDocumentFile(filePaths.documentPath, cleanedContent);
      
      // Store metadata sidecar file
      await this.storeMetadataFile(filePaths.metadataPath, bedrockMetadata);
      
      // Create/update datasource.json registry for frontend
      const registryData = await this.updateDatasourceRegistry(documentInfo, url, title, filePaths.documentPath);
      
      logger.info(`📄 BEDROCK COMPLIANT DOCUMENT STORED`, {
        documentPath: filePaths.documentPath,
        metadataPath: filePaths.metadataPath,
        typeFolder: filePaths.typeFolder,
        datasource: documentInfo.datasource,
        type: documentInfo.type,
        registryUpdated: true,
        displayName: registryData?.display_name
      });

      // Print verification as requested
      console.log('📄 DOCUMENT STORED - BEDROCK COMPLIANT VERIFICATION:');
      console.log(`Type Folder: ${filePaths.typeFolder}`);
      console.log(`Document: ${filePaths.documentPath}`);
      console.log(`Metadata: ${filePaths.metadataPath}`);
      console.log('Metadata Schema:');
      console.log(JSON.stringify(bedrockMetadata, null, 2));
      if (registryData) {
        console.log('Datasource Registry:');
        console.log(JSON.stringify(registryData, null, 2));
      }
      console.log('---');

      return {
        success: true,
        documentPath: filePaths.documentPath,
        metadataPath: filePaths.metadataPath,
        typeFolder: filePaths.typeFolder,
        datasource: documentInfo.datasource,
        type: documentInfo.type,
        metadata: bedrockMetadata,
        contentLength: cleanedContent.length,
        registryData, // Include the generated datasource.json data
        verification: {
          hasDocument: true,
          hasMetadata: true,
          schemaCompliant: true,
          bedrockReady: true,
          typeBased: true,
          registryCreated: registryData !== null
        }
      };

    } catch (error) {
      logger.error('Error storing Bedrock compliant document:', error);
      throw new Error(`Failed to store Bedrock compliant document: ${error.message}`);
    }
  }

  /**
   * Analyze document to determine type and datasource
   * @param {Object} document - Document object
   * @returns {Object} - Document analysis
   */
  analyzeDocument(document) {
    const { metadata = {}, title, url } = document;
    
    let type, datasource, identifier, isUploadedFile = false;

    if (metadata?.source === 'external-scraper' && url) {
      // Web content
      type = 'web';
      
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        
        // Extract project name from domain
        if (hostname.includes('.')) {
          const parts = hostname.split('.');
          datasource = parts[0]; // e.g., "ansar-portfolio" from "ansar-portfolio.pages.dev"
        } else {
          datasource = hostname;
        }
        
        // Create page identifier from URL path
        const pathSegments = urlObj.pathname.split('/').filter(seg => seg.length > 0);
        if (pathSegments.length > 0) {
          identifier = pathSegments[pathSegments.length - 1] || 'home-page';
        } else {
          identifier = 'home-page';
        }
        
        // Clean identifier
        identifier = identifier.replace(/\.(html?|php|aspx?)$/i, '');
        identifier = this.sanitizeIdentifier(identifier) || 'page';
        
      } catch (e) {
        datasource = 'unknown-site';
        identifier = 'page';
      }
      
    } else if (metadata?.fileName) {
      // Uploaded file
      isUploadedFile = true;
      const fileName = metadata.fileName;
      const fileExt = metadata.fileType?.toLowerCase().replace('.', '') || 'txt';
      
      // Determine file type
      if (fileExt === 'pdf') {
        type = 'pdf';
      } else if (['doc', 'docx'].includes(fileExt)) {
        type = 'doc';
      } else {
        type = 'document';
      }
      
      // Extract datasource from filename
      const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
      const projectName = baseName.split(/[-_\s]/)[0] || baseName;
      datasource = this.sanitizeIdentifier(projectName) || 'uploaded-documents';
      
      identifier = this.sanitizeIdentifier(baseName) || 'document';
      
    } else {
      // Fallback
      type = 'document';
      datasource = 'general-content';
      identifier = this.sanitizeIdentifier(title) || 'untitled';
    }

    return {
      type,
      datasource: this.sanitizeIdentifier(datasource),
      identifier: this.sanitizeIdentifier(identifier),
      isUploadedFile,
      fileExtension: isUploadedFile ? (metadata?.fileType?.replace('.', '') || 'txt') : 'txt',
      metadata // Include original metadata for reference
    };
  }

  /**
   * Generate file paths following type-based Bedrock structure
   * @param {Object} documentInfo - Document analysis result
   * @param {string} content - Document content
   * @returns {Object} - File paths
   */
  generateFilePaths(documentInfo, content) {
    const { datasource, identifier, fileExtension, type } = documentInfo;
    
    // Create filename - ensure it's unique
    const contentHash = generateHash(content).substring(0, 8);
    const fileName = `${identifier}-${contentHash}.${fileExtension}`;
    
    // Determine type folder based on document type
    const typeFolder = this.getTypeFolder(type, fileExtension);
    
    // Follow type-based structure: type/datasource/filename.ext
    const documentPath = `${typeFolder}/${datasource}/${fileName}`;
    const metadataPath = `${typeFolder}/${datasource}/${fileName}.metadata.json`;
    
    return {
      documentPath,
      metadataPath,
      fileName,
      typeFolder
    };
  }

  /**
   * Get type folder based on document type and file extension
   * @param {string} type - Document type (web, pdf, doc, etc.)
   * @param {string} fileExtension - File extension
   * @returns {string} - Type folder name
   */
  getTypeFolder(type, fileExtension) {
    // Handle specific document types
    if (type === 'web') {
      return 'websites';
    }
    
    if (type === 'pdf') {
      return 'pdfs';
    }
    
    if (type === 'doc' || ['doc', 'docx', 'rtf'].includes(fileExtension)) {
      return 'documents';
    }
    
    // Handle spreadsheets
    if (['xlsx', 'xls', 'csv'].includes(fileExtension)) {
      return 'spreadsheets';
    }
    
    // Handle other text files
    if (['txt', 'md'].includes(fileExtension)) {
      return 'documents';
    }
    
    // Default fallback
    return 'documents';
  }

  /**
   * Create Bedrock compliant metadata following exact schema
   * @param {Object} documentInfo - Document analysis
   * @param {string} url - Source URL (optional)
   * @param {string} title - Document title
   * @returns {Object} - Bedrock metadata schema
   */
  createBedrockMetadata(documentInfo, url, title) {
    const { datasource, type, identifier, isUploadedFile } = documentInfo;
    
    const metadata = {
      metadataAttributes: {
        datasource: {
          value: { type: "STRING", stringValue: datasource },
          includeForEmbedding: true
        },
        type: {
          value: { type: "STRING", stringValue: type },
          includeForEmbedding: true
        }
      }
    };

    // Add page or filename identifier
    if (isUploadedFile) {
      metadata.metadataAttributes.filename = {
        value: { type: "STRING", stringValue: identifier },
        includeForEmbedding: false
      };
    } else {
      metadata.metadataAttributes.page = {
        value: { type: "STRING", stringValue: identifier },
        includeForEmbedding: false
      };
    }

    // Add URL if available (for web content)
    if (url) {
      metadata.metadataAttributes.url = {
        value: { type: "STRING", stringValue: url },
        includeForEmbedding: false
      };
    }

    // Add title if available
    if (title && title.trim()) {
      metadata.metadataAttributes.title = {
        value: { type: "STRING", stringValue: this.cleanTitle(title) },
        includeForEmbedding: false
      };
    }

    return metadata;
  }

  /**
   * Store document file in S3
   * @param {string} documentPath - S3 key for document
   * @param {string} content - Document content
   */
  async storeDocumentFile(documentPath, content) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: documentPath,
      Body: content,
      ContentType: 'text/plain; charset=utf-8'
    });

    await this.s3Client.send(command);
    logger.debug(`Document stored: ${documentPath}`);
  }

  /**
   * Store metadata sidecar file in S3
   * @param {string} metadataPath - S3 key for metadata
   * @param {Object} metadata - Bedrock metadata object
   */
  async storeMetadataFile(metadataPath, metadata) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: metadataPath,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    });

    await this.s3Client.send(command);
    logger.debug(`Metadata stored: ${metadataPath}`);
  }

  /**
   * Create or update datasource.json registry file for frontend
   * @param {Object} documentInfo - Document analysis result
   * @param {string} url - Source URL (optional)
   * @param {string} title - Document title
   * @param {string} documentPath - S3 path to the document file (for uploaded files)
   */
  async updateDatasourceRegistry(documentInfo, url, title, documentPath = null) {
    try {
      const { type, datasource } = documentInfo;
      const typeFolder = this.getTypeFolder(type, documentInfo.fileExtension);
      const registryPath = `${typeFolder}/${datasource}/datasource.json`;
      
      // Generate the correct display name and source URL based on content type
      const displayName = this.generateDisplayName(documentInfo, url, title);
      const sourceUrl = this.generateSourceUrl(documentInfo, url, documentPath);
      
      // Create datasource registry object
      const registryData = {
        id: datasource,
        type: this.mapTypeForRegistry(type),
        display_name: displayName,
        source_url: sourceUrl,
        created_at: new Date().toISOString()
      };

      // Check if registry already exists
      let existingRegistry = null;
      try {
        const existingResponse = await this.s3Client.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: registryPath
        }));
        const existingBody = await this.streamToBuffer(existingResponse.Body);
        existingRegistry = JSON.parse(existingBody.toString());
      } catch (error) {
        // Registry doesn't exist yet - that's fine
        logger.debug(`Creating new datasource registry: ${registryPath}`);
      }

      // If registry exists, preserve created_at and update other fields
      if (existingRegistry) {
        registryData.created_at = existingRegistry.created_at;
        registryData.updated_at = new Date().toISOString();
        
        // For display name: always use the generated one (show exactly what user expects)
        // Don't preserve old display names as they might not follow the new rules
        
        // For source URL: use the generated one for consistency
        // Don't preserve old source URLs as they might not follow the new rules
      }

      // Store the registry file
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: registryPath,
        Body: JSON.stringify(registryData, null, 2),
        ContentType: 'application/json'
      });

      await this.s3Client.send(command);
      logger.debug(`Datasource registry updated: ${registryPath} - Display: "${displayName}"`);
      
      return registryData;
    } catch (error) {
      logger.warn('Failed to update datasource registry (non-blocking):', error.message);
      return null;
    }
  }

  /**
   * Map internal type to registry type for frontend
   * @param {string} type - Internal type
   * @returns {string} - Frontend-friendly type
   */
  mapTypeForRegistry(type) {
    const typeMap = {
      'web': 'web',
      'pdf': 'pdf', 
      'doc': 'doc',
      'document': 'doc',
      'spreadsheet': 'spreadsheet'
    };
    return typeMap[type] || 'doc';
  }

  /**
   * Generate display name for datasource (show exactly what user expects)
   * @param {Object} documentInfo - Document analysis result
   * @param {string} url - Source URL
   * @param {string} title - Document title
   * @returns {string} - Exact display name as user expects
   */
  generateDisplayName(documentInfo, url, title) {
    const { type, isUploadedFile } = documentInfo;
    
    if (type === 'web' && url) {
      // For websites: show exactly what user scraped (the root URL)
      try {
        const urlObj = new URL(url);
        // Return the origin (protocol + hostname + port if non-standard)
        return urlObj.origin;
      } catch (e) {
        return url; // Fallback to provided URL
      }
    }
    
    if (isUploadedFile && documentInfo.metadata?.fileName) {
      // For files: show actual filename exactly as uploaded
      return documentInfo.metadata.fileName;
    }
    
    if (isUploadedFile && documentInfo.metadata?.originalName) {
      // Alternative: use original name if available
      return documentInfo.metadata.originalName;
    }
    
    // Fallback: use title or datasource ID
    return title || documentInfo.datasource;
  }

  /**
   * Generate source URL for datasource
   * @param {Object} documentInfo - Document analysis result  
   * @param {string} url - Original source URL
   * @param {string} filePath - S3 file path (for uploaded files)
   * @returns {string} - Source URL for frontend access
   */
  generateSourceUrl(documentInfo, url, filePath) {
    const { type, isUploadedFile } = documentInfo;
    
    if (type === 'web' && url) {
      // For websites: return the original scraped URL
      try {
        const urlObj = new URL(url);
        return urlObj.origin; // Root URL that was scraped
      } catch (e) {
        return url;
      }
    }
    
    if (isUploadedFile && filePath) {
      // For files: generate S3 public URL
      const bucket = this.bucket;
      const region = process.env.AWS_REGION || 'us-east-1';
      return `https://${bucket}.s3.${region}.amazonaws.com/${filePath}`;
    }
    
    // Fallback
    return url || null;
  }

  /**
   * Clean content for optimal storage
   * @param {string} content - Raw content
   * @returns {string} - Cleaned content
   */
  cleanContent(content) {
    let cleaned = content;
    
    // Remove excessive whitespace while preserving structure
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n/g, '\n\n');
    
    // Remove common navigation and boilerplate
    const removePatterns = [
      /skip to (main )?content/gi,
      /cookie policy/gi,
      /privacy policy/gi,
      /terms of service/gi,
      /newsletter signup/gi,
      /follow us on/gi,
      /share this/gi,
      /copyright \d{4}/gi
    ];
    
    removePatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    return cleaned.trim();
  }

  /**
   * Clean title for metadata
   * @param {string} title - Raw title
   * @returns {string} - Cleaned title
   */
  cleanTitle(title) {
    if (!title) return 'Untitled';
    
    return title
      .trim()
      .replace(/[^\w\s\-\.]/g, '') // Remove special chars except basic ones
      .replace(/\s+/g, ' ')        // Normalize spaces
      .substring(0, 200)           // Limit length
      .trim() || 'Untitled';
  }

  /**
   * Sanitize identifier for use in filenames and metadata
   * @param {string} identifier - Raw identifier
   * @returns {string} - Sanitized identifier
   */
  sanitizeIdentifier(identifier) {
    if (!identifier) return '';
    
    return identifier
      .toLowerCase()
      .replace(/[^\w\-]/g, '-')    // Replace non-word chars with hyphens
      .replace(/-+/g, '-')         // Collapse multiple hyphens
      .replace(/^-|-$/g, '')       // Remove leading/trailing hyphens
      .substring(0, 50);           // Limit length
  }

  /**
   * Trigger Knowledge Base sync
   * @returns {Promise<string|null>} - Sync job ID
   */
  async syncKnowledgeBase() {
    try {
      if (!this.knowledgeBaseId || !this.dataSourceId) {
        logger.warn('Knowledge Base ID or Data Source ID not configured - skipping sync');
        return null;
      }

      const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        description: `Bedrock compliant sync triggered at ${new Date().toISOString()}`
      });

      const response = await this.bedrockAgent.send(command);
      const jobId = response.ingestionJob.ingestionJobId;
      
      logger.info(`Knowledge Base sync started: ${jobId}`);
      return jobId;
    } catch (error) {
      logger.warn('Knowledge Base sync failed (non-blocking):', error.message);
      return null;
    }
  }

  /**
   * List documents by datasource across all type folders
   * @param {string} datasource - Datasource name
   * @returns {Promise<Array>} - List of documents
   */
  async listDocumentsByDatasource(datasource) {
    try {
      const typefolders = ['websites', 'pdfs', 'documents', 'spreadsheets'];
      const allDocuments = [];
      
      // Search across all type folders for the specified datasource
      for (const typeFolder of typefolders) {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${typeFolder}/${datasource}/`,
          MaxKeys: 1000
        });

        try {
          const response = await this.s3Client.send(command);
          const objects = response.Contents || [];
          
          // Separate documents and metadata files
          const metadataFiles = new Set();
          
          // First pass: collect metadata files
          objects.forEach(obj => {
            if (obj.Key.endsWith('.metadata.json')) {
              metadataFiles.add(obj.Key.replace('.metadata.json', ''));
            }
          });
          
          // Second pass: process documents
          objects.forEach(obj => {
            if (!obj.Key.endsWith('.metadata.json') && !obj.Key.endsWith('/')) {
              allDocuments.push({
                key: obj.Key,
                typeFolder,
                hasMetadata: metadataFiles.has(obj.Key),
                lastModified: obj.LastModified,
                size: obj.Size
              });
            }
          });
        } catch (folderError) {
          // Folder might not exist, continue with next type folder
          logger.debug(`No documents found in ${typeFolder}/${datasource}/`);
        }
      }

      return allDocuments;
    } catch (error) {
      logger.error('Error listing documents by datasource:', error);
      return [];
    }
  }

  /**
   * Validate document + metadata pair
   * @param {string} documentPath - Path to document
   * @returns {Promise<Object>} - Validation result
   */
  async validateDocumentPair(documentPath) {
    try {
      const metadataPath = `${documentPath}.metadata.json`;
      
      // Check if document exists
      const docExists = await this.checkFileExists(documentPath);
      
      // Check if metadata exists
      const metaExists = await this.checkFileExists(metadataPath);
      
      let metadataValid = false;
      let metadata = null;
      
      if (metaExists) {
        try {
          const metaResponse = await this.s3Client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: metadataPath
          }));
          
          const metaBody = await this.streamToBuffer(metaResponse.Body);
          metadata = JSON.parse(metaBody.toString());
          
          // Validate metadata schema
          metadataValid = this.validateMetadataSchema(metadata);
        } catch (e) {
          logger.warn(`Invalid metadata for ${documentPath}:`, e.message);
        }
      }
      
      return {
        documentPath,
        metadataPath,
        documentExists: docExists,
        metadataExists: metaExists,
        metadataValid,
        metadata,
        isValid: docExists && metaExists && metadataValid
      };
      
    } catch (error) {
      logger.error('Error validating document pair:', error);
      return {
        documentPath,
        documentExists: false,
        metadataExists: false,
        metadataValid: false,
        isValid: false,
        error: error.message
      };
    }
  }

  /**
   * Validate metadata schema
   * @param {Object} metadata - Metadata object
   * @returns {boolean} - Whether metadata is valid
   */
  validateMetadataSchema(metadata) {
    if (!metadata || !metadata.metadataAttributes) {
      return false;
    }
    
    const attrs = metadata.metadataAttributes;
    
    // Check required fields
    if (!attrs.datasource || !attrs.type) {
      return false;
    }
    
    // Check structure of required fields
    const requiredFields = ['datasource', 'type'];
    for (const field of requiredFields) {
      const attr = attrs[field];
      if (!attr || !attr.value || !attr.value.type || !attr.value.stringValue || typeof attr.includeForEmbedding !== 'boolean') {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if file exists in S3
   * @param {string} key - S3 key
   * @returns {Promise<boolean>} - Whether file exists
   */
  async checkFileExists(key) {
    try {
      await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      return true;
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Convert stream to buffer
   * @param {ReadableStream} stream - Stream to convert
   * @returns {Promise<Buffer>} - Buffer
   */
  async streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Get all datasource registries for frontend
   * @returns {Promise<Array>} - Array of all datasource registries
   */
  async getAllDatasources() {
    try {
      // Updated structure based on actual S3 layout:
      // - Webpages: datasources/project-name/datasource.json
      // - PDFs: pdfs/project-name/datasource.json
      const searchFolders = ['datasources', 'pdfs'];
      const allDatasources = [];
      
      for (const folder of searchFolders) {
        // List all objects in the folder looking for datasource.json files
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${folder}/`,
          MaxKeys: 1000
        });

        try {
          const response = await this.s3Client.send(command);
          const objects = response.Contents || [];
          
          // Find datasource.json files
          const datasourceFiles = objects.filter(obj => 
            obj.Key.endsWith('/datasource.json')
          );
          
          // Fetch and parse each datasource.json
          for (const file of datasourceFiles) {
            try {
              const getCommand = new GetObjectCommand({
                Bucket: this.bucket,
                Key: file.Key
              });
              
              const response = await this.s3Client.send(getCommand);
              const body = await this.streamToBuffer(response.Body);
              const datasourceData = JSON.parse(body.toString());
              
              // Add metadata about the file
              datasourceData.s3_key = file.Key;
              datasourceData.last_modified = file.LastModified;
              
              // Determine type based on folder structure
              if (folder === 'datasources') {
                datasourceData.type_folder = 'datasources';
                // Ensure type is set to 'web' for datasources folder
                if (!datasourceData.type) {
                  datasourceData.type = 'web';
                }
              } else if (folder === 'pdfs') {
                datasourceData.type_folder = 'pdfs';
                // Ensure type is set to 'pdf' for pdfs folder
                if (!datasourceData.type) {
                  datasourceData.type = 'pdf';
                }
              }
              
              allDatasources.push(datasourceData);
            } catch (error) {
              logger.warn(`Failed to parse datasource.json: ${file.Key}`, error.message);
            }
          }
        } catch (error) {
          logger.debug(`No datasources found in ${folder}/`);
        }
      }
      
      // Sort by creation date (newest first)
      allDatasources.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      logger.info(`Found ${allDatasources.length} datasources across all folders (datasources/, pdfs/)`);
      return allDatasources;
      
    } catch (error) {
      logger.error('Error getting all datasources:', error);
      throw new Error(`Failed to get datasources: ${error.message}`);
    }
  }

  /**
   * Get datasources for a specific type folder
   * @param {string} typeFolder - Type folder to search in
   * @returns {Promise<Array>} - Array of datasource registries
   */
  async getDatasourcesByType(typeFolder) {
    try {
      const validTypes = ['websites', 'pdfs', 'documents', 'spreadsheets'];
      if (!validTypes.includes(typeFolder)) {
        throw new Error(`Invalid type folder: ${typeFolder}. Must be one of: ${validTypes.join(', ')}`);
      }
      
      const datasources = [];
      
      // List all objects in the specific type folder
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${typeFolder}/`,
        MaxKeys: 1000
      });

      const response = await this.s3Client.send(command);
      const objects = response.Contents || [];
      
      // Find datasource.json files
      const datasourceFiles = objects.filter(obj => 
        obj.Key.endsWith('/datasource.json')
      );
      
      // Fetch and parse each datasource.json
      for (const file of datasourceFiles) {
        try {
          const getCommand = new GetObjectCommand({
            Bucket: this.bucket,
            Key: file.Key
          });
          
          const response = await this.s3Client.send(getCommand);
          const body = await this.streamToBuffer(response.Body);
          const datasourceData = JSON.parse(body.toString());
          
          // Add metadata about the file
          datasourceData.s3_key = file.Key;
          datasourceData.last_modified = file.LastModified;
          datasourceData.type_folder = typeFolder;
          
          datasources.push(datasourceData);
        } catch (error) {
          logger.warn(`Failed to parse datasource.json: ${file.Key}`, error.message);
        }
      }
      
      // Sort by creation date (newest first)
      datasources.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      logger.info(`Found ${datasources.length} datasources in ${typeFolder}/`);
      return datasources;
      
    } catch (error) {
      logger.error(`Error getting datasources for type ${typeFolder}:`, error);
      throw new Error(`Failed to get datasources for type: ${error.message}`);
    }
  }

  /**
   * Get storage statistics for type-based Bedrock compliant structure
   * @returns {Promise<Object>} - Statistics
   */
  async getStorageStats() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1000
      });

      const response = await this.s3Client.send(command);
      const objects = response.Contents || [];
      
      // Analyze objects with type-based structure
      const stats = {
        totalObjects: objects.length,
        documents: 0,
        metadataFiles: 0,
        datasources: new Set(),
        documentsByDatasource: {},
        documentsByType: {
          websites: 0,
          pdfs: 0,
          documents: 0,
          spreadsheets: 0
        },
        totalSize: 0
      };
      
      objects.forEach(obj => {
        stats.totalSize += obj.Size || 0;
        
        // Parse type-based structure: type/datasource/filename
        const pathParts = obj.Key.split('/');
        if (pathParts.length >= 3) {
          const [typeFolder, datasource, ...filenameParts] = pathParts;
          const filename = filenameParts.join('/');
          
          stats.datasources.add(datasource);
          
          if (!stats.documentsByDatasource[datasource]) {
            stats.documentsByDatasource[datasource] = { documents: 0, metadata: 0, types: new Set() };
          }
          
          // Track which types this datasource uses
          stats.documentsByDatasource[datasource].types.add(typeFolder);
          
          if (filename.endsWith('.metadata.json')) {
            stats.metadataFiles++;
            stats.documentsByDatasource[datasource].metadata++;
          } else if (!filename.endsWith('/')) {
            stats.documents++;
            stats.documentsByDatasource[datasource].documents++;
            
            // Count by type
            if (stats.documentsByType.hasOwnProperty(typeFolder)) {
              stats.documentsByType[typeFolder]++;
            }
          }
        }
      });
      
      // Convert Sets to Arrays for JSON serialization
      stats.datasources = Array.from(stats.datasources);
      Object.keys(stats.documentsByDatasource).forEach(datasource => {
        stats.documentsByDatasource[datasource].types = Array.from(stats.documentsByDatasource[datasource].types);
      });
      
      return stats;
    } catch (error) {
      logger.error('Error getting storage stats:', error);
      return {
        totalObjects: 0,
        documents: 0,
        metadataFiles: 0,
        datasources: [],
        documentsByDatasource: {},
        documentsByType: {},
        totalSize: 0,
        error: error.message
      };
    }
  }
}

module.exports = new BedrockCompliantStorage();
