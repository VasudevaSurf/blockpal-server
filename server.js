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
const moralisService = require("./services/moralis");

// Import routes
const tokenRoutes = require("./routes/tokens");
const debugRoutes = require("./routes/debug");
const coinGeckoRoutes = require("./routes/coingecko"); // Add CoinGecko routes

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
app.get("/health", async (req, res) => {
  console.log("🏥 Health check requested");

  try {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        "wallet-connect": "running",
        moralis: moralisService.initialized ? "connected" : "initializing",
        cache: "active",
        coingecko: "running",
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      apiKeys: {
        moralis: process.env.MORALIS_API_KEY ? "configured" : "missing",
        coingecko: process.env.COINGECKO_API_KEY
          ? "configured"
          : "using default",
      },
    };

    res.json(health);
  } catch (error) {
    logger.error("Health check error", error);
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
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

// Token routes
app.use(
  "/api/tokens",
  (req, res, next) => {
    console.log(`🪙 Token API Request: ${req.method} ${req.path}`);
    next();
  },
  tokenRoutes
);

// CoinGecko routes
app.use(
  "/api/coingecko",
  (req, res, next) => {
    console.log(`🦎 CoinGecko API Request: ${req.method} ${req.path}`);
    next();
  },
  coinGeckoRoutes
);

// Debug routes (only in development)
if (process.env.NODE_ENV === "development") {
  app.use(
    "/api/debug",
    (req, res, next) => {
      console.log(`🐛 Debug API Request: ${req.method} ${req.path}`);
      next();
    },
    debugRoutes
  );
  console.log("🐛 Debug routes enabled in development mode");
}

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
          ws.send(
            JSON.stringify({
              type: "wallet_connected",
              message: "Wallet connection acknowledged",
            })
          );
          break;

        case "chain_switch":
          // Handle chain switching events
          ws.send(
            JSON.stringify({
              type: "chain_switched",
              message: "Chain switch acknowledged",
              chainId: data.chainId,
            })
          );
          break;

        case "token_refresh":
          // Handle token refresh requests
          ws.send(
            JSON.stringify({
              type: "token_refresh_started",
              message: "Token refresh initiated",
              wallet: data.wallet,
              chain: data.chain,
            })
          );
          break;

        case "coingecko_refresh":
          // Handle CoinGecko refresh requests
          ws.send(
            JSON.stringify({
              type: "coingecko_refresh_started",
              message: "CoinGecko data refresh initiated",
            })
          );
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
      services: ["wallet-connect", "tokens", "moralis", "coingecko"],
    })
  );
});

// Initialize services
async function initializeServices() {
  try {
    logger.info("🔄 Initializing services...");

    // Log environment info
    logger.info("Environment:", {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MORALIS_API_KEY:
        process.env.MORALIS_API_KEY ||
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjcxN2EyZTI3LWM1YjItNDRlMC05MGE3LWRjNGFiMGEzOTliYyIsIm9yZ0lkIjoiNDY4MzYzIiwidXNlcklkIjoiNDgxODIwIiwidHlwZUlkIjoiNTcwMjhhMzQtMzc0OC00NWRlLTg4NTktNjlmNzU5ODEzNTM2IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NTY2MjE2NjAsImV4cCI6NDkxMjM4MTY2MH0.H2IkylE8uOgFiZodaezRSpN9nYE-D0GnF0SoMbbXCFQ"
          ? "configured"
          : "missing",
      COINGECKO_API_KEY: process.env.COINGECKO_API_KEY
        ? "configured"
        : "using default",
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    });

    // Initialize Moralis service
    logger.info("🔄 Starting Moralis initialization...");
    await moralisService.initialize();
    logger.info("✅ Moralis service initialized");

    // CoinGecko service doesn't need initialization - it's ready to use
    logger.info("✅ CoinGecko service ready");

    logger.info("🎉 All services initialized successfully");
  } catch (error) {
    logger.error("❌ Failed to initialize services", {
      message: error.message,
      stack: error.stack,
    });

    // Don't exit the process, but log the error
    // Some services might still work without all dependencies
    logger.warn("⚠️ Continuing with partial service initialization");
  }
}

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
    availableEndpoints: {
      health: "GET /health",
      wallet: "POST /api/wallet/*",
      tokens: "GET /api/tokens/*",
      coingecko: "GET /api/coingecko/*",
      ...(process.env.NODE_ENV === "development" && {
        debug: "GET /api/debug/*",
      }),
    },
  });
});

const PORT = process.env.PORT || 5002;

server.listen(PORT, async () => {
  logger.info(`🚀 Blockpal Services running on port ${PORT}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  logger.info(`🔌 WebSocket server running on ws://localhost:${PORT}`);
  logger.info(`📡 Wallet Connect API: http://localhost:${PORT}/api/wallet`);
  logger.info(`🪙 Token API: http://localhost:${PORT}/api/tokens`);
  logger.info(`🦎 CoinGecko API: http://localhost:${PORT}/api/coingecko`);

  if (process.env.NODE_ENV === "development") {
    logger.info(`🐛 Debug API: http://localhost:${PORT}/api/debug`);
    logger.info(
      `🧪 Test Moralis: http://localhost:${PORT}/api/debug/test-moralis`
    );
    logger.info(
      `🦎 Test CoinGecko: http://localhost:${PORT}/api/coingecko/trending`
    );
  }

  // Log CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:3000",
  ];
  logger.info(`🔒 CORS allowed origins: ${allowedOrigins.join(", ")}`);

  // Initialize services after server starts
  await initializeServices();
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

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit on unhandled rejections in production
  if (process.env.NODE_ENV === "development") {
    process.exit(1);
  }
});

module.exports = app;
