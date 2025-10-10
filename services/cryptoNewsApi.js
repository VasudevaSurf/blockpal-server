// blockpal-server/services/cryptoNewsApi.js
const axios = require("axios");
const newsDatabase = require("../lib/newsDatabase");
const { logger } = require("../utils/logger");

class CryptoNewsApi {
  constructor() {
    this.baseURL = "https://cryptonews-api.com/api/v1";
    this.apiKey = process.env.CRYPTO_NEWS_API_KEY;
    this.NEWS_RETENTION_HOURS = 24;
  }

  async makeRequest(endpoint, params = {}) {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        const response = await axios.get(`${this.baseURL}${endpoint}`, {
          params: {
            ...params,
            token: this.apiKey,
          },
          timeout: 10000,
        });

        return response.data;
      } catch (error) {
        retries++;

        if (error.response?.status === 429) {
          logger.log(`⏳ Rate limited. Waiting ${retries * 5} seconds...`);
          await this.sleep(retries * 5000);
          continue;
        }

        if (retries === maxRetries) {
          throw error;
        }

        await this.sleep(retries * 2000);
      }
    }
  }

  async fetchAllTickerNews(items = 100, page = 1) {
    try {
      logger.info("📰 Fetching all ticker news...");
      const response = await this.makeRequest("/category", {
        section: "alltickers",
        items: items,
        page: page,
      });

      const articles = response.data || [];
      logger.info(`✅ Fetched ${articles.length} news articles`);

      return this.processNewsArticles(articles);
    } catch (error) {
      logger.error("❌ Error fetching ticker news:", error);
      return [];
    }
  }

  async fetchTrendingHeadlines(page = 1) {
    try {
      logger.info("🔥 Fetching trending headlines...");
      const response = await this.makeRequest("/trending-headlines", { page });
      const headlines = response.data || [];

      logger.info(`✅ Fetched ${headlines.length} trending headlines`);
      return this.processTrendingHeadlines(headlines);
    } catch (error) {
      logger.error("❌ Error fetching trending headlines:", error);
      return [];
    }
  }

  processNewsArticles(articles) {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.NEWS_RETENTION_HOURS * 60 * 60 * 1000
    );

    return articles.map((article) => ({
      news_url: article.news_url,
      image_url: article.image_url || null,
      title: article.title,
      text: article.text,
      source_name: article.source_name,
      date: new Date(article.date),
      topics: article.topics || [],
      sentiment: article.sentiment,
      type: article.type || "Article",
      tickers: article.tickers || [],
      is_trending: false,
      ingested_at: now,
      expires_at: expiresAt,
      search_vector: `${article.title} ${article.text} ${(
        article.tickers || []
      ).join(" ")}`.toLowerCase(),
    }));
  }

  processTrendingHeadlines(headlines) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    return headlines.map((headline) => ({
      headline_id: headline.id,
      headline: headline.headline,
      text: headline.text,
      news_id: headline.news_id,
      sentiment: headline.sentiment,
      date: new Date(headline.date),
      tickers: headline.tickers || [],
      trending_score: 100,
      trending_since: now,
      ingested_at: now,
      expires_at: expiresAt,
    }));
  }

  async performFullIngestion() {
    logger.info("🚀 Starting crypto news ingestion...");
    const startTime = Date.now();

    try {
      await newsDatabase.connect();

      const [allNews, trendingHeadlines] = await Promise.all([
        this.fetchAllTickerNews(100),
        this.fetchTrendingHeadlines(),
      ]);

      const results = await Promise.all([
        allNews.length > 0 ? newsDatabase.insertNewsArticles(allNews) : null,
        trendingHeadlines.length > 0
          ? newsDatabase.insertTrendingHeadlines(trendingHeadlines)
          : null,
      ]);

      const cleanupResult = await newsDatabase.cleanupExpiredData();

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info("✅ News ingestion completed successfully!");
      logger.info(`⏱️ Time taken: ${elapsedTime}s`);
      logger.info(`📊 Stats:
        - News articles: ${results[0]?.inserted || 0} new
        - Trending headlines: ${results[1]?.inserted || 0} new
        - Cleaned up: ${cleanupResult.newsDeleted} expired articles`);

      return { success: true, results, elapsedTime };
    } catch (error) {
      logger.error("❌ News ingestion failed:", error);
      return { success: false, error: error.message };
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new CryptoNewsApi();
