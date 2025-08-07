#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Oralia AI Chatbot Setup');
console.log('==========================');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath)) {
  console.log('📝 Creating .env file...');
  
  const envTemplate = `# AWS Bedrock Configuration
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1

# Server Configuration
PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Logging Configuration
LOG_LEVEL=info

# Use Existing Knowledge Base (Required)
BEDROCK_KNOWLEDGE_BASE_ID=ULMW8DTS1N
BEDROCK_DATA_SOURCE_ID=LZQRKHBV2M
BEDROCK_S3_BUCKET=oralia-bedrock-poc 
CREATE_NEW_KB_RESOURCES=false

# Optional: Session Configuration
# SESSION_SECRET=your_session_secret_here

# Optional: Rate Limiting Configuration
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Optional: Knowledge Base Configuration
# If you have a pre-configured knowledge base, add its ID here
# KNOWLEDGE_BASE_ID=your_knowledge_base_id_here

# Optional: Default Model Configuration
# DEFAULT_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# Optional: File Upload Configuration
MAX_FILE_SIZE=10485760
UPLOAD_DIR=uploads`;

  fs.writeFileSync(envPath, envTemplate);
  console.log('✅ .env file created successfully!');
  console.log('⚠️  Please update the AWS credentials in .env file');
} else {
  console.log('✅ .env file already exists');
}

// Check if logs directory exists
const logsPath = path.join(__dirname, 'logs');
if (!fs.existsSync(logsPath)) {
  console.log('📁 Creating logs directory...');
  fs.mkdirSync(logsPath, { recursive: true });
  console.log('✅ Logs directory created');
} else {
  console.log('✅ Logs directory already exists');
}

// Check if uploads directory exists
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  console.log('📁 Creating uploads directory...');
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('✅ Uploads directory created');
} else {
  console.log('✅ Uploads directory already exists');
}

console.log('');
console.log('🎉 Setup complete!');
console.log('');
console.log('Next steps:');
console.log('1. Update your AWS credentials in .env file');
console.log('2. Run: npm install');
console.log('3. Run: cd frontend && npm install');
console.log('4. Run: npm run dev:all');
console.log('');
console.log('The application will be available at:');
console.log('- Backend: http://localhost:3002');
console.log('- Frontend: http://localhost:5173');
console.log('');
console.log('Happy coding! 🚀');