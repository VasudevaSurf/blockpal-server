// server.js - FIXED VERSION - USER-SPECIFIC WATCHLIST
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const cron = require("node-cron");
require("dotenv").config();

// Import middleware
const corsMiddleware = require("./middleware/cors");
const errorHandler = require("./middleware/errorHandler");
const { logger } = require("./utils/logger");

// Import services
const walletConnectService = require("./services/wallet-connect");
const moralisService = require("./services/moralis");
const swapHistoryRoutes = require("./routes/swapHistory");
const newsScheduler = require("./services/newsScheduler");
const newsRoutes = require("./routes/news");
const swapRoutes = require("./routes/swap");

// Import CoinLes database functions
const {
  connectDB,
  createOrUpdateUser,
  addTokenToWatchlist,
  removeTokenFromWatchlist,
  getUserWatchlist,
  addRecentSearch,
  upsertTokenCache,
  getActiveTokens,
  addUserToActiveToken,
  removeUserFromActiveToken,
  cleanupInactiveTokens,
  updateStats,
} = require("./lib/coinlesDatabase");

const mongoose = require("mongoose");

// CoinGecko configuration for CoinLes
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY =
  process.env.COINGECKO_API_KEY || "CG-VPV4bwHApXkdum7KgB5AejuJ";

// Chain ID mapping for CoinLes
const CHAIN_ID_MAP = {
  eth: "eth",
  ethereum: "eth",
  polygon: "polygon_pos",
  matic: "polygon_pos",
  bsc: "bsc",
  binance: "bsc",
  arbitrum: "arbitrum",
  arb: "arbitrum",
  avalanche: "avax",
  avax: "avax",
  base: "base",
  solana: "solana",
  sol: "solana",
};

// Active token lists per chain for CoinLes
const activeTokenLists = {
  eth: new Map(),
  base: new Map(),
  polygon: new Map(),
  arbitrum: new Map(),
  avalanche: new Map(),
  bsc: new Map(),
  solana: new Map(),
};

// User sessions for CoinLes
const userSessions = new Map();

// API rate limiting for CoinLes
let apiCallsThisMinute = 0;
let lastMinuteReset = Date.now();

function resetApiCounter() {
  const now = Date.now();
  if (now - lastMinuteReset > 60000) {
    apiCallsThisMinute = 0;
    lastMinuteReset = now;
  }
}

async function makeApiCall(url, params = {}, retries = 2) {
  resetApiCounter();

  if (apiCallsThisMinute >= 28) {
    console.log("⏱️ Rate limit approaching, waiting...");
    await new Promise((resolve) =>
      setTimeout(resolve, 60000 - (Date.now() - lastMinuteReset))
    );
    resetApiCounter();
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      apiCallsThisMinute++;
      const response = await axios.get(url, {
        params: params,
        headers: {
          "x-cg-demo-api-key": COINGECKO_API_KEY,
        },
        timeout: 15000,
      });

      await updateStats({ apiCalls: 1 });
      return response.data;
    } catch (error) {
      const isLastAttempt = attempt === retries + 1;

      if (error.code === "ECONNABORTED" && !isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      } else if (error.response?.status === 429 && !isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else if (error.response?.status === 404) {
        throw error;
      }

      if (isLastAttempt) {
        console.error("API call failed:", error.message);
        await updateStats({ errors: 1 });
        throw error;
      }
    }
  }
}

function getCoinGeckoChainId(chainId) {
  const normalized = chainId.toLowerCase().trim();
  return CHAIN_ID_MAP[normalized] || normalized;
}

