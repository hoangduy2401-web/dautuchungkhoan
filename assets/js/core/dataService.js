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
  //
  // NOT used for prices/indices/history any more — see the block below. Mock
  // fundamentals/news are obviously placeholder text; a mock *price* is an
  // invented number that looks exactly like a real one.
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

  // Price data never falls back to mock. A fabricated quote is indistinguishable
  // from a real one on screen, so a failed fetch must surface as "no data", not
  // as a plausible wrong number. Callers handle the rejection.
  function livePrice(realFn, mockFn) {
    if (cfg.USE_MOCK) return Promise.resolve(mockFn());
    return realFn();
  }

  // ---- Backend wake-up probe ------------------------------------------------
  // Render Free spins the instance down after 15 minutes idle; the next request
  // pays a 30-60s cold start. Firing the normal 10s-timeout data calls into that
  // window makes every one of them abort — which is exactly how the board used
  // to fill with mock numbers on first load. So: probe /health with a long
  // budget FIRST, and only start loading data once the instance answers.
  const healthUrl = () => cfg.priceProvider.baseUrl.replace(/\/api\/.*$/, "") + "/health";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let awakeUntil = 0; // skip the probe entirely while we know it is up
  const AWAKE_TRUST_MS = 60_000;

  // Resolves true once /health answers, false if the whole budget runs out.
  async function wakeBackend(budgetMs = 90_000) {
    if (cfg.USE_MOCK) return true;
    if (Date.now() < awakeUntil) return true;
    const started = Date.now();
    while (Date.now() - started < budgetMs) {
      try {
        await fetchJson(healthUrl(), 25_000);
        awakeUntil = Date.now() + AWAKE_TRUST_MS;
        return true;
      } catch (err) {
        await sleep(2000);
      }
    }
    return false;
  }

  // Called by the UI when a data call fails: forces the next cycle to re-probe
  // instead of trusting the cached "awake" flag.
  function markAsleep() {
    awakeUntil = 0;
  }

  // ---- Company info: static in both modes (no dedicated endpoint) ----
  function getCompanyInfo(symbol) {
    return COMPANY_INFO[symbol] || { name: symbol, exchange: "HOSE" };
  }

  // Per-endpoint timeouts. Fast endpoints abort quickly so one throttled symbol
  // cannot stall the widget. History is chunked (up to ~3 sequential SSI calls)
  // so it gets a longer budget. The backend keeps a longer (18s) SSI timeout, so
  // a slow-but-valid call still finishes server-side and caches for the next
  // 45s refresh.
  //
  // 10s, not 6s: measured against the live backend, 30 parallel quotes on a cold
  // cache finish in ~2s — but the old 6s left almost no headroom, so a single
  // slow SSI call aborted the request. wakeBackend() already absorbs the cold
  // start, so this budget only has to cover a cold *cache*.
  const T_FAST = 10000; // quote / indices / fundamentals / news
  const T_HISTORY = 12000;

  // ---- Market indices: [{code, value, changePct}] ----
  function getIndices() {
    return livePrice(
      () => fetchJson(`${cfg.priceProvider.baseUrl}/indices`, T_FAST),
      () => generateIndices()
    );
  }

  // ---- Latest quote: {price, changePct, volume} ----
  function getQuote(symbol) {
    return livePrice(
      () => fetchJson(`${cfg.priceProvider.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`, T_FAST),
      () => generateQuote(symbol)
    );
  }

  // ---- OHLCV history: [{date, open, high, low, close, volume}] ----
  function getHistory(symbol, days) {
    // History is chunked 30 days per SSI call, so long ranges need a bigger
    // budget or they abort mid-fetch and fall back to mock. 1Y ~13 chunks, 5Y
    // ~42 chunks — scale the timeout so a cold load actually completes (backend
    // caches the result, so only the first hit is slow).
    const timeoutMs = days > 730 ? 75000 : days > 270 ? 30000 : T_HISTORY;
    return livePrice(
      () =>
        fetchJson(
          `${cfg.priceProvider.baseUrl}/history?symbol=${encodeURIComponent(symbol)}&days=${days}`,
          timeoutMs
        ),
      () => generateHistory(symbol, days)
    );
  }

  // ---- Index history: [{date, close, volume}] — NO open/high/low ----
  // Different shape from getHistory on purpose: SSI DailyIndex has no OHLC, only
  // one IndexValue per day, so the chart draws a line. Don't fake candles.
  // Costlier per day than stock history (30-day chunks, 1Y ~13 calls / 5Y ~61),
  // measured cold on the local backend: 90d 5,5s · 1Y 8,0s · 5Y 34,9s.
  // Budgets are much larger than the stock ones and NOT shared with them: the
  // backend limiter runs concurrency=1, so clicking two indices in a row makes
  // the second wait out the whole first job. Measured failure: HNX 90d then
  // UPCoM 90d then UPCoM 1Y back-to-back — the last two died on
  // net::ERR_ABORTED at the 12s stock budget while the backend was still
  // working through the queue and eventually answered every one of them.
  function getIndexHistory(code, days) {
    const timeoutMs = days > 730 ? 90000 : days > 270 ? 45000 : 25000;
    return livePrice(
      () =>
        fetchJson(
          `${cfg.priceProvider.baseUrl}/index-history?code=${encodeURIComponent(code)}&days=${days}`,
          timeoutMs
        ),
      () => generateHistory(code, days).map((d) => ({ date: d.date, close: d.close, volume: d.volume }))
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

  // ---- FX ---------------------------------------------------------------
  // Both are exchange rates and neither may fall back to mock: an invented rate
  // is indistinguishable from a real one (golden rule, CLAUDE.md §3).
  //
  // getFxRates    Vietcombank retail board: {updatedAt, source, kind:"retail",
  //               rates:[{code, name, buyCash, buyTransfer, sell}]}
  //               A null field means Vietcombank does not quote it (it prints
  //               "-" in the source XML), NOT zero.
  // getFxHistory  interbank mid series: {source, kind:"interbank", method,
  //               code, items:[{date, rate}]}
  //               Max 365 days — the free upstream has no deeper history, so
  //               this page has no 5Y button (see CLAUDE.md §10).
  function getFxRates() {
    return fetchJson(`${cfg.fxProvider.baseUrl}/rates`, T_FAST);
  }

  function getFxHistory(code, days) {
    return fetchJson(
      `${cfg.fxProvider.baseUrl}/history?code=${encodeURIComponent(code)}&days=${days}`,
      T_HISTORY
    );
  }

  // ---- Gold -------------------------------------------------------------
  // {updatedAt, source:"PNJ"|"BTMC", branch, unit:"nghìn đồng/chỉ", items:[...],
  //  note?} — `note` only appears when the fallback source answered.
  // buy/sell = null means that shop does not quote that side (PNJ only buys raw
  // gold), NOT zero. Never falls back to mock: an invented gold price is
  // indistinguishable from a real one.
  function getGoldPrices() {
    return fetchJson(`${cfg.goldProvider.baseUrl}/prices`, T_FAST);
  }

  // ---- Crypto -----------------------------------------------------------
  // getCryptoPrices  {updatedAt, source:"CoinGecko"|"Binance", note?, items:[
  //                   {id, symbol, name, image, vnd, usd, change24h, marketCap}]}
  //                  vnd = null khi Binance (dự phòng) trả lời — nó không có
  //                  giá VND và không được suy ra từ tỷ giá nguồn khác.
  // getCryptoHistory {source, currency:"VND", id, items:[{date, price}]}
  //                  Tối đa 365 ngày; gói free của CoinGecko không cho hơn.
  // searchCoins      [{id, symbol, name, rank}] — id là slug, không phải ticker.
  function getCryptoPrices(ids) {
    return fetchJson(`${cfg.cryptoProvider.baseUrl}/prices?ids=${encodeURIComponent((ids || []).join(","))}`, T_FAST);
  }

  function getCryptoHistory(id, days) {
    return fetchJson(`${cfg.cryptoProvider.baseUrl}/history?id=${encodeURIComponent(id)}&days=${days}`, T_HISTORY);
  }

  function searchCoins(q) {
    return fetchJson(`${cfg.cryptoProvider.baseUrl}/search?q=${encodeURIComponent(q)}`, T_FAST);
  }

  // ---- Savings ----------------------------------------------------------
  // {fetchedAt, source:"CafeF", terms:[...], banks:[{name,symbol,icon,rates}],
  //  stale?, snapshotAt?} — `rates[kỳ hạn]` = null khi ngân hàng không niêm yết
  // kỳ hạn đó, KHÔNG phải 0%.
  function getSavingsRates() {
    return fetchJson(`${cfg.savingsProvider.baseUrl}/rates`, T_FAST);
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
    wakeBackend,
    markAsleep,
    getCompanyInfo,
    getIndices,
    getQuote,
    getHistory,
    getIndexHistory,
    getFundamentals,
    getNews,
    getFxRates,
    getFxHistory,
    getGoldPrices,
    getSavingsRates,
    getCryptoPrices,
    getCryptoHistory,
    searchCoins,
    getAccountPortfolio,
    requestAccountOtp,
    loginAccount,
  };
})();
