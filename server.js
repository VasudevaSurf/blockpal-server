// server.js - Complete updated version with CoinLes integration
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const axios = require("axios");
require("dotenv").config();

// Import middleware
const corsMiddleware = require("./middleware/cors");
const errorHandler = require("./middleware/errorHandler");
const { logger } = require("./utils/logger");

// Import services
const walletConnectService = require("./services/wallet-connect");
const moralisService = require("./services/moralis");
const swapHistoryRoutes = require("./routes/swapHistory");

const newsScheduler = require("./services/newsScheduler");
const newsRoutes = require("./routes/news");

const mongoose = require("mongoose");

// Connect to MongoDB with BlockPal database
async function connectMongoDB() {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      "mongodb+srv://greeshmanthedupalli:0hAZ1wIBNxjGkL1v@blockpal-cluster.uldmzku.mongodb.net/BlockPal?retryWrites=true&w=majority&appName=blockpal-cluster";

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      dbName: "BlockPal",
    });

    const dbName = mongoose.connection.db.databaseName;
    logger.info(`MongoDB connected successfully to database: ${dbName}`);

    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    logger.info(
      `Available collections in ${dbName}:`,
      collections.map((c) => c.name)
    );

    const swapTransactionExists = collections.some(
      (c) => c.name === "swapTransactions"
    );
    if (!swapTransactionExists) {
      logger.info("Creating swapTransactions collection...");
      await mongoose.connection.db.createCollection("swapTransactions");

      const swapTransactions =
        mongoose.connection.db.collection("swapTransactions");
      await swapTransactions.createIndex({ walletAddress: 1, createdAt: -1 });
      await swapTransactions.createIndex({ status: 1, createdAt: -1 });
      await swapTransactions.createIndex({
        chainId: 1,
        walletAddress: 1,
        createdAt: -1,
      });
      await swapTransactions.createIndex({ txHash: 1 }, { sparse: true });

      logger.info("swapTransactions collection created with indexes");
    } else {
      logger.info("swapTransactions collection already exists");
    }

    // Ensure userWatchlists collection exists
    const userWatchlistExists = collections.some(
      (c) => c.name === "userWatchlists"
    );
    if (!userWatchlistExists) {
      logger.info("Creating userWatchlists collection...");
      await mongoose.connection.db.createCollection("userWatchlists");
      logger.info("userWatchlists collection created");
    }
  } catch (error) {
    logger.error("MongoDB connection failed:", error);
    logger.warn("Server will continue without database functionality");
  }
}

// Import routes
const tokenRoutes = require("./routes/tokens");
const debugRoutes = require("./routes/debug");
const coinGeckoRoutes = require("./routes/coingecko");
const coinlesRoutes = require("./routes/coinles");
const userWatchlistRoutes = require("./routes/user-watchlist");

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

