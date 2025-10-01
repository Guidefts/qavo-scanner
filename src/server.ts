import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ScanOrchestrator } from './services/scanOrchestrator';

// --- START OF DEBUG LOGS ---
// This helps us verify that environment variables are loaded correctly.
console.log("--- STARTING SERVER ---");
console.log("SUPABASE_URL from env:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY from env:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "Exists" : "MISSING or EMPTY");
// --- END OF DEBUG LOGS ---

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080; // Railway provides the PORT env var

app.use(cors());
app.use(express.json());

const scanOrchestrator = new ScanOrchestrator();

// Initialize browser pool on startup
scanOrchestrator.initialize().catch(error => {
    console.error("Failed to initialize browser on startup:", error);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Qavo QA Scanner'
  });
});

// Main scan endpoint
app.post('/api/scan', async (req, res) => {
  try {
    const { url, scanId, userId, projectId, clientId, settings } = req.body;

    if (!url || !scanId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: url, scanId, userId'
      });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Start scan asynchronously (don't wait for it to finish)
    scanOrchestrator.performCompleteScan({
      url,
      scanId,
      userId,
      projectId,
      clientId,
      settings: settings || {}
    }).catch(error => {
      console.error(`--- Unhandled error during scan ${scanId}:`, error);
    });

    // Respond immediately to the client
    res.status(202).json({
      success: true,
      scanId,
      message: 'Comprehensive QA scan accepted and started'
    });

  } catch (error) {
    console.error('--- API Error in /api/scan endpoint:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await scanOrchestrator.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Qavo QA Scan Service running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check available at /health`);
});
