// routes/swapHistory.js - Complete swap history API routes
const express = require("express");
const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");
const SwapTransaction = require("../models/SwapTransaction");

const router = express.Router();

// Rate limiting
const swapHistoryRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(swapHistoryRateLimit);

/**
 * POST /api/swap-history/create
 * Create new swap transaction record
 */
router.post("/create", async (req, res) => {
  try {
    const {
      walletAddress,
      username,
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      fromAmountUSD,
      toAmountUSD,
      chainId,
      chainName,
      gasPrice,
      gasCostETH,
      gasCostUSD,
      gasMode,
      slippage,
      route,
      protocol,
      priceImpact,
      quoteId,
    } = req.body;

    // Validation
    if (!walletAddress || !fromToken || !toToken || !fromAmount || !chainId) {
      return ResponseUtil.validation(res, "Missing required fields");
    }

    // Get client info
    const userAgent = req.headers["user-agent"] || "";
    const ipAddress = req.headers["x-forwarded-for"] || req.ip;

    // Create swap transaction
    const swapTransaction = new SwapTransaction({
      walletAddress: walletAddress.toLowerCase(),
      username,
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      fromAmountUSD,
      toAmountUSD,
      chainId,
      chainName,
      status: "pending",
      gasPrice,
      gasCostETH,
      gasCostUSD,
      gasMode,
      slippage,
      route,
      protocol,
      priceImpact,
      quoteId,
      userAgent: userAgent.substring(0, 200),
      ipAddress: process.env.NODE_ENV === "development" ? ipAddress : "hidden",
      explorerLink: getExplorerLink(null, chainId),
    });

    await swapTransaction.save();

    logger.info(`✅ Swap transaction created: ${swapTransaction._id}`);

    return ResponseUtil.success(
      res,
      {
        id: swapTransaction._id,
        status: swapTransaction.status,
        createdAt: swapTransaction.createdAt,
      },
      "Swap transaction created successfully"
    );
  } catch (error) {
    logger.error("❌ Error creating swap transaction:", error);
    return ResponseUtil.serverError(res, "Failed to create swap transaction");
  }
});

/**
 * PUT /api/swap-history/update/:id
 * Update swap transaction status
 */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      txHash,
      gasUsed,
      errorMessage,
      errorCode,
      toAmount, // Final amount received
    } = req.body;

    const transaction = await SwapTransaction.findById(id);

    if (!transaction) {
      return ResponseUtil.notFound(res, "Transaction not found");
    }

    // Update fields
    if (status) transaction.status = status;
    if (txHash) {
      transaction.txHash = txHash;
      transaction.explorerLink = getExplorerLink(txHash, transaction.chainId);
    }
    if (gasUsed) transaction.gasUsed = gasUsed;
    if (toAmount) transaction.toAmount = toAmount;

    // Handle status-specific updates
    if (status === "success") {
      transaction.confirmedAt = new Date();
    } else if (status === "failed" || status === "cancelled") {
      transaction.failedAt = new Date();
      if (errorMessage) transaction.errorMessage = errorMessage;
      if (errorCode) transaction.errorCode = errorCode;
    }

    transaction.updatedAt = new Date();
    await transaction.save();

    logger.info(`✅ Swap transaction updated: ${id} - Status: ${status}`);

    return ResponseUtil.success(
      res,
      {
        id: transaction._id,
        status: transaction.status,
        txHash: transaction.txHash,
        explorerLink: transaction.explorerLink,
      },
      "Transaction updated successfully"
    );
  } catch (error) {
    logger.error("❌ Error updating swap transaction:", error);
    return ResponseUtil.serverError(res, "Failed to update transaction");
  }
});

/**
 * GET /api/swap-history/wallet/:address
 * Get swap history for a wallet
 */
