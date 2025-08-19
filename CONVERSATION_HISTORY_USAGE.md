# Conversation History Implementation Guide

## Overview
Your Bedrock Agent chat system now includes comprehensive conversation history management. The AI maintains context across conversations while prioritizing current queries, providing more coherent and relevant responses.

## New Features Added

### ✅ **Enhanced Session Management**
- Full conversation history storage (user and assistant messages)
- Session metadata tracking (response times, token usage, topics)
- Automatic cleanup and memory management

### ✅ **History-Aware AI Responses**
- Context-aware query processing
- Configurable history depth and weight
- Prioritizes current query while maintaining conversation flow

### ✅ **History Management APIs**
- Retrieve conversation history
- Clear conversation history
- Session management and monitoring

### ✅ **Updated Agent Instructions**
- History-aware default instructions
- Context handling guidelines for the AI
- Coherent conversation flow management

---

## API Usage Examples

### 1. Basic Chat with History (Auto-Enabled)

**Request:**
```javascript
// Frontend usage
const response = await agentAPI.sendMessage(
  "What are the system requirements?",
  "session-123" // sessionId for conversation continuity
);

console.log(response.data.answer);
console.log(response.data.session.conversationHistory);
```

**Backend API Call:**
```bash
POST /api/chat/agent
{
  "message": "What are the system requirements?",
  "sessionId": "session-123"
}
```

### 2. Chat with Custom History Settings

**Request:**
```javascript
const response = await agentAPI.sendMessageWithHistory({
  message: "Can you elaborate on the installation process?",
  sessionId: "session-123",
  history: {
    enabled: true,
    maxMessages: 8,        // Include last 8 messages (4 exchanges)
    contextWeight: "heavy" // Use more conversation context
  }
});
```

**Backend API Call:**
```bash
POST /api/chat/agent
{
  "message": "Can you elaborate on the installation process?",
  "sessionId": "session-123",
  "history": {
    "enabled": true,
    "maxMessages": 8,
    "contextWeight": "heavy"
  }
}
```

### 3. Chat with All Enhanced Features

**Request:**
```javascript
const response = await agentAPI.sendMessageWithHistory({
  message: "Explain the system architecture in detail",
  sessionId: "session-123",
  model: "anthropic.claude-3-sonnet-20240229-v1:0",
  temperature: 0.7,
  topP: 0.9,
  systemPrompt: "You are a technical documentation expert. Provide detailed, structured responses with examples.",
  history: {
    enabled: true,
    maxMessages: 6,
    contextWeight: "balanced"
  },
  dataSources: {
    websites: ["docs.example.com"],
    pdfs: ["technical-manual"],
    documents: ["architecture-guide"]
  }
});
```

### 4. Retrieve Conversation History

**Request:**
```javascript
// Get full conversation history
const history = await agentAPI.getConversationHistory("session-123", {
  limit: 20,
  includeMetadata: true
});

console.log(history.data.history); // Array of messages
console.log(history.data.metadata); // Session statistics

// Get only recent messages
const recentHistory = await agentAPI.getRecentConversations("session-123", 6);
```

**Backend API Call:**
```bash
GET /api/chat/agent/history/session-123?limit=20&includeMetadata=true
```

### 5. Clear Conversation History

**Request:**
```javascript
const result = await agentAPI.clearConversationHistory("session-123");
console.log(result.message); // "Conversation history cleared successfully"
```

**Backend API Call:**
```bash
DELETE /api/chat/agent/history/session-123
```

### 6. Get All Active Sessions

**Request:**
```javascript
const sessions = await agentAPI.getSessions();
console.log(sessions.data.sessions); // Array of active sessions
console.log(sessions.data.totalSessions); // Total session count
```

---

## History Context Weights

### **Light Context (`contextWeight: "light"`)**
- Minimal conversation history
- Focus on current query
- Best for: Independent questions, quick lookups

### **Balanced Context (`contextWeight: "balanced")` - Default**
- Moderate conversation history
- Good balance between context and current query
- Best for: General conversations, follow-up questions

### **Heavy Context (`contextWeight: "heavy"`)**
- Extensive conversation history
- Maximum context awareness
- Best for: Complex discussions, detailed analysis sessions

---

## Response Structure with History

