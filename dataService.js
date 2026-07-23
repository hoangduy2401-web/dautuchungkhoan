// ============================================================
// DATA SERVICE — the single adapter between widgets and data sources.
// Every widget calls DataService.*; nothing else calls fetch() directly.
// Toggle APP_CONFIG.USE_MOCK to switch mock <-> real backend with no
// changes to app.js / chartModule.js.
// ============================================================

const DataService = (function () {
  const cfg = APP_CONFIG;

  // Time the request out so a stalled backend call fails fast and
  // withFallback() can drop to mock instead of leaving a widget spinning.
  async function fetchJson(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
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

  // Per-endpoint timeouts. Fast endpoints abort quickly so a throttled symbol
  // falls back to mock/last value fast instead of stalling the widget. History
  // is chunked (up to ~3 sequential SSI calls) so it gets a longer budget.
  // The backend keeps a longer (18s) SSI timeout, so a slow-but-valid call
  // still finishes server-side and caches for the next 45s refresh.
  const T_FAST = 6000; // quote / indices / fundamentals / news
  const T_HISTORY = 12000;

  // ---- Market indices: [{code, value, changePct}] ----
  function getIndices() {
    return withFallback(
      "indices",
      () => fetchJson(`${cfg.priceProvider.baseUrl}/indices`, T_FAST),
      () => generateIndices()
    );
  }

  // ---- Latest quote: {price, changePct, volume} ----
  function getQuote(symbol) {
    return withFallback(
      `quote ${symbol}`,
      () => fetchJson(`${cfg.priceProvider.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`, T_FAST),
      () => generateQuote(symbol)
    );
  }

  // ---- OHLCV history: [{date, open, high, low, close, volume}] ----
  function getHistory(symbol, days) {
    return withFallback(
      `history ${symbol}`,
      () =>
        fetchJson(
          `${cfg.priceProvider.baseUrl}/history?symbol=${encodeURIComponent(symbol)}&days=${days}`,
          T_HISTORY
        ),
      () => generateHistory(symbol, days)
    );
  }

  // ---- Fundamentals: {marketCap, pe, pb, eps, roe, roa, ...} ----
  function getFundamentals(symbol) {
    return withFallback(
      `fundamentals ${symbol}`,
      () => fetchJson(`${cfg.fundamentalsProvider.baseUrl}/${encodeURIComponent(symbol)}`, T_FAST),
      () => generateFundamentals(symbol)
    );
  }

  // ---- News: [{symbol, title, source, time, url}] ----
  function getNews(symbols) {
    const q = (symbols || []).join(",");
    return withFallback(
      "news",
      () => fetchJson(`${cfg.newsProvider.baseUrl}?symbols=${encodeURIComponent(q)}`, T_FAST),
      () => generateNews(symbols)
    );
  }

  // ---- SSI account (read-only) ----------------------------------------
  // Never falls back to mock: showing invented holdings would be worse than
  // showing nothing. Errors propagate so the UI can ask for a PIN/OTP.
  async function accountFetch(path, apiKey, options = {}) {
    const res = await fetch(`${cfg.accountProvider.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-dashboard-key": apiKey,
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.detail || json.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = json.error;
      throw err;
    }
    return json;
  }

  const getAccountPortfolio = (apiKey) => accountFetch("/portfolio", apiKey);
  const requestAccountOtp = (apiKey) => accountFetch("/otp", apiKey, { method: "POST" });
  const loginAccount = (apiKey, code) =>
    accountFetch("/login", apiKey, { method: "POST", body: JSON.stringify({ code }) });

  return {
    getCompanyInfo,
    getIndices,
    getQuote,
    getHistory,
    getFundamentals,
    getNews,
    getAccountPortfolio,
    requestAccountOtp,
    loginAccount,
  };
})();
