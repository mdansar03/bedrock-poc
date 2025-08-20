import DOMPurify from 'dompurify';

/**
 * Frontend HTML Sanitization Utilities
 * Provides safe HTML rendering for Bedrock agent responses
 */
class HTMLSanitizer {
  constructor() {
    this.configurePurifier();
  }

  /**
   * Configure DOMPurify with safe HTML tags and attributes for frontend
   */
  configurePurifier() {
    // Allowed HTML tags for chat responses
    this.allowedTags = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'mark',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'span', 'div',
      'hr', 'small', 'sub', 'sup'
    ];

    // Safe attributes
    this.allowedAttributes = {
      'a': ['href', 'title', 'target', 'rel', 'class'],
      '*': ['class', 'id'],
      'pre': ['class'],
      'code': ['class'],
      'table': ['class'],
      'th': ['class', 'scope'],
      'td': ['class'],
      'blockquote': ['class'],
      'ul': ['class'],
      'ol': ['class'],
      'li': ['class']
    };

    // DOMPurify configuration
    this.purifyConfig = {
      ALLOWED_TAGS: this.allowedTags,
      ALLOWED_ATTR: [
        'href', 'title', 'target', 'rel', 'class', 'id', 'scope'
      ],
      ALLOW_DATA_ATTR: false,
      FORCE_BODY: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      SANITIZE_DOM: true,
      KEEP_CONTENT: true,
      IN_PLACE: false,
      ALLOW_ARIA_ATTR: true,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      // Force target="_blank" and rel="noopener noreferrer" for all links
      HOOK_BEFORE: (node, data, config) => {
        if (data.tagName === 'A') {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
    };
  }

  /**
   * Sanitize HTML content for safe display in React
   * @param {string} html - HTML content to sanitize
   * @returns {string} - Sanitized HTML
   */
  sanitizeHTML(html) {
    if (!html || typeof html !== 'string') {
      return '';
    }

    try {
      // Sanitize with DOMPurify
      const cleanHTML = DOMPurify.sanitize(html, this.purifyConfig);
      
      // Additional safety checks
      if (!cleanHTML || cleanHTML.length === 0) {
        return this.escapeHTML(html);
      }

      return cleanHTML;
    } catch (error) {
      console.error('HTML sanitization failed:', error);
      return this.escapeHTML(html);
    }
  }

  /**
   * Escape HTML characters as fallback
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeHTML(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Check if content appears to be HTML
   * @param {string} content - Content to check
   * @returns {boolean} - True if content appears to be HTML
   */
  isHTML(content) {
    if (!content || typeof content !== 'string') return false;
    
    // Check for HTML tags
    const htmlRegex = /<\/?[a-z][\s\S]*>/i;
    return htmlRegex.test(content);
  }

  /**
   * Process content for display - either sanitize HTML or escape plain text
   * @param {string} content - Content to process
   * @returns {Object} - Processed content with metadata
   */
  processContent(content) {
    if (!content) {
      return {
        html: '',
        isHTML: false,
        sanitized: false
      };
    }

    const isHTMLContent = this.isHTML(content);
    
    if (isHTMLContent) {
      const originalLength = content.length;
      const sanitizedHTML = this.sanitizeHTML(content);
      
      return {
        html: sanitizedHTML,
        isHTML: true,
        sanitized: sanitizedHTML.length !== originalLength,
        originalLength,
        cleanLength: sanitizedHTML.length
      };
    } else {
      // Plain text - escape and wrap in paragraph
      return {
        html: `<p class="response-paragraph">${this.escapeHTML(content)}</p>`,
        isHTML: false,
        sanitized: false
      };
    }
  }

  /**
   * Validate that HTML is safe for rendering
   * @param {string} html - HTML to validate
   * @returns {Object} - Validation result
   */
  validateHTML(html) {
    try {
      const cleanHTML = this.sanitizeHTML(html);
      
      return {
        valid: true,
        html: cleanHTML,
        safe: true,
        originalLength: html.length,
        cleanLength: cleanHTML.length,
        sanitized: html !== cleanHTML
      };
    } catch (error) {
      return {
        valid: false,
        safe: false,
        error: error.message,
        html: this.escapeHTML(html)
      };
    }
  }
}

// Export singleton instance
export default new HTMLSanitizer();
