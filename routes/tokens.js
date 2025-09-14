// routes/tokens.js - COMPLETE REWRITE following wallet-balance.js approach
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
 * Get token balances with show/hide functionality - EXACT copy of wallet-balance.js logic
 */
router.get("/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chain, showHidden = "false" } = req.query;

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

    const showHiddenTokens = showHidden === "true";

    logger.info(
      `Fetching tokens for wallet: ${address} on chain: ${chainId}, showHidden: ${showHiddenTokens}`
    );

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

    // Get token balances from Moralis - EXACT same approach as wallet-balance.js
    let result = [];
    try {
      result = await moralisService.getWalletTokenBalances(address, chainId);
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
      result = {
        displayedTokens: [],
        hiddenTokens: [],
        totalValue: 0,
        total24hrChange: 0,
        chainName: "Unknown",
      };
    }

    // Process tokens into frontend format - EXACT logic from wallet-balance.js
    const processToken = (token) => {
      // Parse balance - EXACT same logic
      let balance = 0;
      if (token.balance_formatted) {
        balance = parseFloat(token.balance_formatted);
      } else if (token.balance) {
        const rawBalance = token.balance.toString();
        const decimals = parseInt(token.decimals) || 18;
        balance = parseFloat(rawBalance) / Math.pow(10, decimals);
      }

      const usdValue = parseFloat(token.usd_value) || 0;
      const usdPrice = parseFloat(token.usd_price) || 0;
      const change24h = parseFloat(token.usd_value_24hr_usd_change) || 0;
      const priceChange24h =
        parseFloat(token.usd_price_24hr_percent_change) || 0;

      // Determine if native token - EXACT same logic
      const isNativeToken =
        token.native_token ||
        token.token_address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
        !token.token_address;

      return {
        id: isNativeToken
          ? `native-${chainId}`
          : `${token.token_address.toLowerCase()}-${chainId}`,
        symbol: token.symbol || "UNKNOWN",
        name: token.name || "Unknown Token",
        contractAddress: isNativeToken
          ? "native"
          : token.token_address.toLowerCase(),
        decimals: parseInt(token.decimals) || 18,
        balance: balance,
        balanceWei: token.balance || "0",
        value: usdValue,
        change24h: priceChange24h, // Percentage change
        usdChange24h: change24h, // USD change amount
        price: usdPrice,
        isNative: isNativeToken,
        logoUrl: token.logo || token.thumbnail || null,
        isPopular: true, // All preset tokens are popular
        possibleSpam: token.possible_spam || false,
        verifiedContract: token.verified_contract !== false,
      };
    };

    // Process displayed tokens (preset tokens)
    const displayedTokens = result.displayedTokens.map(processToken);

    // Process hidden tokens (non-preset tokens)
    const hiddenTokens = result.hiddenTokens.map(processToken);

    // Decide which tokens to return based on showHidden parameter
    let tokensToReturn = displayedTokens;
    if (showHiddenTokens) {
      tokensToReturn = [...displayedTokens, ...hiddenTokens];
    }

    // Sort by USD value descending
    tokensToReturn.sort((a, b) => b.value - a.value);

    const response = {
      wallet: address,
      chainId,
      chainName: result.chainName,
      tokens: tokensToReturn,
      // Summary data - EXACT same as wallet-balance.js
      totalValue: result.totalValue,
      total24hrChange: result.total24hrChange,
      tokenCount: tokensToReturn.length,
      // Metadata for show/hide functionality
      presetTokenCount: displayedTokens.length,
      hiddenTokenCount: hiddenTokens.length,
      showingHidden: showHiddenTokens,
      hasHiddenTokens: hiddenTokens.length > 0,
      lastUpdated: new Date().toISOString(),
    };

    logger.info(
      `Successfully returning ${
        tokensToReturn.length
      } tokens with total value $${result.totalValue.toFixed(2)}`
    );
    logger.info(
      `Preset tokens: ${displayedTokens.length}, Hidden tokens: ${
        hiddenTokens.length
      }, Showing: ${showHiddenTokens ? "All" : "Preset only"}`
    );

    return ResponseUtil.success(res, response, "Tokens fetched successfully");
  } catch (error) {
    logger.error("Error in /tokens/wallet/:address", {
      address: req.params.address,
      chain: req.query.chain,
      showHidden: req.query.showHidden,
      error: error.message,
      stack: error.stack,
    });

    return ResponseUtil.serverError(res, "Failed to fetch token balances");
  }
});

/**
 * GET /api/tokens/chains
 * Get supported chains with token counts
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
      version: "2.0.0",
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
      service: "Token Service v2.0",
      moralis: isHealthy ? "connected" : "disconnected",
      cache: "active",
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      presetChains: Object.keys(moralisService.PRESET_TOKENS || {}).length,
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
