// routes/jupiterSwap.js - Jupiter Swap API routes for Solana
const express = require("express");
const axios = require("axios");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");

const router = express.Router();

const JUPITER_BASE_URL = "https://lite-api.jup.ag/ultra/v1";
const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1";

// Search tokens on Solana
router.get("/search", async (req, res) => {
  const { query } = req.query;

  try {
    if (!query) {
      return ResponseUtil.validation(res, "Search query required");
    }

    logger.info(`🔍 Searching Solana tokens: ${query}`);

    const response = await axios.get(`${JUPITER_BASE_URL}/search`, {
      params: { query },
      timeout: 10000,
    });

    const tokens = response.data || [];
    
    logger.info(`✅ Found ${tokens.length} Solana tokens`);

    return ResponseUtil.success(res, tokens);
  } catch (error) {
    logger.error("Error searching Solana tokens:", error.message);
    return ResponseUtil.success(res, []);
  }
});

// Get quote for Solana swap
router.get("/quote", async (req, res) => {
  const { inputMint, outputMint, amount, slippageBps = 50 } = req.query;

  if (!inputMint || !outputMint || !amount) {
    return ResponseUtil.validation(res, "Missing required parameters");
  }

  try {
    logger.info(`💱 Getting Jupiter quote: ${amount} ${inputMint} -> ${outputMint}`);

    const response = await axios.get(`${JUPITER_QUOTE_URL}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: parseInt(slippageBps),
      },
      timeout: 15000,
    });

    const quote = response.data;

    if (!quote || !quote.outAmount) {
      throw new Error("Invalid quote response from Jupiter");
    }

    logger.info(`✅ Quote received: ${quote.outAmount} output`);

    return ResponseUtil.success(res, quote);
  } catch (error) {
    logger.error("Jupiter quote error:", error.response?.data || error.message);
    
    if (error.response?.data) {
      return ResponseUtil.error(
        res,
        error.response.data.error || "Unable to get quote",
        400,
        { details: error.response.data }
      );
    }

    return ResponseUtil.error(res, "Failed to get quote", 400);
  }
});

// Get swap transaction for Solana
router.post("/swap", async (req, res) => {
  const { userPublicKey, quoteResponse } = req.body;

  if (!userPublicKey || !quoteResponse) {
    return ResponseUtil.validation(res, "Missing required parameters");
  }

  try {
    logger.info(`🔄 Creating Jupiter swap transaction for ${userPublicKey}`);

    const response = await axios.post(
      `${JUPITER_QUOTE_URL}/swap`,
      {
        userPublicKey,
        quoteResponse,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 10000000,
            priorityLevel: "high",
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const swapData = response.data;

    if (!swapData.swapTransaction) {
      throw new Error("No swap transaction returned from Jupiter");
    }

    logger.info("✅ Jupiter swap transaction created");

    return ResponseUtil.success(res, swapData);
  } catch (error) {
    logger.error("Jupiter swap error:", error.response?.data || error.message);

    if (error.response?.data) {
      return ResponseUtil.error(
        res,
        error.response.data.error || "Unable to create swap",
        400,
        { details: error.response.data }
      );
    }

    return ResponseUtil.error(res, "Failed to create swap transaction", 400);
  }
});

// Get Solana token price (using Jupiter or fallback)
router.get("/price/:mint", async (req, res) => {
  const { mint } = req.params;

  try {
    // Try to get price from Jupiter search
    const response = await axios.get(`${JUPITER_BASE_URL}/search`, {
      params: { query: mint },
      timeout: 5000,
    });

    const tokens = response.data || [];
    const token = tokens.find((t) => t.id === mint);

    if (token && token.usdPrice) {
      return ResponseUtil.success(res, {
        price: token.usdPrice,
        symbol: token.symbol,
      });
    }

    // Fallback to CoinGecko for SOL
    if (mint === "So11111111111111111111111111111111111111112") {
      try {
        const cgResponse = await axios.get(
          "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
        );
        return ResponseUtil.success(res, {
          price: cgResponse.data.solana?.usd || 0,
          symbol: "SOL",
        });
      } catch (err) {
        return ResponseUtil.success(res, { price: 150, symbol: "SOL" });
      }
    }

    return ResponseUtil.success(res, { price: 0, symbol: "UNKNOWN" });
  } catch (error) {
    logger.error("Error fetching Solana token price:", error);
    return ResponseUtil.success(res, { price: 0, symbol: "UNKNOWN" });
  }
});

module.exports = router;