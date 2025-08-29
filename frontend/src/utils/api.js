import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3002/api";
// Allow long-running requests from the browser (default 20 minutes)
const API_TIMEOUT = parseInt(
  import.meta.env.VITE_API_TIMEOUT_MS || "1200000",
  10
);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    console.log(
      `Making ${config.method?.toUpperCase()} request to ${config.url}`
    );
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error("API Error:", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// API functions
export const scrapingAPI = {
  scrapeWebsite: async (url, options = {}) => {
    const response = await api.post("/scraping/scrape", { url, options });
    return response.data;
  },

  crawlWebsite: async (url, options = {}) => {
    const response = await api.post("/scraping/crawl", { url, options });
    return response.data;
  },

  // Start async crawl job (returns immediately with jobId)
  startAsyncCrawl: async (url, options = {}) => {
    const response = await api.post("/scraping/enhanced-crawl", {
      url,
      options,
    });
    return response.data;
  },

  // Get crawl job status
  getCrawlStatus: async (jobId) => {
    const response = await api.get(`/scraping/crawl/status/${jobId}`);
    return response.data;
  },

  // Legacy endpoint (for backward compatibility)
  getCrawlProgress: async (jobId) => {
    const response = await api.get(`/scraping/crawl/status/${jobId}`);
    return response.data;
  },

  // Poll crawl job until completion
  pollCrawlCompletion: async (jobId, onProgress = null) => {
    const pollInterval = 5000; // 5 seconds
    const maxPollTime = 600000; // 10 minutes max
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      try {
        const response = await scrapingAPI.getCrawlStatus(jobId);
        const { data } = response;

        // Call progress callback if provided
        if (onProgress) {
          onProgress(data);
        }

        // Check if job is completed
        if (data.status === "completed") {
          return { success: true, data: data.result };
        }

        // Check if job failed
        if (data.status === "failed") {
          throw new Error(data.error || "Crawl job failed");
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        if (error.response?.status === 404) {
          throw new Error("Crawl job not found");
        }
        throw error;
      }
    }

    throw new Error("Crawl job timed out");
  },

  getStatus: async (domain = null) => {
    const endpoint = domain ? `/scraping/status/${domain}` : "/scraping/status";
    const response = await api.get(endpoint);
    return response.data;
  },

  getOptions: async () => {
    const response = await api.get("/scraping/options");
    return response.data;
  },

  checkHealth: async () => {
    const response = await api.get("/scraping/health");
    return response.data;
  },
};

export const chatAPI = {
  sendMessage: async (
    message,
    sessionId = null,
    model = null,
    useAgent = null,
    enhancementOptions = {}
  ) => {
    const payload = { message };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    if (model) {
      payload.model = model;
    }
    if (useAgent !== null) {
      payload.useAgent = useAgent;
    }
    if (Object.keys(enhancementOptions).length > 0) {
      payload.enhancementOptions = enhancementOptions;
    }
    const response = await api.post("/chat/query", payload);
    return response.data;
  },

  sendDirectMessage: async (prompt, model = null, enhancementOptions = {}) => {
    const payload = { prompt };
    if (model) {
      payload.model = model;
    }
    if (Object.keys(enhancementOptions).length > 0) {
      payload.enhancementOptions = enhancementOptions;
    }
    const response = await api.post("/chat/direct", payload);
    return response.data;
  },

  testKnowledgeBase: async (useAgent = false) => {
    const params = useAgent ? "?useAgent=true" : "";
    const response = await api.get(`/chat/test${params}`);
    return response.data;
  },

  getSession: async (sessionId) => {
    const response = await api.get(`/chat/session/${sessionId}`);
    return response.data;
  },

  getModels: async () => {
    const response = await api.get("/chat/models");
    return response.data;
  },

  getEnhancementOptions: async () => {
    const response = await api.get("/chat/enhancement-options");
    return response.data;
  },

  getStatus: async () => {
    const response = await api.get("/chat/status");
    return response.data;
  },
};

// New Agent API functions
export const agentAPI = {
  // Send message to Bedrock Agent with enhanced options including conversation history
  sendMessage: async (message, sessionId = null, options = {}) => {
    const payload = {
      message,
      sessionId,
      ...options, // This now includes dataSources, model, temperature, topP, instructionType, customInstructions, history, etc.
    };

    const response = await api.post("/chat/agent/", payload);
    return response.data;
  },

  // Enhanced Agent Chat with new parameter structure and conversation history
  sendEnhancedMessage: async ({
    message,
    model = "anthropic.claude-3-sonnet-20240229-v1:0",
    temperature = 0.7,
    topP = 0.9,
    instructionType = 'default',
    customInstructions = {},
    history = {
      enabled: true,
      maxMessages: 6,
      contextWeight: "balanced",
    },
    dataSources = {
      websites: [],
      pdfs: [],
      documents: [],
    },
    options = {
      useEnhancement: true
    },
    conversationHistory = null, // NEW: Direct conversation history
    userId = null // NEW: User ID for personalization
  }) => {
    const payload = {
      message,
      model,
      temperature,
      topP,
      instructionType,
      customInstructions,
      history,
      dataSources,
      options,
      conversationHistory, // NEW: Include conversation history in payload
      userId // NEW: Include user ID in payload
    };

    const response = await api.post("/chat/agent/", payload);
    return response.data;
  },

  // Send message with full parameter support (enhanced version)
  sendMessageWithHistory: async ({
    message,
    sessionId = null,
    dataSources = null,
    model = null,
    temperature = null,
    topP = null,
    instructionType = 'default',
    customInstructions = {},
    history = {
      enabled: true,
      maxMessages: 6,
      contextWeight: "balanced",
    },
    options = {},
    conversationHistory = null, // NEW: Direct conversation history
    userId = null // NEW: User ID for personalization
  }) => {
    const payload = {
      message,
      sessionId,
      dataSources,
      model,
      temperature,
      topP,
      instructionType,
      customInstructions,
      history,
      options,
      conversationHistory, // NEW: Include conversation history in payload
      userId // NEW: Include user ID in payload
    };

    const response = await api.post("/chat/agent/", payload);
    return response.data;
  },

  // Get agent information and status
  getInfo: async () => {
    const response = await api.get("/chat/agent/info");
    return response.data;
  },

  // Test agent connectivity
  test: async () => {
    const response = await api.get("/chat/agent/test");
    return response.data;
  },

  // Get agent health status
  getHealth: async () => {
    const response = await api.get("/chat/agent/health");
    return response.data;
  },

  // Get active sessions
  getSessions: async () => {
    const response = await api.get("/chat/agent/sessions");
    return response.data;
  },

  // Get conversation history for a session
  getConversationHistory: async (sessionId, options = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.append("limit", options.limit);
    if (options.messageType) params.append("messageType", options.messageType);
    if (options.includeMetadata !== undefined)
      params.append("includeMetadata", options.includeMetadata);
    if (options.fromTimestamp)
      params.append("fromTimestamp", options.fromTimestamp);
    if (options.toTimestamp) params.append("toTimestamp", options.toTimestamp);

    const queryString = params.toString();
    const url = `/chat/agent/history/${sessionId}${
      queryString ? `?${queryString}` : ""
    }`;

    const response = await api.get(url);
    return response.data;
  },

  // Clear conversation history for a session
  clearConversationHistory: async (sessionId) => {
    const response = await api.delete(`/chat/agent/history/${sessionId}`);
    return response.data;
  },

  // Get recent conversations (helper function)
  getRecentConversations: async (sessionId, limit = 10) => {
    return await agentAPI.getConversationHistory(sessionId, {
      limit,
      includeMetadata: false,
    });
  },

  // Setup and configuration
  setup: async (config = {}) => {
    const response = await api.post("/chat/agent/setup", config);
    return response.data;
  },

  // List existing agents
  list: async (maxResults = 50) => {
    const response = await api.get(`/chat/agent/list?maxResults=${maxResults}`);
    return response.data;
  },

  // Check agent status
  getStatus: async (agentId) => {
    const response = await api.get(`/chat/agent/status/${agentId}`);
    return response.data;
  },

  // Update agent configuration
  update: async (agentId, updates) => {
    const response = await api.put(`/chat/agent/${agentId}`, updates);
    return response.data;
  },

  // Get environment configuration
  getConfig: async () => {
    const response = await api.get("/chat/agent/config");
    return response.data;
  },

  // Agent Instructions Management (Simplified)
  getCurrentInstructions: async () => {
    const response = await api.get("/agent-instructions/current");
    return response.data;
  },

  updateToDefaultInstructions: async () => {
    const response = await api.post("/agent-instructions/update-default");
    return response.data;
  },

  updateToCustomInstructions: async (instructions) => {
    const response = await api.post("/agent-instructions/update-custom", {
      instructions,
    });
    return response.data;
  },
};

export const syncAPI = {
  checkSyncStatus: async (jobId) => {
    const response = await api.get(`/scraping/sync/status/${jobId}`);
    return response.data;
  },

  triggerSync: async (domain) => {
    const response = await api.post("/scraping/sync", { domain });
    return response.data;
  },
};

export const filesAPI = {
  uploadFiles: async (formData) => {
    const response = await api.post("/files/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return response.data;
  },

  getInfo: async () => {
    const response = await api.get("/files/info");
    return response.data;
  },

  getSyncStatus: async (jobId) => {
    const response = await api.get(`/files/sync-status/${jobId}`);
    return response.data;
  },

  getSyncJobs: async (limit = 10) => {
    const response = await api.get(`/files/sync-jobs?limit=${limit}`);
    return response.data;
  },

  getStats: async () => {
    const response = await api.get("/files/stats");
    return response.data;
  },

  triggerSync: async () => {
    const response = await api.post("/files/sync");
    return response.data;
  },

  checkHealth: async () => {
    const response = await api.get("/files/health");
    return response.data;
  },
};

export const dataManagementAPI = {
  // Get all domains summary
  getDomains: async () => {
    const response = await api.get("/data-management/domains");
    return response.data;
  },

  // Get documents for a specific domain
  getDocumentsByDomain: async (domain) => {
    const response = await api.get(
      `/data-management/domains/${domain}/documents`
    );
    return response.data;
  },

  // Get documents for a specific URL
  getDocumentsByUrl: async (url) => {
    const response = await api.get(
      `/data-management/urls/documents?url=${encodeURIComponent(url)}`
    );
    return response.data;
  },

  // Delete domain data (with confirmation)
  deleteDomainData: async (domain, options = {}) => {
    const params = new URLSearchParams();
    if (options.dryRun) params.append("dryRun", "true");
    if (options.confirm) params.append("confirm", domain);
    if (options.syncKnowledgeBase !== undefined)
      params.append("syncKnowledgeBase", options.syncKnowledgeBase);

    const response = await api.delete(
      `/data-management/domains/${domain}?${params}`
    );
    return response.data;
  },

  // Delete URL data (with confirmation)
  deleteUrlData: async (url, options = {}) => {
    const params = new URLSearchParams();
    params.append("url", url);
    if (options.dryRun) params.append("dryRun", "true");
    if (options.confirm) params.append("confirm", options.confirm);
    if (options.syncKnowledgeBase !== undefined)
      params.append("syncKnowledgeBase", options.syncKnowledgeBase);

    const response = await api.delete(`/data-management/urls?${params}`);
    return response.data;
  },

  // Get deletion preview for domain
  getDomainDeletionPreview: async (domain) => {
    const response = await api.get(
      `/data-management/domains/${domain}/deletion-preview`
    );
    return response.data;
  },

  // Get deletion preview for URL
  getUrlDeletionPreview: async (url) => {
    const response = await api.get(
      `/data-management/urls/deletion-preview?url=${encodeURIComponent(url)}`
    );
    return response.data;
  },

  // Get available data sources for filtering (LEGACY - for backward compatibility)
  getAvailableDataSources: async () => {
    const response = await api.get("/data-management/domains");
    return response.data;
  },
};

// NEW: Bedrock Storage API for datasource.json registry system
export const bedrockStorageAPI = {
  // Get all datasources from datasource.json files
  getAllDatasources: async () => {
    const response = await api.get("/bedrock-storage/datasources");
    return response.data;
  },

  // Get datasources for a specific type
  getDatasourcesByType: async (type) => {
    const response = await api.get(`/bedrock-storage/datasources/by-type/${type}`);
    return response.data;
  },

  // Get documents by datasource
  getDocumentsByDatasource: async (datasource) => {
    const response = await api.get(`/bedrock-storage/datasources/${datasource}/documents`);
    return response.data;
  },

  // Get storage statistics
  getStorageStats: async () => {
    const response = await api.get("/bedrock-storage/stats");
    return response.data;
  },

  // Trigger knowledge base sync
  syncKnowledgeBase: async () => {
    const response = await api.post("/bedrock-storage/sync");
    return response.data;
  },
};

// FIXED: Action Group API functions with correct endpoints
export const actionGroupAPI = {
  // Create a new action group
  createActionGroup: async (apiConfig) => {
    const response = await api.post("/action-groups/create", apiConfig);
    return response.data;
  },

  // List all action groups
  listActionGroups: async (agentId = null) => {
    const endpoint = agentId
      ? `/action-groups?agentId=${agentId}`
      : "/action-groups";
    const response = await api.get(endpoint);
    return response.data;
  },

  // Get action group details
  getActionGroup: async (actionGroupId) => {
    const response = await api.get(`/action-groups/${actionGroupId}`);
    return response.data;
  },

  // Get action group with editable configuration
  getActionGroupConfig: async (actionGroupId) => {
    const response = await api.get(`/action-groups/${actionGroupId}/config`);
    return response.data;
  },

  // Update action group state (enable/disable only)
  updateActionGroup: async (actionGroupId, updates) => {
    // Only for enable/disable, not full config edit
    const response = await api.put(`/action-groups/${actionGroupId}`, updates);
    return response.data;
  },

  // Edit/update full action group config
  editActionGroupConfig: async (actionGroupId, updates) => {
    // For full config edit (apiConfig, etc.)
    // Response will include .alias if a new alias was created
    const response = await api.put(`/action-groups/${actionGroupId}`, updates);
    return response.data;
  },

  // Delete action group
  deleteActionGroup: async (actionGroupId) => {
    const response = await api.delete(`/action-groups/${actionGroupId}`);
    return response.data;
  },

  // Enable action group - use correct endpoint
  enableActionGroup: async (actionGroupId) => {
    const response = await api.post(`/action-groups/${actionGroupId}/enabled`);
    return response.data;
  },

  // Disable action group - use correct endpoint
  disableActionGroup: async (actionGroupId) => {
    const response = await api.post(`/action-groups/${actionGroupId}/disabled`);
    return response.data;
  },

  // Test action group
  testActionGroup: async (actionGroupId, testData = {}) => {
    const response = await api.post(
      `/action-groups/${actionGroupId}/test`,
      testData
    );
    return response.data;
  },

  // Generate OpenAPI schema preview
  previewOpenAPISchema: async (apiConfig) => {
    const response = await api.post("/action-groups/preview-schema", apiConfig);
    return response.data;
  },

  // Get agent information
  getAgentInfo: async () => {
    const response = await api.get("/action-groups/agent-info");
    return response.data;
  },

  // Validate API configuration
  validateApiConfig: async (apiConfig) => {
    const response = await api.post("/action-groups/validate", apiConfig);
    return response.data;
  },

  // Get action group execution history
  getExecutionHistory: async (actionGroupId, limit = 50) => {
    const response = await api.get(
      `/action-groups/${actionGroupId}/history?limit=${limit}`
    );
    return response.data;
  },

  // Sync action group with agent
  syncWithAgent: async (actionGroupId) => {
    const response = await api.post(`/action-groups/${actionGroupId}/sync`);
    return response.data;
  },
};

export const healthAPI = {
  checkHealth: async () => {
    const response = await api.get("/health");
    return response.data;
  },
};

// Utility to get the latest agent alias from backend
export const getLatestAgentAlias = async () => {
  const response = await api.get("/action-groups/aliases/latest");
  if (response.data && response.data.success && response.data.data?.aliasId) {
    return response.data.data.aliasId;
  }
  throw new Error("No latest alias found");
};

export default api;