// CRITICAL: Apply CORS middleware BEFORE all routes
app.use(corsMiddleware);

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - Origin: ${req.get("origin")}`);
  next();
});

// Rate limiting
const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 1inch API configuration for swap routes
const ONEINCH_API_KEY =
  process.env.ONEINCH_API_KEY || "7TD80y4Tuv1jeN0QuUbzUw2NT2N9qTwb";
const ONEINCH_BASE_URL = "https://api.1inch.dev/swap/v6.1";

// Supported chains for swap
const SUPPORTED_CHAINS = {
  1: "Ethereum",
  137: "Polygon",
  56: "BSC",
  43114: "Avalanche",
  8453: "Base",
  42161: "Arbitrum",
};

// Health check endpoint
app.get("/health", async (req, res) => {
  console.log("Health check requested");

  try {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        "wallet-connect": "running",
        moralis: moralisService.initialized ? "connected" : "initializing",
        mongodb:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        "mongodb-database":
          mongoose.connection.readyState === 1
            ? mongoose.connection.db.databaseName
            : "N/A",
        cache: "active",
        coingecko: "running",
        swap: "running",
        "swap-history":
          mongoose.connection.readyState === 1 ? "running" : "offline",
        coinles: "running",
        "user-watchlist":
          mongoose.connection.readyState === 1 ? "running" : "offline",

        "crypto-news": "running",
        "news-scheduler": newsScheduler.isRunning ? "running" : "stopped",
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      apiKeys: {
        moralis: process.env.MORALIS_API_KEY ? "configured" : "missing",
        coingecko: process.env.COINGECKO_API_KEY
          ? "configured"
          : "using default",
        oneinch: ONEINCH_API_KEY ? "configured" : "missing",
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

// Mount swap-history routes
app.use(
  "/api/swap-history",
  (req, res, next) => {
    console.log(`Swap History API Request: ${req.method} ${req.path}`);
    next();
  },
  swapHistoryRoutes
);

app.use(
  "/api/news",
  (req, res, next) => {
    console.log(`News API Request: ${req.method} ${req.path}`);
    next();
  },
  newsRoutes
);

// Service routes
app.use(
  "/api/wallet",
  (req, res, next) => {
    console.log(`Wallet API Request: ${req.method} ${req.path}`);
    next();
  },
  walletConnectService
);

// Token routes
app.use(
  "/api/tokens",
  (req, res, next) => {
    console.log(`Token API Request: ${req.method} ${req.path}`);
    next();
  },
  tokenRoutes
);

// CoinGecko routes
app.use(
  "/api/coingecko",
  (req, res, next) => {
    console.log(`CoinGecko API Request: ${req.method} ${req.path}`);
    next();
  },
  coinGeckoRoutes
);

// Mount CoinLes routes (add this BEFORE your 404 handler)
app.use(
  "/api/coinles",
  (req, res, next) => {
    console.log(`CoinLes API Request: ${req.method} ${req.path}`);
    next();
  },
  coinlesRoutes
);

app.use(
  "/api/user-watchlist",
  (req, res, next) => {
    console.log(`Watchlist API Request: ${req.method} ${req.path}`);
    next();
  },
  userWatchlistRoutes
);

// ============= SWAP ROUTES =============
const swapRouter = express.Router();

// Get gas prices from 1inch
swapRouter.get("/gas/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    console.log(`Fetching gas prices for chain ${chainId}`);

    const response = await axios.get(
      `https://api.1inch.dev/gas-price/v1.6/${chainId}`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        timeout: 5000,
      }
    );

    if (response.data) {
      const gasData = {
        low: parseFloat(response.data.low.maxFeePerGas) / 1e9,
        medium: parseFloat(response.data.medium.maxFeePerGas) / 1e9,
        high: parseFloat(response.data.high.maxFeePerGas) / 1e9,
        instant: parseFloat(response.data.instant.maxFeePerGas) / 1e9,
      };

      console.log(`Gas prices for chain ${chainId} (in Gwei):`, gasData);
      res.json({ success: true, data: gasData });
    } else {
      throw new Error("No data from 1inch gas API");
    }
  } catch (error) {
    console.error("Error fetching gas prices:", error.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch gas prices" });
  }
});

