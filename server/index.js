// ============================================================
// Backend proxy - Bảng Điện Dashboard
// Purpose: hide SSI ConsumerID/Secret, bypass CORS, cache responses,
// and expose the flat JSON contract that dataService.js expects.
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Parser = require("rss-parser");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const rssParser = new Parser({
  timeout: 8000, // don't let a slow CafeF feed hang the /api/news request
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

// ------------------------------------------------------------
// Simple in-memory cache (avoid hammering upstream APIs / rate limits)
// ------------------------------------------------------------
const cache = new Map(); // key -> { data, expiresAt }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit || Date.now() > hit.expiresAt) return null;
  return hit.data;
}
function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ------------------------------------------------------------
// fetch() has no default timeout in Node/undici, so a stalled upstream
// (SSI throttling in particular) hangs the whole request. Abort after a
// deadline so the handler fails fast and the client can fall back.
// ------------------------------------------------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Concurrency limiter. SSI hard-throttles concurrent Market calls: firing 6
// quotes at once leaves ~3 of them stalling for ~30s. Funnelling every SSI
// data call through a tiny queue (default 2 in-flight) keeps us under that
// threshold, so calls stay ~1s each instead of stacking into minutes.
// ------------------------------------------------------------
function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
}
// Default 1: SSI throttles even 2-3 concurrent Market calls (some stall past a
// 10s timeout). Fully sequential is reliable; the warm-cache loop below keeps
// user requests off the critical path anyway. Tunable via env if SSI relaxes.
const ssiLimit = createLimiter(Number(process.env.SSI_CONCURRENCY) || 1);

// ------------------------------------------------------------
// Stale-while-revalidate cache with in-flight de-duplication.
//   - fresh entry            -> return it
//   - stale (within staleMs) -> return it NOW, refresh in the background
//   - missing / too old      -> await one producer call (deduped)
// This keeps SSI's slow, concurrency-throttled calls entirely off the user's
// critical path: after the first population, every request is served instantly
// from cache while freshness is restored in the background.
// ------------------------------------------------------------
const inFlight = new Map(); // key -> Promise
const DEFAULT_STALE_MS = 10 * 60_000; // how long a stale entry may still be served

function revalidate(key, ttlMs, producer) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = Promise.resolve()
    .then(producer)
    .then((data) => {
      cacheSet(key, data, ttlMs);
      return data;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  p.catch(() => {}); // a background refresh failure must not crash the process
  return p;
}

function withCache(key, ttlMs, producer, { staleMs = DEFAULT_STALE_MS } = {}) {
  const entry = cache.get(key);
  const now = Date.now();
  if (entry) {
    if (now < entry.expiresAt) return Promise.resolve(entry.data); // fresh
    if (now < entry.expiresAt + staleMs) {
      revalidate(key, ttlMs, producer); // serve stale, refresh in background
      return Promise.resolve(entry.data);
    }
  }
  return revalidate(key, ttlMs, producer); // nothing usable -> must produce now
}

// ------------------------------------------------------------
// Defensive parsing helpers.
// SSI docs disagree on response shape: rows may live under `data`,
// `dataList` or `Data`, and field casing differs between versions
// (PascalCase vs lowerCamelCase). Keep these until the live format
// is confirmed, then simplify.
// ------------------------------------------------------------
function extractRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const candidates = [raw.data, raw.Data, raw.dataList, raw.DataList, raw.items, raw.Items];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    // Sometimes the payload is nested one level deeper: { data: { dataList: [...] } }
    if (c && typeof c === "object") {
      const nested = extractRows(c);
      if (nested.length) return nested;
    }
  }
  return [];
}

