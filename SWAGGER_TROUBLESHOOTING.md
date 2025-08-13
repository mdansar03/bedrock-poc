# Swagger API Documentation - Troubleshooting Guide

## 🚨 Common Issues and Solutions

### 1. CORS Error: "Not allowed by CORS"

**Problem**: Getting CORS error when accessing Swagger UI or API endpoints.

**Solution**: 
```bash
# Error example:
{
  "error": "Internal server error",
  "message": "Not allowed by CORS: http://localhost:3002"
}
```

**Fix**: Update your environment configuration to include the server's own URL:

```env
# In your .env file:
CORS_ORIGINS=http://localhost:3002,http://localhost:5173,http://localhost:3000
```

Or for single frontend:
```env
FRONTEND_URL=http://localhost:5173
```

**Note**: The fix has been applied to `server.js` to automatically include the server's own URL.

### 2. Port Already in Use (EADDRINUSE)

**Problem**: 
```
Error: listen EADDRINUSE: address already in use :::3002
```

**Solutions**:

#### Option A: Kill existing Node processes
```powershell
# Windows PowerShell
taskkill /F /IM node.exe

# Or find specific process
netstat -ano | findstr :3002
taskkill /F /PID <process_id>
```

```bash
# Linux/Mac
sudo lsof -t -i tcp:3002 | xargs kill -9
```

#### Option B: Use different port
```env
# In .env file
PORT=3003
```

### 3. Swagger UI Not Loading

**Problem**: Swagger UI shows blank page or loading indefinitely.

**Solutions**:

1. **Check server logs** for errors:
```bash
npm start
# Look for any startup errors
```

2. **Verify endpoints**:
```bash
# Test if server is running
curl http://localhost:3002/api/health

# Test if Swagger JSON is accessible
curl http://localhost:3002/api-docs/swagger.json
```

3. **Check browser console** for JavaScript errors

4. **Clear browser cache** and try again

### 4. Missing API Endpoints in Swagger

**Problem**: Some endpoints don't appear in Swagger documentation.

**Solutions**:

1. **Check JSDoc syntax** in route files:
```javascript
/**
 * @swagger
 * /api/endpoint:
 *   get:
 *     summary: Description
 *     tags: [Category]
 *     responses:
 *       200:
 *         description: Success
 */
```

2. **Verify route files are included** in `src/config/swagger.js`:
```javascript
apis: [
  './src/routes/*.js',
  './server.js'
]
```

3. **Restart server** after adding new documentation

### 5. API Testing Fails in Swagger UI

**Problem**: "Try it out" functionality returns errors.

**Solutions**:

1. **CORS Configuration**: Ensure your server URL is in CORS origins
2. **Authentication**: If using auth, configure it in Swagger UI
3. **Request Format**: Check request body format matches schema
4. **Server Running**: Verify API server is actually running

### 6. Schema Validation Errors

**Problem**: Request/response schemas show validation errors.

**Solutions**:

1. **Check YAML indentation** in JSDoc comments
2. **Verify schema references**:
```javascript
schema:
  $ref: '#/components/schemas/YourSchema'
```

3. **Validate OpenAPI syntax** using online validators

### 7. Environment-Specific Issues

#### Development Environment
```env
NODE_ENV=development
CORS_ORIGINS=http://localhost:3002,http://localhost:5173
API_BASE_URL=http://localhost:3002
```

#### Production Environment
```env
NODE_ENV=production
CORS_ORIGINS=https://yourdomain.com,https://api.yourdomain.com
API_BASE_URL=https://api.yourdomain.com
```

## 🔧 Quick Diagnostic Commands

### Check if server is running:
```bash
curl http://localhost:3002/api/health
```

### Test Swagger UI accessibility:
```bash
curl http://localhost:3002/api-docs/
```

### Check OpenAPI specification:
```bash
curl http://localhost:3002/api-docs/swagger.json
```

### View server logs:
```bash
npm start
# Watch for startup messages and errors
```

## 🌐 Browser Testing

1. **Open Swagger UI**: http://localhost:3002/api-docs
2. **Check browser console** (F12) for errors
3. **Test an endpoint** using "Try it out"
4. **Verify CORS headers** in Network tab

## 📞 Getting Help

If issues persist:

1. **Check server logs** for detailed error messages
2. **Verify environment variables** are set correctly
3. **Test with curl/Postman** to isolate Swagger UI issues
4. **Review the main guide**: `SWAGGER_API_DOCUMENTATION_GUIDE.md`

## ✅ Success Indicators

You know everything is working when:

- ✅ Swagger UI loads at http://localhost:3002/api-docs
- ✅ All API endpoints are visible and documented
- ✅ "Try it out" functionality works without CORS errors
- ✅ Health check returns status 200
- ✅ No errors in server logs or browser console

---

## 🚀 Restart Steps After Configuration Changes

1. Stop the server (Ctrl+C or kill process)
2. Update environment variables
3. Restart with `npm start`
4. Test Swagger UI accessibility
5. Verify CORS configuration is working