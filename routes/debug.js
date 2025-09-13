// routes/debug.js - Enhanced debug routes with price testing
const express = require("express");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const moralisService = require("../services/moralis");

const router = express.Router();

/**
 * GET /api/debug/test-pricing
 * Test the enhanced pricing system
 */
router.get("/test-pricing", async (req, res) => {
  try {
    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // Vitalik's wallet
    const testChain = chain ? parseInt(chain) : 1;

    logger.info(`🧪 Testing enhanced pricing system for wallet: ${testWallet}`);

    // Initialize Moralis if needed
    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    // Test price fetching
    logger.info("🔄 Testing price fetching...");
    const prices = await moralisService.refreshPrices();

    // Test wallet token balances with enhanced pricing
    logger.info("🔄 Testing wallet token balances...");
    const startTime = Date.now();
    const tokens = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );
    const endTime = Date.now();

    // Test native balance
    logger.info("🔄 Testing native balance...");
    const nativeBalance = await moralisService.getNativeBalance(
      testWallet,
      testChain
    );

    // Calculate totals
    const totalValue = tokens.reduce((sum, t) => sum + (t.value || 0), 0);
    const tokensWithValue = tokens.filter((t) => t.value > 0);
    const tokensWithoutValue = tokens.filter((t) => t.value === 0);

    const response = {
      test: "Enhanced Pricing System Test",
      wallet: testWallet,
      chainId: testChain,
      responseTime: `${endTime - startTime}ms`,
      pricing: {
        currentPrices: prices,
        priceSourcesAvailable: [
          "Moralis API",
          "CoinGecko API",
          "Fallback prices",
          "Live price fetching",
        ],
      },
      results: {
        totalTokens: tokens.length,
        tokensWithValue: tokensWithValue.length,
        tokensWithoutValue: tokensWithoutValue.length,
        totalPortfolioValue: totalValue,
        nativeBalance: nativeBalance,
        tokenBreakdown: tokens.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          balance: token.balance,
          price: token.price,
          value: token.value,
          priceSource:
            token.price > 0 ? "successfully_resolved" : "no_price_found",
        })),
      },
      recommendations:
        totalValue === 0 && tokens.length > 0
          ? [
              "Some tokens found but no USD values calculated",
              "Check if CoinGecko API is accessible",
              "Verify Moralis is returning price data",
              "Check network connectivity for external APIs",
            ]
          : totalValue > 0
          ? [
              "Pricing system working correctly",
              "USD values successfully calculated",
            ]
          : [
              "No tokens found - try different wallet address",
              "Ensure wallet has transaction history",
            ],
      cacheStats: moralisService.getCacheStats(),
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Pricing test completed - Total value: $${totalValue.toFixed(2)}`
    );

    return ResponseUtil.success(
      res,
      response,
      "Pricing test completed successfully"
    );
  } catch (error) {
    logger.error("❌ Pricing test failed:", error);
    return ResponseUtil.error(res, "Pricing test failed", 500, {
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/debug/check-prices
 * Check current cached prices
 */
router.get("/check-prices", async (req, res) => {
  try {
    logger.info("🔍 Checking current cached prices");

    const currentPrices = moralisService.getCurrentPrices();
    const cacheStats = moralisService.getCacheStats();

    // Test a few key prices
    const testSymbols = ["ETH", "USDT", "USDC", "BTC", "MATIC"];
    const priceTests = {};

    for (const symbol of testSymbols) {
      const price = await moralisService.getTokenPrice(symbol);
      priceTests[symbol] = {
        currentPrice: price,
        hasCachedPrice: !!currentPrices[symbol],
        cachedPrice: currentPrices[symbol] || null,
        fallbackPrice: moralisService.fallbackPrices[symbol] || null,
      };
    }

    const response = {
      status: "Price Check Complete",
      allCachedPrices: currentPrices,
      priceTests,
      cacheStats,
      totalCachedPrices: Object.keys(currentPrices).length,
      lastPriceUpdate: "Check server logs for update timing",
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, response, "Price check completed");
  } catch (error) {
    logger.error("❌ Price check failed:", error);
    return ResponseUtil.error(res, "Price check failed", 500);
  }
});

/**
 * POST /api/debug/refresh-prices
 * Manually refresh prices
 */
router.post("/refresh-prices", async (req, res) => {
  try {
    logger.info("🔄 Manual price refresh requested");

    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    const startTime = Date.now();
    const updatedPrices = await moralisService.refreshPrices();
    const endTime = Date.now();

    const response = {
      action: "Manual Price Refresh",
      success: true,
      refreshTime: `${endTime - startTime}ms`,
      updatedPrices,
      priceCount: Object.keys(updatedPrices).length,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Manual price refresh completed in ${endTime - startTime}ms`
    );

    return ResponseUtil.success(res, response, "Prices refreshed successfully");
  } catch (error) {
    logger.error("❌ Manual price refresh failed:", error);
    return ResponseUtil.error(res, "Price refresh failed", 500);
  }
});

/**
 * GET /api/debug/test-specific-token
 * Test pricing for a specific token
 */