function formatAddress(address) {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(
    address.length - 4
  )}`;
}

// CoinLes helper functions
async function searchTokens(chain, query) {
  try {
    const coinGeckoChain = getCoinGeckoChainId(chain);
    const url = `${COINGECKO_BASE_URL}/onchain/search/pools`;

    const data = await makeApiCall(url, {
      query: query,
      network: coinGeckoChain,
      include: "base_token",
    });

    const tokenDataMap = new Map();
    if (data.included) {
      data.included.forEach((item) => {
        if (item.type === "token" && item.attributes) {
          const tokenAddress = item.attributes.address?.toLowerCase() || "";
          const tokenData = {
            name: item.attributes.name,
            symbol: item.attributes.symbol,
            image_url: item.attributes.image_url,
            decimals: item.attributes.decimals,
          };

          if (tokenAddress) {
            tokenDataMap.set(tokenAddress, tokenData);
          }
          if (item.id) {
            tokenDataMap.set(item.id.toLowerCase(), tokenData);
          }
        }
      });
    }

    const tokenMap = new Map();

    (data.data || []).forEach((pool) => {
      try {
        const poolAddress = pool.attributes?.address || "";
        const baseTokenId = pool.relationships?.base_token?.data?.id || "";

        if (!baseTokenId) return;

        // Handle polygon_pos_ADDRESS format correctly
        const baseTokenAddress = baseTokenId.includes("_")
          ? baseTokenId.split("_").slice(-1)[0] // ✅ Get last element (contract address)
          : baseTokenId;

        if (!baseTokenAddress) return;

        const attrs = pool.attributes || {};
        let tokenInfo =
          tokenDataMap.get(baseTokenId.toLowerCase()) ||
          tokenDataMap.get(baseTokenAddress.toLowerCase()) ||
          {};

        if (tokenMap.has(baseTokenAddress)) {
          const existing = tokenMap.get(baseTokenAddress);
          existing.liquidity += parseFloat(attrs.reserve_in_usd) || 0;
          existing.volume24h += parseFloat(attrs.volume_usd?.h24) || 0;
          existing.buys24h += attrs.transactions?.h24?.buys || 0;
          existing.sells24h += attrs.transactions?.h24?.sells || 0;
          existing.poolCount++;

          if (
            (parseFloat(attrs.reserve_in_usd) || 0) > existing.primaryLiquidity
          ) {
            existing.poolAddress = poolAddress;
            existing.primaryLiquidity = parseFloat(attrs.reserve_in_usd) || 0;
            existing.price = parseFloat(attrs.base_token_price_usd) || 0;
            existing.change24h =
              parseFloat(attrs.price_change_percentage?.h24) || 0;
          }
        } else {
          let tokenName = tokenInfo.name || "";
          let tokenSymbol = tokenInfo.symbol || "";

          if (!tokenName && attrs.name) {
            const parts = attrs.name.split(" / ");
            if (parts.length > 0) {
              tokenSymbol = parts[0];
              tokenName = parts[0];
            }
          }

          const logo = tokenInfo.image_url || "";

          if (tokenName && tokenSymbol) {
            tokenMap.set(baseTokenAddress, {
              poolAddress: poolAddress,
              contractAddress: baseTokenAddress,
              contractAddressDisplay: formatAddress(baseTokenAddress),
              name: tokenName,
              symbol: tokenSymbol,
              price: parseFloat(attrs.base_token_price_usd) || 0,
              logo: logo,
              change24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
              liquidity: parseFloat(attrs.reserve_in_usd) || 0,
              volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
              buys24h: attrs.transactions?.h24?.buys || 0,
              sells24h: attrs.transactions?.h24?.sells || 0,
              poolCount: 1,
              primaryLiquidity: parseFloat(attrs.reserve_in_usd) || 0,
            });
          }
        }
      } catch (poolError) {
        // Continue processing other pools
      }
    });

    const queryLower = query.toLowerCase().trim();
    const isAddressQuery =
      queryLower.startsWith("0x") && queryLower.length >= 10;

    let results = Array.from(tokenMap.values()).filter(
      (token) => token.name && token.symbol
    );

    if (isAddressQuery) {
      results = results.filter((token) => {
        const tokenAddress = token.contractAddress.toLowerCase();
        return (
          tokenAddress === queryLower || tokenAddress.startsWith(queryLower)
        );
      });

      results.sort((a, b) => {
        const aAddress = a.contractAddress.toLowerCase();
        const bAddress = b.contractAddress.toLowerCase();

        const aExactMatch = aAddress === queryLower;
        const bExactMatch = bAddress === queryLower;

        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        return b.liquidity - a.liquidity;
      });
    } else {
      results.sort((a, b) => b.liquidity - a.liquidity);
    }

    results = results.slice(0, 10).map((token) => {
      if (token.poolCount > 1) {
        token.displayName = `${token.name} (${token.poolCount} pools)`;
      } else {
        token.displayName = token.name;
      }
      return token;
    });

    console.log(
      `✅ Found ${results.length} tokens (address search: ${isAddressQuery})`
    );
    return results;
  } catch (error) {
    console.error(`Search error for ${chain}:`, error.message);
    return [];
  }
}

async function updateTokensForChain(chainId, isInitialLoad = false) {
  const activeTokens = Array.from(activeTokenLists[chainId].values());
  if (activeTokens.length === 0) return [];

  console.log(`🔄 Updating ${activeTokens.length} tokens for ${chainId}`);

  const allTokenData = [];
  const coinGeckoChain = getCoinGeckoChainId(chainId);

  // Group tokens into batches of 30
  const batches = [];
  for (let i = 0; i < activeTokens.length; i += 30) {
    batches.push(activeTokens.slice(i, i + 30));
  }

  for (const batch of batches) {
    try {
      const addresses = batch.map((t) => t.contractAddress).join(",");
      const url = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoChain}/tokens/multi/${addresses}`;

      const response = await makeApiCall(url, {
        include: "top_pools",
        include_composition: false,
      });

      // Create maps for easy lookup
      const tokensMap = new Map();
      const poolsByTokenMap = new Map();

      // Process token data
      // Process token data
      if (response.data) {
        response.data.forEach((token) => {
          try {
            if (token && token.id) {
              const tokenParts = token.id.split("_");
              const tokenAddress =
                tokenParts.length > 0
                  ? tokenParts[tokenParts.length - 1]
                  : null;

              if (tokenAddress) {
                const lowerAddress = tokenAddress.toLowerCase();
                tokensMap.set(lowerAddress, token);
                poolsByTokenMap.set(lowerAddress, []);
                console.log(
                  `   ├─ Mapped token: ${lowerAddress.substring(
                    0,
                    10
                  )}... for chain ${chainId}`
                );
              } else {
                console.warn(
                  `⚠️ Could not extract token address from: ${token.id}`
                );
              }
            }
          } catch (tokenError) {
            console.error(`❌ Error processing token data:`, {
              error: tokenError.message,
              tokenId: token?.id,
              chainId,
            });
          }
        });

        console.log(
          `   ├─ Token map size: ${tokensMap.size}, Pool map size: ${poolsByTokenMap.size}`
        );
      }

      // Process pool data
      if (response.included) {
        response.included.forEach((item) => {
          try {
            if (item.type === "pool" && item.attributes) {
              const baseTokenId = item.relationships?.base_token?.data?.id;
              if (baseTokenId) {
                const baseTokenParts = baseTokenId.split("_");
                const baseTokenAddress =
                  baseTokenParts.length > 0
                    ? baseTokenParts[baseTokenParts.length - 1]?.toLowerCase()
                    : null;

                if (baseTokenAddress) {
                  if (!poolsByTokenMap) {
                    console.error(
                      `❌ poolsByTokenMap is undefined for chain ${chainId}`
                    );
                  } else if (!poolsByTokenMap.has(baseTokenAddress)) {
                    console.warn(
                      `⚠️ Token ${baseTokenAddress.substring(
                        0,
                        10
                      )}... not found in poolsByTokenMap`
                    );
                  } else {
                    poolsByTokenMap.get(baseTokenAddress).push({
                      ...item,
                      tokenPosition: "base",
                    });
                  }
                }
              }

              const quoteTokenId = item.relationships?.quote_token?.data?.id;
              if (quoteTokenId) {
                const quoteTokenParts = quoteTokenId.split("_");
                const quoteTokenAddress =
                  quoteTokenParts.length > 0
                    ? quoteTokenParts[quoteTokenParts.length - 1]?.toLowerCase()
                    : null;

                if (quoteTokenAddress) {
                  if (!poolsByTokenMap) {
                    console.error(
                      `❌ poolsByTokenMap is undefined for chain ${chainId}`
                    );
                  } else if (!poolsByTokenMap.has(quoteTokenAddress)) {
                    console.warn(
                      `⚠️ Token ${quoteTokenAddress.substring(
                        0,
                        10
                      )}... not found in poolsByTokenMap`
                    );
                  } else {
                    poolsByTokenMap.get(quoteTokenAddress).push({
                      ...item,
                      tokenPosition: "quote",
                    });
                  }
                }
              }
            }
          } catch (poolError) {
            console.error(`❌ Error processing pool data:`, {
              error: poolError.message,
              itemType: item?.type,
              chainId,
            });
          }
        });
      }

      // Process each token with its pools
      for (const activeToken of batch) {
        const contractAddress = activeToken.contractAddress.toLowerCase();
        const tokenData = tokensMap.get(contractAddress);

        if (!tokenData) continue;

        const tokenPools = poolsByTokenMap.get(contractAddress) || [];

        // Aggregate pool data
        let poolData = null;
        if (tokenPools.length > 0) {
          const sortedPools = [...tokenPools].sort((a, b) => {
            const aLiquidity = parseFloat(a.attributes?.reserve_in_usd) || 0;
            const bLiquidity = parseFloat(b.attributes?.reserve_in_usd) || 0;
            return bLiquidity - aLiquidity;
          });

          const primaryPool = sortedPools[0];
          const primaryAttrs = primaryPool.attributes || {};
          const isBaseToken = primaryPool.tokenPosition === "base";

          const price = isBaseToken
            ? parseFloat(primaryAttrs.base_token_price_usd) || 0
            : parseFloat(primaryAttrs.quote_token_price_usd) || 0;

          let totalLiquidity = 0;
          let totalVolume24h = 0;
          let totalBuys24h = 0;
          let totalSells24h = 0;
          let totalBuys6h = 0;
          let totalSells6h = 0;
          let totalBuys1h = 0;
          let totalSells1h = 0;

          tokenPools.forEach((pool) => {
            const attrs = pool.attributes || {};
            totalLiquidity += parseFloat(attrs.reserve_in_usd) || 0;
            totalVolume24h += parseFloat(attrs.volume_usd?.h24) || 0;

            if (attrs.transactions) {
              totalBuys24h += parseInt(attrs.transactions.h24?.buys) || 0;
              totalSells24h += parseInt(attrs.transactions.h24?.sells) || 0;
              totalBuys6h += parseInt(attrs.transactions.h6?.buys) || 0;
              totalSells6h += parseInt(attrs.transactions.h6?.sells) || 0;
              totalBuys1h += parseInt(attrs.transactions.h1?.buys) || 0;
              totalSells1h += parseInt(attrs.transactions.h1?.sells) || 0;
            }
          });

          poolData = {
            price: price,
            priceChange: {
              m5: parseFloat(primaryAttrs.price_change_percentage?.m5) || 0,
              m15: parseFloat(primaryAttrs.price_change_percentage?.m15) || 0,
              m30: parseFloat(primaryAttrs.price_change_percentage?.m30) || 0,
              h1: parseFloat(primaryAttrs.price_change_percentage?.h1) || 0,
              h6: parseFloat(primaryAttrs.price_change_percentage?.h6) || 0,
              h24: parseFloat(primaryAttrs.price_change_percentage?.h24) || 0,
            },
            liquidity: totalLiquidity,
            volume24h: totalVolume24h,
            marketCap: parseFloat(primaryAttrs.market_cap_usd) || 0,
            fdv: parseFloat(primaryAttrs.fdv_usd) || 0,
            transactions: {
              buys24h: totalBuys24h,
              sells24h: totalSells24h,
              buys6h: totalBuys6h,
              sells6h: totalSells6h,
              buys1h: totalBuys1h,
              sells1h: totalSells1h,
            },
          };
        }

        const tokenAttrs = tokenData.attributes || {};

        // Calculate scores
        const gtScore = parseFloat(tokenAttrs.gt_score) || 0;
        const tokenScore = Math.min(
          100,
          ((tokenAttrs.gt_score_details?.info || 0) +
            (tokenAttrs.gt_score_details?.holders || 0)) /
            2
        );
        const poolScore = Math.min(
          100,
          ((tokenAttrs.gt_score_details?.pool || 0) +
            (tokenAttrs.gt_score_details?.transaction || 0) +
            (tokenAttrs.gt_score_details?.creation || 0)) /
            3
        );
        const palScore = (tokenScore + poolScore) / 2;

        let riskLevel = "";
        if (tokenAttrs.is_honeypot) {
          riskLevel = "⚠️ HONEYPOT DETECTED";
        } else if (palScore < 30) {
          riskLevel = "⚠️ Too Risky";
        } else if (palScore < 60) {
          riskLevel = "⚠️ Moderate Risk";
        } else if (palScore < 80) {
          riskLevel = "✓ Fine, No Issues";
        } else {
          riskLevel = "🚀 Super Bullish";
        }

        const marketData = {
          chainId,
          contractAddress: activeToken.contractAddress,
          contractAddressDisplay: formatAddress(activeToken.contractAddress),
          poolAddress: activeToken.poolAddress,
          metadata: {
            name: tokenAttrs.name || "",
            symbol: tokenAttrs.symbol || "",
            logo: tokenAttrs.image_url || "",
            description: tokenAttrs.description || "",
            websites: tokenAttrs.websites || [],
            socials: tokenAttrs.socials || {},
            gtScore: gtScore,
            tokenScore: tokenScore,
            poolScore: poolScore,
            palScore: palScore,
            riskLevel: riskLevel,
            holders: parseFloat(tokenAttrs.total_holders) || 0,
            isHoneypot: tokenAttrs.is_honeypot || false,
            createdAt: tokenAttrs.pool_created_at || null,
          },
          marketData: {
            price: poolData?.price || parseFloat(tokenAttrs.price_usd) || 0,
            change24h: poolData?.priceChange.h24 || 0,
            priceChange: poolData?.priceChange || {
              m5: 0,
              m15: 0,
              m30: 0,
              h1: 0,
              h6: 0,
              h24: 0,
            },
            marketCap: poolData?.marketCap || 0,
            fdv: poolData?.fdv || 0,
            volume24h: poolData?.volume24h || 0,
            liquidity: poolData?.liquidity || 0,
          },
          transactions: {
            buys24h: poolData?.transactions.buys24h || 0,
            sells24h: poolData?.transactions.sells24h || 0,
            buys6h: poolData?.transactions.buys6h || 0,
            sells6h: poolData?.transactions.sells6h || 0,
            buys1h: poolData?.transactions.buys1h || 0,
            sells1h: poolData?.transactions.sells1h || 0,
            netBuys24h:
              (poolData?.transactions.buys24h || 0) -
              (poolData?.transactions.sells24h || 0),
            totalTx24h:
              (poolData?.transactions.buys24h || 0) +
              (poolData?.transactions.sells24h || 0),
          },
          activeUsers: Array.from(activeToken.users),
        };

        if (isInitialLoad) {
          allTokenData.push(marketData);
        }

        await upsertTokenCache(marketData);
        broadcastTokenUpdate(chainId, activeToken.contractAddress, marketData);
      }
    } catch (error) {
      console.error(`Failed to update batch for ${chainId}:`, error.message);
    }
  }

  return allTokenData;
}