router.get("/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const {
      chainId,
      status,
      limit = 50,
      offset = 0,
      startDate,
      endDate,
    } = req.query;

    // Build query
    const query = { walletAddress: address.toLowerCase() };

    if (chainId) query.chainId = parseInt(chainId);
    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Execute query with pagination
    const transactions = await SwapTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get total count for pagination
    const totalCount = await SwapTransaction.countDocuments(query);

    // Check and update expired transactions
    const updatedTransactions = await Promise.all(
      transactions.map(async (tx) => {
        if (tx.status === "pending") {
          const age = Date.now() - new Date(tx.createdAt).getTime();
          if (age > 30 * 60 * 1000) {
            // 30 minutes
            await SwapTransaction.findByIdAndUpdate(tx._id, {
              status: "expired",
              updatedAt: new Date(),
            });
            tx.status = "expired";
          }
        }
        return tx;
      })
    );

    logger.info(
      `✅ Retrieved ${transactions.length} transactions for ${address}`
    );

    return ResponseUtil.success(
      res,
      {
        transactions: updatedTransactions,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: totalCount > parseInt(offset) + parseInt(limit),
        },
      },
      "Swap history retrieved successfully"
    );
  } catch (error) {
    logger.error("❌ Error fetching swap history:", error);
    return ResponseUtil.serverError(res, "Failed to fetch swap history");
  }
});

/**
 * GET /api/swap-history/transaction/:id
 * Get single transaction details
 */
router.get("/transaction/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await SwapTransaction.findById(id).lean();

    if (!transaction) {
      return ResponseUtil.notFound(res, "Transaction not found");
    }

    return ResponseUtil.success(
      res,
      transaction,
      "Transaction retrieved successfully"
    );
  } catch (error) {
    logger.error("❌ Error fetching transaction:", error);
    return ResponseUtil.serverError(res, "Failed to fetch transaction");
  }
});

/**
 * GET /api/swap-history/stats/:address
 * Get swap statistics for a wallet
 */
router.get("/stats/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { chainId, days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const matchQuery = {
      walletAddress: address.toLowerCase(),
      createdAt: { $gte: startDate },
    };

    if (chainId) matchQuery.chainId = parseInt(chainId);

    const stats = await SwapTransaction.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalSwaps: { $sum: 1 },
          successfulSwaps: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          failedSwaps: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          totalVolumeUSD: { $sum: "$fromAmountUSD" },
          totalGasUSD: { $sum: "$gasCostUSD" },
          avgGasUSD: { $avg: "$gasCostUSD" },
          uniqueTokens: { $addToSet: "$fromToken.symbol" },
          mostUsedChain: { $push: "$chainId" },
        },
      },
    ]);

    const result = stats[0] || {
      totalSwaps: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      totalVolumeUSD: 0,
      totalGasUSD: 0,
      avgGasUSD: 0,
      uniqueTokens: [],
    };

    // Calculate success rate
    result.successRate =
      result.totalSwaps > 0
        ? ((result.successfulSwaps / result.totalSwaps) * 100).toFixed(2)
        : 0;

    logger.info(`✅ Retrieved stats for ${address}`);

    return ResponseUtil.success(
      res,
      result,
      "Statistics retrieved successfully"
    );
  } catch (error) {
    logger.error("❌ Error fetching statistics:", error);
    return ResponseUtil.serverError(res, "Failed to fetch statistics");
  }
});

/**
 * DELETE /api/swap-history/cleanup
 * Clean up old expired transactions
 */
router.delete("/cleanup", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await SwapTransaction.deleteMany({
      status: "expired",
      createdAt: { $lt: thirtyDaysAgo },
    });

    logger.info(`🧹 Cleaned up ${result.deletedCount} expired transactions`);

    return ResponseUtil.success(
      res,
      {
        deletedCount: result.deletedCount,
      },
      "Cleanup completed successfully"
    );
  } catch (error) {
    logger.error("❌ Error during cleanup:", error);
    return ResponseUtil.serverError(res, "Failed to cleanup transactions");
  }
});

// Helper function to get explorer link
function getExplorerLink(txHash, chainId) {
  const explorers = {
    1: "https://etherscan.io/tx/",
    137: "https://polygonscan.com/tx/",
    56: "https://bscscan.com/tx/",
    43114: "https://snowtrace.io/tx/",
    8453: "https://basescan.org/tx/",
    42161: "https://arbiscan.io/tx/",
  };

  const baseUrl = explorers[chainId] || "https://etherscan.io/tx/";
  return txHash ? `${baseUrl}${txHash}` : baseUrl;
}

module.exports = router;
