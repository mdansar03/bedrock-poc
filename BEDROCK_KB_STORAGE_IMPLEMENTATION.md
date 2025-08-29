# Bedrock Knowledge Base Storage Implementation Guide

## Overview

This document describes the complete implementation of AWS Bedrock Knowledge Base compliant storage system that follows a type-based folder structure with datasource organization and sidecar metadata files.

## ✅ Implementation Complete

The system now supports the exact type-based Bedrock KB structure:

```
your-s3-bucket/
├── websites/
│   ├── recipe-site/
│   │   ├── main-courses.txt
│   │   ├── main-courses.txt.metadata.json
│   │   ├── desserts.txt
│   │   └── desserts.txt.metadata.json
│   └── ansar-portfolio/
│       ├── home-page.txt
│       ├── home-page.txt.metadata.json
│       ├── about-page.txt
│       └── about-page.txt.metadata.json
│
├── pdfs/
│   ├── recipe-book-1.pdf
│   ├── recipe-book-1.pdf.metadata.json
│   ├── company-policies.pdf
│   └── company-policies.pdf.metadata.json
│
├── documents/
│   ├── policy-manual.docx
│   ├── policy-manual.docx.metadata.json
│   ├── employee-handbook.doc
│   └── employee-handbook.doc.metadata.json
│
└── spreadsheets/
    ├── sales-data.xlsx
    ├── sales-data.xlsx.metadata.json
    ├── inventory.csv
    └── inventory.csv.metadata.json
```

## New Service: BedrockCompliantStorage

**Location**: `src/services/bedrockCompliantStorage.js`

### Key Features

1. **Type-Based Organization**
   - `websites/` for web content
   - `pdfs/` for PDF documents  
   - `documents/` for Word/RTF documents
   - `spreadsheets/` for Excel/CSV files

2. **Automatic Datasource Detection**
   - Web content: Extracts from domain (e.g., "ansar-portfolio" from "ansar-portfolio.pages.dev")
   - Uploaded files: Extracts from filename (e.g., "recipe-book-1" from "Recipe-Book-1-2.pdf")

3. **Proper Metadata Schema**
   - Follows exact `metadataAttributes` structure
   - Includes `datasource`, `type`, `page`/`filename`, `url` (optional)
   - Each attribute has `value` with `type`, `stringValue`, and `includeForEmbedding`

4. **Type-Based File Organization**
   - Documents stored as: `{type}/{datasource}/{filename}.{ext}`
   - Metadata stored as: `{type}/{datasource}/{filename}.{ext}.metadata.json`

## Example Metadata Files

### Web Page Metadata
```json
{
  "metadataAttributes": {
    "datasource": {
      "value": { "type": "STRING", "stringValue": "ansar-portfolio" },
      "includeForEmbedding": true
    },
    "page": {
      "value": { "type": "STRING", "stringValue": "home-page" },
      "includeForEmbedding": false
    },
    "type": {
      "value": { "type": "STRING", "stringValue": "web" },
      "includeForEmbedding": true
    },
    "url": {
      "value": { "type": "STRING", "stringValue": "https://ansar-portfolio.pages.dev/" },
      "includeForEmbedding": false
    }
  }
}
```

### PDF Document Metadata
```json
{
  "metadataAttributes": {
    "datasource": {
      "value": { "type": "STRING", "stringValue": "recipe-site" },
      "includeForEmbedding": true
    },
    "filename": {
      "value": { "type": "STRING", "stringValue": "recipe-book.pdf" },
      "includeForEmbedding": false
    },
    "type": {
      "value": { "type": "STRING", "stringValue": "pdf" },
      "includeForEmbedding": true
    }
  }
}
```

## Updated Services

### 1. ExternalScrapingService
- **File**: `src/services/externalScrapingService.js`
- **Changes**: Now uses `bedrockCompliantStorage.storeDocument()`
- **Result**: Web scraping creates proper datasource folders and metadata sidecars

### 2. FileProcessingService
- **File**: `src/services/fileProcessingService.js`
- **Changes**: Document uploads use `bedrockCompliantStorage.storeDocument()`
- **Result**: File uploads create proper datasource organization

### 3. New Management API
- **File**: `src/routes/bedrockStorage.js`
- **Endpoint**: `/api/bedrock-storage/`
- **Features**: Statistics, validation, sync triggers, testing

## API Endpoints

### Storage Statistics
```bash
GET /api/bedrock-storage/stats
```
Returns overview of stored documents and datasources.

### List Datasources
```bash
GET /api/bedrock-storage/datasources
```
Lists all available datasources with document counts.

### Documents by Datasource
```bash
GET /api/bedrock-storage/datasources/{datasource}/documents
```
Lists all documents in a specific datasource across all type folders.

### Documents by Type
```bash
GET /api/bedrock-storage/types/{typeFolder}/documents
```
Lists all documents in a specific type folder (websites, pdfs, documents, spreadsheets).

### Validate Document Pair
```bash
GET /api/bedrock-storage/validate/{datasource}/{filename}
```
Validates that document + metadata pair exists and is properly formatted.

### Trigger Sync
```bash
POST /api/bedrock-storage/sync
```
Triggers Knowledge Base sync with new structure.

### Test Document Storage
```bash
POST /api/bedrock-storage/test-document
{
  "content": "Test content here...",
  "title": "Test Document",
  "url": "https://test-site.example.com/page",
  "type": "web"
}
```

