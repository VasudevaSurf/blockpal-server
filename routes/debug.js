// routes/debug.js - Enhanced debug routes following wallet-balance.js approach
const express = require("express");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const moralisService = require("../services/moralis");

const router = express.Router();

/**
 * GET /api/debug/test-wallet-balance
 * Test the new wallet-balance.js approach
 */
router.get("/test-wallet-balance", async (req, res) => {
  try {
    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xbA42BF0fD0B59FF60153cdF1c5937Aa3dA2CABF0"; // From your logs
    const testChain = chain ? parseInt(chain) : 1; // Default to Ethereum

    logger.info(
      `🧪 Testing wallet-balance.js approach for wallet: ${testWallet} on chain: ${testChain}`
    );

    // Initialize Moralis if needed
    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    // Test the exact same approach as wallet-balance.js
    logger.info("🔄 Testing token categorization...");
    const startTime = Date.now();
    const result = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );
    const endTime = Date.now();

    // Format the response exactly like wallet-balance.js logs
    const response = {
      test: "wallet-balance.js Approach Test",
      wallet: testWallet,
      chainId: testChain,
      chainName: result.chainName,
      responseTime: `${endTime - startTime}ms`,
      results: {
        totalPortfolioValue: `$${result.totalValue.toFixed(3)}`,
        total24hrChange: `${result.total24hrChange >= 0 ? "+" : ""}$${Math.abs(
          result.total24hrChange
        ).toFixed(3)}`,
        presetTokens: result.displayedTokens.length,
        hiddenTokens: result.hiddenTokens.length,
        totalTokens: result.displayedTokens.length + result.hiddenTokens.length,
      },
      presetTokenBreakdown: result.displayedTokens.map((token, index) => {
        const balance =
          token.balance_formatted ||
          (parseFloat(token.balance) / Math.pow(10, token.decimals)).toFixed(6);
        const usdValue = parseFloat(token.usd_value) || 0;
        const change24h = parseFloat(token.usd_value_24hr_usd_change) || 0;
        const isNative =
          token.native_token ||
          token.token_address === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

        return {
          index: index + 1,
          symbol: token.symbol,
          name: token.name,
          isNative,
          address: token.token_address,
          balance: balance,
          usdValue: `$${usdValue.toFixed(3)}`,
          change24h: `${change24h >= 0 ? "+" : ""}$${Math.abs(
            change24h
          ).toFixed(3)}`,
          logo: token.logo || null,
        };
      }),
      hiddenTokenBreakdown: result.hiddenTokens.map((token, index) => {
        const balance =
          token.balance_formatted ||
          (parseFloat(token.balance) / Math.pow(10, token.decimals)).toFixed(6);
        const usdValue = parseFloat(token.usd_value) || 0;

        return {
          index: index + 1,
          symbol: token.symbol,
          name: token.name,
          address: token.token_address,
          balance: balance,
          usdValue: `$${usdValue.toFixed(3)}`,
          logo: token.logo || null,
        };
      }),
      summary: {
        status:
          result.displayedTokens.length > 0
            ? "✅ Working correctly"
            : "⚠️ No preset tokens found",
        message:
          result.hiddenTokens.length > 0
            ? `💡 Found ${result.hiddenTokens.length} additional token(s) not in preset list.`
            : "No additional tokens found.",
        recommendation:
          result.totalValue > 0
            ? "Wallet-balance.js approach working perfectly!"
            : "Try with a different wallet that has preset tokens.",
      },
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Test completed - Total value: ${response.results.totalPortfolioValue}`
    );
    logger.info(
      `📊 Preset: ${response.results.presetTokens}, Hidden: ${response.results.hiddenTokens}`
    );

    return ResponseUtil.success(
      res,
      response,
      "wallet-balance.js approach test completed"
    );
  } catch (error) {
    logger.error("❌ wallet-balance.js test failed:", error);
    return ResponseUtil.error(res, "Test failed", 500, {
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/debug/compare-show-hide
 * Compare preset vs all tokens display
 */
router.get("/compare-show-hide", async (req, res) => {
  try {
    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xbA42BF0fD0B59FF60153cdF1c5937Aa3dA2CABF0";
    const testChain = chain ? parseInt(chain) : 1;

    logger.info(`🔄 Comparing preset vs all tokens for: ${testWallet}`);

    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    // Get preset tokens only (like default view)
    const presetResult = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );

    const comparison = {
      wallet: testWallet,
      chainId: testChain,
      chainName: presetResult.chainName,
      presetView: {
        displayedTokens: presetResult.displayedTokens.length,
        totalValue: `$${presetResult.totalValue.toFixed(3)}`,
        tokens: presetResult.displayedTokens.map((t) => ({
          symbol: t.symbol,
          value: `$${(parseFloat(t.usd_value) || 0).toFixed(3)}`,
        })),
      },
      hiddenTokens: {
        count: presetResult.hiddenTokens.length,
        tokens: presetResult.hiddenTokens.map((t) => ({
          symbol: t.symbol,
          name: t.name,
          value: `$${(parseFloat(t.usd_value) || 0).toFixed(3)}`,
        })),
      },
      summary: {
        message:
          presetResult.hiddenTokens.length > 0
            ? `Show/Hide functionality working: ${presetResult.displayedTokens.length} preset, ${presetResult.hiddenTokens.length} hidden`
            : "Only preset tokens found, show/hide not needed",
        totalIfShowingAll: `$${(
          presetResult.totalValue +
          presetResult.hiddenTokens.reduce(
            (sum, t) => sum + (parseFloat(t.usd_value) || 0),
            0
          )
        ).toFixed(3)}`,
      },
    };

    return ResponseUtil.success(
      res,
      comparison,
      "Show/Hide comparison completed"
    );
  } catch (error) {
    logger.error("❌ Show/Hide comparison failed:", error);
    return ResponseUtil.error(res, "Comparison failed", 500);
  }
});

/**
 * GET /api/debug/supported-chains
 * Test supported chains
 */
router.get("/supported-chains", async (req, res) => {
  try {
    logger.info("🔍 Testing supported chains");

    const chains = moralisService.getSupportedChains();

    const response = {
      supportedChains: chains,
      chainCount: chains.length,
      presetTokenCounts: chains.reduce((acc, chain) => {
        acc[chain.name] = chain.tokenCount;
        return acc;
      }, {}),
      totalPresetTokens: chains.reduce(
        (sum, chain) => sum + chain.tokenCount,
        0
      ),
    };

    return ResponseUtil.success(res, response, "Supported chains retrieved");
  } catch (error) {
    logger.error("❌ Supported chains test failed:", error);
    return ResponseUtil.error(res, "Test failed", 500);
  }
});

/**
 * POST /api/debug/clear-cache
 * Clear all cache
 */
router.post("/clear-cache", async (req, res) => {
  try {
    const { wallet } = req.body;

    if (wallet) {
      moralisService.clearWalletCache(wallet);
      logger.info(`🗑️ Cleared cache for wallet: ${wallet}`);
    } else {
      // Clear all cache
      const stats = moralisService.getCacheStats();
      logger.info(`🗑️ Clearing all cache (${stats.keys} entries)`);
    }

    return ResponseUtil.success(
      res,
      {
        cleared: wallet || "all",
        timestamp: new Date().toISOString(),
      },
      "Cache cleared successfully"
    );
  } catch (error) {
    logger.error("❌ Cache clear failed:", error);
    return ResponseUtil.error(res, "Cache clear failed", 500);
  }
});

/**
 * GET /api/debug/health
 * Enhanced health check
 */
router.get("/health", async (req, res) => {
  try {
    const stats = moralisService.getCacheStats();
    const chains = moralisService.getSupportedChains();

    const health = {
      status: "healthy",
      service: "Enhanced Token Service (wallet-balance.js approach)",
      moralis: moralisService.initialized ? "connected" : "disconnected",
      cache: {
        ...stats,
        status: "active",
      },
      supportedChains: chains.length,
      presetTokens: chains.reduce((sum, chain) => sum + chain.tokenCount, 0),
      features: [
        "Token categorization (preset vs hidden)",
        "24hr portfolio change tracking",
        "Show/Hide functionality",
        "Stable Moralis integration",
        "Enhanced caching",
      ],
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(res, health, "Enhanced health check completed");
  } catch (error) {
    logger.error("❌ Health check failed:", error);
    return res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
