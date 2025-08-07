# Oralia AI Chatbot

A minimal web application for website scraping and AI-powered chatbot functionality using AWS Bedrock and RAG (Retrieval-Augmented Generation).

## Features

- **Website Scraping**: Extract and process content from any website
- **Content Processing**: Automatic content chunking and hashing for delta updates
- **AI Chat**: RAG-powered chatbot using AWS Bedrock Knowledge Base
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS

## Architecture

### Backend
- **Node.js/Express**: REST API server
- **Puppeteer**: Website scraping engine
- **AWS Bedrock**: AI/ML models and knowledge base
- **AWS S3**: Content storage following organized folder structure

### Frontend
- **React**: Modern UI framework
- **Tailwind CSS**: Utility-first styling
- **Vite**: Fast development and build tool

### AWS Services
- **Bedrock Knowledge Base**: RAG implementation
- **Bedrock Runtime**: AI model inference
- **S3**: File storage with organized structure
- **OpenSearch Serverless**: Vector database (managed by Bedrock)

## Prerequisites

1. **AWS Account** with Bedrock access
2. **Node.js** (v18 or higher)
3. **AWS Bedrock Knowledge Base** already set up
4. **S3 Bucket** configured for the knowledge base

## Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd Update-poc-berock
   npm install
   npm run install:all
   ```

2. **Configure environment variables:**
   Create a `.env` file in the root directory with your AWS credentials:
   ```bash
   # AWS Bedrock Configuration
   AWS_ACCESS_KEY_ID=your_access_key_here
   AWS_SECRET_ACCESS_KEY=your_secret_key_here
   AWS_REGION=us-east-1

   # Server Configuration
   PORT=3002
   NODE_ENV=development
   FRONTEND_URL=http://localhost:5173

   # Bedrock Configuration
   BEDROCK_KNOWLEDGE_BASE_ID=your_knowledge_base_id
   BEDROCK_DATA_SOURCE_ID=your_data_source_id
   BEDROCK_S3_BUCKET=your_s3_bucket_name
   ```

3. **Start the application:**
   ```bash
   # Start both backend and frontend
   npm run dev:all

   # Or start separately:
   npm run dev          # Backend only
   npm run dev:frontend # Frontend only
   ```

## Usage

### 1. Website Scraping
1. Navigate to the "Website Scraping" page
2. Enter a website URL
3. Click "Scrape Website"
4. Wait for processing to complete

### 2. AI Chat
1. Navigate to the "AI Chat" page
2. Ask questions about the scraped content
3. The AI will use RAG to provide accurate answers based on your knowledge base

## API Endpoints

### Health
- `GET /api/health` - System health check

### Scraping
- `POST /api/scraping/scrape` - Scrape a website
- `GET /api/scraping/status/:domain?` - Get scraping status

### Chat
- `POST /api/chat/query` - Query with RAG
- `POST /api/chat/direct` - Direct model query
- `GET /api/chat/models` - Available models

## S3 Folder Structure

```
s3://your-bucket-name/
├── raw/
│   └── domain.com/
│       └── YYYY-MM-DD/
│           └── page.html
├── processed/
│   └── domain.com/
│       └── YYYY-MM-DD/
│           └── chunks.json
├── embeddings/
│   └── domain.com/
│       └── YYYY-MM-DD/
│           └── vectors.json
└── metadata/
    └── domain.com/
        └── YYYY-MM-DD/
            └── scraping-log.json
```

## Content Processing Flow

1. **Scraping**: Extract HTML content using Puppeteer
2. **Cleaning**: Remove scripts, styles, and irrelevant elements
3. **Chunking**: Split content into meaningful chunks (200-500 words)
4. **Hashing**: Generate SHA256 hashes for delta detection
5. **Storage**: Save to S3 following organized structure
6. **Embedding**: Generate vectors using Bedrock (when content changes)
7. **Indexing**: Store in OpenSearch for retrieval

## Development

### Project Structure
```
├── src/
│   ├── controllers/     # Request handlers
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   └── utils/           # Utility functions
├── frontend/
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   └── utils/       # Frontend utilities
└── logs/                # Application logs
```

### Adding New Features
1. Backend: Add routes in `src/routes/`
2. Frontend: Add components in `frontend/src/components/`
3. Services: Add business logic in `src/services/`

## Troubleshooting

### Common Issues

1. **Bedrock Access Denied**
   - Ensure your AWS credentials have Bedrock permissions
   - Check if Bedrock is available in your region

2. **Scraping Fails**
   - Check if the website blocks automated access
   - Verify network connectivity

3. **Knowledge Base Not Found**
   - Ensure `BEDROCK_KNOWLEDGE_BASE_ID` is correct
   - Verify the knowledge base exists in your AWS account

### Logs
Check the logs in the `logs/` directory for detailed error information.

## License

MIT License - see LICENSE file for details.