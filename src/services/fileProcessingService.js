const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const bedrockKnowledgeBaseService = require('./bedrockKnowledgeBaseService');
const bedrockCompliantStorage = require('./bedrockCompliantStorage');
const { generateHash } = require('../utils/hash');

// Dynamic imports for optional dependencies
let pdf, mammoth, xlsx;

class FileProcessingService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });
    
    this.bucket = process.env.BEDROCK_S3_BUCKET;
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '52428800', 10); // 50MB default
    
    // Supported file types
    this.supportedTypes = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.rtf': 'application/rtf'
    };
    
    this.initializeOptionalDependencies();
  }

  /**
   * Initialize optional file processing dependencies
   */
  async initializeOptionalDependencies() {
    try {
      pdf = require('pdf-parse');
      logger.debug('PDF processing enabled');
    } catch (error) {
      logger.warn('PDF processing not available. Install pdf-parse for PDF support.');
    }

    try {
      mammoth = require('mammoth');
      logger.debug('DOCX processing enabled');
    } catch (error) {
      logger.warn('DOCX processing not available. Install mammoth for DOCX support.');
    }

    try {
      xlsx = require('xlsx');
      logger.debug('Excel processing enabled');
    } catch (error) {
      logger.warn('Excel processing not available. Install xlsx for Excel support.');
    }
  }

  /**
   * Configure multer for file uploads
   * @param {Object} options - Upload configuration options
   * @returns {Object} - Configured multer instance
   */
  getUploadConfig(options = {}) {
    const {
      maxFiles = 10,
      allowedTypes = null,
      maxFileSize = this.maxFileSize
    } = options;

    return multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: maxFileSize,
        files: maxFiles
      },
      fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExtensions = allowedTypes || Object.keys(this.supportedTypes);
        
        if (allowedExtensions.includes(ext)) {
          // Verify MIME type matches extension
          const expectedMimeType = this.supportedTypes[ext];
          if (expectedMimeType && file.mimetype !== expectedMimeType) {
            logger.warn(`MIME type mismatch for ${file.originalname}: expected ${expectedMimeType}, got ${file.mimetype}`);
          }
          cb(null, true);
        } else {
          const error = new Error(`File type ${ext} not supported. Allowed: ${allowedExtensions.join(', ')}`);
          error.code = 'UNSUPPORTED_FILE_TYPE';
          cb(error);
        }
      }
    });
  }

  /**
   * Process uploaded file and store in Knowledge Base
   * @param {Object} file - Uploaded file object
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - Processing result
   */
  async processUploadedFile(file, metadata = {}) {
    try {
      logger.info(`Processing uploaded file: ${file.originalname}`, {
        size: file.size,
        type: file.mimetype
      });
      
      // Validate file
      this.validateFile(file);
      
      // Extract text content based on file type
      const extractionResult = await this.extractTextContent(file);
      
      if (!extractionResult.content || extractionResult.content.trim().length === 0) {
        throw new Error('No text content could be extracted from the file');
      }
      
      // Generate unique file ID
      const fileId = generateHash(file.originalname + Date.now());
      
      // Create a meaningful URL format for uploaded files
      const timestamp = new Date().toISOString();
      const baseName = file.originalname.includes('.') ? 
        file.originalname.substring(0, file.originalname.lastIndexOf('.')) : 
        file.originalname;
      const fileUrl = `local://document/${baseName}-${fileId}`;
      
      // Prepare document for Knowledge Base
      const document = {
        content: extractionResult.content,
        title: metadata.title || this.sanitizeFileName(file.originalname),
        url: fileUrl,
        metadata: {
          ...metadata,
          fileId,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          fileType: path.extname(file.originalname).toLowerCase(),
          uploadedAt: timestamp,
          extractionMethod: extractionResult.method,
          pageCount: extractionResult.pageCount,
          processingTime: extractionResult.processingTime
        }
      };
      
      // Store extracted content using Bedrock compliant structure
      // This creates both document file and .metadata.json sidecar
      const kbResult = await bedrockCompliantStorage.storeDocument(document);
      
      // Store original file in S3 for reference (backup)
      const originalFileKey = await this.storeOriginalFile(file, fileId);
      
      const result = {
        ...kbResult,
        fileId,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: path.extname(file.originalname),
        contentLength: extractionResult.content.length,
        originalFileKey,
        extractionMethod: extractionResult.method,
        pageCount: extractionResult.pageCount,
        processingTime: extractionResult.processingTime,
        bedrockCompliant: true
      };
      
      logger.info(`File processed successfully: ${file.originalname}`, {
        fileId,
        contentLength: result.contentLength,
        chunkCount: result.chunkCount
      });
      
      return result;
    } catch (error) {
      logger.error('Error processing uploaded file:', {
        fileName: file.originalname,
        error: error.message
      });
      throw new Error(`Failed to process file "${file.originalname}": ${error.message}`);
    }
  }

  /**
   * Validate uploaded file
   * @param {Object} file - File to validate
   */
  validateFile(file) {
    if (!file || !file.buffer) {
      throw new Error('Invalid file: missing file buffer');
    }

    if (file.size === 0) {
      throw new Error('Invalid file: file is empty');
    }

    if (file.size > this.maxFileSize) {
      throw new Error(`File too large: ${file.size} bytes exceeds limit of ${this.maxFileSize} bytes`);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.supportedTypes[ext]) {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Extract text content from different file types
   * @param {Object} file - File buffer and metadata
   * @returns {Promise<Object>} - Extraction result with content and metadata
   */
  async extractTextContent(file) {
    const startTime = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    
    try {
      let result = { content: '', method: 'unknown', pageCount: 0 };
      
      switch (ext) {
        case '.pdf':
          result = await this.extractPdfText(file.buffer);
          break;
        case '.docx':
          result = await this.extractDocxText(file.buffer);
          break;
        case '.doc':
          result = await this.extractDocText(file.buffer);
          break;
        case '.txt':
        case '.md':
          result = {
            content: file.buffer.toString('utf-8'),
            method: 'direct',
            pageCount: 1
          };
          break;
        case '.csv':
          result = await this.extractCsvText(file.buffer);
          break;
        case '.xlsx':
          result = await this.extractExcelText(file.buffer);
          break;
        case '.rtf':
          result = await this.extractRtfText(file.buffer);
          break;
        default:
          throw new Error(`Text extraction not implemented for ${ext} files`);
      }
      
      const processingTime = Date.now() - startTime;
      result.processingTime = processingTime;
      
      logger.debug(`Text extraction completed for ${file.originalname}`, {
        method: result.method,
        contentLength: result.content.length,
        pageCount: result.pageCount,
        processingTime
      });
      
      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error(`Text extraction failed for ${file.originalname}:`, {
        error: error.message,
        processingTime
      });
      throw new Error(`Text extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from PDF
   * @param {Buffer} buffer - PDF buffer
   * @returns {Promise<Object>} - Extraction result
   */
  async extractPdfText(buffer) {
    if (!pdf) {
      throw new Error('PDF processing not available. Install pdf-parse package.');
    }

    try {
      const data = await pdf(buffer);
      return {
        content: data.text,
        method: 'pdf-parse',
        pageCount: data.numpages || 0
      };
    } catch (error) {
      throw new Error(`PDF extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from DOCX
   * @param {Buffer} buffer - DOCX buffer
   * @returns {Promise<Object>} - Extraction result
   */
  async extractDocxText(buffer) {
    if (!mammoth) {
      throw new Error('DOCX processing not available. Install mammoth package.');
    }

    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        content: result.value,
        method: 'mammoth',
        pageCount: 1 // DOCX doesn't have clear page boundaries
      };
    } catch (error) {
      throw new Error(`DOCX extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from DOC (legacy Word format)
   * @param {Buffer} buffer - DOC buffer
   * @returns {Promise<Object>} - Extraction result
   */
  async extractDocText(buffer) {
    // DOC format is more complex and may require additional libraries
    // For now, attempt basic text extraction
    try {
      const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ');
      return {
        content: text,
        method: 'basic-doc',
        pageCount: 1
      };
    } catch (error) {
      throw new Error(`DOC extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from CSV
   * @param {Buffer} buffer - CSV buffer
   * @returns {Promise<Object>} - Extraction result
   */
  async extractCsvText(buffer) {
    try {
      const csvText = buffer.toString('utf-8');
      const lines = csvText.split('\n');
      
      // Convert CSV to readable text format
      const formattedLines = lines.map((line, index) => {
        if (index === 0) {
          return `Headers: ${line}`;
        }
        return `Row ${index}: ${line}`;
      });
      
      return {
        content: formattedLines.join('\n'),
        method: 'csv-parser',
        pageCount: 1
      };
    } catch (error) {
      throw new Error(`CSV extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from Excel files
   * @param {Buffer} buffer - Excel buffer
   * @returns {Promise<Object>} - Extraction result
   */
  async extractExcelText(buffer) {
    if (!xlsx) {
      throw new Error('Excel processing not available. Install xlsx package.');
    }

    try {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheets = [];
      
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csvText = xlsx.utils.sheet_to_csv(sheet);
        if (csvText.trim()) {
          sheets.push(`Sheet: ${sheetName}\n${csvText}`);
        }
      });
      
      return {
        content: sheets.join('\n\n'),
        method: 'xlsx',
        pageCount: workbook.SheetNames.length
      };
    } catch (error) {
      throw new Error(`Excel extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text from RTF
   * @param {Buffer} buffer - RTF buffer
   * @returns {Promise<Object>} - Extraction result
   */
  async extractRtfText(buffer) {
    try {
      // Basic RTF text extraction (removing RTF formatting)
      const rtfText = buffer.toString('utf-8');
      const textContent = rtfText
        .replace(/\\[a-z]+\d*\s?/g, '') // Remove RTF commands
        .replace(/[{}]/g, '') // Remove braces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      return {
        content: textContent,
        method: 'basic-rtf',
        pageCount: 1
      };
    } catch (error) {
      throw new Error(`RTF extraction failed: ${error.message}`);
    }
  }

  /**
   * Sanitize metadata value for S3 headers
   * @param {string} value - The metadata value to sanitize
   * @param {number} maxLength - Maximum length (default 1000)
   * @returns {string} - Sanitized value safe for S3 metadata
   */
  sanitizeMetadataValue(value, maxLength = 1000) {
    if (!value) return 'Unknown';
    
    // Convert to string and remove invalid characters for S3 metadata
    return String(value)
      // Remove non-ASCII characters
      .replace(/[^\x20-\x7E]/g, '')
      // Remove control characters and problematic chars
      .replace(/[\r\n\t\f\v]/g, ' ')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim()
      // Limit length
      .substring(0, maxLength) || 'Unknown';
  }

  /**
   * Store original file in S3 for reference (following correct bucket structure)
   * @param {Object} file - Original file
   * @param {string} fileId - Unique file ID (for backwards compatibility and deduplication)
   * @returns {Promise<string>} - S3 key of stored file
   */
  async storeOriginalFile(file, fileId) {
    try {
      const timestamp = new Date().toISOString();
      const ext = path.extname(file.originalname).toLowerCase();
      
      // Determine file type folder based on extension
      let fileTypeFolder;
      if (['.pdf'].includes(ext)) {
        fileTypeFolder = 'pdfs';
      } else if (['.docx', '.doc', '.rtf'].includes(ext)) {
        fileTypeFolder = 'docs';
      } else {
        fileTypeFolder = 'others'; // For txt, md, csv, xlsx, etc.
      }
      
      // Create meaningful filename based on original name
      const baseFileName = this.sanitizeFileName(path.basename(file.originalname, ext));
      const sanitizedFileName = `${baseFileName}${ext}`;
      
      // Check if file with same name already exists to avoid conflicts
      let finalFileName = sanitizedFileName;
      let counter = 1;
      
      // Keep trying with incremented counter if filename conflicts exist
      while (await this.checkFileExists(`raw-content/documents/${fileTypeFolder}/${finalFileName}`)) {
        const baseName = path.basename(sanitizedFileName, ext);
        finalFileName = `${baseName}_${counter}${ext}`;
        counter++;
        
        // Safety limit to avoid infinite loops
        if (counter > 100) {
          logger.warn(`Too many filename conflicts for ${file.originalname}, using fileId fallback`);
          finalFileName = `${fileId}${ext}`;
          break;
        }
      }
      
      const key = `raw-content/documents/${fileTypeFolder}/${finalFileName}`;
      
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          // S3-compatible keys for original file backup
          "bedrock-source-uri": `s3://${this.bucket}/${key}`,
          "bedrock-data-source-id": process.env.BEDROCK_DATA_SOURCE_ID || 'unknown',
          "bedrock-content-type": file.mimetype,
          "bedrock-created-date": timestamp,
          "bedrock-modified-date": timestamp,
          
          // Filtering-specific metadata for original file
          "source-type": 'document-content',
          "source-identifier": finalFileName,
          "datasource": finalFileName, // New field for easy filtering
          "type": ext.substring(1) === 'pdf' ? 'pdf' : 'document', // Simplified type field
          "domain": 'none',
          "file-name": finalFileName,
          "file-type": ext.substring(1),
          "document-id": fileId,
          "category": 'document-backup',
          "is-original-file": 'true',
          "file-size": String(file.size),
          "title": this.sanitizeMetadataValue(file.originalname, 200),
          "original-name": this.sanitizeMetadataValue(file.originalname, 200),
          "uploaded-at": timestamp
        },
        // Add tags for organization
        Tagging: `FileType=original&Extension=${ext.substring(1)}&FileId=${fileId}&Category=${fileTypeFolder}&OriginalName=${encodeURIComponent(file.originalname)}`
      });

      await this.s3Client.send(command);
      logger.debug(`Original file stored: ${key} (original: ${file.originalname})`);
      return key;
    } catch (error) {
      logger.error('Failed to store original file:', error);
      throw new Error(`Failed to store original file: ${error.message}`);
    }
  }

  /**
   * Check if a file exists in S3
   * @param {string} key - S3 key to check
   * @returns {Promise<boolean>} - True if file exists
   */
  async checkFileExists(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.statusCode === 404) {
        return false;
      }
      // For other errors, log but assume file doesn't exist to be safe
      logger.warn(`Error checking file existence for ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Retrieve original file from S3
   * @param {string} key - S3 key of the file
   * @returns {Promise<Object>} - File data
   */
  async getOriginalFile(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      return {
        buffer: await this.streamToBuffer(response.Body),
        metadata: response.Metadata,
        contentType: response.ContentType
      };
    } catch (error) {
      logger.error('Failed to retrieve original file:', error);
      throw new Error(`Failed to retrieve original file: ${error.message}`);
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
   * Sanitize file name for storage
   * @param {string} fileName - Original file name
   * @returns {string} - Sanitized file name
   */
  sanitizeFileName(fileName) {
    return fileName
      .replace(/[^\w\s.-]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length
  }

  /**
   * Get supported file types
   * @returns {Object} - Supported file types and their MIME types
   */
  getSupportedTypes() {
    return { ...this.supportedTypes };
  }

  /**
   * Get processing statistics
   * @returns {Object} - Processing capabilities and statistics
   */
  getProcessingInfo() {
    return {
      supportedTypes: Object.keys(this.supportedTypes),
      maxFileSize: this.maxFileSize,
      capabilities: {
        pdf: !!pdf,
        docx: !!mammoth,
        excel: !!xlsx
      },
      bucket: this.bucket
    };
  }
}

module.exports = new FileProcessingService();