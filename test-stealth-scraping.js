/**
 * 🧪 TEST STEALTH SCRAPING
 * 
 * Quick test script to verify the new anti-detection scraping works
 */

require('dotenv').config();
const ScrapingService = require('./src/services/scrapingService');

async function testStealthScraping() {
  const scrapingService = new ScrapingService();
  
  console.log('🧪 Testing Enhanced Scraping Service...\n');
  
  // Test URLs (replace with your problem URLs)
  const testUrls = [
    'https://www.pamperedchef.com/', // This was giving "Request Not Permitted"
    'https://httpbin.org/headers'     // This will show our headers
  ];
  
  for (const url of testUrls) {
    try {
      console.log(`🔍 Testing: ${url}`);
      console.log('⏳ Scraping...');
      
      const result = await scrapingService.scrapeSinglePage(url, {
        forceStealthMode: false // Let it auto-detect and fallback if needed
      });
      
      console.log(`✅ Success!`);
      console.log(`📊 Method: ${result.metadata.scrapingMethod}`);
      console.log(`📄 Title: ${result.title}`);
      console.log(`📝 Content Length: ${result.content.fullText.length} chars`);
      console.log(`🧩 Chunks: ${result.content.chunks.length}`);
      console.log(`📈 Word Count: ${result.content.wordCount}`);
      
      // Show first 200 chars of content to verify it's not blocked
      const preview = result.content.fullText.substring(0, 200).replace(/\s+/g, ' ');
      console.log(`👀 Content Preview: "${preview}..."`);
      
      console.log('─'.repeat(60));
      
    } catch (error) {
      console.error(`❌ Error testing ${url}:`, error.message);
      console.log('─'.repeat(60));
    }
  }
  
  // Get session stats
  const stats = scrapingService.stealthService.getSessionStats();
  console.log('\n📊 Stealth Session Stats:');
  console.log(`🔢 Requests: ${stats.requestCount}`);
  console.log(`⏱️ Duration: ${Math.round(stats.sessionDuration/1000)}s`);
  console.log(`⏳ Avg Delay: ${Math.round(stats.averageDelay)}ms`);
  
  // Cleanup
  await scrapingService.closeBrowser();
  console.log('\n🧹 Cleanup completed');
  console.log('🎉 Test finished!');
}

// Run the test
testStealthScraping().catch(console.error);