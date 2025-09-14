// services/moralis/index.js - COMPLETE REWRITE using wallet-balance.js approach
const Moralis = require("moralis").default;
const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

// Initialize cache with TTL
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 300, // 5 minutes default
  checkperiod: 60,
});

// PRESET TOKEN CONFIGURATIONS - Exact copy from wallet-balance.js
const PRESET_TOKENS = {
  1: {
    name: "Ethereum",
    chainParam: "0x1",
    tokens: [
      "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
      "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
      "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0", // MATIC
      "0x514910771af9ca656af840dff83e8264ecf986ca", // LINK
      "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", // UNI
      "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2", // SUSHI
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
      "0x4d224452801aced8b2f0aebe155379bb5d594381", // APE
      "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // AAVE
      "0xc00e94cb662c3520282e6f5717214004a7f26888", // COMP
      "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", // MKR
      "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e", // YFI
      "0xd533a949740bb3306d119cc777fa900ba034cd52", // CRV
      "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f", // SNX
      "0x111111111117dc0aa78b770fa6a738034120c302", // 1INCH
      "0x4a220e6096b25eadb88358cb44068a3248254675", // QNT
      "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", // SHIB
    ],
  },
  8453: {
    name: "Base",
    chainParam: "0x2105",
    tokens: [
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
      "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
      "0x4200000000000000000000000000000000000006", // WETH
      "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
      "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // cbETH
      "0x940181a94a35a4569e4529a3cdfb74e38fd98631", // AERO
      "0x532f27101965dd16442e59d40670faf5ebb142e4", // BRETT
      "0x78a087d713be963bf307b18f2ff8122ef9a63ae9", // BSWAP
      "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4", // TOSHI
      "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", // DEGEN
      "0xa88594d404727625a9437c3f886c7643872296ae", // WELL
      "0x0578d8a44db98b23bf096a382e016e29a5ce0ffe", // HIGHER
      "0xbd2dbb8ecea9743ca5b16423b8bb9034294747ac", // DOGINME
      "0x420000000000000000000000000000000000000a", // OP
      "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
    ],
  },
  137: {
    name: "Polygon",
    chainParam: "0x89",
    tokens: [
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC
      "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT
      "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // DAI
      "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH
      "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // WBTC
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
      "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39", // LINK
      "0xb33eaad8d922b1083446dc23f610c2567fb5180f", // UNI
      "0xd6df932a45c0f255f85145f286ea0b292b21c90b", // AAVE
      "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3", // BAL
      "0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7", // GHST
      "0xbbba073c31bf03b8acf7c28ef0738decf3695683", // SAND
      "0x61299774020da444af134c82fa83e3810b309991", // RNDR
      "0xa3fa99a148fa48d14ed51d610c367c61876997f1", // MAI
    ],
  },
  56: {
    name: "BSC",
    chainParam: "0x38",
    tokens: [
      "0x55d398326f99059ff775485246999027b3197955", // USDT
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
      "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
      "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // ETH
      "0x7130d2a12b9173bc095c", // BTCB
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
      "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", // CAKE
      "0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd", // LINK
      "0x3ee2200efb3400fabb9aacf31297cbdd1d435d47", // ADA
      "0xba2ae424d960c26247dd6c32edc70b295c744c43", // DOGE
      "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", // DAI
      "0xbf5140a22578168fd562dccf235e5d43a02ce9b1", // UNI
      "0x715d400f88c167884bbcc41c5fea407ed4d2f8a0", // AXS
      "0x3019bf2a2ef8040c242c9a4c5c4bd4c81678b2a1", // GMT
    ],
  },
  42161: {
    name: "Arbitrum",
    chainParam: "0xa4b1",
    tokens: [
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC
      "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
      "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", // WBTC
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH
      "0x912ce59144191c1204e64559fe8253a0e49e6548", // ARB
      "0xf97f4df75117a78c1a5a0dbb814af92458539fb4", // LINK
      "0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0", // UNI
      "0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a", // GMX
      "0x11cdb42b0eb46d95f990bedd4695a6e3fa034978", // CRV
      "0x17fc002b466eec40dae837fc4be5c67993ddbd6f", // FRAX
      "0x539bde0d7dbd336b79148aa742883198bbf60342", // MAGIC
      "0xd4d42f0b6def4ce0383636770ef773390d85c61a", // SUSHI
    ],
  },
  43114: {
    name: "Avalanche",
    chainParam: "0xa86a",
    tokens: [
      "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", // USDT
      "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", // USDC
      "0xd586e7f844cea2f87f50152665bcbc2c279d8d70", // DAI
      "0x50b7545627a5162f82a992c33b87adc75187b218", // WBTC
      "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab", // WETH
      "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", // WAVAX
      "0x5947bb275c521040051d82396192181b413227a3", // LINK
      "0x8eb8a3b98659cce290402893d0123abb75e3ab28", // AAVE
      "0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd", // JOE
      "0x60781c2586d68229fde47564546784ab3faca982", // PNG
      "0x2b2c81e08f1af8835a78bb2a90ae924ace0ea4be", // sAVAX
      "0x59414b3089ce2af0010e7523dea7e2b35d776ec7", // YAK
    ],
  },
};

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
      logger.info("✅ Moralis service initialized successfully");
    } catch (error) {
      logger.error("❌ Failed to initialize Moralis service", error);
      throw error;
    }
  }

  // EXACT COPY: Categorize tokens function from wallet-balance.js
  categorizeTokens(allTokens, chainId) {
    const presetTokenAddresses =
      PRESET_TOKENS[chainId]?.tokens.map((addr) => addr.toLowerCase()) || [];

    const displayedTokens = [];
    const hiddenTokens = [];

    allTokens.forEach((token) => {
      if (
        token.native_token ||
        token.token_address === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      ) {
        displayedTokens.push(token);
      } else if (
        presetTokenAddresses.includes(token.token_address.toLowerCase())
      ) {
        displayedTokens.push(token);
      } else {
        hiddenTokens.push(token);
      }
    });

    return { displayedTokens, hiddenTokens };
  }

  // EXACT COPY: Main wallet token balance function from wallet-balance.js
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

      const chainConfig = PRESET_TOKENS[chainId];
      if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      logger.info(
        `🔗 Using chain hex: ${chainConfig.chainParam} for chain ID: ${chainId}`
      );

      // Get all tokens with prices - EXACT MORALIS CALL
      logger.info("📡 Making Moralis API call for tokens with prices...");

      const response = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice(
        {
          chain: chainConfig.chainParam,
          address: walletAddress,
        }
      );

      const result = response.toJSON();
      const allTokens = result.result || [];

      const tokensWithBalance = allTokens.filter(
        (token) => token.balance !== "0" && token.balance !== 0
      );

      if (tokensWithBalance.length === 0) {
        logger.info("No tokens with balance found.");
        const emptyResult = {
          displayedTokens: [],
          hiddenTokens: [],
          totalValue: 0,
          total24hrChange: 0,
        };
        cache.set(cacheKey, emptyResult);
        return emptyResult;
      }

      // EXACT COPY: Categorize tokens
      const { displayedTokens, hiddenTokens } = this.categorizeTokens(
        tokensWithBalance,
        chainId
      );

      // EXACT COPY: Calculate totals
      const totalValue = [...displayedTokens, ...hiddenTokens].reduce(
        (sum, t) => {
          const value = parseFloat(t.usd_value) || 0;
          return sum + value;
        },
        0
      );

      const total24hrChange = [...displayedTokens, ...hiddenTokens].reduce(
        (sum, t) => {
          const change = parseFloat(t.usd_value_24hr_usd_change) || 0;
          return sum + change;
        },
        0
      );

      const finalResult = {
        displayedTokens,
        hiddenTokens,
        totalValue,
        total24hrChange,
        chainName: chainConfig.name,
      };

      // Cache the result
      cache.set(cacheKey, finalResult);

      logger.info(
        `✅ Successfully processed tokens for wallet ${walletAddress}`
      );
      logger.info(`💰 Total portfolio value: $${totalValue.toFixed(3)}`);
      logger.info(
        `📈 24hr Portfolio Change: ${
          total24hrChange >= 0 ? "+" : ""
        }$${Math.abs(total24hrChange).toFixed(3)}`
      );
      logger.info(`📊 Showing: ${displayedTokens.length} preset tokens`);
      logger.info(
        `💡 Found ${hiddenTokens.length} additional token(s) not in preset list.`
      );

      return finalResult;
    } catch (error) {
      logger.error("❌ Error fetching wallet token balances", {
        wallet: walletAddress,
        chain: chainId,
        error: error.message,
      });

      // Return empty result instead of throwing
      return {
        displayedTokens: [],
        hiddenTokens: [],
        totalValue: 0,
        total24hrChange: 0,
        chainName: PRESET_TOKENS[chainId]?.name || "Unknown",
      };
    }
  }

  // Enhanced native balance with same approach
  async getNativeBalance(walletAddress, chainId) {
    try {
      await this.initialize();

      const chainConfig = PRESET_TOKENS[chainId];
      if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      logger.info(
        `💎 Fetching native balance for ${walletAddress} on chain ${chainId}`
      );

      const response = await Moralis.EvmApi.balance.getNativeBalance({
        chain: chainConfig.chainParam,
        address: walletAddress,
      });

      const balanceWei = response.result?.balance || "0";
      const balanceFormatted = parseFloat(balanceWei) / 1e18;

      logger.info(`✅ Native balance: ${balanceFormatted} ${chainConfig.name}`);

      return {
        balance: balanceFormatted,
        balanceWei: balanceWei,
        symbol:
          chainConfig.name === "Ethereum"
            ? "ETH"
            : chainConfig.name.substring(0, 4).toUpperCase(),
      };
    } catch (error) {
      logger.error("❌ Error fetching native balance:", error);
      return {
        balance: 0,
        balanceWei: "0",
        symbol: "ETH",
      };
    }
  }

  getSupportedChains() {
    return Object.keys(PRESET_TOKENS).map((chainId) => ({
      chainId: parseInt(chainId),
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
