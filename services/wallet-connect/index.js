const express = require("express");
const { logger } = require("../../utils/logger");
const { validateWalletConfig } = require("./config/walletConfig");

// Import routes
const walletRoutes = require("./routes/wallet");
const chainRoutes = require("./routes/chains");

const router = express.Router();

// Validate configuration on startup
try {
  validateWalletConfig();
  logger.info("Wallet Connect service initialized successfully");
} catch (error) {
  logger.error("Failed to initialize Wallet Connect service:", error);
  throw error;
}

// Service health check
router.get("/health", (req, res) => {
  res.json({
    service: "wallet-connect",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
router.use("/", walletRoutes);
router.use("/chains", chainRoutes);

// Service info endpoint
router.get("/info", (req, res) => {
  res.json({
    service: "wallet-connect",
    version: "1.0.0",
    description: "Wallet connection and chain management service",
    endpoints: {
      "GET /config": "Get wallet configuration",
      "GET /chains": "Get supported chains",
      "GET /wallets": "Get supported wallets",
      "POST /connect": "Connect wallet",
      "POST /disconnect": "Disconnect wallet",
      "POST /switch-chain": "Switch blockchain network",
      "GET /status/:sessionId": "Get wallet status",
      "GET /connected": "Get connected wallets",
      "GET /chains/:chainId": "Get chain information",
      "GET /chains/validate/:chainId": "Validate chain support",
      "GET /chains/search/:network": "Search chains by network",
    },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