// ✅ FIXED: Get initial watchlist data - USER SPECIFIC
// ✅ FIXED: Get initial watchlist data - USER SPECIFIC
async function getInitialWatchlistData(email) {
  console.log(`📋 Loading watchlist for user: ${email}`);

  try {
    // ✅ Get ONLY this user's watchlist from database
    const watchlist = await getUserWatchlist(email);
    console.log(
      `   ├─ Found ${watchlist.length} tokens in database for ${email}`
    );

    const tokensByChain = {};

    // Group tokens by chain
    for (const token of watchlist) {
      if (!tokensByChain[token.chainId]) {
        tokensByChain[token.chainId] = [];
      }
      tokensByChain[token.chainId].push(token);
    }

    const allTokenData = [];

    // Process each chain
    for (const [chainId, tokens] of Object.entries(tokensByChain)) {
      try {
        console.log(
          `   ├─ Processing ${tokens.length} tokens for chain ${chainId}`
        );

        // Add tokens to active tracking
        for (const token of tokens) {
          const tokenKey = `${chainId}_${token.contractAddress}`;
          if (!activeTokenLists[chainId]) {
            console.warn(
              `⚠️ Chain ${chainId} not found in activeTokenLists, initializing...`
            );
            activeTokenLists[chainId] = new Map();
          }

          if (!activeTokenLists[chainId].has(tokenKey)) {
            activeTokenLists[chainId].set(tokenKey, {
              contractAddress: token.contractAddress,
              poolAddress: token.poolAddress,
              users: new Set([email]), // Track this user is watching
            });
          } else {
            activeTokenLists[chainId].get(tokenKey).users.add(email);
          }
        }

        // Get market data for this chain
        const chainData = await updateTokensForChain(chainId, true);

        // ✅ CRITICAL FIX: Filter to only include tokens from THIS user's watchlist
        const userTokenAddresses = new Set(
          tokens.map((t) => t.contractAddress.toLowerCase())
        );

        console.log(
          `   ├─ User ${email} has these tokens on ${chainId}:`,
          Array.from(userTokenAddresses)
            .map((a) => a.substring(0, 10) + "...")
            .join(", ")
        );

        const filteredChainData = chainData.filter((tokenData) => {
          const matches = userTokenAddresses.has(
            tokenData.contractAddress.toLowerCase()
          );
          return matches;
        });

        console.log(
          `   ├─ Filtered ${chainData.length} -> ${filteredChainData.length} tokens for user ${email}`
        );

        if (filteredChainData.length > 0) {
          allTokenData.push(...filteredChainData);
        }
      } catch (chainError) {
        console.error(`❌ Error processing chain ${chainId}:`, {
          error: chainError.message,
          stack: chainError.stack,
          email,
          tokenCount: tokens.length,
        });
        // Continue processing other chains even if one fails
      }
    }

    console.log(`✅ Returning ${allTokenData.length} tokens for user ${email}`);
    return allTokenData;
  } catch (error) {
    console.error(`❌ Critical error in getInitialWatchlistData:`, {
      error: error.message,
      stack: error.stack,
      email,
    });
    return []; // Return empty array on error
  }
}

