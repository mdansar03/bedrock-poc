/**
 * Comprehensive data extraction methods for all content types
 */

class DataExtractors {
  
  /**
   * Extract comprehensive product information
   */
  static extractProducts($, products) {
    const productSelectors = [
      // Standard product containers
      '.product', '.product-item', '.product-card', '.product-container', '.product-wrapper',
      '.item', '.item-card', '.item-container', '.catalog-item', '.shop-item',
      '.listing', '.listing-item', '.grid-item', '.tile', '.product-tile',
      
      // E-commerce specific
      '.woocommerce-product', '.shopify-product', '.magento-product',
      '.product-detail', '.product-summary', '.product-overview',
      
      // Schema.org microdata
      '[itemtype*="Product"]', '[itemtype*="product"]',
      
      // Generic containers that might contain products
      '.box', '.card', '.module', '.block'
    ];

    productSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        // Skip if already processed or too small
        if ($el.attr('data-processed') || $el.text().trim().length < 20) return;
        
        const product = {
          // Basic information
          name: this.extractText($el, [
            'h1', 'h2', 'h3', '.title', '.name', '.product-title', '.product-name',
            '.item-title', '.heading', '[itemprop="name"]', '.product-heading'
          ]),
          
          description: this.extractText($el, [
            '.description', '.summary', '.excerpt', '.product-description',
            '.product-summary', '.item-description', '.overview', '.about',
            '[itemprop="description"]', '.product-details', '.details'
          ]),
          
          // Pricing information - comprehensive
          price: this.extractPrice($el),
          originalPrice: this.extractText($el, [
            '.original-price', '.was-price', '.regular-price', '.list-price',
            '.msrp', '.retail-price', '.before-price', '[data-original-price]'
          ]),
          salePrice: this.extractText($el, [
            '.sale-price', '.special-price', '.discounted-price', '.current-price',
            '.now-price', '.offer-price', '[data-sale-price]'
          ]),
          discount: this.extractText($el, [
            '.discount', '.savings', '.sale-badge', '.discount-percent',
            '.save-amount', '.discount-amount', '.off'
          ]),
          
          // Product attributes
          sku: this.extractText($el, [
            '.sku', '[data-sku]', '.product-code', '.item-code',
            '.model-number', '[itemprop="sku"]', '.part-number'
          ]),
          brand: this.extractText($el, [
            '.brand', '.manufacturer', '[data-brand]', '.brand-name',
            '.vendor', '[itemprop="brand"]', '.make'
          ]),
          model: this.extractText($el, [
            '.model', '.model-name', '.product-model', '[data-model]',
            '.model-number', '.variant'
          ]),
          
          // Availability and stock
          availability: this.extractText($el, [
            '.availability', '.stock', '.status', '.in-stock', '.out-of-stock',
            '.stock-status', '.inventory', '[itemprop="availability"]'
          ]),
          stockLevel: this.extractText($el, [
            '.stock-level', '.quantity-available', '.stock-count',
            '[data-stock]', '.inventory-count'
          ]),
          
          // Physical attributes
          weight: this.extractText($el, [
            '.weight', '.product-weight', '[data-weight]', '[itemprop="weight"]'
          ]),
          dimensions: this.extractText($el, [
            '.dimensions', '.size', '.measurements', '[data-dimensions]',
            '.product-size', '.width', '.height', '.depth'
          ]),
          color: this.extractText($el, [
            '.color', '.colour', '.product-color', '[data-color]',
            '[itemprop="color"]', '.shade'
          ]),
          size: this.extractText($el, [
            '.size', '.product-size', '[data-size]', '.sizing',
            '.dimension', '.capacity'
          ]),
          
          // Categories and classification
          category: this.extractText($el, [
            '.category', '.tag', '.type', '.product-category',
            '.breadcrumb', '.nav-category', '[itemprop="category"]'
          ]),
          tags: this.extractArray($el, [
            '.tag', '.label', '.badge', '.product-tag', '.category-tag',
            '.keyword', '.classification'
          ]),
          
          // Ratings and reviews
          rating: this.extractRating($el),
          reviewCount: this.extractText($el, [
            '.review-count', '.reviews', '.rating-count', '[data-review-count]',
            '.total-reviews', '.review-total'
          ]),
          
          // Media
          images: this.extractImages($el),
          mainImage: this.extractText($el, ['img'], 'src'),
          
          // Links and URLs
          url: this.extractText($el, ['a'], 'href'),
          
          // Additional structured data
          specifications: this.extractSpecifications($el),
          features: this.extractArray($el, [
            '.feature', '.benefit', '.highlight', '.key-feature',
            '.product-benefit', '.selling-point'
          ]),
          
          // Shipping and delivery
          shipping: this.extractText($el, [
            '.shipping', '.delivery', '.shipping-info', '.delivery-info',
            '.shipping-cost', '.delivery-cost'
          ]),
          
          // Warranty and support
          warranty: this.extractText($el, [
            '.warranty', '.guarantee', '.warranty-info', '.support',
            '.coverage', '.protection'
          ]),
          
          // Additional metadata
          position: i,
          extracted_at: new Date().toISOString(),
          source_html: $el.html()
        };
        
        // Only add if we have meaningful data
        if (product.name || product.description || product.price) {
          products.push(product);
          $el.attr('data-processed', 'true');
        }
      });
    });
  }

  /**
   * Extract comprehensive pricing information
   */
  static extractPricing($, pricing) {
    const pricingSelectors = [
      '.price', '.pricing', '.cost', '.fee', '.rate', '.amount', '.value',
      '.price-list', '.pricing-table', '.price-grid', '.cost-breakdown',
      '.fee-structure', '.rate-card', '.pricing-plan', '.subscription',
      '.membership', '.plan', '.tier', '.package', '.offer'
    ];

    pricingSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        if ($el.attr('data-processed')) return;
        
        const priceData = {
          type: this.determinePriceType($el),
          title: this.extractText($el, ['h1', 'h2', 'h3', '.title', '.name']),
          description: this.extractText($el, ['.description', '.summary', '.details']),
          
          // Primary pricing
          price: this.extractPrice($el),
          currency: this.extractCurrency($el),
          
          // Billing information
          billingPeriod: this.extractText($el, [
            '.period', '.billing', '.duration', '.frequency',
            '.recurring', '.interval', '.cycle'
          ]),
          
          // Discount information
          originalPrice: this.extractText($el, [
            '.original', '.was', '.regular', '.before', '.list-price'
          ]),
          discount: this.extractText($el, [
            '.discount', '.save', '.off', '.reduction', '.savings'
          ]),
          
          // Plan features
          features: this.extractArray($el, [
            '.feature', '.benefit', '.included', '.perk', 'li'
          ]),
          
          // Limitations
          limitations: this.extractArray($el, [
            '.limitation', '.restriction', '.excluded', '.not-included'
          ]),
          
          // Additional costs
          setupFee: this.extractText($el, [
            '.setup', '.setup-fee', '.installation', '.activation'
          ]),
          additionalFees: this.extractText($el, [
            '.additional', '.extra', '.addon', '.supplementary'
          ]),
          
          position: i,
          extracted_at: new Date().toISOString()
        };
        
        if (priceData.price || priceData.title) {
          pricing.push(priceData);
          $el.attr('data-processed', 'true');
        }
      });
    });
  }

  /**
   * Extract service information
   */
  static extractServices($, services) {
    const serviceSelectors = [
      '.service', '.service-item', '.service-card', '.offering',
      '.package', '.plan', '.tier', '.solution', '.program'
    ];

    serviceSelectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        
        if ($el.attr('data-processed')) return;
        
        const service = {
          name: this.extractText($el, ['h1', 'h2', 'h3', '.title', '.name']),
          description: this.extractText($el, ['.description', '.summary', '.overview']),
          price: this.extractPrice($el),
          duration: this.extractText($el, ['.duration', '.length', '.time']),
          features: this.extractArray($el, ['.feature', '.benefit', '.included']),
          category: this.extractText($el, ['.category', '.type', '.classification']),
          provider: this.extractText($el, ['.provider', '.vendor', '.company']),
          location: this.extractText($el, ['.location', '.address', '.venue']),
          rating: this.extractRating($el),
          reviews: this.extractText($el, ['.reviews', '.review-count']),
          position: i,
          extracted_at: new Date().toISOString()
        };
        
        if (service.name || service.description) {
          services.push(service);
          $el.attr('data-processed', 'true');
        }
      });
    });
  }

  // Helper methods for data extraction
  
  static extractText($el, selectors, attribute = null) {
    try {
      for (const selector of selectors) {
        const element = $el.find(selector).first();
        if (element.length) {
          if (attribute) {
            const value = element.attr(attribute);
            if (value) return value.trim();
          } else {
            const text = element.text().trim();
            if (text) return text;
          }
        }
      }
      return '';
    } catch (error) {
      return '';
    }
  }

  static extractArray($el, selectors) {
    try {
      const items = [];
      selectors.forEach(selector => {
        $el.find(selector).each((i, elem) => {
          const text = $el.constructor(elem).text().trim(); // Use $el.constructor instead of $
          if (text && !items.includes(text)) {
            items.push(text);
          }
        });
      });
      return items;
    } catch (error) {
      return [];
    }
  }

  static extractPrice($el) {
    try {
      const priceSelectors = [
        '.price', '.cost', '.amount', '[data-price]', '.product-price',
        '.price-current', '.price-now', '.sale-price', '.regular-price',
        '.cost-amount', '.price-value', '.fee', '.rate'
      ];
      
      for (const selector of priceSelectors) {
        const priceElement = $el.find(selector).first();
        if (priceElement.length) {
          const priceText = priceElement.text().trim();
          // Extract price with currency symbols and numbers
          const priceMatch = priceText.match(/[$£€¥₹₽¢]?[\d,]+\.?\d*/);
          if (priceMatch) {
            return priceMatch[0];
          }
        }
      }
      return '';
    } catch (error) {
      return '';
    }
  }

  static extractCurrency($el) {
    try {
      const text = $el.text();
      const currencyMap = {
        '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY',
        '₹': 'INR', '₽': 'RUB', '¢': 'USD'
      };
      
      for (const [symbol, code] of Object.entries(currencyMap)) {
        if (text.includes(symbol)) {
          return code;
        }
      }
      return '';
    } catch (error) {
      return '';
    }
  }

  static extractRating($el) {
    try {
      const ratingSelectors = [
        '.rating', '.stars', '[data-rating]', '.review-rating',
        '.star-rating', '.rating-value', '.score'
      ];
      
      for (const selector of ratingSelectors) {
        const ratingElement = $el.find(selector).first();
        if (ratingElement.length) {
          const ratingText = ratingElement.text().trim();
          const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
          if (ratingMatch) {
            return parseFloat(ratingMatch[1]);
          }
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  static extractImages($el) {
    try {
      const images = [];
      $el.find('img').each((i, img) => {
        const $img = $el.constructor(img); // Use $el.constructor instead of $
        const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy');
        if (src) {
          images.push({
            src,
            alt: $img.attr('alt') || '',
            title: $img.attr('title') || ''
          });
        }
      });
      return images;
    } catch (error) {
      return [];
    }
  }

  static extractSpecifications($el) {
    try {
      const specs = [];
      const specSelectors = [
        '.spec', '.specification', '.attribute', '.detail-item',
        '.product-feature', '.spec-item', '.characteristic'
      ];
      
      specSelectors.forEach(selector => {
        $el.find(selector).each((i, spec) => {
          const text = $el.constructor(spec).text().trim(); // Use $el.constructor instead of $
          if (text) {
            specs.push(text);
          }
        });
      });
      
      return specs;
    } catch (error) {
      return [];
    }
  }

  static determinePriceType($el) {
    try {
      const text = $el.text().toLowerCase();
      if (text.includes('monthly') || text.includes('month')) return 'monthly';
      if (text.includes('yearly') || text.includes('annual')) return 'yearly';
      if (text.includes('weekly') || text.includes('week')) return 'weekly';
      if (text.includes('daily') || text.includes('day')) return 'daily';
      if (text.includes('hourly') || text.includes('hour')) return 'hourly';
      if (text.includes('one-time') || text.includes('onetime')) return 'one-time';
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }
}

module.exports = DataExtractors;