// Get native token price for gas USD calculation
swapRouter.get("/price/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    const nativeTokens = {
      1: "ethereum",
      137: "matic-network",
      56: "binancecoin",
      43114: "avalanche-2",
      8453: "ethereum",
      42161: "ethereum",
    };

    const tokenId = nativeTokens[chainId] || "ethereum";

    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`
      );

      const price = response.data[tokenId]?.usd || 0;
      console.log(`Native token price for chain ${chainId}: $${price}`);
      res.json({ success: true, data: { price, symbol: tokenId } });
    } catch (err) {
      const fallbackPrices = {
        1: 3500,
        137: 0.8,
        56: 250,
        43114: 35,
        8453: 3500,
        42161: 3500,
      };

      res.json({
        success: true,
        data: {
          price: fallbackPrices[chainId] || 100,
          symbol: tokenId,
        },
      });
    }
  } catch (error) {
    console.error("Error fetching token price:", error);
    res.json({ success: true, data: { price: 100, symbol: "unknown" } });
  }
});

// Get tokens for a specific chain
swapRouter.get("/tokens/:chainId", async (req, res) => {
  const { chainId } = req.params;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      supportedChains: Object.keys(SUPPORTED_CHAINS),
    });
  }

  try {
    console.log(`Fetching tokens for chain ${chainId}`);

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const tokens = response.data?.tokens || {};
    res.json({
      success: true,
      data: {
        tokens: tokens,
        count: Object.keys(tokens).length,
      },
    });
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    res.json({
      success: false,
      error: "Failed to fetch tokens",
      data: { tokens: {}, count: 0 },
    });
  }
});

// Search tokens
swapRouter.get("/search/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { query } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      data: [],
    });
  }

  try {
    console.log(`Searching tokens for "${query}" on chain ${chainId}`);

    if (!query) {
      const response = await axios.get(
        `${ONEINCH_BASE_URL}/${chainId}/tokens`,
        {
          headers: {
            Authorization: `Bearer ${ONEINCH_API_KEY}`,
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );

      const tokens = Object.values(response.data?.tokens || {});
      const popularSymbols = [
        "ETH",
        "WETH",
        "USDT",
        "USDC",
        "DAI",
        "WBTC",
        "UNI",
        "LINK",
        "AAVE",
        "MATIC",
        "BNB",
      ];

      const popularTokens = tokens
        .filter((token) => popularSymbols.includes(token.symbol?.toUpperCase()))
        .sort((a, b) => {
          const aIndex = popularSymbols.indexOf(a.symbol?.toUpperCase());
          const bIndex = popularSymbols.indexOf(b.symbol?.toUpperCase());
          return aIndex - bIndex;
        })
        .slice(0, 20);

      return res.json({ success: true, data: popularTokens });
    }

    try {
      const searchResponse = await axios.get(
        `https://api.1inch.dev/token/v1.2/${chainId}/search`,
        {
          headers: {
            Authorization: `Bearer ${ONEINCH_API_KEY}`,
            Accept: "application/json",
          },
          params: {
            query: query,
            limit: 50,
          },
          timeout: 5000,
        }
      );

      if (searchResponse.data && Array.isArray(searchResponse.data)) {
        console.log(`Found ${searchResponse.data.length} tokens via search`);
        return res.json({ success: true, data: searchResponse.data });
      }
    } catch (searchError) {
      console.log("Search API failed, using fallback filter");
    }

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const tokens = Object.values(response.data?.tokens || {});
    const searchLower = query.toLowerCase();

    const filtered = tokens
      .filter((token) => {
        const symbolMatch = token.symbol?.toLowerCase().includes(searchLower);
        const nameMatch = token.name?.toLowerCase().includes(searchLower);
        const addressMatch = token.address?.toLowerCase() === searchLower;

        return symbolMatch || nameMatch || addressMatch;
      })
      .slice(0, 50);

    res.json({ success: true, data: filtered });
  } catch (error) {
    console.error("Error searching tokens:", error.message);
    res.json({ success: false, data: [] });
  }
});

