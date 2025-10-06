// routes/user-watchlist.js - COMPLETE UPDATED VERSION
const express = require("express");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const UserWatchlist = require("../models/UserWatchlist");
const coinlesService = require("../services/coinles");

const router = express.Router();

/**
 * GET /api/user-watchlist/:email
 * Get user's watchlist with enriched market data
 */
router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { refresh } = req.query; // Optional refresh parameter

    let userWatchlist = await UserWatchlist.findOne({
      email: email.toLowerCase(),
    });

    if (!userWatchlist) {
      userWatchlist = await UserWatchlist.create({
        email: email.toLowerCase(),
        watchlist: [],
        recentSearches: [],
      });
    }

    // Check if we should refresh data (if refresh=true or data is older than 5 minutes)
    const shouldRefresh =
      refresh === "true" ||
      userWatchlist.watchlist.some((token) => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        return !token.lastDataUpdate || token.lastDataUpdate < fiveMinutesAgo;
      });

    let enrichedWatchlist = [];

    if (shouldRefresh && userWatchlist.watchlist.length > 0) {
      logger.info(
        `Refreshing market data for ${userWatchlist.watchlist.length} tokens`
      );

      enrichedWatchlist = await Promise.all(
        userWatchlist.watchlist.map(async (item) => {
          try {
            const tokenInfo = await coinlesService.getTokenInfo(
              item.chainId,
              item.contractAddress,
              item.poolAddress
            );

            if (tokenInfo) {
              // Update cached data in database
              const updatedToken = {
                ...item.toObject(),
                cachedPrice:
                  tokenInfo.marketData?.price || item.cachedPrice || 0,
                cachedChange24h:
                  tokenInfo.marketData?.change24h || item.cachedChange24h || 0,
                cachedVolume24h:
                  tokenInfo.marketData?.volume24h || item.cachedVolume24h || 0,
                cachedMarketCap:
                  tokenInfo.marketData?.marketCap || item.cachedMarketCap || 0,
                cachedLiquidity:
                  tokenInfo.marketData?.liquidity || item.cachedLiquidity || 0,
                cachedBuys24h:
                  tokenInfo.transactions?.buys24h || item.cachedBuys24h || 0,
                cachedSells24h:
                  tokenInfo.transactions?.sells24h || item.cachedSells24h || 0,
                cachedLogo: tokenInfo.metadata?.logo || item.cachedLogo || "",
                lastDataUpdate: new Date(),
                marketData: tokenInfo.marketData,
                transactions: tokenInfo.transactions,
                metadata: tokenInfo.metadata,
              };

              // Update in database
              await UserWatchlist.findOneAndUpdate(
                {
                  email: email.toLowerCase(),
                  "watchlist.contractAddress": item.contractAddress,
                  "watchlist.chainId": item.chainId,
                },
                {
                  $set: {
                    "watchlist.$.cachedPrice": updatedToken.cachedPrice,
                    "watchlist.$.cachedChange24h": updatedToken.cachedChange24h,
                    "watchlist.$.cachedVolume24h": updatedToken.cachedVolume24h,
                    "watchlist.$.cachedMarketCap": updatedToken.cachedMarketCap,
                    "watchlist.$.cachedLiquidity": updatedToken.cachedLiquidity,
                    "watchlist.$.cachedBuys24h": updatedToken.cachedBuys24h,
                    "watchlist.$.cachedSells24h": updatedToken.cachedSells24h,
                    "watchlist.$.cachedLogo": updatedToken.cachedLogo,
                    "watchlist.$.lastDataUpdate": updatedToken.lastDataUpdate,
                  },
                }
              );

              return updatedToken;
            }

            // Return cached data if fetch fails
            return {
              ...item.toObject(),
              marketData: {
                price: item.cachedPrice,
                change24h: item.cachedChange24h,
                volume24h: item.cachedVolume24h,
                marketCap: item.cachedMarketCap,
                liquidity: item.cachedLiquidity,
              },
              transactions: {
                buys24h: item.cachedBuys24h,
                sells24h: item.cachedSells24h,
              },
              metadata: {
                logo: item.cachedLogo,
              },
            };
          } catch (error) {
            logger.error(
              `Failed to fetch data for ${item.contractAddress}:`,
              error.message
            );

            // Return cached data
            return {
              ...item.toObject(),
              marketData: {
                price: item.cachedPrice,
                change24h: item.cachedChange24h,
                volume24h: item.cachedVolume24h,
                marketCap: item.cachedMarketCap,
                liquidity: item.cachedLiquidity,
              },
              transactions: {
                buys24h: item.cachedBuys24h,
                sells24h: item.cachedSells24h,
              },
              metadata: {
                logo: item.cachedLogo,
              },
            };
          }
        })
      );
    } else {
      // Return cached data without refresh
      enrichedWatchlist = userWatchlist.watchlist.map((item) => ({
        ...item.toObject(),
        marketData: {
          price: item.cachedPrice,
          change24h: item.cachedChange24h,
          volume24h: item.cachedVolume24h,
          marketCap: item.cachedMarketCap,
          liquidity: item.cachedLiquidity,
        },
        transactions: {
          buys24h: item.cachedBuys24h,
          sells24h: item.cachedSells24h,
        },
        metadata: {
          logo: item.cachedLogo,
        },
      }));
    }

    return ResponseUtil.success(
      res,
      {
        watchlist: enrichedWatchlist,
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
 * Add token to watchlist with market data caching
 */
router.post("/:email/add-token", async (req, res) => {
  try {
    const { email } = req.params;
    const token = req.body;

    if (!token.chainId || !token.contractAddress || !token.poolAddress) {
      return ResponseUtil.validation(res, "Missing required token fields");
    }

    // Fetch current market data
    let cachedData = {
      cachedPrice: 0,
      cachedChange24h: 0,
      cachedVolume24h: 0,
      cachedMarketCap: 0,
      cachedLiquidity: 0,
      cachedBuys24h: 0,
      cachedSells24h: 0,
      cachedLogo: "",
      lastDataUpdate: new Date(),
    };

    try {
      logger.info(`Fetching market data for ${token.tokenSymbol}`);

      const tokenInfo = await coinlesService.getTokenInfo(
        token.chainId,
        token.contractAddress,
        token.poolAddress
      );

      if (tokenInfo) {
        cachedData = {
          cachedPrice: tokenInfo.marketData?.price || 0,
          cachedChange24h: tokenInfo.marketData?.change24h || 0,
          cachedVolume24h: tokenInfo.marketData?.volume24h || 0,
          cachedMarketCap: tokenInfo.marketData?.marketCap || 0,
          cachedLiquidity: tokenInfo.marketData?.liquidity || 0,
          cachedBuys24h: tokenInfo.transactions?.buys24h || 0,
          cachedSells24h: tokenInfo.transactions?.sells24h || 0,
          cachedLogo: tokenInfo.metadata?.logo || "",
          lastDataUpdate: new Date(),
        };

        logger.info(
          `Market data fetched for ${token.tokenSymbol}: $${cachedData.cachedPrice}`
        );
      }
    } catch (error) {
      logger.error("Failed to fetch token data for caching:", error.message);
    }

    const userWatchlist = await UserWatchlist.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $addToSet: {
          watchlist: {
            ...token,
            ...cachedData,
            addedAt: new Date(),
            lastViewed: new Date(),
          },
        },
        $inc: { "stats.totalTokensTracked": 1 },
        $set: { "stats.lastActive": new Date() },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Return the added token with market data
    const addedToken = userWatchlist.watchlist.find(
      (t) =>
        t.chainId === token.chainId &&
        t.contractAddress.toLowerCase() === token.contractAddress.toLowerCase()
    );

    return ResponseUtil.success(
      res,
      {
        watchlist: userWatchlist.watchlist,
        addedToken: {
          ...addedToken.toObject(),
          marketData: {
            price: addedToken.cachedPrice,
            change24h: addedToken.cachedChange24h,
            volume24h: addedToken.cachedVolume24h,
            marketCap: addedToken.cachedMarketCap,
            liquidity: addedToken.cachedLiquidity,
          },
          transactions: {
            buys24h: addedToken.cachedBuys24h,
            sells24h: addedToken.cachedSells24h,
          },
        },
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
            $slice: 10,
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

/**
 * POST /api/user-watchlist/:email/refresh
 * Force refresh all tokens in watchlist
 */
router.post("/:email/refresh", async (req, res) => {
  try {
    const { email } = req.params;

    const userWatchlist = await UserWatchlist.findOne({
      email: email.toLowerCase(),
    });

    if (!userWatchlist || userWatchlist.watchlist.length === 0) {
      return ResponseUtil.success(
        res,
        { refreshed: 0 },
        "No tokens to refresh"
      );
    }

    logger.info(`Force refreshing ${userWatchlist.watchlist.length} tokens`);

    let refreshedCount = 0;

    for (const item of userWatchlist.watchlist) {
      try {
        const tokenInfo = await coinlesService.getTokenInfo(
          item.chainId,
          item.contractAddress,
          item.poolAddress
        );

        if (tokenInfo) {
          await UserWatchlist.findOneAndUpdate(
            {
              email: email.toLowerCase(),
              "watchlist.contractAddress": item.contractAddress,
              "watchlist.chainId": item.chainId,
            },
            {
              $set: {
                "watchlist.$.cachedPrice": tokenInfo.marketData?.price || 0,
                "watchlist.$.cachedChange24h":
                  tokenInfo.marketData?.change24h || 0,
                "watchlist.$.cachedVolume24h":
                  tokenInfo.marketData?.volume24h || 0,
                "watchlist.$.cachedMarketCap":
                  tokenInfo.marketData?.marketCap || 0,
                "watchlist.$.cachedLiquidity":
                  tokenInfo.marketData?.liquidity || 0,
                "watchlist.$.cachedBuys24h":
                  tokenInfo.transactions?.buys24h || 0,
                "watchlist.$.cachedSells24h":
                  tokenInfo.transactions?.sells24h || 0,
                "watchlist.$.cachedLogo": tokenInfo.metadata?.logo || "",
                "watchlist.$.lastDataUpdate": new Date(),
              },
            }
          );
          refreshedCount++;
        }
      } catch (error) {
        logger.error(`Failed to refresh ${item.tokenSymbol}:`, error.message);
      }
    }

    return ResponseUtil.success(
      res,
      { refreshed: refreshedCount, total: userWatchlist.watchlist.length },
      `Refreshed ${refreshedCount} tokens`
    );
  } catch (error) {
    logger.error("Error refreshing watchlist", {
      email: req.params.email,
      error: error.message,
    });
    return ResponseUtil.serverError(res, "Failed to refresh watchlist");
  }
});

module.exports = router;
