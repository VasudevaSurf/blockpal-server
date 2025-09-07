const fs = require("fs");
const path = require("path");

// Ensure logs directory exists
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL || "info";
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

class Logger {
  constructor() {
    this.level = logLevels[logLevel] || logLevels.info;
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...(data && { data }),
    };

    return JSON.stringify(logEntry);
  }

  writeToFile(level, formattedMessage) {
    const filename = `${level}-${new Date().toISOString().split("T")[0]}.log`;
    const filepath = path.join(logsDir, filename);

    fs.appendFileSync(filepath, formattedMessage + "\n");
  }

  log(level, message, data = null) {
    if (logLevels[level] > this.level) return;

    const formattedMessage = this.formatMessage(level, message, data);

    // Console output with colors
    const colors = {
      error: "\x1b[31m", // Red
      warn: "\x1b[33m", // Yellow
      info: "\x1b[36m", // Cyan
      debug: "\x1b[90m", // Gray
    };

    const reset = "\x1b[0m";
    const color = colors[level] || "";

    console.log(`${color}${formattedMessage}${reset}`);

    // Write to file
    this.writeToFile(level, formattedMessage);
  }

  error(message, data = null) {
    this.log("error", message, data);
  }

  warn(message, data = null) {
    this.log("warn", message, data);
  }

  info(message, data = null) {
    this.log("info", message, data);
  }

  debug(message, data = null) {
    this.log("debug", message, data);
  }
}

const logger = new Logger();

module.exports = { logger };