### Validation Checklist
```bash
GET /api/bedrock-storage/validation-checklist
```
Runs complete validation checklist as specified in your requirements.

## Testing the Implementation

### 1. Test Web Scraping
```bash
POST /api/scraping/scrape
{
  "url": "https://ansar-portfolio.pages.dev/"
}
```

**Expected Result**:
- Document: `websites/ansar-portfolio/home-page-{hash}.txt`
- Metadata: `websites/ansar-portfolio/home-page-{hash}.txt.metadata.json`

### 2. Test File Upload
```bash
POST /api/files/upload
# Upload a PDF file named "recipe-book.pdf"
```

**Expected Result**:
- Document: `pdfs/recipe-book-1-{hash}.pdf`
- Metadata: `pdfs/recipe-book-1-{hash}.pdf.metadata.json`

### 3. Verify Structure
```bash
GET /api/bedrock-storage/stats
```

**Expected Response**:
```json
{
  "success": true,
  "stats": {
    "totalObjects": 4,
    "documents": 2,
    "metadataFiles": 2,
    "datasources": ["ansar-portfolio", "recipe-book-1"],
    "documentsByDatasource": {
      "ansar-portfolio": { "documents": 1, "metadata": 1, "types": ["websites"] },
      "recipe-book-1": { "documents": 1, "metadata": 1, "types": ["pdfs"] }
    },
    "documentsByType": {
      "websites": 1,
      "pdfs": 1,
      "documents": 0,
      "spreadsheets": 0
    }
  }
}
```

## Validation Checklist ✅

✅ **Each document has a .metadata.json sidecar**
- Automatically created by `bedrockCompliantStorage.storeDocument()`

✅ **Metadata contains datasource key for filtering**
- All metadata includes `datasource` with `includeForEmbedding: true`

✅ **Documents organized by type then datasource folders**
- Type folders: websites/, pdfs/, documents/, spreadsheets/
- Datasource subfolders: Extracted from domain (web) or filename (uploads)

✅ **Metadata schema matches Bedrock requirements**
- Uses exact `metadataAttributes` structure
- Proper `value` objects with `type`, `stringValue`, `includeForEmbedding`

✅ **Knowledge Base can sync**
- Uses existing sync mechanism
- Compatible with Bedrock ingestion

## Knowledge Base Configuration

Update your AWS Bedrock Knowledge Base Data Source to point to:
- **S3 URI**: `s3://your-bucket/` (root level, not `s3://your-bucket/documents/`)
- **File Extensions**: `.txt`, `.pdf`, `.docx`, `.html`
- **Metadata**: Will automatically read `.metadata.json` sidecars

## Filtering Examples

With this structure, you can now filter by datasource:

```python
# Python filtering example
filter = {
    'stringContains': {
        'key': 'datasource',
        'value': 'ansar-portfolio'
    }
}

response = bedrock_agent.retrieve(
    knowledgeBaseId='kb-xxxx',
    retrievalQuery={
        'text': 'user query here'
    },
    retrievalConfiguration={
        'vectorSearchConfiguration': {
            'filter': filter
        }
    }
)
```

## AWS CLI Upload Example

You can also manually upload documents (following type-based structure):

```bash
# Upload document to appropriate type folder
aws s3 cp home-page.txt s3://your-bucket/websites/ansar-portfolio/

# Upload metadata to same location
aws s3 cp home-page.txt.metadata.json s3://your-bucket/websites/ansar-portfolio/

# Upload PDF example
aws s3 cp recipe-book.pdf s3://your-bucket/pdfs/recipe-book-1/
aws s3 cp recipe-book.pdf.metadata.json s3://your-bucket/pdfs/recipe-book-1/

# Trigger sync
curl -X POST http://localhost:3002/api/bedrock-storage/sync
```

## Migration from Old System

The old storage structure (`documents/YYYY-MM-DD/`) is preserved for backward compatibility. New content uses the Bedrock compliant structure. Both can coexist.

## Next Steps

1. **Test the Implementation**: Use the test endpoints to verify functionality
2. **Update Knowledge Base**: Configure your Bedrock KB Data Source to point to bucket root
3. **Run Validation**: Use `/api/bedrock-storage/validation-checklist`
4. **Trigger Sync**: Use `/api/bedrock-storage/sync`
5. **Test Filtering**: Verify that datasource filtering works in your Python application

## Verification Console Output

When documents are stored, you'll see verification output like:

```
📄 DOCUMENT STORED - BEDROCK COMPLIANT VERIFICATION:
Type Folder: websites
Document: websites/ansar-portfolio/home-page-abc123.txt
Metadata: websites/ansar-portfolio/home-page-abc123.txt.metadata.json
Metadata Schema:
{
  "metadataAttributes": {
    "datasource": {
      "value": { "type": "STRING", "stringValue": "ansar-portfolio" },
      "includeForEmbedding": true
    },
    "page": {
      "value": { "type": "STRING", "stringValue": "home-page" },
      "includeForEmbedding": false
    },
    "type": {
      "value": { "type": "STRING", "stringValue": "web" },
      "includeForEmbedding": true
    },
    "url": {
      "value": { "type": "STRING", "stringValue": "https://ansar-portfolio.pages.dev/" },
      "includeForEmbedding": false
    }
  }
}
---
```

This implementation follows your exact specifications and provides the filtering capabilities you need for your Bedrock Knowledge Base system.
