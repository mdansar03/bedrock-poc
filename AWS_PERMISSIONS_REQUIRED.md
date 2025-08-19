# AWS Permissions Required for Bedrock Agent POC

## Overview
This document outlines the complete AWS permissions required to deploy and operate the Bedrock Agent POC application in a new AWS organization. The application is an enterprise-grade AI chatbot with document processing capabilities that integrates multiple AWS services.

## Application Architecture
- **AI Agents**: Amazon Bedrock agents for intelligent conversation handling
- **Knowledge Base**: Document storage and retrieval system using Bedrock Knowledge Base
- **Document Processing**: Automated processing of PDFs, Word docs, and web content
- **API Integrations**: Dynamic Lambda-based action groups for external API connections
- **Data Storage**: S3-based document and metadata management

---

## 1. Amazon Bedrock Permissions

### 1.1 Bedrock Agent Management
**Required for**: Creating, managing, and operating AI agents

```json
{
  "bedrock:CreateAgent",
  "bedrock:GetAgent", 
  "bedrock:UpdateAgent",
  "bedrock:DeleteAgent",
  "bedrock:ListAgents",
  "bedrock:PrepareAgent"
}
```

**Why needed**: The application creates and manages Bedrock agents that serve as the primary interface for user interactions. Agents require preparation after configuration changes.

### 1.2 Bedrock Agent Runtime
**Required for**: Executing agent queries and conversations

```json
{
  "bedrock:InvokeAgent",
  "bedrock:Retrieve",
  "bedrock:RetrieveAndGenerate"
}
```

**Why needed**: Core functionality for processing user queries through the AI agents and retrieving relevant information from knowledge bases.

### 1.3 Bedrock Knowledge Base Management  
**Required for**: Managing document repositories and search capabilities

```json
{
  "bedrock:CreateKnowledgeBase",
  "bedrock:GetKnowledgeBase",
  "bedrock:UpdateKnowledgeBase", 
  "bedrock:DeleteKnowledgeBase",
  "bedrock:ListKnowledgeBases",
  "bedrock:AssociateAgentKnowledgeBase",
  "bedrock:DisassociateAgentKnowledgeBase",
  "bedrock:GetAgentKnowledgeBase",
  "bedrock:UpdateAgentKnowledgeBase"
}
```

**Why needed**: The application manages knowledge bases that store processed document content. Agents must be associated with knowledge bases to access stored information.

### 1.4 Bedrock Data Sources & Ingestion
**Required for**: Processing and indexing documents into knowledge bases

```json
{
  "bedrock:CreateDataSource",
  "bedrock:GetDataSource",
  "bedrock:UpdateDataSource",
  "bedrock:DeleteDataSource",
  "bedrock:ListDataSources",
  "bedrock:StartIngestionJob",
  "bedrock:GetIngestionJob",
  "bedrock:ListIngestionJobs",
  "bedrock:StopIngestionJob"
}
```

**Why needed**: The application processes uploaded documents (PDFs, Word docs, text files) and web-scraped content into searchable knowledge bases through ingestion jobs.

### 1.5 Bedrock Action Groups
**Required for**: Creating custom API integrations and external service connections

```json
{
  "bedrock:CreateAgentActionGroup",
  "bedrock:GetAgentActionGroup",
  "bedrock:UpdateAgentActionGroup",
  "bedrock:DeleteAgentActionGroup", 
  "bedrock:ListAgentActionGroups"
}
```

**Why needed**: Action groups allow agents to interact with external APIs and services. The application dynamically creates Lambda-backed action groups based on user-defined API configurations.

### 1.6 Bedrock Agent Aliases
**Required for**: Managing different versions and environments of agents

```json
{
  "bedrock:CreateAgentAlias",
  "bedrock:GetAgentAlias",
  "bedrock:UpdateAgentAlias",
  "bedrock:DeleteAgentAlias",
  "bedrock:ListAgentAliases"
}
```

**Why needed**: Agent aliases enable versioning and environment management (development, staging, production) for stable agent deployments.

### 1.7 Foundation Model Access
**Required for**: Direct model invocation and embeddings generation

```json
{
  "bedrock:InvokeModel",
  "bedrock:InvokeModelWithResponseStream",
  "bedrock:GetFoundationModel",
  "bedrock:ListFoundationModels"
}
```

**Why needed**: The application uses Claude models for text generation and Titan models for generating embeddings. Direct model access is required for enhanced query processing and content analysis.

---

## 2. Amazon S3 Permissions

