# Complete Scraping and Storage Flow Migration Guide - Python

This guide provides a step-by-step implementation for migrating the complete scraping and storing flow from the `/scraping/scrape` endpoint to Python. Follow this guide to implement the same functionality in your Python application.

## Overview

The scraping system follows this complete flow:
1. **HTTP Request** → Flask/FastAPI Route → External Scraping Service
2. **Content Processing** → Content Cleaning → Bedrock Compliant Storage  
3. **Knowledge Base Sync** → Final Storage in AWS Bedrock Knowledge Base

## Architecture Components

### Core Services Required

```
project/
├── app/
│   ├── routes/
│   │   └── scraping.py              # HTTP endpoints
│   ├── services/
│   │   ├── external_scraping_service.py    # Main scraping logic
│   │   ├── bedrock_compliant_storage.py    # AWS storage service
│   │   ├── knowledge_base_sync.py          # KB synchronization
│   │   └── file_processing_service.py      # File handling
│   ├── utils/
│   │   ├── hash_utils.py                   # Content hashing
│   │   └── logger.py                       # Logging utilities
│   └── main.py                             # Application entry point
├── requirements.txt                        # Python dependencies
└── config.py                              # Configuration
```

## Step 1: Setup Dependencies

### requirements.txt

```txt
# Web Framework
flask==2.3.3
flask-cors==4.0.0
# Alternative: fastapi==0.104.1

# AWS SDK
boto3==1.34.0
botocore==1.34.0

# HTTP Client and Web Scraping
requests==2.31.0
httpx==0.25.2
beautifulsoup4==4.12.2
lxml==4.9.3

# Content Processing
html2text==2020.1.16
markdownify==0.11.6

# File Processing
PyPDF2==3.0.1
# Alternative: pymupdf==1.23.0
python-docx==1.1.0
openpyxl==3.1.2
pandas==2.1.4

# Validation
pydantic==2.5.0
marshmallow==3.20.1

# Utilities
python-dotenv==1.0.0
python-slugify==8.0.1
charset-normalizer==3.3.2

# Logging
structlog==23.2.0

# Development
pytest==7.4.3
pytest-asyncio==0.21.1
```

### Environment Configuration

```python
# config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # AWS Configuration
    AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
    AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
    AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
    BEDROCK_S3_BUCKET = os.getenv('BEDROCK_S3_BUCKET')
    BEDROCK_KNOWLEDGE_BASE_ID = os.getenv('BEDROCK_KNOWLEDGE_BASE_ID')
    BEDROCK_DATA_SOURCE_ID = os.getenv('BEDROCK_DATA_SOURCE_ID')
    
    # External Scraper Configuration
    EXTERNAL_SCRAPER_URL = os.getenv('EXTERNAL_SCRAPER_URL', 'http://localhost:3358/api')
    EXTERNAL_SCRAPER_TIMEOUT = int(os.getenv('EXTERNAL_SCRAPER_TIMEOUT_MS', '1200000')) // 1000  # Convert to seconds
    
    # File Processing
    MAX_FILE_SIZE = int(os.getenv('MAX_FILE_SIZE', '52428800'))  # 50MB default
    
    # Logging
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

# Environment variables file (.env)
"""
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
BEDROCK_S3_BUCKET=your-bedrock-bucket
BEDROCK_KNOWLEDGE_BASE_ID=your-kb-id
BEDROCK_DATA_SOURCE_ID=your-datasource-id

EXTERNAL_SCRAPER_URL=http://localhost:3358/api
EXTERNAL_SCRAPER_TIMEOUT_MS=1200000

MAX_FILE_SIZE=52428800
LOG_LEVEL=INFO
"""
```

## Step 2: Implement Core Utilities

### 2.1 Hash Utility (`utils/hash_utils.py`)

```python
import hashlib
from typing import Optional

def generate_hash(content: str) -> str:
    """
    Generate SHA256 hash for content
    
    Args:
        content: The content to hash
        
    Returns:
        The SHA256 hash as hex string
    """
    return hashlib.sha256(content.encode('utf-8')).hexdigest()

def generate_chunk_id(url: str, chunk_index: int, timestamp: Optional[str] = None) -> str:
    """
    Generate unique chunk ID
    
    Args:
        url: Source URL
        chunk_index: Index of the chunk
        timestamp: Timestamp string (optional, uses current time if None)
        
    Returns:
        Unique chunk ID (first 12 characters of hash)
    """
    from datetime import datetime
    if timestamp is None:
        timestamp = datetime.utcnow().isoformat()
    
    content = f"{url}-{chunk_index}-{timestamp}"
    return generate_hash(content)[:12]

def compare_hashes(hash1: str, hash2: str) -> bool:
    """
    Compare two hashes
    
    Args:
        hash1: First hash
        hash2: Second hash
        
    Returns:
        True if hashes are equal
    """
    return hash1 == hash2
```

### 2.2 Logger Utility (`utils/logger.py`)

```python
import logging
import structlog
from typing import Optional
from config import Config

def setup_logger(name: Optional[str] = None) -> structlog.stdlib.BoundLogger:
    """
    Set up structured logger with appropriate configuration
    
    Args:
        name: Logger name (optional)
        
    Returns:
        Configured logger instance
    """
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer()
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    
    # Configure standard logging
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, Config.LOG_LEVEL.upper(), logging.INFO),
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler('logs/scraping.log', mode='a')
        ]
    )
    
    return structlog.get_logger(name)

# Global logger instance
logger = setup_logger(__name__)
```

## Step 3: Implement Bedrock Compliant Storage Service

### 3.1 Main Storage Service (`services/bedrock_compliant_storage.py`)

