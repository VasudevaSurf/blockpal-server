const express = require("express");
const http = require("http");
const WebSocket = require("ws");
require("dotenv").config();

// Import middleware
const corsMiddleware = require("./middleware/cors");
const errorHandler = require("./middleware/errorHandler");
const { logger } = require("./utils/logger");

// Import services
const walletConnectService = require("./services/wallet-connect");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Basic middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Security middleware
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");

app.use(helmet());
app.use(compression());
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// CORS middleware - MUST BE BEFORE ROUTES
app.use(corsMiddleware);

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.path} - Origin: ${req.get("origin")}`);
  console.log(`🔧 Headers:`, {
    origin: req.get("origin"),
    "content-type": req.get("content-type"),
    "user-agent": req.get("user-agent")?.substring(0, 50) + "...",
  });
  next();
});

// Rate limiting
const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check endpoint
app.get("/health", (req, res) => {
  console.log("🏥 Health check requested");
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      "wallet-connect": "running",
    },
  });
});

// Service routes
app.use(
  "/api/wallet",
  (req, res, next) => {
    console.log(`🔌 Wallet API Request: ${req.method} ${req.path}`);
    next();
  },
  walletConnectService
);

// WebSocket handling for real-time updates
wss.on("connection", (ws, req) => {
  const clientId = require("uuid").v4();
  logger.info(`New WebSocket connection: ${clientId}`);

  ws.clientId = clientId;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      logger.info(`Message from ${clientId}:`, data);

      // Handle different message types
      switch (data.type) {
        case "wallet_connect":
          // Handle wallet connection events
          break;
        case "chain_switch":
          // Handle chain switching events
          break;
        default:
          ws.send(JSON.stringify({ error: "Unknown message type" }));
      }
    } catch (error) {
      logger.error("WebSocket message error:", error);
      ws.send(JSON.stringify({ error: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    logger.info(`WebSocket connection closed: ${clientId}`);
  });

  ws.on("error", (error) => {
    logger.error(`WebSocket error for ${clientId}:`, error);
  });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "connection",
      message: "Connected to Blockpal Services",
      clientId,
    })
  );
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use("*", (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

const PORT = process.env.PORT || 5002;

server.listen(PORT, () => {
  logger.info(`🚀 Blockpal Services running on port ${PORT}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  logger.info(`🔌 WebSocket server running on ws://localhost:${PORT}`);
  logger.info(`📡 Wallet Connect API: http://localhost:${PORT}/api/wallet`);

  // Log CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:3000",
  ];
  logger.info(`🔒 CORS allowed origins: ${allowedOrigins.join(", ")}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    logger.info("Process terminated");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  server.close(() => {
    logger.info("Process terminated");
    process.exit(0);
  });
});

module.exports = app;
