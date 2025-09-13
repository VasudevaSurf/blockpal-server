// services/moralis/index.js - ENHANCED VERSION with percentage changes from Moralis
const Moralis = require("moralis").default;
const NodeCache = require("node-cache");
const axios = require("axios");
const { logger } = require("../../utils/logger");
const chainConfig = require("../../config/chains");

// Initialize cache with TTL
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 300, // 5 minutes default
  checkperiod: 60,
});

// Price cache for external APIs
const priceCache = new NodeCache({
  stdTTL: 180, // 3 minutes for prices
  checkperiod: 30,
});

class MoralisService {
  constructor() {
    this.initialized = false;
    this.apiKey =
      process.env.MORALIS_API_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjcxN2EyZTI3LWM1YjItNDRlMC05MGE3LWRjNGFiMGEzOTliYyIsIm9yZ0lkIjoiNDY4MzYzIiwidXNlcklkIjoiNDgxODIwIiwidHlwZUlkIjoiNTcwMjhhMzQtMzc0OC00NWRlLTg4NTktNjlmNzU5ODEzNTM2IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NTY2MjE2NjAsImV4cCI6NDkxMjM4MTY2MH0.H2IkylE8uOgFiZodaezRSpN9nYE-D0GnF0SoMbbXCFQ";

    // Fallback price mapping for major tokens
    this.fallbackPrices = {
      ETH: 3200,
      WETH: 3200,
      BTC: 45000,
      WBTC: 45000,
      USDT: 1.0,
      USDC: 1.0,
      DAI: 1.0,
      BUSD: 1.0,
      MATIC: 0.85,
      BNB: 310,
      AVAX: 25,
      SOL: 98,
      DOT: 6.5,
      ADA: 0.45,
      LINK: 14.5,
      UNI: 12.8,
      AAVE: 95,
      SUSHI: 1.2,
      CRV: 0.85,
      COMP: 45,
      MKR: 1850,
      YFI: 7200,
      SNX: 2.1,
      "1INCH": 0.32,
      BAL: 3.4,
      LDO: 1.8,
      FRAX: 1.0,
    };
  }

  async initialize() {
    if (this.initialized) return;

    try {
      if (!this.apiKey) {
        throw new Error("MORALIS_API_KEY is required");
      }

      logger.info("🔑 Using API Key:", this.apiKey.substring(0, 20) + "...");

      await Moralis.start({
        apiKey: this.apiKey,
      });

      this.initialized = true;
      logger.info("✅ Moralis service initialized successfully");

      // Initialize price fetching
      this.startPriceUpdater();
    } catch (error) {
      logger.error("❌ Failed to initialize Moralis service", error);
      throw error;
    }
  }

  /**
   * Start periodic price updates
   */
  startPriceUpdater() {
    // Update prices every 3 minutes
    setInterval(() => {
      this.updateTokenPrices();
    }, 3 * 60 * 1000);

    // Initial price fetch
    setTimeout(() => {
      this.updateTokenPrices();
    }, 5000);
  }