function broadcastTokenUpdate(chainId, contractAddress, data) {
  const tokenKey = `${chainId}_${contractAddress}`;
  const activeToken = activeTokenLists[chainId].get(tokenKey);

  if (!activeToken) return;

  // Broadcast to ALL users watching this token (this is correct)
  for (const userId of activeToken.users) {
    const session = userSessions.get(userId);
    if (session && session.socket) {
      session.socket.emit("token-update", {
        chainId,
        contractAddress,
        data,
      });
    }
  }
}

// Connect to MongoDB
async function connectMongoDB() {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      "mongodb+srv://greeshmanthedupalli:0hAZ1wIBNxjGkL1v@blockpal-cluster.uldmzku.mongodb.net/BlockPal?retryWrites=true&w=majority&appName=blockpal-cluster";

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      dbName: "BlockPal",
    });

    const dbName = mongoose.connection.db.databaseName;
    logger.info(`MongoDB connected successfully to database: ${dbName}`);

    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    logger.info(
      `Available collections in ${dbName}:`,
      collections.map((c) => c.name)
    );

    const swapTransactionExists = collections.some(
      (c) => c.name === "swapTransactions"
    );
    if (!swapTransactionExists) {
      logger.info("Creating swapTransactions collection...");
      await mongoose.connection.db.createCollection("swapTransactions");
      const swapTransactions =
        mongoose.connection.db.collection("swapTransactions");
      await swapTransactions.createIndex({ walletAddress: 1, createdAt: -1 });
      await swapTransactions.createIndex({ status: 1, createdAt: -1 });
      await swapTransactions.createIndex({
        chainId: 1,
        walletAddress: 1,
        createdAt: -1,
      });
      await swapTransactions.createIndex({ txHash: 1 }, { sparse: true });
      logger.info("swapTransactions collection created with indexes");
    }

    const userWatchlistExists = collections.some(
      (c) => c.name === "userWatchlists"
    );
    if (!userWatchlistExists) {
      logger.info("Creating userWatchlists collection...");
      await mongoose.connection.db.createCollection("userWatchlists");
      logger.info("userWatchlists collection created");
    }

    await connectDB();
  } catch (error) {
    logger.error("MongoDB connection failed:", error);
    logger.warn("Server will continue without database functionality");
  }
}

