// services/moralis/index.js - Moralis integration service
const Moralis = require("moralis").default;
const axios = require("axios");
const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");
const chainConfig = require("../../config/chains");

// Initialize cache with TTL
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 300, // 5 minutes default
  checkperiod: 60,
});

class MoralisService {
  constructor() {
    this.initialized = false;
    this.apiKey = process.env.MORALIS_API_KEY;
    this.baseURL = "https://deep-index.moralis.io/api/v2.2";
  }

  async initialize() {
    if (this.initialized) return;

    try {
      if (!this.apiKey) {
        throw new Error("MORALIS_API_KEY is required");
      }

      await Moralis.start({
        apiKey: this.apiKey,
      });

      this.initialized = true;
      logger.info("Moralis service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Moralis service", error);
      throw error;
    }
  }

  /**
   * Get wallet token balances for a specific chain
   */
  async getWalletTokenBalances(walletAddress, chainId) {
    try {
      await this.initialize();

      const cacheKey = `wallet_tokens_${walletAddress}_${chainId}`;
      const cached = cache.get(cacheKey);

      if (cached && process.env.ENABLE_CACHE !== "false") {
        logger.info(
          `Cache hit for wallet tokens: ${walletAddress} on chain ${chainId}`
        );
        return cached;
      }

      logger.info(
        `Fetching token balances for wallet: ${walletAddress} on chain: ${chainId}`
      );

      const chainHex = this.getChainHex(chainId);
      if (!chainHex) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      // Get ERC-20 tokens
      const response = await axios.get(
        `${this.baseURL}/${walletAddress}/erc20`,
        {
          headers: {
            "X-API-Key": this.apiKey,
            Accept: "application/json",
          },
          params: {
            chain: chainHex,
            limit: 100,
            exclude_spam: true,
            exclude_unverified_contracts: true,
          },
        }
      );

      // Get native token balance
      const nativeBalance = await this.getNativeBalance(walletAddress, chainId);

      // Process tokens
      const tokens = await this.processTokenBalances(
        response.data.result || [],
        chainId,
        nativeBalance
      );

      // Cache the result
      cache.set(cacheKey, tokens);

      logger.info(
        `Successfully fetched ${tokens.length} tokens for wallet ${walletAddress}`
      );
      return tokens;
    } catch (error) {
      logger.error("Error fetching wallet token balances", {
        wallet: walletAddress,
        chain: chainId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get native token balance
   */
  async getNativeBalance(walletAddress, chainId) {
    try {
      const chainHex = this.getChainHex(chainId);

      const response = await axios.get(
        `${this.baseURL}/${walletAddress}/balance`,
        {
          headers: {
            "X-API-Key": this.apiKey,
            Accept: "application/json",
          },
          params: {
            chain: chainHex,
          },
        }
      );

      const balance = response.data.balance;
      const balanceEth = parseFloat(balance) / Math.pow(10, 18);

      return {
        balance: balanceEth,
        balanceWei: balance,
      };
    } catch (error) {
      logger.error("Error fetching native balance", {
        wallet: walletAddress,
        chain: chainId,
        error: error.message,
      });
      return { balance: 0, balanceWei: "0" };
    }
  }

  /**
   * Process token balances and match with popular tokens
   */
  async processTokenBalances(tokenData, chainId, nativeBalance) {
    const chainInfo = chainConfig[chainId];
    if (!chainInfo) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const processedTokens = [];

    // Add native token first
    processedTokens.push({
      id: `native-${chainId}`,
      symbol: chainInfo.symbol,
      name: chainInfo.name,
      contractAddress: "native",
      decimals: 18,
      balance: nativeBalance.balance,
      balanceWei: nativeBalance.balanceWei,
      value: 0, // Will be calculated with price data
      change24h: 0,
      price: 0,
      isNative: true,
      logoUrl: this.getNativeTokenLogo(chainInfo.symbol),
    });

    // Process ERC-20 tokens
    for (const token of tokenData) {
      if (!token.token_address || !token.balance) continue;

      // Check if token is in our popular tokens list
      const popularToken = chainInfo.popularTokens.find(
        (pt) => pt.address.toLowerCase() === token.token_address.toLowerCase()
      );

      if (!popularToken) {
        logger.debug(`Token ${token.token_address} not in popular tokens list`);
        continue;
      }

      const decimals = parseInt(token.decimals) || popularToken.decimals;
      const balance = parseFloat(token.balance) / Math.pow(10, decimals);

      // Only include tokens with non-zero balance
      if (balance > 0) {
        processedTokens.push({
          id: `${token.token_address.toLowerCase()}-${chainId}`,
          symbol: token.symbol || popularToken.symbol,
          name: token.name || popularToken.name,
          contractAddress: token.token_address.toLowerCase(),
          decimals,
          balance,
          balanceWei: token.balance,
          value: 0, // Will be calculated with price data
          change24h: 0,
          price: 0,
          isNative: false,
          logoUrl: token.logo || this.getTokenLogo(popularToken.symbol),
        });
      }
    }

    // Get price data for all tokens
    await this.enrichWithPriceData(processedTokens);

    // Sort by value descending
    processedTokens.sort((a, b) => b.value - a.value);

    return processedTokens;
  }

  /**
   * Enrich tokens with price data
   */
  async enrichWithPriceData(tokens) {
    try {
      // Get token addresses for price lookup
      const tokenAddresses = tokens
        .filter((token) => !token.isNative)
        .map((token) => token.contractAddress);

      if (tokenAddresses.length === 0) return;

      // You can implement price fetching from CoinGecko or other price API
      // For now, we'll use mock prices
      for (const token of tokens) {
        const mockPrice = this.getMockPrice(token.symbol);
        token.price = mockPrice.current_price;
        token.change24h = mockPrice.price_change_percentage_24h;
        token.value = token.balance * token.price;
      }

      logger.info(`Enriched ${tokens.length} tokens with price data`);
    } catch (error) {
      logger.error("Error enriching tokens with price data", error);
      // Continue without price data
    }
  }

  /**
   * Get mock price data for demonstration
   */
  getMockPrice(symbol) {
    const mockPrices = {
      ETH: { current_price: 3200.45, price_change_percentage_24h: 2.5 },
      BTC: { current_price: 67000.0, price_change_percentage_24h: 1.2 },
      USDT: { current_price: 1.0, price_change_percentage_24h: 0.1 },
      USDC: { current_price: 1.0, price_change_percentage_24h: -0.05 },
      BNB: { current_price: 635.0, price_change_percentage_24h: 3.1 },
      MATIC: { current_price: 0.95, price_change_percentage_24h: -1.2 },
      AVAX: { current_price: 42.5, price_change_percentage_24h: 4.3 },
      LINK: { current_price: 18.5, price_change_percentage_24h: -0.8 },
      UNI: { current_price: 12.3, price_change_percentage_24h: 2.1 },
      AAVE: { current_price: 156.7, price_change_percentage_24h: 1.9 },
      DAI: { current_price: 1.0, price_change_percentage_24h: 0.02 },
      WBTC: { current_price: 66800.0, price_change_percentage_24h: 1.1 },
      ARB: { current_price: 2.1, price_change_percentage_24h: 5.2 },
      // Add more as needed
    };

    return (
      mockPrices[symbol] || { current_price: 0, price_change_percentage_24h: 0 }
    );
  }

  /**
   * Get chain hex from decimal ID
   */
  getChainHex(chainId) {
    const chainIdNum = parseInt(chainId);
    const chainInfo = chainConfig[chainIdNum];
    return chainInfo ? chainInfo.chainId : null;
  }

  /**
   * Get native token logo URL
   */
  getNativeTokenLogo(symbol) {
    const logos = {
      ETH: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png",
      BNB: "https://tokens.1inch.io/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c.png",
      MATIC:
        "https://tokens.1inch.io/0x0000000000000000000000000000000000001010_1.png",
      AVAX: "https://tokens.1inch.io/0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7.png",
    };
    return (
      logos[symbol] ||
      `https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png`
    );
  }

  /**
   * Get token logo URL
   */
  getTokenLogo(symbol) {
    // You can implement a mapping to token logo URLs
    // For now, return a generic token icon
    return `https://tokens.1inch.io/generic.png`;
  }

  /**
   * Get supported chains
   */
  getSupportedChains() {
    return Object.keys(chainConfig).map((chainId) => ({
      chainId: parseInt(chainId),
      name: chainConfig[chainId].name,
      symbol: chainConfig[chainId].symbol,
      popularTokenCount: chainConfig[chainId].popularTokens.length,
    }));
  }

  /**
   * Get popular tokens for a chain
   */
  getPopularTokens(chainId) {
    const chainInfo = chainConfig[chainId];
    return chainInfo ? chainInfo.popularTokens : [];
  }

  /**
   * Clear cache for a wallet
   */
  clearWalletCache(walletAddress) {
    const keys = cache.keys();
    const walletKeys = keys.filter((key) => key.includes(walletAddress));

    walletKeys.forEach((key) => cache.del(key));

    logger.info(
      `Cleared cache for wallet: ${walletAddress}, removed ${walletKeys.length} entries`
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      keys: cache.keys().length,
      hits: cache.getStats().hits,
      misses: cache.getStats().misses,
      ttl: cache.options.stdTTL,
    };
  }
}

module.exports = new MoralisService();