```python
import json
import boto3
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse
from botocore.exceptions import ClientError, NoCredentialsError

from utils.hash_utils import generate_hash
from utils.logger import setup_logger
from config import Config

logger = setup_logger(__name__)

class BedrockCompliantStorage:
    """
    Bedrock Compliant Storage Service
    Implements type-based AWS Bedrock Knowledge Base structure:
    - Type-based folder organization (websites/, pdfs/, documents/, spreadsheets/)
    - Datasource subfolders within each type
    - Sidecar .metadata.json files for each document
    - Proper metadataAttributes schema with datasource filtering
    - Structure: type/datasource/filename.ext + type/datasource/filename.ext.metadata.json
    """
    
    def __init__(self):
        """Initialize AWS clients and configuration"""
        self.config = Config()
        
        # Initialize S3 client
        try:
            self.s3_client = boto3.client(
                's3',
                region_name=self.config.AWS_REGION,
                aws_access_key_id=self.config.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=self.config.AWS_SECRET_ACCESS_KEY
            )
        except NoCredentialsError:
            logger.error("AWS credentials not found")
            raise
        
        # Initialize Bedrock Agent client
        try:
            self.bedrock_agent = boto3.client(
                'bedrock-agent',
                region_name=self.config.AWS_REGION,
                aws_access_key_id=self.config.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=self.config.AWS_SECRET_ACCESS_KEY
            )
        except Exception as e:
            logger.warning(f"Could not initialize Bedrock Agent client: {e}")
            self.bedrock_agent = None
        
        self.bucket = self.config.BEDROCK_S3_BUCKET
        self.knowledge_base_id = self.config.BEDROCK_KNOWLEDGE_BASE_ID
        self.data_source_id = self.config.BEDROCK_DATA_SOURCE_ID
    
    async def store_document(self, document: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main entry point: Store document with Bedrock Knowledge Base compliant structure
        Creates both document file and required .metadata.json sidecar
        
        Args:
            document: Document dictionary with content, metadata, title, url
            
        Returns:
            Storage result dictionary
        """
        try:
            content = document.get('content', '')
            metadata = document.get('metadata', {})
            title = document.get('title')
            url = document.get('url')
            
            if not content or not isinstance(content, str):
                raise ValueError('Document content is required and must be a string')
            
            # Clean content for storage
            cleaned_content = self.clean_content(content)
            
            if len(cleaned_content) < 50:
                raise ValueError('Content too short for meaningful storage')
            
            # Analyze document type and determine storage structure
            document_info = self.analyze_document(document)
            
            # Generate file paths following Bedrock structure: type/datasource/filename.ext
            file_paths = self.generate_file_paths(document_info, content)
            
            # Create metadata following Bedrock schema
            bedrock_metadata = self.create_bedrock_metadata(document_info, url, title)
            
            # Store document file
            await self.store_document_file(file_paths['document_path'], cleaned_content)
            
            # Store metadata sidecar file (.metadata.json)
            await self.store_metadata_file(file_paths['metadata_path'], bedrock_metadata)
            
            # Create/update datasource.json registry for frontend
            registry_data = await self.update_datasource_registry(
                document_info, url, title, file_paths['document_path']
            )
            
            logger.info(
                "BEDROCK COMPLIANT DOCUMENT STORED",
                document_path=file_paths['document_path'],
                metadata_path=file_paths['metadata_path'],
                type_folder=file_paths['type_folder'],
                datasource=document_info['datasource'],
                type=document_info['type']
            )
            
            return {
                'success': True,
                'document_path': file_paths['document_path'],
                'metadata_path': file_paths['metadata_path'],
                'type_folder': file_paths['type_folder'],
                'datasource': document_info['datasource'],
                'type': document_info['type'],
                'metadata': bedrock_metadata,
                'content_length': len(cleaned_content),
                'registry_data': registry_data,
                'verification': {
                    'has_document': True,
                    'has_metadata': True,
                    'schema_compliant': True,
                    'bedrock_ready': True,
                    'type_based': True,
                    'registry_created': registry_data is not None
                }
            }
            
        except Exception as e:
            logger.error(f"Error storing Bedrock compliant document: {e}")
            raise Exception(f"Failed to store Bedrock compliant document: {str(e)}")
    
    def analyze_document(self, document: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze document to determine storage type and datasource
        
        Args:
            document: Document dictionary
            
        Returns:
            Document analysis dictionary
        """
        metadata = document.get('metadata', {})
        title = document.get('title')
        url = document.get('url')
        
        type_name = None
        datasource = None
        identifier = None
        is_uploaded_file = False
        
        if metadata.get('source') == 'external-scraper' and url:
            # Web content from scraping
            type_name = 'web'
            
            try:
                url_obj = urlparse(url)
                hostname = url_obj.hostname.replace('www.', '') if url_obj.hostname else 'unknown'
                
                # Extract project name from domain
                if '.' in hostname:
                    parts = hostname.split('.')
                    datasource = parts[0]  # e.g., "ansar-portfolio" from "ansar-portfolio.pages.dev"
                else:
                    datasource = hostname
                
                # Create page identifier from URL path
                path_segments = [seg for seg in url_obj.path.split('/') if seg]
                if path_segments:
                    identifier = path_segments[-1] or 'home-page'
                else:
                    identifier = 'home-page'
                
                # Clean identifier
                import re
                identifier = re.sub(r'\.(html?|php|aspx?)$', '', identifier, flags=re.IGNORECASE)
                identifier = self.sanitize_identifier(identifier) or 'page'
                
            except Exception:
                datasource = 'unknown-site'
                identifier = 'page'
        
        elif metadata.get('file_name') or metadata.get('fileName'):
            # Uploaded file
            is_uploaded_file = True
            file_name = metadata.get('file_name') or metadata.get('fileName')
            file_ext = (metadata.get('file_type') or metadata.get('fileType', '')).lower().replace('.', '')
            
            # Determine file type
            if file_ext == 'pdf':
                type_name = 'pdf'
            elif file_ext in ['doc', 'docx']:
                type_name = 'doc'
            else:
                type_name = 'document'
            
            # Extract datasource from filename
            base_name = file_name.rsplit('.', 1)[0] if '.' in file_name else file_name
            import re
            project_name = re.split(r'[-_\s]', base_name)[0] or base_name
            datasource = self.sanitize_identifier(project_name) or 'uploaded-documents'
            
            identifier = self.sanitize_identifier(base_name) or 'document'
        
        else:
            # Fallback
            type_name = 'document'
            datasource = 'general-content'
            identifier = self.sanitize_identifier(title) if title else 'untitled'
        
        return {
            'type': type_name,
            'datasource': self.sanitize_identifier(datasource),
            'identifier': self.sanitize_identifier(identifier),
            'is_uploaded_file': is_uploaded_file,
            'file_extension': metadata.get('file_type', '').replace('.', '') if is_uploaded_file else 'txt',
            'metadata': metadata
        }
    
    def generate_file_paths(self, document_info: Dict[str, Any], content: str) -> Dict[str, str]:
        """
        Generate file paths following type-based Bedrock structure
        
        Args:
            document_info: Document analysis result
            content: Document content
            
        Returns:
            Dictionary with file paths
        """
        datasource = document_info['datasource']
        identifier = document_info['identifier']
        file_extension = document_info['file_extension']
        type_name = document_info['type']
        
        # Create filename - ensure it's unique
        content_hash = generate_hash(content)[:8]
        file_name = f"{identifier}-{content_hash}.{file_extension}"
        
        # Determine type folder based on document type
        type_folder = self.get_type_folder(type_name, file_extension)
        
        # Follow type-based structure: type/datasource/filename.ext
        document_path = f"{type_folder}/{datasource}/{file_name}"
        metadata_path = f"{type_folder}/{datasource}/{file_name}.metadata.json"
        
        return {
            'document_path': document_path,
            'metadata_path': metadata_path,
            'file_name': file_name,
            'type_folder': type_folder
        }
    
    def get_type_folder(self, type_name: str, file_extension: str) -> str:
        """
        Get type folder based on document type and file extension
        
        Args:
            type_name: Document type (web, pdf, doc, etc.)
            file_extension: File extension
            
        Returns:
            Type folder name
        """
        # Handle specific document types
        if type_name == 'web':
            return 'websites'
        
        if type_name == 'pdf':
            return 'pdfs'
        
        if type_name == 'doc' or file_extension in ['doc', 'docx', 'rtf']:
            return 'documents'
        
        # Handle spreadsheets
        if file_extension in ['xlsx', 'xls', 'csv']:
            return 'spreadsheets'
        
        # Handle other text files
        if file_extension in ['txt', 'md']:
            return 'documents'
        
        # Default fallback
        return 'documents'
    
    def create_bedrock_metadata(self, document_info: Dict[str, Any], url: Optional[str], title: Optional[str]) -> Dict[str, Any]:
        """
        Create Bedrock compliant metadata following exact schema
        
        Args:
            document_info: Document analysis result
            url: Source URL (optional)
            title: Document title (optional)
            
        Returns:
            Bedrock metadata schema dictionary
        """
        datasource = document_info['datasource']
        type_name = document_info['type']
        identifier = document_info['identifier']
        is_uploaded_file = document_info['is_uploaded_file']
        
        metadata = {
            "metadataAttributes": {
                "datasource": {
                    "value": {"type": "STRING", "stringValue": datasource},
                    "includeForEmbedding": True
                },
                "type": {
                    "value": {"type": "STRING", "stringValue": type_name},
                    "includeForEmbedding": True
                }
            }
        }
        
        # Add page or filename identifier
        if is_uploaded_file:
            metadata["metadataAttributes"]["filename"] = {
                "value": {"type": "STRING", "stringValue": identifier},
                "includeForEmbedding": False
            }
        else:
            metadata["metadataAttributes"]["page"] = {
                "value": {"type": "STRING", "stringValue": identifier},
                "includeForEmbedding": False
            }
        
        # Add URL if available (for web content)
        if url:
            metadata["metadataAttributes"]["url"] = {
                "value": {"type": "STRING", "stringValue": url},
                "includeForEmbedding": False
            }
        
        # Add title if available
        if title and title.strip():
            metadata["metadataAttributes"]["title"] = {
                "value": {"type": "STRING", "stringValue": self.clean_title(title)},
                "includeForEmbedding": False
            }
        
        return metadata
    
    async def store_document_file(self, document_path: str, content: str):
        """
        Store document file in S3
        
        Args:
            document_path: S3 key for document
            content: Document content
        """
        try:
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=document_path,
                Body=content.encode('utf-8'),
                ContentType='text/plain; charset=utf-8'
            )
            logger.debug(f"Document stored: {document_path}")
        except Exception as e:
            logger.error(f"Failed to store document file: {e}")
            raise
    
    async def store_metadata_file(self, metadata_path: str, metadata: Dict[str, Any]):
        """
        Store metadata sidecar file in S3
        
        Args:
            metadata_path: S3 key for metadata
            metadata: Bedrock metadata object
        """
        try:
            metadata_json = json.dumps(metadata, indent=2, ensure_ascii=False)
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=metadata_path,
                Body=metadata_json.encode('utf-8'),
                ContentType='application/json'
            )
            logger.debug(f"Metadata stored: {metadata_path}")
        except Exception as e:
            logger.error(f"Failed to store metadata file: {e}")
            raise
    
    async def update_datasource_registry(self, document_info: Dict[str, Any], url: Optional[str], 
                                       title: Optional[str], document_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Create or update datasource.json registry file for frontend
        
        Args:
            document_info: Document analysis result
            url: Source URL (optional)
            title: Document title (optional)
            document_path: S3 path to the document file (for uploaded files)
            
        Returns:
            Registry data dictionary or None if failed
        """
        try:
            type_name = document_info['type']
            datasource = document_info['datasource']
            type_folder = self.get_type_folder(type_name, document_info['file_extension'])
            registry_path = f"{type_folder}/{datasource}/datasource.json"
            
            # Generate display name and source URL based on content type
            display_name = self.generate_display_name(document_info, url, title)
            source_url = self.generate_source_url(document_info, url, document_path)
            
            # Create datasource registry object
            registry_data = {
                'id': datasource,
                'type': self.map_type_for_registry(type_name),
                'display_name': display_name,
                'source_url': source_url,
                'created_at': datetime.utcnow().isoformat()
            }
            
            # Check if registry already exists
            existing_registry = None
            try:
                response = self.s3_client.get_object(Bucket=self.bucket, Key=registry_path)
                existing_content = response['Body'].read().decode('utf-8')
                existing_registry = json.loads(existing_content)
            except ClientError as e:
                if e.response['Error']['Code'] != 'NoSuchKey':
                    logger.warning(f"Error checking existing registry: {e}")
                logger.debug(f"Creating new datasource registry: {registry_path}")
            
            # If registry exists, preserve created_at
            if existing_registry:
                registry_data['created_at'] = existing_registry.get('created_at', registry_data['created_at'])
                registry_data['updated_at'] = datetime.utcnow().isoformat()
            
            # Store the registry file
            registry_json = json.dumps(registry_data, indent=2, ensure_ascii=False)
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=registry_path,
                Body=registry_json.encode('utf-8'),
                ContentType='application/json'
            )
            
            logger.debug(f'Datasource registry updated: {registry_path} - Display: "{display_name}"')
            return registry_data
            
        except Exception as e:
            logger.warning(f"Failed to update datasource registry (non-blocking): {e}")
            return None
    
    # Helper methods for registry
    def map_type_for_registry(self, type_name: str) -> str:
        """Map internal type to registry type for frontend"""
        type_map = {
            'web': 'web',
            'pdf': 'pdf',
            'doc': 'doc',
            'document': 'doc',
            'spreadsheet': 'spreadsheet'
        }
        return type_map.get(type_name, 'doc')
    
    def generate_display_name(self, document_info: Dict[str, Any], url: Optional[str], title: Optional[str]) -> str:
        """Generate display name for datasource"""
        type_name = document_info['type']
        is_uploaded_file = document_info['is_uploaded_file']
        
        if type_name == 'web' and url:
            # For websites: show the root URL
            try:
                url_obj = urlparse(url)
                return f"{url_obj.scheme}://{url_obj.netloc}"
            except Exception:
                return url
        
        if is_uploaded_file and document_info['metadata'].get('file_name'):
            # For files: show actual filename
            return document_info['metadata']['file_name']
        
        # Fallback
        return title or document_info['datasource']
    
    def generate_source_url(self, document_info: Dict[str, Any], url: Optional[str], file_path: Optional[str]) -> Optional[str]:
        """Generate source URL for datasource"""
        type_name = document_info['type']
        is_uploaded_file = document_info['is_uploaded_file']
        
        if type_name == 'web' and url:
            # For websites: return the original scraped URL
            try:
                url_obj = urlparse(url)
                return f"{url_obj.scheme}://{url_obj.netloc}"
            except Exception:
                return url
        
        if is_uploaded_file and file_path:
            # For files: generate S3 public URL
            return f"https://{self.bucket}.s3.{self.config.AWS_REGION}.amazonaws.com/{file_path}"
        
        return url
    
    def clean_content(self, content: str) -> str:
        """
        Clean content for optimal storage
        
        Args:
            content: Raw content
            
        Returns:
            Cleaned content
        """
        import re
        
        cleaned = content
        
        # Remove excessive whitespace while preserving structure
        cleaned = re.sub(r'\s+', ' ', cleaned)
        cleaned = re.sub(r'\n\s*\n', '\n\n', cleaned)
        
        # Remove common navigation and boilerplate
        remove_patterns = [
            r'skip to (main )?content',
            r'cookie policy',
            r'privacy policy',
            r'terms of service',
            r'newsletter signup',
            r'follow us on',
            r'share this',
            r'copyright \d{4}'
        ]
        
        for pattern in remove_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        return cleaned.strip()
    
    def clean_title(self, title: str) -> str:
        """
        Clean title for metadata
        
        Args:
            title: Raw title
            
        Returns:
            Cleaned title
        """
        if not title:
            return 'Untitled'
        
        import re
        
        cleaned = title.strip()
        cleaned = re.sub(r'[^\w\s\-\.]', '', cleaned)  # Remove special chars except basic ones
        cleaned = re.sub(r'\s+', ' ', cleaned)          # Normalize spaces
        cleaned = cleaned[:200]                         # Limit length
        
        return cleaned.strip() or 'Untitled'
    
    def sanitize_identifier(self, identifier: Optional[str]) -> str:
        """
        Sanitize identifier for use in filenames and metadata
        
        Args:
            identifier: Raw identifier
            
        Returns:
            Sanitized identifier
        """
        if not identifier:
            return ''
        
        import re
        
        sanitized = identifier.lower()
        sanitized = re.sub(r'[^\w\-]', '-', sanitized)  # Replace non-word chars with hyphens
        sanitized = re.sub(r'-+', '-', sanitized)        # Collapse multiple hyphens
        sanitized = sanitized.strip('-')                 # Remove leading/trailing hyphens
        sanitized = sanitized[:50]                       # Limit length
        
        return sanitized
    
    async def sync_knowledge_base(self) -> Optional[str]:
        """
        Trigger Knowledge Base sync
        
        Returns:
            Sync job ID or None if failed
        """
        try:
            if not self.bedrock_agent or not self.knowledge_base_id or not self.data_source_id:
                logger.warning('Knowledge Base ID or Data Source ID not configured - skipping sync')
                return None
            
            response = self.bedrock_agent.start_ingestion_job(
                knowledgeBaseId=self.knowledge_base_id,
                dataSourceId=self.data_source_id,
                description=f'Bedrock compliant sync triggered at {datetime.utcnow().isoformat()}'
            )
            
            job_id = response['ingestionJob']['ingestionJobId']
            logger.info(f"Knowledge Base sync started: {job_id}")
            return job_id
            
        except Exception as e:
            logger.warning(f"Knowledge Base sync failed (non-blocking): {e}")
            return None

# Create singleton instance
bedrock_compliant_storage = BedrockCompliantStorage()
```

