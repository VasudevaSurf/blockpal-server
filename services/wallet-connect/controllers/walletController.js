const ResponseUtil = require("../../../utils/response");
const { logger } = require("../../../utils/logger");
const {
  getClientConfig,
  getChainById,
  isChainSupported,
  getSupportedChainIds,
} = require("../config/walletConfig");

// In-memory storage for connected wallets (use Redis in production)
const connectedWallets = new Map();
const walletSessions = new Map();

class WalletController {
  // Get wallet configuration for client
  static async getConfig(req, res) {
    try {
      logger.info("Fetching wallet configuration");

      const config = getClientConfig();

      return ResponseUtil.success(
        res,
        config,
        "Wallet configuration retrieved successfully"
      );
    } catch (error) {
      logger.error("Error fetching wallet config:", error);
      return ResponseUtil.serverError(
        res,
        "Failed to fetch wallet configuration"
      );
    }
  }

  // Get supported chains
  static async getChains(req, res) {
    try {
      logger.info("Fetching supported chains");

      const config = getClientConfig();

      return ResponseUtil.success(
        res,
        {
          chains: config.chains,
          defaultChainId: config.chains[0].id,
        },
        "Supported chains retrieved successfully"
      );
    } catch (error) {
      logger.error("Error fetching chains:", error);
      return ResponseUtil.serverError(res, "Failed to fetch supported chains");
    }
  }

  // Get supported wallets
  static async getWallets(req, res) {
    try {
      logger.info("Fetching supported wallets");

      const config = getClientConfig();

      return ResponseUtil.success(
        res,
        {
          wallets: config.wallets,
          projectId: config.projectId,
        },
        "Supported wallets retrieved successfully"
      );
    } catch (error) {
      logger.error("Error fetching wallets:", error);
      return ResponseUtil.serverError(res, "Failed to fetch supported wallets");
    }
  }

