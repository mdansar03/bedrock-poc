/**
 * Streaming API utilities for Server-Sent Events (SSE) integration
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002';

/**
 * Create a streaming connection for agent chat
 * @param {Object} options - Request options
 * @param {string} options.message - User message
 * @param {string} options.sessionId - Session ID
 * @param {string} options.model - Model to use
 * @param {number} options.temperature - Temperature setting
 * @param {number} options.topP - Top P setting
 * @param {string} options.systemPrompt - System prompt
 * @param {Object} options.history - Conversation history configuration
 * @param {Array} options.conversationHistory - Direct conversation history array
 * @param {Object} options.dataSources - Data source filters
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onStart - Called when streaming starts
 * @param {Function} callbacks.onChunk - Called for each text chunk
 * @param {Function} callbacks.onCitation - Called for each citation
 * @param {Function} callbacks.onMetadata - Called for metadata updates
 * @param {Function} callbacks.onComplete - Called when streaming completes
 * @param {Function} callbacks.onError - Called on error
 * @returns {EventSource} - The EventSource instance for the streaming connection
 */
export const createAgentStream = async (options, callbacks) => {
  const {
    message,
    sessionId,
    model,
    temperature,
    topP,
    systemPrompt,
    history,
    conversationHistory,
    dataSources,
  } = options;

  const {
    onStart = () => {},
    onChunk = () => {},
    onCitation = () => {},
    onMetadata = () => {},
    onComplete = () => {},
    onError = () => {}
  } = callbacks;

  try {
    // Make initial POST request to start streaming
    const response = await fetch(`${API_BASE_URL}/api/streaming-chat/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        sessionId,
        model,
        temperature,
        topP,
        systemPrompt: systemPrompt?.trim() || undefined,
        history,
        conversationHistory, // NEW: Include conversation history in streaming
        dataSources,
        options: {
          useEnhancement: true,
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Create EventSource from response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
              const eventType = line.substring(7).trim();
              continue;
            }
            
            if (line.startsWith('data: ')) {
              const data = line.substring(6).trim();
              if (data === '') continue;

              try {
                const parsed = JSON.parse(data);
                
                if (line.includes('event: start')) {
                  onStart(parsed);
                } else if (line.includes('event: chunk')) {
                  onChunk(parsed.content || '');
                } else if (line.includes('event: citation')) {
                  onCitation(parsed.source);
                } else if (line.includes('event: metadata')) {
                  onMetadata(parsed);
                } else if (line.includes('event: end')) {
                  onComplete(parsed);
                } else if (line.includes('event: error')) {
                  onError(new Error(parsed.error || 'Streaming error'));
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      } catch (error) {
        onError(error);
      } finally {
        reader.releaseLock();
      }
    };

    processStream();

    // Return a mock EventSource-like object for compatibility
    return {
      close: () => {
        reader.cancel();
      },
      readyState: 1, // OPEN
    };

  } catch (error) {
    onError(error);
    return null;
  }
};

/**
 * Create a streaming connection for direct model chat
 * @param {Object} options - Request options
 * @param {Object} callbacks - Event callbacks
 * @returns {EventSource} - The EventSource instance for the streaming connection
 */
export const createDirectModelStream = async (options, callbacks) => {
  const {
    message,
    model,
    temperature,
    topP,
    maxTokens,
  } = options;

  const {
    onStart = () => {},
    onChunk = () => {},
    onComplete = () => {},
    onError = () => {}
  } = callbacks;

  try {
    const response = await fetch(`${API_BASE_URL}/api/streaming-chat/direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        model,
        temperature,
        topP,
        maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

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
                    onStart(parsed);
                    break;
                  case 'chunk':
                    onChunk(parsed.content || '');
                    break;
                  case 'end':
                    onComplete(parsed);
                    break;
                  case 'error':
                    onError(new Error(parsed.error || 'Streaming error'));
                    break;
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      } catch (error) {
        onError(error);
      } finally {
        reader.releaseLock();
      }
    };

    processStream();

    return {
      close: () => {
        reader.cancel();
      },
      readyState: 1, // OPEN
    };

  } catch (error) {
    onError(error);
    return null;
  }
};

/**
 * Create a streaming connection for knowledge base chat
 * @param {Object} options - Request options
 * @param {Object} callbacks - Event callbacks
 * @returns {EventSource} - The EventSource instance for the streaming connection
 */
export const createKnowledgeBaseStream = async (options, callbacks) => {
  const {
    message,
    sessionId,
    model,
    enhancementOptions,
  } = options;

  const {
    onStart = () => {},
    onSources = () => {},
    onChunk = () => {},
    onComplete = () => {},
    onError = () => {}
  } = callbacks;

  try {
    const response = await fetch(`${API_BASE_URL}/api/streaming-chat/knowledge-base`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        sessionId,
        model,
        enhancementOptions,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

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
                    onStart(parsed);
                    break;
                  case 'sources':
                    onSources(parsed.sources || []);
                    break;
                  case 'chunk':
                    onChunk(parsed.content || '');
                    break;
                  case 'end':
                    onComplete(parsed);
                    break;
                  case 'error':
                    onError(new Error(parsed.error || 'Streaming error'));
                    break;
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      } catch (error) {
        onError(error);
      } finally {
        reader.releaseLock();
      }
    };

    processStream();

    return {
      close: () => {
        reader.cancel();
      },
      readyState: 1, // OPEN
    };

  } catch (error) {
    onError(error);
    return null;
  }
};

/**
 * Utility function to calculate streaming statistics
 * @param {number} startTime - Start timestamp
 * @param {string} content - Content received
 * @param {number} tokensUsed - Number of tokens used
 * @returns {Object} - Streaming statistics
 */
export const calculateStreamingStats = (startTime, content, tokensUsed = 0) => {
  const totalTime = Date.now() - startTime;
  const charactersReceived = content.length;
  const wordsReceived = content.split(/\s+/).filter(word => word.length > 0).length;
  const wordsPerSecond = totalTime > 0 ? Math.round((wordsReceived / totalTime) * 1000) : 0;
  const charactersPerSecond = totalTime > 0 ? Math.round((charactersReceived / totalTime) * 1000) : 0;

  return {
    totalTime: `${totalTime}ms`,
    charactersReceived,
    wordsReceived,
    wordsPerSecond,
    charactersPerSecond,
    tokensUsed,
    efficiency: tokensUsed > 0 ? Math.round((charactersReceived / tokensUsed) * 100) / 100 : 0,
  };
};

/**
 * Format streaming stats for display
 * @param {Object} stats - Streaming statistics
 * @returns {string} - Formatted stats string
 */
export const formatStreamingStats = (stats) => {
  return [
    `${stats.totalTime}`,
    `${stats.charactersReceived} chars`,
    `${stats.wordsPerSecond} WPS`,
    stats.tokensUsed > 0 ? `${stats.tokensUsed} tokens` : null,
  ].filter(Boolean).join(' | ');
};

export default {
  createAgentStream,
  createDirectModelStream,
  createKnowledgeBaseStream,
  calculateStreamingStats,
  formatStreamingStats,
};