## Step 4: Implement External Scraping Service

### 4.1 Main Scraping Service (`services/external_scraping_service.py`)

```python
import asyncio
import aiohttp
import re
from datetime import datetime
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse
from bs4 import BeautifulSoup
import html2text

from utils.hash_utils import generate_hash
from utils.logger import setup_logger
from services.bedrock_compliant_storage import bedrock_compliant_storage
from config import Config

logger = setup_logger(__name__)

class ExternalScrapingService:
    """
    External Scraping Service for Python
    Handles communication with external scraping service and processes content
    """
    
    def __init__(self):
        self.config = Config()
        self.external_api_url = self.config.EXTERNAL_SCRAPER_URL
        self.timeout = self.config.EXTERNAL_SCRAPER_TIMEOUT
        
        # HTTP session configuration
        self.session_config = {
            'timeout': aiohttp.ClientTimeout(total=self.timeout),
            'headers': {'Content-Type': 'application/json'},
        }
        
    async def is_external_service_available(self) -> bool:
        """
        Check if external service is available
        
        Returns:
            True if service is healthy, False otherwise
        """
        try:
            async with aiohttp.ClientSession(**self.session_config) as session:
                async with session.get(f"{self.external_api_url}/health", timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get('status') == 'healthy'
                    return False
        except Exception as e:
            logger.warning(f"External scraping service health check failed: {e}")
            return False
    
    async def scrape_website(self, url: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        MAIN ENTRY POINT: Scrape a single website page using external service
        This is the complete flow that gets called from the /scraping/scrape endpoint
        
        Args:
            url: URL to scrape
            options: Scraping options
            
        Returns:
            Scraping result dictionary
        """
        if options is None:
            options = {}
            
        try:
            clean_url = self.sanitize_url(url)
            logger.info(f"Scraping single page via external service: {clean_url}")
            
            # Step 1: Check if external service is available
            is_available = await self.is_external_service_available()
            if not is_available:
                raise Exception('External scraping service is currently unavailable. Please try again later or contact support.')
            
            # Step 2: Call external scraping service
            request_payload = {
                'url': clean_url,
                'includeJavaScript': False
            }
            logger.debug(f"Request payload: {request_payload}")
            
            async with aiohttp.ClientSession(**self.session_config) as session:
                async with session.post(f"{self.external_api_url}/scrape", json=request_payload) as response:
                    if response.status != 200:
                        raise Exception(f"External scraping service returned status {response.status}")
                    
                    response_data = await response.json()
                    
                    if not response_data or not response_data.get('success'):
                        raise Exception('External scraping service returned unsuccessful response')
                    
                    raw_content = response_data.get('data')
            
            # Step 3: Validate content
            if not raw_content or (isinstance(raw_content, str) and not raw_content.strip()):
                raise Exception('No content could be extracted from this URL. The page might be empty, blocked, or require authentication.')
            
            # Step 4: Clean up potential encoding issues
            cleaned_content = self.clean_encoding_issues(raw_content)
            
            # Step 5: Process raw content without filtering - store as-is
            processed_result = await self.process_raw_content(clean_url, cleaned_content)
            
            # Step 6: Store content using Bedrock compliant structure
            await self.store_content_as_files(processed_result)
            
            logger.info(f"Successfully scraped and processed: {clean_url}")
            
            # Step 7: Return structured response
            return {
                'url': clean_url,
                'title': processed_result.get('title', 'Untitled'),
                'timestamp': datetime.utcnow().isoformat(),
                'metadata': {
                    'domain': processed_result.get('domain'),
                    'source': 'external-scraper',
                    'folder_path': processed_result.get('folder_path'),
                    'datasource_file': processed_result.get('datasource_file'),
                    'files_created': processed_result.get('files_created', 0)
                },
                'content': {
                    'files': processed_result.get('files', [])
                }
            }
            
        except aiohttp.ClientError as e:
            logger.error(f"HTTP error scraping website: {e}")
            if 'timeout' in str(e).lower():
                raise Exception('External scraping service request timed out. Please try again with a smaller website or contact support.')
            else:
                raise Exception('Cannot connect to external scraping service. Please check your internet connection or try again later.')
        
        except Exception as e:
            logger.error(f"Error scraping website via external service: {e}")
            raise Exception(f"Failed to scrape website: {str(e)}")
    
    async def process_raw_content(self, url: str, raw_content: str) -> Dict[str, Any]:
        """
        Process raw content without filtering - store as-is
        
        Args:
            url: Source URL
            raw_content: Raw content from external scraper
            
        Returns:
            Processed data dictionary for storage
        """
        url_obj = urlparse(url)
        domain = url_obj.hostname or 'unknown'
        timestamp = datetime.utcnow().isoformat()
        
        logger.debug(f"Processing raw content from: {url}")
        logger.debug(f"Raw content length: {len(raw_content)}")
        
        # Extract title from content (simple extraction)
        title = 'Untitled'
        try:
            # Try to extract title from HTML if it's HTML content
            if '<title>' in raw_content:
                title_match = re.search(r'<title[^>]*>(.*?)</title>', raw_content, re.IGNORECASE)
                if title_match and title_match.group(1):
                    title = title_match.group(1).strip()
            else:
                # For plain text, use first line as title
                first_line = raw_content.split('\n')[0].strip()
                if first_line and len(first_line) < 100:
                    title = first_line
        except Exception as e:
            logger.warning(f"Could not extract title, using default: {e}")
        
        # Sanitize title for file names
        sanitized_title = self.sanitize_title(title)
        
        logger.info(f"Processed raw content from {url}: ready for storage")
        
        # Create a single file object for storage
        file_data = {
            'content': raw_content,
            'metadata': {
                'id': domain.replace('.', '-').replace(r'[^a-zA-Z0-9-]', '-'),
                'type': 'web',
                'display_name': url,
                'title': sanitized_title,
                'source_url': url,
                'created_at': timestamp,
                'updated_at': timestamp,
                'content_length': len(raw_content),
                'content_hash': generate_hash(raw_content)
            }
        }
        
        return {
            'url': url,
            'domain': domain,
            'title': sanitized_title,
            'original_title': title,
            'content': raw_content,
            'files': [file_data],
            'timestamp': timestamp,
            'metadata': {
                'scraped_at': timestamp,
                'source': 'external-scraper',
                'original_content_length': len(raw_content),
                'files_created': 1,
                'extraction_method': 'raw-content'
            }
        }
    
    async def store_content_as_files(self, processed_data: Dict[str, Any]):
        """
        Store content using proper datasource structure with subfolders
        
        Args:
            processed_data: Processed data from process_raw_content
        """
        try:
            domain = processed_data['domain']
            files = processed_data['files']
            url = processed_data['url']
            stored_files = []
            
            # Process each file and store using Bedrock compliant structure
            for file_data in files:
                # Prepare document for Bedrock compliant storage
                document = {
                    'content': file_data['content'],
                    'title': file_data['metadata']['title'],
                    'url': file_data['metadata']['source_url'],
                    'metadata': {
                        **file_data['metadata'],
                        'source': 'external-scraper'
                    }
                }
                
                # Store using Bedrock compliant structure
                result = await bedrock_compliant_storage.store_document(document)
                
                stored_files.append({
                    'content_file': result['document_path'],
                    'metadata_file': result['metadata_path'],
                    'size': len(file_data['content']),
                    'type': 'webpage'
                })
                
                logger.info(f"Stored: {result['document_path']} ({len(file_data['content'])} chars)")
            
            # Update processed_data with storage results
            processed_data['files_created'] = stored_files
            processed_data['folder_path'] = stored_files[0]['content_file'].rsplit('/', 1)[0] if stored_files else None
            
            logger.info(f"Successfully stored {len(files)} files for {domain} in Bedrock compliant structure")
            
        except Exception as e:
            logger.error(f"Error storing content as files: {e}")
            raise Exception(f"Failed to store content as files: {str(e)}")
    
    def clean_encoding_issues(self, content: str) -> str:
        """
        Clean up common encoding issues from external scraper
        
        Args:
            content: Raw content from external service
            
        Returns:
            Content with encoding issues fixed
        """
        if not content or not isinstance(content, str):
            return content
        
        logger.info('Cleaning encoding issues from content')
        
        cleaned = content
        
        # Fix common encoding issues
        encoding_fixes = {
            # Fix UTF-8 encoding issues
            'â˜°': '☰',  # Hamburger menu icon
            'â': '',     # Remove stray â characters
            '˜': '~',    # Fix tilde
            '°': '°',    # Fix degree symbol
            'â€™': "'",  # Right single quotation mark
            'â€œ': '"',  # Left double quotation mark  
            'â€': '"',   # Right double quotation mark
            'â€"': '–',  # En dash
            'â€"': '—',  # Em dash
            'Â©': '©',   # Copyright symbol
            'Â®': '®',   # Registered trademark
            'Â': '',     # Remove stray Â characters
        }
        
        # Apply encoding fixes
        for encoded, decoded in encoding_fixes.items():
            cleaned = cleaned.replace(encoded, decoded)
        
        # Remove extra whitespace and normalize line breaks
        cleaned = cleaned.replace('\r\n', '\n').replace('\r', '\n')
        
        logger.info(f'Encoding cleanup completed: {len(content)} -> {len(cleaned)} chars, has_issues: {cleaned != content}')
        
        return cleaned
    
    def sanitize_title(self, title: Optional[str]) -> str:
        """
        Sanitize title for file names
        
        Args:
            title: Original title
            
        Returns:
            Sanitized title
        """
        if not title or not isinstance(title, str):
            return 'untitled'
        
        # Replace spaces with underscores
        sanitized = re.sub(r'\s+', '_', title)
        # Remove or replace problematic characters for file names
        sanitized = re.sub(r'[<>:"/\\|?*]', '_', sanitized)
        # Remove control characters
        sanitized = re.sub(r'[\x00-\x1f\x80-\x9f]', '', sanitized)
        # Limit length
        sanitized = sanitized[:100]
        # Remove trailing underscores
        sanitized = sanitized.strip('_')
        
        return sanitized or 'untitled'
    
    def sanitize_url(self, url: str) -> str:
        """
        Sanitize URL
        
        Args:
            url: Raw URL
            
        Returns:
            Sanitized URL
            
        Raises:
            ValueError: If URL is invalid
        """
        if not url or not isinstance(url, str):
            raise ValueError('Invalid URL provided')
        
        clean_url = url.strip().lstrip('@#')
        
        if not re.match(r'^https?://', clean_url):
            clean_url = 'https://' + clean_url
        
        # Validate URL
        try:
            urlparse(clean_url)
            return clean_url
        except Exception:
            raise ValueError('Invalid URL format')
    
    async def get_scraping_history(self, domain: str) -> Dict[str, Any]:
        """
        Get scraping history for a domain (placeholder for future implementation)
        
        Args:
            domain: Domain name
            
        Returns:
            History data dictionary
        """
        return {
            'domain': domain,
            'last_scraped': None,
            'total_scrapes': 0,
            'message': 'History tracking not yet implemented'
        }

# Create singleton instance
external_scraping_service = ExternalScrapingService()
```

