// services/moralis/index.js - FIXED VERSION with preset token filtering and USD values
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
   * FIXED: Get wallet token balances with preset token filtering and USD values
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

      // FIXED: Get preset tokens for this chain
      const chainInfo = chainConfig[chainId];
      if (!chainInfo) {
        throw new Error(`Chain ${chainId} not configured`);
      }

      // Get preset token addresses (excluding native token)
      const presetTokenAddresses = chainInfo.popularTokens.map(
        (token) => token.address
      );
      logger.info(
        `📋 Preset tokens for chain ${chainId}:`,
        presetTokenAddresses
      );

      let allTokens = [];

      // STEP 1: Get native token balance and price
      logger.info("💎 Fetching native token balance...");
      try {
        const nativeResponse = await Moralis.EvmApi.balance.getNativeBalance({
          chain: chainHex,
          address: walletAddress,
        });

        if (
          nativeResponse?.result?.balance &&
          nativeResponse.result.balance !== "0"
        ) {
          const nativeBalanceWei = nativeResponse.result.balance;
          const nativeBalance = parseFloat(nativeBalanceWei) / 1e18;

          logger.info(
            `💎 Native balance: ${nativeBalance} ${chainInfo.symbol}`
          );

          // Get native token price
          let nativePrice = 0;
          try {
            const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
              chain: chainHex,
              address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH for price reference
            });
            nativePrice = parseFloat(priceResponse.result.usdPrice) || 0;
            logger.info(`💰 Native token price: $${nativePrice}`);
          } catch (priceError) {
            logger.warn(
              "⚠️ Could not fetch native token price:",
              priceError.message
            );
          }

          // Add native token to results
          allTokens.push({
            symbol: chainInfo.symbol,
            name: chainInfo.name,
            token_address: null,
            balance: nativeBalanceWei,
            balance_formatted: nativeBalance.toString(),
            decimals: 18,
            usd_price: nativePrice,
            usd_value: nativeBalance * nativePrice,
            usd_price_24hr_percent_change: 0,
            native_token: true,
            possible_spam: false,
            verified_contract: true,
            logo: null,
            thumbnail: null,
          });
        }
      } catch (nativeError) {
        logger.warn("⚠️ Error fetching native balance:", nativeError.message);
      }

      // STEP 2: Get preset token balances with USD values
      if (presetTokenAddresses.length > 0) {
        logger.info(
          "🔄 Making Moralis API call for PRESET tokens with USD values..."
        );

        try {
          const tokenResponse =
            await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
              chain: chainHex,
              address: walletAddress,
              tokenAddresses: presetTokenAddresses, // FIXED: Pass preset token addresses
            });

          logger.info("✅ Moralis preset tokens API call successful");

          // Extract token results
          let tokenResults = [];
          if (tokenResponse?.result) {
            tokenResults = tokenResponse.result;
          } else if (tokenResponse?.raw?.result) {
            tokenResults = tokenResponse.raw.result;
          } else if (tokenResponse?.raw && Array.isArray(tokenResponse.raw)) {
            tokenResults = tokenResponse.raw;
          }

          logger.info(
            `📊 Found ${tokenResults.length} preset tokens in response`
          );

          // Log first few tokens for debugging
          tokenResults.slice(0, 3).forEach((token, index) => {
            logger.info(`🪙 Preset Token ${index + 1}:`, {
              symbol: token.symbol,
              name: token.name,
              balance: token.balance,
              balance_formatted: token.balance_formatted,
              usd_value: token.usd_value,
              usd_price: token.usd_price,
              token_address: token.token_address,
            });
          });

          // Add to all tokens
          allTokens.push(...tokenResults);
        } catch (presetError) {
          logger.error("❌ Error fetching preset tokens:", presetError.message);
        }
      }

      // STEP 3: Process the combined token results
      logger.info(
        `📊 Processing ${allTokens.length} total tokens from Moralis response`
      );

      const processedTokens = await this.processTokenBalances(
        allTokens,
        chainId
      );

      // Cache the result
      cache.set(cacheKey, processedTokens);

      logger.info(
        `✅ Successfully fetched ${processedTokens.length} tokens for wallet ${walletAddress}`
      );
      return processedTokens;
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
   * FIXED: Process token balances with better USD value handling
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
          const rawBalance = token.balance.toString();
          if (token.decimals) {
            balance =
              parseFloat(rawBalance) / Math.pow(10, parseInt(token.decimals));
          } else {
            balance = parseFloat(rawBalance) / 1e18; // Default to 18 decimals
          }
        }

        logger.info(`💰 Token ${token.symbol} parsed balance: ${balance}`);

        // Skip tokens with zero balance (except native tokens)
        if (balance <= 0 && !token.native_token) {
          logger.info(`⏭️ Skipping ${token.symbol} - zero balance`);
          continue;
        }

        // FIXED: Better token identification
        const isNativeToken = token.native_token || !token.token_address;

        // FIXED: Better price and value parsing with fallback
        let price = 0;
        let value = 0;
        let change24h = 0;

        // Parse USD price and value
        if (
          token.usd_price !== null &&
          token.usd_price !== undefined &&
          token.usd_price !== 0
        ) {
          price = parseFloat(token.usd_price) || 0;
          value = balance * price;
          logger.info(
            `💵 Token ${
              token.symbol
            } - Price: $${price}, Value: $${value.toFixed(2)}`
          );
        } else if (
          token.usd_value !== null &&
          token.usd_value !== undefined &&
          token.usd_value !== 0
        ) {
          value = parseFloat(token.usd_value) || 0;
          if (balance > 0 && value > 0) {
            price = value / balance;
          }
          logger.info(
            `💵 Token ${token.symbol} - Value: $${value.toFixed(
              2
            )}, Calculated Price: $${price}`
          );
        } else {
          logger.warn(`⚠️ Token ${token.symbol} has no USD price/value data`);
        }

        // Parse 24h change
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
   * Test method to verify API connectivity and token filtering
   */
  async testMoralisCall(walletAddress, chainId) {
    try {
      await this.initialize();

      const chainHex = this.getChainHex(chainId);
      if (!chainHex) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      const chainInfo = chainConfig[chainId];
      if (!chainInfo) {
        throw new Error(`Chain ${chainId} not configured`);
      }

      const presetTokenAddresses = chainInfo.popularTokens.map(
        (token) => token.address
      );

      logger.info(
        `🧪 Testing Moralis API with preset tokens:`,
        presetTokenAddresses
      );

      const response = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice(
        {
          chain: chainHex,
          address: walletAddress,
          tokenAddresses: presetTokenAddresses,
        }
      );

      return {
        success: true,
        chainId,
        chainHex,
        presetTokenCount: presetTokenAddresses.length,
        responseTokenCount: response?.result?.length || 0,
        rawResponse: response.raw,
      };
    } catch (error) {
      logger.error("❌ Moralis test call failed:", error);
      throw error;
    }
  }

  // ... (keep all other existing methods unchanged)
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
}

module.exports = new MoralisService();
