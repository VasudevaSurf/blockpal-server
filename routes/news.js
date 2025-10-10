// blockpal-server/routes/news.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const newsDatabase = require("../lib/newsDatabase");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");

const router = express.Router();

// Rate limiting
const newsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many news requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(newsRateLimit);

/**
 * GET /api/news
 * Get latest news articles with pagination
 */
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20, timeRange = "24h" } = req.query;

    logger.info(
      `Fetching news - page: ${page}, limit: ${limit}, timeRange: ${timeRange}`
    );

    await newsDatabase.connect();

    const result = await newsDatabase.searchNews({
      timeRange,
      limit: parseInt(limit),
      page: parseInt(page),
    });

    const response = {
      news: result.articles,
      page: parseInt(page),
      hasMore: result.hasMore,
      total: result.total,
    };

    return ResponseUtil.success(res, response, "News fetched successfully");
  } catch (error) {
    logger.error("Error fetching news:", error);
    return ResponseUtil.serverError(res, "Failed to fetch news");
  }
});

/**
 * GET /api/news/search
 * Search news articles
 */
router.get("/search", async (req, res) => {
  try {
    const { q, page = 1, limit = 20, timeRange = "24h" } = req.query;

    if (!q) {
      return ResponseUtil.validation(res, "Search query required");
    }

    logger.info(`Searching news for: "${q}"`);

    await newsDatabase.connect();

    const result = await newsDatabase.searchNews({
      searchText: q,
      timeRange,
      limit: parseInt(limit),
      page: parseInt(page),
    });

    const response = {
      news: result.articles,
      query: q,
      page: parseInt(page),
      hasMore: result.hasMore,
      total: result.total,
    };

    return ResponseUtil.success(res, response, "Search completed successfully");
  } catch (error) {
    logger.error("Error searching news:", error);
    return ResponseUtil.serverError(res, "Failed to search news");
  }
});

/**
 * GET /api/news/trending
 * Get trending headlines
 */
router.get("/trending", async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    logger.info(`Fetching trending headlines - limit: ${limit}`);

    await newsDatabase.connect();

    const headlines = await newsDatabase.getTrendingTopics(parseInt(limit));

    const response = {
      headlines: headlines || [],
    };

    return ResponseUtil.success(
      res,
      response,
      "Trending headlines fetched successfully"
    );
  } catch (error) {
    logger.error("Error fetching trending headlines:", error);
    return ResponseUtil.serverError(res, "Failed to fetch trending headlines");
  }
});

/**
 * GET /api/news/health
 * Health check for news service
 */
router.get("/health", async (req, res) => {
  try {
    await newsDatabase.connect();

    const newsCount =
      await newsDatabase.collections.newsArticles.countDocuments();
    const headlinesCount =
      await newsDatabase.collections.trendingHeadlines.countDocuments();

    const health = {
      status: "healthy",
      service: "Crypto News Service",
      database: "connected",
      statistics: {
        totalNews: newsCount,
        totalHeadlines: headlinesCount,
      },
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(health);
  } catch (error) {
    logger.error("News service health check failed:", error);

    return res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