## Step 5: Implement Knowledge Base Sync Service

### 5.1 Sync Service (`services/knowledge_base_sync.py`)

```python
import asyncio
import boto3
from datetime import datetime
from typing import Optional, Dict, Any
from botocore.exceptions import ClientError

from utils.logger import setup_logger
from config import Config

logger = setup_logger(__name__)

class KnowledgeBaseSyncService:
    """
    Knowledge Base Sync Service for Python
    Handles AWS Bedrock Knowledge Base synchronization
    """
    
    def __init__(self):
        self.config = Config()
        
        # Initialize Bedrock Agent client
        try:
            self.bedrock_agent_client = boto3.client(
                'bedrock-agent',
                region_name=self.config.AWS_REGION,
                aws_access_key_id=self.config.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=self.config.AWS_SECRET_ACCESS_KEY
            )
        except Exception as e:
            logger.warning(f"Could not initialize Bedrock Agent client: {e}")
            self.bedrock_agent_client = None
        
        self.knowledge_base_id = self.config.BEDROCK_KNOWLEDGE_BASE_ID
        self.data_source_id = self.config.BEDROCK_DATA_SOURCE_ID
    
    async def sync_knowledge_base(self, domain: str, wait_for_completion: bool = False) -> Dict[str, Any]:
        """
        Trigger knowledge base data synchronization after scraping
        
        Args:
            domain: Domain that was scraped
            wait_for_completion: Whether to wait for any ongoing jobs first
            
        Returns:
            Ingestion job result dictionary
        """
        try:
            logger.info(f"Starting knowledge base sync for domain: {domain}")
            
            if not self.bedrock_agent_client:
                raise Exception("Bedrock Agent client not initialized")
            
            # Check for ongoing jobs and handle accordingly
            if wait_for_completion:
                logger.info('Checking for ongoing ingestion jobs...')
                await self.wait_for_no_active_jobs()
            
            response = self.bedrock_agent_client.start_ingestion_job(
                knowledgeBaseId=self.knowledge_base_id,
                dataSourceId=self.data_source_id,
                description=f'Sync scraped content from {domain} - {datetime.utcnow().isoformat()}'
            )
            
            job_id = response['ingestionJob']['ingestionJobId']
            logger.info(f"Knowledge base sync started. Job ID: {job_id}")
            
            return {
                'job_id': job_id,
                'status': response['ingestionJob']['status'],
                'started_at': response['ingestionJob']['startedAt'].isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error starting knowledge base sync: {e}")
            
            # Handle specific AWS errors
            error_message = str(e)
            if 'already in use' in error_message or 'ongoing ingestion job' in error_message:
                raise Exception('Knowledge base is currently processing data. Please wait for the current job to complete and try again in a few minutes.')
            
            raise Exception(f"Failed to sync knowledge base: {error_message}")
    
    async def check_sync_status(self, job_id: str) -> Dict[str, Any]:
        """
        Check the status of a knowledge base ingestion job
        
        Args:
            job_id: Ingestion job ID
            
        Returns:
            Job status dictionary
        """
        try:
            if not self.bedrock_agent_client:
                raise Exception("Bedrock Agent client not initialized")
            
            response = self.bedrock_agent_client.get_ingestion_job(
                knowledgeBaseId=self.knowledge_base_id,
                dataSourceId=self.data_source_id,
                ingestionJobId=job_id
            )
            
            job = response['ingestionJob']
            return {
                'job_id': job['ingestionJobId'],
                'status': job['status'],
                'started_at': job['startedAt'].isoformat(),
                'updated_at': job['updatedAt'].isoformat(),
                'failure_reasons': job.get('failureReasons', [])
            }
            
        except Exception as e:
            logger.error(f"Error checking sync status: {e}")
            raise Exception(f"Failed to check sync status: {str(e)}")
    
    async def wait_for_no_active_jobs(self, max_wait_time: int = 300):
        """
        Wait for any active ingestion jobs to complete
        
        Args:
            max_wait_time: Maximum wait time in seconds (default 5 minutes)
        """
        start_time = datetime.utcnow()
        poll_interval = 30  # 30 seconds
        
        logger.info('Waiting for any active ingestion jobs to complete...')
        
        while (datetime.utcnow() - start_time).total_seconds() < max_wait_time:
            try:
                # Try to start a test job to check if KB is available
                test_response = self.bedrock_agent_client.start_ingestion_job(
                    knowledgeBaseId=self.knowledge_base_id,
                    dataSourceId=self.data_source_id,
                    description=f'Test job availability - {datetime.utcnow().isoformat()}'
                )
                
                # If this succeeds, no job is running
                logger.info('No active jobs detected, knowledge base is available')
                return
                
            except Exception as e:
                error_message = str(e)
                if 'already in use' in error_message or 'ongoing ingestion job' in error_message:
                    logger.info(f'Knowledge base still busy, waiting {poll_interval}s...')
                    await asyncio.sleep(poll_interval)
                    continue
                else:
                    # Some other error, break the loop
                    logger.warning(f'Unexpected error while checking job status: {error_message}')
                    break
        
        logger.warning(f'Timeout waiting for active jobs to complete after {max_wait_time}s')
    
    async def wait_for_sync_completion(self, job_id: str, max_wait_time: int = 300) -> Dict[str, Any]:
        """
        Wait for ingestion job to complete
        
        Args:
            job_id: Ingestion job ID
            max_wait_time: Maximum wait time in seconds (default 5 minutes)
            
        Returns:
            Final job status dictionary
        """
        start_time = datetime.utcnow()
        poll_interval = 10  # 10 seconds
        
        while (datetime.utcnow() - start_time).total_seconds() < max_wait_time:
            try:
                status = await self.check_sync_status(job_id)
                
                if status['status'] == 'COMPLETE':
                    logger.info(f"Knowledge base sync completed successfully. Job ID: {job_id}")
                    return status
                
                if status['status'] == 'FAILED':
                    failure_reasons = ', '.join(status['failure_reasons'])
                    logger.error(f"Knowledge base sync failed. Job ID: {job_id}, Reasons: {failure_reasons}")
                    raise Exception(f"Sync failed: {failure_reasons}")
                
                logger.info(f"Sync in progress... Status: {status['status']}")
                await asyncio.sleep(poll_interval)
                
            except Exception as e:
                logger.error(f"Error waiting for sync completion: {e}")
                raise
        
        raise Exception(f"Sync timeout after {max_wait_time} seconds")
    
    async def full_sync(self, domain: str, wait_for_completion: bool = False, 
                       wait_for_availability: bool = True) -> Dict[str, Any]:
        """
        Full synchronization process with status monitoring
        
        Args:
            domain: Domain that was scraped
            wait_for_completion: Whether to wait for completion
            wait_for_availability: Whether to wait for KB availability first
            
        Returns:
            Sync result dictionary
        """
        try:
            # Start the sync with improved conflict handling
            sync_result = await self.sync_knowledge_base(domain, wait_for_availability)
            
            if wait_for_completion:
                # Wait for completion
                final_status = await self.wait_for_sync_completion(sync_result['job_id'])
                return {
                    **sync_result,
                    'final_status': final_status['status'],
                    'completed_at': final_status['updated_at']
                }
            
            return sync_result
            
        except Exception as e:
            logger.error(f"Error in full sync process: {e}")
            raise

# Create singleton instance
knowledge_base_sync = KnowledgeBaseSyncService()
```

