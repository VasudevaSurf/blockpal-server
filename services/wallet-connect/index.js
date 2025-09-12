// services/wallet-connect/index.js - Wallet Connect service
const express = require("express");
const rateLimit = require("express-rate-limit");
const { logger } = require("../../utils/logger");
const ResponseUtil = require("../../utils/response");

const router = express.Router();

// Rate limiting for wallet endpoints
const walletRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: "Too many wallet requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(walletRateLimit);

// Store wallet sessions (in production, use Redis or database)
const walletSessions = new Map();

/**
 * POST /api/wallet/connect
 * Initialize wallet connection
 */
router.post("/connect", async (req, res) => {
  try {
    const { walletAddress, chainId, walletType } = req.body;

    // Validation
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return ResponseUtil.validation(res, "Invalid wallet address format");
    }

    if (!chainId || isNaN(parseInt(chainId))) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    if (!walletType) {
      return ResponseUtil.validation(res, "Wallet type is required");
    }

    logger.info(`Wallet connection request`, {
      walletAddress,
      chainId,
      walletType,
    });

    // Generate session ID
    const sessionId = require("uuid").v4();

    // Store wallet session
    const sessionData = {
      id: sessionId,
      walletAddress: walletAddress.toLowerCase(),
      chainId: parseInt(chainId),
      walletType,
      connected: true,
      connectedAt: new Date().toISOString(),
    };

    walletSessions.set(sessionId, sessionData);

    const response = {
      sessionId,
      walletAddress: sessionData.walletAddress,
      chainId: sessionData.chainId,
      walletType,
      status: "connected",
    };

    return ResponseUtil.success(res, response, "Wallet connected successfully");
  } catch (error) {
    logger.error("Error in wallet connect", {
      error: error.message,
      stack: error.stack,
    });

    return ResponseUtil.serverError(res, "Failed to connect wallet");
  }
});

/**
 * POST /api/wallet/disconnect
 * Disconnect wallet
 */
router.post("/disconnect", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return ResponseUtil.validation(res, "Session ID is required");
    }

    const session = walletSessions.get(sessionId);
    if (!session) {
      return ResponseUtil.notFound(res, "Wallet session not found");
    }

    // Remove session
    walletSessions.delete(sessionId);

    logger.info(`Wallet disconnected`, {
      sessionId,
      walletAddress: session.walletAddress,
    });

    return ResponseUtil.success(res, null, "Wallet disconnected successfully");
  } catch (error) {
    logger.error("Error in wallet disconnect", {
      error: error.message,
      stack: error.stack,
    });

    return ResponseUtil.serverError(res, "Failed to disconnect wallet");
  }
});

/**
 * GET /api/wallet/session/:sessionId
 * Get wallet session info
 */
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return ResponseUtil.validation(res, "Session ID is required");
    }

    const session = walletSessions.get(sessionId);
    if (!session) {
      return ResponseUtil.notFound(res, "Wallet session not found");
    }

    return ResponseUtil.success(res, session, "Session retrieved successfully");
  } catch (error) {
    logger.error("Error getting wallet session", {
      sessionId: req.params.sessionId,
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to get wallet session");
  }
});

/**
 * POST /api/wallet/switch-chain
 * Switch wallet chain
 */
router.post("/switch-chain", async (req, res) => {
  try {
    const { sessionId, chainId } = req.body;

    if (!sessionId) {
      return ResponseUtil.validation(res, "Session ID is required");
    }

    if (!chainId || isNaN(parseInt(chainId))) {
      return ResponseUtil.validation(res, "Invalid chain ID");
    }

    const session = walletSessions.get(sessionId);
    if (!session) {
      return ResponseUtil.notFound(res, "Wallet session not found");
    }

    // Update session with new chain
    session.chainId = parseInt(chainId);
    session.lastActivity = new Date().toISOString();

    walletSessions.set(sessionId, session);

    logger.info(`Chain switched`, {
      sessionId,
      walletAddress: session.walletAddress,
      newChainId: chainId,
    });

    const response = {
      sessionId,
      walletAddress: session.walletAddress,
      chainId: session.chainId,
      status: "chain_switched",
    };

    return ResponseUtil.success(res, response, "Chain switched successfully");
  } catch (error) {
    logger.error("Error switching chain", {
      sessionId: req.body.sessionId,
      chainId: req.body.chainId,
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to switch chain");
  }
});

/**
 * GET /api/wallet/sessions
 * Get all active wallet sessions (for debugging)
 */
router.get("/sessions", async (req, res) => {
  try {
    const sessions = Array.from(walletSessions.values());

    const response = {
      sessions,
      count: sessions.length,
    };

    return ResponseUtil.success(
      res,
      response,
      "Active sessions retrieved successfully"
    );
  } catch (error) {
    logger.error("Error getting wallet sessions", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to get wallet sessions");
  }
});

/**
 * DELETE /api/wallet/sessions
 * Clear all wallet sessions (for debugging)
 */
router.delete("/sessions", async (req, res) => {
  try {
    const sessionCount = walletSessions.size;
    walletSessions.clear();

    logger.info(`Cleared ${sessionCount} wallet sessions`);

    return ResponseUtil.success(
      res,
      { clearedSessions: sessionCount },
      "All sessions cleared successfully"
    );
  } catch (error) {
    logger.error("Error clearing wallet sessions", {
      error: error.message,
    });

    return ResponseUtil.serverError(res, "Failed to clear wallet sessions");
  }
});

/**
 * GET /api/wallet/health
 * Health check for wallet service
 */
router.get("/health", async (req, res) => {
  try {
    const health = {
      status: "healthy",
      service: "Wallet Connect Service",
      activeSessions: walletSessions.size,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(health);
  } catch (error) {
    logger.error("Error in wallet health check", {
      error: error.message,
    });

    return res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Clean up expired sessions (run every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  let expiredCount = 0;
  for (const [sessionId, session] of walletSessions.entries()) {
    const sessionAge = now - new Date(session.connectedAt).getTime();
    if (sessionAge > maxAge) {
      walletSessions.delete(sessionId);
      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    logger.info(`Cleaned up ${expiredCount} expired wallet sessions`);
  }
}, 5 * 60 * 1000); // 5 minutes

module.exports = router;
