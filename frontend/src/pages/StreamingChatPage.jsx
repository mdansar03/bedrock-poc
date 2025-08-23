import React, { useState, useRef, useEffect } from "react";
import {
  MessageCircle,
  Send,
  User,
  Bot,
  Loader,
  ExternalLink,
  TestTube,
  Settings,
  Zap,
  Globe,
  FileText,
  File,
  Activity,
  Pause,
  Play,
  Square,
} from "lucide-react";
import DataSourceSelector from "../components/DataSourceSelector";
import { EnhancedHTMLContent } from "../components/HTMLContent";

const StreamingChatPage = () => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "bot",
      content: "Hello! I'm your AI assistant with streaming responses. Ask me anything and watch the response appear in real-time!",
      timestamp: new Date().toISOString(),
      isStreaming: false,
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMode, setStreamingMode] = useState("agent"); // 'agent', 'direct', 'knowledge-base'
  const [currentStream, setCurrentStream] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  
  // Streaming settings
  const [streamingSettings, setStreamingSettings] = useState({
    model: "anthropic.claude-3-sonnet-20240229-v1:0",
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1000,
    systemPrompt: "You are a helpful AI assistant. Format your responses using proper HTML markup with headings (h2, h3), paragraphs (p), lists (ul/ol/li), emphasis (strong/em), and code tags for technical terms. Structure content clearly with HTML hierarchy for optimal readability.",
  });
  
  // History configuration
  const [historyConfig, setHistoryConfig] = useState({
    enabled: true,
    maxMessages: 6,
    contextWeight: "balanced"
  });

  // Enhanced Agent Mode - enabled by default
  const [useEnhancedAgent, setUseEnhancedAgent] = useState(true);
  
  const [selectedDataSources, setSelectedDataSources] = useState({
    websites: [],
    pdfs: [],
    documents: [],
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [streamingStats, setStreamingStats] = useState({
    totalTime: 0,
    charactersReceived: 0,
    wordsPerSecond: 0,
    tokensUsed: 0,
  });

  // Available models for streaming
  const availableModels = [
    { id: "anthropic.claude-3-sonnet-20240229-v1:0", name: "Claude 3 Sonnet", provider: "Anthropic" },
    { id: "anthropic.claude-3-haiku-20240307-v1:0", name: "Claude 3 Haiku", provider: "Anthropic" },
    { id: "anthropic.claude-3-opus-20240229-v1:0", name: "Claude 3 Opus", provider: "Anthropic" },
    { id: "amazon.titan-text-express-v1", name: "Titan Text Express", provider: "Amazon" },
    { id: "meta.llama3-8b-instruct-v1:0", name: "Llama 3 8B", provider: "Meta" },
    { id: "meta.llama3-70b-instruct-v1:0", name: "Llama 3 70B", provider: "Meta" }
  ];

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Helper function to convert frontend messages to conversation history format
  const getConversationHistory = () => {
    return messages
      .filter(msg => msg.id !== 1 && !msg.isStreaming) // Exclude initial greeting and streaming messages
      .map(msg => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: msg.timestamp
      }));
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Clean up any active streams on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const stopStreaming = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
    setCurrentStream(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!inputMessage.trim() || isStreaming) return;

    const userMessage = {
      id: Date.now(),
      type: "user",
      content: inputMessage.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsStreaming(true);

    // Create streaming bot message
    const streamingMessageId = Date.now() + 1;
    const streamingMessage = {
      id: streamingMessageId,
      type: "bot",
      content: "",
      htmlContent: "",
      timestamp: new Date().toISOString(),
      isStreaming: true,
      sources: [],
      metadata: {},
      streamingStats: { startTime: Date.now(), charactersReceived: 0 }
    };

    setMessages((prev) => [...prev, streamingMessage]);

    try {
      // Prepare request data based on streaming mode
      let endpoint = "";
      let requestData = {};

      switch (streamingMode) {
        case "agent":
          endpoint = "/api/streaming-chat/agent";
          requestData = {
            message: userMessage.content,
            sessionId: sessionId,
            model: streamingSettings.model,
            temperature: streamingSettings.temperature,
            topP: streamingSettings.topP,
            systemPrompt: streamingSettings.systemPrompt?.trim() || undefined,
            history: historyConfig,
            conversationHistory: getConversationHistory(), // NEW: Pass conversation history to streaming
            dataSources: selectedDataSources,
            options: {
              useEnhancement: useEnhancedAgent,
            }
          };
          break;
        case "direct":
          endpoint = "/api/streaming-chat/direct";
          requestData = {
            message: userMessage.content,
            model: streamingSettings.model,
            temperature: streamingSettings.temperature,
            topP: streamingSettings.topP,
            maxTokens: streamingSettings.maxTokens,
          };
          break;
        case "knowledge-base":
          endpoint = "/api/streaming-chat/knowledge-base";
          // Knowledge Base streaming: AWS manages sessions internally - always use fresh sessions
          requestData = {
            message: userMessage.content,
            sessionId: null, // Always null - let AWS handle session management for streaming
            model: streamingSettings.model,
            enhancementOptions: {
              temperature: streamingSettings.temperature,
              topP: streamingSettings.topP,
              maxTokens: streamingSettings.maxTokens,
            }
          };
          break;
        default:
          throw new Error("Invalid streaming mode");
      }

      // Since EventSource doesn't support POST, we'll use a workaround
      // First make a POST request to initiate streaming, but don't wait for response
      fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002'}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      }).then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Process the streaming response
        return processStreamingResponse(response);
      }).catch(error => {
        console.error("Streaming error:", error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingMessageId
              ? {
                  ...msg,
                  content: `Failed to start streaming: ${error.message}`,
                  isStreaming: false,
                  error: true,
                }
              : msg
          )
        );
        setIsStreaming(false);
        setCurrentStream(null);
      });

      // Function to process streaming response
      const processStreamingResponse = async (response) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventType = '';
        
        const streamConnection = {
          close: () => {
            reader.cancel();
          },
          readyState: 1,
        };
        
        eventSourceRef.current = streamConnection;
        setCurrentStream(streamConnection);

        let fullContent = "";
        let sources = [];
        let metadata = {};
        const startTime = Date.now();

        console.log("Streaming connection started");

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  if (line.startsWith('event: ')) {
                    eventType = line.substring(7).trim();
                    continue;
                  }
                  
                  if (line.startsWith('data: ')) {
                    const data = line.substring(6).trim();
                    if (data === '') continue;

                    try {
                      const parsed = JSON.parse(data);
                      
                      switch (eventType) {
                        case 'start':
                          console.log("Streaming started:", parsed);
                          if (parsed.sessionId && parsed.sessionId !== sessionId) {
                            setSessionId(parsed.sessionId);
                          }
                          break;
                          
                        case 'chunk':
                          const chunk = parsed.content || "";
                          console.log("🎯 FRONTEND RECEIVED CHUNK:", {
                            length: chunk.length,
                            preview: chunk.substring(0, 30) + "...",
                            timestamp: new Date().toISOString(),
                            parsedData: parsed
                          });
                          
                          // Skip empty chunks or control characters
                          if (chunk.length === 0 || chunk === "\b\b\b" || chunk.startsWith("🤖") || chunk.startsWith("🔍")) {
                            console.log("⏭️ SKIPPING CONTROL CHUNK:", chunk);
                            break;
                          }
                          
                          fullContent += chunk;

                          // Update streaming message with new content  
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === streamingMessageId
                                ? {
                                    ...msg,
                                    content: fullContent,
                                    htmlContent: fullContent,
                                    streamingStats: {
                                      ...msg.streamingStats,
                                      charactersReceived: fullContent.length,
                                      elapsedTime: Date.now() - startTime,
                                    }
                                  }
                                : msg
                            )
                          );
                          
                          console.log("📝 UPDATED MESSAGE:", {
                            totalLength: fullContent.length,
                            messageId: streamingMessageId
                          });
                          break;
                          
                        case 'sources':
                          sources = parsed.sources || [];
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === streamingMessageId
                                ? { ...msg, sources }
                                : msg
                            )
                          );
                          break;
                          
                        case 'citation':
                          const citation = parsed.source || parsed.sources;
                          if (Array.isArray(citation)) {
                            sources.push(...citation);
                          } else {
                            sources.push(citation);
                          }
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === streamingMessageId
                                ? { ...msg, sources: [...sources] }
                                : msg
                            )
                          );
                          break;
                          
                        case 'metadata':
                          metadata = { ...metadata, ...parsed };
                          
                          // Show routing analysis if available
                          if (parsed.routingAnalysis) {
                            console.log("🧠 ROUTING DECISION:", parsed.routingAnalysis);
                            
                            // Update message with routing info
                            setMessages((prev) =>
                              prev.map((msg) =>
                                msg.id === streamingMessageId
                                  ? {
                                      ...msg,
                                      routingInfo: parsed.routingAnalysis
                                    }
                                  : msg
                              )
                            );
                          }
                          break;
                          
                        case 'end':
                          const totalTime = Date.now() - startTime;
                          console.log("Streaming completed:", parsed);
                          
                          // Update final message
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === streamingMessageId
                                ? {
                                    ...msg,
                                    isStreaming: false,
                                    metadata: {
                                      ...metadata,
                                      ...parsed,
                                      totalTime: `${totalTime}ms`,
                                    },
                                    streamingStats: {
                                      startTime,
                                      charactersReceived: fullContent.length,
                                      totalTime,
                                      wordsPerSecond: Math.round((fullContent.split(' ').length / totalTime) * 1000),
                                      tokensUsed: parsed.tokensUsed || 0,
                                    }
                                  }
                                : msg
                            )
                          );

                          setStreamingStats({
                            totalTime,
                            charactersReceived: fullContent.length,
                            wordsPerSecond: Math.round((fullContent.split(' ').length / totalTime) * 1000),
                            tokensUsed: parsed.tokensUsed || 0,
                          });

                          streamConnection.close();
                          eventSourceRef.current = null;
                          setIsStreaming(false);
                          setCurrentStream(null);
                          return;
                          
                        case 'error':
                          console.error("Streaming error:", parsed);
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === streamingMessageId
                                ? {
                                    ...msg,
                                    content: `Error: ${parsed.error}`,
                                    isStreaming: false,
                                    error: true,
                                  }
                                : msg
                            )
                          );

                          streamConnection.close();
                          eventSourceRef.current = null;
                          setIsStreaming(false);
                          setCurrentStream(null);
                          return;
                      }
                    } catch (parseError) {
                      console.warn('Failed to parse SSE data:', parseError);
                    }
                  }
                }
              }
            } catch (error) {
              console.error("Stream processing error:", error);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === streamingMessageId
                    ? {
                        ...msg,
                        content: `Connection error: ${error.message}`,
                        isStreaming: false,
                        error: true,
                      }
                    : msg
                )
              );

              streamConnection.close();
              eventSourceRef.current = null;
              setIsStreaming(false);
              setCurrentStream(null);
            } finally {
              reader.releaseLock();
            }
          };

          processStream();
        };

        return true;

    } catch (error) {
      console.error("Streaming error:", error);
      
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingMessageId
            ? {
                ...msg,
                content: `Failed to start streaming: ${error.message}`,
                isStreaming: false,
                error: true,
              }
            : msg
        )
      );

      setIsStreaming(false);
      setCurrentStream(null);
    } finally {
      inputRef.current?.focus();
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Activity className="w-8 h-8 text-purple-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900">Streaming Chat</h1>
            <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              <Zap size={12} className="mr-1" />
              Real-time SSE
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {isStreaming && (
              <button
                onClick={stopStreaming}
                className="btn-secondary flex items-center space-x-2 bg-red-100 text-red-700 hover:bg-red-200"
              >
                <Square size={18} />
                <span>Stop</span>
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="btn-secondary flex items-center space-x-2"
              title="Streaming Settings"
            >
              <Settings size={18} />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
        
        <p className="text-gray-600">
          Experience real-time AI responses with streaming technology. Watch responses appear instantly as they're generated!
        </p>

        {/* Streaming Mode Selector */}
        <div className="mt-4 flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">Streaming Mode:</label>
          <div className="flex space-x-2">
            <button
              onClick={() => setStreamingMode("agent")}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                streamingMode === "agent"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Agent
            </button>
            <button
              onClick={() => setStreamingMode("knowledge-base")}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                streamingMode === "knowledge-base"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Knowledge Base
            </button>
            <button
              onClick={() => setStreamingMode("direct")}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                streamingMode === "direct"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Direct Model
            </button>
          </div>
        </div>

        {/* Data Source Filter (for Agent and Knowledge Base modes) */}
        {(streamingMode === "agent" || streamingMode === "knowledge-base") && (
          <div className="mt-4">
            <DataSourceSelector
              selectedDataSources={selectedDataSources}
              onDataSourcesChange={setSelectedDataSources}
              disabled={isStreaming}
            />
          </div>
        )}

        {/* Streaming Stats */}
        {streamingStats.totalTime > 0 && (
          <div className="mt-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <h4 className="text-sm font-semibold text-purple-900 mb-2">Last Response Stats</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-purple-600">Total Time:</span>
                <div className="font-mono">{streamingStats.totalTime}ms</div>
              </div>
              <div>
                <span className="text-purple-600">Characters:</span>
                <div className="font-mono">{streamingStats.charactersReceived}</div>
              </div>
              <div>
                <span className="text-purple-600">Speed:</span>
                <div className="font-mono">{streamingStats.wordsPerSecond} WPS</div>
              </div>
              <div>
                <span className="text-purple-600">Tokens:</span>
                <div className="font-mono">{streamingStats.tokensUsed}</div>
              </div>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold mb-3">Streaming Settings</h3>

            <div className="space-y-4">
              {/* Model Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  AI Model
                </label>
                <select
                  value={streamingSettings.model}
                  onChange={(e) => setStreamingSettings(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>

              {/* Temperature Slider */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature: {streamingSettings.temperature}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={streamingSettings.temperature}
                  onChange={(e) => setStreamingSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Controls creativity. Lower = more focused, Higher = more creative
                </p>
              </div>

              {/* TopP Slider */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Top P: {streamingSettings.topP}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={streamingSettings.topP}
                  onChange={(e) => setStreamingSettings(prev => ({ ...prev, topP: parseFloat(e.target.value) }))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Controls diversity of word selection
                </p>
              </div>

              {/* Max Tokens (Direct Mode Only) */}
              {streamingMode === "direct" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Tokens: {streamingSettings.maxTokens}
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="4000"
                    step="100"
                    value={streamingSettings.maxTokens}
                    onChange={(e) => setStreamingSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}

              {/* System Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  System Prompt
                </label>
                <textarea
                  value={streamingSettings.systemPrompt}
                  onChange={(e) => setStreamingSettings(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  placeholder="You are a helpful AI assistant..."
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  rows={3}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Define the AI's behavior and formatting preferences
                </p>
              </div>

              {/* History Configuration */}
              {streamingMode === "agent" && (
                <div className="space-y-2">
                  <h5 className="text-sm font-medium text-gray-700">Conversation History</h5>
                  
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={historyConfig.enabled}
                      onChange={(e) => setHistoryConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                      className="mr-2 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm">Enable conversation history</span>
                  </label>

                  {historyConfig.enabled && (
                    <div className="ml-6 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Max Messages: {historyConfig.maxMessages}
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="20"
                          value={historyConfig.maxMessages}
                          onChange={(e) => setHistoryConfig(prev => ({ ...prev, maxMessages: parseInt(e.target.value) }))}
                          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Context Weight</label>
                        <select
                          value={historyConfig.contextWeight}
                          onChange={(e) => setHistoryConfig(prev => ({ ...prev, contextWeight: e.target.value }))}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-purple-500"
                        >
                          <option value="light">Light</option>
                          <option value="balanced">Balanced</option>
                          <option value="heavy">Heavy</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Enhanced Agent Mode Toggle */}
              {streamingMode === "agent" && (
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={useEnhancedAgent}
                      onChange={(e) => setUseEnhancedAgent(e.target.checked)}
                      className="mr-2 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium text-purple-800">
                      🚀 Use Enhanced Agent Mode
                    </span>
                  </label>
                  <p className="text-xs text-purple-600 ml-6">
                    Advanced agent with comprehensive parameter support (enabled by default)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chat Container */}
      <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.type === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`flex max-w-3xl ${
                  message.type === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {/* Avatar */}
                <div
                  className={`flex-shrink-0 ${
                    message.type === "user" ? "ml-3" : "mr-3"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      message.type === "user"
                        ? "bg-purple-600 text-white"
                        : message.isStreaming
                        ? "bg-yellow-200 text-yellow-700 animate-pulse"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {message.type === "user" ? (
                      <User size={18} />
                    ) : message.isStreaming ? (
                      <Activity size={18} />
                    ) : (
                      <Bot size={18} />
                    )}
                  </div>
                </div>

                {/* Message Content */}
                <div
                  className={`flex flex-col ${
                    message.type === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`px-4 py-2 rounded-lg ${
                      message.type === "user"
                        ? "bg-purple-600 text-white"
                        : message.error
                        ? "bg-red-50 text-red-900 border border-red-200"
                        : message.isStreaming
                        ? "bg-yellow-50 text-gray-900 border border-yellow-200"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    {/* Render content */}
                    {message.type === "bot" ? (
                      <div>
                        <EnhancedHTMLContent 
                          content={message.content}
                          htmlContent={message.htmlContent || message.content}
                          preferHTML={true}
                          showFormatInfo={false}
                          metadata={message.metadata}
                          className="bot-response"
                        />
                        
                        {/* Streaming indicator with routing info */}
                        {message.isStreaming && (
                          <div className="flex items-center mt-2 pt-2 border-t border-yellow-200">
                            <Activity size={16} className="animate-pulse mr-2 text-yellow-600" />
                            <div className="flex-1">
                              <div className="text-xs text-yellow-600 flex items-center">
                                Streaming... {message.streamingStats?.charactersReceived || 0} chars
                                <span className="ml-2 inline-flex">
                                  <span className="animate-pulse delay-0">●</span>
                                  <span className="animate-pulse delay-100">●</span>
                                  <span className="animate-pulse delay-200">●</span>
                                </span>
                              </div>
                              {/* Show routing decision */}
                              {message.routingInfo && (
                                <div className="text-xs text-yellow-500 mt-1">
                                  <span className={`inline-flex items-center px-1 py-0.5 rounded text-xs ${
                                    message.routingInfo.route === 'knowledge-base' 
                                      ? 'bg-green-100 text-green-700' 
                                      : 'bg-orange-100 text-orange-700'
                                  }`}>
                                    {message.routingInfo.route === 'knowledge-base' ? '🚀 True Streaming' : '⚡ Optimized Simulation'}
                                  </span>
                                  <span className="ml-1">
                                    ({Math.round(message.routingInfo.confidence * 100)}% confidence)
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}

                    {/* Sources */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <p className="text-sm font-medium mb-2">Sources:</p>
                        <div className="space-y-1">
                          {message.sources.map((source, index) => (
                            <div key={index} className="text-sm">
                              <div className="flex items-center space-x-2">
                                <a
                                  href={source.url || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center text-blue-300 hover:text-blue-100"
                                >
                                  <ExternalLink size={12} className="mr-1" />
                                  {source.title || `Source ${index + 1}`}
                                </a>
                                {source.dataSourceType && (
                                  <span
                                    className={`text-xs px-1 py-0.5 rounded ${
                                      source.dataSourceType === "website"
                                        ? "bg-blue-200 text-blue-800"
                                        : source.dataSourceType === "pdf"
                                        ? "bg-red-200 text-red-800"
                                        : "bg-green-200 text-green-800"
                                    }`}
                                  >
                                    {source.dataSourceType}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Streaming Stats with Routing Info */}
                    {message.streamingStats && !message.isStreaming && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <div className="text-xs text-gray-400 space-y-1">
                          <div className="flex items-center justify-between">
                            <span>Streaming completed in {message.streamingStats.totalTime}ms</span>
                            {message.metadata?.streamingType && (
                              <span className={`px-2 py-1 rounded text-xs ${
                                message.metadata.streamingType.includes('true') 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-orange-100 text-orange-700'
                              }`}>
                                {message.metadata.streamingType.includes('true') ? '🚀 True Streaming' : '⚡ Optimized'}
                              </span>
                            )}
                          </div>
                          <p>Speed: {message.streamingStats.wordsPerSecond} WPS | {message.streamingStats.tokensUsed} tokens</p>
                          {message.routingInfo && (
                            <p className="text-purple-500">
                              Routed to: {message.routingInfo.route} ({Math.round(message.routingInfo.confidence * 100)}% confidence)
                            </p>
                          )}
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

          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <div className="border-t border-gray-200 p-4">
          <form onSubmit={handleSubmit} className="flex space-x-4">
            <input
              ref={inputRef}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Ask me anything and watch the response stream in real-time..."
              className="input-field flex-1"
              disabled={isStreaming}
              autoFocus
            />
            <button
              type="submit"
              disabled={isStreaming || !inputMessage.trim()}
              className="btn-primary flex items-center space-x-2"
            >
              {isStreaming ? (
                <Activity size={18} className="animate-pulse" />
              ) : (
                <Send size={18} />
              )}
              <span className="hidden sm:inline">
                {isStreaming ? "Streaming..." : "Send"}
              </span>
            </button>
          </form>

          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>
              Mode: {streamingMode}{streamingMode === "agent" && useEnhancedAgent && " (Enhanced)"} | Session: {sessionId || "New"}
            </span>
            <div className="flex items-center space-x-4">
              <span>
                Model: {availableModels.find(m => m.id === streamingSettings.model)?.name || "Default"}
              </span>
              {streamingMode === "agent" && (
                <>
                  <span>Temp: {streamingSettings.temperature}</span>
                  <span>TopP: {streamingSettings.topP}</span>
                  {historyConfig.enabled && (
                    <span>History: {historyConfig.maxMessages} msgs ({historyConfig.contextWeight})</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      {messages.length === 1 && (
        <div className="mt-6 card bg-purple-50">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            ⚡ Smart Streaming Chat Features
          </h3>
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              • <strong>🧠 Intelligent Routing:</strong> Agent mode now automatically chooses the best approach for your query
            </p>
            <p>
              • <strong>🚀 True Streaming:</strong> Knowledge-seeking queries use real AWS streaming (zero delay)
            </p>
            <p>
              • <strong>⚡ Action Groups:</strong> API/action queries use your agent with optimized fake streaming
            </p>
            <p>
              • <strong>🔄 Smart Fallback:</strong> Automatically falls back if the primary approach fails
            </p>
            <p>
              • <strong>📊 Performance Metrics:</strong> See routing decisions, response times, and streaming types
            </p>
            <p>
              • <strong>🎯 Best of Both:</strong> Get true streaming when possible, full agent capabilities when needed
            </p>
          </div>
          
          <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Query Examples:</h4>
            <div className="text-xs text-blue-700 space-y-1">
              <p><strong>Knowledge Base (🚀 True Streaming):</strong> "What is artificial intelligence?", "Explain the system requirements"</p>
              <p><strong>Action Groups (⚡ Agent):</strong> "Call the user API", "Execute the data processing function"</p>
              <p><strong>Automatic Detection:</strong> The system analyzes your query and chooses the optimal approach!</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StreamingChatPage;
