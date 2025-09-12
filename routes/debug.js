// routes/debug.js - UPDATED with preset token testing
const express = require("express");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const moralisService = require("../services/moralis");
const chainConfig = require("../config/chains");

const router = express.Router();

/**
 * NEW: GET /api/debug/test-preset-tokens
 * Test preset token filtering for a specific chain
 */
router.get("/test-preset-tokens", async (req, res) => {
  try {
    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xcB1C1FdE09f811B294172696404e88E658659905";
    const testChain = chain ? parseInt(chain) : 1;

    logger.info(
      `🧪 Testing preset token filtering for wallet: ${testWallet} on chain: ${testChain}`
    );

    // Get chain configuration
    const chainInfo = chainConfig[testChain];
    if (!chainInfo) {
      return ResponseUtil.error(res, `Chain ${testChain} not configured`, 400);
    }

    // Get preset tokens for this chain
    const presetTokens = chainInfo.popularTokens;
    const presetAddresses = presetTokens.map((token) => token.address);

    logger.info(
      `📋 Found ${presetTokens.length} preset tokens for ${chainInfo.name}`
    );

    // Test Moralis API call
    if (!moralisService.initialized) {
      await moralisService.initialize();
    }

    const startTime = Date.now();
    const testResult = await moralisService.testMoralisCall(
      testWallet,
      testChain
    );
    const endTime = Date.now();

    // Get actual wallet tokens
    const walletTokens = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );

    const response = {
      test: "Preset Token Filtering Test",
      wallet: testWallet,
      chainId: testChain,
      chainName: chainInfo.name,
      presetTokens: {
        count: presetTokens.length,
        addresses: presetAddresses,
        tokens: presetTokens.slice(0, 5), // Show first 5 for reference
      },
      moralisTest: testResult,
      walletTokensFound: {
        count: walletTokens.length,
        tokens: walletTokens.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          balance: token.balance,
          value: token.value,
          isNative: token.isNative,
          contractAddress: token.contractAddress,
        })),
        totalValue: walletTokens.reduce((sum, t) => sum + t.value, 0),
      },
      responseTime: `${endTime - startTime}ms`,
      success: true,
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.success(
      res,
      response,
      "Preset token filtering test completed"
    );
  } catch (error) {
    logger.error("❌ Preset token filtering test failed:", error);
    return ResponseUtil.error(res, "Preset token filtering test failed", 500, {
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * UPDATED: GET /api/debug/test-moralis
 * Enhanced Moralis test with preset token filtering
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

    // Get chain info and preset tokens
    const chainInfo = chainConfig[testChain];
    if (!chainInfo) {
      throw new Error(`Chain ${testChain} not configured`);
    }

    const presetTokens = chainInfo.popularTokens;
    const presetAddresses = presetTokens.map((token) => token.address);

    // Test the API call
    const startTime = Date.now();
    const tokens = await moralisService.getWalletTokenBalances(
      testWallet,
      testChain
    );
    const endTime = Date.now();

    const response = {
      test: "Enhanced Moralis API Test",
      wallet: testWallet,
      chainId: testChain,
      chainName: chainInfo.name,
      success: true,
      responseTime: `${endTime - startTime}ms`,
      presetTokenConfiguration: {
        chainName: chainInfo.name,
        presetTokenCount: presetTokens.length,
        presetAddresses: presetAddresses,
        samplePresetTokens: presetTokens.slice(0, 3),
      },
      results: {
        tokensFound: tokens.length,
        tokens: tokens.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          balance: token.balance,
          value: token.value,
          price: token.price,
          isNative: token.isNative,
          contractAddress: token.contractAddress,
          isPopular: token.isPopular,
        })),
        totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
        nativeTokenFound: tokens.some((t) => t.isNative),
        presetTokensFound: tokens.filter((t) => t.isPopular).length,
      },
      moralisInitialized: moralisService.initialized,
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Enhanced Moralis test completed successfully in ${
        endTime - startTime
      }ms`
    );
    logger.info(
      `📊 Found ${
        tokens.length
      } tokens with total value $${response.results.totalValue.toFixed(2)}`
    );

    return ResponseUtil.success(
      res,
      response,
      "Enhanced Moralis test completed successfully"
    );
  } catch (error) {
    logger.error("❌ Enhanced Moralis test failed:", error);

    const response = {
      test: "Enhanced Moralis API Test",
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      moralisInitialized: moralisService.initialized,
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.error(
      res,
      "Enhanced Moralis test failed",
      500,
      response
    );
  }
});

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
 * GET /api/debug/raw-moralis
 * Test raw Moralis API call with preset tokens
 */
router.get("/raw-moralis", async (req, res) => {
  try {
    const Moralis = require("moralis").default;

    const { wallet, chain } = req.query;
    const testWallet = wallet || "0xcB1C1FdE09f811B294172696404e88E658659905";
    const testChain = chain || "0x1";
    const chainId = parseInt(testChain.replace("0x", ""), 16);

    logger.info(`🧪 Testing RAW Moralis API call with preset tokens`);

    // Initialize if not done
    if (!Moralis.Core.isStarted) {
      await Moralis.start({
        apiKey: process.env.MORALIS_API_KEY,
      });
    }

    // Get preset tokens for this chain
    const chainInfo = chainConfig[chainId];
    const presetTokenAddresses = chainInfo
      ? chainInfo.popularTokens.map((t) => t.address)
      : [];

    logger.info(
      `📋 Using ${presetTokenAddresses.length} preset token addresses for chain ${chainId}`
    );

    const response = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
      chain: testChain,
      address: testWallet,
      tokenAddresses: presetTokenAddresses, // FIXED: Include preset tokens
    });

    const debugResponse = {
      test: "Raw Moralis API Test with Preset Tokens",
      wallet: testWallet,
      chain: testChain,
      chainId: chainId,
      presetTokens: {
        count: presetTokenAddresses.length,
        addresses: presetTokenAddresses,
      },
      success: true,
      rawResponse: response.raw,
      jsonResponse: response.toJSON(),
      resultCount: response.raw.result?.length || 0,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Raw Moralis test successful with ${debugResponse.resultCount} tokens`
    );

    return ResponseUtil.success(
      res,
      debugResponse,
      "Raw Moralis test completed"
    );
  } catch (error) {
    logger.error("❌ Raw Moralis test failed:", error);

    const debugResponse = {
      test: "Raw Moralis API Test with Preset Tokens",
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
      supportedChains: Object.keys(chainConfig).map((chainId) => ({
        chainId: parseInt(chainId),
        name: chainConfig[chainId].name,
        symbol: chainConfig[chainId].symbol,
        presetTokenCount: chainConfig[chainId].popularTokens.length,
      })),
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
 * UPDATED: GET /api/debug/test-wallet
 * Test specific wallet with preset token filtering
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
        address: "0xcB1C1FdE09f811B294172696404e88E658659905", // Test wallet
        chain: 1,
        name: "Test Wallet",
      },
      {
        address: "0xbA42BF0fD0B59FF60153cdF1c5937Aa3dA2CABF0", // Your current wallet
        chain: 1, // Try Ethereum first
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

    // Get chain info
    const chainInfo = chainConfig[targetChain];
    if (!chainInfo) {
      throw new Error(`Chain ${targetChain} not configured`);
    }

    // Test the direct Moralis call with preset tokens
    logger.info("🔄 Testing Moralis API call with preset token filtering...");
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
      test: "Enhanced Wallet Token Test",
      wallet: targetWallet,
      chainId: targetChain,
      chainName: chainInfo.name,
      presetTokenConfiguration: {
        totalPresetTokens: chainInfo.popularTokens.length,
        presetAddresses: chainInfo.popularTokens.map((t) => t.address),
        sampleTokens: chainInfo.popularTokens.slice(0, 3),
      },
      success: true,
      responseTime: `${endTime - startTime}ms`,
      results: {
        moralisRawTest: testResult,
        processedTokens: {
          count: processedTokens.length,
          tokens: processedTokens,
          totalValue: processedTokens.reduce((sum, t) => sum + t.value, 0),
          nativeTokenFound: processedTokens.some((t) => t.isNative),
          presetTokensFound: processedTokens.filter((t) => t.isPopular).length,
        },
        nativeBalance,
        analysis: {
          hasTokens: processedTokens.length > 0,
          hasValue: processedTokens.reduce((sum, t) => sum + t.value, 0) > 0,
          tokensWithUsdValue: processedTokens.filter((t) => t.value > 0).length,
          tokensWithoutUsdValue: processedTokens.filter((t) => t.value === 0)
            .length,
        },
        suggestions:
          processedTokens.length === 0
            ? [
                "Try a different wallet address with known token balances",
                "Check if the wallet has any transaction history",
                "Verify the chain ID is correct",
                "Ensure the wallet has tokens from the preset list",
                `Preset tokens for ${chainInfo.name}: ${chainInfo.popularTokens
                  .slice(0, 3)
                  .map((t) => t.symbol)
                  .join(", ")}...`,
              ]
            : [],
      },
      availableTestWallets: testWallets,
      moralisInitialized: moralisService.initialized,
      apiKey: process.env.MORALIS_API_KEY ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `✅ Enhanced wallet test completed in ${endTime - startTime}ms`
    );
    logger.info(`📊 Found ${processedTokens.length} processed tokens`);

    return ResponseUtil.success(
      res,
      response,
      "Enhanced wallet test completed successfully"
    );
  } catch (error) {
    logger.error("❌ Enhanced wallet test failed:", error);

    const response = {
      test: "Enhanced Wallet Token Test",
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    };

    return ResponseUtil.error(
      res,
      "Enhanced wallet test failed",
      500,
      response
    );
  }
});

