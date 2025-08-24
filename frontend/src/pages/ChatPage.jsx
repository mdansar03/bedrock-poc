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
} from "lucide-react";
import { chatAPI, agentAPI, getLatestAgentAlias } from "../utils/api";
import DataSourceSelector from "../components/DataSourceSelector";
import { EnhancedHTMLContent } from "../components/HTMLContent";

const ChatPage = () => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "bot",
      content:
        "Hello! I'm your AI assistant. I can help you find information from the websites you've scraped. What would you like to know?",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [availableModels, setAvailableModels] = useState({});
  const [useAgent, setUseAgent] = useState(true); // Default to agent if available
  const [agentInfo, setAgentInfo] = useState(null);
  const [enhancementOptions, setEnhancementOptions] = useState({
    includeExamples: true,
    requestElaboration: true,
    structureResponse: true,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [selectedDataSources, setSelectedDataSources] = useState({
    websites: [],
    pdfs: [],
    documents: [],
  });
  
  // Enhanced agent settings
  const [useEnhancedAgent, setUseEnhancedAgent] = useState(true);
  const [agentModel, setAgentModel] = useState("anthropic.claude-3-sonnet-20240229-v1:0");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  // System prompt removed - now using Professional Instructions instead
  const [historyConfig, setHistoryConfig] = useState({
    enabled: true,
    maxMessages: 6,
    contextWeight: "balanced"
  });

  // Professional instruction settings
  const [instructionType, setInstructionType] = useState('default');
  const [customInstructions, setCustomInstructions] = useState({
    response_style: '',
    context_usage: '',
    tone: ''
  });
  
  // HTML formatting settings
  const [showHTMLFormatInfo, setShowHTMLFormatInfo] = useState(false);
  
  // User ID from localStorage
  const [userId, setUserId] = useState(null);
  
  // Available models for enhanced agent
  const enhancedModels = [
    { id: "anthropic.claude-3-sonnet-20240229-v1:0", name: "Claude 3 Sonnet", provider: "Anthropic" },
    { id: "anthropic.claude-3-haiku-20240307-v1:0", name: "Claude 3 Haiku", provider: "Anthropic" },
    { id: "anthropic.claude-3-opus-20240229-v1:0", name: "Claude 3 Opus", provider: "Anthropic" },
    { id: "amazon.titan-text-express-v1", name: "Titan Text Express", provider: "Amazon" },
    { id: "meta.llama3-8b-instruct-v1:0", name: "Llama 3 8B", provider: "Meta" },
    { id: "meta.llama3-70b-instruct-v1:0", name: "Llama 3 70B", provider: "Meta" }
  ];

  // Professional instruction types
  const professionalInstructionTypes = [
    { 
      id: 'default', 
      name: 'Default Professional', 
      description: 'Well-structured responses with HTML formatting',
      icon: '📋'
    },
    { 
      id: 'business', 
      name: 'Business Executive', 
      description: 'Strategic insights with business terminology',
      icon: '💼'
    },
    { 
      id: 'technical', 
      name: 'Technical Documentation', 
      description: 'Detailed technical responses with code examples',
      icon: '⚙️'
    },
    { 
      id: 'customer_service', 
      name: 'Customer Service', 
      description: 'Empathetic, solution-focused responses',
      icon: '🤝'
    },
    { 
      id: 'concise', 
      name: 'Concise & Direct', 
      description: 'Brief, essential information only',
      icon: '⚡'
    },
    { 
      id: 'detailed', 
      name: 'Comprehensive', 
      description: 'In-depth responses with examples',
      icon: '📚'
    }
  ];

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Helper function to convert frontend messages to conversation history format
  const getConversationHistory = () => {
    return messages
      .filter(msg => msg.id !== 1) // Exclude the initial greeting message
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
    loadAvailableModels();
    checkAgentAvailability();
    loadUserIdFromStorage();
  }, []);

  const loadUserIdFromStorage = () => {
    try {
      const storedUserId = localStorage.getItem('userId');
      if (storedUserId) {
        setUserId(storedUserId);
        console.log('Loaded userId from localStorage:', storedUserId);
      } else {
        // If no userId in localStorage, you could generate one or prompt user
        console.log('No userId found in localStorage');
      }
    } catch (error) {
      console.error('Error loading userId from localStorage:', error);
    }
  };

  const updateUserId = (newUserId) => {
    try {
      if (newUserId) {
        localStorage.setItem('userId', newUserId);
        setUserId(newUserId);
        console.log('Updated userId in localStorage:', newUserId);
      } else {
        localStorage.removeItem('userId');
        setUserId(null);
        console.log('Removed userId from localStorage');
      }
    } catch (error) {
      console.error('Error updating userId in localStorage:', error);
    }
  };

  const loadAvailableModels = async () => {
    try {
      const response = await chatAPI.getModels();
      setAvailableModels(response.data.models);
      setSelectedModel(response.data.defaultModel);
    } catch (error) {
      console.error("Failed to load available models:", error);
    }
  };

  const checkAgentAvailability = async () => {
    try {
      const response = await agentAPI.getInfo();
      if (response.success && response.data.agent.configured) {
        setAgentInfo(response.data.agent);
        setUseAgent(true);
      } else {
        setUseAgent(false);
      }
    } catch (error) {
      console.warn(
        "Agent not available, falling back to direct knowledge base:",
        error
      );
      setUseAgent(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleConnectivityTest = async () => {
    setLoading(true);

    const testMessage = {
      id: Date.now(),
      type: "user",
      content: `Testing ${
        useAgent ? "agent" : "knowledge base"
      } connectivity...`,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, testMessage]);

    try {
      const response = useAgent
        ? await agentAPI.test()
        : await chatAPI.testKnowledgeBase();

      const testContent = `${useAgent ? "Agent" : "Knowledge Base"} Test Result:\n\n${
        response.data.answer || response.data.response
      }`;
      
      const botMessage = {
        id: Date.now() + 1,
        type: "bot",
        content: testContent,
        htmlContent: response.data.answerHTML || testContent,
        sources: response.data.sources || response.data.citations,
        timestamp: new Date().toISOString(),
        isTest: true,
        method: response.method || (useAgent ? "agent" : "knowledge_base"),
        agentMetadata: response.data.agentMetadata,
        metadata: response.data.metadata,
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        type: "bot",
        content: `${useAgent ? "Agent" : "Knowledge Base"} Test Failed: ${
          error.response?.data?.message || error.message
        }`,
        error: true,
        timestamp: new Date().toISOString(),
        isTest: true,
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!inputMessage.trim() || loading) return;

    const userMessage = {
      id: Date.now(),
      type: "user",
      content: inputMessage.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setLoading(true);

    try {
      let response;

      if (useEnhancedAgent) {
        // Enhanced Agent Mode with new parameter structure
        const dataSources = {
          websites: selectedDataSources.websites || [],
          pdfs: selectedDataSources.pdfs || [],
          documents: selectedDataSources.documents || []
        };

        response = await agentAPI.sendEnhancedMessage({
          message: userMessage.content,
          model: agentModel,
          temperature,
          topP,
          history: historyConfig,
          dataSources,
          conversationHistory: getConversationHistory(), // NEW: Pass conversation history
          userId: userId, // NEW: Pass user ID from localStorage
          instructionType: instructionType, // NEW: Professional instruction type
          customInstructions: Object.fromEntries(
            Object.entries(customInstructions).filter(([_, v]) => v && v.trim() !== '')
          ), // NEW: Custom professional instructions (only non-empty values)
          options: {
            useEnhancement: enhancementOptions.requestElaboration
          }
        });
      } else if (useAgent && agentInfo) {
        // Original Agent Mode - Prepare data sources for filtering (only include non-empty arrays)
        const dataSources = {};
        if (selectedDataSources.websites?.length > 0) {
          dataSources.websites = selectedDataSources.websites;
        }
        if (selectedDataSources.pdfs?.length > 0) {
          dataSources.pdfs = selectedDataSources.pdfs;
        }
        if (selectedDataSources.documents?.length > 0) {
          dataSources.documents = selectedDataSources.documents;
        }

        // --- Fetch latest aliasId before sending message to agent ---
        let latestAliasId = null;
        try {
          latestAliasId = await getLatestAgentAlias();
        } catch (err) {
          // fallback: show error and skip agent call
          throw new Error(
            "No valid agent alias found. Please create an alias."
          );
        }

        // Use agent API with data source filtering and latest aliasId
        response = await agentAPI.sendMessageWithHistory({
          message: userMessage.content,
          sessionId: sessionId,
          dataSources: Object.keys(dataSources).length > 0 ? dataSources : null,
          conversationHistory: getConversationHistory(), // NEW: Pass conversation history
          userId: userId, // NEW: Pass user ID from localStorage
          instructionType: instructionType, // NEW: Professional instruction type
          customInstructions: Object.fromEntries(
            Object.entries(customInstructions).filter(([_, v]) => v && v.trim() !== '')
          ), // NEW: Custom professional instructions (only non-empty values)
          options: {
            useEnhancement: enhancementOptions.requestElaboration,
            sessionConfig: { preferences: enhancementOptions },
            agentAliasId: latestAliasId, // Pass aliasId to backend
          }
        });
      } else {
        // Use traditional chat API with agent fallback
        response = await chatAPI.sendMessage(
          userMessage.content,
          sessionId,
          selectedModel,
          useAgent,
          enhancementOptions
        );
      }

      // Update session ID if we got a new one from the server
      if (response.data.sessionId && response.data.sessionId !== sessionId) {
        setSessionId(response.data.sessionId);
      }

      const botMessage = {
        id: Date.now() + 1,
        type: "bot",
        content: response.data.answer,
        htmlContent: response.data.answerHTML || response.data.answer, // Use HTML version if available
        sources: response.data.sources || response.data.citations,
        model: response.data.model,
        method: response.data.method,
        agentMetadata: response.data.agentMetadata,
        appliedFilters: response.data.appliedFilters,
        metadata: response.data.metadata, // Include full metadata for HTML formatting info
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error("Chat error:", error);

      const errorMessage = {
        id: Date.now() + 1,
        type: "bot",
        content:
          "I apologize, but I encountered an error while processing your message. Please try again.",
        error: true,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
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
            <MessageCircle className="w-8 h-8 text-blue-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900">AI Chat</h1>
            {useEnhancedAgent && (
              <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                <Zap size={12} className="mr-1" />
                Enhanced Agent
              </span>
            )}
            {useAgent && agentInfo && !useEnhancedAgent && (
              <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                <Zap size={12} className="mr-1" />
                Standard Agent
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="btn-secondary flex items-center space-x-2"
              title="Chat Settings"
            >
              <Settings size={18} />
              <span className="hidden sm:inline">Settings</span>
            </button>
            <button
              onClick={handleConnectivityTest}
              disabled={loading}
              className="btn-secondary flex items-center space-x-2"
            >
              <TestTube size={18} />
              <span>Test {useAgent ? "Agent" : "KB"}</span>
            </button>
          </div>
        </div>
        <p className="text-gray-600">
          Ask questions about your scraped content. I'll use{" "}
          {useEnhancedAgent 
            ? "enhanced agents with advanced configuration" 
            : useAgent 
              ? "intelligent agents" 
              : "the knowledge base"} to provide accurate answers.
        </p>

        {/* Data Source Filter */}
        <div className="mt-4">
          <DataSourceSelector
            selectedDataSources={selectedDataSources}
            onDataSourcesChange={setSelectedDataSources}
            disabled={loading}
          />
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold mb-3">Chat Settings</h3>

            {/* User ID Management */}
            <div className="mb-4 p-3 bg-yellow-50 rounded border border-yellow-200">
              <h4 className="text-sm font-semibold text-yellow-900 mb-2">User Identity</h4>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-yellow-700 mb-1">
                    Current User ID: {userId || 'Not set'}
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Enter your user ID (e.g., user-001)"
                      className="flex-1 text-sm border border-yellow-300 rounded px-3 py-1 focus:ring-1 focus:ring-yellow-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          updateUserId(e.target.value.trim());
                          e.target.value = '';
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const input = document.querySelector('input[placeholder*="Enter your user ID"]');
                        updateUserId(input.value.trim());
                        input.value = '';
                      }}
                      className="px-3 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
                    >
                      Set
                    </button>
                    {userId && (
                      <button
                        onClick={() => updateUserId(null)}
                        className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-yellow-600 mt-1">
                    Set your user ID to get personalized responses about your orders and data
                  </p>
                </div>
              </div>
            </div>

            {/* Enhanced Agent Mode Toggle */}
            <div className="mb-4 p-3 bg-green-50 rounded border border-green-200">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={useEnhancedAgent}
                  onChange={(e) => setUseEnhancedAgent(e.target.checked)}
                  className="mr-2 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                />
                <span className="text-sm font-medium text-green-800">
                  🚀 Use Enhanced Agent Mode
                </span>
              </label>
              <p className="text-xs text-green-600 ml-6">
                Advanced agent with temperature, model selection, and conversation history
              </p>
            </div>

            {useEnhancedAgent && (
              <div className="space-y-4 p-3 bg-blue-50 rounded border border-blue-200 mb-4">
                <h4 className="text-sm font-semibold text-blue-900">Enhanced Agent Configuration</h4>
                
                {/* Professional Instructions Section */}
                <div className="space-y-3 p-3 bg-purple-50 rounded border border-purple-200">
                  <h5 className="text-sm font-semibold text-purple-900">🎯 Professional Instructions</h5>
                  
                  {/* Instruction Type Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Response Style Template
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {professionalInstructionTypes.map((type) => (
                        <label key={type.id} className="flex items-center p-2 border rounded cursor-pointer hover:bg-purple-100 transition-colors">
                          <input
                            type="radio"
                            name="instructionType"
                            value={type.id}
                            checked={instructionType === type.id}
                            onChange={(e) => setInstructionType(e.target.value)}
                            className="mr-2 h-4 w-4 text-purple-600 focus:ring-purple-500"
                          />
                          <div className="flex-1">
                            <div className="flex items-center">
                              <span className="mr-1">{type.icon}</span>
                              <span className="text-xs font-medium">{type.name}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{type.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Custom Instructions Override */}
                  <div className="space-y-2">
                    <h6 className="text-xs font-semibold text-purple-800">Custom Instruction Overrides (Optional)</h6>
                    
                    <div>
                      <label className="block text-xs text-purple-700 mb-1">Response Style</label>
                      <input
                        type="text"
                        value={customInstructions.response_style}
                        onChange={(e) => setCustomInstructions(prev => ({ ...prev, response_style: e.target.value }))}
                        placeholder="e.g., Concise bullet points with technical details"
                        className="w-full text-xs border border-purple-300 rounded px-2 py-1 focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs text-purple-700 mb-1">Context Usage</label>
                      <input
                        type="text"
                        value={customInstructions.context_usage}
                        onChange={(e) => setCustomInstructions(prev => ({ ...prev, context_usage: e.target.value }))}
                        placeholder="e.g., Always reference previous technical decisions"
                        className="w-full text-xs border border-purple-300 rounded px-2 py-1 focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs text-purple-700 mb-1">Tone</label>
                      <input
                        type="text"
                        value={customInstructions.tone}
                        onChange={(e) => setCustomInstructions(prev => ({ ...prev, tone: e.target.value }))}
                        placeholder="e.g., Professional and encouraging"
                        className="w-full text-xs border border-purple-300 rounded px-2 py-1 focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>
                
                {/* Model Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    AI Model
                  </label>
                  <select
                    value={agentModel}
                    onChange={(e) => setAgentModel(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {enhancedModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} ({model.provider})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Temperature Slider */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Temperature: {temperature}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Controls creativity. Lower = more focused, Higher = more creative
                  </p>
                </div>

                {/* TopP Slider */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Top P: {topP}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Controls diversity of word selection
                  </p>
                </div>

                {/* System Prompt removed - now using Professional Instructions instead */}

                {/* History Configuration */}
                <div className="space-y-2">
                  <h5 className="text-sm font-medium text-gray-700">Conversation History</h5>
                  
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={historyConfig.enabled}
                      onChange={(e) => setHistoryConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                      className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
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
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="light">Light</option>
                          <option value="balanced">Balanced</option>
                          <option value="heavy">Heavy</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Agent Mode Toggle (Original) */}
            <div className="mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={useAgent && agentInfo && !useEnhancedAgent}
                  onChange={(e) => setUseAgent(e.target.checked && agentInfo)}
                  disabled={!agentInfo || useEnhancedAgent}
                  className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm font-medium">
                  Use Standard Bedrock Agent {!agentInfo && "(Not Available)"}
                </span>
              </label>
              <p className="text-xs text-gray-500 ml-6">
                {agentInfo
                  ? "Use intelligent agents for enhanced responses"
                  : "Agent not configured - will use direct knowledge base"}
              </p>
            </div>

            {/* HTML Formatting Options */}
            <div className="mb-4 p-3 bg-purple-50 rounded border border-purple-200">
              <h4 className="text-sm font-semibold text-purple-900 mb-2">HTML Response Formatting</h4>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showHTMLFormatInfo}
                  onChange={(e) => setShowHTMLFormatInfo(e.target.checked)}
                  className="mr-2 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                />
                <span className="text-sm text-purple-800">Show HTML format information</span>
              </label>
              <p className="text-xs text-purple-600 ml-6">
                Display technical details about HTML processing and formatting
              </p>
            </div>

            {/* Enhancement Options */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Response Enhancement</h4>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enhancementOptions.includeExamples}
                  onChange={(e) =>
                    setEnhancementOptions((prev) => ({
                      ...prev,
                      includeExamples: e.target.checked,
                    }))
                  }
                  className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm">Include Examples</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enhancementOptions.requestElaboration}
                  onChange={(e) =>
                    setEnhancementOptions((prev) => ({
                      ...prev,
                      requestElaboration: e.target.checked,
                    }))
                  }
                  className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm">Request Detailed Explanations</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={enhancementOptions.structureResponse}
                  onChange={(e) =>
                    setEnhancementOptions((prev) => ({
                      ...prev,
                      structureResponse: e.target.checked,
                    }))
                  }
                  className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm">Structure Responses</span>
              </label>
            </div>

            {/* Agent Info */}
            {agentInfo && !useEnhancedAgent && (
              <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                <h5 className="text-sm font-semibold text-blue-900">
                  Agent Information
                </h5>
                <div className="text-xs text-blue-700 mt-1">
                  <p>Name: {agentInfo.agentName}</p>
                  <p>Status: {agentInfo.status}</p>
                  <p>Model: {agentInfo.foundationModel}</p>
                </div>
              </div>
            )}
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
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {message.type === "user" ? (
                      <User size={18} />
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
                        ? "bg-blue-600 text-white"
                        : message.error
                        ? "bg-red-50 text-red-900 border border-red-200"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    {/* Render HTML content for bot messages, plain text for user messages */}
                    {message.type === "bot" ? (
                      <EnhancedHTMLContent 
                        content={message.content}
                        htmlContent={message.htmlContent}
                        preferHTML={true}
                        showFormatInfo={showHTMLFormatInfo}
                        metadata={message.metadata}
                        className="bot-response"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}

                    {/* Applied Filters */}
                    {message.appliedFilters && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <p className="text-sm font-medium mb-2">
                          Filtered Sources:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {message.appliedFilters.websites?.map((website) => (
                            <span
                              key={`filter-website-${website}`}
                              className="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-200 text-blue-800"
                            >
                              <Globe size={10} className="mr-1" />
                              {website}
                            </span>
                          ))}
                          {message.appliedFilters.pdfs?.map((pdf) => (
                            <span
                              key={`filter-pdf-${pdf}`}
                              className="inline-flex items-center px-2 py-1 rounded text-xs bg-red-200 text-red-800"
                            >
                              <FileText size={10} className="mr-1" />
                              {pdf}
                            </span>
                          ))}
                          {message.appliedFilters.documents?.map((doc) => (
                            <span
                              key={`filter-doc-${doc}`}
                              className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-200 text-green-800"
                            >
                              <File size={10} className="mr-1" />
                              {doc}
                            </span>
                          ))}
                        </div>
                      </div>
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
                                  href={
                                    source.url ||
                                    source.metadata?.[0]?.location?.s3Location
                                      ?.uri ||
                                    "#"
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center text-blue-300 hover:text-blue-100"
                                >
                                  <ExternalLink size={12} className="mr-1" />
                                  {source.title ||
                                    source.metadata?.[0]?.sourceMetadata
                                      ?.title ||
                                    `Source ${index + 1}`}
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

                    {/* Agent Metadata */}
                    {message.agentMetadata && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <div className="text-xs text-gray-400 space-y-1">
                          <p>Method: {message.method}</p>
                          {message.agentMetadata.responseTime && (
                            <p>
                              Response Time:{" "}
                              {message.agentMetadata.responseTime}ms
                            </p>
                          )}
                          {message.agentMetadata.analysis && (
                            <p>
                              Interaction Style:{" "}
                              {message.agentMetadata.analysis.interactionStyle}
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
            <label
              htmlFor="model-select"
              className="text-sm font-medium text-gray-700"
            >
              Model:
            </label>
            <select
              id="model-select"
              value={selectedModel || ""}
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
              {
                availableModels[
                  Object.keys(availableModels).find(
                    (key) => availableModels[key].id === selectedModel
                  )
                ]?.provider
              }
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
            <div className="flex items-center space-x-4">
              <span>
                Session ID: {sessionId || "New session will be created"}
              </span>
              <span className={`${userId ? 'text-green-600' : 'text-orange-600'}`}>
                User ID: {userId || 'Not set'}
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <span>
                Mode: {useEnhancedAgent ? "Enhanced Agent" : useAgent ? "Standard Agent" : "Knowledge Base"}
                {useEnhancedAgent && instructionType !== 'default' && (
                  <span className="ml-1 text-purple-600">
                    ({professionalInstructionTypes.find(t => t.id === instructionType)?.icon} {professionalInstructionTypes.find(t => t.id === instructionType)?.name})
                  </span>
                )}
              </span>
              <span>
                Model:{" "}
                {useEnhancedAgent
                  ? enhancedModels.find(m => m.id === agentModel)?.name || agentModel
                  : availableModels[
                      Object.keys(availableModels).find(
                        (key) => availableModels[key].id === selectedModel
                      )
                    ]?.name || "Default"}
              </span>
              {useEnhancedAgent && (
                <>
                  <span>Temp: {temperature}</span>
                  <span>TopP: {topP}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      {messages.length === 1 && (
        <div className="mt-6 card bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            Tips for better conversations
          </h3>
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              • Ask specific questions about products, recipes, classes, and
              detailed content from scraped websites
            </p>
            <p>
              • Reference specific products by name, ingredients from recipes,
              or class details
            </p>
            <p>
              •{" "}
              {useAgent
                ? "Agent mode provides intelligent reasoning and contextual responses"
                : "Use different AI models for varied response styles and capabilities"}
            </p>
            <p>
              • Ask for summaries, comparisons, or detailed explanations about
              structured data
            </p>
            <p>
              • Query about prices, specifications, instructions, or any
              detailed information
            </p>
            <p>
              •{" "}
              {useAgent
                ? "Agents maintain conversation context and provide follow-up suggestions"
                : "Enable agent mode in settings for enhanced conversational AI"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatPage;
