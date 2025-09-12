// services/moralis/index.js - FIXED with hardcoded API key and better debugging
const Moralis = require("moralis").default;
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
    // Hardcode your API key directly here as fallback
    this.apiKey =
      process.env.MORALIS_API_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjcxN2EyZTI3LWM1YjItNDRlMC05MGE3LWRjNGFiMGEzOTliYyIsIm9yZ0lkIjoiNDY4MzYzIiwidXNlcklkIjoiNDgxODIwIiwidHlwZUlkIjoiNTcwMjhhMzQtMzc0OC00NWRlLTg4NTktNjlmNzU5ODEzNTM2IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NTY2MjE2NjAsImV4cCI6NDkxMjM4MTY2MH0.H2IkylE8uOgFiZodaezRSpN9nYE-D0GnF0SoMbbXCFQ";
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
      logger.info("Moralis service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Moralis service", error);
      throw error;
    }
  }

  /**
   * Get wallet token balances for a specific chain using the correct Moralis API
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

      logger.info(`🔗 Using chain hex: ${chainHex} for chain ID: ${chainId}`);

      // First, get ALL tokens without specifying token addresses
      logger.info("🔄 Making Moralis API call for ALL tokens...");

      let allTokensResponse;
      try {
        allTokensResponse =
          await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
            chain: chainHex,
            address: walletAddress,
          });

        logger.info("✅ Moralis ALL tokens API call successful");
        logger.info(
          "📋 Full Raw Response:",
          JSON.stringify(allTokensResponse, null, 2)
        );

        if (allTokensResponse.raw) {
          logger.info(
            "📋 Raw Data:",
            JSON.stringify(allTokensResponse.raw, null, 2)
          );

          if (allTokensResponse.raw.result) {
            logger.info(
              `📊 Found ${allTokensResponse.raw.result.length} tokens in raw result`
            );

            // Log first few tokens for debugging
            allTokensResponse.raw.result.slice(0, 3).forEach((token, index) => {
              logger.info(`🪙 Token ${index + 1}:`, {
                symbol: token.symbol,
                name: token.name,
                balance: token.balance,
                balance_formatted: token.balance_formatted,
                usd_value: token.usd_value,
                native_token: token.native_token,
                token_address: token.token_address,
              });
            });
          } else {
            logger.warn("⚠️ No 'result' field in raw response");
          }
        } else {
          logger.warn("⚠️ No 'raw' field in response");
        }
      } catch (moralisError) {
        logger.error("❌ Moralis ALL tokens API call failed:", {
          message: moralisError.message,
          code: moralisError.code,
          details: moralisError.details,
          stack: moralisError.stack,
        });
        throw moralisError;
      }

      // Process the response
      let allTokens = allTokensResponse.raw?.result || [];
      logger.info(
        `📊 Processing ${allTokens.length} tokens from Moralis response`
      );

      if (allTokens.length === 0) {
        logger.warn(
          "⚠️ No tokens returned from Moralis API - this might indicate:"
        );
        logger.warn("   1. Empty wallet");
        logger.warn("   2. API key issues");
        logger.warn("   3. Invalid wallet address");
        logger.warn("   4. Network/chain issues");

        // Try a test call with a known wallet that has tokens
        logger.info("🧪 Testing with known wallet that has tokens...");
        try {
          const testResponse =
            await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
              chain: chainHex,
              address: "0xcB1C1FdE09f811B294172696404e88E658659905", // Known wallet with tokens
            });

          logger.info(
            `🧪 Test wallet returned ${
              testResponse.raw?.result?.length || 0
            } tokens`
          );
          if (testResponse.raw?.result?.length > 0) {
            logger.info("✅ API is working - your wallet might be empty");
          } else {
            logger.warn(
              "❌ Even test wallet returns no tokens - API issue suspected"
            );
          }
        } catch (testError) {
          logger.error("❌ Test call also failed:", testError.message);
        }
      }

      // Process the combined response
      const tokens = await this.processTokenBalances(allTokens, chainId);

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
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Process token balances from Moralis API response
   */
  async processTokenBalances(tokenData, chainId) {
    const chainInfo = chainConfig[chainId];
    if (!chainInfo) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    logger.info(`🔄 Processing ${tokenData.length} raw tokens from Moralis`);

    const processedTokens = [];

    for (const token of tokenData) {
      try {
        logger.info(`🔍 Processing token:`, {
          symbol: token.symbol,
          name: token.name,
          address: token.token_address,
          balance: token.balance,
          balance_formatted: token.balance_formatted,
          usd_value: token.usd_value,
          native_token: token.native_token,
          possible_spam: token.possible_spam,
        });

        // Get balance value
        const balance = parseFloat(token.balance_formatted || "0");
        logger.info(`💰 Token ${token.symbol} balance: ${balance}`);

        // Skip tokens with zero balance
        if (balance <= 0) {
          logger.info(
            `⏭️ Skipping ${token.symbol} - zero balance (${balance})`
          );
          continue;
        }

        // Skip possible spam tokens (unless they're popular)
        if (token.possible_spam) {
          const isPopularToken = chainInfo.popularTokens.find(
            (pt) =>
              pt.address.toLowerCase() === token.token_address?.toLowerCase()
          );

          if (!isPopularToken) {
            logger.info(
              `⏭️ Skipping ${token.symbol} - marked as possible spam`
            );
            continue;
          }
        }

        // Handle native token
        if (
          token.native_token ||
          token.token_address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
        ) {
          const processedToken = {
            id: `native-${chainId}`,
            symbol: token.symbol || chainInfo.symbol,
            name: token.name || chainInfo.name,
            contractAddress: "native",
            decimals: 18,
            balance: balance,
            balanceWei: token.balance || "0",
            value: parseFloat(token.usd_value || "0"),
            change24h: parseFloat(token.usd_price_24hr_percent_change || "0"),
            price: parseFloat(token.usd_price || "0"),
            isNative: true,
            logoUrl:
              token.logo ||
              token.thumbnail ||
              this.getNativeTokenLogo(chainInfo.symbol),
          };

          processedTokens.push(processedToken);
          logger.info(
            `✅ Added native token: ${
              token.symbol
            } - Balance: ${balance}, USD: $${token.usd_value || "0"}`
          );
          continue;
        }

        // Handle ERC-20 tokens
        if (token.token_address) {
          // Check if token is in our popular tokens list (case-insensitive)
          const popularToken = chainInfo.popularTokens.find(
            (pt) =>
              pt.address.toLowerCase() === token.token_address.toLowerCase()
          );

          const decimals =
            parseInt(token.decimals) ||
            (popularToken ? popularToken.decimals : 18);

          const processedToken = {
            id: `${token.token_address.toLowerCase()}-${chainId}`,
            symbol:
              token.symbol || (popularToken ? popularToken.symbol : "UNKNOWN"),
            name:
              token.name ||
              (popularToken ? popularToken.name : "Unknown Token"),
            contractAddress: token.token_address.toLowerCase(),
            decimals,
            balance: balance,
            balanceWei: token.balance || "0",
            value: parseFloat(token.usd_value || "0"),
            change24h: parseFloat(token.usd_price_24hr_percent_change || "0"),
            price: parseFloat(token.usd_price || "0"),
            isNative: false,
            logoUrl:
              token.logo || token.thumbnail || this.getTokenLogo(token.symbol),
            isPopular: !!popularToken,
            possibleSpam: token.possible_spam || false,
            verifiedContract: token.verified_contract || false,
          };

          processedTokens.push(processedToken);
          logger.info(
            `✅ Added ERC-20 token: ${
              token.symbol
            } - Balance: ${balance}, USD: $${token.usd_value || "0"}`
          );
        }
      } catch (error) {
        logger.warn(
          `⚠️ Error processing token ${token.token_address}:`,
          error.message
        );
        continue;
      }
    }

    // Sort by USD value descending
    processedTokens.sort((a, b) => b.value - a.value);

    logger.info(
      `✅ Successfully processed ${processedTokens.length} tokens with balances`
    );

    // Log summary
    const totalValue = processedTokens.reduce((sum, t) => sum + t.value, 0);
    logger.info(`💰 Total portfolio value: $${totalValue.toFixed(2)}`);

    return processedTokens;
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
      ETH: "https://cdn.moralis.io/eth/0x.png",
      BNB: "https://tokens.1inch.io/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c.png",
      MATIC:
        "https://tokens.1inch.io/0x0000000000000000000000000000000000001010_1.png",
      AVAX: "https://tokens.1inch.io/0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7.png",
    };
    return logos[symbol] || "https://cdn.moralis.io/eth/0x.png";
  }

  /**
   * Get token logo URL
   */
  getTokenLogo(symbol) {
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

  /**
   * Test method to debug Moralis API calls
   */
  async testMoralisCall(walletAddress, chainId) {
    try {
      await this.initialize();

      const chainHex = this.getChainHex(chainId);

      logger.info("🧪 Testing Moralis API call with parameters:", {
        chain: chainHex,
        address: walletAddress,
        apiKey: this.apiKey.substring(0, 20) + "...",
      });

      // Test call without token addresses (gets all tokens)
      const allTokensResponse =
        await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
          chain: chainHex,
          address: walletAddress,
        });

      logger.info(
        "🧪 Raw test response:",
        JSON.stringify(allTokensResponse.raw, null, 2)
      );

      return {
        allTokens: {
          count: allTokensResponse.raw.result?.length || 0,
          result: allTokensResponse.raw.result?.slice(0, 3), // First 3 for debug
          fullRaw: allTokensResponse.raw,
        },
      };
    } catch (error) {
      logger.error("🧪 Moralis test call failed:", {
        message: error.message,
        code: error.code,
        details: error.details,
      });
      throw error;
    }
  }
}

module.exports = new MoralisService();
