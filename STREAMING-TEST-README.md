# AWS Bedrock Agent Streaming Test

This directory contains **minimal Python test scripts** to verify if AWS Bedrock Agent streaming works correctly, helping isolate any issues with the Node.js implementation.

## 🎯 Purpose

Test whether AWS returns:
- ✅ **True streaming chunks** (text arrives piece by piece)  
- ❌ **Bulk response** (all text arrives at once, despite `streamFinalResponse=true`)

## 📁 Files

| File | Purpose |
|------|---------|
| `test-streaming-agent.py` | CLI test script with detailed logging |
| `streaming-agent-server.py` | HTTP server with Server-Sent Events |
| `requirements-test.txt` | Python dependencies |
| `test-streaming.sh` | Easy run script (Linux/Mac) |
| `test-streaming.bat` | Easy run script (Windows) |

## 🔧 Setup

### 1. Set Environment Variables

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key  
export BEDROCK_AGENT_ID=your_agent_id
export AWS_REGION=us-east-1
export BEDROCK_AGENT_ALIAS_ID=TSTALIASID  # Optional
```

**Windows:**
```cmd
set AWS_ACCESS_KEY_ID=your_access_key
set AWS_SECRET_ACCESS_KEY=your_secret_key
set BEDROCK_AGENT_ID=your_agent_id
```

### 2. Install Dependencies

```bash
pip install -r requirements-test.txt
```

## 🚀 Running Tests

### Option 1: Easy Scripts

**Linux/Mac:**
```bash
./test-streaming.sh
```

**Windows:**
```cmd
test-streaming.bat
```

### Option 2: Manual Execution

**CLI Test:**
```bash
python3 test-streaming-agent.py
```

**HTTP Server:**
```bash
python3 streaming-agent-server.py
```

**Test HTTP server with curl:**
```bash
curl -X POST http://localhost:3003/stream-agent \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me about kaaylabs services"}'
```

## 🔍 What to Look For

### True Streaming (Good ✅)
```
[12:34:56.123] 📦 CHUNK #1 (at 1250.5ms)
[12:34:56.890] ✅ TEXT CHUNK DECODED: {"length": 15, "preview": "Based on the..."}
🎯 REAL-TIME: Based on the
[12:34:57.100] 📦 CHUNK #2 (at 1500.2ms) 
[12:34:57.200] ✅ TEXT CHUNK DECODED: {"length": 20, "preview": " documentation..."}
🎯 REAL-TIME:  documentation
```

### Bulk Response (Problem ❌)
```
[12:34:56.123] 📦 CHUNK #1 (at 1250.5ms)
[12:34:59.500] ✅ TEXT CHUNK DECODED: {"length": 2000, "preview": "Based on the documentation, KaayLabs offers comprehensive enterprise..."}
🎯 REAL-TIME: [All text arrives at once after 3+ second delay]
```

## 📊 Expected Output Analysis

### If Streaming Works:
- Multiple small chunks (50-200 chars each)
- Chunks arrive with small delays (50-500ms apart)
- Real-time text display shows progressive building

### If Bulk Response:  
- Single large chunk (1000+ chars)
- Long delay before first chunk arrives
- All text appears at once

## 🐛 Troubleshooting

**Error: Missing environment variables**
- Set all required AWS credentials and agent ID

**Error: Agent not found**
- Verify `BEDROCK_AGENT_ID` and `BEDROCK_AGENT_ALIAS_ID`
- Check AWS region matches your agent's region

**Error: Permission denied**
- Ensure AWS credentials have bedrock-agent permissions
- Verify agent is in "Prepared" state

**No chunks received**
- Check agent configuration in AWS console
- Try different test queries
- Verify knowledge base is properly linked

## 🔄 Comparing with Node.js

Run both implementations with the same query:

1. **Python test:** Note chunk count, timing, text distribution
2. **Node.js test:** Compare results from your existing implementation
3. **Analysis:** Identify differences in streaming behavior

If Python shows true streaming but Node.js doesn't, the issue is in the Node.js implementation. If both show bulk responses, it's likely an AWS configuration issue.

## 📝 Example Session

```
==========================================
AWS BEDROCK AGENT STREAMING TEST
==========================================

[12:34:56.123] 🚀 STARTING AWS AGENT STREAMING TEST
[12:34:56.124] 📤 INVOKING AGENT: {"query": "Tell me about kaaylabs services", "stream_final_response": true}
[12:34:56.890] 📡 AWS RESPONSE RECEIVED: {"has_completion": true}
[12:34:56.891] 🔄 PROCESSING STREAMING COMPLETION
[12:34:57.100] 📦 CHUNK #1 (at 210.5ms): {"chunk_keys": ["chunk"], "has_chunk": true}
[12:34:57.101] ✅ TEXT CHUNK DECODED: {"length": 45, "preview": "Based on the information provided, KaayLabs"}
🎯 REAL-TIME: Based on the information provided, KaayLabs[12:34:57.450] 📦 CHUNK #2 (at 560.2ms)
[12:34:57.451] ✅ TEXT CHUNK DECODED: {"length": 38, "preview": " offers a comprehensive suite of enterprise"}
🎯 REAL-TIME:  offers a comprehensive suite of enterprise
[12:34:57.800] 🎉 STREAMING COMPLETED: {"total_chunks": 12, "total_time_ms": "910.5ms"}
✅ Test completed successfully!
```
