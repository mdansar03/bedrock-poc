# 📁 S3 Bucket Structure for AWS Bedrock Knowledge Base

## 🏗️ Complete Folder Structure

```
your-bedrock-s3-bucket/
├── documents/                          # Main documents for Knowledge Base
│   ├── 2024-01-15/                    # Organized by date
│   │   ├── abc123def456.txt           # Scraped web content
│   │   ├── xyz789ghi012.txt           # More scraped content
│   │   └── pdf345jkl678.txt           # Processed PDF content
│   ├── 2024-01-16/
│   │   ├── mno901pqr234.txt
│   │   └── stu567vwx890.txt
│   └── 2024-01-17/
│       ├── aaa111bbb222.txt
│       └── ccc333ddd444.txt
│
├── files/                             # Original uploaded files
│   ├── original/                      # Backup of original files
│   │   ├── 2024-01-15/               # Organized by upload date
│   │   │   ├── abc123def456.pdf      # Original PDF file
│   │   │   ├── xyz789ghi012.docx     # Original DOCX file
│   │   │   └── pdf345jkl678.xlsx     # Original Excel file
│   │   ├── 2024-01-16/
│   │   │   ├── mno901pqr234.pdf
│   │   │   └── stu567vwx890.txt
│   │   └── 2024-01-17/
│   │       ├── aaa111bbb222.docx
│   │       └── ccc333ddd444.pdf
│   │
│   └── processed/                     # Processed file metadata (optional)
│       ├── 2024-01-15/
│       ├── 2024-01-16/
│       └── 2024-01-17/
│
└── metadata/                          # Additional metadata (optional)
    ├── sync-logs/                     # Knowledge Base sync logs
    ├── processing-logs/               # File processing logs
    └── statistics/                    # Usage statistics
```

## 📋 Folder Descriptions

### `/documents/` - **Knowledge Base Source Directory**
- **Purpose**: Main folder that Bedrock Knowledge Base monitors for content
- **Structure**: `documents/YYYY-MM-DD/documentId.txt`
- **Content**: Processed, chunked, and formatted text ready for Knowledge Base
- **Auto-sync**: Bedrock monitors this folder for new content

**Example file (`documents/2024-01-15/abc123def456.txt`):**
```text
Title: How to Build REST APIs
URL: https://example.com/api-tutorial
Domain: example.com
Scraped: 2024-01-15T10:30:00.000Z
Chunks: 5

---

[Chunk 1]
REST APIs are a fundamental part of modern web development...

---

[Chunk 2]
When designing REST endpoints, consider the following principles...

---

[Chunk 3]
Authentication and authorization are crucial for API security...
```

### `/files/original/` - **Original File Backup**
- **Purpose**: Stores original uploaded files for reference and re-processing
- **Structure**: `files/original/YYYY-MM-DD/fileId.ext`
- **Content**: Exact copy of uploaded files (PDF, DOCX, Excel, etc.)
- **Retention**: Permanent backup for audit trails

### `/files/processed/` - **Processing Metadata** (Optional)
- **Purpose**: Stores processing logs and metadata about file conversion
- **Structure**: `files/processed/YYYY-MM-DD/fileId.json`
- **Content**: Processing statistics, extraction methods, errors

## 🔧 S3 Configuration Requirements

