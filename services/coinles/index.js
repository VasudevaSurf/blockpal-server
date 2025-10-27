// services/coinles/index.js - WITH CORRECT COINGECKO NETWORK IDS
const axios = require("axios");
const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

const cache = new NodeCache({
  stdTTL: 30,
  checkperiod: 10,
});

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY || "CG-VPV4bwHApXkdum7KgB5AejuJ";

console.log("🔑 CoinGecko API initialized");

// CRITICAL: CoinGecko onchain API network identifiers
// Based on actual CoinGecko API documentation
// Reference: https://docs.coingecko.com/reference/onchain-networks-list
const CHAIN_ID_MAP = {
  // Ethereum
  eth: "eth",
  ethereum: "eth",

  // Polygon - IMPORTANT: CoinGecko uses 'polygon_pos' not 'matic'!
  polygon: "polygon_pos",
  matic: "polygon_pos",

  // BSC
  bsc: "bsc",
  binance: "bsc",

  // Arbitrum
  arbitrum: "arbitrum",
  arb: "arbitrum",

  // Avalanche - IMPORTANT: CoinGecko uses 'avax' correctly
  avalanche: "avax",
  avax: "avax",

  // Base
  base: "base",
};

function getCoinGeckoChainId(chainId) {
  const normalized = chainId.toLowerCase().trim();
  const mapped = CHAIN_ID_MAP[normalized] || normalized;
  console.log(`🔗 Chain mapping: ${chainId} -> ${mapped}`);
  return mapped;
}

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
    console.log("⏱️ Rate limit, waiting...");
    await new Promise((resolve) =>
      setTimeout(resolve, 60000 - (Date.now() - lastMinuteReset))
    );
    resetApiCounter();
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      apiCallsThisMinute++;
      console.log(`📡 API call ${attempt}/${retries + 1}:`, {
        endpoint: url.split("/").slice(-2).join("/"),
        network: params.network,
        query: params.query,
      });

      const response = await axios.get(url, {
        params: params,
        headers: {
          "x-cg-demo-api-key": API_KEY,
        },
        timeout: 15000,
      });

      console.log(`✅ Success (${attempt})`);
      return response.data;
    } catch (error) {
      const isLastAttempt = attempt === retries + 1;

      if (error.code === "ECONNABORTED") {
        console.error(`⏰ Timeout ${attempt}`);
        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
      } else if (error.response?.status === 429) {
        console.error(`🚫 Rate limited ${attempt}`);
        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
      } else if (error.response?.status === 404) {
        console.error(
          `❌ 404: Network '${params.network}' not found or not supported`
        );
        // Don't retry 404s - the network doesn't exist
        throw error;
      } else if (error.response) {
        console.error(
          `❌ ${error.response.status}: ${error.response.statusText}`
        );
      } else if (error.request) {
        console.error(`❌ No response`);
        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
      } else {
        console.error(`❌ Error:`, error.message);
      }

      if (isLastAttempt) {
        logger.error("API call failed:", error.message);
        throw error;
      }
    }
  }
}

function formatAddress(address) {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(
    address.length - 4
  )}`;
}

async function searchTokens(chain, query) {
  try {
    const coinGeckoChain = getCoinGeckoChainId(chain);
    const cacheKey = `search_${coinGeckoChain}_${query}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("✅ Cache hit:", {
        chain: coinGeckoChain,
        count: cached.length,
      });
      return cached;
    }

    const url = `${COINGECKO_BASE_URL}/onchain/search/pools`;
    console.log("🔍 Search:", {
      original: chain,
      mapped: coinGeckoChain,
      query,
    });

    let data;
    try {
      data = await makeApiCall(
        url,
        {
          query: query,
          network: coinGeckoChain,
          include: "base_token",
        },
        1
      );
    } catch (apiError) {
      if (apiError.response?.status === 404) {
        console.error(
          `❌ Network '${coinGeckoChain}' not supported by CoinGecko`
        );
      } else {
        console.error(`❌ API failed for ${chain}:`, apiError.message);
      }
      return [];
    }

    // Build token data map
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

    console.log(`📦 Token map: ${tokenDataMap.size} entries`);

    // Process pools
    const tokenMap = new Map();

    (data.data || []).forEach((pool) => {
      try {
        const poolAddress = pool.attributes?.address || "";
        const baseTokenId = pool.relationships?.base_token?.data?.id || "";

        if (!baseTokenId) return;

        const baseTokenParts = baseTokenId.split("_");
        const baseTokenAddress =
          baseTokenParts.length > 1
            ? baseTokenParts[baseTokenParts.length - 1]
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
        // Continue
      }
    });

    // SMART SORTING: Check if query looks like a contract address
    const queryLower = query.toLowerCase().trim();
    const isAddressQuery =
      queryLower.startsWith("0x") && queryLower.length >= 10;

    let results = Array.from(tokenMap.values()).filter(
      (token) => token.name && token.symbol
    );

    if (isAddressQuery) {
      // If searching by address, prioritize exact match first
      results.sort((a, b) => {
        const aAddress = a.contractAddress.toLowerCase();
        const bAddress = b.contractAddress.toLowerCase();

        // Exact match comes first
        const aExactMatch = aAddress === queryLower;
        const bExactMatch = bAddress === queryLower;

        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        // Partial match (starts with query) comes next
        const aStartsWith = aAddress.startsWith(queryLower);
        const bStartsWith = bAddress.startsWith(queryLower);

        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        // Then sort by liquidity
        return b.liquidity - a.liquidity;
      });
    } else {
      // For name/symbol search, just sort by liquidity
      results.sort((a, b) => b.liquidity - a.liquidity);
    }

    // Limit to top 10 and add display names
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

    if (results.length > 0) {
      cache.set(cacheKey, results);
    }

    return results;
  } catch (error) {
    logger.error(`Search error for ${chain}:`, error);
    console.error(`❌ Failed for ${chain}:`, error.message);
    return [];
  }
}

async function getTokenInfo(network, contractAddress, poolAddress) {
  try {
    const coinGeckoNetwork = getCoinGeckoChainId(network);
    const tokenUrl = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoNetwork}/tokens/${contractAddress}/info`;

    const tokenData = await makeApiCall(tokenUrl, {}, 1);

    let poolData = null;
    if (poolAddress) {
      try {
        const poolUrl = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoNetwork}/pools/${poolAddress}`;
        const poolResponse = await makeApiCall(poolUrl, {}, 1);

        if (poolResponse.data?.attributes) {
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
        console.error("Pool fetch failed:", poolError.message);
      }
    }

    if (!tokenData.data) throw new Error("No token data");

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
        logo: attributes.image_url,
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
    logger.error("Token info failed:", error.message);
    throw error;
  }
}

async function getOHLCVData(network, poolAddress, timeframe) {
  try {
    const coinGeckoNetwork = getCoinGeckoChainId(network);
    const url = `${COINGECKO_BASE_URL}/onchain/networks/${coinGeckoNetwork}/pools/${poolAddress}/ohlcv/${timeframe}`;

    const data = await makeApiCall(url, {}, 1);

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
    logger.error("OHLCV failed:", error.message);
    return [];
  }
}

module.exports = {
  searchTokens,
  getTokenInfo,
  getOHLCVData,
};