  /**
   * Fetch token prices from CoinGecko API
   */
  async updateTokenPrices() {
    try {
      logger.info("🔄 Updating token prices from CoinGecko...");

      const tokenIds = [
        "ethereum",
        "wrapped-bitcoin",
        "tether",
        "usd-coin",
        "dai",
        "matic-network",
        "binancecoin",
        "avalanche-2",
        "solana",
        "polkadot",
        "cardano",
        "chainlink",
        "uniswap",
        "aave",
        "sushiswap-token",
        "curve-dao-token",
        "compound-governance-token",
        "maker",
        "yearn-finance",
        "havven",
        "1inch",
        "balancer",
        "lido-dao",
        "frax",
      ];

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(
        ","
      )}&vs_currencies=usd&include_24hr_change=true`;

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          Accept: "application/json",
        },
      });

      if (response.data) {
        const priceMap = {
          ETH: response.data.ethereum?.usd || this.fallbackPrices.ETH,
          WETH: response.data.ethereum?.usd || this.fallbackPrices.WETH,
          BTC: response.data["wrapped-bitcoin"]?.usd || this.fallbackPrices.BTC,
          WBTC:
            response.data["wrapped-bitcoin"]?.usd || this.fallbackPrices.WBTC,
          USDT: response.data.tether?.usd || this.fallbackPrices.USDT,
          USDC: response.data["usd-coin"]?.usd || this.fallbackPrices.USDC,
          DAI: response.data.dai?.usd || this.fallbackPrices.DAI,
          MATIC:
            response.data["matic-network"]?.usd || this.fallbackPrices.MATIC,
          BNB: response.data.binancecoin?.usd || this.fallbackPrices.BNB,
          AVAX: response.data["avalanche-2"]?.usd || this.fallbackPrices.AVAX,
          SOL: response.data.solana?.usd || this.fallbackPrices.SOL,
          DOT: response.data.polkadot?.usd || this.fallbackPrices.DOT,
          ADA: response.data.cardano?.usd || this.fallbackPrices.ADA,
          LINK: response.data.chainlink?.usd || this.fallbackPrices.LINK,
          UNI: response.data.uniswap?.usd || this.fallbackPrices.UNI,
          AAVE: response.data.aave?.usd || this.fallbackPrices.AAVE,
          SUSHI:
            response.data["sushiswap-token"]?.usd || this.fallbackPrices.SUSHI,
          CRV: response.data["curve-dao-token"]?.usd || this.fallbackPrices.CRV,
          COMP:
            response.data["compound-governance-token"]?.usd ||
            this.fallbackPrices.COMP,
          MKR: response.data.maker?.usd || this.fallbackPrices.MKR,
          YFI: response.data["yearn-finance"]?.usd || this.fallbackPrices.YFI,
          SNX: response.data.havven?.usd || this.fallbackPrices.SNX,
          "1INCH": response.data["1inch"]?.usd || this.fallbackPrices["1INCH"],
          BAL: response.data.balancer?.usd || this.fallbackPrices.BAL,
          LDO: response.data["lido-dao"]?.usd || this.fallbackPrices.LDO,
          FRAX: response.data.frax?.usd || this.fallbackPrices.FRAX,
        };

        // Cache the prices
        priceCache.set("token_prices", priceMap);

        logger.info("✅ Updated token prices from CoinGecko", {
          ethPrice: priceMap.ETH,
          usdtPrice: priceMap.USDT,
          usdcPrice: priceMap.USDC,
          totalTokens: Object.keys(priceMap).length,
        });

        return priceMap;
      }
    } catch (error) {
      logger.warn("⚠️ Failed to fetch prices from CoinGecko:", error.message);

      // Return fallback prices if API fails
      const fallbackMap = { ...this.fallbackPrices };
      priceCache.set("token_prices", fallbackMap);
      return fallbackMap;
    }
  }

  /**
   * Get token price with multiple fallback methods
   */
  async getTokenPrice(
    symbol,
    moralisPrice = null,
    moralisValue = null,
    balance = 0
  ) {
    try {
      // 1. Try Moralis price first if available and reasonable
      if (moralisPrice && moralisPrice > 0 && moralisPrice < 1000000) {
        logger.info(`💰 Using Moralis price for ${symbol}: $${moralisPrice}`);
        return moralisPrice;
      }

      // 2. Try Moralis value / balance calculation
      if (moralisValue && balance && moralisValue > 0 && balance > 0) {
        const calculatedPrice = moralisValue / balance;
        if (calculatedPrice > 0 && calculatedPrice < 1000000) {
          logger.info(`🧮 Calculated price for ${symbol}: $${calculatedPrice}`);
          return calculatedPrice;
        }
      }

      // 3. Try cached external prices
      const cachedPrices = priceCache.get("token_prices");
      if (cachedPrices && cachedPrices[symbol]) {
        logger.info(
          `📦 Using cached price for ${symbol}: $${cachedPrices[symbol]}`
        );
        return cachedPrices[symbol];
      }

      // 4. Try fallback prices
      if (this.fallbackPrices[symbol]) {
        logger.info(
          `🔄 Using fallback price for ${symbol}: $${this.fallbackPrices[symbol]}`
        );
        return this.fallbackPrices[symbol];
      }

      // 5. Try to fetch live price for this specific token
      const livePrice = await this.fetchLiveTokenPrice(symbol);
      if (livePrice && livePrice > 0) {
        logger.info(`🌐 Fetched live price for ${symbol}: $${livePrice}`);
        return livePrice;
      }

      // 6. Last resort: return 0
      logger.warn(`⚠️ No price found for ${symbol}, returning 0`);
      return 0;
    } catch (error) {
      logger.warn(`⚠️ Error getting price for ${symbol}:`, error.message);
      return this.fallbackPrices[symbol] || 0;
    }
  }

  /**
   * Fetch live price for a specific token
   */
  async fetchLiveTokenPrice(symbol) {
    try {
      const cacheKey = `live_price_${symbol}`;
      const cached = priceCache.get(cacheKey);
      if (cached) return cached;

      // Try CoinGecko API for individual token
      const searchUrl = `https://api.coingecko.com/api/v3/search?query=${symbol}`;
      const searchResponse = await axios.get(searchUrl, { timeout: 5000 });

      if (searchResponse.data?.coins?.[0]?.id) {
        const tokenId = searchResponse.data.coins[0].id;
        const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`;
        const priceResponse = await axios.get(priceUrl, { timeout: 5000 });

        const price = priceResponse.data[tokenId]?.usd;
        if (price && price > 0) {
          priceCache.set(cacheKey, price, 300); // Cache for 5 minutes
          return price;
        }
      }

      return null;
    } catch (error) {
      logger.warn(
        `⚠️ Failed to fetch live price for ${symbol}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Enhanced wallet token balances with better price handling AND percentage changes
   */
  async getWalletTokenBalances(walletAddress, chainId) {
    try {
      await this.initialize();

      const cacheKey = `wallet_tokens_${walletAddress}_${chainId}`;
      const cached = cache.get(cacheKey);

      if (cached && process.env.ENABLE_CACHE !== "false") {
        logger.info(
          `📦 Cache hit for wallet tokens: ${walletAddress} on chain ${chainId}`
        );
        return cached;
      }

      logger.info(
        `🔍 Fetching token balances for wallet: ${walletAddress} on chain: ${chainId}`
      );

      const chainHex = this.getChainHex(chainId);
      if (!chainHex) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      // Ensure we have updated prices
      await this.updateTokenPrices();

      logger.info(`🔗 Using chain hex: ${chainHex} for chain ID: ${chainId}`);

      // Get all tokens with enhanced error handling
      logger.info("📡 Making Moralis API call for tokens with prices...");

      let allTokensResponse;
      try {
        allTokensResponse =
          await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
            chain: chainHex,
            address: walletAddress,
          });

        logger.info("✅ Moralis API call successful");
      } catch (moralisError) {
        logger.error("❌ Moralis API call failed:", moralisError.message);
        throw moralisError;
      }

      // Parse response with multiple fallback methods
      let allTokens = [];
      if (allTokensResponse?.result) {
        allTokens = allTokensResponse.result;
      } else if (allTokensResponse?.raw?.result) {
        allTokens = allTokensResponse.raw.result;
      } else if (
        allTokensResponse?.raw &&
        Array.isArray(allTokensResponse.raw)
      ) {
        allTokens = allTokensResponse.raw;
      } else if (Array.isArray(allTokensResponse)) {
        allTokens = allTokensResponse;
      }

      logger.info(
        `📊 Processing ${allTokens.length} tokens from Moralis response`
      );

      // Process tokens with enhanced price handling AND percentage changes
      const tokens = await this.processTokenBalancesEnhanced(
        allTokens,
        chainId
      );

      // Cache the result
      cache.set(cacheKey, tokens);

      logger.info(
        `✅ Successfully processed ${tokens.length} tokens for wallet ${walletAddress}`
      );

      // Log total value for debugging
      const totalValue = tokens.reduce((sum, t) => sum + (t.value || 0), 0);
      logger.info(`💰 Total portfolio value: $${totalValue.toFixed(2)}`);

      return tokens;
    } catch (error) {
      logger.error("❌ Error fetching wallet token balances", {
        wallet: walletAddress,
        chain: chainId,
        error: error.message,
      });

      // Return empty array instead of throwing
      return [];
    }
  }

