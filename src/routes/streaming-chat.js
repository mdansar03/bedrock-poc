const express = require('express');
const { body, validationResult } = require('express-validator');
const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const bedrockService = require('../services/bedrockService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * /api/streaming-chat/agent:
 *   post:
 *     summary: Stream chat with Bedrock Agent (Server-Sent Events)
 *     description: Stream real-time responses from AWS Bedrock Agent using Server-Sent Events. Returns immediate streaming response chunks as they're generated.
 *     tags: [Streaming Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "What are the system requirements for installation?"
 *                 description: "The user's question or message"
 *               sessionId:
 *                 type: string
 *                 example: "streaming-session-001"
 *                 description: "Optional session ID for conversation continuity"
 *               dataSources:
 *                 type: object
 *                 description: "Optional data source filtering"
 *                 properties:
 *                   websites:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["docs.example.com"]
 *                   pdfs:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["user-manual"]
 *                   documents:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["specs-doc"]
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Foundation model to use for inference"
 *               temperature:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.7
 *                 description: "Controls randomness in response generation"
 *               topP:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.9
 *                 description: "Controls nucleus sampling probability"
 *               systemPrompt:
 *                 type: string
 *                 maxLength: 4000
 *                 example: "You are a helpful AI assistant. Format responses with proper HTML markup for better readability."
 *                 description: "Custom system prompt for the agent"
 *               options:
 *                 type: object
 *                 properties:
 *                   useEnhancement:
 *                     type: boolean
 *                     example: true
 *                   sessionConfig:
 *                     type: object
 *     responses:
 *       200:
 *         description: Streaming response using Server-Sent Events
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 event: start
 *                 data: {"sessionId": "streaming-session-001", "timestamp": "2024-01-15T10:30:00Z"}
 *                 
 *                 event: chunk
 *                 data: {"content": "Based on the documentation, the system requirements"}
 *                 
 *                 event: chunk
 *                 data: {"content": " include at least 8GB of RAM and"}
 *                 
 *                 event: citation
 *                 data: {"source": {"title": "System Requirements", "url": "https://docs.example.com/requirements"}}
 *                 
 *                 event: end
 *                 data: {"complete": true, "totalTime": "3.2s", "tokensUsed": 150}
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/agent', [
  body('message')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters')
    .trim(),
  body('sessionId')
    .custom((value) => {
      // Allow null, undefined, or string values
      if (value === null || value === undefined || typeof value === 'string') {
        return true;
      }
      throw new Error('Session ID must be a string or null');
    }),
  body('dataSources')
    .optional()
    .isObject()
    .withMessage('Data sources must be an object'),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string'),
  body('temperature')
    .optional()
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('Temperature must be a number between 0.0 and 1.0'),
  body('topP')
    .optional()
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('Top P must be a number between 0.0 and 1.0'),
  body('systemPrompt')
    .optional()
    .isString()
    .isLength({ min: 1, max: 4000 })
    .withMessage('System prompt must be between 1 and 4000 characters')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      message,
      sessionId = null,
      dataSources = null,
      model = null,
      temperature = null,
      topP = null,
      systemPrompt = null,
      options = {}
    } = req.body;

    logger.info(`🚀 STARTING TRUE AWS AGENT STREAMING: ${message.substring(0, 100)}...`);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial event
    const sessionIdToUse = sessionId || `agent-streaming-${Date.now()}`;
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({
      sessionId: sessionIdToUse,
      timestamp: new Date().toISOString(),
      message: message,
      streamingType: 'true-aws-agent-streaming'
    })}\n\n`);

    const startTime = Date.now();

    try {
      // Direct AWS SDK approach (like working test)
      const client = new BedrockAgentRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      });

      const command = new InvokeAgentCommand({
        agentId: process.env.BEDROCK_AGENT_ID,
        agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
        sessionId: sessionIdToUse,
        inputText: message,
        enableTrace: true, // Keep simple
        // CRITICAL: Enable streaming (exactly like working test)
        streamingConfigurations: {
          streamFinalResponse: true
        }
      });

      logger.info("📡 INVOKING AWS AGENT DIRECTLY");
      const response = await client.send(command);

      console.log("🔄 Processing agent streaming chunks:");
      console.log("    Structure check:", {
        hasCompletion: !!response.completion,
        responseKeys: Object.keys(response || {}),
        isAsyncIterable: response.completion ? Symbol.asyncIterator in response.completion : false
      });
      console.log("🚀 ------------------------> RESPONSE:", response);


      console.log("🚀 ------------------------> RESPONSE.completion:", response.stream);
      
      let chunkCount = 0;
      let fullText = "";
      let textChunkCount = 0;
      
      if (response.completion) {
        for await (const chunk of response.completion) {
          chunkCount++;
          const elapsed = Date.now() - startTime;
          
          // console.log(`📦 CHUNK #${chunkCount} (at ${elapsed}ms):`, {
          //   chunkKeys: Object.keys(chunk || {}),
          //   hasChunk: !!chunk.chunk,
          //   hasTrace: !!chunk.trace,
          //   chunkType: typeof chunk
          // });
          
          // Process text chunks (exactly like working test)
          if (chunk.chunk && chunk.chunk.bytes) {
            try {
              const textChunk = new TextDecoder().decode(chunk.chunk.bytes);
              fullText += textChunk;
              textChunkCount++;
              
              // console.log(`✅ TEXT CHUNK: "${textChunk}" (length: ${textChunk.length}, total: ${fullText.length})`);
              
              // Send chunk immediately (like working test)
              // res.write(`event: chunk\n`);
              // res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
              
            } catch (e) {
              logger.warn("❌ Chunk decode error:", e.message);
              console.log(`⚠️ Chunk decode error: ${e.message}`);
            }
          }
          
          // Log trace chunks
          if (chunk.trace) {
            console.log(`🔍 TRACE CHUNK: Workflow step received`);
          }
          
          // Log other chunk types
          if (!chunk.chunk && !chunk.trace) {
            console.log(`❓ UNKNOWN CHUNK TYPE:`, Object.keys(chunk));
          }
        }
        
        // Send completion
        const totalTime = Date.now() - startTime;
        res.write(`event: end\n`);
        res.write(`data: ${JSON.stringify({
          complete: true,
          sessionId: sessionIdToUse,
          totalTime: `${totalTime}ms`,
          totalChunks: chunkCount,
          textChunks: textChunkCount,
          streamingType: 'direct-aws-agent-streaming'
        })}\n\n`);
        res.end();
        
        console.log("\n🎉 AGENT STREAMING COMPLETED:");
        console.log(`   Total chunks: ${chunkCount}`);
        console.log(`   Text chunks: ${textChunkCount}`);
        console.log(`   Total text length: ${fullText.length}`);
        console.log(`   Total time: ${totalTime}ms`);
        console.log(`   Avg time per chunk: ${chunkCount > 0 ? (totalTime/chunkCount).toFixed(1) : 0}ms`);
        
        if (textChunkCount > 10 && fullText.length > 100) {
          console.log("✅ SUCCESS: True character-by-character agent streaming confirmed!");
        } else if (textChunkCount <= 1 && fullText.length > 100) {
          console.log("❌ BULK RESPONSE: Agent returned complete text in single chunk (workflow streaming only)");
        } else {
          console.log("⚠️ MIXED: Some streaming but may not be true character-by-character");
        }
        
        logger.info(`🎉 DIRECT AGENT STREAMING COMPLETED: ${textChunkCount} text chunks, ${fullText.length} chars`);
        
      } else {
        throw new Error('No completion stream in response');
      }
      
    } catch (error) {
      logger.error('❌ AGENT STREAMING SETUP FAILED:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        error: `Agent streaming setup failed: ${error.message}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('❌ STREAMING INITIALIZATION FAILED:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize streaming',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/streaming-chat/direct:
 *   post:
 *     summary: Stream direct chat with foundation models (Server-Sent Events)
 *     description: Stream real-time responses directly from foundation models using Server-Sent Events, bypassing agents and knowledge base.
 *     tags: [Streaming Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "Explain quantum computing in simple terms"
 *                 description: "The user's message or prompt"
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Foundation model to use"
 *               temperature:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.7
 *               topP:
 *                 type: number
 *                 minimum: 0.0
 *                 maximum: 1.0
 *                 example: 0.9
 *               maxTokens:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 4000
 *                 example: 1000
 *                 description: "Maximum number of tokens to generate"
 *     responses:
 *       200:
 *         description: Streaming response using Server-Sent Events
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 event: start
 *                 data: {"model": "anthropic.claude-3-sonnet-20240229-v1:0", "timestamp": "2024-01-15T10:30:00Z"}
 *                 
 *                 event: chunk
 *                 data: {"content": "Quantum computing is a revolutionary"}
 *                 
 *                 event: chunk
 *                 data: {"content": " technology that uses quantum mechanical"}
 *                 
 *                 event: end
 *                 data: {"complete": true, "totalTime": "2.1s", "tokensUsed": 95}
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/direct', [
  body('message')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters')
    .trim(),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string'),
  body('temperature')
    .optional()
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('Temperature must be a number between 0.0 and 1.0'),
  body('topP')
    .optional()
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('Top P must be a number between 0.0 and 1.0'),
  body('maxTokens')
    .optional()
    .isInt({ min: 1, max: 4000 })
    .withMessage('Max tokens must be between 1 and 4000')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      message,
      model = null,
      temperature = null,
      topP = null,
      maxTokens = null
    } = req.body;

    logger.info(`Starting streaming direct query: ${message.substring(0, 100)}...`);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial event
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({
      model: model || bedrockService.defaultModelId,
      timestamp: new Date().toISOString(),
      message: message
    })}\n\n`);

    try {
      // Use TRUE AWS streaming for direct models
      logger.info("🚀 DIRECT MODE: Using TRUE AWS InvokeModelWithResponseStream API");
      
      const bedrockService = require('../services/bedrockService');
      
      // Use the TRUE streaming method
      const directStartTime = Date.now();
      let directChunkCount = 0;
      let directFullText = "";
      
      await bedrockService.invokeModelStreaming(
        message,
        model,
        {
          temperature,
          topP,
          maxTokens
        },
        {
          // Real-time chunk handler - called as AWS sends each chunk
          onChunk: (chunk) => {
            directChunkCount++;
            const elapsed = Date.now() - directStartTime;
            directFullText += chunk;
            
            console.log(`📦 DIRECT CHUNK #${directChunkCount} (at ${elapsed}ms):`, {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              totalLength: directFullText.length,
              timestamp: new Date().toISOString()
            });
            
            logger.info("🎯 DIRECT MODEL CHUNK:", {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              timestamp: new Date().toISOString()
            });
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          },
          
          // Completion handler
          onComplete: (finalData) => {
            const directTotalTime = Date.now() - directStartTime;
            
            console.log("\n🎉 DIRECT MODEL STREAMING COMPLETED:");
            console.log(`   Total chunks: ${directChunkCount}`);
            console.log(`   Total text length: ${directFullText.length}`);
            console.log(`   Total time: ${directTotalTime}ms`);
            console.log(`   Avg time per chunk: ${directChunkCount > 0 ? (directTotalTime/directChunkCount).toFixed(1) : 0}ms`);
            
            if (directChunkCount > 5 && directFullText.length > 50) {
              console.log("✅ SUCCESS: True character-by-character direct streaming confirmed!");
            } else if (directChunkCount <= 1 && directFullText.length > 50) {
              console.log("❌ BULK RESPONSE: Direct model returned complete text in single chunk");
            } else {
              console.log("⚠️ MIXED: Some streaming but may not be optimal chunk size");
            }
            
            res.write(`event: end\n`);
            res.write(`data: ${JSON.stringify({
              complete: true,
              model: finalData.model,
              totalTime: finalData.totalTime,
              tokensUsed: finalData.tokensUsed,
              streamingType: 'true-aws-streaming' // Indicate this was real streaming
            })}\n\n`);
            res.end();
          },
          
          // Error handler
          onError: (error) => {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
              error: error.message,
              timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
          }
        }
      );
    } catch (error) {
      logger.error('Streaming direct query error:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('Streaming setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize streaming',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/streaming-chat/knowledge-base:
 *   post:
 *     summary: Stream chat with knowledge base (Server-Sent Events)
 *     description: Stream real-time responses from knowledge base using Server-Sent Events with RAG (Retrieval Augmented Generation).
 *     tags: [Streaming Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "What products are available in the electronics category?"
 *                 description: "The user's question about knowledge base content"
 *               sessionId:
 *                 type: string
 *                 example: "kb-streaming-session-001"
 *                 description: "Optional session ID for conversation continuity"
 *               model:
 *                 type: string
 *                 example: "anthropic.claude-3-sonnet-20240229-v1:0"
 *                 description: "Foundation model to use"
 *               enhancementOptions:
 *                 type: object
 *                 properties:
 *                   responseType:
 *                     type: string
 *                     enum: [auto, general, technical, business]
 *                     example: "auto"
 *                   includeExamples:
 *                     type: boolean
 *                     example: true
 *                   temperature:
 *                     type: number
 *                     minimum: 0.0
 *                     maximum: 1.0
 *                     example: 0.7
 *     responses:
 *       200:
 *         description: Streaming response using Server-Sent Events
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 event: start
 *                 data: {"sessionId": "kb-streaming-session-001", "model": "claude-3-sonnet", "timestamp": "2024-01-15T10:30:00Z"}
 *                 
 *                 event: sources
 *                 data: {"sources": [{"title": "Electronics Catalog", "url": "https://example.com/catalog", "relevanceScore": 0.95}]}
 *                 
 *                 event: chunk
 *                 data: {"content": "Based on the electronics catalog, we have"}
 *                 
 *                 event: chunk
 *                 data: {"content": " the following products available:"}
 *                 
 *                 event: end
 *                 data: {"complete": true, "totalTime": "2.8s", "tokensUsed": 120, "sourceCount": 3}
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/knowledge-base', [
  body('message')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters')
    .trim(),
  body('sessionId')
    .custom((value) => {
      // Allow null, undefined, or string values
      if (value === null || value === undefined || typeof value === 'string') {
        return true;
      }
      throw new Error('Session ID must be a string or null');
    }),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string'),
  body('enhancementOptions')
    .optional()
    .isObject()
    .withMessage('Enhancement options must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      message,
      sessionId = null,
      model = null,
      enhancementOptions = {}
    } = req.body;

    logger.info(`Starting streaming knowledge base query: ${message.substring(0, 100)}...`);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial event
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({
      sessionId: sessionId || `kb-streaming-${Date.now()}`,
      model: model || bedrockService.defaultModelId,
      timestamp: new Date().toISOString(),
      message: message
    })}\n\n`);

    try {
      // Use TRUE AWS streaming for knowledge base
      logger.info("🚀 KNOWLEDGE BASE MODE: Using TRUE AWS RetrieveAndGenerateStream API");
      
      const bedrockService = require('../services/bedrockService');
      
      // Use the TRUE streaming method
      const kbStartTime = Date.now();
      let kbChunkCount = 0;
      let kbFullText = "";
      let kbSourceCount = 0;
      
      await bedrockService.queryKnowledgeBaseStreaming(
        message,
        sessionId,
        model,
        enhancementOptions,
        {
          // Real-time sources handler
          onSources: (sources) => {
            kbSourceCount = sources.length;
            console.log(`📄 KB SOURCES RECEIVED (${sources.length} sources):`, sources.map(s => ({
              title: s.title?.substring(0, 30) || 'Unknown',
              relevanceScore: s.relevanceScore
            })));
            logger.info("📄 KB SOURCES RECEIVED:", { count: sources.length });
            res.write(`event: sources\n`);
            res.write(`data: ${JSON.stringify({ sources })}\n\n`);
          },
          
          // Real-time chunk handler - called as AWS sends each chunk
          onChunk: (chunk) => {
            kbChunkCount++;
            const elapsed = Date.now() - kbStartTime;
            kbFullText += chunk;
            
            // console.log(`📦 KB CHUNK #${kbChunkCount} (at ${elapsed}ms):`, {
            //   length: chunk.length,
            //   preview: chunk.substring(0, 30) + "...",
            //   totalLength: kbFullText.length,
            //   timestamp: new Date().toISOString()
            // });
            
            logger.info("🎯 KB CHUNK:", {
              length: chunk.length,
              preview: chunk.substring(0, 30) + "...",
              timestamp: new Date().toISOString()
            });
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          },
          
          // Completion handler
          onComplete: (finalData) => {
            const kbTotalTime = Date.now() - kbStartTime;
            
            console.log("\n🎉 KNOWLEDGE BASE STREAMING COMPLETED:");
            console.log(`   Total chunks: ${kbChunkCount}`);
            console.log(`   Total text length: ${kbFullText.length}`);
            console.log(`   Sources used: ${kbSourceCount}`);
            console.log(`   Total time: ${kbTotalTime}ms`);
            console.log(`   Avg time per chunk: ${kbChunkCount > 0 ? (kbTotalTime/kbChunkCount).toFixed(1) : 0}ms`);
            
            if (kbChunkCount > 5 && kbFullText.length > 50) {
              console.log("✅ SUCCESS: True character-by-character KB streaming confirmed!");
            } else if (kbChunkCount <= 1 && kbFullText.length > 50) {
              console.log("❌ BULK RESPONSE: KB returned complete text in single chunk");
            } else {
              console.log("⚠️ MIXED: Some streaming but may not be optimal chunk size");
            }
            
            res.write(`event: end\n`);
            res.write(`data: ${JSON.stringify({
              complete: true,
              sessionId: finalData.sessionId,
              model: finalData.model,
              totalTime: finalData.totalTime,
              tokensUsed: finalData.tokensUsed,
              sourceCount: finalData.sourceCount,
              streamingType: 'true-aws-kb-streaming' // Indicate this was real streaming
            })}\n\n`);
            res.end();
          },
          
          // Error handler
          onError: (error) => {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
              error: error.message,
              timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
          }
        }
      );
    } catch (error) {
      logger.error('Streaming knowledge base query error:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('Streaming setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize streaming',
      message: error.message
    });
  }
});

module.exports = router;
