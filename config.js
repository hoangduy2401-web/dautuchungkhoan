// ============================================================
// APP CONFIG — the ONLY file to edit when switching mock -> real data.
// ============================================================
const APP_CONFIG = {
  // Set to false to use the real backend proxy (server/index.js on Render).
  USE_MOCK: true,

  // Keep the UI alive while the real backend is still being wired up:
  // any failing API call silently falls back to mock data.
  FALLBACK_TO_MOCK_ON_ERROR: true,

  REFRESH_INTERVAL_MS: 15000,

  DEFAULT_WATCHLIST: ["VNM", "FPT", "SSI", "VCB", "HPG", "MWG"],

  // Deployed backend proxy on Render. For local dev against `npm start`,
  // swap BACKEND for "http://localhost:3001".
  // BACKEND = "https://dashboard-chung-khoan.onrender.com"
  priceProvider:        { name: "SSI FCData", baseUrl: "https://dashboard-chung-khoan.onrender.com/api/price" },
  fundamentalsProvider: { name: "VNDirect",   baseUrl: "https://dashboard-chung-khoan.onrender.com/api/fundamentals" },
  newsProvider:         { name: "CafeF RSS",  baseUrl: "https://dashboard-chung-khoan.onrender.com/api/news" },

  currency: "VND",
};

if (typeof module !== "undefined") module.exports = APP_CONFIG;
