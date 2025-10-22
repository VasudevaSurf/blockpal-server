// lib/coinlesDatabase.js - FIXED: USER-SPECIFIC QUERIES
const { MongoClient } = require("mongodb");
require("dotenv").config();

let client = null;
let db = null;

async function connectDB() {
  if (db) return db;

  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      "mongodb+srv://greeshmanthedupalli:0hAZ1wIBNxjGkL1v@blockpal-cluster.uldmzku.mongodb.net/BlockPal?retryWrites=true&w=majority&appName=blockpal-cluster";

    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db("BlockPal");

    console.log("✅ MongoDB connected for CoinLes");

    await createIndexes();

    return db;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

async function createIndexes() {
  // Users collection indexes
  await db
    .collection("coinlesUsers")
    .createIndex({ email: 1 }, { unique: true });
  await db
    .collection("coinlesUsers")
    .createIndex({ "watchlist.chainId": 1, "watchlist.contractAddress": 1 });

  // Token cache collection indexes
  await db.collection("coinlesTokenCache").createIndex({ _id: 1 });
  await db
    .collection("coinlesTokenCache")
    .createIndex({ chainId: 1, contractAddress: 1 });
  await db.collection("coinlesTokenCache").createIndex({ activeUsers: 1 });
  await db.collection("coinlesTokenCache").createIndex({ lastUpdated: 1 });

  // Stats collection indexes
  await db.collection("coinlesStats").createIndex({ date: -1 });
}

// USER OPERATIONS
async function createOrUpdateUser(email) {
  const db = await connectDB();
  const users = db.collection("coinlesUsers");

  console.log(`📝 Creating/updating user: ${email}`);

  const existingUser = await users.findOne({ email: email.toLowerCase() });

  if (existingUser) {
    const result = await users.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $set: {
          updatedAt: new Date(),
          "stats.lastActive": new Date(),
        },
      },
      { returnDocument: "after" }
    );
    console.log(`   ✅ User ${email} updated`);
    return result;
  } else {
    const result = await users.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $set: {
          email: email.toLowerCase(),
          watchlist: [],
          recentSearches: [],
          preferences: {
            defaultChain: "eth",
            updateInterval: 30,
            chartDefaultTimeframe: "1d",
          },
          stats: {
            totalTokensTracked: 0,
            favoriteTokens: [],
            lastActive: new Date(),
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" }
    );
    console.log(`   ✅ User ${email} created`);
    return result;
  }
}

async function addTokenToWatchlist(email, token) {
  const db = await connectDB();
  const users = db.collection("coinlesUsers");

  console.log(`➕ Adding token ${token.tokenSymbol} to watchlist for ${email}`);

  const result = await users.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $addToSet: {
        watchlist: {
          ...token,
          addedAt: new Date(),
          lastViewed: new Date(),
        },
      },
      $inc: { "stats.totalTokensTracked": 1 },
    },
    { returnDocument: "after" }
  );

  console.log(`   ✅ Token added successfully to ${email}'s watchlist`);
  return result;
}

async function removeTokenFromWatchlist(email, chainId, contractAddress) {
  const db = await connectDB();
  const users = db.collection("coinlesUsers");

  console.log(
    `🗑️  Removing token from watchlist for ${email}: ${chainId}/${contractAddress.substring(
      0,
      10
    )}...`
  );

  const result = await users.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $pull: {
        watchlist: { chainId, contractAddress },
      },
      $inc: { "stats.totalTokensTracked": -1 },
    },
    { returnDocument: "after" }
  );

  console.log(`   ✅ Token removed from ${email}'s watchlist`);
  return result;
}

