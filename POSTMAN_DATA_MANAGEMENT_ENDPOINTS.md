# Data Management API Endpoints for Postman

This document provides comprehensive Postman examples for managing and deleting website-specific data from your AWS Bedrock Knowledge Base.

## 🚨 Important Notes

- **Not Pinecone**: Your system uses AWS Bedrock Knowledge Base, not Pinecone
- **Safety First**: All deletion endpoints require confirmation codes
- **Dry Run Available**: Use `?dryRun=true` to preview deletions before executing
- **Auto Sync**: Knowledge base automatically re-syncs after deletions

## Base URL

```
http://localhost:3002/api/data-management
```

---

## 1. Get All Domains Summary

**Purpose**: Overview of all domains in your knowledge base with file counts and sizes.

### Request
```http
GET {{baseUrl}}/domains
```

### Response Example
```json
{
  "success": true,
  "message": "Domains summary retrieved successfully",
  "data": {
    "totalDomains": 3,
    "domains": [
      {
        "domain": "example.com",
        "rawFiles": 15,
        "processedFiles": 0,
        "documentFiles": 8,
        "totalFiles": 23,
        "totalSize": 2048576,
        "sizeFormatted": "2.00 MB"
      },
      {
        "domain": "pamperedchef.com",
        "rawFiles": 5,
        "processedFiles": 0,
        "documentFiles": 3,
        "totalFiles": 8,
        "totalSize": 512000,
        "sizeFormatted": "500.00 KB"
      }
    ],
    "summary": {
      "totalFiles": 31,
      "totalSize": 2560576,
      "totalSizeFormatted": "2.44 MB"
    }
  }
}
```

---

## 2. List Documents by Domain

**Purpose**: View all files associated with a specific domain.

### Request
```http
GET {{baseUrl}}/domains/pamperedchef.com/documents
```

### Response Example
```json
{
  "success": true,
  "message": "Documents for domain pamperedchef.com retrieved successfully",
  "data": {
    "domain": "pamperedchef.com",
    "totalFiles": 8,
    "documents": {
      "rawContent": [
        {
          "Key": "raw-content/web-scrapes/pamperedchef.com/2024-01-15/abc123.json",
          "Size": 15420,
          "LastModified": "2024-01-15T10:30:00.000Z",
          "contentId": "abc123",
          "sourceUrl": "https://pamperedchef.com/recipes/butter-chicken",
          "title": "Perfect Butter Chicken Recipe"
        }
      ],
      "processedChunks": [
        {
          "Key": "processed-chunks/web-content/chunk_456.json",
          "Size": 2048,
          "LastModified": "2024-01-15T10:31:00.000Z",
          "documentId": "doc_789",
          "sourceUrl": "https://pamperedchef.com/recipes/butter-chicken",
          "title": "Perfect Butter Chicken Recipe",
          "chunkIndex": 1
        }
      ],
      "formattedDocuments": [
        {
          "Key": "documents/2024-01-15/doc_789.txt",
          "Size": 8192,
          "LastModified": "2024-01-15T10:32:00.000Z",
          "Metadata": {
            "domain": "pamperedchef.com",
            "url": "https://pamperedchef.com/recipes/butter-chicken",
            "title": "Perfect Butter Chicken Recipe"
          }
        }
      ],
      "metadata": [
        {
          "Key": "metadata/pamperedchef.com/2024-01-15/crawl-summary.json",
          "Size": 1024,
          "LastModified": "2024-01-15T10:35:00.000Z"
        }
      ]
    },
    "summary": {
      "rawContentFiles": 1,
      "processedChunks": 1,
      "formattedDocuments": 1,
      "metadataFiles": 1
    }
  }
}
```

---

## 3. List Documents by URL

**Purpose**: View all files associated with a specific URL.

### Request
```http
GET {{baseUrl}}/urls/documents?url=https://pamperedchef.com/recipes/butter-chicken
```

### URL Parameters
- `url` (required): The specific URL to search for

### Response Example
```json
{
  "success": true,
  "message": "Documents for URL https://pamperedchef.com/recipes/butter-chicken retrieved successfully",
  "data": {
    "url": "https://pamperedchef.com/recipes/butter-chicken",
    "domain": "pamperedchef.com",
    "totalFiles": 3,
    "documents": {
      "rawContent": [
        {
          "Key": "raw-content/web-scrapes/pamperedchef.com/2024-01-15/abc123.json",
          "Size": 15420,
          "contentId": "abc123",
          "sourceUrl": "https://pamperedchef.com/recipes/butter-chicken",
          "title": "Perfect Butter Chicken Recipe"
        }
      ],
      "processedChunks": [
        {
          "Key": "processed-chunks/web-content/chunk_456.json",
          "Size": 2048,
          "documentId": "doc_789",
          "sourceUrl": "https://pamperedchef.com/recipes/butter-chicken",
          "title": "Perfect Butter Chicken Recipe",
          "chunkIndex": 1
        }
      ],
      "formattedDocuments": [
        {
          "Key": "documents/2024-01-15/doc_789.txt",
          "Size": 8192,
          "Metadata": {
            "url": "https://pamperedchef.com/recipes/butter-chicken"
          }
        }
      ]
    },
    "summary": {
      "rawContentFiles": 1,
      "processedChunks": 1,
      "formattedDocuments": 1
    }
  }
}
```