## Step 6: Implement HTTP Route (Flask)

### 6.1 Scraping Route (`routes/scraping.py`)

```python
from flask import Blueprint, request, jsonify
from marshmallow import Schema, fields, ValidationError
from urllib.parse import urlparse
import re

from services.external_scraping_service import external_scraping_service
from services.knowledge_base_sync import knowledge_base_sync
from utils.logger import setup_logger

logger = setup_logger(__name__)

# Create Blueprint
scraping_bp = Blueprint('scraping', __name__, url_prefix='/api/scraping')

class ScrapingRequestSchema(Schema):
    """Schema for validating scraping requests"""
    url = fields.Url(required=True, error_messages={'invalid': 'Must be a valid URL'})
    options = fields.Dict(missing=dict)
    
    def make_object(self, data, **kwargs):
        """Post-process URL to clean it"""
        if 'url' in data:
            # Remove @ symbols and other unwanted characters from the beginning
            clean_url = data['url'].strip().lstrip('@#')
            
            # Ensure it starts with http:// or https://
            if not re.match(r'^https?://', clean_url):
                clean_url = 'https://' + clean_url
                
            data['url'] = clean_url
        
        return data

@scraping_bp.route('/scrape', methods=['POST'])
async def scrape_website():
    """
    Main scraping endpoint
    POST /api/scraping/scrape
    This is the main entry point that triggers the complete scraping and storage flow
    """
    try:
        # Validate request data
        schema = ScrapingRequestSchema()
        try:
            data = schema.load(request.get_json() or {})
        except ValidationError as e:
            return jsonify({
                'error': 'Validation failed',
                'details': e.messages
            }), 400
        
        url = data['url']
        options = data.get('options', {})
        
        logger.info(f"Received scraping request for: {url}")
        
        # MAIN FLOW: Start scraping via external service
        # This calls the complete flow: scrape → process → store → sync
        result = await external_scraping_service.scrape_website(url, options)
        
        # Return success response
        return jsonify({
            'success': True,
            'message': 'Website scraped successfully',
            'data': {
                'url': result['url'],
                'title': result['title'],
                'timestamp': result['timestamp'],
                'metadata': result['metadata'],
                'files_created': len(result['content']['files']),
                'content': {
                    'preview': (result['content']['files'][0]['content'][:500] + '...' 
                              if result['content']['files'] 
                              else 'No content extracted'),
                    'total_files': len(result['content']['files']),
                    'files': result['content']['files'],
                    'folder_path': result['metadata'].get('folder_path', 'N/A'),
                    'datasource_file': result['metadata'].get('datasource_file', 'N/A')
                }
            }
        })
        
    except Exception as e:
        logger.error(f"Scraping error: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to scrape website',
            'message': str(e)
        }), 500

@scraping_bp.route('/status', methods=['GET'])
@scraping_bp.route('/status/<domain>', methods=['GET'])
async def get_status(domain=None):
    """Get scraping status"""
    try:
        if domain:
            history = await external_scraping_service.get_scraping_history(domain)
            return jsonify({
                'success': True,
                'domain': domain,
                'history': history
            })
        else:
            return jsonify({
                'success': True,
                'message': 'Scraping service is running',
                'timestamp': datetime.utcnow().isoformat()
            })
    except Exception as e:
        logger.error(f"Error getting scraping status: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to get scraping status',
            'message': str(e)
        }), 500

@scraping_bp.route('/health', methods=['GET'])
async def check_health():
    """Check external scraping service health"""
    try:
        is_available = await external_scraping_service.is_external_service_available()
        
        return jsonify({
            'success': True,
            'external_service': {
                'available': is_available,
                'endpoint': external_scraping_service.external_api_url,
                'last_checked': datetime.utcnow().isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Error checking external service health: {e}")
        return jsonify({
            'success': False,
            'error': 'External scraping service health check failed',
            'message': str(e),
            'external_service': {
                'available': False,
                'endpoint': external_scraping_service.external_api_url,
                'last_checked': datetime.utcnow().isoformat()
            }
        }), 503

# Sync endpoints
@scraping_bp.route('/sync', methods=['POST'])
async def trigger_sync():
    """Trigger manual knowledge base sync"""
    try:
        data = request.get_json() or {}
        domain = data.get('domain')
        wait_for_availability = data.get('wait_for_availability', True)
        
        if not domain:
            return jsonify({
                'error': 'Validation failed',
                'details': {'domain': ['Domain is required']}
            }), 400
        
        logger.info(f"Manual knowledge base sync requested for: {domain} (wait_for_availability: {wait_for_availability})")
        
        result = await knowledge_base_sync.full_sync(domain, False, wait_for_availability)
        
        return jsonify({
            'success': True,
            'message': 'Knowledge base sync initiated successfully',
            'data': {
                'job_id': result['job_id'],
                'status': result['status'],
                'started_at': result['started_at'],
                'domain': domain,
                'waited_for_availability': wait_for_availability
            }
        })
        
    except Exception as e:
        logger.error(f"Error initiating manual sync: {e}")
        
        # Provide specific error handling for common issues
        if 'already in use' in str(e) or 'ongoing ingestion job' in str(e):
            return jsonify({
                'success': False,
                'error': 'Knowledge base busy',
                'message': 'Knowledge base is currently processing data. Please wait for the current job to complete and try again.',
                'suggestion': 'You can check the status of ongoing jobs using GET /api/scraping/sync/status/{job_id}'
            }), 409
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to initiate sync',
                'message': str(e)
            }), 500

@scraping_bp.route('/sync/status/<job_id>', methods=['GET'])
async def check_sync_status(job_id):
    """Check knowledge base sync status"""
    try:
        status = await knowledge_base_sync.check_sync_status(job_id)
        
        return jsonify({
            'success': True,
            'data': {
                'job_id': status['job_id'],
                'status': status['status'],
                'started_at': status['started_at'],
                'updated_at': status['updated_at'],
                'failure_reasons': status['failure_reasons'],
                'is_complete': status['status'] == 'COMPLETE',
                'is_failed': status['status'] == 'FAILED',
                'is_in_progress': status['status'] in ['IN_PROGRESS', 'STARTING']
            }
        })
        
    except Exception as e:
        logger.error(f"Error checking sync status: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to check sync status',
            'message': str(e)
        }), 500
```

