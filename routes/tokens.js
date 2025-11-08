// routes/tokens.js - FIXED REWRITE following wallet-balance.js approach
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
 * Get token balances - WORKS FOR BOTH EVM AND SOLANA
 */
router.get("/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chain, showHidden = "false" } = req.query;

    // Validation - accept both EVM addresses and Solana addresses
    const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(address);
    const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address); // Base58 format

    if (!isEvmAddress && !isSolanaAddress) {
      return ResponseUtil.validation(
        res,
        "Invalid wallet address format (must be EVM or Solana address)"
      );
    }

    if (!chain) {
      return ResponseUtil.validation(res, "Chain ID is required");
    }

    // Handle chain ID - can be number (EVM) or string (Solana)
    const chainId =
      chain.toLowerCase() === "solana" ? "solana" : parseInt(chain);

    if (chainId !== "solana" && isNaN(chainId)) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    const showHiddenTokens = showHidden === "true";

    logger.info(
      `Fetching tokens for wallet: ${address} on chain: ${chainId}, showHidden: ${showHiddenTokens}`
    );

    // ✅ Service automatically detects chain type and uses correct endpoint
    const result = await moralisService.getWalletTokenBalances(
      address,
      chainId
    );

    // Process tokens (same as before, works for both EVM and Solana)
    const processToken = (token) => {
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
        change24h: priceChange24h,
        usdChange24h: change24h,
        price: usdPrice,
        isNative: isNativeToken,
        logoUrl: token.logo || token.thumbnail || null,
        isPopular: true,
        possibleSpam: token.possible_spam || false,
        verifiedContract: token.verified_contract !== false,
      };
    };

    // Process displayed and hidden tokens
    const displayedTokens = result.displayedTokens
      .map(processToken)
      .sort((a, b) => b.value - a.value);

    const hiddenTokens = result.hiddenTokens
      .map(processToken)
      .sort((a, b) => b.value - a.value);

    // Decide which tokens to return
    let tokensToReturn = [];
    let actualPresetCount = displayedTokens.length;
    let actualHiddenCount = hiddenTokens.length;

    if (showHiddenTokens) {
      tokensToReturn = [...displayedTokens, ...hiddenTokens];
    } else {
      tokensToReturn = displayedTokens;
      actualHiddenCount = hiddenTokens.length;
    }

    const response = {
      wallet: address,
      chainId,
      chainName: result.chainName,
      tokens: tokensToReturn,
      totalValue: result.totalValue,
      total24hrChange: result.total24hrChange,
      tokenCount: tokensToReturn.length,
      presetTokenCount: actualPresetCount,
      hiddenTokenCount: actualHiddenCount,
      showingHidden: showHiddenTokens,
      hasHiddenTokens: hiddenTokens.length > 0,
      lastUpdated: new Date().toISOString(),
    };

    logger.info(
      `Successfully returning ${tokensToReturn.length} tokens (${actualPresetCount} preset, ${actualHiddenCount} hidden)`
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
