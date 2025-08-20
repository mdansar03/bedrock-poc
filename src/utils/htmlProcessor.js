const marked = require('marked');
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const logger = require('./logger');

// Create JSDOM window for DOMPurify (server-side)
const window = new JSDOM('').window;
const purify = DOMPurify(window);

/**
 * HTML Processing Utilities for AWS Bedrock Responses
 * Provides safe HTML sanitization, formatting, and conversion
 */
class HTMLProcessor {
  constructor() {
    this.configureMarked();
    this.configurePurifier();
  }

  /**
   * Configure marked parser for consistent HTML output
   */
  configureMarked() {
    // Set options using the v4 syntax
    marked.use({
      headerIds: false,
      mangle: false,
      breaks: true,
      gfm: true,
      tables: true,
      sanitize: false, // We'll use DOMPurify for sanitization
    });

    // Custom renderer for better HTML structure
    const renderer = new marked.Renderer();
    
    // Custom heading renderer with better classes
    renderer.heading = function(text, level) {
      const className = `response-heading response-h${level}`;
      return `<h${level} class="${className}">${text}</h${level}>`;
    };

    // Custom paragraph renderer
    renderer.paragraph = function(text) {
      return `<p class="response-paragraph">${text}</p>`;
    };

    // Custom list renderer
    renderer.list = function(body, ordered) {
      const tag = ordered ? 'ol' : 'ul';
      const className = ordered ? 'response-ordered-list' : 'response-unordered-list';
      return `<${tag} class="${className}">${body}</${tag}>`;
    };

    // Custom list item renderer
    renderer.listitem = function(text) {
      return `<li class="response-list-item">${text}</li>`;
    };

    // Custom blockquote renderer
    renderer.blockquote = function(quote) {
      return `<blockquote class="response-blockquote">${quote}</blockquote>`;
    };

    // Custom code block renderer
    renderer.code = function(code, language) {
      const className = language ? `response-code language-${language}` : 'response-code';
      return `<pre class="response-code-block"><code class="${className}">${this.escapeHTML(code)}</code></pre>`;
    };

    // Custom inline code renderer
    renderer.codespan = function(code) {
      return `<code class="response-inline-code">${this.escapeHTML(code)}</code>`;
    };

    // Custom table renderer
    renderer.table = function(header, body) {
      return `<table class="response-table">
        <thead class="response-table-header">${header}</thead>
        <tbody class="response-table-body">${body}</tbody>
      </table>`;
    };

    // Custom link renderer with security
    renderer.link = function(href, title, text) {
      const titleAttr = title ? ` title="${this.escapeHTML(title)}"` : '';
      return `<a href="${this.escapeHTML(href)}" class="response-link" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    };

    // Custom strong/bold renderer
    renderer.strong = function(text) {
      return `<strong class="response-strong">${text}</strong>`;
    };

    // Custom emphasis/italic renderer
    renderer.em = function(text) {
      return `<em class="response-emphasis">${text}</em>`;
    };

    marked.use({ renderer });
  }

  /**
   * Configure DOMPurify with safe HTML tags and attributes
   */
  configurePurifier() {
    this.allowedTags = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'b', 'em', 'i', 'u',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'span', 'div',
      'hr'
    ];

    this.allowedAttributes = {
      'a': ['href', 'title', 'target', 'rel', 'class'],
      '*': ['class', 'id']
    };

    this.purifyConfig = {
      ALLOWED_TAGS: this.allowedTags,
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'id'],
      ALLOW_DATA_ATTR: false,
      FORCE_BODY: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      SANITIZE_DOM: true,
      KEEP_CONTENT: true,
      IN_PLACE: false,
      ALLOW_ARIA_ATTR: true,
      ALLOW_UNKNOWN_PROTOCOLS: false
    };
  }

  /**
   * Process Bedrock agent response to HTML format
   * @param {string} response - Raw response text from Bedrock
   * @param {Object} options - Processing options
   * @returns {Object} - Processed HTML content with metadata
   */
  processBedrockResponse(response, options = {}) {
    try {
      const startTime = Date.now();
      
      if (!response || typeof response !== 'string') {
        logger.warn('Invalid response provided to HTML processor:', typeof response);
        return {
          html: '<p class="response-error">No response content available</p>',
          originalText: response || '',
          processingTime: Date.now() - startTime,
          format: 'error'
        };
      }

      // Detect response format
      const format = this.detectFormat(response);
      let processedHTML = '';

      switch (format) {
        case 'html':
          processedHTML = this.sanitizeHTML(response);
          break;
        case 'markdown':
          processedHTML = this.markdownToHTML(response);
          break;
        case 'text':
        default:
          processedHTML = this.textToHTML(response);
          break;
      }

      // Apply additional processing based on options
      if (options.enhanceFormatting) {
        processedHTML = this.enhanceHTMLFormatting(processedHTML);
      }

      if (options.addMetadata) {
        processedHTML = this.addResponseMetadata(processedHTML, options.metadata);
      }

      const processingTime = Date.now() - startTime;

      logger.debug('HTML processing completed:', {
        originalLength: response.length,
        htmlLength: processedHTML.length,
        format: format,
        processingTime: `${processingTime}ms`,
        enhanced: !!options.enhanceFormatting
      });

      return {
        html: processedHTML,
        originalText: response,
        processingTime,
        format,
        enhanced: !!options.enhanceFormatting
      };

    } catch (error) {
      logger.error('HTML processing failed:', error);
      return {
        html: `<div class="response-error">
          <p>Error processing response content.</p>
          <pre class="response-fallback">${this.escapeHTML(response)}</pre>
        </div>`,
        originalText: response,
        processingTime: 0,
        format: 'error',
        error: error.message
      };
    }
  }

  /**
   * Detect the format of the response (HTML, Markdown, or plain text)
   * @param {string} text - Response text to analyze
   * @returns {string} - Detected format: 'html', 'markdown', or 'text'
   */
  detectFormat(text) {
    // Check for HTML tags
    const htmlRegex = /<\/?[a-z][\s\S]*>/i;
    if (htmlRegex.test(text)) {
      return 'html';
    }

    // Check for Markdown patterns
    const markdownPatterns = [
      /^#{1,6}\s+/m,           // Headers
      /^\*\s+|\d+\.\s+/m,      // Lists
      /\*\*[\s\S]*?\*\*/,      // Bold
      /\*[\s\S]*?\*/,          // Italic
      /`[\s\S]*?`/,            // Inline code
      /```[\s\S]*?```/,        // Code blocks
      /^\>.*/m,                // Blockquotes
      /\[.*?\]\(.*?\)/,        // Links
      /\|.*?\|.*?\|/m          // Tables
    ];

    for (const pattern of markdownPatterns) {
      if (pattern.test(text)) {
        return 'markdown';
      }
    }

    return 'text';
  }

  /**
   * Convert plain text to structured HTML
   * @param {string} text - Plain text input
   * @returns {string} - HTML formatted content
   */
  textToHTML(text) {
    if (!text) return '';

    // Split into paragraphs and process
    let html = text
      .split(/\n\s*\n/)  // Split on double newlines
      .map(paragraph => {
        if (!paragraph.trim()) return '';
        
        // Process single line breaks within paragraphs
        const processedParagraph = paragraph
          .replace(/\n/g, '<br>')  // Convert single newlines to <br>
          .trim();

        // Detect if this looks like a list item
        if (/^[\-\*\+]\s+/.test(processedParagraph)) {
          return `<li class="response-list-item">${processedParagraph.replace(/^[\-\*\+]\s+/, '')}</li>`;
        }
        
        // Detect numbered list items
        if (/^\d+\.\s+/.test(processedParagraph)) {
          return `<li class="response-list-item">${processedParagraph.replace(/^\d+\.\s+/, '')}</li>`;
        }

        // Regular paragraph
        return `<p class="response-paragraph">${processedParagraph}</p>`;
      })
      .filter(p => p)  // Remove empty paragraphs
      .join('\n');

    // Wrap consecutive list items in proper list tags
    html = this.wrapListItems(html);

    // Apply basic text enhancements
    html = this.applyBasicTextFormatting(html);

    return html;
  }

  /**
   * Convert Markdown to HTML
   * @param {string} markdown - Markdown input
   * @returns {string} - HTML output
   */
  markdownToHTML(markdown) {
    try {
      const html = marked(markdown);
      return this.sanitizeHTML(html);
    } catch (error) {
      logger.warn('Markdown parsing failed, falling back to text:', error.message);
      return this.textToHTML(markdown);
    }
  }

  /**
   * Sanitize HTML content for safe display
   * @param {string} html - HTML content to sanitize
   * @returns {string} - Sanitized HTML
   */
  sanitizeHTML(html) {
    if (!html) return '';
    
    try {
      return purify.sanitize(html, this.purifyConfig);
    } catch (error) {
      logger.error('HTML sanitization failed:', error);
      return this.escapeHTML(html);
    }
  }

  /**
   * Escape HTML characters
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeHTML(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Wrap consecutive list items in proper list tags
   * @param {string} html - HTML with potential unwrapped list items
   * @returns {string} - HTML with properly wrapped lists
   */
  wrapListItems(html) {
    // Wrap consecutive <li> tags in <ul>
    html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<li[^>]*>.*?<\/li>)*)/gs, '<ul class="response-unordered-list">$1</ul>');
    
    return html;
  }

  /**
   * Apply basic text formatting enhancements
   * @param {string} html - HTML content
   * @returns {string} - Enhanced HTML
   */
  applyBasicTextFormatting(html) {
    // Convert **text** to bold (if not already processed)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="response-strong">$1</strong>');
    
    // Convert *text* to italic (if not already processed)
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em class="response-emphasis">$1</em>');
    
    // Convert `code` to inline code (if not already processed)
    html = html.replace(/`([^`]+)`/g, '<code class="response-inline-code">$1</code>');

    return html;
  }

  /**
   * Enhance HTML formatting with additional structure
   * @param {string} html - HTML content to enhance
   * @returns {string} - Enhanced HTML
   */
  enhanceHTMLFormatting(html) {
    // Wrap the entire content in a response container
    return `<div class="bedrock-response">${html}</div>`;
  }

  /**
   * Add metadata to HTML response
   * @param {string} html - HTML content
   * @param {Object} metadata - Metadata to add
   * @returns {string} - HTML with metadata
   */
  addResponseMetadata(html, metadata = {}) {
    if (!metadata || Object.keys(metadata).length === 0) {
      return html;
    }

    const metadataHTML = `
      <div class="response-metadata" style="margin-top: 1rem; padding-top: 0.5rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280;">
        ${metadata.processingTime ? `<span>Processing: ${metadata.processingTime}ms</span>` : ''}
        ${metadata.format ? `<span style="margin-left: 1rem;">Format: ${metadata.format}</span>` : ''}
        ${metadata.model ? `<span style="margin-left: 1rem;">Model: ${metadata.model}</span>` : ''}
      </div>
    `;

    return html + metadataHTML;
  }

  /**
   * Validate HTML content
   * @param {string} html - HTML to validate
   * @returns {Object} - Validation result
   */
  validateHTML(html) {
    try {
      const cleanHTML = this.sanitizeHTML(html);
      return {
        valid: true,
        html: cleanHTML,
        originalLength: html.length,
        cleanLength: cleanHTML.length,
        sanitized: html !== cleanHTML
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        html: this.escapeHTML(html)
      };
    }
  }
}

// Export singleton instance
module.exports = new HTMLProcessor();
