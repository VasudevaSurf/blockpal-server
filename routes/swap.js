// routes/swap.js - 1inch Integration for Swap
const express = require("express");
const axios = require("axios");
const { logger } = require("../utils/logger");
const ResponseUtil = require("../utils/response");

const router = express.Router();

// 1inch API configuration
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY || '7TD80y4Tuv1jeN0QuUbzUw2NT2N9qTwb';
const ONEINCH_BASE_URL = 'https://api.1inch.dev/swap/v6.1';

// Supported chains
const SUPPORTED_CHAINS = {
  1: 'Ethereum',
  137: 'Polygon', 
  56: 'BSC',
  43114: 'Avalanche',
  8453: 'Base',
  42161: 'Arbitrum',
};

// Get gas prices from 1inch
router.get('/gas/:chainId', async (req, res) => {
  const { chainId } = req.params;
  
  try {
    const response = await axios.get(
      `https://api.1inch.dev/gas-price/v1.6/${chainId}`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: 'application/json',
        },
        timeout: 5000
      }
    );
    
    if (response.data) {
      const gasData = {
        low: parseFloat(response.data.low.maxFeePerGas) / 1e9,
        medium: parseFloat(response.data.medium.maxFeePerGas) / 1e9,
        high: parseFloat(response.data.high.maxFeePerGas) / 1e9,
        instant: parseFloat(response.data.instant.maxFeePerGas) / 1e9
      };
      
      return ResponseUtil.success(res, gasData, "Gas prices fetched");
    }
  } catch (error) {
    logger.error('Error fetching gas prices:', error.message);
    return ResponseUtil.error(res, 'Failed to fetch gas prices', 500);
  }
});

// Get native token price
router.get('/price/:chainId', async (req, res) => {
  const { chainId } = req.params;
  
  try {
    const nativeTokens = {
      1: 'ethereum',
      137: 'matic-network',
      56: 'binancecoin',
      43114: 'avalanche-2',
      8453: 'ethereum',
      42161: 'ethereum'
    };
    
    const tokenId = nativeTokens[chainId] || 'ethereum';
    
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
        42161: 3500
      };
      
      return ResponseUtil.success(res, { 
        price: fallbackPrices[chainId] || 100, 
        symbol: tokenId 
      });
    }
  } catch (error) {
    logger.error('Error fetching token price:', error);
    return ResponseUtil.success(res, { price: 100, symbol: 'unknown' });
  }
});

// Search tokens on a chain
router.get('/search/:chainId', async (req, res) => {
  const { chainId } = req.params;
  const { query } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return ResponseUtil.validation(res, 'Unsupported chain');
  }

  try {
    if (!query) {
      // Return popular tokens
      const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: 'application/json',
        },
        timeout: 10000
      });

      const tokens = Object.values(response.data?.tokens || {});
      const popularSymbols = ['ETH', 'WETH', 'USDT', 'USDC', 'DAI', 'WBTC', 'UNI', 'LINK'];
      
      const popularTokens = tokens
        .filter(token => popularSymbols.includes(token.symbol?.toUpperCase()))
        .slice(0, 20);

      return ResponseUtil.success(res, popularTokens);
    }

    // Search for specific token
    const searchResponse = await axios.get(
      `https://api.1inch.dev/token/v1.2/${chainId}/search`,
      {
        headers: {
          Authorization: `Bearer ${ONEINCH_API_KEY}`,
          Accept: 'application/json',
        },
        params: {
          query: query,
          limit: 50
        },
        timeout: 5000
      }
    );

    if (searchResponse.data && Array.isArray(searchResponse.data)) {
      return ResponseUtil.success(res, searchResponse.data);
    }

    // Fallback to filtering
    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/tokens`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: 'application/json',
      }
    });

    const tokens = Object.values(response.data?.tokens || {});
    const filtered = tokens.filter(token => 
      token.symbol?.toLowerCase().includes(query.toLowerCase()) ||
      token.name?.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 50);

    return ResponseUtil.success(res, filtered);
  } catch (error) {
    logger.error('Error searching tokens:', error.message);
    return ResponseUtil.success(res, []);
  }
});

// Get swap quote
router.get('/quote/:chainId', async (req, res) => {
  const { chainId } = req.params;
  const { src, dst, amount, from, slippage = 1 } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return ResponseUtil.validation(res, 'Unsupported chain');
  }

  if (!src || !dst || !amount || !from) {
    return ResponseUtil.validation(res, 'Missing required parameters');
  }

  try {
    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/quote`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: 'application/json',
      },
      params: {
        src,
        dst,
        amount,
        from,
        slippage: parseFloat(slippage),
        includeProtocols: true,
        includeGas: true,
        includeTokensInfo: true
      },
      timeout: 15000
    });

    const quoteData = response.data;
    
    if (!quoteData || !quoteData.dstAmount) {
      throw new Error('Invalid quote response');
    }

    return ResponseUtil.success(res, quoteData);
  } catch (error) {
    logger.error('Quote error:', error.response?.data || error.message);
    return ResponseUtil.error(res, 'Failed to get quote', 400);
  }
});

// Get swap transaction
router.get('/swap/:chainId', async (req, res) => {
  const { chainId } = req.params;
  const { src, dst, amount, from, slippage = 1 } = req.query;

  if (!SUPPORTED_CHAINS[chainId]) {
    return ResponseUtil.validation(res, 'Unsupported chain');
  }

  if (!src || !dst || !amount || !from) {
    return ResponseUtil.validation(res, 'Missing required parameters');
  }

  try {
    const params = {
      src,
      dst,
      amount,
      from,
      slippage: parseFloat(slippage),
      origin: from,
      includeTokensInfo: true
    };

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/swap`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: 'application/json',
      },
      params,
      timeout: 15000
    });
    
    if (!response.data || !response.data.tx) {
      throw new Error('Invalid swap response');
    }

    return ResponseUtil.success(res, response.data);
  } catch (error) {
    logger.error('Swap error:', error.response?.data || error.message);
    return ResponseUtil.error(res, 'Failed to create swap', 400);
  }
});

// Get allowance
router.get('/allowance/:chainId', async (req, res) => {
  const { chainId } = req.params;
  const { tokenAddress, walletAddress } = req.query;

  if (!tokenAddress || !walletAddress) {
    return ResponseUtil.validation(res, 'Missing required parameters');
  }

  try {
    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/approve/allowance`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: 'application/json',
      },
      params: {
        tokenAddress,
        walletAddress,
      },
      timeout: 10000
    });

    return ResponseUtil.success(res, response.data || { allowance: '0' });
  } catch (error) {
    logger.error('Allowance error:', error.message);
    return ResponseUtil.success(res, { allowance: '0' });
  }
});

// Get approve transaction
router.get('/approve/:chainId', async (req, res) => {
  const { chainId } = req.params;
  const { tokenAddress, amount } = req.query;

  if (!tokenAddress) {
    return ResponseUtil.validation(res, 'Token address required');
  }

  try {
    const params = { tokenAddress };
    if (amount) params.amount = amount;

    const response = await axios.get(`${ONEINCH_BASE_URL}/${chainId}/approve/transaction`, {
      headers: {
        Authorization: `Bearer ${ONEINCH_API_KEY}`,
        Accept: 'application/json',
      },
      params,
      timeout: 10000
    });

    return ResponseUtil.success(res, response.data);
  } catch (error) {
    logger.error('Approve error:', error.message);
    return ResponseUtil.error(res, 'Failed to get approve transaction', 400);
  }
});

module.exports = router;