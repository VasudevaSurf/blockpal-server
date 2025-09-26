// models/SwapTransaction.js - Complete MongoDB Model for Swap Transactions
const mongoose = require("mongoose");

const SwapTransactionSchema = new mongoose.Schema(
  {
    // User Information
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    username: {
      type: String,
      index: true,
      default: "Anonymous",
    },

    // Transaction Details
    txHash: {
      type: String,
      unique: true,
      sparse: true, // Allow null for pending txs
      index: true,
    },

    // Swap Details
    fromToken: {
      address: {
        type: String,
        required: true,
      },
      symbol: {
        type: String,
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      decimals: {
        type: Number,
        required: true,
        default: 18,
      },
      logoUrl: {
        type: String,
        default: null,
      },
    },
    toToken: {
      address: {
        type: String,
        required: true,
      },
      symbol: {
        type: String,
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      decimals: {
        type: Number,
        required: true,
        default: 18,
      },
      logoUrl: {
        type: String,
        default: null,
      },
    },
    fromAmount: {
      type: String,
      required: true,
    },
    toAmount: {
      type: String,
      required: true,
    },
    fromAmountUSD: {
      type: Number,
      default: 0,
    },
    toAmountUSD: {
      type: Number,
      default: 0,
    },

    // Chain Information
    chainId: {
      type: Number,
      required: true,
      index: true,
    },
    chainName: {
      type: String,
      required: true,
    },

    // Transaction Status
    status: {
      type: String,
      enum: ["pending", "success", "failed", "cancelled", "expired"],
      default: "pending",
      index: true,
    },

    // Gas Information
    gasUsed: {
      type: String,
      default: null,
    },
    gasPrice: {
      type: String,
      default: null,
    },
    gasCostETH: {
      type: String,
      default: null,
    },
    gasCostUSD: {
      type: Number,
      default: 0,
    },
    gasMode: {
      type: String,
      enum: ["safe", "medium", "high", "instant"],
      default: "high",
    },

    // Swap Metadata
    slippage: {
      type: Number,
      default: 1,
    },
    route: {
      type: String,
      default: "Direct",
    },
    protocol: {
      type: String,
      default: "1inch",
    },
    priceImpact: {
      type: Number,
      default: 0,
    },

    // Error Information
    errorMessage: {
      type: String,
      default: null,
    },
    errorCode: {
      type: String,
      default: null,
    },

    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },

    // Additional Metadata
    explorerLink: {
      type: String,
      default: null,
    },
    quoteId: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // Automatically manage createdAt and updatedAt
    collection: "swapTransactions", // Explicitly specify collection name in BlockPal database
  }
);

// Compound indexes for efficient querying
SwapTransactionSchema.index({ walletAddress: 1, createdAt: -1 });
SwapTransactionSchema.index({ walletAddress: 1, status: 1, createdAt: -1 });
SwapTransactionSchema.index({ chainId: 1, walletAddress: 1, createdAt: -1 });
SwapTransactionSchema.index({ status: 1, createdAt: -1 });
SwapTransactionSchema.index({ txHash: 1 }, { sparse: true });

// Virtual field for calculating transaction age
SwapTransactionSchema.virtual("age").get(function () {
  return Date.now() - this.createdAt.getTime();
});

// Virtual field for formatted amounts
SwapTransactionSchema.virtual("fromAmountFormatted").get(function () {
  if (!this.fromAmount || !this.fromToken) return "0";
  const amount =
    parseFloat(this.fromAmount) / Math.pow(10, this.fromToken.decimals);
  return amount.toFixed(6);
});

SwapTransactionSchema.virtual("toAmountFormatted").get(function () {
  if (!this.toAmount || !this.toToken) return "0";
  const amount =
    parseFloat(this.toAmount) / Math.pow(10, this.toToken.decimals);
  return amount.toFixed(6);
});

// Instance method to check if transaction is expired
SwapTransactionSchema.methods.isExpired = function () {
  const EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
  return this.status === "pending" && this.age > EXPIRY_TIME;
};

// Instance method to get explorer link
SwapTransactionSchema.methods.getExplorerLink = function () {
  if (!this.txHash) return null;

  const explorers = {
    1: "https://etherscan.io/tx/",
    137: "https://polygonscan.com/tx/",
    56: "https://bscscan.com/tx/",
    43114: "https://snowtrace.io/tx/",
    8453: "https://basescan.org/tx/",
    42161: "https://arbiscan.io/tx/",
  };

  const baseUrl = explorers[this.chainId] || "https://etherscan.io/tx/";
  return `${baseUrl}${this.txHash}`;
};

// Instance method to update status
SwapTransactionSchema.methods.updateStatus = async function (
  status,
  txHash,
  errorMessage
) {
  this.status = status;
  this.updatedAt = new Date();

  if (txHash) {
    this.txHash = txHash;
    this.explorerLink = this.getExplorerLink();
  }

  if (status === "success") {
    this.confirmedAt = new Date();
  } else if (status === "failed" || status === "cancelled") {
    this.failedAt = new Date();
    if (errorMessage) {
      this.errorMessage = errorMessage;
    }
  }

  return this.save();
};

// Static method to find transactions by wallet
SwapTransactionSchema.statics.findByWallet = function (
  walletAddress,
  options = {}
) {
  const query = { walletAddress: walletAddress.toLowerCase() };

  if (options.chainId) {
    query.chainId = options.chainId;
  }

  if (options.status) {
    query.status = options.status;
  }

  if (options.startDate || options.endDate) {
    query.createdAt = {};
    if (options.startDate) {
      query.createdAt.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      query.createdAt.$lte = new Date(options.endDate);
    }
  }

  let queryBuilder = this.find(query);

  // Apply sorting
  queryBuilder = queryBuilder.sort({ createdAt: -1 });

  // Apply pagination
  if (options.limit) {
    queryBuilder = queryBuilder.limit(parseInt(options.limit));
  }

  if (options.offset) {
    queryBuilder = queryBuilder.skip(parseInt(options.offset));
  }

  return queryBuilder.lean();
};

// Static method to get wallet statistics
SwapTransactionSchema.statics.getWalletStats = async function (
  walletAddress,
  options = {}
) {
  const matchQuery = {
    walletAddress: walletAddress.toLowerCase(),
  };

  if (options.chainId) {
    matchQuery.chainId = options.chainId;
  }

  if (options.days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(options.days));
    matchQuery.createdAt = { $gte: startDate };
  }

  const stats = await this.aggregate([
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
        pendingSwaps: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
        totalVolumeUSD: { $sum: "$fromAmountUSD" },
        totalGasUSD: { $sum: "$gasCostUSD" },
        avgGasUSD: { $avg: "$gasCostUSD" },
        uniqueFromTokens: { $addToSet: "$fromToken.symbol" },
        uniqueToTokens: { $addToSet: "$toToken.symbol" },
        chainIds: { $addToSet: "$chainId" },
      },
    },
    {
      $project: {
        _id: 0,
        totalSwaps: 1,
        successfulSwaps: 1,
        failedSwaps: 1,
        pendingSwaps: 1,
        successRate: {
          $cond: [
            { $eq: ["$totalSwaps", 0] },
            0,
            {
              $multiply: [
                { $divide: ["$successfulSwaps", "$totalSwaps"] },
                100,
              ],
            },
          ],
        },
        totalVolumeUSD: { $round: ["$totalVolumeUSD", 2] },
        totalGasUSD: { $round: ["$totalGasUSD", 2] },
        avgGasUSD: { $round: ["$avgGasUSD", 2] },
        uniqueTokensCount: {
          $size: { $setUnion: ["$uniqueFromTokens", "$uniqueToTokens"] },
        },
        uniqueFromTokens: 1,
        uniqueToTokens: 1,
        chainsUsed: "$chainIds",
      },
    },
  ]);

  return (
    stats[0] || {
      totalSwaps: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      pendingSwaps: 0,
      successRate: 0,
      totalVolumeUSD: 0,
      totalGasUSD: 0,
      avgGasUSD: 0,
      uniqueTokensCount: 0,
      uniqueFromTokens: [],
      uniqueToTokens: [],
      chainsUsed: [],
    }
  );
};