---

## 4. Domain Deletion Preview (Dry Run)

**Purpose**: Preview what files would be deleted for a domain WITHOUT actually deleting them.

### Request
```http
GET {{baseUrl}}/domains/pamperedchef.com/deletion-preview
```

### Response Example
```json
{
  "success": true,
  "message": "Deletion preview for domain pamperedchef.com",
  "data": {
    "domain": "pamperedchef.com",
    "dryRun": true,
    "filesFound": 8,
    "filesToDelete": [
      "raw-content/web-scrapes/pamperedchef.com/2024-01-15/abc123.json",
      "processed-chunks/web-content/chunk_456.json",
      "documents/2024-01-15/doc_789.txt",
      "metadata/pamperedchef.com/2024-01-15/crawl-summary.json"
    ],
    "totalFiles": 8,
    "warning": "This is a preview only. No files have been deleted.",
    "toActuallyDelete": "DELETE /api/data-management/domains/pamperedchef.com?confirm=pamperedchef.com"
  }
}
```

---

## 5. URL Deletion Preview (Dry Run)

**Purpose**: Preview what files would be deleted for a URL WITHOUT actually deleting them.

### Request
```http
GET {{baseUrl}}/urls/deletion-preview?url=https://pamperedchef.com/recipes/butter-chicken
```

### Response Example
```json
{
  "success": true,
  "message": "Deletion preview for URL https://pamperedchef.com/recipes/butter-chicken",
  "data": {
    "url": "https://pamperedchef.com/recipes/butter-chicken",
    "domain": "pamperedchef.com",
    "dryRun": true,
    "filesFound": 3,
    "filesToDelete": [
      "raw-content/web-scrapes/pamperedchef.com/2024-01-15/abc123.json",
      "processed-chunks/web-content/chunk_456.json",
      "documents/2024-01-15/doc_789.txt"
    ],
    "totalFiles": 3,
    "warning": "This is a preview only. No files have been deleted.",
    "confirmationCode": "aHR0cHM6",
    "toActuallyDelete": "DELETE /api/data-management/urls?url=https%3A//pamperedchef.com/recipes/butter-chicken&confirm=aHR0cHM6"
  }
}
```

---

## 6. Delete All Data for a Domain

**Purpose**: ⚠️ **PERMANENTLY DELETE** all data associated with a domain.

### 🚨 SAFETY REQUIREMENTS
1. Must include `confirm` parameter with the exact domain name
2. Supports dry run with `dryRun=true`
3. Auto-triggers knowledge base re-sync by default

### Request (Dry Run First - RECOMMENDED)
```http
DELETE {{baseUrl}}/domains/pamperedchef.com?dryRun=true
```

### Request (Actual Deletion - REQUIRES CONFIRMATION)
```http
DELETE {{baseUrl}}/domains/pamperedchef.com?confirm=pamperedchef.com
```

### Query Parameters
- `confirm` (required for deletion): Must exactly match the domain name
- `dryRun` (optional): Set to `true` to preview deletion without executing
- `syncKnowledgeBase` (optional): Set to `false` to skip auto-sync (default: `true`)

### Response Example (Successful Deletion)
```json
{
  "success": true,
  "message": "All data for domain pamperedchef.com deleted successfully",
  "data": {
    "domain": "pamperedchef.com",
    "deleted": true,
    "filesFound": 8,
    "filesDeleted": 8,
    "syncJobId": "INGESTION_JOB_123456789",
    "success": true
  }
}
```

### Response Example (No Confirmation)
```json
{
  "success": false,
  "error": "Confirmation required",
  "message": "To delete data for pamperedchef.com, add ?confirm=pamperedchef.com to the URL. Use ?dryRun=true to preview what will be deleted.",
  "example": "DELETE /api/data-management/domains/pamperedchef.com?confirm=pamperedchef.com"
}
```

---

## 7. Delete All Data for a URL

**Purpose**: ⚠️ **PERMANENTLY DELETE** all data associated with a specific URL.

### 🚨 SAFETY REQUIREMENTS
1. Must include `confirm` parameter with a generated confirmation code
2. Supports dry run with `dryRun=true`
3. Auto-triggers knowledge base re-sync by default

