# Complete S3 Folder Structure & Datasource Registry Implementation

## 🎯 Implementation Complete

This document provides the complete implementation of your S3 folder structure with datasource.json registry system for frontend filtering and agent-based querying.

---

## 📁 S3 Folder Structure (Now Implemented)

Your S3 bucket now follows this exact structure:

```
knowledge-base/
├── websites/
│   ├── ansar-portfolio/
│   │   ├── datasource.json          ← Frontend registry
│   │   ├── about.txt
│   │   ├── about.metadata.json
│   │   ├── projects.txt
│   │   └── projects.metadata.json
│   ├── recipe-site/
│   │   ├── datasource.json
│   │   ├── main-page.txt
│   │   └── main-page.metadata.json
├── pdfs/
│   ├── recipe-book-1/
│   │   ├── datasource.json
│   │   ├── chapter-1.txt
│   │   └── chapter-1.metadata.json
│   └── recipe-book-2/
│       ├── datasource.json
│       └── ...
├── documents/
│   ├── company-policies/
│   │   ├── datasource.json
│   │   └── file1.docx
├── spreadsheets/
│   └── finance-q1/
│       ├── datasource.json
│       └── file1.xlsx
└── raw-content/                       ← Optional staging (existing)
```

### Rules Applied

✅ **Folder name = datasource ID** → Used in backend filtering  
✅ **datasource.json** → Registry for frontend display  
✅ **Content files + metadata** → Used by Bedrock KB for embeddings  
✅ **Agent filtering** → Works through datasource metadata attributes  

---

## 🗂️ datasource.json Structure (Implemented)

Each datasource folder contains a `datasource.json` file:

```json
{
  "id": "ansar-portfolio",               // folder name = datasource
  "type": "web",                         // web / pdf / doc / spreadsheet
  "display_name": "Ansar Portfolio",     // friendly name for frontend
  "source_url": "https://ansar-portfolio.pages.dev/", // original website link
  "created_at": "2025-01-28T10:00:00Z",
  "updated_at": "2025-01-28T12:30:00Z"   // added when registry is updated
}
```

### Frontend Behavior

✅ **Loads only datasource.json files** → Displays exactly one entry per datasource  
✅ **Passes the ID as dataSources** → Keeps filtering intact  
✅ **Supports all 4 types**: websites, pdfs, documents, spreadsheets  

---

## 🏷️ Metadata for Agent Filtering (Implemented)

Each content file has a `.metadata.json` sidecar:

```json
{
  "metadataAttributes": {
    "datasource": {
      "value": {"type": "STRING", "stringValue": "ansar-portfolio"},
      "includeForEmbedding": true
    },
    "type": {
      "value": {"type": "STRING", "stringValue": "web"},
      "includeForEmbedding": true
    },
    "page": {
      "value": {"type": "STRING", "stringValue": "about"},
      "includeForEmbedding": false
    },
    "url": {
      "value": {"type": "STRING", "stringValue": "https://ansar-portfolio.pages.dev/about"},
      "includeForEmbedding": false
    },
    "title": {
      "value": {"type": "STRING", "stringValue": "About Me Page"},
      "includeForEmbedding": false
    }
  }
}
```

### Key Features

✅ **"datasource"** → Folder name = filter key  
✅ **Sub-pages** stay inside datasource folder → Automatic filtering inclusion  
✅ **No sub-page exposure** to frontend → Clean datasource-level display  

---

## 🔧 Backend Implementation Details

### 1. Enhanced BedrockCompliantStorage Service

**Location**: `src/services/bedrockCompliantStorage.js`

**New Methods Added**:
- `updateDatasourceRegistry()` - Creates/updates datasource.json files
- `getAllDatasources()` - Fetches all datasource.json files for frontend
- `getDatasourcesByType()` - Gets datasources for specific type folder
- `mapTypeForRegistry()` - Maps internal types to frontend types
- `generateDisplayName()` - Creates human-friendly display names

**Enhanced storeDocument() Method**:
Now automatically creates/updates datasource.json when storing documents.

### 2. New API Endpoints

**Location**: `src/routes/bedrockStorage.js`

```javascript
// Get all datasources (from datasource.json files)
GET /api/bedrock-storage/datasources

// Get datasources by type  
GET /api/bedrock-storage/datasources/by-type/:type

// Get documents by datasource (existing)
GET /api/bedrock-storage/datasources/:datasource/documents
```

### 3. Frontend Updates

**Location**: `frontend/src/components/DataSourceSelector.jsx`

**Changes Made**:
- Updated to use new `bedrockStorageAPI.getAllDatasources()`
- Added support for spreadsheets (4th type)
- Updated data structure handling for datasource.json format
- Enhanced UI with new icons and colors for spreadsheets

