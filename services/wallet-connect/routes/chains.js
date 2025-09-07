const express = require("express");
const ResponseUtil = require("../../../utils/response");
const { logger } = require("../../../utils/logger");
const {
  getChainById,
  isChainSupported,
  chains,
} = require("../config/walletConfig");

const router = express.Router();

// GET /api/wallet/chains/:chainId - Get specific chain information
router.get("/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId || isNaN(chainId)) {
      return ResponseUtil.validation(res, {
        chainId: "Valid chain ID is required",
      });
    }

    const chain = getChainById(parseInt(chainId));

    if (!chain) {
      return ResponseUtil.notFound(res, `Chain with ID ${chainId} not found`);
    }

    logger.info(`Chain information requested: ${chainId}`);

    return ResponseUtil.success(
      res,
      {
        chain: {
          ...chain,
          icon: `/chains/${chain.network}.svg`,
          isSupported: true,
        },
      },
      "Chain information retrieved successfully"
    );
  } catch (error) {
    logger.error("Error fetching chain information:", error);
    return ResponseUtil.serverError(res, "Failed to fetch chain information");
  }
});

// GET /api/wallet/chains/validate/:chainId - Validate if chain is supported
router.get("/validate/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId || isNaN(chainId)) {
      return ResponseUtil.validation(res, {
        chainId: "Valid chain ID is required",
      });
    }

    const isSupported = isChainSupported(parseInt(chainId));
    const chain = isSupported ? getChainById(parseInt(chainId)) : null;

    logger.info(
      `Chain validation requested: ${chainId}, supported: ${isSupported}`
    );

    return ResponseUtil.success(
      res,
      {
        chainId: parseInt(chainId),
        isSupported,
        ...(chain && { chain }),
      },
      `Chain ${chainId} validation completed`
    );
  } catch (error) {
    logger.error("Error validating chain:", error);
    return ResponseUtil.serverError(res, "Failed to validate chain");
  }
});

// GET /api/wallet/chains/search/:network - Search chain by network name
router.get("/search/:network", async (req, res) => {
  try {
    const { network } = req.params;

    if (!network) {
      return ResponseUtil.validation(res, {
        network: "Network name is required",
      });
    }

    const matchingChains = chains.filter(
      (chain) =>
        chain.network.toLowerCase().includes(network.toLowerCase()) ||
        chain.name.toLowerCase().includes(network.toLowerCase())
    );

    logger.info(
      `Chain search requested: ${network}, found: ${matchingChains.length}`
    );

    return ResponseUtil.success(
      res,
      {
        query: network,
        chains: matchingChains.map((chain) => ({
          ...chain,
          icon: `/chains/${chain.network}.svg`,
        })),
        count: matchingChains.length,
      },
      `Found ${matchingChains.length} matching chains`
    );
  } catch (error) {
    logger.error("Error searching chains:", error);
    return ResponseUtil.serverError(res, "Failed to search chains");
  }
});

module.exports = router;
