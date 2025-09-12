// services/moralis/index.js - FIXED VERSION with better token processing
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

      // Get all tokens with better error handling
      logger.info("🔄 Making Moralis API call for ALL tokens...");

      let allTokensResponse;
      try {
        allTokensResponse =
          await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
            chain: chainHex,
            address: walletAddress,
          });

        logger.info("✅ Moralis ALL tokens API call successful");

        // Better response logging
        if (allTokensResponse?.result || allTokensResponse?.raw?.result) {
          const tokenResults =
            allTokensResponse.result ||
            allTokensResponse.raw.result ||
            allTokensResponse.raw ||
            [];
          logger.info(`📊 Found ${tokenResults.length} tokens in response`);

          // Log first few tokens for debugging
          tokenResults.slice(0, 3).forEach((token, index) => {
            logger.info(`🪙 Token ${index + 1}:`, {
              symbol: token.symbol,
              name: token.name,
              balance: token.balance,
              balance_formatted: token.balance_formatted,
              usd_value: token.usd_value,
              usd_price: token.usd_price,
              native_token: token.native_token,
              token_address: token.token_address,
            });
          });
        } else {
          logger.warn("⚠️ No token results found in response structure");
          logger.info(
            "📋 Full response structure:",
            JSON.stringify(allTokensResponse, null, 2)
          );
        }
      } catch (moralisError) {
        logger.error("❌ Moralis API call failed:", {
          message: moralisError.message,
          code: moralisError.code,
          details: moralisError.details,
        });
        throw moralisError;
      }

      // FIXED: Better response parsing
      let allTokens = [];

      // Try multiple response structures
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
      } else {
        logger.warn("⚠️ Could not parse token results from response");
        allTokens = [];
      }

      logger.info(
        `📊 Processing ${allTokens.length} tokens from Moralis response`
      );

      if (allTokens.length === 0) {
        logger.warn("⚠️ No tokens returned - this might indicate:");
        logger.warn("   1. Empty wallet");
        logger.warn("   2. All tokens have zero balance");
        logger.warn("   3. API response parsing issue");

        // Still process what we have - even if it's empty
        const tokens = await this.processTokenBalances([], chainId);

        // For wallets with zero balance, still return native token with 0 balance
        if (tokens.length === 0) {
          const chainInfo = chainConfig[chainId];
          if (chainInfo) {
            const nativeToken = {
              id: `native-${chainId}`,
              symbol: chainInfo.symbol,
              name: chainInfo.name,
              contractAddress: "native",
              decimals: 18,
              balance: 0,
              balanceWei: "0",
              value: 0,
              change24h: 0,
              price: 0,
              isNative: true,
              logoUrl: this.getNativeTokenLogo(chainInfo.symbol),
              isPopular: true,
              possibleSpam: false,
              verifiedContract: true,
            };
            tokens.push(nativeToken);
            logger.info("✅ Added zero-balance native token for display");
          }
        }

        // Cache even empty results
        cache.set(cacheKey, tokens);
        return tokens;
      }

      // Process the tokens
      const tokens = await this.processTokenBalances(allTokens, chainId);

      // Cache the result
      cache.set(cacheKey, tokens);

      logger.info(
        `✅ Successfully fetched ${tokens.length} tokens for wallet ${walletAddress}`
      );
      return tokens;
    } catch (error) {
      logger.error("Error fetching wallet token balances", {
        wallet: walletAddress,
        chain: chainId,
        error: error.message,
        stack: error.stack,
      });

      // Return empty array instead of throwing to prevent UI breakage
      logger.warn("🔄 Returning empty token array due to error");
      return [];
    }
  }

  /**
   * FIXED: Process token balances with corrected logic
   */
  async processTokenBalances(tokenData, chainId) {
    const chainInfo = chainConfig[chainId];
    if (!chainInfo) {
      logger.error(`Chain ${chainId} not supported`);
      return [];
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
          usd_price: token.usd_price,
          native_token: token.native_token,
          possible_spam: token.possible_spam,
          decimals: token.decimals,
        });

        // FIXED: Better balance parsing
        let balance = 0;
        if (token.balance_formatted) {
          balance = parseFloat(token.balance_formatted);
        } else if (token.balance) {
          // Try to parse raw balance
          const rawBalance = token.balance.toString();
          if (token.decimals) {
            balance =
              parseFloat(rawBalance) / Math.pow(10, parseInt(token.decimals));
          } else {
            balance = parseFloat(rawBalance) / 1e18; // Default to 18 decimals
          }
        }

        logger.info(`💰 Token ${token.symbol} parsed balance: ${balance}`);

        // FIXED: Better token identification
        const isNativeToken =
          token.native_token ||
          token.token_address ===
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
          token.token_address ===
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
          !token.token_address; // Native tokens might not have token_address

        // FIXED: More lenient filtering - include more tokens
        if (balance <= 0) {
          // Only skip if it's not native AND not a popular token AND has truly zero balance
          if (!isNativeToken) {
            const isPopularToken = chainInfo.popularTokens.find(
              (pt) =>
                pt.address.toLowerCase() === token.token_address?.toLowerCase()
            );

            if (!isPopularToken && balance === 0) {
              logger.info(
                `⏭️ Skipping ${token.symbol} - zero balance and not popular`
              );
              continue;
            }
          }
          logger.info(
            `✅ Including ${token.symbol} despite low balance (native or popular token)`
          );
        }

        // FIXED: Less aggressive spam filtering - only skip obvious spam
        if (token.possible_spam && balance < 0.001 && !isNativeToken) {
          const isPopularToken = chainInfo.popularTokens.find(
            (pt) =>
              pt.address.toLowerCase() === token.token_address?.toLowerCase()
          );

          if (!isPopularToken) {
            logger.info(`⏭️ Skipping ${token.symbol} - low-value spam token`);
            continue;
          }
        }

        // FIXED: Better price and value parsing
        let price = 0;
        let value = 0;
        let change24h = 0;

        // Parse price and value
        if (token.usd_price !== null && token.usd_price !== undefined) {
          price = parseFloat(token.usd_price) || 0;
          value = balance * price;
        }

        if (token.usd_value !== null && token.usd_value !== undefined) {
          value = parseFloat(token.usd_value) || value;
          if (balance > 0 && value > 0) {
            price = value / balance;
          }
        }

        if (
          token.usd_price_24hr_percent_change !== null &&
          token.usd_price_24hr_percent_change !== undefined
        ) {
          change24h = parseFloat(token.usd_price_24hr_percent_change) || 0;
        }

        // Handle native token
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
            change24h: change24h,
            price: price,
            isNative: true,
            logoUrl:
              token.logo ||
              token.thumbnail ||
              this.getNativeTokenLogo(chainInfo.symbol),
            isPopular: true,
            possibleSpam: false,
            verifiedContract: token.verified_contract !== false,
          };

          processedTokens.push(processedToken);
          logger.info(
            `✅ Added native token: ${
              token.symbol
            } - Balance: ${balance}, USD: $${value.toFixed(2)}`
          );
          continue;
        }

        // Handle ERC-20 tokens
        if (token.token_address) {
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
            value: value,
            change24h: change24h,
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
            } - Balance: ${balance}, USD: $${value.toFixed(2)}`
          );
        } else {
          logger.warn(
            `⚠️ Token ${token.symbol} has no contract address, treating as native`
          );

          // Handle tokens without contract address as native-like
          const processedToken = {
            id: `unknown-${token.symbol}-${chainId}`,
            symbol: token.symbol || "UNKNOWN",
            name: token.name || "Unknown Token",
            contractAddress: "unknown",
            decimals: parseInt(token.decimals) || 18,
            balance: balance,
            balanceWei: token.balance || "0",
            value: value,
            change24h: change24h,
            price: price,
            isNative: false,
            logoUrl:
              token.logo || token.thumbnail || this.getTokenLogo(token.symbol),
            isPopular: false,
            possibleSpam: token.possible_spam || false,
            verifiedContract: token.verified_contract !== false,
          };

          processedTokens.push(processedToken);
          logger.info(
            `✅ Added unknown token: ${
              token.symbol
            } - Balance: ${balance}, USD: $${value.toFixed(2)}`
          );
        }
      } catch (error) {
        logger.warn(
          `⚠️ Error processing token ${token.token_address || token.symbol}:`,
          error.message
        );
        continue;
      }
    }

    // Sort by USD value descending, then by balance descending
    processedTokens.sort((a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return b.balance - a.balance;
    });

    // Calculate total value
    const totalValue = processedTokens.reduce(
      (sum, t) => sum + (t.value || 0),
      0
    );

    logger.info(
      `✅ Successfully processed ${processedTokens.length} tokens with balances`
    );
    logger.info(`💰 Total portfolio value: $${totalValue.toFixed(2)}`);

    // Log each processed token for debugging
    processedTokens.forEach((token, index) => {
      logger.info(
        `📋 Processed Token ${index + 1}: ${token.symbol} - Balance: ${
          token.balance
        }, Value: $${token.value.toFixed(2)}, Native: ${token.isNative}`
      );
    });

    return processedTokens;
  }

  /**
   * FIXED: Get native balance separately
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

      logger.info(
        `✅ Native balance: ${balanceFormatted} ${
          chainConfig[chainId]?.symbol || "ETH"
        }`
      );

      return {
        balance: balanceFormatted,
        balanceWei: balanceWei,
      };
    } catch (error) {
      logger.error("Error fetching native balance:", error);
      return {
        balance: 0,
        balanceWei: "0",
      };
    }
  }

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

    logger.info(
      `Cleared cache for wallet: ${walletAddress}, removed ${walletKeys.length} entries`
    );
  }

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
