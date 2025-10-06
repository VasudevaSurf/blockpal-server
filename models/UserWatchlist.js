// models/UserWatchlist.js - COMPLETE UPDATED VERSION
const mongoose = require("mongoose");

const WatchlistTokenSchema = new mongoose.Schema({
  chainId: {
    type: String,
    required: true,
    index: true,
  },
  contractAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  poolAddress: {
    type: String,
    required: true,
  },
  tokenName: {
    type: String,
    required: true,
  },
  tokenSymbol: {
    type: String,
    required: true,
  },
  // Cached market data
  cachedPrice: {
    type: Number,
    default: 0,
  },
  cachedChange24h: {
    type: Number,
    default: 0,
  },
  cachedVolume24h: {
    type: Number,
    default: 0,
  },
  cachedMarketCap: {
    type: Number,
    default: 0,
  },
  cachedLiquidity: {
    type: Number,
    default: 0,
  },
  cachedBuys24h: {
    type: Number,
    default: 0,
  },
  cachedSells24h: {
    type: Number,
    default: 0,
  },
  cachedLogo: {
    type: String,
    default: "",
  },
  lastDataUpdate: {
    type: Date,
    default: Date.now,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  lastViewed: {
    type: Date,
    default: Date.now,
  },
});

const UserWatchlistSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    watchlist: [WatchlistTokenSchema],
    recentSearches: [
      {
        chainId: String,
        query: String,
        results: [
          {
            contractAddress: String,
            name: String,
            symbol: String,
          },
        ],
        searchedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    preferences: {
      defaultChain: {
        type: String,
        default: "eth",
      },
      updateInterval: {
        type: Number,
        default: 30,
      },
      chartDefaultTimeframe: {
        type: String,
        default: "1d",
      },
    },
    stats: {
      totalTokensTracked: {
        type: Number,
        default: 0,
      },
      favoriteTokens: [String],
      lastActive: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: true,
    collection: "userWatchlists",
  }
);

UserWatchlistSchema.index({
  email: 1,
  "watchlist.chainId": 1,
  "watchlist.contractAddress": 1,
});
UserWatchlistSchema.index({ "stats.lastActive": -1 });

const UserWatchlist = mongoose.model("UserWatchlist", UserWatchlistSchema);

module.exports = UserWatchlist;