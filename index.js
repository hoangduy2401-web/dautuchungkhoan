// ============================================================
// Backend proxy - Bảng Điện Dashboard
// Purpose: hide SSI ConsumerID/Secret, bypass CORS, cache responses,
// and expose the flat JSON contract that dataService.js expects.
// ============================================================

const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
require("dotenv").config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;
const rssParser = new Parser({
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

  const res = await fetch(`${SSI_BASE}/api/v2/Market/AccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      consumerID: process.env.SSI_CONSUMER_ID,
      consumerSecret: process.env.SSI_CONSUMER_SECRET,
    }),
  });

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
  const token = await getSsiToken();
  const url = new URL(`${SSI_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`SSI ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
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

// GET /api/price/history?symbol=VNM&days=90
app.get("/api/price/history", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const days = Number(req.query.days) || 90;
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  const cacheKey = `history:${symbol}:${days}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const rows = await fetchOhlcChunked(symbol, days);

    // Dedupe by date (chunk boundaries / paging can overlap) and sort ascending.
    const byDate = new Map();
    for (const r of rows) {
      const item = mapOhlcRow(r);
      if (item.date) byDate.set(item.date, item);
    }
    const items = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    cacheSet(cacheKey, items, 60_000); // 1 min
    res.json(items);
  } catch (err) {
    console.error("[/api/price/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// GET /api/price/indices
app.get("/api/price/indices", async (req, res) => {
  const cacheKey = "indices";
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
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

    cacheSet(cacheKey, items, 15_000); // matches REFRESH_INTERVAL_MS
    res.json(items);
  } catch (err) {
    console.error("[/api/price/indices]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// GET /api/price/quote?symbol=VNM  (used by dataService.getQuote)
app.get("/api/price/quote", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  const cacheKey = `quote:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
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
    const changePct = refPrice ? ((price - refPrice) / refPrice) * 100 : 0;

    const quote = {
      price,
      changePct,
      volume: num(pickField(d, ["TotalMatchVol", "TotalVol", "Volume"])),
    };
    cacheSet(cacheKey, quote, 10_000);
    res.json(quote);
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
  const res = await fetch(url, { headers: { Accept: "application/json" } });
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

app.get("/api/fundamentals/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const cacheKey = `fund:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
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

    const fundamentals = {
      marketCap: has("MARKETCAP") ? v.MARKETCAP / 1e12 : null, // -> nghìn tỷ
      pe: has("PRICE_TO_EARNINGS") ? v.PRICE_TO_EARNINGS : null,
      pb: has("PRICE_TO_BOOK") ? v.PRICE_TO_BOOK : null,
      eps: has("EPS_TR") ? v.EPS_TR / 1000 : null, // -> nghìn đ
      roe: has("ROAE_TR_AVG5Q") ? v.ROAE_TR_AVG5Q * 100 : null,
      roa: has("ROAA_TR_AVG5Q") ? v.ROAA_TR_AVG5Q * 100 : null,
      dividendYield: has("DIVIDEND_YIELD") ? v.DIVIDEND_YIELD * 100 : null,
      ...derived, // revenueYoY, netProfitYoY, debtToEquity
    };

    cacheSet(cacheKey, fundamentals, 6 * 3600_000); // 6h — fundamentals change slowly
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

app.get("/api/news", async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const cacheKey = `news:${symbols.join(",")}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const feeds = await Promise.all(
      CAFEF_FEEDS.map((url) => rssParser.parseURL(url).catch(() => ({ items: [] })))
    );
    const allItems = feeds.flatMap((f) => f.items || []);
    const matchers = symbols.map((sym) => ({ sym, re: makeSymbolRegex(sym) }));

    const news = allItems
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

    cacheSet(cacheKey, news, 5 * 60_000);
    res.json(news);
  } catch (err) {
    console.error("[/api/news]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
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

app.listen(PORT, () => {
  console.log(`Bảng Điện backend proxy chạy tại http://localhost:${PORT}`);
});
