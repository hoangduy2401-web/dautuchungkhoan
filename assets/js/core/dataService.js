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
      if (!res.ok) {
        const err = new Error(`${url} -> ${res.status}`);
        err.status = res.status;
        throw err;
      }
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
  // Concurrent callers share one probe: the page starts probing before user
  // data has hydrated, and bootData() then asks again while that probe is
  // still waiting out a cold start.
  let wakeInFlight = null;
  function wakeBackend(budgetMs = 90_000) {
    if (cfg.USE_MOCK) return Promise.resolve(true);
    if (Date.now() < awakeUntil) return Promise.resolve(true);
    if (!wakeInFlight) {
      wakeInFlight = probeUntilAwake(budgetMs).finally(() => {
        wakeInFlight = null;
      });
    }
    return wakeInFlight;
  }

  async function probeUntilAwake(budgetMs) {
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

  // ---- Last-good market snapshot (this browser only) ----------------------
  // The stock page saves indices + VN30/watchlist quotes after every good
  // refresh and paints them at once on the next visit, while a sleeping Render
  // instance takes 30-50s to wake. They are REAL numbers with their SSI read
  // time and are shown labelled as old (golden rule: old data must say when it
  // is from) — never mixed silently with live ones.
  // localStorage directly, not Store: this is a disposable market-data cache,
  // not user data, and must not be synced to Supabase on every refresh.
  const SNAP_KEY = "vn_dashboard_market_snapshot_v1";
  const SNAP_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // older than a week: useless
  function saveMarketSnapshot(snap) {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({ ...snap, savedAt: Date.now() }));
    } catch (err) {
      /* private mode / quota — the snapshot is only a convenience */
    }
  }
  function loadMarketSnapshot() {
    try {
      const snap = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
      if (!snap || !Array.isArray(snap.indices) || Date.now() - snap.savedAt > SNAP_MAX_AGE_MS) return null;
      return snap;
    } catch (err) {
      return null;
    }
  }

  // Same idea for the four asset pages (gold / fx / coin / savings): the last
  // good board answer per page, painted at once on the next visit while
  // Render wakes, labelled as old (theme.js setSnapshotNote). Same reasons for
  // localStorage-not-Store as above.
  const pageCacheKey = (name) => `vn_dashboard_cache_${name}_v1`;
  function savePageCache(name, data) {
    try {
      localStorage.setItem(pageCacheKey(name), JSON.stringify({ data, savedAt: Date.now() }));
    } catch (err) {
      /* private mode / quota — the cache is only a convenience */
    }
  }
  // -> { data, savedAt } | null
  function loadPageCache(name) {
    try {
      const c = JSON.parse(localStorage.getItem(pageCacheKey(name)) || "null");
      if (!c || !c.data || !(Date.now() - c.savedAt <= SNAP_MAX_AGE_MS)) return null;
      return c;
    } catch (err) {
      return null;
    }
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

  // ---- Batch quotes -------------------------------------------------------
  // Resolves { quotes: {SYM: quote}, asOf: ISO|null }. A symbol that failed is
  // simply absent (callers already treat "no quote" as "—"). `asOf` is when
  // SSI was actually read for the OLDEST quote in the batch — the backend may
  // serve a cache entry minutes old, so the time the browser got the answer
  // would overstate freshness.
  //
  // Falls back to one /quote per symbol on 404: GitHub Pages ships this file
  // within a minute of a push, Render takes several, so for a while the page
  // can be newer than the backend.
  const BATCH_MAX = 60;
  const T_BATCH = 30000; // cold symbols queue one by one on the SSI limiter
  async function getQuotes(symbols) {
    const list = [...new Set(symbols)];
    if (!list.length) return { quotes: {}, asOf: null };
    if (cfg.USE_MOCK) {
      return { quotes: Object.fromEntries(list.map((s) => [s, generateQuote(s)])), asOf: null };
    }
    try {
      const quotes = {};
      let asOf = null;
      for (let i = 0; i < list.length; i += BATCH_MAX) {
        const chunk = list.slice(i, i + BATCH_MAX);
        const r = await fetchJson(
          `${cfg.priceProvider.baseUrl}/quotes?symbols=${encodeURIComponent(chunk.join(","))}`,
          T_BATCH
        );
        Object.assign(quotes, r.quotes || {});
        if (r.asOf && (!asOf || r.asOf < asOf)) asOf = r.asOf;
      }
      return { quotes, asOf };
    } catch (err) {
      if (err.status !== 404) throw err;
      const results = await Promise.all(
        list.map((s) => getQuote(s).then((q) => [s, q], () => [s, null]))
      );
      return { quotes: Object.fromEntries(results.filter(([, q]) => q)), asOf: null };
    }
  }

  // ---- Batch close series for sparklines: { SYM: [close, ...] } ascending.
  // Same 404 fallback as getQuotes. Failed symbols are absent.
  async function getCloses(symbols, days) {
    const list = [...new Set(symbols)];
    if (!list.length) return {};
    const viaHistory = async () => {
      const results = await Promise.all(
        list.map((s) => getHistory(s, days).then((rows) => [s, rows], () => [s, null]))
      );
      return Object.fromEntries(
        results.filter(([, rows]) => Array.isArray(rows) && rows.length).map(([s, rows]) => [s, rows.map((r) => r.close)])
      );
    };
    if (cfg.USE_MOCK) return viaHistory();
    try {
      // Backend takes 20 symbols per call; the watchlist is unlimited now.
      const out = {};
      for (let i = 0; i < list.length; i += 20) {
        const chunk = list.slice(i, i + 20);
        const r = await fetchJson(
          `${cfg.priceProvider.baseUrl}/closes?symbols=${encodeURIComponent(chunk.join(","))}&days=${days}`,
          T_BATCH
        );
        Object.assign(out, r.closes || {});
      }
      return out;
    } catch (err) {
      if (err.status !== 404) throw err;
      return viaHistory();
    }
  }

  // ---- Market caps for heatmap sizing: {source, asOf, items:{SYM: nghìn tỷ}}.
  // No mock: an invented size would look real. Mock mode -> empty items, and
  // the heatmap falls back to equal tiles.
  function getMarketCaps(symbols) {
    if (cfg.USE_MOCK) return Promise.resolve({ source: null, asOf: null, items: {} });
    const base = cfg.fundamentalsProvider.baseUrl.replace(/\/fundamentals$/, "/marketcaps");
    return fetchJson(`${base}?symbols=${encodeURIComponent([...new Set(symbols)].join(","))}`, T_FAST);
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

  // ---- Valuation history: {source:"VNDirect", symbol, asOf, items:[{date, pe, pb}]}
  // Ascending, one row per day. pe/pb = null when VNDirect has no figure that
  // day (loss-making / negative equity) — never 0. Max 730 days. No mock: a
  // made-up P/E band would read as a real one.
  function getValuationHistory(symbol, days = 730) {
    return fetchJson(`${cfg.valuationProvider.baseUrl}/history?symbol=${encodeURIComponent(symbol)}&days=${days}`, T_FAST);
  }

  // ---- Quarterly results: {source, symbol, unit:"tỷ đồng", revenueLabel,
  //      items:[{period:"Q2/2026", fiscalDate, revenue, grossProfit, netProfit,
  //      operatingCashFlow}]} ascending. null = no figure (banks have no gross
  //      profit) — never 0. No mock, same reason as valuation.
  function getQuarterlyFinancials(symbol, quarters = 12) {
    return fetchJson(`${cfg.financialsProvider.baseUrl}/quarterly?symbol=${encodeURIComponent(symbol)}&quarters=${quarters}`, T_FAST);
  }

  // ---- Corporate actions: [{type, typeDesc, note, exDate, recordDate, ratio,
  //      cash, issuePrice, year}] newest first. type: DIVIDEND | KINDDIV | ISSUE.
  // Best-effort history for the dividend tab; empty array on failure so the
  // panel just shows "no data", never blocks the page.
  function getEvents(symbol) {
    return fetchJson(`${cfg.eventsProvider.baseUrl}/${encodeURIComponent(symbol)}`, T_FAST).catch(() => []);
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

  // SJC bar history, triệu ₫/lượng: {source:"CafeF"|"PNJ", note?, product,
  // unit, lastAt, items:[{date, buy, sell}], world: {source, method, note,
  // items:[{date, price}]} | null}. Never mock (a price). 30s budget: the PNJ
  // fallback is one request per day (~20s for 1M, measured).
  function getGoldHistory(days) {
    return fetchJson(`${cfg.goldProvider.baseUrl}/history?days=${days}`, 30000);
  }

  // Daily gold snapshots written by the backend job into Supabase
  // `price_snapshots` (public-read table, publishable key is fine): the
  // history the gold page needs to know each product's NORMAL buy/sell spread.
  // [{taken_on, payload:{items:[{code, buy, sell}]}}], oldest first.
  function getGoldSnapshots(days = 90) {
    const sb = cfg.supabase;
    const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const url =
      `${sb.url}/rest/v1/price_snapshots?kind=eq.gold&taken_on=gte.${since}` +
      `&select=taken_on,payload&order=taken_on.asc`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), T_FAST);
    return fetch(url, {
      signal: ctrl.signal,
      headers: { apikey: sb.publishableKey, Authorization: `Bearer ${sb.publishableKey}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`price_snapshots -> ${res.status}`);
        return res.json();
      })
      .finally(() => clearTimeout(timer));
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
    saveMarketSnapshot,
    loadMarketSnapshot,
    savePageCache,
    loadPageCache,
    getCompanyInfo,
    getIndices,
    getQuote,
    getQuotes,
    getCloses,
    getMarketCaps,
    getHistory,
    getIndexHistory,
    getFundamentals,
    getValuationHistory,
    getQuarterlyFinancials,
    getEvents,
    getNews,
    getFxRates,
    getFxHistory,
    getGoldPrices,
    getGoldHistory,
    getGoldSnapshots,
    getSavingsRates,
    getCryptoPrices,
    getCryptoHistory,
    searchCoins,
    getAccountPortfolio,
    requestAccountOtp,
    loginAccount,
  };
})();