// Import routes
const tokenRoutes = require("./routes/tokens");
const debugRoutes = require("./routes/debug");
const coinGeckoRoutes = require("./routes/coingecko");
const coinlesRoutes = require("./routes/coinles");
const userWatchlistRoutes = require("./routes/user-watchlist");

const app = express();
const server = http.createServer(app);

// Setup Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://localhost:5173",
      "https://block-pal-new.vercel.app",
      "https://block-pal-main.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Basic middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Security middleware
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");

app.use(helmet());
app.use(compression());
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

app.use(corsMiddleware);

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - Origin: ${req.get("origin")}`);
  next();
});

// Rate limiting
const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const ONEINCH_API_KEY =
  process.env.ONEINCH_API_KEY || "7TD80y4Tuv1jeN0QuUbzUw2NT2N9qTwb";
const ONEINCH_BASE_URL = "https://api.1inch.dev/swap/v6.1";

const SUPPORTED_CHAINS = {
  1: "Ethereum",
  137: "Polygon",
  56: "BSC",
  43114: "Avalanche",
  8453: "Base",
  42161: "Arbitrum",
};

// Health check endpoint
app.get("/health", async (req, res) => {
  console.log("Health check requested");

  try {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        "wallet-connect": "running",
        moralis: moralisService.initialized ? "connected" : "initializing",
        mongodb:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        "mongodb-database":
          mongoose.connection.readyState === 1
            ? mongoose.connection.db.databaseName
            : "N/A",
        cache: "active",
        coingecko: "running",
        swap: "running",
        "swap-history":
          mongoose.connection.readyState === 1 ? "running" : "offline",
        coinles: "running",
        "coinles-websocket": "running",
        "user-watchlist":
          mongoose.connection.readyState === 1 ? "running" : "offline",
        "crypto-news": "running",
        "news-scheduler": newsScheduler.isRunning ? "running" : "stopped",
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      apiKeys: {
        moralis: process.env.MORALIS_API_KEY ? "configured" : "missing",
        coingecko: process.env.COINGECKO_API_KEY
          ? "configured"
          : "using default",
        oneinch: ONEINCH_API_KEY ? "configured" : "missing",
      },
    };

    res.json(health);
  } catch (error) {
    logger.error("Health check error", error);
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Mount routes
app.use("/api/swap-history", swapHistoryRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/wallet", walletConnectService);
app.use("/api/tokens", tokenRoutes);
app.use("/api/coingecko", coinGeckoRoutes);
app.use("/api/coinles", coinlesRoutes);
app.use("/api/user-watchlist", userWatchlistRoutes);
app.use("/api/swap", swapRoutes);

// Swap routes
const swapRouter = express.Router();

swapRouter.get("/gas/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    console.log(`Fetching gas prices for chain ${chainId}`);

    const response = await axios.get(
      `https://api.1inch.dev/gas-price/v1.6/${chainId}`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        timeout: 5000,
      }
    );

    if (response.data) {
      const gasData = {
        low: parseFloat(response.data.low.maxFeePerGas) / 1e9,
        medium: parseFloat(response.data.medium.maxFeePerGas) / 1e9,
        high: parseFloat(response.data.high.maxFeePerGas) / 1e9,
        instant: parseFloat(response.data.instant.maxFeePerGas) / 1e9,
      };

      console.log(`Gas prices for chain ${chainId} (in Gwei):`, gasData);
      res.json({ success: true, data: gasData });
    } else {
      throw new Error("No data from 1inch gas API");
    }
  } catch (error) {
    console.error("Error fetching gas prices:", error.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch gas prices" });
  }
});

