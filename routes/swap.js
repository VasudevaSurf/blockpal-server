// routes/swap.js - Enhanced version matching standalone
const express = require("express");
const axios = require("axios");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");

const router = express.Router();

// 1inch API configuration
const ONEINCH_API_KEY =
  process.env.ONEINCH_API_KEY || "7TD80y4Tuv1jeN0QuUbzUw2NT2N9qTwb";
const ONEINCH_BASE_URL = "https://api.1inch.dev/swap/v6.1";

// Get tokens for a specific chain (FIXED to match standalone)
router.get("/tokens/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const tokens = response.data?.tokens || {};

    // Return in the format expected by frontend
    return ResponseUtil.success(res, {
      tokens: tokens,
      count: Object.keys(tokens).length,
    });
  } catch (error) {
    logger.error("Error fetching tokens:", error.message);
    // Return empty tokens instead of error
    return ResponseUtil.success(res, {
      tokens: {},
      count: 0,
    });
  }
});

// Search tokens endpoint (ENHANCED)
router.get("/search/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { query } = req.query;

  try {
    // If no query, return popular tokens
    if (!query) {
      const response = await axios.get(
        `${ONEINCH_BASE_URL}/${chainId}/tokens`,
        {
          headers: {
            Authorization: `Bearer ${ONEINCH_API_KEY}`,
            Accept: "application/json",
          },
        }
      );

      const tokens = Object.values(response.data?.tokens || {});
      const popularSymbols = [
        "ETH",
        "WETH",
        "USDT",
        "USDC",
        "DAI",
        "WBTC",
        "UNI",
        "LINK",
        "AAVE",
        "MATIC",
        "BNB",
        "AVAX",
      ];

      const popularTokens = tokens
        .filter((token) => popularSymbols.includes(token.symbol?.toUpperCase()))
        .sort((a, b) => {
          const aIndex = popularSymbols.indexOf(a.symbol?.toUpperCase());
          const bIndex = popularSymbols.indexOf(b.symbol?.toUpperCase());
          return aIndex - bIndex;
        })
        .slice(0, 100);

      return ResponseUtil.success(res, popularTokens);
    }

    // Try search API first
    try {
      const searchResponse = await axios.get(
        `https://api.1inch.dev/token/v1.2/${chainId}/search`,
        {
          headers: {
            Authorization: `Bearer ${ONEINCH_API_KEY}`,
            Accept: "application/json",
          },
          params: {
            query: query,
            limit: 50,
          },
          timeout: 5000,
        }
      );

      if (searchResponse.data && Array.isArray(searchResponse.data)) {
        return ResponseUtil.success(res, searchResponse.data);
      }
    } catch (searchError) {
      logger.warn("Search API failed, using fallback filter");
    }

    // Fallback: filter from full token list
    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
    });

    const tokens = Object.values(response.data?.tokens || {});
    const searchLower = query.toLowerCase();

    const filtered = tokens
      .filter(
        (token) =>
          token.symbol?.toLowerCase().includes(searchLower) ||
          token.name?.toLowerCase().includes(searchLower) ||
          token.address?.toLowerCase().includes(searchLower)
      )
      .slice(0, 50);

    return ResponseUtil.success(res, filtered);
  } catch (error) {
    logger.error("Error searching tokens:", error.message);
    return ResponseUtil.success(res, []);
  }
});

// Get quote with proper gas calculation
router.get("/quote/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { src, dst, amount, from, slippage = 1, gasMode = "high" } = req.query;

  if (!src || !dst || !amount || !from) {
    return ResponseUtil.validation(res, "Missing required parameters");
  }

  if (isNaN(amount) || parseFloat(amount) <= 0) {
    return ResponseUtil.validation(res, "Invalid amount");
  }

  try {
    logger.info(
      `Getting quote: ${amount} of ${src} to ${dst} on chain ${chainId}`
    );

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/quote`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      params: {
        src,
        dst,
        amount,
        from,
        slippage: parseFloat(slippage),
        includeProtocols: true,
        includeGas: true,
        allowPartialFill: false,
        disableEstimate: false,
        includeTokensInfo: true,
        compatibilityMode: false,
      },
      timeout: 15000,
    });

    const quoteData = response.data;

    if (!quoteData || !quoteData.dstAmount) {
      throw new Error("Invalid quote response from 1inch");
    }

    logger.info(
      `Quote successful: ${quoteData.dstAmount} output tokens, gas: ${quoteData.gas}`
    );

    return ResponseUtil.success(res, quoteData);
  } catch (error) {
    logger.error("Quote error:", error.response?.data || error.message);

    if (error.response?.data) {
      return ResponseUtil.error(
        res,
        error.response.data.description ||
          error.response.data.error ||
          "Unable to get quote",
        400,
        { details: error.response.data }
      );
    }

    return ResponseUtil.error(res, "Failed to get quote", 400);
  }
});

// Get swap transaction with gas included
router.get("/swap/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { src, dst, amount, from, slippage = 1, gasMode = "high" } = req.query;

  if (!src || !dst || !amount || !from) {
    return ResponseUtil.validation(res, "Missing required parameters");
  }

  try {
    logger.info(`Getting swap tx: ${amount} of ${src} to ${dst}`);

    const params = {
      src,
      dst,
      amount,
      from,
      slippage: parseFloat(slippage),
      origin: from,
      includeTokensInfo: true,
      allowPartialFill: false,
      disableEstimate: false,
    };

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/swap`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: "application/json",
      },
      params,
      timeout: 15000,
    });

    if (!response.data || !response.data.tx) {
      throw new Error("Invalid swap response from 1inch");
    }

    logger.info("Swap tx data:", {
      to: response.data.tx.to,
      gas: response.data.tx?.gas,
      gasPrice: response.data.tx?.gasPrice,
    });

    return ResponseUtil.success(res, response.data);
  } catch (error) {
    logger.error("Swap error:", error.response?.data || error.message);

    if (error.response?.data) {
      return ResponseUtil.error(
        res,
        error.response.data.description ||
          error.response.data.error ||
          "Unable to create swap",
        400,
        { details: error.response.data }
      );
    }

    return ResponseUtil.error(res, "Failed to get swap transaction", 400);
  }
});

