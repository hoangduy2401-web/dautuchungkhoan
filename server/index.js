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
const rssParser = new Parser();

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

// ============================================================
// SSI FastConnect Data (FCData) — auth + OHLCV + indices
// Docs: guide.ssi.com.vn/ssi-products/tieng-viet/fastconnect-data
// ============================================================
const SSI_BASE = process.env.SSI_BASE_URL || "https://fc-data.ssi.com.vn";

let ssiToken = null;
let ssiTokenExpiry = 0;

async function getSsiToken() {
  if (ssiToken && Date.now() < ssiTokenExpiry) return ssiToken;

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
  // NOTE: confirm exact response shape against your SSI FCData docs/Postman
  // collection — SSI has changed field casing between API versions before.
  ssiToken = json.data?.accessToken || json.accessToken;
  if (!ssiToken) throw new Error("SSI auth response missing accessToken");

  // Token typically valid ~8h; refresh a bit early to be safe.
  ssiTokenExpiry = Date.now() + 7 * 60 * 60 * 1000;
  return ssiToken;
}

async function ssiGet(path, params) {
  const token = await getSsiToken();
  const url = new URL(`${SSI_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SSI request failed: ${res.status} ${await res.text()}`);
  return res.json();
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
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10).split("-").reverse().join("/"); // SSI expects dd/mm/yyyy

    // NOTE: confirm exact endpoint name/params against SSI FCData docs —
    // this targets the daily OHLC endpoint (DailyOhlc / DailyStockPrice).
    const raw = await ssiGet("/api/v2/Market/DailyOhlc", {
      Symbol: symbol,
      FromDate: fmt(from),
      ToDate: fmt(to),
      PageSize: 500,
    });

    const items = (raw.data || raw.Data || []).map((d) => ({
      date: normalizeDate(d.TradingDate || d.Date),
      open: toThousandVnd(d.OpenPrice ?? d.Open),
      high: toThousandVnd(d.HighestPrice ?? d.High),
      low: toThousandVnd(d.LowestPrice ?? d.Low),
      close: toThousandVnd(d.ClosePrice ?? d.Close),
      volume: Number(d.TotalMatchVol ?? d.Volume ?? 0),
    }));

    // SSI usually returns newest-first; dataService/chartModule expects ascending.
    items.sort((a, b) => a.date.localeCompare(b.date));

    cacheSet(cacheKey, items, 60_000); // 1 min cache
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
    // NOTE: confirm exact endpoint — SSI exposes index snapshot under
    // Market/IndexList or Market/DailyIndex depending on FCData version.
    const raw = await ssiGet("/api/v2/Market/IndexList", {});
    const items = (raw.data || raw.Data || []).map((ix) => ({
      code: ix.IndexCode || ix.Code,
      value: Number(ix.IndexValue ?? ix.Value ?? 0),
      changePct: Number(ix.PercentPriceChange ?? ix.ChangePct ?? 0),
    }));

    cacheSet(cacheKey, items, 15_000); // 15s cache — matches REFRESH_INTERVAL_MS
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
    // NOTE: confirm endpoint — SSI SecuritiesDetails / Market/Securities
    // gives latest matched price + reference price for change% calc.
    const raw = await ssiGet("/api/v2/Market/SecuritiesDetails", { Symbol: symbol });
    const d = (raw.data || raw.Data || [])[0] || {};

    const price = toThousandVnd(d.MatchedPrice ?? d.ClosePrice);
    const refPrice = toThousandVnd(d.RefPrice ?? d.BasicPrice);
    const changePct = refPrice ? ((price - refPrice) / refPrice) * 100 : 0;

    const quote = { price, changePct, volume: Number(d.TotalMatchVol ?? 0) };
    cacheSet(cacheKey, quote, 10_000);
    res.json(quote);
  } catch (err) {
    console.error("[/api/price/quote]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

function normalizeDate(d) {
  if (!d) return "";
  // SSI often returns dd/mm/yyyy — convert to yyyy-mm-dd for Lightweight Charts.
  if (d.includes("/")) {
    const [dd, mm, yyyy] = d.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }
  return d.slice(0, 10);
}

// SSI FCData returns raw VND; dashboard displays in thousands of VND.
function toThousandVnd(v) {
  return v == null ? 0 : Number(v) / 1000;
}

// ============================================================
// Fundamentals — TCBS public API (unofficial, may change)
// ============================================================
app.get("/api/fundamentals/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const cacheKey = `fund:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [overviewRes, ratioRes] = await Promise.all([
      fetch(`https://apipubaws.tcbs.com.vn/tcanalysis/v1/ticker/${symbol}/overview`),
      fetch(`https://apipubaws.tcbs.com.vn/tcanalysis/v1/ticker/${symbol}/financialratio?yearly=1&isAll=true`),
    ]);

    if (!overviewRes.ok) throw new Error(`TCBS overview ${overviewRes.status}`);
    const overview = await overviewRes.json();
    const ratios = ratioRes.ok ? await ratioRes.json() : [];
    const latestRatio = Array.isArray(ratios) ? ratios[0] || {} : {};

    const fundamentals = {
      marketCap: Number(overview.marketCap || 0) / 1e12, // -> nghìn tỷ
      pe: Number(overview.pe ?? latestRatio.priceToEarning ?? 0),
      pb: Number(overview.pb ?? latestRatio.priceToBook ?? 0),
      eps: Number(overview.eps ?? 0) / 1000,
      roe: Number(latestRatio.roe ?? 0) * 100,
      roa: Number(latestRatio.roa ?? 0) * 100,
      dividendYield: Number(overview.dividend ?? 0) * 100,
      revenueYoY: Number(latestRatio.revenueGrowth ?? 0) * 100,
      netProfitYoY: Number(latestRatio.epsGrowth ?? 0) * 100,
      debtToEquity: Number(latestRatio.debtOnEquity ?? 0),
    };

    cacheSet(cacheKey, fundamentals, 6 * 3600_000); // 6h — fundamentals change slowly
    res.json(fundamentals);
  } catch (err) {
    console.error("[/api/fundamentals]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// News — CafeF RSS, filtered by ticker symbol mention in title/content
// ============================================================
const CAFEF_FEEDS = [
  "https://cafef.vn/thi-truong-chung-khoan.rss",
  "https://cafef.vn/doanh-nghiep.rss",
];

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

    const news = allItems
      .map((item) => {
        const haystack = `${item.title || ""} ${item.contentSnippet || ""}`.toUpperCase();
        // Match whole-word ticker mention, e.g. "VNM" but not inside "VNMIDAS".
        const matched = symbols.find((sym) => new RegExp(`\\b${sym}\\b`).test(haystack));
        if (!matched) return null;
        return {
          symbol: matched,
          title: item.title,
          source: "CafeF",
          time: item.isoDate || new Date().toISOString(),
          url: item.link,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 30);

    cacheSet(cacheKey, news, 5 * 60_000); // 5 min cache
    res.json(news);
  } catch (err) {
    console.error("[/api/news]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Bảng Điện backend proxy chạy tại http://localhost:${PORT}`);
});
