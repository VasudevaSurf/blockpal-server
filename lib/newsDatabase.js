// blockpal-server/lib/newsDatabase.js
const { MongoClient } = require('mongodb');
const { logger } = require('../utils/logger');

class NewsDatabase {
  constructor() {
    this.client = null;
    this.db = null;
    this.collections = {
      newsArticles: null,
      trendingHeadlines: null,
    };
  }

  async connect() {
    try {
      if (this.client && this.db) {
        logger.info('📊 Already connected to MongoDB for news');
        return this.db;
      }

      const uri = process.env.MONGODB_URI || 
        'mongodb+srv://greeshmanthedupalli:0hAZ1wIBNxjGkL1v@blockpal-cluster.uldmzku.mongodb.net/BlockPal?retryWrites=true&w=majority&appName=blockpal-cluster';

      this.client = new MongoClient(uri, {
        maxPoolSize: 10,
        minPoolSize: 2
      });

      await this.client.connect();
      this.db = this.client.db('BlockPal');

      this.collections.newsArticles = this.db.collection('news_articles');
      this.collections.trendingHeadlines = this.db.collection('trending_headlines');

      await this.createIndexes();

      logger.info('✅ News database connected successfully');
      return this.db;
    } catch (error) {
      logger.error('❌ News database connection error:', error);
      throw error;
    }
  }

  async createIndexes() {
    try {
      logger.info('🔧 Creating news database indexes...');

      // News Articles indexes
      await this.collections.newsArticles.createIndexes([
        { key: { news_url: 1 }, unique: true, name: 'unique_url' },
        { key: { expires_at: 1 }, expireAfterSeconds: 0, name: 'ttl_index' },
        { key: { title: 'text', text: 'text' }, name: 'text_search' },
        { key: { tickers: 1, date: -1 }, name: 'ticker_date' },
        { key: { sentiment: 1, date: -1 }, name: 'sentiment_date' },
        { key: { is_trending: 1, date: -1 }, name: 'trending_date' },
        { key: { date: -1 }, name: 'date_desc' }
      ]);

      // Trending Headlines indexes
      await this.collections.trendingHeadlines.createIndexes([
        { key: { headline_id: 1 }, unique: true, name: 'unique_headline' },
        { key: { expires_at: 1 }, expireAfterSeconds: 0, name: 'headline_ttl' },
        { key: { date: -1 }, name: 'headline_date' },
        { key: { tickers: 1 }, name: 'headline_tickers' }
      ]);

      logger.info('✅ News database indexes created');
    } catch (error) {
      logger.warn('⚠️ Warning: Error creating news indexes:', error);
    }
  }

  async searchNews(params = {}) {
    const {
      searchText = null,
      timeRange = '24h',
      limit = 20,
      page = 1
    } = params;

    const query = {};

    if (timeRange) {
      const hours = this.parseTimeRange(timeRange);
      query.date = { $gte: new Date(Date.now() - hours * 60 * 60 * 1000) };
    }

    if (searchText) {
      query.$text = { $search: searchText };
    }

    try {
      const skip = (page - 1) * limit;
      
      const articles = await this.collections.newsArticles
        .find(query)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const total = await this.collections.newsArticles.countDocuments(query);

      return {
        articles,
        total,
        page,
        hasMore: total > skip + limit
      };
    } catch (error) {
      logger.error('❌ Error searching news:', error);
      throw error;
    }
  }

  async getTrendingTopics(limit = 10) {
    try {
      const headlines = await this.collections.trendingHeadlines
        .find({})
        .sort({ date: -1 })
        .limit(limit)
        .toArray();

      return headlines;
    } catch (error) {
      logger.error('❌ Error getting trending topics:', error);
      throw error;
    }
  }

  async insertNewsArticles(articles) {
    try {
      const operations = articles.map(article => ({
        updateOne: {
          filter: { news_url: article.news_url },
          update: { $setOnInsert: article },
          upsert: true
        }
      }));

      const result = await this.collections.newsArticles.bulkWrite(operations, {
        ordered: false
      });

      return {
        inserted: result.upsertedCount,
        modified: result.modifiedCount,
        total: articles.length
      };
    } catch (error) {
      logger.error('❌ Error inserting news articles:', error);
      throw error;
    }
  }

  async insertTrendingHeadlines(headlines) {
    try {
      const operations = headlines.map(headline => ({
        updateOne: {
          filter: { headline_id: headline.headline_id },
          update: { $set: headline },
          upsert: true
        }
      }));

      const result = await this.collections.trendingHeadlines.bulkWrite(operations);

      return {
        inserted: result.upsertedCount,
        modified: result.modifiedCount
      };
    } catch (error) {
      logger.error('❌ Error inserting trending headlines:', error);
      throw error;
    }
  }

  parseTimeRange(timeRange) {
    const map = {
      '1h': 1,
      '6h': 6,
      '12h': 12,
      '24h': 24,
      '48h': 48
    };
    return map[timeRange] || 24;
  }

  async cleanupExpiredData() {
    try {
      const now = new Date();
      
      const newsResult = await this.collections.newsArticles.deleteMany({
        expires_at: { $lte: now }
      });

      const headlinesResult = await this.collections.trendingHeadlines.deleteMany({
        expires_at: { $lte: now }
      });

      return {
        newsDeleted: newsResult.deletedCount,
        headlinesDeleted: headlinesResult.deletedCount
      };
    } catch (error) {
      logger.error('❌ Error cleaning up expired data:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      logger.info('👋 Disconnected from news database');
    }
  }
}

module.exports = new NewsDatabase();