// Get allowance
router.get("/allowance/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { tokenAddress, walletAddress } = req.query;

  if (!tokenAddress || !walletAddress) {
    return ResponseUtil.validation(res, "Missing required parameters");
  }

  try {
    const response = await axios.get(
      `${ONEINCH_BASE_URL}/${chainId}/approve/allowance`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        params: {
          tokenAddress,
          walletAddress,
        },
        timeout: 10000,
      }
    );

    return ResponseUtil.success(res, response.data || { allowance: "0" });
  } catch (error) {
    logger.error("Allowance error:", error.message);
    return ResponseUtil.success(res, { allowance: "0" });
  }
});

// Get approve transaction
router.get("/approve/:chainId", async (req, res) => {
  const { chainId } = req.params;
  const { tokenAddress, amount } = req.query;

  if (!tokenAddress) {
    return ResponseUtil.validation(res, "Token address required");
  }

  try {
    const params = { tokenAddress };
    if (amount) params.amount = amount;

    const response = await axios.get(
      `${ONEINCH_BASE_URL}/${chainId}/approve/transaction`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        params,
        timeout: 10000,
      }
    );

    return ResponseUtil.success(res, response.data);
  } catch (error) {
    logger.error("Approve error:", error.message);
    return ResponseUtil.error(res, "Failed to get approve transaction", 400);
  }
});

// Get spender address
router.get("/spender/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    const response = await axios.get(
      `${ONEINCH_BASE_URL}/${chainId}/approve/spender`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        timeout: 10000,
      }
    );

    return ResponseUtil.success(res, response.data || { address: null });
  } catch (error) {
    logger.error("Spender error:", error.message);
    return ResponseUtil.error(res, "Failed to get spender address", 400);
  }
});

// Enhanced gas prices
router.get("/gas/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    const response = await axios.get(
      `https://api.1inch.dev/gas-price/v1.6/${chainId}`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: "application/json",
        },
        timeout: 5000,
      }
    );

    if (response.data) {
      const gasData = {
        low: parseFloat(response.data.low.maxFeePerGas) / 1e9,
        medium: parseFloat(response.data.medium.maxFeePerGas) / 1e9,
        high: parseFloat(response.data.high.maxFeePerGas) / 1e9,
        instant: parseFloat(response.data.instant.maxFeePerGas) / 1e9,
      };

      logger.info(`Gas prices for chain ${chainId}:`, gasData);
      return ResponseUtil.success(res, gasData);
    } else {
      throw new Error("No gas data from 1inch");
    }
  } catch (error) {
    logger.error("Error fetching gas prices:", error.message);
    return ResponseUtil.error(res, "Failed to fetch gas prices", 500);
  }
});

// Native token price
router.get("/price/:chainId", async (req, res) => {
  const { chainId } = req.params;

  try {
    const nativeTokens = {
      1: "ethereum",
      137: "matic-network",
      56: "binancecoin",
      43114: "avalanche-2",
      8453: "ethereum",
      42161: "ethereum",
    };

    const tokenId = nativeTokens[chainId] || "ethereum";

    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`
      );

      const price = response.data[tokenId]?.usd || 0;
      return ResponseUtil.success(res, { price, symbol: tokenId });
    } catch (err) {
      const fallbackPrices = {
        1: 3500,
        137: 0.8,
        56: 250,
        43114: 35,
        8453: 3500,
        42161: 3500,
      };

      return ResponseUtil.success(res, {
        price: fallbackPrices[chainId] || 100,
        symbol: tokenId,
      });
    }
  } catch (error) {
    logger.error("Error fetching token price:", error);
    return ResponseUtil.success(res, { price: 100, symbol: "unknown" });
  }
});

module.exports = router;