  /**
   * Enhanced token processing with better price handling AND percentage changes
   */
  async processTokenBalancesEnhanced(tokenData, chainId) {
    const chainInfo = chainConfig[chainId];
    if (!chainInfo) {
      logger.error(`❌ Chain ${chainId} not supported`);
      return [];
    }

    logger.info(
      `🔄 Processing ${tokenData.length} raw tokens with enhanced pricing and percentage changes`
    );

    const processedTokens = [];

    for (const token of tokenData) {
      try {
        logger.info(`🔍 Processing token: ${token.symbol}`, {
          symbol: token.symbol,
          name: token.name,
          balance: token.balance,
          balance_formatted: token.balance_formatted,
          usd_value: token.usd_value,
          usd_price: token.usd_price,
          usd_price_24hr_percent_change: token.usd_price_24hr_percent_change, // NEW: Percentage change from Moralis
          usd_value_24hr_usd_change: token.usd_value_24hr_usd_change, // NEW: USD value change from Moralis
          native_token: token.native_token,
          decimals: token.decimals,
        });

        // Parse balance with multiple methods
        let balance = 0;
        if (token.balance_formatted) {
          balance = parseFloat(token.balance_formatted);
        } else if (token.balance) {
          const rawBalance = token.balance.toString();
          const decimals = parseInt(token.decimals) || 18;
          balance = parseFloat(rawBalance) / Math.pow(10, decimals);
        }

        if (balance <= 0) {
          logger.info(`⏭️ Skipping ${token.symbol} - zero balance`);
          continue;
        }

        // Enhanced price calculation
        const moralisPrice = token.usd_price
          ? parseFloat(token.usd_price)
          : null;
        const moralisValue = token.usd_value
          ? parseFloat(token.usd_value)
          : null;

        logger.info(`💰 Price data for ${token.symbol}:`, {
          moralisPrice,
          moralisValue,
          balance,
        });

        const price = await this.getTokenPrice(
          token.symbol,
          moralisPrice,
          moralisValue,
          balance
        );
        const value = balance * price;

        logger.info(`💰 Final pricing for ${token.symbol}:`, {
          balance,
          price,
          value,
        });

        // NEW: Extract percentage change from Moralis API
        let change24h = 0;
        if (token.usd_price_24hr_percent_change) {
          change24h = parseFloat(token.usd_price_24hr_percent_change);
          logger.info(`📈 24h price change for ${token.symbol}: ${change24h}%`);
        } else {
          logger.info(`📈 No 24h price change data for ${token.symbol}`);
        }

        // Optional: USD value change (can be used for additional UI features)
        let usdChange24h = 0;
        if (token.usd_value_24hr_usd_change) {
          usdChange24h = parseFloat(token.usd_value_24hr_usd_change);
          logger.info(
            `💲 24h USD value change for ${token.symbol}: $${usdChange24h}`
          );
        }

        // Determine if native token
        const isNativeToken =
          token.native_token ||
          token.token_address ===
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
          !token.token_address;

        if (isNativeToken) {
          const processedToken = {
            id: `native-${chainId}`,
            symbol: token.symbol || chainInfo.symbol,
            name: token.name || chainInfo.name,
            contractAddress: "native",
            decimals: parseInt(token.decimals) || 18,
            balance: balance,
            balanceWei: token.balance || "0",
            value: value,
            change24h: change24h, // NEW: Use Moralis percentage change
            usdChange24h: usdChange24h, // NEW: Optional USD change
            price: price,
            isNative: true,
            logoUrl:
              token.logo ||
              token.thumbnail ||
              this.getNativeTokenLogo(chainInfo.symbol),
            isPopular: true,
            possibleSpam: false,
            verifiedContract: true,
          };

          processedTokens.push(processedToken);
          logger.info(
            `✅ Added native token: ${
              token.symbol
            } - Balance: ${balance}, Price: $${price}, Value: $${value.toFixed(
              2
            )}, Change: ${change24h}%`
          );
        } else if (token.token_address) {
          const popularToken = chainInfo.popularTokens.find(
            (pt) =>
              pt.address.toLowerCase() === token.token_address.toLowerCase()
          );

          const processedToken = {
            id: `${token.token_address.toLowerCase()}-${chainId}`,
            symbol:
              token.symbol || (popularToken ? popularToken.symbol : "UNKNOWN"),
            name:
              token.name ||
              (popularToken ? popularToken.name : "Unknown Token"),
            contractAddress: token.token_address.toLowerCase(),
            decimals:
              parseInt(token.decimals) ||
              (popularToken ? popularToken.decimals : 18),
            balance: balance,
            balanceWei: token.balance || "0",
            value: value,
            change24h: change24h, // NEW: Use Moralis percentage change
            usdChange24h: usdChange24h, // NEW: Optional USD change
            price: price,
            isNative: false,
            logoUrl:
              token.logo || token.thumbnail || this.getTokenLogo(token.symbol),
            isPopular: !!popularToken,
            possibleSpam: token.possible_spam || false,
            verifiedContract: token.verified_contract !== false,
          };

          processedTokens.push(processedToken);
          logger.info(
            `✅ Added ERC-20 token: ${
              token.symbol
            } - Balance: ${balance}, Price: $${price}, Value: $${value.toFixed(
              2
            )}, Change: ${change24h}%`
          );
        }
      } catch (error) {
        logger.warn(
          `⚠️ Error processing token ${token.symbol}:`,
          error.message
        );
        continue;
      }
    }

    // Sort by USD value descending
    processedTokens.sort((a, b) => b.value - a.value);

    // Calculate and log final totals
    const totalValue = processedTokens.reduce(
      (sum, t) => sum + (t.value || 0),
      0
    );
    logger.info(
      `✅ Successfully processed ${processedTokens.length} tokens with enhanced pricing and percentage changes`
    );
    logger.info(`💰 Total portfolio value: $${totalValue.toFixed(2)}`);

    // Log each processed token for debugging
    processedTokens.forEach((token, index) => {
      logger.info(
        `📋 Token ${index + 1}: ${token.symbol} - Balance: ${
          token.balance
        }, Price: $${token.price}, Value: $${token.value.toFixed(2)}, Change: ${
          token.change24h
        }%`
      );
    });

    return processedTokens;
  }