### 2.1 S3 Bucket Operations
**Required for**: Managing document storage buckets

```json
{
  "s3:CreateBucket",
  "s3:GetBucketLocation",
  "s3:ListBucket",
  "s3:GetBucketAcl",
  "s3:GetBucketCors",
  "s3:GetBucketPolicy"
}
```

**Why needed**: The application stores documents, processed chunks, and metadata in organized S3 bucket structures. Bucket management is essential for data organization.

### 2.2 S3 Object Operations
**Required for**: Document upload, processing, and retrieval

```json
{
  "s3:GetObject",
  "s3:PutObject",
  "s3:DeleteObject",
  "s3:ListObjects",
  "s3:ListObjectsV2",
  "s3:GetObjectAcl",
  "s3:PutObjectAcl",
  "s3:GetObjectTagging",
  "s3:PutObjectTagging"
}
```

**Why needed**: 
- **Upload**: Store original documents and processed content
- **Processing**: Create optimized chunks for knowledge base ingestion
- **Organization**: Tag and categorize content by domain, type, and metadata
- **Management**: Delete outdated or duplicate content
- **Retrieval**: Access stored documents for display and re-processing

---

## 3. AWS Lambda Permissions

### 3.1 Lambda Function Management
**Required for**: Creating and managing API integration functions

```json
{
  "lambda:CreateFunction",
  "lambda:GetFunction",
  "lambda:UpdateFunctionCode", 
  "lambda:UpdateFunctionConfiguration",
  "lambda:DeleteFunction",
  "lambda:ListFunctions",
  "lambda:InvokeFunction",
  "lambda:AddPermission",
  "lambda:RemovePermission",
  "lambda:GetPolicy"
}
```

**Why needed**: The application automatically generates Lambda functions to handle external API integrations for action groups. Each user-defined API configuration results in a custom Lambda function that processes API calls on behalf of Bedrock agents.

---

## 4. AWS IAM Permissions

### 4.1 IAM Role Management
**Required for**: Creating service roles for AWS resource access

```json
{
  "iam:CreateRole",
  "iam:GetRole",
  "iam:UpdateRole",
  "iam:DeleteRole",
  "iam:ListRoles",
  "iam:AttachRolePolicy",
  "iam:DetachRolePolicy",
  "iam:ListAttachedRolePolicies",
  "iam:PassRole"
}
```

**Why needed**: 
- **Lambda Execution Roles**: Each generated Lambda function requires an execution role
- **Bedrock Service Roles**: Agents need service roles to access knowledge bases and other resources
- **Cross-Service Access**: Secure communication between Bedrock, Lambda, and S3

### 4.2 IAM Policy Management
**Required for**: Creating custom policies for service roles

```json
{
  "iam:CreatePolicy",
  "iam:GetPolicy",
  "iam:ListPolicies"
}
```

**Why needed**: Custom policies are created to grant minimal required permissions to service roles, following security best practices.

---

## 5. AWS STS Permissions

### 5.1 Security Token Service
**Required for**: Identity verification and role assumption

```json
{
  "sts:AssumeRole",
  "sts:GetCallerIdentity"
}
```

**Why needed**: 
- **Identity Verification**: Determine current AWS account context
- **Role Assumption**: Enable services to assume created roles
- **Cross-Account Access**: Support for cross-account resource access if needed

---

## 6. CloudWatch Logs Permissions (Recommended)

### 6.1 Logging and Monitoring
**Required for**: Application monitoring and debugging

```json
{
  "logs:CreateLogGroup",
  "logs:CreateLogStream", 
  "logs:PutLogEvents",
  "logs:DescribeLogGroups",
  "logs:DescribeLogStreams"
}
```

**Why needed**: Essential for monitoring Lambda function execution, debugging API integrations, and tracking application performance.

---

## Resource-Level Permissions

### S3 Resources
```
arn:aws:s3:::your-bedrock-bucket
arn:aws:s3:::your-bedrock-bucket/*
```

### Lambda Resources
```
arn:aws:lambda:*:*:function:oralia-action-group-*
```

### IAM Resources
```
arn:aws:iam::*:role/oralia-*
arn:aws:iam::*:role/*-execution-role
```

---

## Sample IAM Policy Document

