// ============================================================
// DATA SERVICE — the single adapter between widgets and data sources.
// Every widget calls DataService.*; nothing else calls fetch() directly.
// Toggle APP_CONFIG.USE_MOCK to switch mock <-> real backend with no
// changes to app.js / chartModule.js.
// ============================================================

const DataService = (function () {
  const cfg = APP_CONFIG;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  // ---- Company info: static in both modes (no dedicated endpoint) ----
  function getCompanyInfo(symbol) {
    return COMPANY_INFO[symbol] || { name: symbol, exchange: "HOSE" };
  }

  // ---- Market indices: [{code, value, changePct}] ----
  async function getIndices() {
    if (cfg.USE_MOCK) return generateIndices();
    return fetchJson(`${cfg.priceProvider.baseUrl}/indices`);
  }

  // ---- Latest quote: {price, changePct, volume} ----
  async function getQuote(symbol) {
    if (cfg.USE_MOCK) return generateQuote(symbol);
    return fetchJson(`${cfg.priceProvider.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`);
  }

  // ---- OHLCV history: [{date, open, high, low, close, volume}] ----
  async function getHistory(symbol, days) {
    if (cfg.USE_MOCK) return generateHistory(symbol, days);
    return fetchJson(
      `${cfg.priceProvider.baseUrl}/history?symbol=${encodeURIComponent(symbol)}&days=${days}`
    );
  }

  // ---- Fundamentals: {marketCap, pe, pb, eps, roe, roa, ...} ----
  async function getFundamentals(symbol) {
    if (cfg.USE_MOCK) return generateFundamentals(symbol);
    return fetchJson(`${cfg.fundamentalsProvider.baseUrl}/${encodeURIComponent(symbol)}`);
  }

  // ---- News: [{symbol, title, source, time, url}] ----
  async function getNews(symbols) {
    if (cfg.USE_MOCK) return generateNews(symbols);
    const q = (symbols || []).join(",");
    return fetchJson(`${cfg.newsProvider.baseUrl}?symbols=${encodeURIComponent(q)}`);
  }

  return { getCompanyInfo, getIndices, getQuote, getHistory, getFundamentals, getNews };
})();
