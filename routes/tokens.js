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
 * FIXED: Now correctly includes user-added tokens in mainListValue calculation
 */
router.get("/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chain, showHidden = "false", email } = req.query; // ✅ ADDED: email parameter

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

    console.log("\n🔍 ═══ TOKEN ROUTE DEBUG ═══");
    console.log(`Fetching tokens for wallet: ${address} on chain: ${chainId}`);
    console.log(`Show Hidden: ${showHiddenTokens}`);
    console.log(`User Email: ${email || "Not provided"}`);

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
    let result = [];
    try {
      result = await moralisService.getWalletTokenBalances(address, chainId);
    } catch (moralisError) {
      logger.error("Moralis API error:", moralisError);

      if (moralisError.message.includes("Invalid address")) {
        return ResponseUtil.validation(res, "Invalid wallet address");
      }

      if (moralisError.message.includes("Invalid chain")) {
        return ResponseUtil.validation(res, "Unsupported chain ID");
      }

      if (moralisError.message.includes("API key")) {
        return ResponseUtil.error(res, "API configuration error", 503);
      }

      result = {
        displayedTokens: [],
        hiddenTokens: [],
        totalValue: 0,
        mainListValue: 0,
        total24hrChange: 0,
        chainName: "Unknown",
      };
    }

    // ✅ CRITICAL: Load user preferences to get user-added tokens
    let userAddedTokenAddresses = [];
    if (email) {
      try {
        const preferences = await findWalletPreferences(
          email,
          address,
          chainId
        );
        if (preferences && preferences.userAddedTokens) {
          userAddedTokenAddresses = preferences.userAddedTokens.map((addr) =>
            addr.toLowerCase()
          );
          console.log(
            `📋 User has ${userAddedTokenAddresses.length} user-added tokens:`,
            userAddedTokenAddresses
          );
        }
      } catch (error) {
        console.error("Error loading preferences:", error);
      }
    }

    // Process tokens with proper flags
    const processToken = (token, isInMainList, isUserAdded = false) => {
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
        isPopular: isInMainList,
        isPreset: isInMainList && !isUserAdded, // ✅ Only true for actual preset tokens
        isUserAdded: isUserAdded, // ✅ Flag user-added tokens
        possibleSpam: token.possible_spam || false,
        verifiedContract: token.verified_contract !== false,
      };
    };

    // ✅ FIXED: Separate displayed tokens into preset and user-added
    console.log("\n📊 ═══ PROCESSING TOKENS ═══");

    const presetTokens = [];
    const userAddedTokens = [];
    const hiddenTokensProcessed = [];

    // Process displayed tokens (from Moralis)
    result.displayedTokens.forEach((token) => {
      const tokenAddress = token.token_address?.toLowerCase() || "native";
      const isUserAdded = userAddedTokenAddresses.includes(tokenAddress);

      if (isUserAdded) {
        console.log(
          `   ✓ USER-ADDED: ${token.symbol} (${tokenAddress.slice(0, 10)}...)`
        );
        userAddedTokens.push(processToken(token, true, true));
      } else {
        console.log(
          `   ✓ PRESET: ${token.symbol} (${tokenAddress.slice(0, 10)}...)`
        );
        presetTokens.push(processToken(token, true, false));
      }
    });

    // Process hidden tokens
    result.hiddenTokens.forEach((token) => {
      const tokenAddress = token.token_address?.toLowerCase() || "native";
      const isUserAdded = userAddedTokenAddresses.includes(tokenAddress);

      if (isUserAdded) {
        // User added this token, move to main list
        console.log(
          `   ✓ USER-ADDED (was hidden): ${token.symbol} (${tokenAddress.slice(
            0,
            10
          )}...)`
        );
        userAddedTokens.push(processToken(token, true, true));
      } else {
        console.log(
          `   ✗ HIDDEN: ${token.symbol} (${tokenAddress.slice(0, 10)}...)`
        );
        hiddenTokensProcessed.push(processToken(token, false, false));
      }
    });

    // ✅ CRITICAL: Combine preset + user-added for main list
    const mainListTokens = [...presetTokens, ...userAddedTokens].sort(
      (a, b) => b.value - a.value
    );

    console.log("\n📈 ═══ FINAL TOKEN COUNTS ═══");
    console.log(`   ├─ Preset Tokens: ${presetTokens.length}`);
    console.log(`   ├─ User-Added Tokens: ${userAddedTokens.length}`);
    console.log(`   ├─ Main List Total: ${mainListTokens.length}`);
    console.log(`   └─ Hidden Tokens: ${hiddenTokensProcessed.length}`);

    // ✅ CRITICAL: Recalculate mainListValue from mainListTokens
    const recalculatedMainListValue = mainListTokens.reduce(
      (sum, t) => sum + t.value,
      0
    );
    const recalculatedMainList24hrChange = mainListTokens.reduce(
      (sum, t) => sum + (t.usdChange24h || 0),
      0
    );

    console.log("\n💰 ═══ VALUE CALCULATION ═══");
    console.log(
      `   ├─ Original mainListValue: $${result.mainListValue.toFixed(3)}`
    );
    console.log(
      `   ├─ Recalculated mainListValue: $${recalculatedMainListValue.toFixed(
        3
      )}`
    );
    console.log(
      `   ├─ Match: ${
        Math.abs(result.mainListValue - recalculatedMainListValue) < 0.01
          ? "✅"
          : "❌"
      }`
    );

    if (Math.abs(result.mainListValue - recalculatedMainListValue) >= 0.01) {
      console.log(
        `   └─ ⚠️ Using recalculated value (includes user-added tokens)`
      );
    }

    // Decide which tokens to return
    let tokensToReturn = [];
    if (showHiddenTokens) {
      tokensToReturn = [...mainListTokens, ...hiddenTokensProcessed];
    } else {
      tokensToReturn = mainListTokens;
    }

    // ✅ CRITICAL FIX: Return correct counts and values
    const response = {
      wallet: address,
      chainId,
      chainName: result.chainName,
      tokens: tokensToReturn,
      totalValue: result.totalValue, // All tokens
      mainListValue: recalculatedMainListValue, // ✅ Includes user-added tokens
      total24hrChange: recalculatedMainList24hrChange, // ✅ Includes user-added tokens
      tokenCount: tokensToReturn.length,
      presetTokenCount: mainListTokens.length, // ✅ FIXED: Preset + User-Added
      hiddenTokenCount: hiddenTokensProcessed.length,
      showingHidden: showHiddenTokens,
      hasHiddenTokens: hiddenTokensProcessed.length > 0,
      lastUpdated: new Date().toISOString(),
    };

    console.log("\n📤 ═══ SENDING RESPONSE ═══");
    console.log(
      `   ├─ mainListValue: $${response.mainListValue.toFixed(3)} (includes ${
        userAddedTokens.length
      } user-added)`
    );
    console.log(`   ├─ totalValue: $${response.totalValue.toFixed(3)}`);
    console.log(
      `   ├─ presetTokenCount: ${response.presetTokenCount} (${presetTokens.length} preset + ${userAddedTokens.length} user-added)`
    );
    console.log(`   └─ hiddenTokenCount: ${response.hiddenTokenCount}`);

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
