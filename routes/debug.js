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

/**
 * GET /api/debug/test-wallet
 * Test specific wallet with detailed debugging
 */
router.get("/test-wallet", async (req, res) => {
  try {
    const { wallet, chain } = req.query;

    // Test with known wallets that should have tokens
    const testWallets = [
      {
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik's wallet
        chain: 1, // Ethereum
        name: "Vitalik's Wallet",
      },
      {
        address: "0x8ba1f109551bD432803012645Hac136c22C7F6e2", // Test wallet with tokens
        chain: 1,
        name: "Test Wallet",
      },
      {
        address: "0xbA42BF0fD0B59FF60153cdF1c5937Aa3dA2CABF0", // Your current wallet
        chain: 8453, // Base
        name: "Your Wallet",
      },
    ];

    const targetWallet = wallet || testWallets[0].address;
    const targetChain = chain ? parseInt(chain) : testWallets[0].chain;

    logger.info(`🧪 Testing wallet: ${targetWallet} on chain: ${targetChain}`);

    // Initialize Moralis if needed
    if (!moralisService.initialized) {
      logger.info("🔄 Initializing Moralis service for test...");
      await moralisService.initialize();
    }

    // Test the direct Moralis call
    logger.info("🔄 Testing direct Moralis API call...");
    const startTime = Date.now();

    let testResult;
    try {
      testResult = await moralisService.testMoralisCall(
        targetWallet,
        targetChain
      );
    } catch (moralisError) {
      logger.error("❌ Moralis test call failed:", moralisError);
      testResult = {
        error: moralisError.message,
        code: moralisError.code,
      };
    }

    const endTime = Date.now();

    // Test the processed token balances
    logger.info("🔄 Testing processed token balances...");
    let processedTokens;
    try {
      processedTokens = await moralisService.getWalletTokenBalances(
        targetWallet,
        targetChain
      );
    } catch (processError) {
      logger.error("❌ Token processing failed:", processError);
      processedTokens = [];
    }

    // Test native balance separately
    logger.info("🔄 Testing native balance...");
    let nativeBalance;
    try {
      nativeBalance = await moralisService.getNativeBalance(
        targetWallet,
        targetChain
      );
    } catch (nativeError) {
      logger.error("❌ Native balance failed:", nativeError);
      nativeBalance = { balance: 0, balanceWei: "0" };
    }

    const response = {
      test: "Wallet Token Test",
      wallet: targetWallet,
      chainId: targetChain,
      success: true,
      responseTime: `${endTime - startTime}ms`,
      results: {
        moralisRaw: testResult,
        processedTokens: {
          count: processedTokens.length,
          tokens: processedTokens,
          totalValue: processedTokens.reduce((sum, t) => sum + t.value, 0),
        },
        nativeBalance,
        suggestions:
          processedTokens.length === 0
            ? [
                "Try a different wallet address with known token balances",
                "Check if the wallet has any transaction history",
                "Verify the chain ID is correct",
                "Test with Ethereum mainnet (chain ID 1) first",
              ]
            : [],
      },
      availableTestWallets: testWallets,
      moralisInitialized: moralisService.initialized,
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    logger.info(`✅ Wallet test completed in ${endTime - startTime}ms`);
    logger.info(`📊 Found ${processedTokens.length} processed tokens`);

    return ResponseUtil.success(
      res,
      response,
      "Wallet test completed successfully"
    );
  } catch (error) {
    logger.error("❌ Wallet test failed:", error);

    const response = {
      test: "Wallet Token Test",
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.error(res, "Wallet test failed", 500, response);
  }
});

/**
 * GET /api/debug/chain-info
 * Get information about supported chains
 */
router.get("/chain-info", async (req, res) => {
  try {
    const chainConfig = require("../config/chains");

    const chainInfo = Object.entries(chainConfig).map(([chainId, config]) => ({
      chainId: parseInt(chainId),
      name: config.name,
      symbol: config.symbol,
      hexId: config.chainId,
      popularTokensCount: config.popularTokens.length,
      sampleTokens: config.popularTokens.slice(0, 3),
    }));

    const response = {
      supportedChains: chainInfo,
      totalChains: chainInfo.length,
      recommendedTestChains: [
        {
          chainId: 1,
          name: "Ethereum Mainnet",
          reason: "Most tokens and activity",
        },
        { chainId: 8453, name: "Base", reason: "Active L2 with many tokens" },
        { chainId: 137, name: "Polygon", reason: "Many DeFi tokens" },
      ],
    };

    return ResponseUtil.success(res, response, "Chain information retrieved");
  } catch (error) {
    logger.error("❌ Chain info failed:", error);
    return ResponseUtil.error(res, "Failed to get chain information", 500);
  }
});

module.exports = router;
