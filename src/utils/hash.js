const crypto = require('crypto');

/**
 * Generate SHA256 hash for content
 * @param {string} content - The content to hash
 * @returns {string} - The SHA256 hash
 */
function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compare two hashes
 * @param {string} hash1 - First hash
 * @param {string} hash2 - Second hash
 * @returns {boolean} - True if hashes are equal
 */
function compareHashes(hash1, hash2) {
  return hash1 === hash2;
}

/**
 * Generate unique chunk ID
 * @param {string} url - Source URL
 * @param {number} chunkIndex - Index of the chunk
 * @param {string} timestamp - Timestamp string
 * @returns {string} - Unique chunk ID
 */
function generateChunkId(url, chunkIndex, timestamp) {
  const content = `${url}-${chunkIndex}-${timestamp}`;
  return generateHash(content).substring(0, 12);
}

module.exports = {
  generateHash,
  compareHashes,
  generateChunkId
};