swapRouter.get("/price/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    const nativeTokens = {
      1: "ethereum",
      137: "matic-network",
      56: "binancecoin",
      43114: "avalanche-2",
      8453: "ethereum",
      42161: "ethereum",
    };

    const tokenId = nativeTokens[chainId] || "ethereum";

    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`
      );

      const price = response.data[tokenId]?.usd || 0;
      console.log(`Native token price for chain ${chainId}: $${price}`);
      res.json({ success: true, data: { price, symbol: tokenId } });
    } catch (err) {
      const fallbackPrices = {
        1: 3500,
        137: 0.8,
        56: 250,
        43114: 35,
        8453: 3500,
        42161: 3500,
      };

      res.json({
        success: true,
        data: {
          price: fallbackPrices[chainId] || 100,
          symbol: tokenId,
        },
      });
    }
  } catch (error) {
    console.error("Error fetching token price:", error);
    res.json({ success: true, data: { price: 100, symbol: "unknown" } });
  }
});

swapRouter.get("/tokens/:chainId", async (req, res) => {
  const { chainId } = req.params;

  if (!SUPPORTED_CHAINS[chainId]) {
    return res.status(400).json({
      success: false,
      error: "Unsupported chain",
      supportedChains: Object.keys(SUPPORTED_CHAINS),
    });
  }

  try {
    console.log(`Fetching tokens for chain ${chainId}`);

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const tokens = response.data?.tokens || {};
    res.json({
      success: true,
      data: {
        tokens: tokens,
        count: Object.keys(tokens).length,
      },
    });
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    res.json({
      success: false,
      error: "Failed to fetch tokens",
      data: { tokens: {}, count: 0 },
    });
  }
});

app.use("/api/swap", swapRouter);

if (process.env.NODE_ENV === "development") {
  app.use("/api/debug", debugRoutes);
  console.log("Debug routes enabled in development mode");
}

// ✅ FIXED: CoinLes WebSocket handling
io.on("connection", (socket) => {
  const clientId = require("uuid").v4();
  logger.info(`New WebSocket connection: ${clientId}`);

  socket.clientId = clientId;

  // ✅ FIXED: Register event - user specific
  socket.on("register", async (data) => {
    const { email } = data;
    if (!email) {
      console.log("⚠️  Registration attempt without email");
      return;
    }

    try {
      console.log(`\n👤 User registering: ${email}`);
      console.log("═══════════════════════════════════════");

      await createOrUpdateUser(email);

      userSessions.set(email, {
        socket,
        socketId: socket.id,
        email,
        currentPage: "watchlist",
        watchingTokens: new Set(),
        detailToken: null,
      });

      console.log("📋 Loading user's watchlist...");

      let watchlistWithData = [];

      try {
        // ✅ This now returns ONLY this user's tokens
        watchlistWithData = await getInitialWatchlistData(email);
        console.log(
          `   ├─ Successfully loaded ${watchlistWithData.length} tokens`
        );
      } catch (watchlistError) {
        console.error(`❌ Error loading watchlist for ${email}:`, {
          error: watchlistError.message,
          stack: watchlistError.stack,
        });
        // Continue with empty watchlist rather than failing registration
        watchlistWithData = [];
      }

      console.log(
        `   ├─ Sending ${watchlistWithData.length} tokens to user ${email}`
      );

      // Count tokens per chain for logging
      const chainCounts = {};
      for (const token of watchlistWithData) {
        chainCounts[token.chainId] = (chainCounts[token.chainId] || 0) + 1;
      }

      for (const [chain, count] of Object.entries(chainCounts)) {
        console.log(`   ├─ ${chain}: ${count} tokens`);
      }

      // ✅ Send ONLY this user's watchlist
      socket.emit("watchlist", watchlistWithData);

      // Add user to active tracking
      for (const token of watchlistWithData) {
        try {
          await addUserToActiveToken(
            token.chainId,
            token.contractAddress,
            email
          );
        } catch (trackingError) {
          console.error(
            `❌ Error tracking token ${token.contractAddress}:`,
            trackingError.message
          );
        }
      }

      console.log(
        `✅ User ${email} registered successfully with ${watchlistWithData.length} tokens`
      );
      console.log("═══════════════════════════════════════\n");
    } catch (error) {
      console.error("❌ Registration error:", {
        error: error.message,
        stack: error.stack,
        email,
      });
      socket.emit("error", { message: "Failed to register user" });
    }
  });

  socket.on("search", async (data) => {
    const { chain, query, email } = data;
    const results = await searchTokens(chain, query);

    if (email) {
      await addRecentSearch(email, {
        chainId: chain,
        query,
        results: results.slice(0, 3).map((r) => ({
          contractAddress: r.contractAddress,
          name: r.name,
          symbol: r.symbol,
        })),
      });
    }

    socket.emit("search-results", results);
  });

  socket.on("add-token", async (data) => {
    const { email, token } = data;

    try {
      console.log(`➕ User ${email} adding token: ${token.tokenSymbol}`);

      // Add to database
      await addTokenToWatchlist(email, token);

      const tokenKey = `${token.chainId}_${token.contractAddress}`;

      // Add to active tracking
      if (!activeTokenLists[token.chainId].has(tokenKey)) {
        activeTokenLists[token.chainId].set(tokenKey, {
          contractAddress: token.contractAddress,
          poolAddress: token.poolAddress,
          users: new Set([email]),
        });
      } else {
        activeTokenLists[token.chainId].get(tokenKey).users.add(email);
      }

      await addUserToActiveToken(token.chainId, token.contractAddress, email);

      // Get updated market data
      const tokenData = await updateTokensForChain(token.chainId, true);
      const addedTokenData = tokenData?.find(
        (t) => t.contractAddress === token.contractAddress
      );

      console.log(
        `✅ Token ${token.tokenSymbol} added successfully for user ${email}`
      );

      socket.emit("token-added", {
        success: true,
        tokenData: addedTokenData,
      });
    } catch (error) {
      console.error("Failed to add token:", error.message);
      socket.emit("error", { message: "Failed to add token" });
    }
  });

  socket.on("remove-token", async (data) => {
    const { email, chainId, contractAddress } = data;

    console.log(
      `🗑️  User ${email} removing token: ${chainId}/${contractAddress.substring(
        0,
        10
      )}...`
    );

    try {
      await removeTokenFromWatchlist(email, chainId, contractAddress);

      const tokenKey = `${chainId}_${contractAddress}`;
      const activeToken = activeTokenLists[chainId].get(tokenKey);

      if (activeToken) {
        activeToken.users.delete(email);
        console.log(
          `   ├─ User removed from token (${activeToken.users.size} users remaining)`
        );

        if (activeToken.users.size === 0) {
          activeTokenLists[chainId].delete(tokenKey);
          console.log(
            `   └─ ✅ Token removed from active list (no users watching)`
          );
        }

        await removeUserFromActiveToken(chainId, contractAddress, email);
      } else {
        console.log(`   ⚠️  Token not found in active list`);
      }

      socket.emit("token-removed", {
        success: true,
        message: "Token removed successfully",
      });
    } catch (error) {
      console.error("❌ Error removing token:", error.message);
      socket.emit("error", { message: "Failed to remove token" });
    }
  });

  socket.on("disconnect", () => {
    console.log("👋 WebSocket disconnected:", socket.id);

    let disconnectedUserEmail = null;

    for (const [email, session] of userSessions.entries()) {
      if (session.socketId === socket.id) {
        disconnectedUserEmail = email;
        userSessions.delete(email);
        break;
      }
    }

    if (disconnectedUserEmail) {
      console.log(`🧹 Cleaning up tokens for user: ${disconnectedUserEmail}`);

      let totalTokensRemoved = 0;
      let totalUsersRemoved = 0;

      for (const [chainId, tokenMap] of Object.entries(activeTokenLists)) {
        const tokensToDelete = [];

        for (const [tokenKey, tokenData] of tokenMap.entries()) {
          if (tokenData.users.has(disconnectedUserEmail)) {
            tokenData.users.delete(disconnectedUserEmail);
            totalUsersRemoved++;

            console.log(
              `   ├─ Removed user from ${chainId}/${tokenKey.substring(
                0,
                15
              )}... (${tokenData.users.size} users left)`
            );

            if (tokenData.users.size === 0) {
              tokensToDelete.push(tokenKey);
              console.log(
                `   └─ ⚠️  Token has 0 users, will be removed from active list`
              );
            }
          }
        }

        for (const tokenKey of tokensToDelete) {
          tokenMap.delete(tokenKey);
          totalTokensRemoved++;
        }

        if (tokensToDelete.length > 0) {
          console.log(
            `   ✅ Removed ${tokensToDelete.length} inactive tokens from ${chainId}`
          );
        }
      }

      console.log(
        `✅ Cleanup complete: Removed user from ${totalUsersRemoved} tokens, deleted ${totalTokensRemoved} inactive tokens`
      );
    } else {
      console.log("⚠️  Could not identify disconnected user for cleanup");
    }
  });

  socket.emit("connection", {
    type: "connection",
    message: "Connected to Blockpal Services",
    clientId,
    services: [
      "wallet-connect",
      "tokens",
      "moralis",
      "coingecko",
      "swap",
      "swap-history",
      "coinles",
      "coinles-websocket",
      "user-watchlist",
    ],
  });
});

// Scheduled updates - every 30 seconds
cron.schedule("*/30 * * * * *", async () => {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n⏰ Running scheduled updates at ${timestamp}`);
  console.log("═══════════════════════════════════════");

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const chainId of Object.keys(activeTokenLists)) {
    const tokenCount = activeTokenLists[chainId].size;

    if (tokenCount > 0) {
      console.log(`🔄 Updating ${tokenCount} tokens for ${chainId}...`);

      try {
        await updateTokensForChain(chainId);
        totalUpdated += tokenCount;
        console.log(`   ✅ ${chainId} updated successfully`);
      } catch (error) {
        console.error(`   ❌ Failed to update ${chainId}:`, error.message);
      }
    } else {
      totalSkipped++;
      console.log(`⏭️  Skipping ${chainId} (no active tokens)`);
    }
  }

  console.log("───────────────────────────────────────");
  console.log(
    `✅ Update complete: ${totalUpdated} tokens updated, ${totalSkipped} chains skipped`
  );
  console.log("═══════════════════════════════════════\n");
});

