// routes/user-watchlist.js - User watchlist management
const express = require("express");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const UserWatchlist = require("../models/UserWatchlist");

const router = express.Router();

/**
 * GET /api/user-watchlist/:email
 * Get user's watchlist
 */
router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;

    let userWatchlist = await UserWatchlist.findOne({
      email: email.toLowerCase(),
    });

    if (!userWatchlist) {
      // Create new watchlist for user
      userWatchlist = await UserWatchlist.create({
        email: email.toLowerCase(),
        watchlist: [],
        recentSearches: [],
      });
    }

    return ResponseUtil.success(
      res,
      {
        watchlist: userWatchlist.watchlist || [],
        recentSearches: userWatchlist.recentSearches || [],
        preferences: userWatchlist.preferences,
        stats: userWatchlist.stats,
      },
      "Watchlist retrieved successfully"
    );
  } catch (error) {
    logger.error("Error getting watchlist", {
      email: req.params.email,
      error: error.message,
    });
    return ResponseUtil.serverError(res, "Failed to get watchlist");
  }
});

/**
 * POST /api/user-watchlist/:email/add-token
 * Add token to watchlist
 */
router.post("/:email/add-token", async (req, res) => {
  try {
    const { email } = req.params;
    const token = req.body;

    if (!token.chainId || !token.contractAddress || !token.poolAddress) {
      return ResponseUtil.validation(res, "Missing required token fields");
    }

    const userWatchlist = await UserWatchlist.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $addToSet: {
          watchlist: {
            ...token,
            addedAt: new Date(),
            lastViewed: new Date(),
          },
        },
        $inc: { "stats.totalTokensTracked": 1 },
        $set: { "stats.lastActive": new Date() },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return ResponseUtil.success(
      res,
      {
        watchlist: userWatchlist.watchlist,
        addedToken: token,
      },
      "Token added to watchlist"
    );
  } catch (error) {
    logger.error("Error adding token to watchlist", {
      email: req.params.email,
      error: error.message,
    });
    return ResponseUtil.serverError(res, "Failed to add token to watchlist");
  }
});

/**
 * DELETE /api/user-watchlist/:email/remove-token
 * Remove token from watchlist
 */
router.delete("/:email/remove-token", async (req, res) => {
  try {
    const { email } = req.params;
    const { chainId, contractAddress } = req.query;

    if (!chainId || !contractAddress) {
      return ResponseUtil.validation(res, "Missing chainId or contractAddress");
    }

    const userWatchlist = await UserWatchlist.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $pull: {
          watchlist: {
            chainId,
            contractAddress: contractAddress.toLowerCase(),
          },
        },
        $inc: { "stats.totalTokensTracked": -1 },
        $set: { "stats.lastActive": new Date() },
      },
      { new: true }
    );

    return ResponseUtil.success(
      res,
      {
        watchlist: userWatchlist?.watchlist || [],
      },
      "Token removed from watchlist"
    );
  } catch (error) {
    logger.error("Error removing token from watchlist", {
      email: req.params.email,
      error: error.message,
    });
    return ResponseUtil.serverError(
      res,
      "Failed to remove token from watchlist"
    );
  }
});

/**
 * POST /api/user-watchlist/:email/add-search
 * Add recent search
 */
router.post("/:email/add-search", async (req, res) => {
  try {
    const { email } = req.params;
    const search = req.body;

    await UserWatchlist.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $push: {
          recentSearches: {
            $each: [
              {
                ...search,
                searchedAt: new Date(),
              },
            ],
            $position: 0,
            $slice: 10, // Keep only last 10 searches
          },
        },
        $set: { "stats.lastActive": new Date() },
      },
      { upsert: true }
    );

    return ResponseUtil.success(res, null, "Search added to history");
  } catch (error) {
    logger.error("Error adding search to history", {
      email: req.params.email,
      error: error.message,
    });
    return ResponseUtil.serverError(res, "Failed to add search to history");
  }
});

module.exports = router;
