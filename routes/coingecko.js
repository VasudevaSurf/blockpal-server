// routes/coingecko.js - CoinGecko API routes
const express = require("express");
const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const coinGeckoService = require("../services/coingecko");

const router = express.Router();

// Rate limiting for CoinGecko endpoints
const coinGeckoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: "Too many CoinGecko requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(coinGeckoRateLimit);

/**
 * GET /api/coingecko/trending
 * Get trending tokens data for SwapSection
 */
router.get("/trending", async (req, res) => {
  try {
    logger.info("🔥 Fetching trending tokens for SwapSection");

    const data = await coinGeckoService.getTrendingTokens();

    if (data.error) {
      return ResponseUtil.error(
        res,
        "Failed to fetch trending data from CoinGecko",
        503,
        { originalError: data.error }
      );
    }

    const response = {
      success: true,
      data: {
        trendingTokens: data.trendingTokens,
        topGainers: data.topGainers,
        lastUpdated: data.lastUpdated,
        timestamp: data.timestamp,
        count: {
          trending: data.trendingTokens.length,
          gainers: data.topGainers.length,
        },
      },
    };

    logger.info(
      `✅ Successfully returned trending data: ${data.trendingTokens.length} trending, ${data.topGainers.length} gainers`
    );

    return ResponseUtil.success(
      res,
      response.data,
      "Trending tokens fetched successfully"
    );
  } catch (error) {
    logger.error("❌ Error in /coingecko/trending", {
      error: error.message,
      stack: error.stack,
    });

    return ResponseUtil.serverError(res, "Failed to fetch trending tokens");
  }
});

/**
 * GET /api/coingecko/trending-tokens
 * Get only trending tokens (for first container)
 */
router.get("/trending-tokens", async (req, res) => {
  try {
    logger.info("📈 Fetching trending tokens only");

    const data = await coinGeckoService.getTrendingTokens();

    if (data.error) {
      return ResponseUtil.error(
        res,
        "Failed to fetch trending tokens from CoinGecko",
        503,
        { originalError: data.error }
      );
    }

    const response = {
      trendingTokens: data.trendingTokens,
      lastUpdated: data.lastUpdated,
      count: data.trendingTokens.length,
    };

    return ResponseUtil.success(
      res,
      response,
      "Trending tokens fetched successfully"
    );
  } catch (error) {
    logger.error("❌ Error in /coingecko/trending-tokens", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to fetch trending tokens");
  }
});

/**
 * GET /api/coingecko/top-gainers
 * Get only top gainers (for second container)
 */
router.get("/top-gainers", async (req, res) => {
  try {
    logger.info("🚀 Fetching top gainers only");

    const data = await coinGeckoService.getTrendingTokens();

    if (data.error) {
      return ResponseUtil.error(
        res,
        "Failed to fetch top gainers from CoinGecko",
        503,
        { originalError: data.error }
      );
    }

    const response = {
      topGainers: data.topGainers,
      lastUpdated: data.lastUpdated,
      count: data.topGainers.length,
    };

    return ResponseUtil.success(
      res,
      response,
      "Top gainers fetched successfully"
    );
  } catch (error) {
    logger.error("❌ Error in /coingecko/top-gainers", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to fetch top gainers");
  }
});

/**
 * POST /api/coingecko/refresh
 * Refresh CoinGecko cache
 */
router.post("/refresh", async (req, res) => {
  try {
    logger.info("🔄 Refreshing CoinGecko cache");

    coinGeckoService.clearCache();

    return ResponseUtil.success(
      res,
      null,
      "CoinGecko cache cleared successfully"
    );
  } catch (error) {
    logger.error("❌ Error in /coingecko/refresh", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to refresh cache");
  }
});

/**
 * GET /api/coingecko/health
 * Health check for CoinGecko service
 */
router.get("/health", async (req, res) => {
  try {
    const stats = coinGeckoService.getCacheStats();

    const health = {
      status: "healthy",
      service: "CoinGecko Trending Service",
      apiKey: process.env.COINGECKO_API_KEY ? "configured" : "using default",
      cache: stats,
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(health);
  } catch (error) {
    logger.error("❌ Error in CoinGecko health check", {
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
