import React from 'react';
import htmlSanitizer from '../utils/htmlSanitizer';

/**
 * HTMLContent Component
 * Safely renders HTML content from AI responses with sanitization
 */
const HTMLContent = ({ 
  content, 
  className = '', 
  fallbackToText = true,
  showMetadata = false 
}) => {
  // Process and sanitize the content
  const processedContent = htmlSanitizer.processContent(content);

  // If content is empty, show nothing
  if (!content || content.trim().length === 0) {
    return null;
  }

  // If we have HTML content, render it safely
  if (processedContent.isHTML && processedContent.html) {
    return (
      <div className={`html-content ${className}`}>
        <div 
          className="html-content-body"
          dangerouslySetInnerHTML={{ __html: processedContent.html }}
        />
        {showMetadata && processedContent.sanitized && (
          <div className="html-content-metadata">
            <small className="text-xs text-gray-500">
              Content was sanitized for security
            </small>
          </div>
        )}
      </div>
    );
  }

  // Fallback to plain text rendering if HTML processing fails
  if (fallbackToText) {
    return (
      <div className={`text-content ${className}`}>
        <p className="whitespace-pre-wrap">{content}</p>
        {showMetadata && (
          <div className="text-content-metadata">
            <small className="text-xs text-gray-500">
              Displayed as plain text
            </small>
          </div>
        )}
      </div>
    );
  }

  return null;
};

/**
 * Enhanced HTMLContent with additional features
 */
export const EnhancedHTMLContent = ({ 
  content,
  htmlContent = null,
  className = '',
  preferHTML = true,
  showFormatInfo = false,
  metadata = null
}) => {
  // Determine which content to use
  const contentToRender = preferHTML && htmlContent ? htmlContent : content;
  const isUsingHTML = preferHTML && htmlContent;

  if (!contentToRender) {
    return null;
  }

  return (
    <div className={`enhanced-html-content ${className}`}>
      <HTMLContent 
        content={contentToRender}
        fallbackToText={true}
        showMetadata={false}
      />
      
      {showFormatInfo && metadata?.htmlFormatting && (
        <div className="format-info mt-2 pt-2 border-t border-gray-200">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className={`px-2 py-1 rounded ${
              isUsingHTML ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>
              Format: {metadata.htmlFormatting.format || 'text'}
            </span>
            
            {metadata.htmlFormatting.enhanced && (
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-700">
                Enhanced
              </span>
            )}
            
            {metadata.htmlFormatting.processingTime > 0 && (
              <span className="text-gray-400">
                Processed in {metadata.htmlFormatting.processingTime}ms
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HTMLContent;
