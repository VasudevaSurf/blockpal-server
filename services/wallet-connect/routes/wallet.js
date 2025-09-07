const express = require("express");
const WalletController = require("../controllers/walletController");

const router = express.Router();

// GET /api/wallet/config - Get wallet configuration
router.get("/config", WalletController.getConfig);

// GET /api/wallet/chains - Get supported chains
router.get("/chains", WalletController.getChains);

// GET /api/wallet/wallets - Get supported wallets
router.get("/wallets", WalletController.getWallets);

// POST /api/wallet/connect - Connect wallet
router.post("/connect", WalletController.connect);

// POST /api/wallet/disconnect - Disconnect wallet
router.post("/disconnect", WalletController.disconnect);

// POST /api/wallet/switch-chain - Switch blockchain network
router.post("/switch-chain", WalletController.switchChain);

// GET /api/wallet/status/:sessionId - Get wallet connection status
router.get("/status/:sessionId", WalletController.getStatus);

// GET /api/wallet/connected - Get all connected wallets (debug)
router.get("/connected", WalletController.getConnectedWallets);

// GET /api/wallet/health - Health check for wallet service
router.get("/health", WalletController.healthCheck);

module.exports = router;