// Pick the first present field among several possible names (case-insensitive).
function pickField(row, names, fallback = undefined) {
  if (!row) return fallback;
  const lowerMap = {};
  for (const k of Object.keys(row)) lowerMap[k.toLowerCase()] = row[k];
  for (const n of names) {
    const v = lowerMap[n.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

function num(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// SSI FCData returns raw VND; dashboard displays in thousands of VND.
function toThousandVnd(v) {
  return num(v) / 1000;
}

function normalizeDate(d) {
  if (!d) return "";
  const s = String(d);
  // SSI often returns dd/mm/yyyy — convert to yyyy-mm-dd for Lightweight Charts.
  if (s.includes("/")) {
    const [dd, mm, yyyy] = s.split("/");
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return s.slice(0, 10);
}

// SSI expects dd/mm/yyyy
function fmtSsiDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ============================================================
// SSI FastConnect Data (FCData) — auth + OHLCV + indices
// Docs: guide.ssi.com.vn/ssi-products/tieng-viet/fastconnect-data
// ============================================================
const SSI_BASE = process.env.SSI_BASE_URL || "https://fc-data.ssi.com.vn";

let ssiToken = null;
let ssiTokenExpiry = 0;

async function getSsiToken() {
  if (ssiToken && Date.now() < ssiTokenExpiry) return ssiToken;

  if (!process.env.SSI_CONSUMER_ID || !process.env.SSI_CONSUMER_SECRET) {
    throw new Error("Missing SSI_CONSUMER_ID / SSI_CONSUMER_SECRET in server/.env");
  }

  const res = await fetchWithTimeout(
    `${SSI_BASE}/api/v2/Market/AccessToken`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumerID: process.env.SSI_CONSUMER_ID,
        consumerSecret: process.env.SSI_CONSUMER_SECRET,
      }),
    },
    15000
  );

  if (!res.ok) {
    throw new Error(`SSI auth failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  ssiToken = json.data?.accessToken || json.data?.AccessToken || json.accessToken;
  if (!ssiToken) throw new Error("SSI auth response missing accessToken");

  // Real TTL is 8h; refresh an hour early to be safe.
  ssiTokenExpiry = Date.now() + 7 * 60 * 60 * 1000;
  return ssiToken;
}

async function ssiGet(path, params) {
  // Resolve the token BEFORE entering the limiter so a token refresh never
  // deadlocks behind queued data calls that are themselves waiting for it.
  const token = await getSsiToken();
  const url = new URL(`${SSI_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });

  // Serialise through the SSI limiter (+ per-call timeout) to dodge SSI's
  // punitive concurrent-call throttling.
  return ssiLimit(async () => {
    // 18s: SSI single calls are occasionally slow; since calls are serialised
    // this can't stack. The frontend has its own 12s cap, so a slow call still
    // finishes server-side and populates cache for the next refresh.
    const res = await fetchWithTimeout(
      url,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      18000
    );
    if (!res.ok) throw new Error(`SSI ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  });
}

// ------------------------------------------------------------
// DailyOhlc is capped at 30 days per call (PDF v2.2), so fetch in chunks
// and page through each chunk.
// ------------------------------------------------------------
const OHLC_CHUNK_DAYS = 30;
const OHLC_PAGE_SIZE = 100; // SSI max is typically 100

async function fetchOhlcChunk(symbol, from, to) {
  const rows = [];
  for (let pageIndex = 1; pageIndex <= 10; pageIndex++) {
    const raw = await ssiGet("/api/v2/Market/DailyOhlc", {
      Symbol: symbol,
      FromDate: fmtSsiDate(from),
      ToDate: fmtSsiDate(to),
      PageIndex: pageIndex,
      PageSize: OHLC_PAGE_SIZE,
      ascending: true,
    });
    const page = extractRows(raw);
    rows.push(...page);
    if (page.length < OHLC_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchOhlcChunked(symbol, days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);

  const all = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + (OHLC_CHUNK_DAYS - 1) * 24 * 3600 * 1000, end.getTime())
    );
    // Sequential on purpose: SSI rate-limits concurrent calls hard.
    const rows = await fetchOhlcChunk(symbol, cursor, chunkEnd);
    all.push(...rows);
    cursor = new Date(chunkEnd.getTime() + 24 * 3600 * 1000);
  }
  return all;
}

function mapOhlcRow(d) {
  return {
    date: normalizeDate(pickField(d, ["TradingDate", "Date", "tradingDate"])),
    open: toThousandVnd(pickField(d, ["Open", "OpenPrice"])),
    high: toThousandVnd(pickField(d, ["High", "HighestPrice", "HighPrice"])),
    low: toThousandVnd(pickField(d, ["Low", "LowestPrice", "LowPrice"])),
    close: toThousandVnd(pickField(d, ["Close", "ClosePrice", "LastPrice"])),
    volume: num(pickField(d, ["Volume", "TotalMatchVol", "TotalVol", "NmVolume"])),
  };
}

async function computeHistory(symbol, days) {
  const rows = await fetchOhlcChunked(symbol, days);
  // Dedupe by date (chunk boundaries / paging can overlap) and sort ascending.
  const byDate = new Map();
  for (const r of rows) {
    const item = mapOhlcRow(r);
    if (item.date) byDate.set(item.date, item);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// GET /api/price/history?symbol=VNM&days=90
app.get("/api/price/history", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const days = Number(req.query.days) || 90;
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  try {
    const items = await withCache(`history:${symbol}:${days}`, 60_000, () => computeHistory(symbol, days));
    res.json(items);
  } catch (err) {
    console.error("[/api/price/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

async function computeIndices() {
  // DailyIndex only accepts one IndexId per call (IndexId=ALL -> NoDataFound),
  // so query each index we display. Left = SSI IndexId, right = UI code.
  const WANTED = [
    ["VNINDEX", "VNINDEX"],
    ["VN30", "VN30"],
    ["HNXIndex", "HNXINDEX"],
    ["HNXUpcomIndex", "UPCOM"],
  ];

  const today = new Date();
  const from = fmtSsiDate(new Date(today.getTime() - 7 * 24 * 3600 * 1000));
  const to = fmtSsiDate(today);

  const items = [];
  for (const [indexId, uiCode] of WANTED) {
    // Sequential on purpose: SSI rate-limits concurrent calls hard.
    const raw = await ssiGet("/api/v2/Market/DailyIndex", {
      IndexId: indexId,
      FromDate: from,
      ToDate: to,
      PageIndex: 1,
      PageSize: 10, // SSI only accepts 10 / 20 / 50 / 100 / 1000
      ascending: false,
    }).catch((err) => {
      console.warn(`[indices] ${indexId}: ${err.message}`);
      return null;
    });

    const rows = extractRows(raw)
      .map((r) => ({ row: r, date: normalizeDate(pickField(r, ["TradingDate", "Date"])) }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const d = rows[0]?.row;
    if (!d) continue;

    items.push({
      code: uiCode,
      // Index values are already in points, do NOT divide by 1000.
      value: num(pickField(d, ["IndexValue", "Value", "IndexVal"])),
      // RatioChange is the % change. NOTE: the sibling `Change` field is
      // scaled oddly (-0.6203 for a -62.03 point move) — do not use it.
      changePct: num(pickField(d, ["RatioChange", "PercentIndexChange", "PercentPriceChange", "ChangePct"])),
    });
  }
  return items;
}

// GET /api/price/indices
app.get("/api/price/indices", async (req, res) => {
  try {
    const items = await withCache("indices", 45_000, computeIndices);
    res.json(items);
  } catch (err) {
    console.error("[/api/price/indices]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// Latest quote for one symbol, in thousands of VND. Shared by /api/price/quote
// and the account panel (FCTrading returns marketPrice = 0 outside market hours).
async function computeQuote(symbol) {
  // DailyStockPrice carries close + reference price for the change% calc.
  const today = new Date();
  const raw = await ssiGet("/api/v2/Market/DailyStockPrice", {
    Symbol: symbol,
    FromDate: fmtSsiDate(new Date(today.getTime() - 7 * 24 * 3600 * 1000)),
    ToDate: fmtSsiDate(today),
    PageIndex: 1,
    PageSize: 10,
    Market: "",
    ascending: false,
  });

  const rows = extractRows(raw)
    .map((r) => ({ row: r, date: normalizeDate(pickField(r, ["TradingDate", "Date"])) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const d = rows[0]?.row || {};
  const price = toThousandVnd(pickField(d, ["ClosePrice", "MatchPrice", "MatchedPrice", "Close"]));
  const refPrice = toThousandVnd(pickField(d, ["RefPrice", "BasicPrice", "PriorClosePrice"]));

  return {
    price,
    changePct: refPrice ? ((price - refPrice) / refPrice) * 100 : 0,
    volume: num(pickField(d, ["TotalMatchVol", "TotalVol", "Volume"])),
  };
}

// Cached + de-duplicated. 45s TTL: outside trading hours the quote barely moves.
function fetchQuote(symbol) {
  return withCache(`quote:${symbol}`, 45_000, () => computeQuote(symbol));
}

// GET /api/price/quote?symbol=VNM  (used by dataService.getQuote)
app.get("/api/price/quote", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  try {
    res.json(await fetchQuote(symbol));
  } catch (err) {
    console.error("[/api/price/quote]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// Fundamentals — VNDirect finfo (public, allows server-to-server).
// SSI FCData and FCTrading have no fundamentals endpoint; TCBS blocks
// server-to-server requests (404) even with browser-like headers.
// Ratios come from /ratios/latest; growth + debt/equity are not exposed
// there, so they are derived from /financial_statements line items.
// ============================================================
const VNDIRECT_RATIOS = "https://api-finfo.vndirect.com.vn/v4/ratios/latest";
const VNDIRECT_STATEMENTS = "https://api-finfo.vndirect.com.vn/v4/financial_statements";

// Statement line item codes (from /v4/financial_models catalog).
// 13000/14000/23000 are identical for NON_FINANCE and BANK company forms;
// only the revenue line differs.
const ITEM_REVENUE = 21001; // Doanh thu thuần (NON_FINANCE)
const ITEM_REVENUE_BANK = 421701; // Tổng thu nhập hoạt động (BANK)
const ITEM_NPATMI = 23000; // Lợi nhuận sau thuế của Công ty mẹ
const ITEM_LIABILITIES = 13000; // Nợ phải trả
const ITEM_EQUITY = 14000; // Vốn chủ sở hữu

async function vndirectJson(url) {
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 8000);
  if (!res.ok) throw new Error(`VNDirect ${res.status}`);
  return (await res.json()).data || [];
}

// Group statement rows by fiscalDate: { "2025-12-31": { 21001: n, ... } }
function groupByFiscalDate(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const d = r.fiscalDate;
    if (!byDate.has(d)) byDate.set(d, {});
    byDate.get(d)[Math.round(Number(r.itemCode))] = Number(r.numericValue);
  }
  return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])); // newest first
}

const pctChange = (now, prev) =>
  Number.isFinite(now) && Number.isFinite(prev) && prev !== 0 ? ((now - prev) / Math.abs(prev)) * 100 : null;

// YoY growth (latest fiscal year vs the one before) + debt/equity from the
// most recent quarterly balance sheet.
async function fetchDerivedFundamentals(symbol) {
  const incomeItems = [ITEM_REVENUE, ITEM_REVENUE_BANK, ITEM_NPATMI].join(",");
  const balanceItems = [ITEM_LIABILITIES, ITEM_EQUITY].join(",");

  const [annual, quarterly] = await Promise.all([
    vndirectJson(
      `${VNDIRECT_STATEMENTS}?q=code:${symbol}~reportType:ANNUAL~itemCode:${incomeItems}` +
        `&sort=fiscalDate:desc&size=30`
    ).catch(() => []),
    vndirectJson(
      `${VNDIRECT_STATEMENTS}?q=code:${symbol}~reportType:QUARTER~itemCode:${balanceItems}` +
        `&sort=fiscalDate:desc&size=4`
    ).catch(() => []),
  ]);

  const years = groupByFiscalDate(annual);
  const [cur, prev] = [years[0]?.[1], years[1]?.[1]];
  // Banks report Tổng thu nhập hoạt động instead of Doanh thu thuần.
  const revenueOf = (y) => (y ? (y[ITEM_REVENUE] ?? y[ITEM_REVENUE_BANK]) : undefined);

  const balance = groupByFiscalDate(quarterly)[0]?.[1];
  const equity = balance?.[ITEM_EQUITY];

  return {
    revenueYoY: pctChange(revenueOf(cur), revenueOf(prev)),
    netProfitYoY: pctChange(cur?.[ITEM_NPATMI], prev?.[ITEM_NPATMI]),
    debtToEquity:
      Number.isFinite(balance?.[ITEM_LIABILITIES]) && Number.isFinite(equity) && equity !== 0
        ? balance[ITEM_LIABILITIES] / equity
        : null,
  };
}
const VNDIRECT_CODES = [
  "MARKETCAP",
  "PRICE_TO_EARNINGS",
  "PRICE_TO_BOOK",
  "DIVIDEND_YIELD",
  "ROAE_TR_AVG5Q", // ROE, trailing average of 5 quarters
  "ROAA_TR_AVG5Q", // ROA
  "EPS_TR", // trailing EPS, raw VND
  "BVPS_CR",
];

async function computeFundamentals(symbol) {
  const [rows, derived] = await Promise.all([
    vndirectJson(
      `${VNDIRECT_RATIOS}?filter=ratioCode:${VNDIRECT_CODES.join(",")}` +
        `&where=code:${symbol}&order=reportDate&fields=ratioCode,value,reportDate`
    ),
    // Derived metrics are best-effort: never fail the whole response for them.
    fetchDerivedFundamentals(symbol).catch((err) => {
      console.warn(`[fundamentals] derived ${symbol}: ${err.message}`);
      return { revenueYoY: null, netProfitYoY: null, debtToEquity: null };
    }),
  ]);
  if (!rows.length) throw new Error(`VNDirect trả rỗng cho ${symbol}`);

  const v = {};
  for (const r of rows) v[r.ratioCode] = Number(r.value);
  const has = (k) => v[k] !== undefined && Number.isFinite(v[k]);

  return {
    marketCap: has("MARKETCAP") ? v.MARKETCAP / 1e12 : null, // -> nghìn tỷ
    pe: has("PRICE_TO_EARNINGS") ? v.PRICE_TO_EARNINGS : null,
    pb: has("PRICE_TO_BOOK") ? v.PRICE_TO_BOOK : null,
    eps: has("EPS_TR") ? v.EPS_TR / 1000 : null, // -> nghìn đ
    roe: has("ROAE_TR_AVG5Q") ? v.ROAE_TR_AVG5Q * 100 : null,
    roa: has("ROAA_TR_AVG5Q") ? v.ROAA_TR_AVG5Q * 100 : null,
    dividendYield: has("DIVIDEND_YIELD") ? v.DIVIDEND_YIELD * 100 : null,
    ...derived, // revenueYoY, netProfitYoY, debtToEquity
  };
}

app.get("/api/fundamentals/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  try {
    // 6h TTL — fundamentals change slowly.
    const fundamentals = await withCache(`fund:${symbol}`, 6 * 3600_000, () => computeFundamentals(symbol));
    res.json(fundamentals);
  } catch (err) {
    console.error("[/api/fundamentals]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// News — CafeF RSS, filtered by ticker mention in title/snippet
// ============================================================
const CAFEF_FEEDS = [
  "https://cafef.vn/thi-truong-chung-khoan.rss",
  "https://cafef.vn/doanh-nghiep.rss",
];

// `\b` does NOT work with Vietnamese text (diacritics are non-ASCII word chars
// in JS's legacy \b semantics). Use Unicode-aware lookarounds instead.
function makeSymbolRegex(sym) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${sym}(?![\\p{L}\\p{N}])`, "u");
}

async function computeNews(symbols) {
  const feeds = await Promise.all(
    CAFEF_FEEDS.map((url) => rssParser.parseURL(url).catch(() => ({ items: [] })))
  );
  const allItems = feeds.flatMap((f) => f.items || []);
  const matchers = symbols.map((sym) => ({ sym, re: makeSymbolRegex(sym) }));

  return allItems
    .map((item) => {
      const haystack = `${item.title || ""} ${item.contentSnippet || ""}`.toUpperCase();
      const hit = matchers.find((m) => m.re.test(haystack));
      if (!hit) return null;
      return {
        symbol: hit.sym,
        title: item.title,
        source: "CafeF",
        time: item.isoDate || new Date().toISOString(),
        url: item.link,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 30);
}

app.get("/api/news", async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    const news = await withCache(`news:${symbols.join(",")}`, 5 * 60_000, () => computeNews(symbols));
    res.json(news);
  } catch (err) {
    console.error("[/api/news]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// SSI FastConnect TRADING — READ ONLY (phase 1).
// Separate host and separate credentials from FCData. Nothing here can
// place, modify or cancel an order: those need an RSA-SHA256 signature
// with a private key, which this server deliberately does not hold.
//
// These routes expose personal account data, so unlike the price routes
// they are gated by a shared secret (DASHBOARD_API_KEY) and an origin
// allowlist. Without the env var set the whole feature stays off.
// ============================================================
const SSI_TRADE_BASE = process.env.SSI_TRADE_BASE_URL || "https://fc-tradeapi.ssi.com.vn";

const ACCOUNT_ORIGINS = new Set([
  "https://dashboardstock.io.vn",
  "https://www.dashboardstock.io.vn",
  "https://hoangduy2401-web.github.io",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);

function requireAllowedOrigin(req, res, next) {
  const origin = req.get("origin");
  // No Origin header = curl/server-side call; the API key below still applies.
  if (origin && !ACCOUNT_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "origin_not_allowed", detail: origin });
  }
  next();
}

function requireDashboardKey(req, res, next) {
  const expected = process.env.DASHBOARD_API_KEY || "";
  if (!expected) {
    return res.status(503).json({
      error: "account_api_disabled",
      detail: "Chưa set DASHBOARD_API_KEY — tính năng tài khoản đang tắt.",
    });
  }
  const got = String(req.get("x-dashboard-key") || "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so check length first.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

const accountGuards = [requireAllowedOrigin, requireDashboardKey];

// Account numbers are 7 digits: 6-digit customer code + 1 (cơ sở) / 8 (phái sinh).
function normalizeAccount(acc) {
  const a = String(acc || "").trim();
  return a.length === 6 ? `${a}1` : a;
}

// Token cache on disk so a server restart does not force a fresh OTP.
// Render's filesystem is ephemeral, so a cold start still needs one.
const TOKEN_CACHE_FILE = path.join(os.tmpdir(), "ssi-trade-token.json");

let tradeToken = null;
let tradeTokenExpiry = 0;

(function restoreTradeToken() {
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, "utf8"));
    if (c.token && c.expiry > Date.now()) {
      tradeToken = c.token;
      tradeTokenExpiry = c.expiry;
      console.log("[FCTrading] khôi phục token từ cache, hết hạn", new Date(c.expiry).toISOString());
    }
  } catch {
    /* no cache yet */
  }
})();

function persistTradeToken() {
  try {
    fs.writeFileSync(
      TOKEN_CACHE_FILE,
      JSON.stringify({ token: tradeToken, expiry: tradeTokenExpiry }),
      { mode: 0o600 }
    );
  } catch (err) {
    console.warn("[FCTrading] không ghi được token cache:", err.message);
  }
}

// FCTrading answers HTTP 200 even for failures, putting the real outcome in
// `status` (200 = success) and `message`. Checking res.ok alone silently
// swallows errors like "2FA type is invalid".
function assertTradeOk(path, json) {
  const status = Number(json.status);
  if (Number.isFinite(status) && status !== 200) {
    throw new Error(`FCTrading ${path}: ${json.message || `status ${status}`}`);
  }
  return json;
}

async function tradePost(path, body) {
  const res = await fetch(`${SSI_TRADE_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`FCTrading ${path}: ${res.status} ${json.message || ""}`);
  return assertTradeOk(path, json);
}

// `code` = PIN or OTP. Falls back to SSI_TRADING_PIN so a PIN-based account
// can refresh silently; OTP accounts must post a fresh code each session.
async function loginTrading(code) {
  const consumerID = process.env.SSI_TRADING_CONSUMER_ID;
  const consumerSecret = process.env.SSI_TRADING_CONSUMER_SECRET;
  if (!consumerID || !consumerSecret) {
    throw new Error("Thiếu SSI_TRADING_CONSUMER_ID / SSI_TRADING_CONSUMER_SECRET");
  }

  const twoFactorType = String(process.env.SSI_TRADING_2FA_TYPE ?? "0"); // 0 = PIN, 1 = OTP
  const finalCode = code || process.env.SSI_TRADING_PIN || "";
  if (!finalCode) throw new Error("Cần mã PIN/OTP để lấy token FCTrading");

  const json = await tradePost("/api/v2/Trading/AccessToken", {
    consumerID,
    consumerSecret,
    code: finalCode,
    twoFactorType,
    isSave: true,
  });

  const token = json.data?.accessToken || json.data?.AccessToken;
  if (!token) throw new Error(`FCTrading không trả accessToken: ${json.message || "unknown"}`);

  tradeToken = token;
  tradeTokenExpiry = Date.now() + 7 * 60 * 60 * 1000; // TTL 8h, refresh sớm 1h
  persistTradeToken();
  return token;
}

async function getTradeToken() {
  if (tradeToken && Date.now() < tradeTokenExpiry) return tradeToken;
  return loginTrading(); // silent refresh only works for PIN accounts
}

async function tradeGet(path, params) {
  const token = await getTradeToken();
  const url = new URL(`${SSI_TRADE_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`FCTrading ${path}: ${res.status} ${json.message || ""}`);
  return assertTradeOk(path, json);
}

// POST /api/account/otp — ask SSI to send an OTP (email/SMS accounts only)
app.post("/api/account/otp", accountGuards, async (req, res) => {
  try {
    const json = await tradePost("/api/v2/Trading/GetOTP", {
      consumerID: process.env.SSI_TRADING_CONSUMER_ID,
      consumerSecret: process.env.SSI_TRADING_CONSUMER_SECRET,
    });
    res.json({ ok: true, message: json.message || "OTP đã gửi" });
  } catch (err) {
    console.error("[/api/account/otp]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// POST /api/account/login { code } — establish a session with a PIN/OTP
app.post("/api/account/login", accountGuards, async (req, res) => {
  try {
    await loginTrading(String(req.body?.code || ""));
    res.json({ ok: true, expiresAt: new Date(tradeTokenExpiry).toISOString() });
  } catch (err) {
    console.error("[/api/account/login]", err.message);
    res.status(502).json({ error: "login_failed", detail: err.message });
  }
});

// GET /api/account/portfolio — real positions + cash balance
app.get("/api/account/portfolio", accountGuards, async (req, res) => {
  const account = normalizeAccount(req.query.account || process.env.SSI_ACCOUNT);
  if (!account) return res.status(400).json({ error: "missing_account" });

  try {
    const [posRaw, cashRaw] = await Promise.all([
      tradeGet("/api/v2/Trading/stockPosition", { account }),
      tradeGet("/api/v2/Trading/cashAcctBal", { account }),
    ]);

    const rows = posRaw.data?.stockPositions || posRaw.dataList || [];
    const held = rows
      .map((p) => ({
        symbol: String(pickField(p, ["instrumentID", "symbol"], "")).toUpperCase(),
        qty: num(pickField(p, ["onHand"])),
        sellableQty: num(pickField(p, ["sellableQty"])),
        avgCost: toThousandVnd(pickField(p, ["avgPrice"])),
        marketPrice: toThousandVnd(pickField(p, ["marketPrice"])),
      }))
      .filter((p) => p.symbol && p.qty > 0);

    // FCTrading reports marketPrice = 0 outside trading hours, which would show
    // every holding at -100%. Fall back to the last close from FCData.
    await Promise.all(
      held
        .filter((p) => p.marketPrice <= 0)
        .map(async (p) => {
          const q = await fetchQuote(p.symbol).catch(() => null);
          if (q?.price) p.marketPrice = q.price;
        })
    );

    const positions = held
      .map((p) => ({
        ...p,
        marketValue: (p.qty * p.marketPrice) / 1000, // -> triệu đồng
        unrealizedPL: (p.qty * (p.marketPrice - p.avgCost)) / 1000,
        unrealizedPLPct: p.avgCost > 0 ? ((p.marketPrice - p.avgCost) / p.avgCost) * 100 : 0,
      }))
      .sort((a, b) => b.marketValue - a.marketValue);

    const c = cashRaw.data || {};
    const toMillion = (v) => num(v) / 1e6;
    const cash = {
      cashBal: toMillion(pickField(c, ["cashBal"])),
      withdrawable: toMillion(pickField(c, ["withdrawable"])),
      purchasingPower: toMillion(pickField(c, ["purchasingPower"])),
      debt: toMillion(pickField(c, ["debt"])),
      totalAssets: toMillion(pickField(c, ["totalAssets"])),
    };

    res.json({ account, positions, cash, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/account/portfolio]", err.message);
    // 428 tells the UI to ask the user for a fresh OTP/PIN.
    const needsLogin = /PIN\/OTP|accessToken|token/i.test(err.message);
    res.status(needsLogin ? 428 : 502).json({
      error: needsLogin ? "login_required" : "upstream_failed",
      detail: err.message,
    });
  }
});

// ============================================================
// Debug endpoints — used to discover the real SSI response shape.
// Not called by the frontend.
// ============================================================
app.get("/api/debug/token", async (req, res) => {
  try {
    const t = await getSsiToken();
    res.json({ ok: true, tokenPreview: `${t.slice(0, 12)}...`, expiresAt: new Date(ssiTokenExpiry).toISOString() });
  } catch (err) {
    res.status(502).json({ ok: false, detail: err.message });
  }
});

app.get("/api/debug/index-list", async (req, res) => {
  try {
    const raw = await ssiGet("/api/v2/Market/IndexList", {
      Exchange: req.query.exchange || "hose",
      PageIndex: 1,
      PageSize: 100,
    });
    res.json({ rowCount: extractRows(raw).length, raw });
  } catch (err) {
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// GET /api/debug/raw?path=/api/v2/Market/DailyOhlc&Symbol=FPT&FromDate=01/07/2026&ToDate=22/07/2026
app.get("/api/debug/raw", async (req, res) => {
  const { path, ...params } = req.query;
  if (!path || !String(path).startsWith("/api/")) {
    return res.status(400).json({ error: "path must start with /api/" });
  }
  try {
    const raw = await ssiGet(String(path), params);
    res.json({ rowCount: extractRows(raw).length, sampleRow: extractRows(raw)[0] || null, raw });
  } catch (err) {
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
app.get("/health", (req, res) => res.json({ ok: true }));

// ------------------------------------------------------------
// Warm-cache loop. Sequentially (concurrency 1) refresh the hot data —
// indices + the default watchlist quotes — a little before the 45s TTL
// expires, so real user requests hit fresh cache instead of waiting on SSI.
// Mirrors DEFAULT_WATCHLIST in config.js. WARM_SYMBOLS can override via env.
// ------------------------------------------------------------
// Full VN30 basket: the frontend ticker tape runs all 30, so warming them keeps
// the tape served from cache instead of hammering SSI on every page load.
const WARM_SYMBOLS = (process.env.WARM_SYMBOLS ||
  "ACB,BCM,BID,BVH,CTG,FPT,GAS,GVR,HDB,HPG,LPB,MBB,MSN,MWG,PLX,SAB,SHB,SSB,SSI,STB,TCB,TPB,VCB,VHM,VIB,VIC,VJC,VNM,VPB,VRE")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

async function warmCache() {
  // revalidate() refreshes in place WITHOUT evicting, so any user request during
  // the refresh is still served the previous value instantly (never blocks on
  // SSI). Sequential + the SSI limiter keep these calls single-file.
  await revalidate("indices", 45_000, computeIndices).catch((e) =>
    console.warn("[warm] indices:", e.message)
  );
  for (const sym of WARM_SYMBOLS) {
    await revalidate(`quote:${sym}`, 45_000, () => computeQuote(sym)).catch((e) =>
      console.warn(`[warm] quote ${sym}:`, e.message)
    );
  }
}

// 5 min, not 40s: SSI also rate-throttles by request *frequency*, so a tight
// warm loop backfires (every call balloons to 10-30s). A gentle sweep keeps
// entries within staleMs (10 min) so users are always served instantly via
// stale-while-revalidate, without hammering SSI.
const WARM_INTERVAL_MS = Number(process.env.WARM_INTERVAL_MS) || 300_000;
if (process.env.DISABLE_WARM !== "1") {
  warmCache(); // prime on boot
  setInterval(warmCache, WARM_INTERVAL_MS);
}

app.listen(PORT, () => {
  console.log(`Bảng Điện backend proxy chạy tại http://localhost:${PORT}`);
});
