const cors = require("cors");

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    console.log("🔍 CORS Check - Origin:", origin);
    console.log("🔍 CORS Check - Allowed Origins:", allowedOrigins);

    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log("✅ CORS - Origin allowed:", origin);
      callback(null, true);
    } else {
      console.log("❌ CORS - Origin blocked:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Cache-Control",
    "X-Client-Id",
    "X-Session-ID",
  ],
  exposedHeaders: ["X-Total-Count"],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  preflightContinue: false, // Pass control to the next handler
};

module.exports = cors(corsOptions);
