// lib/mongodb.js - Backend MongoDB connection helper
const { MongoClient } = require("mongodb");

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(
    process.env.MONGODB_URI ||
      "mongodb+srv://greeshmanthedupalli:0hAZ1wIBNxjGkL1v@blockpal-cluster.uldmzku.mongodb.net/?retryWrites=true&w=majority&appName=blockpal-cluster"
  );

  await client.connect();
  const db = client.db("BlockPal");

  cachedClient = client;
  cachedDb = db;

  console.log("✅ MongoDB connected (tokens route)");
  return { client, db };
}

async function findWalletPreferences(userEmail, walletAddress, chainId) {
  const { db } = await connectToDatabase();
  return db.collection("walletPreferences").findOne({
    userEmail: userEmail.toLowerCase(),
    walletAddress: walletAddress.toLowerCase(),
    chainId: chainId,
  });
}

module.exports = {
  connectToDatabase,
  findWalletPreferences,
};