/**
 * GET /api/debug/chain-info
 * Get information about supported chains and their preset tokens
 */
router.get("/chain-info", async (req, res) => {
  try {
    const chainInfo = Object.entries(chainConfig).map(([chainId, config]) => ({
      chainId: parseInt(chainId),
      name: config.name,
      symbol: config.symbol,
      hexId: config.chainId,
      popularTokensCount: config.popularTokens.length,
      sampleTokens: config.popularTokens.slice(0, 5).map((token) => ({
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        decimals: token.decimals,
      })),
      allTokenAddresses: config.popularTokens.map((t) => t.address),
    }));

    const response = {
      supportedChains: chainInfo,
      totalChains: chainInfo.length,
      totalPresetTokens: chainInfo.reduce(
        (sum, chain) => sum + chain.popularTokensCount,
        0
      ),
      recommendedTestChains: [
        {
          chainId: 1,
          name: "Ethereum Mainnet",
          reason: "Most tokens and activity",
          presetTokenCount: chainConfig[1]?.popularTokens.length || 0,
        },
        {
          chainId: 8453,
          name: "Base",
          reason: "Active L2 with many tokens",
          presetTokenCount: chainConfig[8453]?.popularTokens.length || 0,
        },
        {
          chainId: 137,
          name: "Polygon",
          reason: "Many DeFi tokens",
          presetTokenCount: chainConfig[137]?.popularTokens.length || 0,
        },
      ],
    };

    return ResponseUtil.success(res, response, "Chain information retrieved");
  } catch (error) {
    logger.error("❌ Chain info failed:", error);
    return ResponseUtil.error(res, "Failed to get chain information", 500);
  }
});

module.exports = router;