// Cleanup inactive tokens every hour
cron.schedule("0 * * * *", async () => {
  console.log("🧹 Cleaning up inactive tokens from database...");
  await cleanupInactiveTokens();
});

// Deep cleanup - runs every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  console.log("\n🔍 Running deep cleanup check...");

  let orphanedUsersFound = 0;
  let tokensCleanedUp = 0;

  const connectedEmails = new Set(
    Array.from(userSessions.values()).map((s) => s.email)
  );

  for (const [chainId, tokenMap] of Object.entries(activeTokenLists)) {
    const tokensToDelete = [];

    for (const [tokenKey, tokenData] of tokenMap.entries()) {
      const disconnectedUsers = [];

      for (const userEmail of tokenData.users) {
        if (!connectedEmails.has(userEmail)) {
          disconnectedUsers.push(userEmail);
          orphanedUsersFound++;
        }
      }

      for (const userEmail of disconnectedUsers) {
        tokenData.users.delete(userEmail);
        console.log(
          `   🧹 Removed orphaned user ${userEmail} from ${chainId}/${tokenKey.substring(
            0,
            15
          )}...`
        );
      }

      if (tokenData.users.size === 0) {
        tokensToDelete.push(tokenKey);
      }
    }

    for (const tokenKey of tokensToDelete) {
      tokenMap.delete(tokenKey);
      tokensCleanedUp++;
    }
  }

  if (orphanedUsersFound > 0 || tokensCleanedUp > 0) {
    console.log(
      `✅ Deep cleanup: Removed ${orphanedUsersFound} orphaned users, ${tokensCleanedUp} empty tokens`
    );
  } else {
    console.log("✅ Deep cleanup: No orphaned data found");
  }
});

