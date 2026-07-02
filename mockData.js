// ============================================================
// MOCK DATA — synthetic data so the dashboard renders with zero setup.
// Safe to delete once USE_MOCK=false and the real backend is wired.
// All prices are already in "thousands of VND" (HOSE display unit).
// ============================================================

// Static company directory. getCompanyInfo() reads this in BOTH mock and
// real mode (there is no company-info endpoint), so keep it around.
const COMPANY_INFO = {
  VNM: { name: "Vinamilk", exchange: "HOSE" },
  FPT: { name: "FPT Corp", exchange: "HOSE" },
  SSI: { name: "Chứng khoán SSI", exchange: "HOSE" },
  VCB: { name: "Vietcombank", exchange: "HOSE" },
  HPG: { name: "Hòa Phát", exchange: "HOSE" },
  MWG: { name: "Thế Giới Di Động", exchange: "HOSE" },
  VIC: { name: "Vingroup", exchange: "HOSE" },
  VHM: { name: "Vinhomes", exchange: "HOSE" },
  ACB: { name: "Ngân hàng ACB", exchange: "HOSE" },
  TCB: { name: "Techcombank", exchange: "HOSE" },
  MBB: { name: "MB Bank", exchange: "HOSE" },
  GAS: { name: "PV Gas", exchange: "HOSE" },
};

// Baseline price per symbol (thousands VND) to anchor the random walk.
const BASE_PRICE = {
  VNM: 68, FPT: 132, SSI: 34, VCB: 92, HPG: 27, MWG: 61,
  VIC: 43, VHM: 41, ACB: 25, TCB: 24, MBB: 23, GAS: 76,
};

// ---- Deterministic PRNG so a symbol's history is stable across refreshes ----
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function basePriceOf(symbol) {
  return BASE_PRICE[symbol] || 20 + (hashSeed(symbol) % 80);
}

// ---- Generators -------------------------------------------------------------

// [{date, open, high, low, close, volume}] ascending by date.
function generateHistory(symbol, days) {
  const rnd = mulberry32(hashSeed(symbol + ":" + days));
  const out = [];
  let price = basePriceOf(symbol);
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    // Skip weekends to mimic a trading calendar.
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const drift = (rnd() - 0.48) * price * 0.03; // slight upward bias
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * (1 + rnd() * 0.015);
    const low = Math.min(open, close) * (1 - rnd() * 0.015);
    const volume = Math.round((0.5 + rnd() * 2) * 1_000_000);

    out.push({
      date: d.toISOString().slice(0, 10),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume,
    });
    price = close;
  }
  return out;
}

// {price, changePct, volume} — small live jitter each call.
function generateQuote(symbol) {
  const rnd = mulberry32(hashSeed(symbol) + Math.floor(Date.now() / 15000));
  const base = basePriceOf(symbol);
  const changePct = (rnd() - 0.5) * 6; // -3%..+3%
  const price = base * (1 + changePct / 100);
  return {
    price: +price.toFixed(2),
    changePct: +changePct.toFixed(2),
    volume: Math.round((0.5 + rnd() * 3) * 1_000_000),
  };
}

// Full fundamentals object matching the backend contract.
function generateFundamentals(symbol) {
  const rnd = mulberry32(hashSeed(symbol + ":fund"));
  const r = (min, max) => +(min + rnd() * (max - min)).toFixed(2);
  return {
    marketCap: r(20, 400),        // nghìn tỷ
    pe: r(6, 25),
    pb: r(0.8, 4),
    eps: r(2, 9),                 // nghìn đồng
    roe: r(8, 26),                // %
    roa: r(2, 12),                // %
    dividendYield: r(0, 7),       // %
    revenueYoY: r(-15, 35),       // %
    netProfitYoY: r(-20, 45),     // %
    debtToEquity: r(0.1, 1.8),
  };
}

// [{symbol, title, source, time (ISO), url}]
const NEWS_TEMPLATES = [
  "{S}: Kết quả kinh doanh quý vượt kỳ vọng",
  "{S} công bố kế hoạch chia cổ tức năm nay",
  "Khối ngoại mua ròng mạnh cổ phiếu {S}",
  "{S}: Lãnh đạo đăng ký mua vào cổ phiếu",
  "Phân tích kỹ thuật {S}: vùng hỗ trợ đáng chú ý",
  "{S} mở rộng thị phần, biên lợi nhuận cải thiện",
];
function generateNews(symbols) {
  const list = (symbols && symbols.length ? symbols : Object.keys(COMPANY_INFO)).slice(0, 8);
  const out = [];
  list.forEach((sym, si) => {
    const rnd = mulberry32(hashSeed(sym + ":news"));
    const count = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < count; k++) {
      const tpl = NEWS_TEMPLATES[(si + k) % NEWS_TEMPLATES.length];
      out.push({
        symbol: sym,
        title: tpl.replace("{S}", sym),
        source: "CafeF (mock)",
        time: new Date(Date.now() - (si * 3 + k) * 3600_000).toISOString(),
        url: "#",
      });
    }
  });
  return out.sort((a, b) => new Date(b.time) - new Date(a.time));
}

// [{code, value, changePct}]
function generateIndices() {
  const seed = Math.floor(Date.now() / 15000);
  const mk = (code, base) => {
    const rnd = mulberry32(hashSeed(code) + seed);
    const changePct = (rnd() - 0.5) * 2.4;
    return { code, value: +(base * (1 + changePct / 100)).toFixed(2), changePct: +changePct.toFixed(2) };
  };
  return [mk("VNINDEX", 1252), mk("VN30", 1290), mk("HNXINDEX", 238), mk("UPCOM", 94)];
}

if (typeof module !== "undefined") {
  module.exports = {
    COMPANY_INFO,
    generateHistory,
    generateQuote,
    generateFundamentals,
    generateNews,
    generateIndices,
  };
}
