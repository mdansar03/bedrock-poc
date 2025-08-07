import React, { useState, useRef, useEffect } from 'react'
import { MessageCircle, Send, User, Bot, Loader, ExternalLink, TestTube } from 'lucide-react'
import { chatAPI } from '../utils/api'

const ChatPage = () => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      content: 'Hello! I\'m your AI assistant. I can help you find information from the websites you\'ve scraped. What would you like to know?',
      timestamp: new Date().toISOString()
    }
  ])
  const [inputMessage, setInputMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [selectedModel, setSelectedModel] = useState(null)
  const [availableModels, setAvailableModels] = useState({})
  
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    loadAvailableModels()
  }, [])

  const loadAvailableModels = async () => {
    try {
      const response = await chatAPI.getModels()
      setAvailableModels(response.data.models)
      setSelectedModel(response.data.defaultModel)
    } catch (error) {
      console.error('Failed to load available models:', error)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleKnowledgeBaseTest = async () => {
    setLoading(true)
    
    const testMessage = {
      id: Date.now(),
      type: 'user',
      content: 'Testing knowledge base connectivity...',
      timestamp: new Date().toISOString()
    }
    
    setMessages(prev => [...prev, testMessage])
    
    try {
      const response = await chatAPI.testKnowledgeBase()
      
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: `Knowledge Base Test Result:\n\n${response.data.answer}`,
        sources: response.data.sources,
        timestamp: new Date().toISOString(),
        isTest: true
      }
      
      setMessages(prev => [...prev, botMessage])
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: `Knowledge Base Test Failed: ${error.response?.data?.message || error.message}`,
        error: true,
        timestamp: new Date().toISOString(),
        isTest: true
      }
      
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!inputMessage.trim() || loading) return

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: inputMessage.trim(),
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInputMessage('')
    setLoading(true)

    try {
      const response = await chatAPI.sendMessage(userMessage.content, sessionId, selectedModel)
      
      // Update session ID if we got a new one from the server
      if (response.data.sessionId && response.data.sessionId !== sessionId) {
        setSessionId(response.data.sessionId)
      }
      
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: response.data.answer,
        sources: response.data.sources,
        model: response.data.model,
        timestamp: new Date().toISOString()
      }

      setMessages(prev => [...prev, botMessage])
    } catch (error) {
      console.error('Chat error:', error)
      
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: 'I apologize, but I encountered an error while processing your message. Please try again.',
        error: true,
        timestamp: new Date().toISOString()
      }

      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <MessageCircle className="w-8 h-8 text-blue-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900">AI Chat</h1>
          </div>
          <button
            onClick={handleKnowledgeBaseTest}
            disabled={loading}
            className="btn-secondary flex items-center space-x-2"
          >
            <TestTube size={18} />
            <span>Test Knowledge Base</span>
          </button>
        </div>
        <p className="text-gray-600">
          Ask questions about your scraped content. I'll use the knowledge base to provide accurate answers.
        </p>
      </div>

      {/* Chat Container */}
      <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex max-w-3xl ${message.type === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 ${message.type === 'user' ? 'ml-3' : 'mr-3'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    message.type === 'user' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {message.type === 'user' ? <User size={18} /> : <Bot size={18} />}
                  </div>
                </div>

                {/* Message Content */}
                <div className={`flex flex-col ${message.type === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-4 py-2 rounded-lg ${
                    message.type === 'user'
                      ? 'bg-blue-600 text-white'
                      : message.error
                      ? 'bg-red-50 text-red-900 border border-red-200'
                      : 'bg-gray-100 text-gray-900'
                  }`}>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    
                    {/* Sources */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <p className="text-sm font-medium mb-2">Sources:</p>
                        <div className="space-y-1">
                          {message.sources.map((source, index) => (
                            <div key={index} className="text-sm">
                              <a
                                href={source.url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center text-blue-300 hover:text-blue-100"
                              >
                                <ExternalLink size={12} className="mr-1" />
                                {source.title || `Source ${index + 1}`}
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Timestamp */}
                  <span className="text-xs text-gray-500 mt-1">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="flex">
                <div className="flex-shrink-0 mr-3">
                  <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center">
                    <Bot size={18} />
                  </div>
                </div>
                <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg">
                  <div className="flex items-center space-x-1">
                    <Loader size={16} className="animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Model Selection and Input Form */}
        <div className="border-t border-gray-200 p-4">
          {/* Model Selection */}
          <div className="mb-3 flex items-center space-x-4">
            <label htmlFor="model-select" className="text-sm font-medium text-gray-700">
              Model:
            </label>
            <select
              id="model-select"
              value={selectedModel || ''}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={loading}
            >
              {Object.entries(availableModels).map(([key, model]) => (
                <option key={key} value={model.id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-500">
              {availableModels[Object.keys(availableModels).find(key => availableModels[key].id === selectedModel)]?.provider}
            </span>
          </div>
          
          <form onSubmit={handleSubmit} className="flex space-x-4">
            <input
              ref={inputRef}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Ask me anything about your scraped content..."
              className="input-field flex-1"
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim()}
              className="btn-primary flex items-center space-x-2"
            >
              {loading ? (
                <Loader size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
          
          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>Session ID: {sessionId || 'New session will be created'}</span>
            <span>Model: {availableModels[Object.keys(availableModels).find(key => availableModels[key].id === selectedModel)]?.name || 'Default'}</span>
          </div>
        </div>
      </div>

      {/* Instructions */}
      {messages.length === 1 && (
        <div className="mt-6 card bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Tips for better conversations</h3>
          <div className="space-y-2 text-sm text-gray-600">
            <p>• Ask specific questions about products, recipes, classes, and detailed content from scraped websites</p>
            <p>• Reference specific products by name, ingredients from recipes, or class details</p>
            <p>• Use different AI models for varied response styles and capabilities</p>
            <p>• Ask for summaries, comparisons, or detailed explanations about structured data</p>
            <p>• Query about prices, specifications, instructions, or any detailed information</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatPage