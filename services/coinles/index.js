// services/coinles/index.js - FIXED VERSION WITH PROPER LOGO HANDLING
const axios = require("axios");
const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

const cache = new NodeCache({
  stdTTL: 30,
  checkperiod: 10,
});

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY || "CG-oTmQJV3kLe92KcQ2753cxy6j";

let apiCallsThisMinute = 0;
let lastMinuteReset = Date.now();

function resetApiCounter() {
  const now = Date.now();
  if (now - lastMinuteReset > 60000) {
    apiCallsThisMinute = 0;
    lastMinuteReset = now;
  }
}

async function makeApiCall(url, params = {}) {
  resetApiCounter();

  if (apiCallsThisMinute >= 28) {
    await new Promise((resolve) =>
      setTimeout(resolve, 60000 - (Date.now() - lastMinuteReset))
    );
    resetApiCounter();
  }

  try {
    apiCallsThisMinute++;
    const response = await axios.get(url, {
      params: params,
      headers: {
        "x-cg-demo-api-key": API_KEY,
      },
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    logger.error("CoinGecko API call failed:", error.message);
    throw error;
  }
}

function formatAddress(address) {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(
    address.length - 4
  )}`;
}

// FIXED: Exact replication of working searchTokens function
async function searchTokens(chain, query) {
  try {
    const cacheKey = `search_${chain}_${query}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("✅ Cache hit for search:", {
        chain,
        query,
        results: cached.length,
      });
      return cached;
    }

    const url = `${COINGECKO_BASE_URL}/onchain/search/pools`;
    console.log("🔍 Searching tokens:", { chain, query, url });

    const data = await makeApiCall(url, {
      query: query,
      network: chain,
      include: "base_token", // IMPORTANT: Include base_token data
    });

    // FIXED: Create a map of token data from included array
    const tokenDataMap = new Map();
    if (data.included && Array.isArray(data.included)) {
      data.included.forEach((item) => {
        if (item.type === "token" && item.attributes) {
          const tokenAddress = item.attributes.address?.toLowerCase() || "";
          const tokenData = {
            name: item.attributes.name,
            symbol: item.attributes.symbol,
            image_url: item.attributes.image_url, // CRITICAL: Get image_url from included data
            decimals: item.attributes.decimals,
          };

          // Store by address
          if (tokenAddress) {
            tokenDataMap.set(tokenAddress, tokenData);
          }

          // Also store by full ID (network_address format)
          if (item.id) {
            tokenDataMap.set(item.id.toLowerCase(), tokenData);
          }
        }
      });
    }

    console.log(`📦 Built token data map with ${tokenDataMap.size} entries`);

    // Group pools by token address to avoid duplicates
    const tokenMap = new Map();

    (data.data || []).forEach((pool) => {
      // Get pool address
      const poolAddress = pool.attributes?.address || "";

      // Get base token address from relationships
      const baseTokenId = pool.relationships?.base_token?.data?.id || "";
      if (!baseTokenId) return;

      // Extract the address part after the network prefix
      const baseTokenAddress = baseTokenId.includes("_")
        ? baseTokenId.split("_")[1]
        : baseTokenId;
      if (!baseTokenAddress) return;

      // Get pool attributes
      const attrs = pool.attributes || {};

      // FIXED: Try multiple lookup strategies for token info
      let tokenInfo =
        tokenDataMap.get(baseTokenId.toLowerCase()) ||
        tokenDataMap.get(baseTokenAddress.toLowerCase()) ||
        {};

      // If token already exists, aggregate data
      if (tokenMap.has(baseTokenAddress)) {
        const existing = tokenMap.get(baseTokenAddress);
        existing.liquidity += parseFloat(attrs.reserve_in_usd) || 0;
        existing.volume24h += parseFloat(attrs.volume_usd?.h24) || 0;
        existing.buys24h += attrs.transactions?.h24?.buys || 0;
        existing.sells24h += attrs.transactions?.h24?.sells || 0;
        existing.poolCount++;

        // Keep the pool with highest liquidity as primary
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
        // Extract token name and symbol
        let tokenName = tokenInfo.name || "";
        let tokenSymbol = tokenInfo.symbol || "";

        // Fallback: parse from pool name if token info not available
        if (!tokenName && attrs.name) {
          const parts = attrs.name.split(" / ");
          if (parts.length > 0) {
            tokenSymbol = parts[0];
            tokenName = parts[0];
          }
        }

        // FIXED: Get image URL - prioritize from tokenInfo (included data)
        let logo =
          tokenInfo.image_url || // Primary source from included data
          attrs.base_token_image_url || // Fallback 1
          attrs.token_image_url || // Fallback 2
          attrs.image_url || // Fallback 3
          "";

        console.log(
          `🖼️ Token logo for ${tokenSymbol}:`,
          logo ? "✅ Found" : "❌ Missing"
        );

        tokenMap.set(baseTokenAddress, {
          poolAddress: poolAddress,
          contractAddress: baseTokenAddress,
          contractAddressDisplay: formatAddress(baseTokenAddress),
          name: tokenName,
          symbol: tokenSymbol,
          price: parseFloat(attrs.base_token_price_usd) || 0,
          logo: logo, // FIXED: Now properly gets logo from included data
          change24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
          liquidity: parseFloat(attrs.reserve_in_usd) || 0,
          volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
          buys24h: attrs.transactions?.h24?.buys || 0,
          sells24h: attrs.transactions?.h24?.sells || 0,
          poolCount: 1,
          primaryLiquidity: parseFloat(attrs.reserve_in_usd) || 0,
        });
      }
    });

    // Convert map to array and sort by liquidity
    const results = Array.from(tokenMap.values())
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

    console.log(`✅ Search complete: Found ${results.length} tokens`);
    console.log(
      `🖼️ Tokens with logos: ${results.filter((t) => t.logo).length}/${
        results.length
      }`
    );

    // Cache the results
    cache.set(cacheKey, results);
    return results;
  } catch (error) {
    logger.error("Token search error:", error);
    console.error("❌ Search failed:", error.message);
    return [];
  }
}

async function getTokenInfo(network, contractAddress, poolAddress) {
  try {
    const tokenUrl = `${COINGECKO_BASE_URL}/onchain/networks/${network}/tokens/${contractAddress}/info`;
    const tokenData = await makeApiCall(tokenUrl);

    let poolData = null;
    if (poolAddress) {
      try {
        const poolUrl = `${COINGECKO_BASE_URL}/onchain/networks/${network}/pools/${poolAddress}`;
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
        logger.error("Failed to get pool data:", poolError.message);
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
      riskLevel = "HONEYPOT DETECTED";
      cautionNotes.push("This token has been flagged as a potential honeypot");
    }

    if (attributes.mint_authority && attributes.mint_authority !== "no") {
      cautionNotes.push("Mint authority is still enabled");
    }

    if (attributes.freeze_authority && attributes.freeze_authority !== "no") {
      cautionNotes.push("Freeze authority is still enabled");
    }

    if (palScore < 30) {
      riskLevel = riskLevel || "Too Risky";
      cautionNotes.push("Very low trust score - exercise extreme caution");
    } else if (palScore < 60) {
      riskLevel = riskLevel || "Moderate Risk";
      cautionNotes.push("Moderate trust score - invest carefully");
    } else if (palScore < 80) {
      riskLevel = riskLevel || "Fine, No Issues";
    } else {
      riskLevel = riskLevel || "Super Bullish";
    }

    return {
      metadata: {
        name: attributes.name,
        symbol: attributes.symbol,
        logo: attributes.image_url, // Token logo from attributes
        description: attributes.description || "",
        websites: attributes.websites || [],
        socials: socials,
        gtScore: gtScore,
        gtScoreDetails: attributes.gt_score_details || {},
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
    logger.error("Failed to get token info:", error.message);
    throw error;
  }
}

async function getOHLCVData(network, poolAddress, timeframe) {
  try {
    const url = `${COINGECKO_BASE_URL}/onchain/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}`;
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
    logger.error("Failed to get OHLCV data:", error.message);
    return [];
  }
}

module.exports = {
  searchTokens,
  getTokenInfo,
  getOHLCVData,
};