  // Connect wallet
  static async connect(req, res) {
    try {
      const { address, chainId, walletType, sessionId } = req.body;

      // Validate required fields
      if (!address || !chainId || !walletType) {
        return ResponseUtil.validation(res, {
          address: !address ? "Wallet address is required" : null,
          chainId: !chainId ? "Chain ID is required" : null,
          walletType: !walletType ? "Wallet type is required" : null,
        });
      }

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return ResponseUtil.validation(res, {
          address: "Invalid wallet address format",
        });
      }

      // Validate chain support
      if (!isChainSupported(chainId)) {
        return ResponseUtil.validation(res, {
          chainId: `Chain ID ${chainId} is not supported`,
        });
      }

      const chain = getChainById(chainId);
      const walletId = `${address}_${chainId}`;
      const session = sessionId || require("uuid").v4();

      // Store wallet connection
      const walletData = {
        id: walletId,
        address,
        chainId: parseInt(chainId),
        chain,
        walletType,
        sessionId: session,
        connectedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };

      connectedWallets.set(walletId, walletData);
      walletSessions.set(session, walletId);

      logger.info("Wallet connected successfully", {
        address: address.substring(0, 8) + "...",
        chainId,
        walletType,
        sessionId: session,
      });

      return ResponseUtil.success(
        res,
        {
          walletId,
          sessionId: session,
          address,
          chain,
          walletType,
          connectedAt: walletData.connectedAt,
        },
        "Wallet connected successfully"
      );
    } catch (error) {
      logger.error("Error connecting wallet:", error);
      return ResponseUtil.serverError(res, "Failed to connect wallet");
    }
  }

  // Disconnect wallet
  static async disconnect(req, res) {
    try {
      const { sessionId, walletId } = req.body;

      if (!sessionId && !walletId) {
        return ResponseUtil.validation(res, {
          session: "Either sessionId or walletId is required",
        });
      }

      let targetWalletId = walletId;

      if (sessionId && !walletId) {
        targetWalletId = walletSessions.get(sessionId);
      }

      if (!targetWalletId || !connectedWallets.has(targetWalletId)) {
        return ResponseUtil.notFound(res, "Wallet session not found");
      }

      const walletData = connectedWallets.get(targetWalletId);

      // Remove from storage
      connectedWallets.delete(targetWalletId);
      if (walletData.sessionId) {
        walletSessions.delete(walletData.sessionId);
      }

      logger.info("Wallet disconnected successfully", {
        address: walletData.address.substring(0, 8) + "...",
        sessionId: walletData.sessionId,
      });

      return ResponseUtil.success(
        res,
        null,
        "Wallet disconnected successfully"
      );
    } catch (error) {
      logger.error("Error disconnecting wallet:", error);
      return ResponseUtil.serverError(res, "Failed to disconnect wallet");
    }
  }

  // Switch chain
  static async switchChain(req, res) {
    try {
      const { sessionId, chainId } = req.body;

      if (!sessionId || !chainId) {
        return ResponseUtil.validation(res, {
          sessionId: !sessionId ? "Session ID is required" : null,
          chainId: !chainId ? "Chain ID is required" : null,
        });
      }

      // Validate chain support
      if (!isChainSupported(chainId)) {
        return ResponseUtil.validation(res, {
          chainId: `Chain ID ${chainId} is not supported`,
        });
      }

      const walletId = walletSessions.get(sessionId);
      if (!walletId || !connectedWallets.has(walletId)) {
        return ResponseUtil.notFound(res, "Wallet session not found");
      }

      const walletData = connectedWallets.get(walletId);
      const newChain = getChainById(chainId);

      // Update wallet data
      const newWalletId = `${walletData.address}_${chainId}`;
      const updatedWalletData = {
        ...walletData,
        id: newWalletId,
        chainId: parseInt(chainId),
        chain: newChain,
        lastActivity: new Date().toISOString(),
      };

      // Remove old entry and add new one
      connectedWallets.delete(walletId);
      connectedWallets.set(newWalletId, updatedWalletData);
      walletSessions.set(sessionId, newWalletId);

      logger.info("Chain switched successfully", {
        address: walletData.address.substring(0, 8) + "...",
        fromChain: walletData.chainId,
        toChain: chainId,
        sessionId,
      });

      return ResponseUtil.success(
        res,
        {
          walletId: newWalletId,
          chain: newChain,
          address: walletData.address,
          switchedAt: updatedWalletData.lastActivity,
        },
        "Chain switched successfully"
      );
    } catch (error) {
      logger.error("Error switching chain:", error);
      return ResponseUtil.serverError(res, "Failed to switch chain");
    }
  }

  // Get wallet status
  static async getStatus(req, res) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return ResponseUtil.validation(res, {
          sessionId: "Session ID is required",
        });
      }

      const walletId = walletSessions.get(sessionId);
      if (!walletId || !connectedWallets.has(walletId)) {
        return ResponseUtil.notFound(res, "Wallet session not found");
      }

      const walletData = connectedWallets.get(walletId);

      // Update last activity
      walletData.lastActivity = new Date().toISOString();
      connectedWallets.set(walletId, walletData);

      return ResponseUtil.success(
        res,
        {
          isConnected: true,
          wallet: {
            id: walletData.id,
            address: walletData.address,
            chain: walletData.chain,
            walletType: walletData.walletType,
            connectedAt: walletData.connectedAt,
            lastActivity: walletData.lastActivity,
          },
        },
        "Wallet status retrieved successfully"
      );
    } catch (error) {
      logger.error("Error getting wallet status:", error);
      return ResponseUtil.serverError(res, "Failed to get wallet status");
    }
  }

  // Get connected wallets (for debugging)
  static async getConnectedWallets(req, res) {
    try {
      const wallets = Array.from(connectedWallets.values()).map((wallet) => ({
        id: wallet.id,
        address:
          wallet.address.substring(0, 8) +
          "..." +
          wallet.address.substring(wallet.address.length - 6),
        chain: wallet.chain.name,
        chainId: wallet.chainId,
        walletType: wallet.walletType,
        connectedAt: wallet.connectedAt,
        lastActivity: wallet.lastActivity,
      }));

      return ResponseUtil.success(
        res,
        {
          wallets,
          count: wallets.length,
        },
        "Connected wallets retrieved successfully"
      );
    } catch (error) {
      logger.error("Error getting connected wallets:", error);
      return ResponseUtil.serverError(res, "Failed to get connected wallets");
    }
  }

  // Health check for wallet service
  static async healthCheck(req, res) {
    try {
      const supportedChainIds = getSupportedChainIds();

      return ResponseUtil.success(
        res,
        {
          service: "wallet-connect",
          status: "healthy",
          supportedChains: supportedChainIds.length,
          connectedWallets: connectedWallets.size,
          activeSessions: walletSessions.size,
          timestamp: new Date().toISOString(),
        },
        "Wallet service is healthy"
      );
    } catch (error) {
      logger.error("Wallet service health check failed:", error);
      return ResponseUtil.serverError(res, "Wallet service is unhealthy");
    }
  }
}

module.exports = WalletController;
