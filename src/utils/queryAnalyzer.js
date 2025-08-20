/**
 * Intelligent Query Analyzer for Smart Routing
 * Determines whether a query needs Agent (action groups) or can use direct Knowledge Base streaming
 */

const logger = require('./logger');

class QueryAnalyzer {
  constructor() {
    // Action/API indicators - queries that need action groups
    this.actionIndicators = [
      // API operations
      'call', 'invoke', 'execute', 'run', 'trigger', 'perform', 'do',
      'create', 'delete', 'update', 'modify', 'change', 'add', 'remove',
      'send', 'post', 'get', 'put', 'patch',
      
      // Function/method calls
      'function', 'method', 'endpoint', 'api', 'service', 'operation',
      'action', 'command', 'script', 'automation',
      
      // Data manipulation
      'calculate', 'compute', 'process', 'transform', 'convert',
      'generate', 'produce', 'build', 'make',
      
      // External integrations
      'integrate', 'connect', 'sync', 'import', 'export',
      'webhook', 'callback', 'notification',
      
      // System operations
      'configure', 'setup', 'install', 'deploy', 'start', 'stop',
      'restart', 'reset', 'initialize'
    ];

    // Knowledge/information indicators - queries that can use direct KB
    this.knowledgeIndicators = [
      // Information seeking
      'what', 'how', 'why', 'when', 'where', 'who', 'which',
      'explain', 'describe', 'tell me about', 'information about',
      'details about', 'learn about', 'understand',
      
      // Research/discovery
      'find', 'search', 'look for', 'discover', 'explore',
      'show me', 'list', 'display', 'browse',
      
      // Comparison/analysis (informational)
      'compare', 'difference', 'similar', 'versus', 'vs',
      'pros and cons', 'advantages', 'disadvantages',
      
      // Documentation queries
      'documentation', 'guide', 'manual', 'tutorial',
      'example', 'sample', 'demo', 'illustration',
      
      // Specification queries
      'specification', 'requirements', 'features', 'capabilities',
      'overview', 'summary', 'description'
    ];

    // Keywords that strongly suggest action groups are needed
    this.strongActionKeywords = [
      'api call', 'function call', 'execute function', 'run function',
      'trigger action', 'perform action', 'call endpoint',
      'invoke service', 'automation', 'workflow'
    ];

    // Keywords that strongly suggest knowledge base only
    this.strongKnowledgeKeywords = [
      'what is', 'tell me about', 'explain', 'describe',
      'information about', 'details about', 'documentation',
      'how does', 'why does', 'when does'
    ];
  }

  /**
   * Analyze query to determine optimal routing
   * @param {string} query - User query to analyze
   * @param {Object} context - Additional context (session history, etc.)
   * @returns {Object} - Analysis result with routing recommendation
   */
  analyzeQuery(query, context = {}) {
    const lowerQuery = query.toLowerCase().trim();
    
    // Check for strong indicators first
    const hasStrongActionKeywords = this.strongActionKeywords.some(keyword => 
      lowerQuery.includes(keyword)
    );
    
    const hasStrongKnowledgeKeywords = this.strongKnowledgeKeywords.some(keyword => 
      lowerQuery.includes(keyword)
    );

    // If strong indicators exist, use them
    if (hasStrongActionKeywords && !hasStrongKnowledgeKeywords) {
      return {
        recommendedRoute: 'agent',
        confidence: 0.9,
        reason: 'Strong action/API keywords detected',
        streamingType: 'optimized-fake',
        queryType: 'action-oriented'
      };
    }

    if (hasStrongKnowledgeKeywords && !hasStrongActionKeywords) {
      return {
        recommendedRoute: 'knowledge-base',
        confidence: 0.9,
        reason: 'Strong knowledge-seeking keywords detected',
        streamingType: 'true-aws-streaming',
        queryType: 'information-seeking'
      };
    }

    // Score both approaches
    const actionScore = this.calculateActionScore(lowerQuery);
    const knowledgeScore = this.calculateKnowledgeScore(lowerQuery);

    // Consider context from previous queries
    const contextBonus = this.analyzeContext(context);
    const finalActionScore = actionScore + contextBonus.actionBonus;
    const finalKnowledgeScore = knowledgeScore + contextBonus.knowledgeBonus;

    // Determine routing
    let recommendedRoute = 'agent'; // Default to agent (conservative)
    let streamingType = 'optimized-fake';
    let confidence = 0.5;
    let reason = 'Default routing to agent for safety';

    if (finalKnowledgeScore > finalActionScore + 0.2) { // Knowledge needs higher threshold
      recommendedRoute = 'knowledge-base';
      streamingType = 'true-aws-streaming';
      confidence = Math.min(0.9, 0.6 + (finalKnowledgeScore - finalActionScore));
      reason = `Knowledge score (${finalKnowledgeScore.toFixed(2)}) > Action score (${finalActionScore.toFixed(2)})`;
    }

    return {
      recommendedRoute,
      confidence,
      reason,
      streamingType,
      queryType: recommendedRoute === 'agent' ? 'action-oriented' : 'information-seeking',
      scores: {
        action: finalActionScore,
        knowledge: finalKnowledgeScore,
        contextBonus
      },
      fallbackRoute: recommendedRoute === 'agent' ? 'knowledge-base' : 'agent',
      analysis: {
        hasActionIndicators: actionScore > 0,
        hasKnowledgeIndicators: knowledgeScore > 0,
        hasStrongActionKeywords,
        hasStrongKnowledgeKeywords,
        queryLength: query.length,
        wordCount: query.split(' ').length
      }
    };
  }

