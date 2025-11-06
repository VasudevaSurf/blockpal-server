// services/moralis/index.js - ✅ FIXED: Full Solana Support
const Moralis = require("moralis").default;
const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 300,
  checkperiod: 60,
});

// ✅ FIXED: Add Solana to preset tokens
const PRESET_TOKENS = {
  1: {
    name: "Ethereum",
    chainParam: "0x1",
    tokens: [
      "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
      // ... rest of Ethereum tokens
    ],
  },
  8453: {
    name: "Base",
    chainParam: "0x2105",
    tokens: [
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
      // ... rest of Base tokens
    ],
  },
  // ... other EVM chains
  solana: {
    name: "Solana",
    chainParam: "mainnet", // Moralis uses "mainnet" for Solana
    tokens: [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
      "So11111111111111111111111111111111111111112", // SOL (wrapped)
      "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
      "SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt", // SRM
      "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", // ORCA
      "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac", // MNGO
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
      "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", // JTO
    ],
  },
};

class MoralisService {
  constructor() {
    this.initialized = false;
    this.apiKey = process.env.MORALIS_API_KEY;
    this.PRESET_TOKENS = PRESET_TOKENS;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      if (!this.apiKey) {
        throw new Error("MORALIS_API_KEY is required");
      }

      logger.info("🔑 Initializing Moralis with API Key");

      await Moralis.start({
        apiKey: this.apiKey,
      });

      this.initialized = true;
      logger.info("✅ Moralis service initialized successfully");
    } catch (error) {
      logger.error("❌ Failed to initialize Moralis service", error);
      throw error;
    }
  }

  categorizeTokens(allTokens, chainId) {
    const isSolana = chainId === "solana" || chainId === "solana:mainnet";
    const presetTokenAddresses =
      PRESET_TOKENS[chainId]?.tokens.map((addr) =>
        isSolana ? addr : addr.toLowerCase()
      ) || [];

    const displayedTokens = [];
    const hiddenTokens = [];

    allTokens.forEach((token) => {
      const tokenAddress = isSolana
        ? token.token_address
        : token.token_address.toLowerCase();

      if (
        token.native_token ||
        (isSolana && token.symbol === "SOL") ||
        (!isSolana &&
          token.token_address === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
      ) {
        displayedTokens.push(token);
      } else if (presetTokenAddresses.includes(tokenAddress)) {
        displayedTokens.push(token);
      } else {
        hiddenTokens.push(token);
      }
    });

    return { displayedTokens, hiddenTokens };
  }

  async getWalletTokenBalances(walletAddress, chainId) {
    try {
      await this.initialize();

      const isSolana = chainId === "solana" || chainId === "solana:mainnet";
      const cacheKey = `wallet_tokens_${walletAddress}_${chainId}`;
      const cached = cache.get(cacheKey);

      if (cached && process.env.ENABLE_CACHE !== "false") {
        logger.info(
          `📦 Cache hit for wallet tokens: ${walletAddress} on chain ${chainId}`
        );
        return cached;
      }

      logger.info(
        `🔍 Fetching token balances for wallet: ${walletAddress} on chain: ${chainId} (Solana: ${isSolana})`
      );

      const chainConfig = PRESET_TOKENS[chainId];
      if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      logger.info(
        `🔗 Using chain param: ${chainConfig.chainParam} for chain ID: ${chainId}`
      );

      let response;

      if (isSolana) {
        // ✅ Use Moralis Solana API
        logger.info("📡 Making Moralis Solana API call...");
        response = await Moralis.SolApi.account.getPortfolio({
          network: "mainnet",
          address: walletAddress,
        });
      } else {
        // Use EVM API
        logger.info("📡 Making Moralis EVM API call...");
        response = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
          chain: chainConfig.chainParam,
          address: walletAddress,
        });
      }

      const result = response.toJSON();
      const allTokens = isSolana ? result.tokens || [] : result.result || [];

      const tokensWithBalance = allTokens.filter(
        (token) => token.balance !== "0" && token.balance !== 0
      );

      if (tokensWithBalance.length === 0) {
        logger.info("No tokens with balance found.");
        const emptyResult = {
          displayedTokens: [],
          hiddenTokens: [],
          totalValue: 0,
          mainListValue: 0,
          total24hrChange: 0,
          mainList24hrChange: 0,
          chainName: chainConfig.name,
        };
        cache.set(cacheKey, emptyResult);
        return emptyResult;
      }

      const { displayedTokens, hiddenTokens } = this.categorizeTokens(
        tokensWithBalance,
        chainId
      );

      const mainListValue = displayedTokens.reduce((sum, t) => {
        const value = parseFloat(t.usd_value || t.value_usd) || 0;
        return sum + value;
      }, 0);

      const mainList24hrChange = displayedTokens.reduce((sum, t) => {
        const change =
          parseFloat(t.usd_value_24hr_usd_change || t.value_usd_24hr_change) ||
          0;
        return sum + change;
      }, 0);

      const totalValue = [...displayedTokens, ...hiddenTokens].reduce(
        (sum, t) => {
          const value = parseFloat(t.usd_value || t.value_usd) || 0;
          return sum + value;
        },
        0
      );

      const total24hrChange = [...displayedTokens, ...hiddenTokens].reduce(
        (sum, t) => {
          const change =
            parseFloat(
              t.usd_value_24hr_usd_change || t.value_usd_24hr_change
            ) || 0;
          return sum + change;
        },
        0
      );

      const finalResult = {
        displayedTokens,
        hiddenTokens,
        totalValue,
        mainListValue,
        total24hrChange: mainList24hrChange,
        mainList24hrChange,
        all24hrChange: total24hrChange,
        chainName: chainConfig.name,
      };

      cache.set(cacheKey, finalResult);

      logger.info(
        `✅ Successfully processed tokens for ${
          isSolana ? "Solana" : "EVM"
        } wallet ${walletAddress}`
      );
      logger.info(
        `💰 Main List Value: $${mainListValue.toFixed(3)} (${
          displayedTokens.length
        } tokens)`
      );
      logger.info(
        `📊 Total Portfolio Value: $${totalValue.toFixed(3)} (${
          displayedTokens.length + hiddenTokens.length
        } tokens)`
      );

      return finalResult;
    } catch (error) {
      logger.error("❌ Error fetching wallet token balances", {
        wallet: walletAddress,
        chain: chainId,
        error: error.message,
      });

      return {
        displayedTokens: [],
        hiddenTokens: [],
        totalValue: 0,
        mainListValue: 0,
        total24hrChange: 0,
        mainList24hrChange: 0,
        chainName: PRESET_TOKENS[chainId]?.name || "Unknown",
      };
    }
  }

  async getNativeBalance(walletAddress, chainId) {
    try {
      await this.initialize();

      const isSolana = chainId === "solana" || chainId === "solana:mainnet";
      const chainConfig = PRESET_TOKENS[chainId];

      if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      logger.info(
        `💎 Fetching native balance for ${walletAddress} on chain ${chainId}`
      );

      let balanceFormatted;
      let balanceWei;

      if (isSolana) {
        const response = await Moralis.SolApi.account.getBalance({
          network: "mainnet",
          address: walletAddress,
        });

        const result = response.toJSON();
        balanceWei = result.lamports || "0";
        balanceFormatted = parseFloat(balanceWei) / 1e9; // SOL has 9 decimals
      } else {
        const response = await Moralis.EvmApi.balance.getNativeBalance({
          chain: chainConfig.chainParam,
          address: walletAddress,
        });

        balanceWei = response.result?.balance || "0";
        balanceFormatted = parseFloat(balanceWei) / 1e18;
      }

      logger.info(`✅ Native balance: ${balanceFormatted} ${chainConfig.name}`);

      return {
        balance: balanceFormatted,
        balanceWei: balanceWei,
        symbol: isSolana
          ? "SOL"
          : chainConfig.name === "Ethereum"
          ? "ETH"
          : chainConfig.name.substring(0, 4).toUpperCase(),
      };
    } catch (error) {
      logger.error("❌ Error fetching native balance:", error);
      return {
        balance: 0,
        balanceWei: "0",
        symbol: chainId === "solana" ? "SOL" : "ETH",
      };
    }
  }

  getSupportedChains() {
    return Object.keys(PRESET_TOKENS).map((chainId) => ({
      chainId: chainId,
      name: PRESET_TOKENS[chainId].name,
      tokenCount: PRESET_TOKENS[chainId].tokens.length,
    }));
  }

  clearWalletCache(walletAddress) {
    const keys = cache.keys();
    const walletKeys = keys.filter((key) => key.includes(walletAddress));
    walletKeys.forEach((key) => cache.del(key));

    logger.info(
      `🗑️ Cleared cache for wallet: ${walletAddress}, removed ${walletKeys.length} entries`
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