```javascript
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "answer": "Based on our previous discussion about the system requirements...",
    "citations": [...],
    "session": {
      "messageCount": 5,
      "topics": ["system requirements", "installation", "architecture"],
      "interactionStyle": "technical",
      "conversationHistory": {
        "totalMessages": 10,
        "recentMessages": [
          {
            "id": "msg-1234-abc",
            "timestamp": "2024-12-17T10:30:00Z",
            "type": "user",
            "content": "What are the system requirements?"
          },
          {
            "id": "msg-1235-def",
            "timestamp": "2024-12-17T10:30:15Z",
            "type": "assistant",
            "content": "The system requirements include...",
            "responseTime": 2500,
            "tokensUsed": 150
          }
        ],
        "sessionAge": 1800000,
        "avgResponseTime": 2200
      }
    },
    "metadata": {
      "conversationContextUsed": true,
      "historySettings": {
        "enabled": true,
        "maxMessages": 6,
        "contextWeight": "balanced"
      },
      "inferenceParameters": {
        "temperature": 0.7,
        "topP": 0.9,
        "model": "anthropic.claude-3-sonnet-20240229-v1:0"
      }
    }
  }
}
```

---

## Frontend Integration Examples

### React Component with History

```jsx
import { useState, useEffect } from 'react';
import { agentAPI } from '../utils/api';

function ChatWithHistory() {
  const [sessionId] = useState(`session-${Date.now()}`);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Add user message to UI
    setMessages(prev => [...prev, { type: 'user', content: input }]);
    
    try {
      const response = await agentAPI.sendMessageWithHistory({
        message: input,
        sessionId,
        history: {
          enabled: true,
          maxMessages: 6,
          contextWeight: 'balanced'
        }
      });

      // Add assistant response to UI
      setMessages(prev => [...prev, { 
        type: 'assistant', 
        content: response.data.answer,
        metadata: response.data.metadata 
      }]);

    } catch (error) {
      console.error('Chat error:', error);
    }

    setInput('');
  };

  const clearHistory = async () => {
    try {
      await agentAPI.clearConversationHistory(sessionId);
      setMessages([]);
    } catch (error) {
      console.error('Clear history error:', error);
    }
  };

  return (
    <div>
      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.type}`}>
            {msg.content}
          </div>
        ))}
      </div>
      
      <div className="controls">
        <input 
          value={input} 
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button onClick={sendMessage}>Send</button>
        <button onClick={clearHistory}>Clear History</button>
      </div>
    </div>
  );
}
```

---

## How Conversation Context Works

### 1. **User Message Storage**
When you send a message, it's automatically stored with metadata:
```javascript
{
  type: 'user',
  content: 'Your message here',
  timestamp: '2024-12-17T10:30:00Z',
  metadata: {
    hasDataSourceFilters: false,
    temperature: 0.7,
    // ... other request parameters
  }
}
```

### 2. **Context Building**
Before processing your current query, the system:
- Retrieves recent conversation history
- Formats it with clear role labels
- Adds context weight indicators
- Includes previous topics

### 3. **Enhanced Query Processing**
Your current query is enhanced with context:
```
CONVERSATION CONTEXT:
Previous conversation topics: system requirements, installation

Recent conversation history:
Human: What are the system requirements?
Assistant: The system requirements include Windows 10, 8GB RAM...
[RECENT] Human: What about Linux support?
[RECENT] Assistant: Linux is supported on Ubuntu 20.04+...

CURRENT QUERY: Can you provide installation steps for Linux?

