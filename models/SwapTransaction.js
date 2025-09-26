// models/SwapTransaction.js
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
      address: String,
      symbol: String,
      name: String,
      decimals: Number,
      logoUrl: String,
    },
    toToken: {
      address: String,
      symbol: String,
      name: String,
      decimals: Number,
      logoUrl: String,
    },
    fromAmount: String,
    toAmount: String,
    fromAmountUSD: Number,
    toAmountUSD: Number,

    // Chain Information
    chainId: {
      type: Number,
      required: true,
      index: true,
    },
    chainName: String,

    // Transaction Status
    status: {
      type: String,
      enum: ["pending", "success", "failed", "cancelled", "expired"],
      default: "pending",
      index: true,
    },

    // Gas Information
    gasUsed: String,
    gasPrice: String,
    gasCostETH: String,
    gasCostUSD: Number,
    gasMode: {
      type: String,
      enum: ["safe", "medium", "high", "instant"],
    },

    // Swap Metadata
    slippage: Number,
    route: String,
    protocol: String,
    priceImpact: Number,

    // Error Information
    errorMessage: String,
    errorCode: String,

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
    confirmedAt: Date,
    failedAt: Date,

    // Additional Metadata
    explorerLink: String,
    quoteId: String,
    userAgent: String,
    ipAddress: String,
  },
  {
    timestamps: true,
    collection: "swapTransactions",
  }
);

// Indexes for efficient querying
SwapTransactionSchema.index({ walletAddress: 1, createdAt: -1 });
SwapTransactionSchema.index({ status: 1, createdAt: -1 });
SwapTransactionSchema.index({ chainId: 1, walletAddress: 1, createdAt: -1 });

// Virtual for age calculation
SwapTransactionSchema.virtual("age").get(function () {
  return Date.now() - this.createdAt;
});

// Method to check if transaction is expired
SwapTransactionSchema.methods.isExpired = function () {
  const EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
  return this.status === "pending" && this.age > EXPIRY_TIME;
};

module.exports = mongoose.model("SwapTransaction", SwapTransactionSchema);
