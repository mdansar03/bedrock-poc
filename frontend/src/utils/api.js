import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
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
  
  getCrawlProgress: async (jobId) => {
    const response = await api.get(`/scraping/crawl/progress/${jobId}`);
    return response.data;
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

export const healthAPI = {
  checkHealth: async () => {
    const response = await api.get('/health');
    return response.data;
  }
};

export default api;