**New API Service**: `frontend/src/utils/api.js`
- Added `bedrockStorageAPI` with all new endpoint methods
- Maintained backward compatibility with existing `dataManagementAPI`

---

## 🚀 How to Use the New System

### For Users (Frontend)

1. **Data Source Selection**:
   - Open any chat page with filtering
   - Click "Filter by data sources" dropdown  
   - See clean list organized by: Websites, PDFs, Documents, Spreadsheets
   - Select datasources (not individual files)
   - Selected datasources filter ALL content within that datasource

2. **What You'll See**:
   - **Websites**: Display names like "Ansar Portfolio" (from display_name)
   - **PDFs**: Document names like "Recipe Book 1" 
   - **Documents**: File names like "Company Policies"
   - **Spreadsheets**: Sheet names like "Finance Q1"

### For Developers (Backend)

1. **Storing New Content**:
   ```javascript
   // Content is automatically organized and registry is updated
   await bedrockCompliantStorage.storeDocument({
     content: "Document content...",
     title: "Page Title",
     url: "https://example.com/page", // for web content
     metadata: { /* existing metadata */ }
   });
   ```

2. **Getting Datasources for Frontend**:
   ```javascript
   // New endpoint - returns datasource.json files
   GET /api/bedrock-storage/datasources
   
   // Response format:
   {
     "success": true,
     "data": {
       "count": 5,
       "datasources": [
         {
           "id": "ansar-portfolio",
           "type": "web", 
           "display_name": "Ansar Portfolio",
           "source_url": "https://ansar-portfolio.pages.dev/",
           "created_at": "2025-01-28T10:00:00Z",
           "s3_key": "websites/ansar-portfolio/datasource.json",
           "type_folder": "websites"
         }
       ]
     }
   }
   ```

3. **Agent Filtering**:
   ```javascript
   // Send message with datasource filtering
   agentAPI.sendEnhancedMessage({
     message: "What are the recipes?",
     dataSources: {
       websites: ["recipe-site"],
       pdfs: ["recipe-book-1"], 
       documents: [],
       spreadsheets: []
     }
   });
   ```

---

## 🔍 Testing the Implementation

### 1. Test Document Storage

```bash
# Store a test document
curl -X POST http://localhost:3002/api/bedrock-storage/test-document \
  -H "Content-Type: application/json" \
  -d '{
    "content": "This is a test website page about recipes.",
    "title": "Recipe Collection", 
    "url": "https://recipes.example.com/main",
    "type": "web"
  }'
```

**Expected**: 
- Document stored in `websites/recipes/` folder
- Metadata sidecar created
- `datasource.json` created/updated

### 2. Test Frontend Datasource Loading

```bash
# Get all datasources
curl http://localhost:3002/api/bedrock-storage/datasources
```

**Expected**:
```json
{
  "success": true,
  "data": {
    "count": 1,
    "datasources": [
      {
        "id": "recipes",
        "type": "web",
        "display_name": "Recipes",
        "source_url": "https://recipes.example.com/main",
        "created_at": "2025-01-28T10:00:00Z"
      }
    ]
  }
}
```

### 3. Test Type-Specific Queries

```bash
# Get only website datasources
curl http://localhost:3002/api/bedrock-storage/datasources/by-type/websites

# Get only PDF datasources  
curl http://localhost:3002/api/bedrock-storage/datasources/by-type/pdfs
```

### 4. Test Frontend Component

1. Open the chat page in your browser
2. Look for the "Filter by data sources" dropdown
3. Should see organized sections: Websites, PDFs, Documents, Spreadsheets
4. Select a datasource and send a message
5. Verify filtering works correctly

---

## 📋 Verification Checklist

✅ **S3 Structure**: Type folders → Datasource folders → Content + metadata  
✅ **Registry System**: datasource.json files created automatically  
✅ **Frontend Loading**: New API endpoints working  
✅ **UI Updated**: All 4 types supported with proper icons  
✅ **Agent Filtering**: Datasource filtering preserved  
✅ **Backward Compatibility**: Existing functionality maintained  

---

## 🎉 Summary

**What's New**:
1. **Automatic datasource.json registry** - No manual management needed
2. **Clean frontend datasource selection** - One entry per datasource  
3. **Spreadsheet support** - 4th content type fully implemented
4. **Enhanced APIs** - New endpoints for datasource management
5. **Improved UX** - Better names, icons, and organization

**What's Preserved**:
1. **Existing agent filtering** - dataSources parameter still works
2. **Storage structure** - Bedrock KB compatibility maintained  
3. **Metadata schema** - All filtering capabilities intact
4. **Backend compatibility** - Existing endpoints still functional

**Result**: You now have a production-ready S3 folder structure with automatic registry management that provides excellent UX for both developers and end users! 🚀
