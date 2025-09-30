{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import express from 'express';\
import cors from 'cors';\
import dotenv from 'dotenv';\
import \{ ScanService \} from './services/scanService';\
\
dotenv.config();\
\
const app = express();\
const PORT = process.env.PORT || 3001;\
\
app.use(cors());\
app.use(express.json());\
\
const scanService = new ScanService();\
\
// Initialize the scan service\
scanService.initialize().catch(console.error);\
\
// Health check endpoint\
app.get('/health', (req, res) => \{\
  res.json(\{ status: 'ok', timestamp: new Date().toISOString() \});\
\});\
\
// Main scan endpoint\
app.post('/api/scan', async (req, res) => \{\
  try \{\
    const \{ url, scanId, userId, projectId, clientId \} = req.body;\
\
    // Validation\
    if (!url || !scanId || !userId) \{\
      return res.status(400).json(\{\
        success: false,\
        error: 'Missing required fields: url, scanId, userId'\
      \});\
    \}\
\
    // Validate URL\
    try \{\
      new URL(url);\
    \} catch \{\
      return res.status(400).json(\{\
        success: false,\
        error: 'Invalid URL format'\
      \});\
    \}\
\
    // Start scan asynchronously (don't wait for completion)\
    scanService.performScan(\{\
      url,\
      scanId,\
      userId,\
      projectId,\
      clientId\
    \}).catch(error => \{\
      console.error('Scan error:', error);\
    \});\
\
    // Return immediately with scan ID\
    res.json(\{\
      success: true,\
      scanId,\
      message: 'Scan started successfully'\
    \});\
\
  \} catch (error) \{\
    console.error('API Error:', error);\
    res.status(500).json(\{\
      success: false,\
      error: error instanceof Error ? error.message : 'Internal server error'\
    \});\
  \}\
\});\
\
// Graceful shutdown\
process.on('SIGTERM', async () => \{\
  console.log('SIGTERM received, closing browser...');\
  await scanService.close();\
  process.exit(0);\
\});\
\
app.listen(PORT, () => \{\
  console.log(`QA Scan Service running on port $\{PORT\}`);\
  console.log(`Environment: $\{process.env.NODE_ENV\}`);\
\});}