# Simplified Datasource API - Single Endpoint

## ✅ **Implementation Complete**

I have cleaned up the Bedrock Storage API to include only the essential endpoint you need:

### 📡 **Single API Endpoint**

#### **GET /api/bedrock-storage/datasources**

**Purpose**: Get all datasource registries for frontend components

**URL**: `http://localhost:3002/api/bedrock-storage/datasources`

**Method**: `GET`

**Response Example**:
```json
{
  "success": true,
  "message": "Datasources retrieved successfully",
  "data": {
    "count": 4,
    "datasources": [
      {
        "id": "ansar-portfolio",
        "type": "web",
        "display_name": "https://ansar-portfolio.pages.dev",
        "source_url": "https://ansar-portfolio.pages.dev",
        "created_at": "2025-01-28T17:42:25.391Z",
        "s3_key": "websites/ansar-portfolio/datasource.json",
        "type_folder": "websites"
      },
      {
        "id": "recipe-book",
        "type": "pdf",
        "display_name": "RecipeBook_Vegan_2023.pdf",
        "source_url": "https://bucket.s3.amazonaws.com/pdfs/recipe-book/RecipeBook_Vegan_2023.pdf",
        "created_at": "2025-01-28T18:15:30.123Z",
        "s3_key": "pdfs/recipe-book/datasource.json", 
        "type_folder": "pdfs"
      }
    ]
  }
}
```

---

## 🎯 **What This API Does**

1. **Scans all datasource.json files** across all type folders (websites/, pdfs/, documents/, spreadsheets/)
2. **Returns frontend-friendly data** with exact display names
3. **Provides complete metadata** for each datasource including:
   - Datasource ID (for agent filtering)
   - Display name (exact URL for websites, filename for files)
   - Source URL (original URL or S3 URL)
   - Creation/update timestamps
   - Type folder location

---

## 🔧 **Display Name Rules**

✅ **Websites**: Show exact scraped URL origin  
✅ **PDFs**: Show actual filename (e.g., "Manual_2024.pdf")  
✅ **Documents**: Show actual filename (e.g., "Report.docx")  
✅ **Spreadsheets**: Show actual filename (e.g., "Data.xlsx")  

---

## 🚀 **Usage**

### Simple Fetch
```javascript
fetch('http://localhost:3002/api/bedrock-storage/datasources')
  .then(response => response.json())
  .then(data => {
    console.log('Datasources:', data.data.datasources);
  });
```

### With Error Handling
```javascript
async function getDatasources() {
  try {
    const response = await fetch('/api/bedrock-storage/datasources');
    const data = await response.json();
    
    if (data.success) {
      return data.data.datasources;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to get datasources:', error);
    return [];
  }
}
```

---

## 📱 **Frontend Integration**

This endpoint is already integrated with your `DataSourceSelector` component through:
```javascript
import { bedrockStorageAPI } from '../utils/api';

// In your component
const datasources = await bedrockStorageAPI.getAllDatasources();
```

---

## 🔍 **Testing**

### Quick Test
```bash
curl http://localhost:3002/api/bedrock-storage/datasources
```

### Swagger UI
Navigate to: `http://localhost:3002/api-docs`
- Find "Bedrock Storage" section
- Test the single `/datasources` endpoint interactively

---

## 📋 **Summary**

**What's Available**:
- ✅ **1 Essential API endpoint** for getting all datasources
- ✅ **Complete Swagger documentation** with examples
- ✅ **Frontend integration** ready to use
- ✅ **Exact display names** as you specified

**What's Removed**:
- ❌ All unnecessary endpoints (stats, sync, test, etc.)
- ❌ Complex documentation for unused features
- ❌ Redundant API routes

**Result**: Clean, focused API with exactly what you need - just the datasources endpoint with proper display name formatting! 🎯