// Initialize services
async function initializeServices() {
  try {
    logger.info("Initializing services...");

    await connectMongoDB();

    logger.info("Environment:", {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MORALIS_API_KEY: process.env.MORALIS_API_KEY ? "configured" : "missing",
      COINGECKO_API_KEY: process.env.COINGECKO_API_KEY
        ? "configured"
        : "using default",
      ONEINCH_API_KEY: ONEINCH_API_KEY ? "configured" : "using default",
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
      MONGODB_CONNECTED: mongoose.connection.readyState === 1,
      MONGODB_DATABASE:
        mongoose.connection.readyState === 1
          ? mongoose.connection.db.databaseName
          : "N/A",
    });

    logger.info("Starting Moralis initialization...");
    await moralisService.initialize();
    logger.info("Moralis service initialized");

    logger.info("CoinGecko service ready");
    logger.info("1inch Swap service ready");
    logger.info("CoinLes service ready");
    logger.info("CoinLes WebSocket service ready");

    if (mongoose.connection.readyState === 1) {
      logger.info(
        `Swap history service ready (MongoDB connected to ${mongoose.connection.db.databaseName})`
      );
      logger.info(
        `User watchlist service ready (MongoDB connected to ${mongoose.connection.db.databaseName})`
      );
    } else {
      logger.warn(
        "Swap history and watchlist services may not work properly (MongoDB not connected)"
      );
    }

    logger.info("Starting news ingestion scheduler...");
    await newsScheduler.start();
    logger.info("News scheduler initialized");

    logger.info("All services initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize services", {
      message: error.message,
      stack: error.stack,
    });

    logger.warn("Continuing with partial service initialization");
  }
}

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use("*", (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: {
      health: "GET /health",
      wallet: "POST /api/wallet/*",
      tokens: "GET /api/tokens/*",
      coingecko: "GET /api/coingecko/*",
      swap: "GET /api/swap/*",
      swapHistory: "GET/POST /api/swap-history/*",
      coinles: "GET /api/coinles/*",
      userWatchlist: "GET/POST/DELETE /api/user-watchlist/*",
      ...(process.env.NODE_ENV === "development" && {
        debug: "GET /api/debug/*",
      }),
    },
  });
});

const PORT = process.env.PORT || 5002;

server.listen(PORT, async () => {
  logger.info(`Blockpal Services running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`WebSocket server running on ws://localhost:${PORT}`);
  logger.info(`Wallet Connect API: http://localhost:${PORT}/api/wallet`);
  logger.info(`Token API: http://localhost:${PORT}/api/tokens`);
  logger.info(`CoinGecko API: http://localhost:${PORT}/api/coingecko`);
  logger.info(`Swap API: http://localhost:${PORT}/api/swap`);
  logger.info(`Swap History API: http://localhost:${PORT}/api/swap-history`);
  logger.info(`CoinLes API: http://localhost:${PORT}/api/coinles`);
  logger.info(`CoinLes WebSocket: ws://localhost:${PORT}`);
  logger.info(`Watchlist API: http://localhost:${PORT}/api/user-watchlist`);

  if (process.env.NODE_ENV === "development") {
    logger.info(`Debug API: http://localhost:${PORT}/api/debug`);
  }

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:3002",
  ];
  logger.info(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

  await initializeServices();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  newsScheduler.stop();
  server.close(() => {
    mongoose.connection.close();
    logger.info("Process terminated");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
    logger.info("Process terminated");
    process.exit(0);
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  if (process.env.NODE_ENV === "development") {
    process.exit(1);
  }
});

module.exports = app;