// Get quote with gas calculation
swapRouter.get("/quote/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { src, dst, amount, from, slippage = 1, gasMode = "high" } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      data: { dstAmount: "0" },
    });
  }

  if (!src || !dst || !amount || !from) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters",
      data: { dstAmount: "0" },
    });
  }

  if (isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid amount",
      message: "Amount must be a positive number",
      data: { dstAmount: "0" },
    });
  }

  try {
    console.log(
      `Getting quote: ${amount} of ${src} to ${dst} on chain ${chainId}`
    );

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/quote`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      params: {
        src,
        dst,
        amount,
        from,
        slippage: parseFloat(slippage),
        includeProtocols: true,
        includeGas: true,
        allowPartialFill: false,
        disableEstimate: false,
        includeTokensInfo: true,
        compatibilityMode: false,
      },
      timeout: 15000,
    });

    const quoteData = response.data;

    if (!quoteData || !quoteData.dstAmount) {
      throw new Error("Invalid quote response from 1inch");
    }

    console.log(`Quote successful: ${quoteData.dstAmount} output tokens`);

    res.json({ success: true, data: quoteData });
  } catch (error) {
    console.error("Quote error:", error.response?.data || error.message);

    if (error.response?.data) {
      return res.json({
        success: false,
        error: "Quote failed",
        message:
          error.response.data.description ||
          error.response.data.error ||
          "Unable to get quote",
        data: { dstAmount: "0" },
        details: error.response.data,
      });
    }

    res.json({
      success: false,
      error: "Failed to get quote",
      message: error.message || "Unknown error",
      data: { dstAmount: "0" },
    });
  }
});

// Get swap transaction
swapRouter.get("/swap/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const {
    src,
    dst,
    amount,
    from,
    slippage = 1,
    gasMode = "high",
    receiver,
    referrer,
  } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      data: { tx: null },
    });
  }

  if (!src || !dst || !amount || !from) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters",
      data: { tx: null },
    });
  }

  if (isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid amount",
      message: "Amount must be a positive number",
      data: { tx: null },
    });
  }

  try {
    console.log(
      `Getting swap tx: ${amount} of ${src} to ${dst} on chain ${chainId}`
    );

    const params = {
      src,
      dst,
      amount,
      from,
      slippage: parseFloat(slippage),
      origin: from,
      includeTokensInfo: true,
      allowPartialFill: false,
      disableEstimate: false,
    };

    if (receiver) params.receiver = receiver;
    if (referrer) params.referrer = referrer;

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/swap`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      params,
      timeout: 15000,
    });

    if (!response.data || !response.data.tx) {
      throw new Error("Invalid swap response from 1inch");
    }

    console.log(`Swap tx generated successfully`);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Swap error:", error.response?.data || error.message);

    if (error.response?.data) {
      return res.json({
        success: false,
        error: "Swap failed",
        message:
          error.response.data.description ||
          error.response.data.error ||
          "Unable to create swap",
        details: error.response.data,
        data: { tx: null },
      });
    }

    res.json({
      success: false,
      error: "Failed to get swap transaction",
      message: error.message || "Unknown error",
      data: { tx: null },
    });
  }
});

// Get allowance
swapRouter.get("/allowance/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { tokenAddress, walletAddress } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      data: { allowance: "0" },
    });
  }

  if (!tokenAddress || !walletAddress) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters",
      data: { allowance: "0" },
    });
  }

  try {
    const response = await axios.get(
      `${ONEINCH_BASE_URL}/${chainId}/approve/allowance`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        params: {
          tokenAddress,
          walletAddress,
        },
        timeout: 10000,
      }
    );

    res.json({ success: true, data: response.data || { allowance: "0" } });
  } catch (error) {
    console.error("Allowance error:", error.message);
    res.json({ success: true, data: { allowance: "0" } });
  }
});

// Get approve transaction
swapRouter.get("/approve/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { tokenAddress, amount } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      data: null,
    });
  }

  if (!tokenAddress) {
    return res.status(400).json({
      success: false,
      error: "Token address required",
      data: null,
    });
  }

  try {
    const params = { tokenAddress };
    if (amount) params.amount = amount;

    const response = await axios.get(
      `${ONEINCH_BASE_URL}/${chainId}/approve/transaction`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        params,
        timeout: 10000,
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Approve error:", error.message);
    res.json({
      success: false,
      error: "Failed to get approve transaction",
      message: error.response?.data?.description || error.message,
      data: null,
    });
  }
});

// Get spender address
swapRouter.get("/spender/:chainId", async (req, res) => {
  const { chainId } = req.params;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      data: { address: null },
    });
  }

  try {
    const response = await axios.get(
      `${ONEINCH_BASE_URL}/${chainId}/approve/spender`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        timeout: 10000,
      }
    );

    res.json({ success: true, data: response.data || { address: null } });
  } catch (error) {
    console.error("Spender error:", error.message);
    res.json({
      success: false,
      error: "Failed to get spender address",
      data: { address: null },
    });
  }
});

// Mount swap router
app.use(
  "/api/swap",
  (req, res, next) => {
    console.log(`Swap API Request: ${req.method} ${req.path}`);
    next();
  },
  swapRouter
);