### Bucket Policy for Bedrock Access
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockKnowledgeBaseAccess",
      "Effect": "Allow",
      "Principal": {
        "Service": "bedrock.amazonaws.com"
      },
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bedrock-s3-bucket/*",
        "arn:aws:s3:::your-bedrock-s3-bucket"
      ]
    },
    {
      "Sid": "ApplicationAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR-ACCOUNT:user/your-app-user"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bedrock-s3-bucket/*",
        "arn:aws:s3:::your-bedrock-s3-bucket"
      ]
    }
  ]
}
```

### Bedrock Knowledge Base Data Source Configuration
- **Source Type**: S3
- **S3 URI**: `s3://your-bedrock-s3-bucket/documents/`
- **Inclusion Prefixes**: `documents/`
- **File Formats**: `.txt` (our processed format)

## 📊 File Naming Convention

### Document Files (`/documents/`)
```
Format: YYYY-MM-DD/[documentId].txt
Examples:
- 2024-01-15/a1b2c3d4e5f6.txt
- 2024-01-15/x9y8z7w6v5u4.txt
```

### Original Files (`/files/original/`)
```
Format: YYYY-MM-DD/[fileId].[originalExtension]
Examples:
- 2024-01-15/a1b2c3d4e5f6.pdf
- 2024-01-15/x9y8z7w6v5u4.docx
- 2024-01-15/m5n4o3p2q1r0.xlsx
```

## 🏷️ S3 Object Metadata and Tags

### Document Files Metadata
```json
{
  "Metadata": {
    "title": "Document Title",
    "url": "https://source-url.com",
    "domain": "source-url.com",
    "documentId": "a1b2c3d4e5f6",
    "chunkCount": "5",
    "originalLength": "15000",
    "processedLength": "12500",
    "uploadedAt": "2024-01-15T10:30:00.000Z"
  },
  "Tags": {
    "DocumentType": "scraped",
    "Domain": "source-url.com",
    "ProcessedDate": "2024-01-15"
  }
}
```

### Original Files Metadata
```json
{
  "Metadata": {
    "originalName": "my-document.pdf",
    "fileId": "a1b2c3d4e5f6",
    "uploadedAt": "2024-01-15T10:30:00.000Z",
    "fileSize": "2048576"
  },
  "Tags": {
    "FileType": "original",
    "Extension": "pdf",
    "FileId": "a1b2c3d4e5f6"
  }
}
```

## 🔄 Data Flow Through S3 Structure

### 1. Web Scraping Flow
```
Scraped Content → bedrockKnowledgeBaseService.storeDocument()
                ↓
         Process & chunk content
                ↓
         Generate unique documentId
                ↓
    Store in: documents/YYYY-MM-DD/documentId.txt
                ↓
         Trigger Bedrock KB sync
```

### 2. File Upload Flow
```
Uploaded File → fileProcessingService.processUploadedFile()
              ↓
         Extract text content
              ↓
         Generate unique fileId  
              ↓
    ┌─ Store original: files/original/YYYY-MM-DD/fileId.ext
    └─ Store processed: documents/YYYY-MM-DD/fileId.txt
              ↓
         Trigger Bedrock KB sync
```

## 🔍 Monitoring and Management

### Useful AWS CLI Commands

**List recent documents:**
```bash
aws s3 ls s3://your-bedrock-s3-bucket/documents/ --recursive --human-readable
```

**Check specific date:**
```bash
aws s3 ls s3://your-bedrock-s3-bucket/documents/2024-01-15/ --human-readable
```

**Get object metadata:**
```bash
aws s3api head-object --bucket your-bedrock-s3-bucket --key documents/2024-01-15/abc123.txt
```

**Monitor bucket size:**
```bash
aws s3 ls s3://your-bedrock-s3-bucket --recursive --human-readable --summarize
```

### Storage Classes Optimization

For cost optimization, consider lifecycle policies:

```json
{
  "Rules": [
    {
      "Id": "DocumentLifecycle",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "documents/"
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ]
    },
    {
      "Id": "OriginalFilesLifecycle", 
      "Status": "Enabled",
      "Filter": {
        "Prefix": "files/original/"
      },
      "Transitions": [
        {
          "Days": 7,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 30,
          "StorageClass": "GLACIER"
        }
      ]
    }
  ]
}
```

## 🎯 Best Practices

### 1. **Folder Organization**
- ✅ Use date-based folders for easy management
- ✅ Keep original files separate from processed content
- ✅ Use consistent naming conventions

### 2. **File Management**
- ✅ Store both original and processed versions
- ✅ Use meaningful metadata and tags
- ✅ Implement lifecycle policies for cost optimization

### 3. **Security**
- ✅ Use least-privilege IAM policies
- ✅ Enable S3 versioning for important documents
- ✅ Enable S3 access logging for audit trails

### 4. **Performance**
- ✅ Use appropriate storage classes
- ✅ Monitor sync job performance
- ✅ Implement error handling for failed uploads

## 📈 Scaling Considerations

### For High-Volume Applications:
- **Partitioning**: Use hour-based folders (`YYYY-MM-DD/HH/`) for very high volume
- **Sharding**: Use multiple buckets for extremely large datasets
- **Monitoring**: Set up CloudWatch alarms for bucket size and sync failures
- **Batch Processing**: Group multiple documents in single sync operations

This structure provides a clean, organized, and scalable foundation for your AWS Bedrock Knowledge Base while maintaining easy access to both processed and original content.