// services/coinles-websocket/server.js - COMPLETE OPTIMIZED VERSION WITH DISCONNECT CLEANUP
const { Server } = require("socket.io");
const http = require("http");
const axios = require("axios");
const cron = require("node-cron");
require("dotenv").config();

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
} = require("../../lib/coinlesDatabase");

const PORT = process.env.COINLES_WS_PORT || 3001;
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY || "CG-oTmQJV3kLe92KcQ2753cxy6j";

// Create HTTP server
const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
      "http://localhost:3002",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Active token lists per chain
const activeTokenLists = {
  eth: new Map(),
  base: new Map(),
  polygon: new Map(),
  arbitrum: new Map(),
  avalanche: new Map(),
  bsc: new Map(),
};

// CoinGecko network mapping
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
};

// User sessions
const userSessions = new Map();

// Server stats
const serverStats = {
  connectedClients: new Map(),
  tokenUpdates: new Map(),
  lastUpdate: null,
};

// Connection metrics
const connectionMetrics = {
  totalConnections: 0,
  totalDisconnections: 0,
  peakConcurrentUsers: 0,
  startTime: new Date(),
};

// API rate limiting
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
          "x-cg-demo-api-key": API_KEY,
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

// Helper function to log active token statistics
function logActiveTokenStats() {
  console.log("\n📊 Active Token Statistics:");
  console.log("═══════════════════════════════════════");

  let totalTokens = 0;
  let totalUsers = new Set();

  for (const [chainId, tokenMap] of Object.entries(activeTokenLists)) {
    const tokenCount = tokenMap.size;
    totalTokens += tokenCount;

    if (tokenCount > 0) {
      console.log(`   ${chainId.padEnd(10)} │ ${tokenCount} tokens`);

      // Count unique users on this chain
      for (const tokenData of tokenMap.values()) {
        tokenData.users.forEach((user) => totalUsers.add(user));
      }
    }
  }

  console.log("───────────────────────────────────────");
  console.log(`   Total      │ ${totalTokens} tokens`);
  console.log(`   Users      │ ${totalUsers.size} active users`);
  console.log("═══════════════════════════════════════\n");
}