// Static method to clean up expired transactions
SwapTransactionSchema.statics.cleanupExpired = async function () {
  const EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
  const cutoffTime = new Date(Date.now() - EXPIRY_TIME);

  const result = await this.updateMany(
    {
      status: "pending",
      createdAt: { $lt: cutoffTime },
    },
    {
      $set: {
        status: "expired",
        updatedAt: new Date(),
        errorMessage: "Transaction expired after 30 minutes",
      },
    }
  );

  return result;
};

// Static method to get database info
SwapTransactionSchema.statics.getDatabaseInfo = async function () {
  try {
    const dbName = this.db.name;
    const collections = await this.db.db.listCollections().toArray();
    const count = await this.countDocuments();

    return {
      database: dbName,
      collection: "swapTransactions",
      documentCount: count,
      collections: collections.map((c) => c.name),
      indexes: await this.collection.getIndexes(),
    };
  } catch (error) {
    console.error("Error getting database info:", error);
    return {
      database: "unknown",
      error: error.message,
    };
  }
};

// Pre-save hook to update timestamps and set explorer link
SwapTransactionSchema.pre("save", function (next) {
  this.updatedAt = new Date();

  if (this.txHash && !this.explorerLink) {
    this.explorerLink = this.getExplorerLink();
  }

  next();
});

// Post-save hook to log creation
SwapTransactionSchema.post("save", function (doc) {
  console.log(`📝 SwapTransaction saved: ${doc._id} - Status: ${doc.status}`);
});

// Create and export the model
const SwapTransaction = mongoose.model(
  "SwapTransaction",
  SwapTransactionSchema
);

// Log database info when model is created (only in development)
if (process.env.NODE_ENV === "development") {
  SwapTransaction.getDatabaseInfo()
    .then((info) => {
      console.log("📊 SwapTransaction Model Database Info:", {
        database: info.database,
        collection: info.collection,
        documents: info.documentCount,
      });
    })
    .catch((err) => {
      console.error("Error getting database info:", err);
    });
}

module.exports = SwapTransaction;
