const express = require('express');
const router = express.Router();
const bedrockCompliantStorage = require('../services/bedrockCompliantStorage');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   name: Bedrock Storage
 *   description: Datasource registry management for frontend components
 */

/**
 * @swagger
 * /api/bedrock-storage/datasources:
 *   get:
 *     summary: Get all datasource registries for frontend
 *     description: |
 *       Retrieves all datasource.json registry files from the S3 knowledge base.
 *       These registries provide frontend-friendly metadata for each datasource including exact display names.
 *       
 *       **Display Name Rules:**
 *       - **Websites**: Show exact scraped URL (e.g., "https://example.com")
 *       - **PDFs**: Show actual filename (e.g., "Manual_v2.pdf")
 *       - **Documents**: Show actual filename (e.g., "Report_2024.docx")
 *       - **Spreadsheets**: Show actual filename (e.g., "Data_Q1.xlsx")
 *     tags: [Bedrock Storage]
 *     responses:
 *       200:
 *         description: Successfully retrieved all datasource registries
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DatasourcesResponse'
 *             examples:
 *               mixed_datasources:
 *                 summary: Example with multiple datasource types
 *                 value:
 *                   success: true
 *                   message: "Datasources retrieved successfully"
 *                   data:
 *                     count: 4
 *                     datasources:
 *                       - id: "ansar-portfolio"
 *                         type: "web"
 *                         display_name: "https://ansar-portfolio.pages.dev"
 *                         source_url: "https://ansar-portfolio.pages.dev"
 *                         created_at: "2025-01-28T17:42:25.391Z"
 *                         s3_key: "datasources/ansar-portfolio/datasource.json"
 *                         type_folder: "datasources"
 *                       - id: "recipe-book"
 *                         type: "pdf"
 *                         display_name: "RecipeBook_Vegan_2023.pdf"
 *                         source_url: "https://bucket.s3.amazonaws.com/pdfs/recipe-book/RecipeBook_Vegan_2023.pdf"
 *                         created_at: "2025-01-28T18:15:30.123Z"
 *                         s3_key: "pdfs/recipe-book/datasource.json"
 *                         type_folder: "pdfs"
 *       500:
 *         description: Server error retrieving datasources
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/datasources', async (req, res) => {
  try {
    logger.info('Getting all datasources for frontend');

    const datasources = await bedrockCompliantStorage.getAllDatasources();

    res.json({
      success: true,
      message: 'Datasources retrieved successfully',
      data: {
        count: datasources.length,
        datasources
      }
    });

  } catch (error) {
    logger.error('Error getting datasources:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get datasources',
      message: error.message
    });
  }
});

module.exports = router;
