// routes/coinles.js - CoinLes token tracking routes
const express = require("express");
const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const coinlesService = require("../services/coinles");

const router = express.Router();

const coinlesRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(coinlesRateLimit);

/**
 * GET /api/coinles/search
 * Search tokens on a specific chain
 */
router.get("/search", async (req, res) => {
  try {
    const { chain, query } = req.query;

    if (!chain || !query) {
      return ResponseUtil.validation(
        res,
        "Chain and query parameters are required"
      );
    }

    logger.info(`Searching tokens: chain=${chain}, query=${query}`);

    const results = await coinlesService.searchTokens(chain, query);

    return ResponseUtil.success(
      res,
      { results, count: results.length },
      "Search completed successfully"
    );
  } catch (error) {
    logger.error("Error in /coinles/search", { error: error.message });
    return ResponseUtil.serverError(res, "Failed to search tokens");
  }
});

/**
 * GET /api/coinles/token-info
 * Get detailed token information
 */
router.get("/token-info", async (req, res) => {
  try {
    const { network, contract, pool } = req.query;

    if (!network || !contract) {
      return ResponseUtil.validation(
        res,
        "Network and contract parameters are required"
      );
    }

    logger.info(`Getting token info: network=${network}, contract=${contract}`);

    const tokenInfo = await coinlesService.getTokenInfo(
      network,
      contract,
      pool
    );

    return ResponseUtil.success(
      res,
      tokenInfo,
      "Token info retrieved successfully"
    );
  } catch (error) {
    logger.error("Error in /coinles/token-info", { error: error.message });
    return ResponseUtil.serverError(res, "Failed to get token info");
  }
});

/**
 * GET /api/coinles/chart-data
 * Get OHLCV chart data
 */
router.get("/chart-data", async (req, res) => {
  try {
    const { network, pool, timeframe } = req.query;

    if (!network || !pool || !timeframe) {
      return ResponseUtil.validation(
        res,
        "Network, pool, and timeframe parameters are required"
      );
    }

    logger.info(
      `Getting chart data: network=${network}, pool=${pool}, timeframe=${timeframe}`
    );

    const chartData = await coinlesService.getOHLCVData(
      network,
      pool,
      timeframe
    );

    return ResponseUtil.success(
      res,
      { chartData, count: chartData.length },
      "Chart data retrieved successfully"
    );
  } catch (error) {
    logger.error("Error in /coinles/chart-data", { error: error.message });
    return ResponseUtil.serverError(res, "Failed to get chart data");
  }
});

/**
 * GET /api/coinles/health
 * Health check
 */
router.get("/health", async (req, res) => {
  try {
    const health = {
      status: "healthy",
      service: "CoinLes Token Tracking",
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(health);
  } catch (error) {
    logger.error("Error in /coinles/health", { error: error.message });
    return res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
