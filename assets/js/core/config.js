// ============================================================
// APP CONFIG — the ONLY file to edit when switching mock -> real data.
// ============================================================
const APP_CONFIG = {
  // Set to false to use the real backend proxy (server/index.js on Render).
  USE_MOCK: false,

  // Fallback to mock on error — applies to FUNDAMENTALS and NEWS only.
  // Prices, quotes, indices and history deliberately do NOT fall back: a mock
  // price looks exactly like a real one on screen, and that is how a cold Render
  // start used to paint the whole board with invented numbers that only a manual
  // refresh corrected (30/07/2026). They now surface as "—" instead.
  FALLBACK_TO_MOCK_ON_ERROR: true,

  // 45s, not 15s: the SSI backend rate-limits hard, and outside trading hours
  // the board is static anyway. A shorter interval used to stack overlapping
  // refresh cycles into a self-inflicted slowdown.
  REFRESH_INTERVAL_MS: 45000,

  DEFAULT_WATCHLIST: ["VNM", "FPT", "SSI", "VCB", "HPG", "MWG"],

  // Ticker tape shows the full VN30 basket. Update if the basket changes
  // (VN30 is re-balanced ~twice a year). Backend warms these so the ticker
  // is served from cache instead of hammering SSI on every load.
  VN30: [
    "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
    "LPB", "MBB", "MSN", "MWG", "PLX", "SAB", "SHB", "SSB", "SSI", "STB",
    "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
  ],

  // Liquid HNX / UPCoM baskets for the "Top tăng/giảm" exchange switcher.
  // Ranked within the basket (not the whole exchange). Fetched lazily the first
  // time the user opens that exchange tab — NOT warmed, to keep default load light.
  HNX30: [
    "SHS", "PVS", "CEO", "IDC", "TNG", "MBS", "VCS", "HUT", "PVC", "DTD",
    "LAS", "TIG", "NTP", "VGS", "BVS",
  ],
  UPCOM: [
    "BSR", "ACV", "VEA", "QNS", "VGI", "MSR", "VGT", "DVN", "MML", "OIL",
    "BVB", "ABB", "C4G", "FOX", "MCH",
  ],

  // HOSE lọc theo thanh khoản — dùng cho tab "Tín hiệu". Tiêu chí: khối lượng
  // khớp trung bình 5 phiên >= 3 triệu cp/phiên (chốt 25/07/2026). Sàn HOSE có
  // 433 mã cổ phiếu; lọc còn 49, trong đó 27 mã nằm ngoài VN30.
  //
  // Danh sách này TĨNH, thanh khoản thì không — nên soát lại vài tháng một lần.
  // Cách dựng lại (SSI trả cả sàn trong 1 lần gọi, 2487 dòng/phiên = 3 trang):
  //   /api/debug/raw?path=/api/v2/Market/DailyStockPrice&Market=HOSE
  //     &FromDate=dd/mm/yyyy&ToDate=dd/mm/yyyy&PageIndex=1..3&PageSize=1000
  // rồi lọc Symbol khớp /^[A-Z]{3}$/ (loại trái phiếu, chứng quyền) và lấy
  // trung bình TotalMatchVol qua 5 phiên. Sắp giảm dần theo thanh khoản.
  HOSE_LIQUID: [
    "SHB", "VIX", "HPG", "SSI", "ACB", "VPB", "NVL", "MBB", "GEX", "VND",
    "DXG", "TCB", "HDB", "PNJ", "TPB", "DIG", "EIB", "CTG", "CII", "VCI",
    "VIB", "BSR", "MSB", "PDR", "POW", "VSC", "FPT", "MWG", "KDH", "VCB",
    "STB", "HCM", "VRE", "MSN", "TCH", "VNM", "BID", "PVT", "ORS", "PVD",
    "VHM", "VCG", "KHG", "VIC", "LPB", "HAG", "DPM", "CTS", "HHV",
  ],

  // Deployed backend proxy on Render. For local dev against `npm start`,
  // swap BACKEND for "http://localhost:3001".
  // BACKEND = "https://dashboard-chung-khoan.onrender.com"
  priceProvider:        { name: "SSI FCData", baseUrl: "https://dashboard-chung-khoan.onrender.com/api/price" },
  fundamentalsProvider: { name: "VNDirect",   baseUrl: "https://dashboard-chung-khoan.onrender.com/api/fundamentals" },
  newsProvider:         { name: "CafeF RSS",  baseUrl: "https://dashboard-chung-khoan.onrender.com/api/news" },
  // Read-only SSI account sync. Needs a dashboard API key entered by the user;
  // never mocked — an empty account panel is better than fake holdings.
  accountProvider:      { name: "SSI FCTrading", baseUrl: "https://dashboard-chung-khoan.onrender.com/api/account" },
  // Gold. PNJ primary, BTMC fallback — the payload says which one answered, and
  // the page must show it: two shops quote different boards, and an unlabelled
  // swap looks like the market moved. Prices are thousand VND per chỉ.
  goldProvider:         { name: "PNJ + BTMC", baseUrl: "https://dashboard-chung-khoan.onrender.com/api/gold" },
  // FX. Two upstreams behind one prefix, and they are NOT the same rate:
  // /rates is Vietcombank's retail board (buy/sell spread), /history is the
  // interbank mid price. ~0.8% apart, permanently. The page labels both.
  fxProvider:           { name: "Vietcombank + FXRatesAPI", baseUrl: "https://dashboard-chung-khoan.onrender.com/api/fx" },

  currency: "VND",
};

if (typeof module !== "undefined") module.exports = APP_CONFIG;