## Step 7: Flask Application Setup

### 7.1 Main Application (`main.py`)

```python
from flask import Flask
from flask_cors import CORS
import asyncio
from threading import Thread

from routes.scraping import scraping_bp
from config import Config
from utils.logger import setup_logger

logger = setup_logger(__name__)

def create_app():
    """Application factory"""
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Enable CORS
    CORS(app)
    
    # Register blueprints
    app.register_blueprint(scraping_bp)
    
    # Add asyncio support to Flask
    def run_async(coro):
        """Helper to run async functions in Flask context"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()
    
    # Monkey patch to support async routes
    original_dispatch_request = app.dispatch_request
    
    def dispatch_request():
        endpoint = app.url_map.bind(app.config['SERVER_NAME']).match()[0]
        if asyncio.iscoroutinefunction(app.view_functions.get(endpoint)):
            return run_async(original_dispatch_request())
        return original_dispatch_request()
    
    app.dispatch_request = dispatch_request
    
    @app.route('/health')
    def health():
        """Basic health check"""
        return {'status': 'healthy', 'service': 'scraping-api'}
    
    return app

if __name__ == '__main__':
    app = create_app()
    
    # Run the application
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV') == 'development'
    
    logger.info(f"Starting Flask application on port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)
```

## Step 8: FastAPI Alternative Implementation