### Complete Policy for Application User/Role

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "BedrockFullAccess",
            "Effect": "Allow", 
            "Action": [
                "bedrock:*"
            ],
            "Resource": "*",
            "Condition": {
                "StringEquals": {
                    "aws:RequestedRegion": ["us-east-1", "us-west-2"]
                }
            }
        },
        {
            "Sid": "S3BucketAccess",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject", 
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:GetBucketLocation",
                "s3:GetBucketAcl",
                "s3:PutObjectTagging",
                "s3:GetObjectTagging"
            ],
            "Resource": [
                "arn:aws:s3:::your-bedrock-bucket",
                "arn:aws:s3:::your-bedrock-bucket/*"
            ]
        },
        {
            "Sid": "LambdaManagement",
            "Effect": "Allow",
            "Action": [
                "lambda:CreateFunction",
                "lambda:GetFunction",
                "lambda:UpdateFunctionCode",
                "lambda:UpdateFunctionConfiguration", 
                "lambda:InvokeFunction",
                "lambda:AddPermission",
                "lambda:RemovePermission",
                "lambda:GetPolicy"
            ],
            "Resource": "arn:aws:lambda:*:*:function:oralia-action-group-*"
        },
        {
            "Sid": "IAMRoleManagement", 
            "Effect": "Allow",
            "Action": [
                "iam:CreateRole",
                "iam:GetRole",
                "iam:AttachRolePolicy",
                "iam:PassRole",
                "iam:CreatePolicy",
                "iam:GetPolicy"
            ],
            "Resource": [
                "arn:aws:iam::*:role/oralia-*",
                "arn:aws:iam::*:role/*-execution-role",
                "arn:aws:iam::*:policy/oralia-*"
            ]
        },
        {
            "Sid": "STSAccess",
            "Effect": "Allow", 
            "Action": [
                "sts:AssumeRole",
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        },
        {
            "Sid": "CloudWatchLogs",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams"
            ],
            "Resource": "arn:aws:logs:*:*:log-group:/aws/lambda/oralia-*"
        }
    ]
}
```

---

## Regional Requirements

**Primary Region**: `us-east-1` (US East - N. Virginia)  
**Supported Regions**: The application can be configured for any region where Amazon Bedrock is available.

**Note**: Bedrock service availability varies by region. Ensure the target region supports:
- Bedrock Agents
- Bedrock Knowledge Bases  
- Claude and Titan foundation models

---

## Security Considerations

### Principle of Least Privilege
The requested permissions follow security best practices:
- **Resource-level restrictions** where applicable
- **Condition-based access** for regional limitations
- **Function-specific naming patterns** for generated resources
- **Time-limited sessions** through STS token management

### Data Protection
- All S3 objects can be encrypted at rest
- Lambda functions support environment variable encryption
- Bedrock knowledge bases support customer-managed encryption keys
- All inter-service communication uses AWS's secure transport layer

### Audit and Compliance
- All API calls are logged through CloudTrail (if enabled)
- CloudWatch logs provide detailed execution tracking
- IAM policies support resource-level permissions for audit trails
- Bedrock includes built-in data governance features

---

## Cost Implications

### Primary Cost Centers
1. **Bedrock Model Invocations**: Pay-per-use for Claude/Titan models
2. **Bedrock Knowledge Base**: Storage and query costs
3. **S3 Storage**: Document and processed content storage  
4. **Lambda Execution**: Function invocations for action groups
5. **Data Transfer**: Cross-service data movement within AWS

### Cost Optimization
- Efficient chunking strategies minimize knowledge base storage
- Intelligent caching reduces repeated model invocations
- S3 lifecycle policies for document retention management
- Lambda reserved concurrency to control execution costs

---

## Implementation Timeline

### Phase 1: Core Services (Week 1)
- Bedrock agent and knowledge base permissions
- S3 bucket setup and document storage
- Basic document processing pipeline

### Phase 2: Advanced Features (Week 2)
- Action group creation and Lambda integration
- IAM role automation
- API integration capabilities

### Phase 3: Monitoring & Optimization (Week 3)
- CloudWatch logs and monitoring
- Performance optimization
- Security hardening

---

## Support and Documentation

### AWS Documentation References
- [Amazon Bedrock User Guide](https://docs.aws.amazon.com/bedrock/)
- [Bedrock Agents Developer Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [Bedrock Knowledge Bases Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

### Application-Specific Support
- Environment configuration templates provided
- Automated setup scripts for initial deployment  
- Health check endpoints for service verification
- Comprehensive error handling and logging

---

## Contact Information

For questions about specific permissions or implementation details, please refer to:
- Application documentation in the codebase
- AWS support for service-specific questions
- Internal security team for policy review and approval

---

**Document Version**: 1.0  
**Last Updated**: December 2024  
**Review Schedule**: Quarterly or upon significant application changes
