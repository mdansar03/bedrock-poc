import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';
// Allow long-running requests from the browser (default 20 minutes)
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT_MS || '1200000', 10);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    console.log(`Making ${config.method?.toUpperCase()} request to ${config.url}`);
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
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// API functions
export const scrapingAPI = {
  scrapeWebsite: async (url, options = {}) => {
    const response = await api.post('/scraping/scrape', { url, options });
    return response.data;
  },
  
  crawlWebsite: async (url, options = {}) => {
    const response = await api.post('/scraping/crawl', { url, options });
    return response.data;
  },
  
  // Start async crawl job (returns immediately with jobId)
  startAsyncCrawl: async (url, options = {}) => {
    const response = await api.post('/scraping/enhanced-crawl', { url, options });
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
        if (data.status === 'completed') {
          return { success: true, data: data.result };
        }
        
        // Check if job failed
        if (data.status === 'failed') {
          throw new Error(data.error || 'Crawl job failed');
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        if (error.response?.status === 404) {
          throw new Error('Crawl job not found');
        }
        throw error;
      }
    }
    
    throw new Error('Crawl job timed out');
  },
  
  getStatus: async (domain = null) => {
    const endpoint = domain ? `/scraping/status/${domain}` : '/scraping/status';
    const response = await api.get(endpoint);
    return response.data;
  },
  
  getOptions: async () => {
    const response = await api.get('/scraping/options');
    return response.data;
  },

  checkHealth: async () => {
    const response = await api.get('/scraping/health');
    return response.data;
  }
};

export const chatAPI = {
  sendMessage: async (message, sessionId = null, model = null) => {
    const payload = { message };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    if (model) {
      payload.model = model;
    }
    const response = await api.post('/chat/query', payload);
    return response.data;
  },
  
  sendDirectMessage: async (prompt) => {
    const response = await api.post('/chat/direct', { prompt });
    return response.data;
  },
  
  testKnowledgeBase: async () => {
    const response = await api.get('/chat/test');
    return response.data;
  },
  
  getSession: async (sessionId) => {
    const response = await api.get(`/chat/session/${sessionId}`);
    return response.data;
  },
  
  getModels: async () => {
    const response = await api.get('/chat/models');
    return response.data;
  }
};

export const syncAPI = {
  checkSyncStatus: async (jobId) => {
    const response = await api.get(`/scraping/sync/status/${jobId}`);
    return response.data;
  },
  
  triggerSync: async (domain) => {
    const response = await api.post('/scraping/sync', { domain });
    return response.data;
  }
};

export const filesAPI = {
  uploadFiles: async (formData) => {
    const response = await api.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  
  getInfo: async () => {
    const response = await api.get('/files/info');
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
    const response = await api.get('/files/stats');
    return response.data;
  },
  
  triggerSync: async () => {
    const response = await api.post('/files/sync');
    return response.data;
  },
  
  checkHealth: async () => {
    const response = await api.get('/files/health');
    return response.data;
  }
};

export const healthAPI = {
  checkHealth: async () => {
    const response = await api.get('/health');
    return response.data;
  }
};

export default api;