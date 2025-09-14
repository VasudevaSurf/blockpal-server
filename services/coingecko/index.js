// services/coingecko/index.js - CoinGecko service for trending tokens
const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

// Initialize cache with TTL (60 seconds for trending data)
const cache = new NodeCache({
  stdTTL: 60, // 60 seconds cache for trending data
  checkperiod: 30,
});

class CoinGeckoService {
  constructor() {
    this.apiKey =
      process.env.COINGECKO_API_KEY || "CG-oTmQJV3kLe92KcQ2753cxy6j";
    this.apiUrl = "https://api.coingecko.com/api/v3/search/trending";
  }

  // Simple formatting functions - exact copy from terminal-app.js
  formatPrice(price) {
    if (!price) return "N/A";
    const priceStr = price.toString().replace("$", "").replace(/,/g, "");
    const priceNum = parseFloat(priceStr);

    if (isNaN(priceNum)) return price;

    if (priceNum < 0.01) {
      return `$${priceNum.toFixed(8)}`;
    } else if (priceNum < 1) {
      return `$${priceNum.toFixed(4)}`;
    } else {
      return `$${priceNum.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }

  formatChange(change) {
    if (!change && change !== 0) return "N/A";

    const changeNum = typeof change === "object" ? change.usd : change;
    if (!changeNum && changeNum !== 0) return "N/A";

    const formatted = `${changeNum > 0 ? "+" : ""}${changeNum.toFixed(2)}%`;
    return formatted;
  }

  formatMarketCap(marketCap) {
    if (!marketCap) return "N/A";

    const capNum = parseFloat(marketCap.toString().replace(/,/g, ""));
    if (isNaN(capNum)) return marketCap;

    if (capNum >= 1000000000) {
      return `$${(capNum / 1000000000).toFixed(2)}B`;
    } else if (capNum >= 1000000) {
      return `$${(capNum / 1000000).toFixed(2)}M`;
    } else if (capNum >= 1000) {
      return `$${(capNum / 1000).toFixed(2)}K`;
    } else {
      return `$${capNum.toFixed(2)}`;
    }
  }

  // Get trending tokens - exact copy logic from terminal-app.js
  async getTrendingTokens() {
    try {
      const cacheKey = "trending_tokens";
      const cached = cache.get(cacheKey);

      if (cached) {
        logger.info("📦 Cache hit for trending tokens");
        return cached;
      }

      logger.info("🔍 Fetching trending tokens from CoinGecko...");

      const response = await fetch(this.apiUrl, {
        headers: {
          accept: "application/json",
          "x-cg-pro-api-key": this.apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please wait a moment.");
        } else if (response.status === 401) {
          throw new Error(
            "Invalid API key. Please check your CoinGecko API key."
          );
        } else {
          throw new Error(`Failed to fetch data: ${response.statusText}`);
        }
      }

      const data = await response.json();

      if (!data.coins || data.coins.length === 0) {
        logger.warn("No trending coins found in response");
        return { trendingTokens: [], topGainers: [] };
      }

      // Process trending tokens data - exact format from terminal-app.js
      const trendingTokens = data.coins.map((coin, index) => {
        const item = coin.item;
        const price = this.formatPrice(item.data?.price);
        const change = this.formatChange(
          item.data?.price_change_percentage_24h
        );
        const marketCap = this.formatMarketCap(item.data?.market_cap);
        const rank = item.market_cap_rank ? `#${item.market_cap_rank}` : "N/A";

        // Create color mapping for tokens
        const colorMap = [
          "bg-red-500",
          "bg-blue-500",
          "bg-purple-500",
          "bg-green-500",
          "bg-yellow-500",
          "bg-pink-500",
          "bg-indigo-500",
          "bg-cyan-500",
          "bg-orange-500",
          "bg-teal-500",
          "bg-lime-500",
          "bg-emerald-500",
          "bg-violet-500",
          "bg-fuchsia-500",
          "bg-rose-500",
        ];

        return {
          index: index + 1,
          name: item.name || "Unknown",
          symbol: (item.symbol || "N/A").toUpperCase(),
          price: price,
          change: change,
          changeType:
            item.data?.price_change_percentage_24h?.usd >= 0
              ? "positive"
              : "negative",
          marketCap: marketCap,
          rank: rank,
          imageUrl: item.thumb || item.small || null,
          bgColor: colorMap[index % colorMap.length],
          icon: (item.symbol || "T").charAt(0).toUpperCase(),
          sparklineUrl: item.data?.sparkline || null,
        };
      });

      // Create top gainers from trending data (reuse same data with different format)
      const topGainers = data.coins.slice(0, 15).map((coin, index) => {
        const item = coin.item;
        const price = this.formatPrice(item.data?.price);
        const change = this.formatChange(
          item.data?.price_change_percentage_24h
        );
        const marketCap = this.formatMarketCap(item.data?.market_cap);

        const colorMap = [
          "bg-orange-500",
          "bg-blue-500",
          "bg-purple-500",
          "bg-blue-400",
          "bg-cyan-500",
          "bg-yellow-500",
          "bg-blue-600",
          "bg-green-500",
          "bg-red-500",
          "bg-pink-500",
          "bg-indigo-500",
          "bg-teal-500",
          "bg-lime-500",
          "bg-violet-500",
          "bg-rose-500",
        ];

        const iconMap = {
          BITCOIN: "₿",
          BTC: "₿",
          ETHEREUM: "◆",
          ETH: "◆",
          SOLANA: "◎",
          SOL: "◎",
          CARDANO: "❄",
          ADA: "❄",
          SUI: "~",
          TONCOIN: "T",
          TON: "T",
        };

        return {
          index: index + 1,
          name: item.name || "Unknown",
          symbol: (item.symbol || "N/A").toUpperCase(),
          price: price,
          marketCap: marketCap,
          change: change.replace("+", "").replace("%", ""),
          changeType:
            item.data?.price_change_percentage_24h?.usd >= 0
              ? "positive"
              : "negative",
          icon:
            iconMap[item.symbol?.toUpperCase()] ||
            (item.symbol || "T").charAt(0).toUpperCase(),
          bgColor: colorMap[index % colorMap.length],
        };
      });

      const result = {
        trendingTokens,
        topGainers,
        lastUpdated: new Date().toISOString(),
        timestamp: new Date().toLocaleString(),
      };

      // Cache the result
      cache.set(cacheKey, result);

      logger.info(
        `✅ Fetched ${trendingTokens.length} trending tokens and ${topGainers.length} top gainers`
      );

      return result;
    } catch (error) {
      logger.error("❌ Error fetching trending tokens:", error);

      // Return empty arrays instead of throwing
      return {
        trendingTokens: [],
        topGainers: [],
        error: error.message,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  // Get cache stats
  getCacheStats() {
    return {
      keys: cache.keys().length,
      hits: cache.getStats().hits,
      misses: cache.getStats().misses,
      ttl: cache.options.stdTTL,
    };
  }

  // Clear cache
  clearCache() {
    cache.flushAll();
    logger.info("🗑️ CoinGecko cache cleared");
  }
}

module.exports = new CoinGeckoService();
