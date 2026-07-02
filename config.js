// ============================================================
// APP CONFIG — the ONLY file to edit when switching mock -> real data.
// ============================================================
const APP_CONFIG = {
  // Set to false to use the real backend proxy (server/index.js on Render).
  USE_MOCK: true,

  REFRESH_INTERVAL_MS: 15000,

  DEFAULT_WATCHLIST: ["VNM", "FPT", "SSI", "VCB", "HPG", "MWG"],

  // When USE_MOCK=false, point each baseUrl to your deployed backend, e.g.
  //   baseUrl: "https://ten-app.onrender.com/api/price"
  priceProvider:        { name: "SSI FCData", baseUrl: "/api/price" },
  fundamentalsProvider: { name: "TCBS",       baseUrl: "/api/fundamentals" },
  newsProvider:         { name: "CafeF RSS",  baseUrl: "/api/news" },

  currency: "VND",
};

if (typeof module !== "undefined") module.exports = APP_CONFIG;