// Debug routes (only in development)
if (process.env.NODE_ENV === "development") {
  app.use(
    "/api/debug",
    (req, res, next) => {
      console.log(`Debug API Request: ${req.method} ${req.path}`);
      next();
    },
    debugRoutes
  );
  console.log("Debug routes enabled in development mode");
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

      switch (data.type) {
        case "wallet_connect":
          ws.send(
            JSON.stringify({
              type: "wallet_connected",
              message: "Wallet connection acknowledged",
            })
          );
          break;

        case "chain_switch":
          ws.send(
            JSON.stringify({
              type: "chain_switched",
              message: "Chain switch acknowledged",
              chainId: data.chainId,
            })
          );
          break;

        case "swap_quote":
          ws.send(
            JSON.stringify({
              type: "swap_quote_started",
              message: "Swap quote calculation initiated",
              tokens: { from: data.from, to: data.to },
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

  ws.send(
    JSON.stringify({
      type: "connection",
      message: "Connected to Blockpal Services",
      clientId,
      services: [
        "wallet-connect",
        "tokens",
        "moralis",
        "coingecko",
        "swap",
        "swap-history",
        "coinles",
        "user-watchlist",
      ],
    })
  );
});

// Initialize services
async function initializeServices() {
  try {
    logger.info("Initializing services...");

    await connectMongoDB();

    logger.info("Environment:", {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MORALIS_API_KEY: process.env.MORALIS_API_KEY ? "configured" : "missing",
      COINGECKO_API_KEY: process.env.COINGECKO_API_KEY
        ? "configured"
        : "using default",
      ONEINCH_API_KEY: ONEINCH_API_KEY ? "configured" : "using default",
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
      MONGODB_CONNECTED: mongoose.connection.readyState === 1,
      MONGODB_DATABASE:
        mongoose.connection.readyState === 1
          ? mongoose.connection.db.databaseName
          : "N/A",
    });

    logger.info("Starting Moralis initialization...");
    await moralisService.initialize();
    logger.info("Moralis service initialized");

    logger.info("CoinGecko service ready");
    logger.info("1inch Swap service ready");
    logger.info("CoinLes service ready");

    if (mongoose.connection.readyState === 1) {
      logger.info(
        `Swap history service ready (MongoDB connected to ${mongoose.connection.db.databaseName})`
      );
      logger.info(
        `User watchlist service ready (MongoDB connected to ${mongoose.connection.db.databaseName})`
      );
    } else {
      logger.warn(
        "Swap history and watchlist services may not work properly (MongoDB not connected)"
      );
    }

    logger.info("Starting news ingestion scheduler...");
    await newsScheduler.start();
    logger.info("News scheduler initialized");

    logger.info("All services initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize services", {
      message: error.message,
      stack: error.stack,
    });

    logger.warn("Continuing with partial service initialization");
  }
}

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler - MUST BE LAST
app.use("*", (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
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
      swap: "GET /api/swap/*",
      swapHistory: "GET/POST /api/swap-history/*",
      coinles: "GET /api/coinles/*",
      userWatchlist: "GET/POST/DELETE /api/user-watchlist/*",
      ...(process.env.NODE_ENV === "development" && {
        debug: "GET /api/debug/*",
      }),
    },
  });
});

const PORT = process.env.PORT || 5002;

server.listen(PORT, async () => {
  logger.info(`Blockpal Services running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`WebSocket server running on ws://localhost:${PORT}`);
  logger.info(`Wallet Connect API: http://localhost:${PORT}/api/wallet`);
  logger.info(`Token API: http://localhost:${PORT}/api/tokens`);
  logger.info(`CoinGecko API: http://localhost:${PORT}/api/coingecko`);
  logger.info(`Swap API: http://localhost:${PORT}/api/swap`);
  logger.info(`Swap History API: http://localhost:${PORT}/api/swap-history`);
  logger.info(`CoinLes API: http://localhost:${PORT}/api/coinles`);
  logger.info(`Watchlist API: http://localhost:${PORT}/api/user-watchlist`);

  if (process.env.NODE_ENV === "development") {
    logger.info(`Debug API: http://localhost:${PORT}/api/debug`);
  }

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:3002",
  ];
  logger.info(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

  await initializeServices();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");

  // Stop news scheduler
  newsScheduler.stop();

  server.close(() => {
    mongoose.connection.close();
    logger.info("Process terminated");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
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
  if (process.env.NODE_ENV === "development") {
    process.exit(1);
  }
});

module.exports = app;