  /**
   * Enhanced native balance with price
   */
  async getNativeBalance(walletAddress, chainId) {
    try {
      await this.initialize();

      const chainHex = this.getChainHex(chainId);
      if (!chainHex) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      logger.info(
        `💎 Fetching native balance for ${walletAddress} on chain ${chainId}`
      );

      const response = await Moralis.EvmApi.balance.getNativeBalance({
        chain: chainHex,
        address: walletAddress,
      });

      const balanceWei = response.result?.balance || "0";
      const balanceFormatted = parseFloat(balanceWei) / 1e18;

      // Get native token price
      const chainInfo = chainConfig[chainId];
      const nativeSymbol = chainInfo?.symbol || "ETH";
      const price = await this.getTokenPrice(nativeSymbol);
      const value = balanceFormatted * price;

      logger.info(
        `✅ Native balance: ${balanceFormatted} ${nativeSymbol}, Price: $${price}, Value: $${value.toFixed(
          2
        )}`
      );

      return {
        balance: balanceFormatted,
        balanceWei: balanceWei,
        price: price,
        value: value,
      };
    } catch (error) {
      logger.error("❌ Error fetching native balance:", error);
      return {
        balance: 0,
        balanceWei: "0",
        price: 0,
        value: 0,
      };
    }
  }