router.get("/test-specific-token", async (req, res) => {
  try {
    const { symbol, wallet, chain } = req.query;

    if (!symbol) {
      return ResponseUtil.validation(res, "Token symbol is required");
    }

    logger.info(`🔍 Testing pricing for specific token: ${symbol}`);

    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    // Test different price methods
    const priceTests = {
      fallbackPrice: moralisService.fallbackPrices[symbol] || null,
      cachedPrice: null,
      livePrice: null,
      moralisPrice: null,
      finalPrice: null,
    };

    // Get cached price
    const cachedPrices = moralisService.getCurrentPrices();
    priceTests.cachedPrice = cachedPrices[symbol] || null;

    // Test live price fetching
    try {
      priceTests.livePrice = await moralisService.fetchLiveTokenPrice(symbol);
    } catch (error) {
      logger.warn(`Failed to fetch live price for ${symbol}:`, error.message);
    }

    // Get final price using the service method
    priceTests.finalPrice = await moralisService.getTokenPrice(symbol);

    // If wallet and chain provided, test in context
    let walletTest = null;
    if (wallet && chain) {
      try {
        const tokens = await moralisService.getWalletTokenBalances(
          wallet,
          parseInt(chain)
        );
        const foundToken = tokens.find(
          (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
        );
        walletTest = foundToken
          ? {
              found: true,
              balance: foundToken.balance,
              price: foundToken.price,
              value: foundToken.value,
            }
          : {
              found: false,
              message: "Token not found in wallet",
            };
      } catch (error) {
        walletTest = {
          error: error.message,
        };
      }
    }

    const response = {
      test: "Specific Token Price Test",
      symbol: symbol.toUpperCase(),
      priceTests,
      walletTest,
      recommendations:
        priceTests.finalPrice > 0
          ? [
              "Price successfully resolved",
              `Using price: $${priceTests.finalPrice}`,
            ]
          : [
              "No price found for this token",
              "Token might not be supported",
              "Try adding to fallback prices if it's a popular token",
            ],
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, response, "Token price test completed");
  } catch (error) {
    logger.error("❌ Specific token test failed:", error);
    return ResponseUtil.error(res, "Token price test failed", 500);
  }
});

/**
 * GET /api/debug/test-wallet-with-debug
 * Enhanced wallet test with detailed price debugging
 */
router.get("/test-wallet-with-debug", async (req, res) => {
  try {
    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const testChain = chain ? parseInt(chain) : 1;

    logger.info(`🧪 Enhanced wallet test with price debugging: ${testWallet}`);

    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    // Step 1: Refresh prices
    logger.info("Step 1: Refreshing prices...");
    await moralisService.refreshPrices();

    // Step 2: Get raw Moralis response
    logger.info("Step 2: Testing raw Moralis API...");
    const Moralis = require("moralis").default;
    const chainHex = moralisService.getChainHex(testChain);

    let rawMoralisResponse = null;
    try {
      const response = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice(
        {
          chain: chainHex,
          address: testWallet,
        }
      );
      rawMoralisResponse = {
        success: true,
        tokenCount:
          response.result?.length || response.raw?.result?.length || 0,
        sampleTokens: (response.result || response.raw?.result || [])
          .slice(0, 3)
          .map((token) => ({
            symbol: token.symbol,
            balance_formatted: token.balance_formatted,
            usd_price: token.usd_price,
            usd_value: token.usd_value,
            native_token: token.native_token,
          })),
      };
    } catch (moralisError) {
      rawMoralisResponse = {
        success: false,
        error: moralisError.message,
      };
    }

    // Step 3: Test processed tokens
    logger.info("Step 3: Testing processed tokens...");
    const processedTokens = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );

    // Step 4: Analyze results
    const analysis = {
      rawMoralisResponse,
      processedResults: {
        totalTokens: processedTokens.length,
        tokensWithPrice: processedTokens.filter((t) => t.price > 0).length,
        tokensWithValue: processedTokens.filter((t) => t.value > 0).length,
        totalValue: processedTokens.reduce((sum, t) => sum + t.value, 0),
        topTokens: processedTokens.slice(0, 5).map((token) => ({
          symbol: token.symbol,
          balance: token.balance,
          price: token.price,
          value: token.value,
          isNative: token.isNative,
          priceSource: token.price > 0 ? "resolved" : "missing",
        })),
      },
      priceSystemStatus: {
        cachedPrices: Object.keys(moralisService.getCurrentPrices()).length,
        fallbackPrices: Object.keys(moralisService.fallbackPrices).length,
        cacheStats: moralisService.getCacheStats(),
      },
    };

    const response = {
      test: "Enhanced Wallet Test with Price Debugging",
      wallet: testWallet,
      chainId: testChain,
      analysis,
      diagnosis:
        analysis.processedResults.totalValue > 0
          ? "✅ Pricing system working correctly"
          : analysis.processedResults.totalTokens > 0
          ? "⚠️ Tokens found but no USD values - price fetching issue"
          : "ℹ️ No tokens found - empty wallet or API issue",
      nextSteps:
        analysis.processedResults.totalValue === 0 &&
        analysis.processedResults.totalTokens > 0
          ? [
              "Check CoinGecko API connectivity",
              "Verify Moralis price data quality",
              "Test with different wallet that has popular tokens",
              "Check server network connectivity",
            ]
          : [],
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(
      res,
      response,
      "Enhanced wallet test completed"
    );
  } catch (error) {
    logger.error("❌ Enhanced wallet test failed:", error);
    return ResponseUtil.error(res, "Enhanced wallet test failed", 500);
  }
});

// Keep existing debug routes...
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

module.exports = router;
