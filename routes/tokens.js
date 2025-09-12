// routes/tokens.js - Updated token API routes with better error handling
const express = require("express");
const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const moralisService = require("../services/moralis");

const router = express.Router();

// Rate limiting for token endpoints
const tokenRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: "Too many token requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(tokenRateLimit);

/**
 * GET /api/tokens/wallet/:address
 * Get token balances for a wallet address on a specific chain
 */
router.get("/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;

    // Validation
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    if (!chain) {
      return ResponseUtil.validation(res, "Chain ID is required");
    }

    const chainId = parseInt(chain);
    if (isNaN(chainId)) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    logger.info(`Fetching tokens for wallet: ${address} on chain: ${chainId}`);

    // Check if Moralis service is initialized
    if (!moralisService.initialized) {
      logger.warn(
        "Moralis service not initialized, attempting to initialize..."
      );
      try {
        await moralisService.initialize();
      } catch (initError) {
        logger.error("Failed to initialize Moralis service:", initError);
        return ResponseUtil.error(res, "Service initialization failed", 503);
      }
    }

    // Get token balances from Moralis
    let tokens = [];
    try {
      tokens = await moralisService.getWalletTokenBalances(address, chainId);
    } catch (moralisError) {
      logger.error("Moralis API error:", moralisError);

      // Check for specific Moralis errors
      if (moralisError.message.includes("Invalid address")) {
        return ResponseUtil.validation(res, "Invalid wallet address");
      }

      if (moralisError.message.includes("Invalid chain")) {
        return ResponseUtil.validation(res, "Unsupported chain ID");
      }

      if (moralisError.message.includes("API key")) {
        return ResponseUtil.error(res, "API configuration error", 503);
      }

      // Return empty result for other errors (don't break the UI)
      logger.warn(
        `Returning empty result due to Moralis error: ${moralisError.message}`
      );
      tokens = [];
    }

    // Calculate total portfolio value
    const totalValue = tokens.reduce(
      (sum, token) => sum + (token.value || 0),
      0
    );

    const response = {
      wallet: address,
      chainId,
      tokens,
      totalValue,
      tokenCount: tokens.length,
      lastUpdated: new Date().toISOString(),
    };

    logger.info(
      `Successfully returning ${
        tokens.length
      } tokens with total value $${totalValue.toFixed(2)}`
    );

    return ResponseUtil.success(res, response, "Tokens fetched successfully");
  } catch (error) {
    logger.error("Error in /tokens/wallet/:address", {
      address: req.params.address,
      chain: req.query.chain,
      error: error.message,
      stack: error.stack,
    });

    return ResponseUtil.serverError(res, "Failed to fetch token balances");
  }
});

/**
 * GET /api/tokens/popular/:chainId
 * Get popular tokens for a specific chain
 */
router.get("/popular/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    const chainIdNum = parseInt(chainId);
    if (isNaN(chainIdNum)) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    logger.info(`Fetching popular tokens for chain: ${chainIdNum}`);

    const popularTokens = moralisService.getPopularTokens(chainIdNum);

    if (!popularTokens || popularTokens.length === 0) {
      return ResponseUtil.notFound(
        res,
        `No popular tokens found for chain ${chainIdNum}`
      );
    }

    const response = {
      chainId: chainIdNum,
      tokens: popularTokens,
      count: popularTokens.length,
    };

    return ResponseUtil.success(
      res,
      response,
      "Popular tokens fetched successfully"
    );
  } catch (error) {
    logger.error("Error in /tokens/popular/:chainId", {
      chainId: req.params.chainId,
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to fetch popular tokens");
  }
});

/**
 * GET /api/tokens/chains
 * Get supported chains and their information
 */
router.get("/chains", async (req, res) => {
  try {
    logger.info("Fetching supported chains");

    const chains = moralisService.getSupportedChains();

    const response = {
      chains,
      count: chains.length,
    };

    return ResponseUtil.success(
      res,
      response,
      "Supported chains fetched successfully"
    );
  } catch (error) {
    logger.error("Error in /tokens/chains", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to fetch supported chains");
  }
});

/**
 * POST /api/tokens/refresh/:address
 * Refresh token data for a wallet (clears cache)
 */
router.post("/refresh/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Validation
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    logger.info(`Refreshing token data for wallet: ${address}`);

    // Clear cache for the wallet
    moralisService.clearWalletCache(address);

    return ResponseUtil.success(
      res,
      null,
      "Token data cache cleared successfully"
    );
  } catch (error) {
    logger.error("Error in /tokens/refresh/:address", {
      address: req.params.address,
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to refresh token data");
  }
});

/**
 * GET /api/tokens/native/:address
 * Get native token balance for a wallet
 */
router.get("/native/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;

    // Validation
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    if (!chain) {
      return ResponseUtil.validation(res, "Chain ID is required");
    }

    const chainId = parseInt(chain);
    if (isNaN(chainId)) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    logger.info(
      `Fetching native balance for wallet: ${address} on chain: ${chainId}`
    );

    // Get native balance from Moralis
    const nativeBalance = await moralisService.getNativeBalance(
      address,
      chainId
    );

    const response = {
      wallet: address,
      chainId,
      nativeBalance,
      lastUpdated: new Date().toISOString(),
    };

    return ResponseUtil.success(
      res,
      response,
      "Native balance fetched successfully"
    );
  } catch (error) {
    logger.error("Error in /tokens/native/:address", {
      address: req.params.address,
      chain: req.query.chain,
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to fetch native balance");
  }
});

/**
 * GET /api/tokens/stats
 * Get service statistics
 */
router.get("/stats", async (req, res) => {
  try {
    logger.info("Fetching token service statistics");

    const stats = {
      service: "Token Service",
      version: "1.0.0",
      uptime: process.uptime(),
      cache: moralisService.getCacheStats(),
      supportedChains: moralisService.getSupportedChains().length,
      moralisInitialized: moralisService.initialized,
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, stats, "Statistics fetched successfully");
  } catch (error) {
    logger.error("Error in /tokens/stats", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to fetch statistics");
  }
});

/**
 * GET /api/tokens/health
 * Health check for token service
 */
router.get("/health", async (req, res) => {
  try {
    // Test Moralis connection
    const isHealthy = moralisService.initialized;

    const health = {
      status: isHealthy ? "healthy" : "unhealthy",
      service: "Token Service",
      moralis: isHealthy ? "connected" : "disconnected",
      cache: "active",
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    const statusCode = isHealthy ? 200 : 503;
    return res.status(statusCode).json(health);
  } catch (error) {
    logger.error("Error in /tokens/health", {
      error: error.message,
    });

    return res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