  /**
   * Calculate action/API orientation score
   * @param {string} lowerQuery - Lowercase query
   * @returns {number} - Action score (0-1)
   */
  calculateActionScore(lowerQuery) {
    let score = 0;
    const words = lowerQuery.split(' ');

    // Check for action indicators
    this.actionIndicators.forEach(indicator => {
      if (lowerQuery.includes(indicator)) {
        score += 0.1;
      }
    });

    // Boost score for imperative verbs at start
    const firstWord = words[0];
    if (['call', 'invoke', 'execute', 'run', 'create', 'delete', 'update'].includes(firstWord)) {
      score += 0.3;
    }

    // Boost for API-related patterns
    if (lowerQuery.includes('api') || lowerQuery.includes('endpoint')) {
      score += 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate knowledge/information seeking score
   * @param {string} lowerQuery - Lowercase query
   * @returns {number} - Knowledge score (0-1)
   */
  calculateKnowledgeScore(lowerQuery) {
    let score = 0;
    const words = lowerQuery.split(' ');

    // Check for knowledge indicators
    this.knowledgeIndicators.forEach(indicator => {
      if (lowerQuery.includes(indicator)) {
        score += 0.1;
      }
    });

    // Boost score for question words at start
    const firstWord = words[0];
    if (['what', 'how', 'why', 'when', 'where', 'who', 'which'].includes(firstWord)) {
      score += 0.3;
    }

    // Boost for information-seeking patterns
    if (lowerQuery.includes('?') || lowerQuery.includes('about')) {
      score += 0.2;
    }

    // Boost for documentation-related queries
    if (lowerQuery.includes('document') || lowerQuery.includes('manual') || lowerQuery.includes('guide')) {
      score += 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * Analyze conversation context for routing hints
   * @param {Object} context - Context from previous queries
   * @returns {Object} - Context-based bonuses
   */
  analyzeContext(context) {
    let actionBonus = 0;
    let knowledgeBonus = 0;

    // If previous queries were action-oriented, slightly favor actions
    if (context.previousQueryTypes) {
      const recentActionQueries = context.previousQueryTypes.slice(-3).filter(type => type === 'action-oriented').length;
      const recentKnowledgeQueries = context.previousQueryTypes.slice(-3).filter(type => type === 'information-seeking').length;
      
      actionBonus = recentActionQueries * 0.05;
      knowledgeBonus = recentKnowledgeQueries * 0.05;
    }

    // If session has been using one type consistently, provide continuity
    if (context.sessionPattern) {
      if (context.sessionPattern === 'mostly-actions') {
        actionBonus += 0.1;
      } else if (context.sessionPattern === 'mostly-knowledge') {
        knowledgeBonus += 0.1;
      }
    }

    return { actionBonus, knowledgeBonus };
  }

  /**
   * Get user-friendly explanation of routing decision
   * @param {Object} analysis - Analysis result
   * @returns {string} - User-friendly explanation
   */
  getRoutingExplanation(analysis) {
    const route = analysis.recommendedRoute;
    const confidence = (analysis.confidence * 100).toFixed(0);
    
    if (route === 'agent') {
      return `Using Agent mode (${confidence}% confidence) - ${analysis.reason}. This enables action groups and comprehensive capabilities.`;
    } else {
      return `Using Knowledge Base streaming (${confidence}% confidence) - ${analysis.reason}. This provides real-time streaming responses.`;
    }
  }

  /**
   * Simple analysis for when full analysis isn't needed
   * @param {string} query - User query
   * @returns {string} - 'agent', 'knowledge-base', or 'hybrid'
   */
  quickAnalyze(query) {
    const lowerQuery = query.toLowerCase();
    
    // Quick checks for obvious patterns
    if (this.strongActionKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return 'agent';
    }
    
    if (this.strongKnowledgeKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return 'knowledge-base';
    }
    
    // Default to knowledge base for better streaming experience
    return 'knowledge-base';
  }
}

module.exports = new QueryAnalyzer();