  // Keep existing utility methods
  getChainHex(chainId) {
    const chainIdNum = parseInt(chainId);
    const chainInfo = chainConfig[chainIdNum];
    return chainInfo ? chainInfo.chainId : null;
  }

  getNativeTokenLogo(symbol) {
    const logos = {
      ETH: "https://cdn.moralis.io/eth/0x.png",
      BNB: "https://tokens.1inch.io/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c.png",
      MATIC:
        "https://tokens.1inch.io/0x0000000000000000000000000000000000001010_1.png",
      AVAX: "https://tokens.1inch.io/0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7.png",
    };
    return logos[symbol] || "https://cdn.moralis.io/eth/0x.png";
  }

  getTokenLogo(symbol) {
    return `https://tokens.1inch.io/generic.png`;
  }

  getSupportedChains() {
    return Object.keys(chainConfig).map((chainId) => ({
      chainId: parseInt(chainId),
      name: chainConfig[chainId].name,
      symbol: chainConfig[chainId].symbol,
      popularTokenCount: chainConfig[chainId].popularTokens.length,
    }));
  }

  getPopularTokens(chainId) {
    const chainInfo = chainConfig[chainId];
    return chainInfo ? chainInfo.popularTokens : [];
  }

  clearWalletCache(walletAddress) {
    const keys = cache.keys();
    const walletKeys = keys.filter((key) => key.includes(walletAddress));
    walletKeys.forEach((key) => cache.del(key));

    // Also clear price cache to force refresh
    priceCache.flushAll();

    logger.info(
      `🗑️ Cleared cache for wallet: ${walletAddress}, removed ${walletKeys.length} entries`
    );
  }

  getCacheStats() {
    return {
      tokenCache: {
        keys: cache.keys().length,
        hits: cache.getStats().hits,
        misses: cache.getStats().misses,
        ttl: cache.options.stdTTL,
      },
      priceCache: {
        keys: priceCache.keys().length,
        hits: priceCache.getStats().hits,
        misses: priceCache.getStats().misses,
        ttl: priceCache.options.stdTTL,
      },
    };
  }

  /**
   * Manual price refresh endpoint
   */
  async refreshPrices() {
    logger.info("🔄 Manual price refresh requested");
    priceCache.flushAll();
    return await this.updateTokenPrices();
  }

  /**
   * Get current cached prices for debugging
   */
  getCurrentPrices() {
    return priceCache.get("token_prices") || this.fallbackPrices;
  }
}

module.exports = new MoralisService();