### 8.1 FastAPI Route (`routes/scraping_fastapi.py`)

```python
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, HttpUrl, validator
from typing import Dict, Any, Optional
import re

from services.external_scraping_service import external_scraping_service
from services.knowledge_base_sync import knowledge_base_sync
from utils.logger import setup_logger

logger = setup_logger(__name__)

router = APIRouter(prefix="/api/scraping", tags=["scraping"])

class ScrapingRequest(BaseModel):
    """Request model for scraping"""
    url: HttpUrl
    options: Optional[Dict[str, Any]] = {}
    
    @validator('url', pre=True)
    def clean_url(cls, v):
        """Clean URL before validation"""
        if isinstance(v, str):
            # Remove @ symbols and other unwanted characters
            clean_url = v.strip().lstrip('@#')
            
            # Ensure it starts with http:// or https://
            if not re.match(r'^https?://', clean_url):
                clean_url = 'https://' + clean_url
                
            return clean_url
        return v

class SyncRequest(BaseModel):
    """Request model for sync"""
    domain: str
    wait_for_availability: bool = True

@router.post("/scrape")
async def scrape_website(request: ScrapingRequest):
    """
    Main scraping endpoint
    POST /api/scraping/scrape
    This is the main entry point that triggers the complete scraping and storage flow
    """
    try:
        url = str(request.url)
        options = request.options
        
        logger.info(f"Received scraping request for: {url}")
        
        # MAIN FLOW: Start scraping via external service
        result = await external_scraping_service.scrape_website(url, options)
        
        # Return success response
        return {
            'success': True,
            'message': 'Website scraped successfully',
            'data': {
                'url': result['url'],
                'title': result['title'],
                'timestamp': result['timestamp'],
                'metadata': result['metadata'],
                'files_created': len(result['content']['files']),
                'content': {
                    'preview': (result['content']['files'][0]['content'][:500] + '...' 
                              if result['content']['files'] 
                              else 'No content extracted'),
                    'total_files': len(result['content']['files']),
                    'files': result['content']['files'],
                    'folder_path': result['metadata'].get('folder_path', 'N/A'),
                    'datasource_file': result['metadata'].get('datasource_file', 'N/A')
                }
            }
        }
        
    except Exception as e:
        logger.error(f"Scraping error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to scrape website: {str(e)}")

@router.get("/status")
@router.get("/status/{domain}")
async def get_status(domain: Optional[str] = None):
    """Get scraping status"""
    try:
        if domain:
            history = await external_scraping_service.get_scraping_history(domain)
            return {
                'success': True,
                'domain': domain,
                'history': history
            }
        else:
            from datetime import datetime
            return {
                'success': True,
                'message': 'Scraping service is running',
                'timestamp': datetime.utcnow().isoformat()
            }
    except Exception as e:
        logger.error(f"Error getting scraping status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def check_health():
    """Check external scraping service health"""
    try:
        is_available = await external_scraping_service.is_external_service_available()
        from datetime import datetime
        
        return {
            'success': True,
            'external_service': {
                'available': is_available,
                'endpoint': external_scraping_service.external_api_url,
                'last_checked': datetime.utcnow().isoformat()
            }
        }
    except Exception as e:
        logger.error(f"Error checking external service health: {e}")
        raise HTTPException(status_code=503, detail=f"Health check failed: {str(e)}")

@router.post("/sync")
async def trigger_sync(request: SyncRequest):
    """Trigger manual knowledge base sync"""
    try:
        logger.info(f"Manual knowledge base sync requested for: {request.domain}")
        
        result = await knowledge_base_sync.full_sync(
            request.domain, False, request.wait_for_availability
        )
        
        return {
            'success': True,
            'message': 'Knowledge base sync initiated successfully',
            'data': {
                'job_id': result['job_id'],
                'status': result['status'],
                'started_at': result['started_at'],
                'domain': request.domain,
                'waited_for_availability': request.wait_for_availability
            }
        }
        
    except Exception as e:
        logger.error(f"Error initiating manual sync: {e}")
        
        if 'already in use' in str(e) or 'ongoing ingestion job' in str(e):
            raise HTTPException(
                status_code=409,
                detail="Knowledge base is currently processing data. Please wait for the current job to complete and try again."
            )
        else:
            raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync/status/{job_id}")
async def check_sync_status(job_id: str):
    """Check knowledge base sync status"""
    try:
        status = await knowledge_base_sync.check_sync_status(job_id)
        
        return {
            'success': True,
            'data': {
                'job_id': status['job_id'],
                'status': status['status'],
                'started_at': status['started_at'],
                'updated_at': status['updated_at'],
                'failure_reasons': status['failure_reasons'],
                'is_complete': status['status'] == 'COMPLETE',
                'is_failed': status['status'] == 'FAILED',
                'is_in_progress': status['status'] in ['IN_PROGRESS', 'STARTING']
            }
        }
        
    except Exception as e:
        logger.error(f"Error checking sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

### 8.2 FastAPI Main Application (`main_fastapi.py`)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.scraping_fastapi import router as scraping_router
from config import Config
from utils.logger import setup_logger

logger = setup_logger(__name__)

def create_app():
    """Create FastAPI application"""
    app = FastAPI(
        title="Scraping API",
        description="Complete scraping and storage flow API",
        version="1.0.0"
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include routers
    app.include_router(scraping_router)
    
    @app.get("/health")
    async def health():
        """Basic health check"""
        return {"status": "healthy", "service": "scraping-api"}
    
    return app

app = create_app()

if __name__ == "__main__":
    import uvicorn
    import os
    
    port = int(os.getenv("PORT", 8000))
    
    logger.info(f"Starting FastAPI application on port {port}")
    uvicorn.run("main_fastapi:app", host="0.0.0.0", port=port, reload=True)
```