Please answer the current query while being aware of the conversation context above. Prioritize the current query but use the conversation history to provide more relevant and coherent responses.
```

### 4. **Response Storage**
The AI's response is stored with performance metrics:
```javascript
{
  type: 'assistant',
  content: 'AI response here',
  timestamp: '2024-12-17T10:30:15Z',
  responseTime: 2500,
  tokensUsed: 150,
  metadata: {
    citationCount: 3,
    conversationContextUsed: true,
    // ... other response metadata
  }
}
```

---

## Best Practices

### **For General Conversations**
```javascript
await agentAPI.sendMessageWithHistory({
  message: userInput,
  sessionId: sessionId,
  history: {
    enabled: true,
    maxMessages: 6,
    contextWeight: 'balanced'
  }
});
```

### **For Technical Deep-Dives**
```javascript
await agentAPI.sendMessageWithHistory({
  message: userInput,
  sessionId: sessionId,
  history: {
    enabled: true,
    maxMessages: 10,
    contextWeight: 'heavy'
  },
  temperature: 0.3, // More focused responses
  systemPrompt: "You are a technical expert. Build upon previous technical discussions."
});
```

### **For Independent Queries**
```javascript
await agentAPI.sendMessageWithHistory({
  message: userInput,
  sessionId: sessionId,
  history: {
    enabled: false // Disable history for independent questions
  }
});
```

---

## Migration from Previous Version

### **Old Format:**
```javascript
const response = await agentAPI.sendMessage(message, sessionId, options, dataSources);
```

### **New Format (Backward Compatible):**
```javascript
// Still works - uses default history settings
const response = await agentAPI.sendMessage(message, sessionId, {
  dataSources: dataSources,
  ...options
});

// Enhanced version with history control
const response = await agentAPI.sendMessageWithHistory({
  message,
  sessionId,
  dataSources,
  history: { enabled: true, maxMessages: 6, contextWeight: 'balanced' },
  ...options
});
```

---

## Monitoring and Analytics

### **Session Analytics**
```javascript
const sessions = await agentAPI.getSessions();

sessions.data.sessions.forEach(session => {
  console.log(`Session ${session.sessionId}:`);
  console.log(`- Messages: ${session.conversationLength}`);
  console.log(`- Topics: ${session.topics.join(', ')}`);
  console.log(`- Avg Response Time: ${session.metadata.avgResponseTime}ms`);
  console.log(`- Total Tokens: ${session.metadata.totalTokensUsed}`);
});
```

### **Conversation Analysis**
```javascript
const history = await agentAPI.getConversationHistory(sessionId, {
  includeMetadata: true
});

// Analyze conversation patterns
const userMessages = history.data.history.filter(msg => msg.type === 'user');
const assistantMessages = history.data.history.filter(msg => msg.type === 'assistant');

console.log('Conversation Analysis:');
console.log(`- Total exchanges: ${Math.min(userMessages.length, assistantMessages.length)}`);
console.log(`- Avg response time: ${history.data.metadata.avgResponseTime}ms`);
console.log(`- Total tokens used: ${history.data.metadata.totalTokensUsed}`);
```

---

## Configuration Options

### **Environment Variables** (No changes needed)
Your existing configuration still works:
```bash
BEDROCK_AGENT_ID=your_agent_id
BEDROCK_AGENT_ALIAS_ID=your_alias_id
BEDROCK_KNOWLEDGE_BASE_ID=your_kb_id
```

### **Runtime Configuration**
History is enabled by default but can be controlled per request:
```javascript
// Default behavior (history enabled)
await agentAPI.sendMessage(message, sessionId);

// Explicit control
await agentAPI.sendMessage(message, sessionId, {
  history: {
    enabled: false, // Disable for this request
    maxMessages: 8,
    contextWeight: 'light'
  }
});
```

---

## Troubleshooting

### **History Not Working**
1. Check that sessionId is consistent across requests
2. Verify agent instructions are updated (use `/api/agent-instructions/update-default`)
3. Confirm history is enabled in request options

### **Memory Issues**
- History is automatically limited to 50 messages per session
- Sessions clean up automatically after 30 minutes of inactivity
- Use `clearConversationHistory()` to manually reset sessions

### **Performance Optimization**
- Use `contextWeight: 'light'` for faster responses
- Reduce `maxMessages` for less context overhead
- Monitor token usage through the metadata

---

## Summary

Your Bedrock Agent now provides:

1. **🧠 Intelligent Context Awareness** - Remembers and builds upon previous conversations
2. **⚡ Flexible History Control** - Configure how much context to include per request  
3. **📊 Rich Analytics** - Track conversation metrics and session data
4. **🔄 Seamless Integration** - Backward compatible with existing code
5. **🎯 Prioritized Responses** - Current query takes precedence while maintaining context

The AI will now provide more coherent, contextual responses while still prioritizing your current question. Perfect for building conversational applications that feel natural and intelligent!