// Search tokens with grouping
async function searchTokens(chain, query) {
  try {
    const coinGeckoChain = getCoinGeckoChainId(chain);
    const url = `${COINGECKO_BASE_URL}/onchain/search/pools`;

    const data = await makeApiCall(url, {
      query,
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

        const baseTokenAddress = baseTokenId.includes("_")
          ? baseTokenId.split("_")[1]
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

    const results = Array.from(tokenMap.values())
      .filter((token) => token.name && token.symbol)
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, 10)
      .map((token) => {
        if (token.poolCount > 1) {
          token.displayName = `${token.name} (${token.poolCount} pools)`;
        } else {
          token.displayName = token.name;
        }
        return token;
      });

    return results;
  } catch (error) {
    console.error(`Search error for ${chain}:`, error.message);
    return [];
  }
}

// BATCH UPDATE TOKENS WITH MULTI-TOKEN ENDPOINT
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
      if (response.data) {
        response.data.forEach((token) => {
          const tokenAddress = token.id.split("_")[1];
          tokensMap.set(tokenAddress.toLowerCase(), token);
          poolsByTokenMap.set(tokenAddress.toLowerCase(), []);
        });
      }

      // Process pool data from included array
      if (response.included) {
        response.included.forEach((item) => {
          if (item.type === "pool" && item.attributes) {
            const baseTokenId = item.relationships?.base_token?.data?.id;
            if (baseTokenId) {
              const baseTokenAddress = baseTokenId.split("_")[1].toLowerCase();
              if (poolsByTokenMap.has(baseTokenAddress)) {
                poolsByTokenMap.get(baseTokenAddress).push(item);
              }
            }
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
          const primaryPool = tokenPools[0];
          const primaryAttrs = primaryPool.attributes || {};

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
            price: parseFloat(primaryAttrs.base_token_price_usd) || 0,
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

// Get initial watchlist data
async function getInitialWatchlistData(email) {
  const watchlist = await getUserWatchlist(email);
  const tokensByChain = {};

  for (const token of watchlist) {
    if (!tokensByChain[token.chainId]) {
      tokensByChain[token.chainId] = [];
    }
    tokensByChain[token.chainId].push(token);
  }

  const allTokenData = [];

  for (const [chainId, tokens] of Object.entries(tokensByChain)) {
    for (const token of tokens) {
      const tokenKey = `${chainId}_${token.contractAddress}`;
      if (!activeTokenLists[chainId].has(tokenKey)) {
        activeTokenLists[chainId].set(tokenKey, {
          contractAddress: token.contractAddress,
          poolAddress: token.poolAddress,
          users: new Set([email]),
        });
      } else {
        activeTokenLists[chainId].get(tokenKey).users.add(email);
      }
    }

    const chainData = await updateTokensForChain(chainId, true);
    if (chainData) {
      allTokenData.push(...chainData);
    }
  }

  return allTokenData;
}

// Get token info for details page
async function getTokenInfo(network, contractAddress, poolAddress) {
  try {
    const coinGeckoNetwork = getCoinGeckoChainId(network);
    const tokenUrl = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoNetwork}/tokens/${contractAddress}/info`;
    const tokenData = await makeApiCall(tokenUrl);

    let poolData = null;
    if (poolAddress) {
      try {
        const poolUrl = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoNetwork}/pools/${poolAddress}`;
        const poolResponse = await makeApiCall(poolUrl);

        if (poolResponse.data && poolResponse.data.attributes) {
          const poolAttrs = poolResponse.data.attributes;
          poolData = {
            price: parseFloat(poolAttrs.base_token_price_usd) || 0,
            priceChange: {
              m5: parseFloat(poolAttrs.price_change_percentage?.m5) || 0,
              m15: parseFloat(poolAttrs.price_change_percentage?.m15) || 0,
              m30: parseFloat(poolAttrs.price_change_percentage?.m30) || 0,
              h1: parseFloat(poolAttrs.price_change_percentage?.h1) || 0,
              h6: parseFloat(poolAttrs.price_change_percentage?.h6) || 0,
              h24: parseFloat(poolAttrs.price_change_percentage?.h24) || 0,
            },
            liquidity: parseFloat(poolAttrs.reserve_in_usd) || 0,
            volume24h: parseFloat(poolAttrs.volume_usd?.h24) || 0,
            marketCap: parseFloat(poolAttrs.market_cap_usd) || 0,
            fdv: parseFloat(poolAttrs.fdv_usd) || 0,
            transactions: {
              buys24h: poolAttrs.transactions?.h24?.buys || 0,
              sells24h: poolAttrs.transactions?.h24?.sells || 0,
              buys6h: poolAttrs.transactions?.h6?.buys || 0,
              sells6h: poolAttrs.transactions?.h6?.sells || 0,
              buys1h: poolAttrs.transactions?.h1?.buys || 0,
              sells1h: poolAttrs.transactions?.h1?.sells || 0,
            },
          };
        }
      } catch (poolError) {
        console.error("Failed to get pool data:", poolError.message);
      }
    }

    if (!tokenData.data) throw new Error("No token data found");

    const attributes = tokenData.data.attributes || {};
    const holders = attributes.holders || {};
    const holderCount = holders.count || 0;
    const holderDistribution = holders.distribution_percentage || {
      top_10: "0",
      "11_30": "0",
      "31_50": "0",
      rest: "0",
    };

    const socials = {};
    if (attributes.twitter_handle) {
      socials.twitter = `https://twitter.com/${attributes.twitter_handle}`;
    }
    if (attributes.telegram_handle) {
      socials.telegram = `https://t.me/${attributes.telegram_handle}`;
    }
    if (attributes.discord_url) {
      socials.discord = attributes.discord_url;
    }

    const gtScore = parseFloat(attributes.gt_score) || 0;
    const tokenScore = Math.min(
      100,
      ((attributes.gt_score_details?.info || 0) +
        (attributes.gt_score_details?.holders || 0)) /
        2
    );
    const poolScore = Math.min(
      100,
      ((attributes.gt_score_details?.pool || 0) +
        (attributes.gt_score_details?.transaction || 0) +
        (attributes.gt_score_details?.creation || 0)) /
        3
    );
    const palScore = (tokenScore + poolScore) / 2;

    let riskLevel = "";
    let cautionNotes = [];

    if (attributes.is_honeypot) {
      riskLevel = "⚠️ HONEYPOT DETECTED";
      cautionNotes.push("This token has been flagged as a potential honeypot");
    }

    if (attributes.mint_authority && attributes.mint_authority !== "no") {
      cautionNotes.push("Mint authority is still enabled");
    }

    if (attributes.freeze_authority && attributes.freeze_authority !== "no") {
      cautionNotes.push("Freeze authority is still enabled");
    }

    if (palScore < 30) {
      riskLevel = riskLevel || "⚠️ Too Risky";
      cautionNotes.push("Very low trust score - exercise extreme caution");
    } else if (palScore < 60) {
      riskLevel = riskLevel || "⚠️ Moderate Risk";
      cautionNotes.push("Moderate trust score - invest carefully");
    } else if (palScore < 80) {
      riskLevel = riskLevel || "✓ Fine, No Issues";
    } else {
      riskLevel = riskLevel || "🚀 Super Bullish";
    }

    return {
      metadata: {
        name: attributes.name,
        symbol: attributes.symbol,
        logo: attributes.image_url,
        description: attributes.description || "",
        websites: attributes.websites || [],
        socials: socials,
        gtScore: gtScore,
        tokenScore: tokenScore,
        poolScore: poolScore,
        palScore: palScore,
        riskLevel: riskLevel,
        cautionNotes: cautionNotes,
        holders: holderCount,
        holderDistribution: holderDistribution,
        createdAt: attributes.pool_created_at || null,
        isHoneypot: attributes.is_honeypot || false,
        mintAuthority: attributes.mint_authority || null,
        freezeAuthority: attributes.freeze_authority || null,
      },
      poolData: poolData,
      marketData: poolData
        ? {
            price: poolData.price,
            change24h: poolData.priceChange.h24,
            priceChange: poolData.priceChange,
            marketCap: poolData.marketCap,
            fdv: poolData.fdv,
            volume24h: poolData.volume24h,
            liquidity: poolData.liquidity,
          }
        : null,
      transactions: poolData
        ? {
            buys24h: poolData.transactions.buys24h,
            sells24h: poolData.transactions.sells24h,
            buys6h: poolData.transactions.buys6h,
            sells6h: poolData.transactions.sells6h,
            buys1h: poolData.transactions.buys1h,
            sells1h: poolData.transactions.sells1h,
            netBuys24h:
              poolData.transactions.buys24h - poolData.transactions.sells24h,
            totalTx24h:
              poolData.transactions.buys24h + poolData.transactions.sells24h,
          }
        : null,
    };
  } catch (error) {
    console.error("Failed to get token info:", error.message);
    throw error;
  }
}

// Get OHLCV data
async function getOHLCVData(network, poolAddress, timeframe) {
  try {
    const coinGeckoNetwork = getCoinGeckoChainId(network);
    const url = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoNetwork}/pools/${poolAddress}/ohlcv/${timeframe}`;
    const data = await makeApiCall(url);

    const chartData = (data.data?.attributes?.ohlcv_list || []).map(
      (candle) => ({
        timestamp: candle[0] * 1000,
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      })
    );

    return chartData;
  } catch (error) {
    console.error("Failed to get OHLCV data:", error.message);
    return [];
  }
}

// Broadcast token update
function broadcastTokenUpdate(chainId, contractAddress, data) {
  const tokenKey = `${chainId}_${contractAddress}`;
  const activeToken = activeTokenLists[chainId].get(tokenKey);

  if (!activeToken) return;

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

// Socket connection handling
io.on("connection", (socket) => {
  connectionMetrics.totalConnections++;
  const currentUsers = serverStats.connectedClients.size + 1;

  if (currentUsers > connectionMetrics.peakConcurrentUsers) {
    connectionMetrics.peakConcurrentUsers = currentUsers;
  }

  console.log(`\n📱 New WebSocket connection`);
  console.log(`   Socket ID: ${socket.id}`);
  console.log(`   Total connections: ${connectionMetrics.totalConnections}`);
  console.log(`   Current users: ${currentUsers}`);
  console.log(`   Peak users: ${connectionMetrics.peakConcurrentUsers}`);

  socket.on("register", async (data) => {
    const { email } = data;
    if (!email) {
      console.log("⚠️  Registration attempt without email");
      return;
    }

    try {
      console.log(`\n👤 User registering: ${email}`);
      console.log("═══════════════════════════════════════");

      // Track connected client
      serverStats.connectedClients.set(email, {
        socketId: socket.id,
        connectedAt: new Date().toISOString(),
      });

      // Create or update user
      await createOrUpdateUser(email);

      // Create session
      userSessions.set(email, {
        socket,
        socketId: socket.id,
        email,
        currentPage: "watchlist",
        watchingTokens: new Set(),
        detailToken: null,
      });

      // Load user's tokens and add to active lists
      console.log("📋 Loading user's watchlist...");
      const watchlistWithData = await getInitialWatchlistData(email);

      console.log(
        `   ├─ Found ${watchlistWithData.length} tokens in watchlist`
      );

      // Count tokens per chain
      const chainCounts = {};
      for (const token of watchlistWithData) {
        chainCounts[token.chainId] = (chainCounts[token.chainId] || 0) + 1;
      }

      for (const [chain, count] of Object.entries(chainCounts)) {
        console.log(`   ├─ ${chain}: ${count} tokens`);
      }

      // Send watchlist to user
      socket.emit("watchlist", watchlistWithData);

      // Add user to active tracking for each token
      for (const token of watchlistWithData) {
        await addUserToActiveToken(token.chainId, token.contractAddress, email);
      }

      console.log(`✅ User registered successfully`);
      console.log("═══════════════════════════════════════\n");

      // Log current stats
      logActiveTokenStats();
    } catch (error) {
      console.error("❌ Registration error:", error.message);
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
      await addTokenToWatchlist(email, token);

      const tokenKey = `${token.chainId}_${token.contractAddress}`;

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

      const tokenData = await updateTokensForChain(token.chainId, true);
      const addedTokenData = tokenData?.find(
        (t) => t.contractAddress === token.contractAddress
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
      // Remove from MongoDB
      await removeTokenFromWatchlist(email, chainId, contractAddress);

      // Remove from active token list
      const tokenKey = `${chainId}_${contractAddress}`;
      const activeToken = activeTokenLists[chainId].get(tokenKey);

      if (activeToken) {
        // Remove user from this token
        activeToken.users.delete(email);
        console.log(
          `   ├─ User removed from token (${activeToken.users.size} users remaining)`
        );

        // If no users left, remove token completely
        if (activeToken.users.size === 0) {
          activeTokenLists[chainId].delete(tokenKey);
          console.log(
            `   └─ ✅ Token removed from active list (no users watching)`
          );
        }

        // Remove from database tracking
        await removeUserFromActiveToken(chainId, contractAddress, email);
      } else {
        console.log(`   ⚠️  Token not found in active list`);
      }

      socket.emit("token-removed", {
        success: true,
        message: "Token removed successfully",
      });

      // Log stats after removal
      logActiveTokenStats();
    } catch (error) {
      console.error("❌ Error removing token:", error.message);
      socket.emit("error", { message: "Failed to remove token" });
    }
  });

  socket.on("get-token-details", async (data) => {
    const { network, contractAddress, poolAddress } = data;

    try {
      const tokenInfo = await getTokenInfo(
        network,
        contractAddress,
        poolAddress
      );
      const ohlcvData = await getOHLCVData(network, poolAddress, "day");

      socket.emit("token-details", {
        info: tokenInfo.metadata,
        chart: ohlcvData,
        marketData: tokenInfo.marketData,
        transactions: tokenInfo.transactions,
        poolData: tokenInfo.poolData,
      });
    } catch (error) {
      console.error("Failed to get token details:", error.message);
      socket.emit("error", { message: "Failed to load token details" });
    }
  });

  socket.on("get-chart-data", async (data) => {
    const { network, poolAddress, timeframe } = data;

    try {
      const chartData = await getOHLCVData(network, poolAddress, timeframe);
      socket.emit("chart-data", chartData);
    } catch (error) {
      socket.emit("error", { message: "Failed to load chart data" });
    }
  });

  socket.on("page-change", (data) => {
    const { email, page, token } = data;
    const session = userSessions.get(email);

    if (session) {
      session.currentPage = page;
      session.detailToken = token || null;
    }
  });

  socket.on("disconnect", () => {
    connectionMetrics.totalDisconnections++;
    console.log("👋 WebSocket disconnected:", socket.id);
    console.log(
      `   Total disconnections: ${connectionMetrics.totalDisconnections}`
    );

    let disconnectedUserEmail = null;

    // Step 1: Find the disconnected user's email
    for (const [email, info] of serverStats.connectedClients.entries()) {
      if (info.socketId === socket.id) {
        disconnectedUserEmail = email;
        serverStats.connectedClients.delete(email);
        console.log(`📧 Found disconnected user: ${email}`);
        break;
      }
    }

    // Step 2: Remove from user sessions
    for (const [email, session] of userSessions.entries()) {
      if (session.socketId === socket.id) {
        if (!disconnectedUserEmail) {
          disconnectedUserEmail = email;
        }
        userSessions.delete(email);
        break;
      }
    }

    // Step 3: Clean up activeTokenLists (THE FIX)
    if (disconnectedUserEmail) {
      console.log(`🧹 Cleaning up tokens for user: ${disconnectedUserEmail}`);

      let totalTokensRemoved = 0;
      let totalUsersRemoved = 0;

      // Loop through all chains
      for (const [chainId, tokenMap] of Object.entries(activeTokenLists)) {
        const tokensToDelete = [];

        // Loop through all tokens in this chain
        for (const [tokenKey, tokenData] of tokenMap.entries()) {
          // Remove user from this token's users Set
          if (tokenData.users.has(disconnectedUserEmail)) {
            tokenData.users.delete(disconnectedUserEmail);
            totalUsersRemoved++;

            console.log(
              `   ├─ Removed user from ${chainId}/${tokenKey.substring(
                0,
                15
              )}... (${tokenData.users.size} users left)`
            );

            // If no users left watching this token, mark for deletion
            if (tokenData.users.size === 0) {
              tokensToDelete.push(tokenKey);
              console.log(
                `   └─ ⚠️  Token has 0 users, will be removed from active list`
              );
            }
          }
        }

        // Delete tokens with no users
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

      // Log current active token counts
      logActiveTokenStats();
    } else {
      console.log("⚠️  Could not identify disconnected user for cleanup");
    }
  });
});

// Update all active tokens every 30 seconds
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
// Catches any orphaned users that might have been missed
cron.schedule("*/5 * * * *", async () => {
  console.log("\n🔍 Running deep cleanup check...");

  let orphanedUsersFound = 0;
  let tokensCleanedUp = 0;

  // Get list of currently connected users
  const connectedEmails = new Set(serverStats.connectedClients.keys());

  // Check all chains
  for (const [chainId, tokenMap] of Object.entries(activeTokenLists)) {
    const tokensToDelete = [];

    for (const [tokenKey, tokenData] of tokenMap.entries()) {
      // Check each user in this token
      const disconnectedUsers = [];

      for (const userEmail of tokenData.users) {
        if (!connectedEmails.has(userEmail)) {
          disconnectedUsers.push(userEmail);
          orphanedUsersFound++;
        }
      }

      // Remove disconnected users
      for (const userEmail of disconnectedUsers) {
        tokenData.users.delete(userEmail);
        console.log(
          `   🧹 Removed orphaned user ${userEmail} from ${chainId}/${tokenKey.substring(
            0,
            15
          )}...`
        );
      }

      // If no users left, mark for deletion
      if (tokenData.users.size === 0) {
        tokensToDelete.push(tokenKey);
      }
    }

    // Delete empty tokens
    for (const tokenKey of tokensToDelete) {
      tokenMap.delete(tokenKey);
      tokensCleanedUp++;
    }
  }

  if (orphanedUsersFound > 0 || tokensCleanedUp > 0) {
    console.log(
      `✅ Deep cleanup: Removed ${orphanedUsersFound} orphaned users, ${tokensCleanedUp} empty tokens`
    );
    logActiveTokenStats();
  } else {
    console.log("✅ Deep cleanup: No orphaned data found");
  }
});

// Health check endpoint with detailed stats
server.on("request", (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    const uptime = Math.floor(
      (Date.now() - connectionMetrics.startTime.getTime()) / 1000
    );

    const stats = {
      status: "healthy",
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor(
        (uptime % 3600) / 60
      )}m ${uptime % 60}s`,
      connections: {
        total: connectionMetrics.totalConnections,
        disconnections: connectionMetrics.totalDisconnections,
        current: serverStats.connectedClients.size,
        peak: connectionMetrics.peakConcurrentUsers,
      },
      tokens: {
        eth: activeTokenLists.eth.size,
        base: activeTokenLists.base.size,
        polygon: activeTokenLists.polygon.size,
        arbitrum: activeTokenLists.arbitrum.size,
        avalanche: activeTokenLists.avalanche.size,
        bsc: activeTokenLists.bsc.size,
        total: Object.values(activeTokenLists).reduce(
          (sum, map) => sum + map.size,
          0
        ),
      },
      apiCalls: {
        thisMinute: apiCallsThisMinute,
        minuteResetIn:
          Math.ceil((60000 - (Date.now() - lastMinuteReset)) / 1000) + "s",
      },
      memory: {
        used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      },
      timestamp: new Date().toISOString(),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats, null, 2));
  }
});

// Start server
async function startServer() {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log("=====================================");
      console.log("🚀 COINLES WEBSOCKET SERVER");
      console.log("=====================================");
      console.log(`📡 Port: ${PORT}`);
      console.log(`⏰ Updates: Every 30 seconds`);
      console.log(`🧹 Cleanup: Every 5 minutes`);
      console.log(`🔗 CORS Origins: ${process.env.ALLOWED_ORIGINS}`);
      console.log(`📊 Health Check: http://localhost:${PORT}/health`);
      console.log("=====================================\n");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
