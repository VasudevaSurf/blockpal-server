// routes/debug.js - Debug endpoint for testing Moralis integration
const express = require("express");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const moralisService = require("../services/moralis");

const router = express.Router();

/**
 * GET /api/debug/verify-wallet
 * Verify if a wallet actually has tokens by checking on Etherscan API or similar
 */
router.get("/verify-wallet", async (req, res) => {
  try {
    const { wallet } = req.query;
    const testWallet = wallet || "0xbA42BF0fD0B59FF60153cdF1c5937Aa3dA2CABF0";

    logger.info(`🔍 Verifying wallet: ${testWallet}`);

    // Try to verify the wallet using a simple ETH balance check
    const ethBalanceResponse = await fetch(
      `https://api.etherscan.io/api?module=account&action=balance&address=${testWallet}&tag=latest&apikey=YourApiKeyToken`
    );
    const ethBalanceData = await ethBalanceResponse.json();

    // Also try to get token transactions to see if the wallet is active
    const tokenTxResponse = await fetch(
      `https://api.etherscan.io/api?module=account&action=tokentx&address=${testWallet}&page=1&offset=10&sort=desc&apikey=YourApiKeyToken`
    );
    const tokenTxData = await tokenTxResponse.json();

    const response = {
      wallet: testWallet,
      ethBalance: {
        wei: ethBalanceData.result || "0",
        eth: ethBalanceData.result
          ? (parseInt(ethBalanceData.result) / 1e18).toFixed(4)
          : "0",
        status: ethBalanceData.status,
      },
      recentTokenTransactions: {
        count: tokenTxData.result?.length || 0,
        transactions: tokenTxData.result?.slice(0, 3) || [],
        status: tokenTxData.status,
      },
      walletLooksActive:
        parseInt(ethBalanceData.result || "0") > 0 ||
        tokenTxData.result?.length > 0,
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, response, "Wallet verification completed");
  } catch (error) {
    logger.error("❌ Wallet verification failed:", error);
    return ResponseUtil.error(res, "Wallet verification failed", 500, {
      error: error.message,
    });
  }
});

/**
 * GET /api/debug/test-moralis
 * Test Moralis API connection with a known wallet
 */
router.get("/test-moralis", async (req, res) => {
  try {
    const { wallet, chain } = req.query;

    // Use default test values if not provided
    const testWallet = wallet || "0xcB1C1FdE09f811B294172696404e88E658659905";
    const testChain = chain ? parseInt(chain) : 1;

    logger.info(
      `🧪 Testing Moralis API with wallet: ${testWallet} on chain: ${testChain}`
    );

    // Test initialization
    if (!moralisService.initialized) {
      logger.info("🔄 Initializing Moralis service for test...");
      await moralisService.initialize();
    }

    // Test the API call
    const startTime = Date.now();
    const tokens = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );
    const endTime = Date.now();

    const response = {
      test: "Moralis API Test",
      wallet: testWallet,
      chainId: testChain,
      success: true,
      responseTime: `${endTime - startTime}ms`,
      tokensFound: tokens.length,
      tokens: tokens.slice(0, 5), // Return first 5 tokens for debugging
      totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
      moralisInitialized: moralisService.initialized,
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Moralis test completed successfully in ${endTime - startTime}ms`
    );

    return ResponseUtil.success(
      res,
      response,
      "Moralis test completed successfully"
    );
  } catch (error) {
    logger.error("❌ Moralis test failed:", error);

    const response = {
      test: "Moralis API Test",
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      moralisInitialized: moralisService.initialized,
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.error(res, "Moralis test failed", 500, response);
  }
});

/**
 * GET /api/debug/raw-moralis
 * Test raw Moralis API call
 */
router.get("/raw-moralis", async (req, res) => {
  try {
    const Moralis = require("moralis").default;

    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xcB1C1FdE09f811B294172696404e88E658659905";
    const testChain = chain || "0x1";

    logger.info(`🧪 Testing RAW Moralis API call`);

    // Initialize if not done
    if (!Moralis.Core.isStarted) {
      await Moralis.start({
        apiKey: process.env.MORALIS_API_KEY,
      });
    }

    const response = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
      chain: testChain,
      address: testWallet,
    });

    const debugResponse = {
      test: "Raw Moralis API Test",
      wallet: testWallet,
      chain: testChain,
      success: true,
      rawResponse: response.raw,
      jsonResponse: response.toJSON(),
      resultCount: response.raw.result?.length || 0,
      timestamp: new Date().toISOString(),
    };

    logger.info(`✅ Raw Moralis test successful`);

    return ResponseUtil.success(
      res,
      debugResponse,
      "Raw Moralis test completed"
    );
  } catch (error) {
    logger.error("❌ Raw Moralis test failed:", error);

    const debugResponse = {
      test: "Raw Moralis API Test",
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.error(
      res,
      "Raw Moralis test failed",
      500,
      debugResponse
    );
  }
});

/**
 * GET /api/debug/config
 * Debug configuration
 */
router.get("/config", async (req, res) => {
  try {
    const config = {
      environment: process.env.NODE_ENV,
      port: process.env.PORT,
      moralisApiKey: process.env.MORALIS_API_KEY
        ? `${process.env.MORALIS_API_KEY.substring(0, 10)}...`
        : "not configured",
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      cacheEnabled: process.env.ENABLE_CACHE,
      cacheTtl: process.env.CACHE_TTL_SECONDS,
      moralisInitialized: moralisService.initialized,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, config, "Configuration retrieved");
  } catch (error) {
    logger.error("❌ Config debug failed:", error);
    return ResponseUtil.serverError(res, "Failed to retrieve configuration");
  }
});

/**
 * POST /api/debug/clear-cache
 * Clear all cache
 */
router.post("/clear-cache", async (req, res) => {
  try {
    // Clear wallet cache
    const cacheStats = moralisService.getCacheStats();

    // This would clear cache for a specific wallet if provided
    const { wallet } = req.body;
    if (wallet) {
      moralisService.clearWalletCache(wallet);
      logger.info(`🗑️ Cleared cache for wallet: ${wallet}`);
    }

    const response = {
      action: "Cache cleared",
      wallet: wallet || "all",
      previousStats: cacheStats,
      newStats: moralisService.getCacheStats(),
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, response, "Cache cleared successfully");
  } catch (error) {
    logger.error("❌ Cache clear failed:", error);
    return ResponseUtil.serverError(res, "Failed to clear cache");
  }
});

module.exports = router;
