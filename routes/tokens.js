// routes/tokens.js - FIXED: Solana Support
const express = require("express");
const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const moralisService = require("../services/moralis");

const router = express.Router();

const tokenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many token requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(tokenRateLimit);

/**
 * GET /api/tokens/wallet/:address
 * ✅ FIXED: Support both EVM (number) and Solana (string) chain IDs
 */
router.get("/wallet/:address", async (req, res) => {
  try {
    console.log("\n🔥 ===== TOKEN API REQUEST START =====");
    console.log("📥 Request params:", req.params);
    console.log("📥 Request query:", req.query);
    console.log("📥 Request headers:", {
      origin: req.get("origin"),
      userAgent: req.get("user-agent"),
    });

    const { address } = req.params;
    const { chain, showHidden = "false" } = req.query;

    console.log("🔍 Extracted values:", { address, chain, showHidden });

    // ✅ FIXED: Support Solana addresses (base58) and EVM addresses (0x...)
    const isEVMAddress = address.match(/^0x[a-fA-F0-9]{40}$/);
    const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

    console.log("🔍 Address validation:", {
      isEVMAddress: !!isEVMAddress,
      isSolanaAddress,
    });

    if (!isEVMAddress && !isSolanaAddress) {
      console.log("❌ Invalid address format");
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    if (!chain) {
      console.log("❌ Chain ID missing");
      return ResponseUtil.validation(res, "Chain ID is required");
    }

    // ✅ FIXED: Handle both string (Solana) and number (EVM) chain IDs
    const isSolana = chain === "solana" || chain === "solana:mainnet";
    const chainId = isSolana ? "solana" : parseInt(chain);

    console.log("🔍 Chain details:", {
      chainId,
      isSolana,
      originalChain: chain,
    });

    if (!isSolana && isNaN(chainId)) {
      console.log("❌ Invalid chain ID");
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    const showHiddenTokens = showHidden === "true";

    logger.info(
      `🪙 Fetching tokens for wallet: ${address.substring(
        0,
        10
      )}... on chain: ${chainId} (Solana: ${isSolana}), showHidden: ${showHiddenTokens}`
    );

    if (!moralisService.initialized) {
      console.log("⚠️ Moralis not initialized, attempting to initialize...");
      logger.warn(
        "Moralis service not initialized, attempting to initialize..."
      );
      try {
        await moralisService.initialize();
        console.log("✅ Moralis initialized successfully");
      } catch (initError) {
        console.error("❌ Failed to initialize Moralis:", initError);
        logger.error("Failed to initialize Moralis service:", initError);
        return ResponseUtil.error(res, "Service initialization failed", 503);
      }
    }

    console.log("📡 Calling moralisService.getWalletTokenBalances...");

    // ✅ Get token balances from Moralis (works for both EVM and Solana)
    let result = [];
    try {
      result = await moralisService.getWalletTokenBalances(address, chainId);
      console.log("✅ Moralis returned:", {
        displayedTokens: result.displayedTokens?.length || 0,
        hiddenTokens: result.hiddenTokens?.length || 0,
        totalValue: result.totalValue,
        chainName: result.chainName,
      });
    } catch (moralisError) {
      console.error("❌ Moralis API error:", moralisError);
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

      logger.warn(
        `Returning empty result due to Moralis error: ${moralisError.message}`
      );
      result = {
        displayedTokens: [],
        hiddenTokens: [],
        totalValue: 0,
        total24hrChange: 0,
        chainName: isSolana ? "Solana" : "Unknown",
      };
    }

    const processToken = (token) => {
      let balance = 0;
      if (token.balance_formatted) {
        balance = parseFloat(token.balance_formatted);
      } else if (token.balance) {
        const rawBalance = token.balance.toString();
        const decimals = parseInt(token.decimals) || (isSolana ? 9 : 18);
        balance = parseFloat(rawBalance) / Math.pow(10, decimals);
      }

      const usdValue = parseFloat(token.usd_value) || 0;
      const usdPrice = parseFloat(token.usd_price) || 0;
      const change24h = parseFloat(token.usd_value_24hr_usd_change) || 0;
      const priceChange24h =
        parseFloat(token.usd_price_24hr_percent_change) || 0;

      // ✅ FIXED: Handle Solana native token differently
      const isNativeToken =
        token.native_token ||
        (isSolana && token.symbol === "SOL") ||
        (!isSolana &&
          (token.token_address ===
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
            !token.token_address));

      return {
        id: isNativeToken
          ? `native-${chainId}`
          : `${token.token_address.toLowerCase()}-${chainId}`,
        symbol: token.symbol || "UNKNOWN",
        name: token.name || "Unknown Token",
        contractAddress: isNativeToken
          ? "native"
          : token.token_address.toLowerCase(),
        decimals: parseInt(token.decimals) || (isSolana ? 9 : 18),
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

    const displayedTokens = result.displayedTokens
      .map(processToken)
      .sort((a, b) => b.value - a.value);

    const hiddenTokens = result.hiddenTokens
      .map(processToken)
      .sort((a, b) => b.value - a.value);

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
      `Successfully returning ${
        tokensToReturn.length
      } tokens (${actualPresetCount} preset, ${actualHiddenCount} hidden) for ${
        isSolana ? "Solana" : "EVM"
      } chain`
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

router.post("/refresh/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // ✅ Support both EVM and Solana addresses
    const isEVMAddress = address.match(/^0x[a-fA-F0-9]{40}$/);
    const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

    if (!isEVMAddress && !isSolanaAddress) {
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    logger.info(`Refreshing token data for wallet: ${address}`);

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

router.get("/native/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;

    const isEVMAddress = address.match(/^0x[a-fA-F0-9]{40}$/);
    const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

    if (!isEVMAddress && !isSolanaAddress) {
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    if (!chain) {
      return ResponseUtil.validation(res, "Chain ID is required");
    }

    const isSolana = chain === "solana" || chain === "solana:mainnet";
    const chainId = isSolana ? "solana" : parseInt(chain);

    if (!isSolana && isNaN(chainId)) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    logger.info(
      `Fetching native balance for wallet: ${address} on chain: ${chainId}`
    );

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

router.get("/health", async (req, res) => {
  try {
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