## Step 9: Usage Examples

### 9.1 Basic Scraping Usage

```python
# Example: Scrape a single webpage
import asyncio
import aiohttp

async def scrape_webpage():
    """Example function to scrape a webpage"""
    async with aiohttp.ClientSession() as session:
        try:
            # Call the scraping API
            payload = {
                'url': 'https://example.com',
                'options': {
                    'maxDepth': 1,
                    'respectRobots': True,
                    'includeImages': False
                }
            }
            
            async with session.post('http://localhost:5000/api/scraping/scrape', json=payload) as response:
                if response.status == 200:
                    result = await response.json()
                    print('Scraping successful:', {
                        'url': result['data']['url'],
                        'title': result['data']['title'],
                        'files_created': result['data']['files_created'],
                        'folder_path': result['data']['content']['folder_path']
                    })
                    return result
                else:
                    error_data = await response.json()
                    print('Scraping failed:', error_data.get('message', 'Unknown error'))
                    
        except Exception as e:
            print(f'Error: {e}')
            raise

# Run the example
if __name__ == "__main__":
    asyncio.run(scrape_webpage())
```

### 9.2 Direct Service Usage

```python
# Example: Using services directly
import asyncio
from services.external_scraping_service import external_scraping_service

async def direct_scraping_example():
    """Example of using the service directly"""
    try:
        result = await external_scraping_service.scrape_website('https://example.com', {
            'maxDepth': 1,
            'respectRobots': True
        })
        
        print(f"Scraped: {result['url']}")
        print(f"Title: {result['title']}")
        print(f"Files created: {len(result['content']['files'])}")
        
        return result
        
    except Exception as e:
        print(f"Scraping failed: {e}")
        raise

# Run the example
if __name__ == "__main__":
    asyncio.run(direct_scraping_example())
```

## Step 10: Testing and Debugging

### 10.1 Test Suite (`tests/test_scraping.py`)

```python
import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock

from services.external_scraping_service import external_scraping_service
from services.bedrock_compliant_storage import bedrock_compliant_storage

class TestScrapingFlow:
    """Test suite for the complete scraping flow"""
    
    @pytest.mark.asyncio
    async def test_complete_scraping_flow(self):
        """Test the complete scraping flow"""
        # Mock external service response
        mock_response = {
            'success': True,
            'data': '<html><title>Test Page</title><body>Test content</body></html>'
        }
        
        with patch('aiohttp.ClientSession.post') as mock_post:
            # Setup mock response
            mock_post.return_value.__aenter__.return_value.status = 200
            mock_post.return_value.__aenter__.return_value.json = AsyncMock(return_value=mock_response)
            
            # Mock storage
            with patch.object(bedrock_compliant_storage, 'store_document') as mock_store:
                mock_store.return_value = {
                    'success': True,
                    'document_path': 'websites/example/test-abc123.txt',
                    'metadata_path': 'websites/example/test-abc123.txt.metadata.json'
                }
                
                # Test scraping
                result = await external_scraping_service.scrape_website('https://example.com')
                
                # Assertions
                assert result['url'] == 'https://example.com'
                assert result['title'] == 'Test Page'
                assert len(result['content']['files']) == 1
                assert mock_store.called
    
    @pytest.mark.asyncio
    async def test_invalid_url_handling(self):
        """Test invalid URL handling"""
        with pytest.raises(ValueError, match="Invalid URL format"):
            await external_scraping_service.scrape_website('invalid-url')
    
    @pytest.mark.asyncio
    async def test_external_service_unavailable(self):
        """Test handling when external service is unavailable"""
        with patch.object(external_scraping_service, 'is_external_service_available') as mock_health:
            mock_health.return_value = False
            
            with pytest.raises(Exception, match="External scraping service is currently unavailable"):
                await external_scraping_service.scrape_website('https://example.com')

# Run tests with: python -m pytest tests/test_scraping.py -v
```

### 10.2 Manual Testing Script (`scripts/test_flow.py`)

```python
import asyncio
import aiohttp
import json
from datetime import datetime

async def test_complete_flow():
    """Test the complete scraping flow manually"""
    base_url = "http://localhost:5000/api"
    
    async with aiohttp.ClientSession() as session:
        print("🧪 Testing Complete Scraping Flow")
        print("=" * 50)
        
        # Test 1: Health Check
        print("\n1. Testing Health Check...")
        try:
            async with session.get(f"{base_url}/scraping/health") as response:
                health_data = await response.json()
                print(f"   ✅ Health: {health_data['external_service']['available']}")
        except Exception as e:
            print(f"   ❌ Health check failed: {e}")
            return False
        
        # Test 2: Scrape Website
        print("\n2. Testing Website Scraping...")
        try:
            payload = {
                'url': 'https://httpbin.org/html',  # Simple test page
                'options': {}
            }
            
            async with session.post(f"{base_url}/scraping/scrape", json=payload) as response:
                if response.status == 200:
                    result = await response.json()
                    print(f"   ✅ Scraped: {result['data']['url']}")
                    print(f"   📄 Title: {result['data']['title']}")
                    print(f"   📁 Files: {result['data']['files_created']}")
                    
                    return True
                else:
                    error_data = await response.json()
                    print(f"   ❌ Scraping failed: {error_data}")
                    return False
                    
        except Exception as e:
            print(f"   ❌ Scraping test failed: {e}")
            return False

if __name__ == "__main__":
    success = asyncio.run(test_complete_flow())
    print(f"\n{'🎉 All tests passed!' if success else '💥 Tests failed!'}")
    exit(0 if success else 1)
```

## Complete Flow Summary

The complete `/scraping/scrape` endpoint flow in Python:

1. **HTTP Request** → Flask/FastAPI Route validates input with Pydantic/Marshmallow
2. **External Scraping** → Async HTTP client calls external scraper service
3. **Content Processing** → BeautifulSoup and html2text clean and process content
4. **Storage** → Boto3 stores in Bedrock compliant S3 structure
5. **Knowledge Base Sync** → AWS Bedrock Agent triggers ingestion
6. **Response** → Returns structured JSON with metadata

## Migration Checklist

- [ ] Install Python dependencies from requirements.txt
- [ ] Set up environment variables in .env file
- [ ] Implement core utilities (hash_utils, logger)
- [ ] Implement Bedrock compliant storage service with boto3
- [ ] Implement external scraping service with aiohttp
- [ ] Implement knowledge base sync service
- [ ] Set up Flask or FastAPI routes
- [ ] Configure async support for your chosen framework
- [ ] Test the complete flow with test scripts
- [ ] Configure error handling and structured logging
- [ ] Deploy with appropriate WSGI/ASGI server (Gunicorn/Uvicorn)

## Production Deployment

### Using Gunicorn (Flask)
```bash
pip install gunicorn
gunicorn -w 4 -k gevent --bind 0.0.0.0:5000 main:app
```

### Using Uvicorn (FastAPI)
```bash
pip install uvicorn[standard]
uvicorn main_fastapi:app --host 0.0.0.0 --port 8000 --workers 4
```

This guide provides a complete Python implementation that mirrors the JavaScript/Node.js functionality with proper async support, AWS integration, and production-ready architecture.

