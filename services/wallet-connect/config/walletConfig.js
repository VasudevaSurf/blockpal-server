// Wallet Connect Configuration for Server
const { logger } = require("../../../utils/logger");

const projectId =
  process.env.WALLET_CONNECT_PROJECT_ID || "ccbe76e1a5fcc580ca233ed69c4d09cb";

// Supported chains configuration
const chains = [
  {
    id: 1,
    name: "Ethereum",
    network: "mainnet",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ["https://eth.llamarpc.com"] },
      public: { http: ["https://eth.llamarpc.com"] },
    },
    blockExplorers: {
      default: { name: "Etherscan", url: "https://etherscan.io" },
    },
  },
  {
    id: 8453,
    name: "Base",
    network: "base",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ["https://mainnet.base.org"] },
      public: { http: ["https://mainnet.base.org"] },
    },
    blockExplorers: {
      default: { name: "BaseScan", url: "https://basescan.org" },
    },
  },
  {
    id: 42161,
    name: "Arbitrum One",
    network: "arbitrum",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ["https://arb1.arbitrum.io/rpc"] },
      public: { http: ["https://arb1.arbitrum.io/rpc"] },
    },
    blockExplorers: {
      default: { name: "Arbiscan", url: "https://arbiscan.io" },
    },
  },
  {
    id: 43114,
    name: "Avalanche",
    network: "avalanche",
    nativeCurrency: {
      name: "Avalanche",
      symbol: "AVAX",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ["https://api.avax.network/ext/bc/C/rpc"] },
      public: { http: ["https://api.avax.network/ext/bc/C/rpc"] },
    },
    blockExplorers: {
      default: { name: "SnowTrace", url: "https://snowtrace.io" },
    },
  },
  {
    id: 56,
    name: "BNB Smart Chain",
    network: "bsc",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ["https://bsc-dataseed1.binance.org"] },
      public: { http: ["https://bsc-dataseed1.binance.org"] },
    },
    blockExplorers: {
      default: { name: "BscScan", url: "https://bscscan.com" },
    },
  },
  {
    id: 137,
    name: "Polygon",
    network: "polygon",
    nativeCurrency: {
      name: "MATIC",
      symbol: "MATIC",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ["https://polygon-rpc.com"] },
      public: { http: ["https://polygon-rpc.com"] },
    },
    blockExplorers: {
      default: { name: "PolygonScan", url: "https://polygonscan.com" },
    },
  },
];

// Supported wallets configuration
const supportedWallets = [
  {
    id: "metamask",
    name: "MetaMask",
    description: "Connect using browser wallet or mobile app",
    icon: "/wallets/metamask.svg",
    mobile: true,
    desktop: true,
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    description: "Scan with WalletConnect to connect",
    icon: "/wallets/walletconnect.svg",
    mobile: true,
    desktop: true,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    description: "Connect using Coinbase Wallet",
    icon: "/wallets/coinbase.svg",
    mobile: true,
    desktop: true,
  },
  {
    id: "trust",
    name: "Trust Wallet",
    description: "Connect using Trust Wallet",
    icon: "/wallets/trust.svg",
    mobile: true,
    desktop: false,
  },
  {
    id: "rainbow",
    name: "Rainbow",
    description: "Connect using Rainbow wallet",
    icon: "/wallets/rainbow.svg",
    mobile: true,
    desktop: false,
  },
];

// Wallet configuration validation
const validateWalletConfig = () => {
  if (!projectId) {
    logger.error("WalletConnect Project ID is required");
    throw new Error("WalletConnect Project ID is required");
  }

  if (chains.length === 0) {
    logger.error("At least one chain must be configured");
    throw new Error("At least one chain must be configured");
  }

  logger.info("Wallet configuration validated successfully", {
    projectId: projectId.substring(0, 8) + "...",
    chainsCount: chains.length,
    walletsCount: supportedWallets.length,
  });
};

// Get chain by ID
const getChainById = (chainId) => {
  return chains.find((chain) => chain.id === parseInt(chainId));
};

// Get default chain
const getDefaultChain = () => {
  return chains[0]; // Ethereum mainnet as default
};

// Check if chain is supported
const isChainSupported = (chainId) => {
  return chains.some((chain) => chain.id === parseInt(chainId));
};

// Get all chain IDs
const getSupportedChainIds = () => {
  return chains.map((chain) => chain.id);
};

// Get wallet configuration for client
const getClientConfig = () => {
  return {
    projectId,
    chains: chains.map((chain) => ({
      id: chain.id,
      name: chain.name,
      network: chain.network,
      nativeCurrency: chain.nativeCurrency,
      icon: `/chains/${chain.network}.svg`,
    })),
    wallets: supportedWallets,
    metadata: {
      name: "Blockpal",
      description: "Multi-Chain DAPP",
      url: process.env.APP_URL || "http://localhost:3000",
      icons: ["/logo.png"],
    },
  };
};

module.exports = {
  projectId,
  chains,
  supportedWallets,
  validateWalletConfig,
  getChainById,
  getDefaultChain,
  isChainSupported,
  getSupportedChainIds,
  getClientConfig,
};