### Request (Dry Run First - RECOMMENDED)
```http
DELETE {{baseUrl}}/urls?url=https://pamperedchef.com/recipes/butter-chicken&dryRun=true
```

### Request (Actual Deletion - REQUIRES CONFIRMATION)
```http
DELETE {{baseUrl}}/urls?url=https://pamperedchef.com/recipes/butter-chicken&confirm=aHR0cHM6
```

### Query Parameters
- `url` (required): The URL to delete data for
- `confirm` (required for deletion): Use the confirmation code from preview/error response
- `dryRun` (optional): Set to `true` to preview deletion without executing
- `syncKnowledgeBase` (optional): Set to `false` to skip auto-sync (default: `true`)

### Response Example (Successful Deletion)
```json
{
  "success": true,
  "message": "All data for URL https://pamperedchef.com/recipes/butter-chicken deleted successfully",
  "data": {
    "url": "https://pamperedchef.com/recipes/butter-chicken",
    "domain": "pamperedchef.com",
    "deleted": true,
    "filesFound": 3,
    "filesDeleted": 3,
    "syncJobId": "INGESTION_JOB_123456790",
    "success": true
  }
}
```

### Response Example (No Confirmation)
```json
{
  "success": false,
  "error": "Confirmation required",
  "message": "To delete data for this URL, add ?confirm=aHR0cHM6 to the URL. Use ?dryRun=true to preview what will be deleted.",
  "confirmationCode": "aHR0cHM6",
  "example": "DELETE /api/data-management/urls?url=https%3A//pamperedchef.com/recipes/butter-chicken&confirm=aHR0cHM6"
}
```

---

## 🛡️ Safety Features

### 1. Confirmation Codes
- **Domain deletions**: Must confirm with exact domain name
- **URL deletions**: Must confirm with generated confirmation code (base64 hash)

### 2. Dry Run Support
- Add `?dryRun=true` to any deletion request
- Shows exactly what would be deleted without executing
- **ALWAYS run dry run first**

### 3. Auto Knowledge Base Sync
- Automatically triggers AWS Bedrock Knowledge Base re-sync after deletions
- Ensures vector embeddings are updated
- Can be disabled with `?syncKnowledgeBase=false`

### 4. Detailed Logging
- All operations are logged with timestamps
- Failed deletions are logged and reported
- Batch deletion status tracking

---

## 📋 Postman Collection Setup

### Environment Variables
Create a Postman environment with:

```json
{
  "baseUrl": "http://localhost:3002/api/data-management",
  "testDomain": "pamperedchef.com",
  "testUrl": "https://pamperedchef.com/recipes/butter-chicken"
}
```

### Recommended Testing Workflow

1. **Start with Overview**
   ```
   GET {{baseUrl}}/domains
   ```

2. **Examine Specific Domain**
   ```
   GET {{baseUrl}}/domains/{{testDomain}}/documents
   ```

3. **Preview Deletion (Dry Run)**
   ```
   GET {{baseUrl}}/domains/{{testDomain}}/deletion-preview
   ```

4. **Execute Deletion with Confirmation**
   ```
   DELETE {{baseUrl}}/domains/{{testDomain}}?confirm={{testDomain}}
   ```

5. **Verify Deletion**
   ```
   GET {{baseUrl}}/domains/{{testDomain}}/documents
   ```

---

## ⚠️ Important Warnings

1. **Irreversible**: Deletions are permanent and cannot be undone
2. **Manual S3 Cleanup**: You mentioned doing manual S3 cleanup - these endpoints handle S3 automatically
3. **Knowledge Base Sync**: Auto-sync may take 5-10 minutes to complete
4. **Concurrent Operations**: Avoid running multiple deletions simultaneously
5. **Production Use**: Test thoroughly in development before using in production

---

## 🔍 Troubleshooting

### Common Issues

1. **"No files found"**
   - Domain/URL may not exist in knowledge base
   - Check domain spelling (case-sensitive)
   - Use `/domains` endpoint to see available domains

2. **"Confirmation required"**
   - Missing `confirm` parameter
   - Confirmation code doesn't match (for URLs)
   - Use exact domain name for domain deletions

3. **"Knowledge base sync failed"**
   - AWS credentials may be invalid
   - Knowledge base may be busy with another sync
   - Deletion still succeeded, sync can be triggered manually

4. **"Failed to delete some files"**
   - Partial success - some files deleted
   - Check response for specific error details
   - May need to retry failed files manually

### Testing Tips

1. Always start with `/domains` to see available data
2. Use dry run before actual deletion
3. Test with a small domain first
4. Monitor AWS CloudWatch for sync job status
5. Keep confirmation codes from preview responses

This comprehensive guide should help you safely manage and delete website-specific data from your knowledge base using Postman!