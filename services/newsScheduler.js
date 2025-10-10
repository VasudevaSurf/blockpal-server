// blockpal-server/services/newsScheduler.js
const cryptoNewsApi = require("./cryptoNewsApi");
const { logger } = require("../utils/logger");

class NewsScheduler {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.interval = 60 * 60 * 1000; // 1 hour
  }

  async start() {
    if (this.isRunning) {
      logger.info("📰 News scheduler already running");
      return;
    }

    logger.info("🚀 Starting news ingestion scheduler (runs every 1 hour)...");
    this.isRunning = true;

    // Run immediately on start
    await cryptoNewsApi.performFullIngestion();

    // Then run every hour
    this.intervalId = setInterval(async () => {
      logger.info("⏰ Scheduled news ingestion starting...");
      await cryptoNewsApi.performFullIngestion();
    }, this.interval);

    logger.info("✅ News scheduler started successfully");
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info("⏹️ News scheduler stopped");
  }
}

module.exports = new NewsScheduler();
