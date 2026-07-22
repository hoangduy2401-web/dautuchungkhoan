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

  // Run the real fetch; on failure fall back to mock so the UI stays alive
  // while the backend is being wired up (APP_CONFIG.FALLBACK_TO_MOCK_ON_ERROR).
  async function withFallback(label, realFn, mockFn) {
    if (cfg.USE_MOCK) return mockFn();
    try {
      return await realFn();
    } catch (err) {
      if (!cfg.FALLBACK_TO_MOCK_ON_ERROR) throw err;
      console.warn(`[DataService] ${label} lỗi, dùng mock:`, err.message);
      return mockFn();
    }
  }

  // ---- Company info: static in both modes (no dedicated endpoint) ----
  function getCompanyInfo(symbol) {
    return COMPANY_INFO[symbol] || { name: symbol, exchange: "HOSE" };
  }

  // ---- Market indices: [{code, value, changePct}] ----
  function getIndices() {
    return withFallback(
      "indices",
      () => fetchJson(`${cfg.priceProvider.baseUrl}/indices`),
      () => generateIndices()
    );
  }

  // ---- Latest quote: {price, changePct, volume} ----
  function getQuote(symbol) {
    return withFallback(
      `quote ${symbol}`,
      () => fetchJson(`${cfg.priceProvider.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`),
      () => generateQuote(symbol)
    );
  }

  // ---- OHLCV history: [{date, open, high, low, close, volume}] ----
  function getHistory(symbol, days) {
    return withFallback(
      `history ${symbol}`,
      () =>
        fetchJson(
          `${cfg.priceProvider.baseUrl}/history?symbol=${encodeURIComponent(symbol)}&days=${days}`
        ),
      () => generateHistory(symbol, days)
    );
  }

  // ---- Fundamentals: {marketCap, pe, pb, eps, roe, roa, ...} ----
  function getFundamentals(symbol) {
    return withFallback(
      `fundamentals ${symbol}`,
      () => fetchJson(`${cfg.fundamentalsProvider.baseUrl}/${encodeURIComponent(symbol)}`),
      () => generateFundamentals(symbol)
    );
  }

  // ---- News: [{symbol, title, source, time, url}] ----
  function getNews(symbols) {
    const q = (symbols || []).join(",");
    return withFallback(
      "news",
      () => fetchJson(`${cfg.newsProvider.baseUrl}?symbols=${encodeURIComponent(q)}`),
      () => generateNews(symbols)
    );
  }

  return { getCompanyInfo, getIndices, getQuote, getHistory, getFundamentals, getNews };
})();