// ✅ CRITICAL FIX: Get ONLY this user's watchlist
async function getUserWatchlist(email) {
  const db = await connectDB();
  const users = db.collection("coinlesUsers");

  console.log(`📋 Fetching watchlist from database for: ${email}`);

  // ✅ Query by email to get ONLY this user's data
  const user = await users.findOne({
    email: email.toLowerCase(),
  });

  const watchlist = user?.watchlist || [];

  console.log(
    `   ├─ Database query result: Found ${watchlist.length} tokens for ${email}`
  );

  // Log the tokens for debugging
  if (watchlist.length > 0) {
    const tokenSummary = watchlist
      .map(
        (t) =>
          `${t.tokenSymbol} (${t.chainId}/${t.contractAddress.substring(
            0,
            8
          )}...)`
      )
      .join(", ");
    console.log(`   ├─ Tokens: ${tokenSummary}`);
  }

  return watchlist;
}

async function addRecentSearch(email, search) {
  const db = await connectDB();
  const users = db.collection("coinlesUsers");

  await users.updateOne(
    { email: email.toLowerCase() },
    {
      $push: {
        recentSearches: {
          $each: [
            {
              ...search,
              searchedAt: new Date(),
            },
          ],
          $position: 0,
          $slice: 10,
        },
      },
    }
  );
}

// TOKEN CACHE OPERATIONS
async function upsertTokenCache(tokenData) {
  const db = await connectDB();
  const tokenCache = db.collection("coinlesTokenCache");

  const { chainId, contractAddress } = tokenData;
  const _id = `${chainId}_${contractAddress}`;

  const result = await tokenCache.findOneAndUpdate(
    { _id },
    {
      $set: {
        ...tokenData,
        _id,
        lastUpdated: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  return result;
}

async function getTokenCache(chainId, contractAddress) {
  const db = await connectDB();
  const tokenCache = db.collection("coinlesTokenCache");

  const _id = `${chainId}_${contractAddress}`;
  return await tokenCache.findOne({ _id });
}

async function getActiveTokens(chainId) {
  const db = await connectDB();
  const tokenCache = db.collection("coinlesTokenCache");

  return await tokenCache
    .find({
      chainId,
      "activeUsers.0": { $exists: true },
    })
    .toArray();
}

async function addUserToActiveToken(chainId, contractAddress, userId) {
  const db = await connectDB();
  const tokenCache = db.collection("coinlesTokenCache");

  const _id = `${chainId}_${contractAddress}`;
  await tokenCache.updateOne(
    { _id },
    { $addToSet: { activeUsers: userId } },
    { upsert: true }
  );
}

async function removeUserFromActiveToken(chainId, contractAddress, userId) {
  const db = await connectDB();
  const tokenCache = db.collection("coinlesTokenCache");

  const _id = `${chainId}_${contractAddress}`;
  await tokenCache.updateOne({ _id }, { $pull: { activeUsers: userId } });
}

async function cleanupInactiveTokens() {
  const db = await connectDB();
  const tokenCache = db.collection("coinlesTokenCache");

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const result = await tokenCache.deleteMany({
    activeUsers: { $size: 0 },
    lastUpdated: { $lt: oneHourAgo },
  });

  console.log(`🧹 Cleaned up ${result.deletedCount} inactive tokens`);
}

// STATS OPERATIONS
async function updateStats(statsData) {
  const db = await connectDB();
  const stats = db.collection("coinlesStats");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await stats.findOneAndUpdate(
    { date: today },
    {
      $inc: {
        "systemMetrics.totalApiCalls": statsData.apiCalls || 0,
        "systemMetrics.errorCount": statsData.errors || 0,
      },
      $set: {
        "systemMetrics.lastUpdate": new Date(),
      },
    },
    { upsert: true }
  );
}

module.exports = {
  connectDB,
  createOrUpdateUser,
  addTokenToWatchlist,
  removeTokenFromWatchlist,
  getUserWatchlist,
  addRecentSearch,
  upsertTokenCache,
  getTokenCache,
  getActiveTokens,
  addUserToActiveToken,
  removeUserFromActiveToken,
  cleanupInactiveTokens,
  updateStats,
};
