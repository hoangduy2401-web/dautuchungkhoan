// ============================================================
// Backend proxy - Bảng Điện Dashboard
// Purpose: hide SSI ConsumerID/Secret, bypass CORS, cache responses,
// and expose the flat JSON contract that dataService.js expects.
// ============================================================

const express = require("express");
const compression = require("compression");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Parser = require("rss-parser");
require("dotenv").config();

const app = express();
// gzip every JSON response: a 5Y history is ~1,250 candles of repetitive JSON
// that compresses ~5-8x. Render's edge does not compress for us.
app.use(compression());
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

// Browser cache hint for SLOW-moving data only (fundamentals, dividend events,
// daily FX/crypto history, savings rates). Live prices/indices/quotes get NO
// header on purpose: a browser-cached quote would sit under the 45s refresh
// and show an old price as current. Set only on success, so an error response
// is never cached by the browser.
function cacheFor(seconds) {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) res.set("Cache-Control", `public, max-age=${seconds}`);
      return json(body);
    };
    next();
  };
}

// Parse ?symbols=A,B,C into a de-duplicated, validated, capped list.
function parseSymbols(raw, max) {
  return [...new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9]{1,10}$/.test(s))
  )].slice(0, max);
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
// DailyOhlc chunking.
//
// Từng để 30 ngày/lần + PageSize 100 theo PDF v2.2 của SSI. ĐO LẠI 15/08/2026:
// giới hạn đó không còn đúng — một lần gọi trả 65 nến cho 90 ngày, 249 nến cho
// 365 ngày, 1.247 nến cho 5 năm (PageSize 2000).
//
// Đối chiếu FPT 365 ngày, bản chia khối và bản một lần gọi: 249 nến cả hai,
// không lệch ngày nào, giá chênh đúng tỷ lệ 1000 (là phép quy đổi nghìn đồng
// sẵn có). Dữ liệu giống hệt.
//
// Vì sao 365 chứ không phải 2000 (đủ ôm 5 năm trong một lần): 365 là mốc đã
// đối chiếu từng nến, còn khoảng rộng hơn mới chỉ đếm số dòng. Nếu SSI siết
// lại giới hạn thì kiểu hỏng ở đây là IM LẶNG — trả về ít nến hơn chứ không
// báo lỗi — nên chọn mốc đã kiểm kỹ. Vòng chia khối giữ nguyên làm lưới an
// toàn, chỉ đổi độ rộng mỗi khối.
//
// Số lần gọi SSI cho một biểu đồ: 3M 3->1, 1Y 13->1, 5Y 61->5.
// Đo trên 10 mã, khung 90 ngày mặc định: 8,89s -> 4,84s (nhanh hơn 1,8 lần).
// ------------------------------------------------------------
// Chỉnh được bằng biến môi trường, y như SSI_CONCURRENCY và WARM_INTERVAL_MS:
// SSI siết lại giới hạn thì hạ hai số này trong Render là xong, không cần sửa
// code rồi deploy lại. Đặt về 30/100 là quay đúng hành vi cũ.
const OHLC_CHUNK_DAYS = Number(process.env.OHLC_CHUNK_DAYS) || 365;
const OHLC_PAGE_SIZE = Number(process.env.OHLC_PAGE_SIZE) || 1000;

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

async function computeHistory(symbol, days, { raw = false } = {}) {
  const rows = await fetchOhlcChunked(symbol, days);
  // Dedupe by date (chunk boundaries / paging can overlap) and sort ascending.
  const byDate = new Map();
  for (const r of rows) {
    const item = mapOhlcRow(r);
    if (item.date) byDate.set(item.date, item);
  }
  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (raw) return series;
  // Back-adjust for dividends/splits so the chart is continuous. Events failing
  // must NOT fail the chart — fall back to the raw series (the pre-17/08/2026
  // behaviour), just without smoothing.
  const events = await fetchCorporateEventsCached(symbol).catch(() => []);
  return backAdjustHistory(series, events);
}

// GET /api/price/history?symbol=VNM&days=90   (add &raw=1 for unadjusted prices)
app.get("/api/price/history", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const days = Number(req.query.days) || 90;
  const raw = req.query.raw === "1"; // escape hatch: unadjusted traded prices
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  try {
    // Daily candles only change once per trading day; only the last (forming)
    // candle moves intraday. Short ranges keep a 60s TTL so today's bar stays
    // fresh, but long ranges (1Y/5Y = ~13/42 SSI calls to rebuild) get a much
    // longer TTL so stale-while-revalidate doesn't re-hammer SSI every minute.
    const ttlMs = days > 270 ? 30 * 60_000 : 60_000;
    const items = await withCache(
      `history:${symbol}:${days}:${raw ? "raw" : "adj"}`,
      ttlMs,
      () => computeHistory(symbol, days, { raw })
    );
    res.json(items);
  } catch (err) {
    console.error("[/api/price/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// GET /api/price/closes?symbols=FPT,VNM&days=40
// -> { closes: { FPT: [c1, c2, ...] }, errors: { XYZ: "msg" } }   (ascending)
// Batch for the watchlist sparklines: one HTTP round trip instead of one per
// symbol. Reuses the exact cache entry of /api/price/history (same key), so a
// symbol already charted costs nothing and vice versa.
app.get("/api/price/closes", async (req, res) => {
  const symbols = parseSymbols(req.query.symbols, 20);
  const days = Math.min(Number(req.query.days) || 40, 270);
  if (!symbols.length) return res.status(400).json({ error: "missing symbols" });

  const closes = {};
  const errors = {};
  await Promise.all(
    symbols.map((sym) =>
      withCache(`history:${sym}:${days}:adj`, 60_000, () => computeHistory(sym, days, { raw: false }))
        .then((items) => {
          closes[sym] = items.map((r) => r.close);
        })
        .catch((err) => {
          errors[sym] = err.message;
        })
    )
  );
  res.json({ closes, errors });
});

// UI code -> SSI IndexId. DailyIndex only accepts one IndexId per call
// (IndexId=ALL -> NoDataFound), so every index lookup goes through this map.
const INDEX_IDS = {
  VNINDEX: "VNINDEX",
  VN30: "VN30",
  HNXINDEX: "HNXIndex",
  UPCOM: "HNXUpcomIndex",
};

async function computeIndices() {
  const WANTED = Object.entries(INDEX_IDS).map(([uiCode, indexId]) => [indexId, uiCode]);

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
      .map((r) => ({
        row: r,
        date: normalizeDate(pickField(r, ["TradingDate", "Date"])),
        value: num(pickField(r, ["IndexValue", "Value", "IndexVal"])),
        // RatioChange = % vs the previous close (verified: 30.85/1668.53 = 1.85%).
        // The sibling `Change` field is scaled oddly, so never use it.
        ratio: num(pickField(r, ["RatioChange", "PercentIndexChange", "PercentPriceChange", "ChangePct"])),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const newest = rows[0];
    if (!newest) continue;
    // KEY: during the session (TradingSession "LO"/"ATO") SSI publishes today's
    // row with IndexValue=0 but a LIVE RatioChange. The real intraday points
    // aren't in DailyIndex until close, so reconstruct them from the previous
    // close × (1 + todayRatio/100). After close the today-row carries the final
    // IndexValue and we use it directly.
    let value = newest.value;
    let changePct = newest.ratio;
    if (newest.value <= 0) {
      const prevClose = rows.find((r) => r.value > 0);
      if (prevClose) value = prevClose.value * (1 + newest.ratio / 100);
    }
    if (!(value > 0)) continue; // still nothing usable — skip rather than show 0

    // Whole-market session stats, straight off the SAME row we already fetched —
    // zero extra SSI calls. Verified live 04/08/2026 on VNINDEX mid-session:
    // TotalVol 76.720.564, TotalVal 2.003.851.832.920, Advances 128, Declines 93
    // while IndexValue was still 0 — so these ARE live intraday, unlike the index
    // value itself. Always read them off `newest`, never off the prev-close row:
    // yesterday's breadth shown as today's is exactly the kind of made-up number
    // the golden rule (section 3) forbids.
    // Units are raw: VND for *Val, shares for *Vol, plain counts for breadth.
    // null (not 0) when SSI omits the field, so the UI can render "—".
    const stat = (names) => {
      const v = pickField(newest.row, names);
      return v == null || v === "" ? null : num(v);
    };

    // Breadth is published per EXCHANGE, not per basket: VN30 comes back
    // 0/0/0 (verified live 04/08/2026 while VNINDEX read 124/95/64 in the same
    // batch). "0 mã tăng" across 30 constituents is a fabricated number, so
    // collapse an all-zero triplet to null and let the UI render "—".
    // Pre-open on a real exchange also yields 0/0/0 — null is right there too.
    let advances = stat(["Advances"]);
    let declines = stat(["Declines"]);
    let noChanges = stat(["NoChanges"]);
    if (!advances && !declines && !noChanges) {
      advances = declines = noChanges = null;
    }

    items.push({
      code: uiCode,
      // Ngày của phiên đang được báo cáo. Cuối tuần và ngày nghỉ, SSI vẫn trả
      // dòng của phiên GẦN NHẤT ĐÃ ĐÓNG chứ không trả rỗng — không có trường
      // này thì client tưởng đó là phiên hôm nay và đem so với chính nó (đo
      // 08/08/2026, thứ Bảy: bảng hiện +0,0% với hai con số y hệt).
      tradingDate: newest.date || null,
      // Index values are already in points, do NOT divide by 1000.
      value: Math.round(value * 100) / 100,
      changePct,
      // TotalVol/TotalVal = matched + put-through. TotalMatchVol/Val alone would
      // under-report turnover vs what the exchange publishes as "GTGD toàn sàn".
      totalVol: stat(["TotalVol", "TotalMatchVol"]),
      totalVal: stat(["TotalVal", "TotalMatchVal"]),
      advances,
      declines,
      noChanges,
      // Trần/sàn: cùng row, không tốn thêm call. Đi THEO BỘ với advances/
      // declines — VN30 trả breadth 0/0/0 (đã gom thành null) nhưng vẫn có
      // Ceilings 2 / Floors 0, tức hai trường này không cùng phạm vi rổ. Không
      // rõ chúng đếm trên rổ hay trên sàn, nên khi breadth là null thì để null
      // luôn thay vì hiện một con số không biết đếm cái gì (mục 3).
      ceilings: advances === null ? null : stat(["Ceilings"]),
      floors: advances === null ? null : stat(["Floors"]),
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

// DailyIndex rejects any window wider than 30 days — it answers HTTP 200 with an
// EMPTY data array plus `message: "... max range 30 days"`, so an over-wide call
// looks like "this index has no history" rather than an error. Chunk or get
// nothing. Measured 04/08/2026; full note in CLAUDE.md section 7.
const INDEX_CHUNK_DAYS = 30;

async function fetchIndexChunk(indexId, from, to) {
  // Sequential on purpose: SSI rate-limits concurrent calls hard.
  const raw = await ssiGet("/api/v2/Market/DailyIndex", {
    IndexId: indexId,
    FromDate: fmtSsiDate(from),
    ToDate: fmtSsiDate(to),
    PageIndex: 1,
    PageSize: 100, // a 30-day window is ~22 trading days, one page always covers it
    ascending: true,
  });
  return extractRows(raw);
}

// History for ONE index. Shape deliberately differs from /api/price/history:
// DailyIndex carries no OHLC, only a single IndexValue per day, so there is
// nothing to build candles from — the client draws a line. Don't "fix" this by
// faking open/high/low from close.
async function computeIndexHistory(code, days) {
  const indexId = INDEX_IDS[code];
  if (!indexId) throw new Error(`unknown index: ${code}`);

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);

  const rows = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + (INDEX_CHUNK_DAYS - 1) * 24 * 3600 * 1000, end.getTime())
    );
    rows.push(...(await fetchIndexChunk(indexId, cursor, chunkEnd)));
    cursor = new Date(chunkEnd.getTime() + 24 * 3600 * 1000);
  }

  const byDate = new Map();
  for (const r of rows) {
    const date = normalizeDate(pickField(r, ["TradingDate", "Date"]));
    const value = num(pickField(r, ["IndexValue", "Value", "IndexVal"]));
    // Drop the still-forming row: during the session SSI publishes today with
    // IndexValue=0 and only a live RatioChange. Plotting 0 would draw a cliff to
    // the floor. The live value for today comes from /api/price/indices instead.
    if (!date || !(value > 0)) continue;
    byDate.set(date, {
      date,
      // Index values are already in points, do NOT divide by 1000.
      close: Math.round(value * 100) / 100,
      volume: num(pickField(r, ["TotalVol", "TotalMatchVol"])) || 0,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// GET /api/price/index-history?code=VNINDEX&days=90
app.get("/api/price/index-history", async (req, res) => {
  const code = String(req.query.code || "").toUpperCase();
  const days = Number(req.query.days) || 90;
  if (!INDEX_IDS[code]) {
    return res.status(400).json({ error: "unknown_index", detail: code });
  }

  try {
    // 30-day chunks mean a long range costs a LOT of sequential calls
    // (1Y ~ 13, 5Y ~ 61), so long ranges get a much longer TTL than the 60s used
    // for short ones — otherwise stale-while-revalidate re-hammers SSI.
    const ttlMs = days > 270 ? 6 * 60 * 60_000 : days > 100 ? 30 * 60_000 : 60_000;
    const items = await withCache(`index-history:${code}:${days}`, ttlMs, () =>
      computeIndexHistory(code, days)
    );
    res.json(items);
  } catch (err) {
    console.error("[/api/price/index-history]", err.message);
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

  // Change% must be measured against the ADJUSTED reference price, not SSI's
  // RefPrice field. On an ex-dividend day SSI leaves RefPrice at the raw prior
  // close (measured 17/08/2026: SSI RefPrice 24,500 while the board's ceiling/
  // floor implied 19,600), so (price - RefPrice)/RefPrice prints a fake -19%
  // cliff for what was really a flat session after a dividend.
  //
  // The exchange's true adjusted reference is exactly the midpoint of the daily
  // band: ceiling = ref*(1+band), floor = ref*(1-band) -> (ceiling+floor)/2 = ref
  // for ANY band width (HOSE 7% / HNX 10% / UPCoM 15%). On a normal day this
  // equals RefPrice, so nothing changes; on an ex-right day it is correct.
  const ceiling = toThousandVnd(pickField(d, ["CeilingPrice", "Ceiling"]));
  const floor = toThousandVnd(pickField(d, ["FloorPrice", "Floor"]));
  const refField = toThousandVnd(pickField(d, ["RefPrice", "BasicPrice", "PriorClosePrice"]));
  const refPrice = ceiling > 0 && floor > 0 ? (ceiling + floor) / 2 : refField;

  // Foreign flow is already in the same DailyStockPrice row — no extra SSI call.
  // Net foreign value (buy - sell) in raw VND, exposed to the client in tỷ đồng
  // (billions): positive = net foreign buying, negative = net foreign selling.
  const fBuyVal = num(pickField(d, ["ForeignBuyValTotal", "ForeignBuyValueTotal"]));
  const fSellVal = num(pickField(d, ["ForeignSellValTotal", "ForeignSellValueTotal"]));

  return {
    price,
    changePct: refPrice ? ((price - refPrice) / refPrice) * 100 : 0,
    volume: num(pickField(d, ["TotalMatchVol", "TotalVol", "Volume"])),
    netForeignVal: (fBuyVal - fSellVal) / 1e9,
  };
}

// Cached + de-duplicated. 45s TTL: outside trading hours the quote barely moves.
const QUOTE_TTL_MS = 45_000;
function fetchQuote(symbol) {
  return withCache(`quote:${symbol}`, QUOTE_TTL_MS, () => computeQuote(symbol));
}

// When SSI was actually read for this cached quote (every write to the entry
// uses QUOTE_TTL_MS, so expiresAt - TTL is the fetch time). Stale-while-
// revalidate can serve an entry up to 10 min old; this lets the UI say so.
function quoteFetchedAt(symbol) {
  const entry = cache.get(`quote:${symbol}`);
  return entry ? entry.expiresAt - QUOTE_TTL_MS : null;
}

// GET /api/price/quotes?symbols=FPT,VNM,...
// -> { quotes: { FPT: {price, changePct, volume, netForeignVal} }, errors: { XYZ: "msg" },
//      asOf: ISO — when SSI was read for the OLDEST quote in `quotes` }
// Batch form of /api/price/quote: the stock page used to fire 30+ parallel
// requests per refresh (VN30 tape + watchlist). Every item goes through the
// same fetchQuote cache, so warmed VN30 symbols answer instantly and only
// cold ones queue on the SSI limiter. Each quote has the exact /quote shape.
app.get("/api/price/quotes", async (req, res) => {
  const symbols = parseSymbols(req.query.symbols, 60);
  if (!symbols.length) return res.status(400).json({ error: "missing symbols" });

  const quotes = {};
  const errors = {};
  await Promise.all(
    symbols.map((sym) =>
      fetchQuote(sym)
        .then((q) => {
          quotes[sym] = q;
        })
        .catch((err) => {
          errors[sym] = err.message;
        })
    )
  );
  const times = Object.keys(quotes).map(quoteFetchedAt).filter(Number.isFinite);
  const asOf = times.length ? new Date(Math.min(...times)).toISOString() : null;
  res.json({ quotes, errors, asOf });
});

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

async function vndirectJson(url, timeoutMs = 8000) {
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, timeoutMs);
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

// GET /api/marketcaps?symbols=FPT,VNM,...
// -> { source:"VNDirect", asOf:"YYYY-MM-DD", items: { FPT: 121.3, ... } }  (nghìn tỷ ₫)
// Sizes the VN30 heatmap tiles. ONE VNDirect call for the whole basket
// (`where=code:A,B,C` works on /ratios/latest — measured 26/09/2026), not 30.
// A symbol missing from `items` means VNDirect had no value: the UI must not
// invent a size for it. `asOf` = the oldest reportDate among the rows, so the
// label never claims fresher data than the stalest tile.
app.get("/api/marketcaps", cacheFor(3600), async (req, res) => {
  const symbols = parseSymbols(req.query.symbols, 60);
  if (!symbols.length) return res.status(400).json({ error: "missing symbols" });
  try {
    const data = await withCache(`mcap:${[...symbols].sort().join(",")}`, 6 * 3600_000, async () => {
      const rows = await vndirectJson(
        `${VNDIRECT_RATIOS}?filter=ratioCode:MARKETCAP&where=code:${symbols.join(",")}` +
          `&order=reportDate&fields=code,value,reportDate&size=${symbols.length * 2}`
      );
      const items = {};
      let asOf = null;
      for (const r of rows) {
        const v = Number(r.value);
        if (!Number.isFinite(v) || v <= 0) continue;
        items[r.code] = v / 1e12; // -> nghìn tỷ, same unit as /api/fundamentals
        if (r.reportDate && (!asOf || r.reportDate < asOf)) asOf = r.reportDate;
      }
      if (!Object.keys(items).length) throw new Error("VNDirect trả rỗng");
      return { source: "VNDirect", asOf, items };
    });
    res.json(data);
  } catch (err) {
    console.error("[/api/marketcaps]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

app.get("/api/fundamentals/:symbol", cacheFor(3600), async (req, res) => {
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
// Valuation history — daily P/E and P/B from VNDirect /v4/ratios (the same
// ratio codes /ratios/latest serves, but every trading day). One call carries
// both codes: measured 03/10/2026, FPT/HPG/VCB 2 years = 497 + 497 rows,
// 0.4-0.9s. History reaches back to 2017-12 for FPT.
//
// Loss-making periods are ABSENT, not negative: HNG had 0 P/E rows, HVN 300 of
// 497 P/B rows (negative equity). Dates are merged, so a missing ratio is null
// on that date — never 0, and never filled from a neighbour.
//
// SSI MCP serves the same series (11.66 vs VNDirect 11.71 for FPT on
// 02/10/2026) but its refresh token cannot be kept alive server-side
// (CLAUDE.md §7), so VNDirect it is.
// ============================================================
const VNDIRECT_RATIO_HISTORY = "https://api-finfo.vndirect.com.vn/v4/ratios";
const VALUATION_MAX_DAYS = 730;

async function computeValuationHistory(symbol, days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await vndirectJson(
    `${VNDIRECT_RATIO_HISTORY}?q=code:${symbol}~ratioCode:PRICE_TO_EARNINGS,PRICE_TO_BOOK` +
      `~reportDate:gte:${since}&size=2000`
  );
  const byDate = new Map();
  for (const r of rows) {
    const v = Number(r.value);
    if (!r.reportDate || !Number.isFinite(v) || v <= 0) continue;
    const row = byDate.get(r.reportDate) || { date: r.reportDate, pe: null, pb: null };
    if (r.ratioCode === "PRICE_TO_EARNINGS") row.pe = v;
    else if (r.ratioCode === "PRICE_TO_BOOK") row.pb = v;
    byDate.set(r.reportDate, row);
  }
  const items = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  // No rows at all (e.g. ROS) is an answer, not an outage: 200 with an empty
  // list, and the page says VNDirect has no figure for this symbol.
  return { source: "VNDirect", symbol, asOf: items.length ? items[items.length - 1].date : null, items };
}

// GET /api/valuation/history?symbol=FPT&days=730
app.get("/api/valuation/history", cacheFor(3600), async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const days = Number(req.query.days) || VALUATION_MAX_DAYS;
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return res.status(400).json({ error: "bad_symbol" });
  if (days > VALUATION_MAX_DAYS) {
    return res.status(400).json({ error: "range_too_long", maxDays: VALUATION_MAX_DAYS });
  }
  try {
    // Ratios move once a day: 6h fresh, a stale copy for a day if VNDirect is down.
    res.json(await withCache(`valuation:${symbol}:${days}`, 6 * 3600_000,
      () => computeValuationHistory(symbol, days), { staleMs: 24 * 3600_000 }));
  } catch (err) {
    console.error("[/api/valuation/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// Quarterly results — VNDirect /v4/financial_statements, one call per symbol
// (measured 03/10/2026: FPT/VCB/SSI/BVH 0.3-0.5s, no duplicate rows across
// model types). Item codes from /v4/financial_models, the same across the
// four company forms except revenue:
//   21001 Doanh thu thuần (non-finance, securities, insurance)
//   421701 Tổng thu nhập hoạt động (banks — they have no 21001 and no 23100)
//   23100 Lợi nhuận gộp · 23000 LNST công ty mẹ
//   32000 Lưu chuyển tiền thuần từ HĐKD — STANDALONE per quarter, not
//         year-to-date (FPT 2025: -2,507 / 4,190 / 4,344 / 4,108 tỷ)
// Cross-check: FPT Q1/2026 revenue 12,480 tỷ and Q2/2026 13,789 tỷ match SSI MCP.
// ============================================================
const ITEM_GROSS_PROFIT = 23100;
const ITEM_CFO = 32000;
const FIN_MAX_QUARTERS = 20;

async function computeQuarterly(symbol, quarters) {
  // ~92 days per quarter plus one spare quarter, so the oldest one is not cut.
  const since = new Date(Date.now() - (quarters + 1) * 92 * 86400_000).toISOString().slice(0, 10);
  const codes = [ITEM_REVENUE, ITEM_REVENUE_BANK, ITEM_GROSS_PROFIT, ITEM_NPATMI, ITEM_CFO].join(",");
  const rows = await vndirectJson(
    `${VNDIRECT_STATEMENTS}?q=code:${symbol}~reportType:QUARTER~itemCode:${codes}` +
      `~fiscalDate:gte:${since}&size=2000`
  );
  // Own grouping rather than groupByFiscalDate(): that one runs Number(null),
  // which would turn a missing figure into 0.
  const byDate = new Map();
  for (const r of rows) {
    if (r.numericValue === null || r.numericValue === undefined || r.numericValue === "") continue;
    const v = Number(r.numericValue);
    if (!Number.isFinite(v)) continue;
    if (!byDate.has(r.fiscalDate)) byDate.set(r.fiscalDate, {});
    byDate.get(r.fiscalDate)[Math.round(Number(r.itemCode))] = v;
  }
  const isBank = rows.some((r) => Math.round(Number(r.itemCode)) === ITEM_REVENUE_BANK);
  // Numbers come in VND; the page works in tỷ đồng. null stays null.
  const ty = (v) => (Number.isFinite(v) ? v / 1e9 : null);
  const items = [...byDate.keys()]
    .sort()
    .slice(-quarters)
    .map((fiscalDate) => {
      const v = byDate.get(fiscalDate);
      const [y, m] = fiscalDate.split("-").map(Number);
      return {
        period: `Q${Math.ceil(m / 3)}/${y}`,
        fiscalDate,
        revenue: ty(isBank ? v[ITEM_REVENUE_BANK] : v[ITEM_REVENUE]),
        grossProfit: isBank ? null : ty(v[ITEM_GROSS_PROFIT]),
        netProfit: ty(v[ITEM_NPATMI]),
        operatingCashFlow: ty(v[ITEM_CFO]),
      };
    });
  return {
    source: "VNDirect",
    symbol,
    unit: "tỷ đồng",
    revenueLabel: isBank ? "Tổng thu nhập hoạt động" : "Doanh thu thuần",
    items,
  };
}

// GET /api/financials/quarterly?symbol=FPT&quarters=12
app.get("/api/financials/quarterly", cacheFor(3600), async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const quarters = Math.round(Number(req.query.quarters) || 12);
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return res.status(400).json({ error: "bad_symbol" });
  if (quarters < 1 || quarters > FIN_MAX_QUARTERS) {
    return res.status(400).json({ error: "bad_quarters", maxQuarters: FIN_MAX_QUARTERS });
  }
  try {
    // Statements change once a quarter: 12h fresh, 2 days stale if VNDirect is down.
    res.json(await withCache(`fin:q:${symbol}:${quarters}`, 12 * 3600_000,
      () => computeQuarterly(symbol, quarters), { staleMs: 48 * 3600_000 }));
  } catch (err) {
    console.error("[/api/financials/quarterly]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// Peers — same ICB level-3 industry from VNDirect /v4/industry_classification
// (level 3 measured 03/10/2026: FPT -> "Phần mềm & Dịch vụ máy tính" 13 codes,
// VCB -> Banks 44, HPG -> Industrial Metals 41; level 4 left FPT with 5, level
// 2 lumped steel into 123 "Basic Resources"). Every code sits in exactly one
// level-3 group (2,088 codes, 0 overlaps).
//
// Groups run up to 424 codes and /ratios/latest took 6.9s for 165, so codes
// go in chunks of 150, in parallel, with a 20s timeout of their own — and the
// page loads this block on its own, never inside the chart's Promise.all.
// ============================================================
const VNDIRECT_ICB = "https://api-finfo.vndirect.com.vn/v4/industry_classification";
const PEER_CODES = ["MARKETCAP", "PRICE_TO_EARNINGS", "PRICE_TO_BOOK", "ROAE_TR_AVG5Q", "DIVIDEND_YIELD"];
const PEER_MAX_LIMIT = 15;
const PEER_CHUNK = 150;
// A code whose market cap is this much older than the group's newest row is
// most likely delisted (rows dated 21/07 next to 02/10 measured in group 8770).
const PEER_STALE_DAYS = 14;

function icbLevel3() {
  return withCache("vnd:icb3", 24 * 3600_000, async () => {
    const rows = await vndirectJson(`${VNDIRECT_ICB}?q=industryLevel:3&size=500`, 15000);
    if (!rows.length) throw new Error("VNDirect: không có bảng phân ngành");
    return rows.map((r) => ({
      code: r.industryCode,
      name: String(r.vietnameseName || r.englishName || "").trim(),
      codes: String(r.codeList || "").split(",").filter(Boolean),
    }));
  });
}

// Latest ratios for every code in one industry, shared by all its members.
function industryRatios(industry) {
  return withCache(`peers:grp:${industry.code}`, 6 * 3600_000, async () => {
    const chunks = [];
    for (let i = 0; i < industry.codes.length; i += PEER_CHUNK) chunks.push(industry.codes.slice(i, i + PEER_CHUNK));
    const parts = await Promise.all(chunks.map((codes) =>
      vndirectJson(
        `${VNDIRECT_RATIOS}?filter=ratioCode:${PEER_CODES.join(",")}&where=code:${codes.join(",")}` +
          `&order=reportDate&fields=code,ratioCode,value,reportDate&size=${codes.length * PEER_CODES.length + 50}`,
        20000
      )));
    const byCode = {};
    for (const r of parts.flat()) {
      const v = Number(r.value);
      if (r.value === null || !Number.isFinite(v)) continue;
      (byCode[r.code] ||= {})[r.ratioCode] = { v, date: r.reportDate };
    }
    return byCode;
  }, { staleMs: 24 * 3600_000 });
}

function medianOf(vals) {
  const xs = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

async function computePeers(symbol, limit) {
  const industries = await icbLevel3();
  const industry = industries.find((g) => g.codes.includes(symbol));
  if (!industry) return { source: "VNDirect", symbol, asOf: null, industry: null, items: [], median: null };

  const byCode = await industryRatios(industry);
  const newest = Object.values(byCode).map((r) => r.MARKETCAP?.date).filter(Boolean).sort().pop() || null;
  const cutoff = newest
    ? new Date(Date.parse(newest) - PEER_STALE_DAYS * 86400_000).toISOString().slice(0, 10)
    : null;
  const row = (code) => {
    const r = byCode[code] || {};
    const val = (k) => (r[k] ? r[k].v : null);
    const pos = (x) => (x !== null && x > 0 ? x : null); // P/E, P/B <= 0 are meaningless multiples
    return {
      symbol: code,
      self: code === symbol,
      marketCap: pos(val("MARKETCAP")) !== null ? val("MARKETCAP") / 1e12 : null, // -> nghìn tỷ
      pe: pos(val("PRICE_TO_EARNINGS")),
      pb: pos(val("PRICE_TO_BOOK")),
      roe: val("ROAE_TR_AVG5Q") !== null ? val("ROAE_TR_AVG5Q") * 100 : null,
      dividendYield: val("DIVIDEND_YIELD") !== null ? val("DIVIDEND_YIELD") * 100 : null,
    };
  };
  const ranked = industry.codes
    .filter((c) => byCode[c]?.MARKETCAP && byCode[c].MARKETCAP.v > 0 && (!cutoff || byCode[c].MARKETCAP.date >= cutoff))
    .sort((a, b) => byCode[b].MARKETCAP.v - byCode[a].MARKETCAP.v);
  const top = ranked.slice(0, limit);
  // The symbol being viewed is always shown, even outside the top N or
  // without a market cap of its own.
  if (!top.includes(symbol)) top.push(symbol);
  const items = top.map(row);
  return {
    source: "VNDirect",
    symbol,
    asOf: newest,
    industry: { code: industry.code, name: industry.name, level: 3, total: industry.codes.length },
    items,
    median: {
      pe: medianOf(items.map((i) => i.pe)),
      pb: medianOf(items.map((i) => i.pb)),
      roe: medianOf(items.map((i) => i.roe)),
      dividendYield: medianOf(items.map((i) => i.dividendYield)),
    },
  };
}

// GET /api/peers?symbol=FPT&limit=8
app.get("/api/peers", cacheFor(3600), async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const limit = Math.round(Number(req.query.limit) || 8);
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return res.status(400).json({ error: "bad_symbol" });
  if (limit < 1 || limit > PEER_MAX_LIMIT) {
    return res.status(400).json({ error: "bad_limit", maxLimit: PEER_MAX_LIMIT });
  }
  try {
    res.json(await withCache(`peers:${symbol}:${limit}`, 6 * 3600_000, () => computePeers(symbol, limit),
      { staleMs: 24 * 3600_000 }));
  } catch (err) {
    console.error("[/api/peers]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// Corporate actions (cổ tức / cổ phiếu thưởng / phát hành quyền) — VNDirect
// finfo /v4/events, the same source as fundamentals. Two consumers:
//   1. back-adjusting the price chart (below), and
//   2. the dividend-history tab (GET /api/events/:symbol).
//
// WHY THIS EXISTS: SSI DailyOhlc returns RAW traded prices and its
// ClosePriceAdjusted column does NOT back-adjust (measured 17/08/2026 on the
// SSI stock+cash dividend: factor 1.0 on every historical row). So a dividend
// draws a fake cliff on the chart (SSI 24,500 -> 19,800, -19%, when the session
// was actually flat after the adjustment). We derive the adjustment ourselves.
// ============================================================
const VNDIRECT_EVENTS = "https://api-finfo.vndirect.com.vn/v4/events";

const numOrNull = (v) =>
  v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

// `effectiveDate` is the ex-right date (ngày GDKHQ) — the first session priced
// after the adjustment. `expiredDate` is the last registration date. locale:VN
// drops the EN twin row VNDirect returns for every event.
async function fetchCorporateEvents(symbol) {
  const url =
    `${VNDIRECT_EVENTS}?q=code:${symbol}~locale:VN~type:DIVIDEND,KINDDIV,ISSUE` +
    `&size=200&sort=effectiveDate:desc` +
    `&fields=type,typeDesc,note,ratio,dividend,price,effectiveDate,expiredDate,divYear`;
  const rows = await vndirectJson(url);
  return rows
    .map((r) => ({
      type: r.type, // DIVIDEND (cash) | KINDDIV (bonus shares) | ISSUE (rights)
      typeDesc: r.typeDesc || null,
      note: r.note || null,
      exDate: r.effectiveDate || null, // ngày GDKHQ
      recordDate: r.expiredDate || null, // ngày đăng ký cuối cùng
      ratio: numOrNull(r.ratio), // percent: 20 == tỷ lệ 100:20
      cash: numOrNull(r.dividend), // đồng/cp (cash dividend)
      issuePrice: numOrNull(r.price), // đồng/cp (rights subscription price)
      year: r.divYear ? Math.round(Number(r.divYear)) : null,
    }))
    .filter((e) => e.exDate)
    .sort((a, b) => b.exDate.localeCompare(a.exDate)); // newest first
}

function fetchCorporateEventsCached(symbol) {
  // Corporate actions change a few times a year; 12h TTL keeps VNDirect load
  // negligible and the chart adjustment stable within a session.
  return withCache(`events:${symbol}`, 12 * 3600_000, () => fetchCorporateEvents(symbol));
}

// Back-adjust a raw ascending OHLC series (thousand VND) for corporate actions.
// Every candle BEFORE an ex-date is multiplied by that event's factor; multiple
// events compound. Factor, where `ref` = raw close of the last day before exDate:
//   KINDDIV (bonus r%):   1 / (1 + r/100)
//   DIVIDEND (cash d/cp): (ref - d) / ref
//   ISSUE (rights p, r%): (ref + (r/100)*p) / (ref * (1 + r/100))   [TERP]
//
// SANITY GATE: each factor is checked against the ACTUAL open/prev-close gap on
// the ex-date in the raw series. If they disagree (event cancelled, mis-dated,
// or SSI already adjusted upstream someday), the event is skipped — the chart
// falls back to raw rather than being distorted. This is the fallback the task
// asked for ("phương án dự phòng cho trường hợp tương tự").
function backAdjustHistory(rows, events) {
  if (!Array.isArray(rows) || rows.length < 2 || !events.length) return rows;
  const today = new Date().toISOString().slice(0, 10);

  // Group by ex-date: same-day events (e.g. today's SSI cash 1,000đ + bonus 20%)
  // compound into ONE factor. Grouping matters for the sanity gate below — each
  // event's factor alone won't match the combined price gap, only their product.
  const byDate = new Map();
  for (const e of events) {
    if (!e.exDate || e.exDate > today) continue; // ignore future / not-yet-effective
    if (!byDate.has(e.exDate)) byDate.set(e.exDate, []);
    byDate.get(e.exDate).push(e);
  }

  const factors = [];
  for (const [exDate, evs] of byDate) {
    // ref = raw close of the last candle strictly before the ex-date.
    let refIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date < exDate) { refIdx = i; break; }
    }
    if (refIdx < 0) continue; // event older than our data window
    const ref = rows[refIdx].close;
    if (!(ref > 0)) continue;

    // Only cash dividends and bonus/stock dividends are back-adjusted. Rights
    // issues (ISSUE) are deliberately NOT: their ex-price mechanics are noisy
    // (the shareholder must pay to subscribe, so the market rarely drops by the
    // full TERP). Measured on SSI's 2025-12-08 rights (100:20 @ 15,000): the raw
    // price barely moved (gap 1.021) while TERP implies a 0.918 factor —
    // adjusting there would MANUFACTURE a fake +11% jump, worse than the raw
    // cliff we set out to fix. ISSUE still shows in the events tab as history.
    let f = 1;
    for (const e of evs) {
      const r = (e.ratio || 0) / 100;
      const cashK = (e.cash || 0) / 1000; // đồng -> nghìn đồng
      if (e.type === "KINDDIV") f *= 1 / (1 + r);
      else if (e.type === "DIVIDEND") f *= (ref - cashK) / ref;
    }
    if (!(f > 0 && f < 5) || Math.abs(1 - f) < 1e-4) continue; // no-op / nonsensical

    // Cross-check the COMBINED factor against the real price gap on the ex-date
    // (first candle on/after exDate). open/prevClose should be within ~12%.
    const exIdx = rows.findIndex((row) => row.date >= exDate);
    if (exIdx > 0 && rows[exIdx].open > 0) {
      const gap = rows[exIdx].open / rows[exIdx - 1].close;
      if (Math.abs(gap - f) > 0.12) continue; // real prices don't back this up
    }
    factors.push({ exDate, factor: f });
  }
  if (!factors.length) return rows;

  return rows.map((row) => {
    let m = 1;
    for (const { exDate, factor } of factors) if (row.date < exDate) m *= factor;
    if (Math.abs(1 - m) < 1e-9) return row;
    const adj = (x) => Math.round(x * m * 100) / 100; // 2 dp, thousand VND
    return {
      date: row.date,
      open: adj(row.open),
      high: adj(row.high),
      low: adj(row.low),
      close: adj(row.close),
      volume: row.volume, // left raw on purpose
    };
  });
}

// GET /api/events/SSI -> corporate-action history, newest first:
// [{ type, typeDesc, note, exDate, recordDate, ratio, cash, issuePrice, year }]
app.get("/api/events/:symbol", cacheFor(3600), async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!symbol) return res.status(400).json({ error: "missing symbol" });
  try {
    const events = await fetchCorporateEventsCached(symbol);
    res.json(events);
  } catch (err) {
    console.error("[/api/events]", err.message);
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
// Escape the symbol first: it comes from the user's watchlist, so a stray regex
// metachar (".", "+", "(" ...) would otherwise throw and 502 the whole feed.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function makeSymbolRegex(sym) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(sym)}(?![\\p{L}\\p{N}])`, "u");
}

// Per-symbol news from VNDirect finfo (same host as fundamentals/events, which
// already answer from Render). Measured 26/09/2026: 20 items for each of FPT,
// VNM, HPG, SSI, VCB, SZC — HOSE disclosures, company news, analyst reports —
// where the two CafeF RSS feeds alone matched only MWG out of 6 tickers,
// because RSS headlines rarely spell out the ticker.
const VNDIRECT_NEWS = "https://api-finfo.vndirect.com.vn/v4/news";
const NEWS_SOURCE_LABELS = {
  HOSE: "HOSE",
  HNX: "HNX",
  UPCOM: "UPCoM",
  VNDIRECT: "VNDirect",
  TAPCHICONGTHUONG: "Tạp chí Công Thương",
  VNECONOMY: "VnEconomy",
};
async function fetchVndirectNews(symbol) {
  return withCache(`vnnews:${symbol}`, 15 * 60_000, async () => {
    const rows = await vndirectJson(
      `${VNDIRECT_NEWS}?q=tagCodes:${symbol}&sort=newsDate:desc,newsTime:desc&size=10` +
        `&fields=newsTitle,newsDate,newsTime,newsSource,newsUrl,attachments`
    );
    return rows
      .map((r) => ({
        symbol,
        title: String(r.newsTitle || "").trim(),
        source: NEWS_SOURCE_LABELS[r.newsSource] || r.newsSource || "VNDirect",
        // VNDirect gives a local date + time with no zone: Vietnam time.
        time: r.newsDate ? `${r.newsDate}T${r.newsTime || "00:00:00"}+07:00` : null,
        url: r.newsUrl || (r.attachments && r.attachments[0] && r.attachments[0].url) || null,
      }))
      .filter((n) => n.title && n.time && n.url);
  });
}

async function computeNews(symbols) {
  const [feeds, perSymbol] = await Promise.all([
    Promise.all(CAFEF_FEEDS.map((url) => rssParser.parseURL(url).catch(() => ({ items: [] })))),
    // Best-effort per symbol: one failing ticker must not empty the list.
    Promise.all(symbols.map((sym) => fetchVndirectNews(sym).catch(() => []))),
  ]);
  const allItems = feeds.flatMap((f) => f.items || []);
  const matchers = symbols.map((sym) => ({ sym, re: makeSymbolRegex(sym) }));

  const rss = allItems
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
    .filter(Boolean);

  // Same story from both sources -> keep one (compare titles loosely).
  const seen = new Set();
  const key = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return [...rss, ...perSymbol.flat()]
    .filter((n) => {
      const k = key(n.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 60);
}

app.get("/api/news", async (req, res) => {
  // Capped: each symbol is one VNDirect call (15-min cached). 20 since the
  // watchlist became unlimited (26/09); the page sends its first 20.
  const symbols = parseSymbols(req.query.symbols, 20);

  try {
    const news = await withCache(`news:${symbols.join(",")}`, 5 * 60_000, () => computeNews(symbols));
    res.json(news);
  } catch (err) {
    console.error("[/api/news]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// FX — two DIFFERENT kinds of exchange rate, on purpose.
//   /api/fx/rates   Vietcombank: RETAIL board rates, with a buy/sell spread.
//   /api/fx/history FXRatesAPI:  INTERBANK market rate, a single mid price.
// They are ~0.8% apart and will never agree (measured 05/08/2026: interbank
// USD/VND 26,259 vs VCB buy 26,050 / sell 26,460). That is normal, but the UI
// MUST label the source next to every number — an accurate number under the
// wrong label leads to the same bad decision as a made-up one.
// ============================================================

// Vietcombank's own XML header says "Only one request every 5 minutes!", so the
// TTL here is a rate-limit rule, not a tuning knob. 10 min gives head room.
const VCB_FX_URL =
  process.env.VCB_FX_URL ||
  "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx";
const FX_RATES_TTL_MS = 10 * 60_000;

// Board values look like "26,050.00", and a missing quote is a literal "-"
// (VCB does not buy cash for DKK/INR/MYR/NOK/RUB/SAR/SEK/KWD). Return null so
// the UI can print "—" instead of a fabricated 0 (golden rule, CLAUDE.md §3).
function parseVcbAmount(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === "-") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// <DateTime>8/5/2026 8:49:30 PM</DateTime> — M/D/YYYY, 12-hour, Vietnam local
// time with no offset in the string. Stamp +07:00 explicitly; letting the server
// parse it as its own local time would shift the timestamp by hours on Render.
function parseVcbDateTime(s) {
  const m = String(s || "").match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i
  );
  if (!m) return null;
  const [, mm, dd, yyyy, hh, mi, ss, ap] = m;
  let hour = Number(hh);
  if (ap) {
    const isPm = ap.toUpperCase() === "PM";
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  const p2 = (n) => String(n).padStart(2, "0");
  return `${yyyy}-${p2(mm)}-${p2(dd)}T${p2(hour)}:${mi}:${ss}+07:00`;
}

async function computeFxRates() {
  const res = await fetchWithTimeout(VCB_FX_URL, { headers: { Accept: "application/xml" } }, 8000);
  if (!res.ok) throw new Error(`Vietcombank HTTP ${res.status}`);
  const xml = await res.text();

  // Flat attribute-only XML (~2.5KB, one self-closing <Exrate/> per currency).
  // A regex is enough here; no XML dependency added for this.
  const rates = [];
  for (const m of xml.matchAll(/<Exrate\b([^>]*)\/>/g)) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const code = String(attrs.CurrencyCode || "").trim().toUpperCase();
    if (!code) continue;
    rates.push({
      code,
      name: String(attrs.CurrencyName || "").trim(),
      buyCash: parseVcbAmount(attrs.Buy),
      buyTransfer: parseVcbAmount(attrs.Transfer),
      sell: parseVcbAmount(attrs.Sell),
    });
  }
  if (!rates.length) throw new Error("Vietcombank returned no <Exrate> rows");

  const dt = xml.match(/<DateTime>([^<]*)<\/DateTime>/);
  return {
    updatedAt: parseVcbDateTime(dt && dt[1]),
    source: "Vietcombank",
    kind: "retail", // board rate with a spread — NOT the same as /api/fx/history
    rates: rates.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// GET /api/fx/rates
app.get("/api/fx/rates", async (req, res) => {
  try {
    res.json(await withCache("fx:rates", FX_RATES_TTL_MS, computeFxRates));
  } catch (err) {
    console.error("[/api/fx/rates]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ------------------------------------------------------------
// FX history — FXRatesAPI (free, no key, interbank mid rates).
//
// NOT Yahoo Finance, despite what docs/QUYHOACH.md §2.10 planned. Yahoo answers
// 429 "Too Many Requests" to EVERY chart request from both this laptop and the
// Render instance (measured 05/08/2026, curl and Node fetch, browser User-Agent
// set); the same URL fetched from a third network returns 200. The block is by
// IP, and a datacenter IP is exactly what Render gives us. Don't rebuild the
// Yahoo path.
//
// One upstream call returns EVERY currency for the whole date range, so a cross
// rate needs no second request: with base=USD each day carries "units of XXX per
// 1 USD", hence
//     XXX/VND = (VND per USD) ÷ (XXX per USD)
// and USD/VND is simply the VND leg. Same formula for all 20 currencies.
//
// LIMIT: the free tier only serves 366 days of history ("start_date_too_old"),
// so the 5Y button of the stock chart has no equivalent here — see CLAUDE.md §10.
// ------------------------------------------------------------
const FX_TS_URL = process.env.FX_TS_URL || "https://api.fxratesapi.com/timeseries";
const FX_MAX_DAYS = 365; // upstream says "366 days in the past"; 366 exactly already 400s

// Every currency Vietcombank quotes. The upstream returns all of them in one
// response, so listing them costs nothing extra per request.
const FX_CODES = [
  "USD", "EUR", "GBP", "AUD", "JPY", "CNY", "CHF", "CAD", "SGD", "HKD",
  "THB", "KRW", "SEK", "NOK", "DKK", "INR", "MYR", "RUB", "SAR", "KWD",
];

// What to actually ask for: VND is the quote leg of every rate on this page and
// must be requested explicitly; USD is the base, so it is always 1 and asking
// for it returns nothing.
// XAU rides along for the gold chart's "world price" line (26/09/2026): same
// call, no extra request. It comes back as troy ounces of gold per 1 USD.
const FX_QUERY_CODES = ["VND", ...FX_CODES.filter((c) => c !== "USD"), "XAU"];

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

// Raw daily series for ALL currencies over `days`, keyed by date:
//   Map("2026-08-04" -> { VND: 26259.0, JPY: 157.7, ... })
async function fetchFxTimeseries(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const url =
    `${FX_TS_URL}?start_date=${isoDay(start)}&end_date=${isoDay(end)}` +
    `&base=USD&currencies=${FX_QUERY_CODES.join(",")}`;

  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 15000);
  if (!res.ok) throw new Error(`FXRatesAPI HTTP ${res.status}`);
  const json = await res.json();
  if (json.success === false) {
    throw new Error(`FXRatesAPI: ${json.error || "unknown error"}`);
  }
  const rows = json.rates || {};
  const byDate = new Map();
  // Keys are full timestamps ("2026-08-04T23:59:00.000Z") = that day's close.
  for (const [stamp, vals] of Object.entries(rows)) {
    if (vals && Number.isFinite(vals.VND)) byDate.set(String(stamp).slice(0, 10), vals);
  }
  if (!byDate.size) throw new Error("FXRatesAPI returned no rows");
  return byDate;
}

// Cached per range, not per currency: one payload serves all 20.
function fxTimeseries(days) {
  // Daily bars only change once a day, and the range endpoints move with the
  // clock, so a few hours of staleness costs nothing and keeps us far away from
  // any free-tier quota.
  return withCache(`fx-ts:${days}`, 6 * 60 * 60_000, () => fetchFxTimeseries(days));
}

async function computeFxHistory(code, days) {
  const byDate = await fxTimeseries(days);
  const items = [];
  for (const [date, vals] of byDate) {
    const vnd = vals.VND;
    const per = code === "USD" ? 1 : vals[code];
    if (!Number.isFinite(vnd) || !Number.isFinite(per) || per === 0) continue;
    // 4 decimals keeps KRW/JPY-sized rates meaningful without bloating the payload.
    items.push({ date, rate: Math.round((vnd / per) * 10000) / 10000 });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) throw new Error(`no data for ${code}`);
  return {
    source: "FXRatesAPI",
    kind: "interbank", // single mid price — NOT the retail board of /api/fx/rates
    method: code === "USD" ? "direct" : "cross",
    code,
    items,
  };
}

// GET /api/fx/history?code=USD&days=365
app.get("/api/fx/history", cacheFor(1800), async (req, res) => {
  const code = String(req.query.code || "USD").toUpperCase();
  const days = Number(req.query.days) || 365;
  if (!FX_CODES.includes(code)) {
    return res.status(400).json({ error: "unsupported_currency", detail: code });
  }
  // Refuse rather than silently shorten: quietly returning 1 year of data to a
  // request for 5 years would put a truthful series under a false label, which
  // misleads exactly as much as a made-up number (golden rule, CLAUDE.md §3).
  if (days > FX_MAX_DAYS) {
    return res.status(400).json({ error: "range_too_long", maxDays: FX_MAX_DAYS });
  }

  try {
    res.json(await computeFxHistory(code, days));
  } catch (err) {
    console.error("[/api/fx/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// GOLD — PNJ primary, BTMC fallback, merged into one shape.
//
// UNIT, verified 06/08/2026 against three independent sources (this was task
// 2.1 of the plan, and the same class of bug as SSI's raw-VND prices):
//   PNJ   giaban 14270  -> THOUSAND VND per CHỈ  (14,27 triệu/chỉ)
//   BTMC  @ps    14330000 -> RAW VND per CHỈ
//   Press (06/08/2026): SJC 138,8 - 141,8 triệu/LƯỢNG
// 1 lượng = 10 chỉ, so PNJ ×10 = 139,7 / 142,7 triệu/lượng and BTMC ×10 =
// 140,3 / 143,3 — both land on the published board, a few tenths of a percent
// apart as two different shops should be. So: this route speaks THOUSAND VND
// PER CHỈ, and BTMC is divided by 1000 to match. Don't "fix" either.
// ============================================================
const PNJ_GOLD_URL =
  process.env.PNJ_GOLD_URL || "https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price";
// Key is public (it ships in BTMC's own web page) and may be rotated by them at
// any time — that is exactly why BTMC is the fallback and not the primary.
const BTMC_GOLD_URL =
  process.env.BTMC_GOLD_URL ||
  "http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v";
const GOLD_TTL_MS = 5 * 60_000; // board changes a few times a day, not per second

// "" means the shop does not quote that side (PNJ only BUYS raw gold: RAW_9999
// and RAW_9900 have giaban ""). null, never 0 — golden rule, CLAUDE.md §3.
function goldAmount(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// PNJ: "06/08/2026 13:18:11", Vietnam local time with no offset in the string.
function parseVnDateTime(s) {
  const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
  const p2 = (n) => String(n).padStart(2, "0");
  return `${yyyy}-${p2(mm)}-${p2(dd)}T${p2(hh)}:${mi}:${p2(ss)}+07:00`;
}

async function computeGoldFromPnj() {
  const res = await fetchWithTimeout(PNJ_GOLD_URL, { headers: { Accept: "application/json" } }, 8000);
  if (!res.ok) throw new Error(`PNJ HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];

  const items = rows
    .map((r) => ({
      code: String(r.masp || "").trim(),
      name: String(r.tensp || "").trim(),
      buy: goldAmount(r.giamua),
      sell: goldAmount(r.giaban),
    }))
    .filter((r) => r.code && (r.buy !== null || r.sell !== null));
  if (!items.length) throw new Error("PNJ returned no rows");

  return {
    updatedAt: parseVnDateTime(json.updateDate),
    source: "PNJ",
    branch: json.chinhanh || null, // the board is per branch; HCM by default
    unit: "nghìn đồng/chỉ",
    items,
  };
}

// BTMC ships one flat array where EVERY field name carries the row number as a
// suffix (@n_7, @pb_7, @ps_7, @d_7), so fields must be read via the row index,
// not by fixed names. Each product also appears twice with different @d_
// timestamps — keep the newest.
function btmcField(row, prefix) {
  return row[`@${prefix}_${row["@row"]}`];
}

async function computeGoldFromBtmc() {
  const res = await fetchWithTimeout(BTMC_GOLD_URL, { headers: { Accept: "application/json" } }, 8000);
  if (!res.ok) throw new Error(`BTMC HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.DataList?.Data;
  if (!Array.isArray(rows)) throw new Error("BTMC: unexpected shape");

  const byName = new Map();
  let latest = null;
  for (const row of rows) {
    const name = String(btmcField(row, "n") || "").trim();
    // Silver lives in the same feed (BẠC = silver). This route is gold only.
    if (!name || name.toUpperCase().includes("BẠC")) continue;

    const stamp = parseVnDateTime(btmcField(row, "d"));
    const prev = byName.get(name);
    if (prev && prev.stamp && stamp && prev.stamp >= stamp) continue;

    // BTMC quotes raw VND per chỉ; this route speaks thousand VND per chỉ.
    const buy = goldAmount(btmcField(row, "pb"));
    const sell = goldAmount(btmcField(row, "ps"));
    byName.set(name, {
      stamp,
      item: {
        code: name,
        name,
        buy: buy === null ? null : buy / 1000,
        sell: sell === null ? null : sell / 1000,
        karat: String(btmcField(row, "k") || "").trim() || null,
      },
    });
    if (stamp && (!latest || stamp > latest)) latest = stamp;
  }

  const items = [...byName.values()].map((v) => v.item);
  if (!items.length) throw new Error("BTMC returned no gold rows");
  return { updatedAt: latest, source: "BTMC", branch: null, unit: "nghìn đồng/chỉ", items };
}

// PNJ first; BTMC only if PNJ fails. The payload always says which one answered
// so the page can label the number — two shops quote different prices, and an
// unlabelled swap would look like the market moved.
async function computeGoldPrices() {
  try {
    return await computeGoldFromPnj();
  } catch (err) {
    console.warn("[gold] PNJ lỗi, thử BTMC:", err.message);
    const data = await computeGoldFromBtmc();
    return { ...data, note: `PNJ lỗi (${err.message}), đang dùng nguồn dự phòng BTMC` };
  }
}

// GET /api/gold/prices
app.get("/api/gold/prices", async (req, res) => {
  try {
    res.json(await withCache("gold:prices", GOLD_TTL_MS, computeGoldPrices));
  } catch (err) {
    console.error("[/api/gold/prices]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// GOLD HISTORY — lịch sử giá vàng miếng SJC theo ngày (26/09/2026).
//
// Nguồn đã dò (đừng dò lại):
//   - sjc.com.vn: Cloudflare JS challenge (như bảng giá hiện tại) — KHÔNG dùng.
//   - CafeF `du-lieu/Ajax/ajaxgoldpricehistory.ashx?index=1y` — CHÍNH. Một lần
//     gọi trả SJC mua/bán (triệu ₫/lượng) cả năm: 460 bản ghi / 366 ngày, có
//     ngày nhiều bản → giữ bản CUỐI của ngày (giờ VN). index: 1m/3m/6m/1y/all
//     (all chỉ về tới 08/02/2025; "3y"/"5y" lặng lẽ trả như 1m — đừng dùng).
//   - PNJ `get-gold-price-history?zone=00&gold_type=SJC&date=YYYYMMDD` — DỰ
//     PHÒNG. Mỗi NGÀY một request, nghìn ₫/lượng dạng chuỗi "141.400".
//   - Đối chiếu CafeF vs PNJ 5 ngày rải 1 năm (25/09, 15/08, 02/06, 15/01/2026,
//     06/10/2025): khớp 0 đồng cả mua lẫn bán.
//   - "Thế giới quy đổi": XAU/USD × USD/VND của FXRatesAPI (liên ngân hàng),
//     đổi ounce → lượng (37,5 g / 31,1034768 g). KHÔNG gồm thuế, phí nhập
//     khẩu, gia công — là mốc tham chiếu, trang phải ghi rõ.
// ============================================================
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CAFEF_GOLD_HISTORY_URL =
  process.env.CAFEF_GOLD_HISTORY_URL || "https://cafef.vn/du-lieu/Ajax/ajaxgoldpricehistory.ashx";
const PNJ_GOLD_HISTORY_URL = "https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price-history";
const OZ_PER_LUONG = 37.5 / 31.1034768;
const GOLD_HISTORY_MAX_DAYS = 365;
const vnDateOf = (iso) => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10);

async function goldHistoryFromCafef() {
  const res = await fetchWithTimeout(
    `${CAFEF_GOLD_HISTORY_URL}?index=1y`,
    { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } },
    15000
  );
  if (!res.ok) throw new Error(`CafeF HTTP ${res.status}`);
  const rows = ((await res.json()).Data || {}).goldPriceWorldHistories || [];
  const byDate = new Map();
  for (const r of [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    if (r.name !== "SJC" || !r.createdAt) continue;
    const buy = Number(r.buyPrice);
    const sell = Number(r.sellPrice);
    if (!(buy > 0) || !(sell > 0)) continue;
    byDate.set(vnDateOf(r.createdAt), { buy, sell, at: r.createdAt }); // last of the day wins
  }
  if (!byDate.size) throw new Error("CafeF trả rỗng");
  return byDate;
}

// Per-day PNJ calls, 4 at a time. Only for short ranges: a year = 365 calls.
async function goldHistoryFromPnj(days) {
  const dates = [];
  for (let i = days; i >= 0; i--) dates.push(new Date(Date.now() + 7 * 3600e3 - i * 86400e3).toISOString().slice(0, 10));
  const byDate = new Map();
  const one = async (d) => {
    const res = await fetchWithTimeout(
      `${PNJ_GOLD_HISTORY_URL}?zone=00&gold_type=SJC&date=${d.replace(/-/g, "")}`,
      { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } },
      10000
    );
    if (!res.ok) return;
    const loc = ((await res.json()).locations || [])[0];
    const sjc = loc && (loc.gold_type || []).find((g) => g.name === "SJC");
    const last = sjc && sjc.data && sjc.data[sjc.data.length - 1];
    if (!last) return;
    const n = (v) => Number(String(v).replace(/\./g, "")) / 1000; // "141.400" nghìn -> 141.4 triệu
    const buy = n(last.gia_mua);
    const sell = n(last.gia_ban);
    if (buy > 0 && sell > 0) byDate.set(d, { buy, sell, at: last.updated_at });
  };
  for (let i = 0; i < dates.length; i += 4) await Promise.all(dates.slice(i, i + 4).map((d) => one(d).catch(() => {})));
  if (!byDate.size) throw new Error("PNJ trả rỗng");
  return byDate;
}

async function computeGoldHistory(days) {
  let source = "CafeF";
  let note = null;
  let byDate;
  try {
    byDate = await withCache("gold:hist:cafef", 60 * 60_000, goldHistoryFromCafef);
  } catch (err) {
    console.warn("[gold/history] CafeF lỗi, thử PNJ:", err.message);
    // PNJ is one request per day: measured 20s for 30 days (4 in flight).
    // A 3M/1Y fallback would keep the user waiting over a minute — refuse
    // instead and say why.
    if (days > 31) throw new Error(`CafeF lỗi (${err.message}); nguồn dự phòng PNJ chỉ phục vụ khung 1M`);
    byDate = await withCache(`gold:hist:pnj:${days}`, 60 * 60_000, () => goldHistoryFromPnj(days));
    source = "PNJ";
    note = "Nguồn chính CafeF đang lỗi — dùng lịch sử giá của PNJ";
  }
  const since = new Date(Date.now() + 7 * 3600e3 - days * 86400e3).toISOString().slice(0, 10);
  const items = [...byDate]
    .filter(([date]) => date >= since)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, buy: v.buy, sell: v.sell }));
  if (!items.length) throw new Error("không có dữ liệu trong khoảng này");
  const lastAt = byDate.get(items[items.length - 1].date).at;

  // World reference line. Best-effort: the SJC series stands on its own.
  let world = null;
  try {
    const fx = await fxTimeseries(Math.min(days, FX_MAX_DAYS));
    const w = [];
    for (const [date, vals] of fx) {
      if (date < since || !(vals.XAU > 0) || !(vals.VND > 0)) continue;
      w.push({ date, price: Math.round(((vals.VND / vals.XAU) * OZ_PER_LUONG) / 1e4) / 100 }); // triệu ₫/lượng
    }
    w.sort((a, b) => a.date.localeCompare(b.date));
    if (w.length) {
      world = {
        source: "FXRatesAPI",
        method: "XAU/USD × USD/VND liên ngân hàng, quy ounce → lượng",
        note: "Chưa gồm thuế, phí nhập khẩu và gia công — chỉ để so mức chênh",
        items: w,
      };
    }
  } catch (err) {
    console.warn("[gold/history] giá thế giới lỗi:", err.message);
  }

  return { source, note, product: "SJC", unit: "triệu đồng/lượng", lastAt, items, world };
}

// GET /api/gold/history?days=30|90|180|365
app.get("/api/gold/history", cacheFor(900), async (req, res) => {
  const days = Number(req.query.days) || 90;
  if (days > GOLD_HISTORY_MAX_DAYS) {
    return res.status(400).json({ error: "range_too_long", maxDays: GOLD_HISTORY_MAX_DAYS });
  }
  try {
    res.json(await withCache(`gold:history:${days}`, 30 * 60_000, () => computeGoldHistory(days)));
  } catch (err) {
    console.error("[/api/gold/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// SAVINGS — bảng lãi suất tiết kiệm, proxy file JSON tĩnh của CafeF.
//
// Trang gốc `cafef.vn/du-lieu/lai-suat-ngan-hang.chn` là ứng dụng Blazor
// WebAssembly (~90 file .dll) nên KHÔNG cào HTML được; nhưng nó nạp dữ liệu từ
// một file JSON tĩnh trên CDN, gọi thẳng được, không key, không challenge.
//
// Nguồn KHÔNG cam kết gì: URL nội bộ của CafeF, có thể đổi bất cứ lúc nào, và
// bản thân file KHÔNG mang thời điểm cập nhật. Nên:
//   - `fetchedAt` là thời điểm SERVER NÀY lấy được, không phải lúc ngân hàng
//     đổi lãi suất. Trang phải ghi "lấy lúc", đừng ghi "cập nhật lúc".
//   - Giữ bản chụp gần nhất trong bộ nhớ; nguồn chết thì trả bản cũ kèm
//     `stale: true` + `snapshotAt` để trang nói rõ số này cũ tới đâu. Thà dữ
//     liệu cũ có ghi ngày còn hơn bảng trống (bài học 30/07, mục 3).
// ============================================================
const CAFEF_SAVINGS_URL =
  process.env.CAFEF_SAVINGS_URL ||
  "https://cafefnew.mediacdn.vn/Images/Uploaded/DuLieuDownload/Liveboard/all_banks_interest_rates.json";
// 6 giờ: lãi suất huy động đổi theo tuần chứ không theo phút.
const SAVINGS_TTL_MS = 6 * 60 * 60_000;

// Thứ tự kỳ hạn phải theo SỐ THÁNG. Sắp theo chuỗi thì "12T" đứng trước "1T"
// và bảng đọc thành vô nghĩa.
function termMonths(t) {
  const m = String(t || "").match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

// Bản chụp gần nhất, sống theo tiến trình. Render Free khởi động lại là mất —
// chấp nhận: mất bản chụp chỉ có nghĩa là lần gọi sau phải chờ nguồn thật.
let savingsSnapshot = null;

async function fetchSavings() {
  const res = await fetchWithTimeout(
    CAFEF_SAVINGS_URL,
    { headers: { Accept: "application/json" } },
    10000
  );
  if (!res.ok) throw new Error(`CafeF HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.Data || json?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error("CafeF: không có dòng nào");

  const termSet = new Set();
  const banks = rows
    .map((b) => {
      const rates = {};
      for (const r of b.interestRates || []) {
        const t = String(r.time || "").trim();
        if (!t) continue;
        termSet.add(t);
        // null (không phải 0) khi ngân hàng không niêm yết kỳ hạn đó — 0%/năm
        // và "không nhận kỳ hạn này" là hai chuyện khác nhau.
        rates[t] = Number.isFinite(r.value) && r.value > 0 ? r.value : null;
      }
      return {
        name: String(b.name || "").trim(),
        symbol: String(b.symbol || "").trim(),
        icon: typeof b.icon === "string" && /^https?:\/\//.test(b.icon) ? b.icon : null,
        rates,
      };
    })
    .filter((b) => b.name);

  const terms = [...termSet].sort((a, b) => termMonths(a) - termMonths(b));
  return {
    fetchedAt: new Date().toISOString(),
    source: "CafeF",
    terms,
    banks: banks.sort((a, b) => a.name.localeCompare(b.name, "vi")),
  };
}

async function computeSavings() {
  try {
    const data = await fetchSavings();
    savingsSnapshot = data;
    return data;
  } catch (err) {
    if (savingsSnapshot) {
      console.warn("[savings] CafeF lỗi, trả bản chụp cũ:", err.message);
      return { ...savingsSnapshot, stale: true, snapshotAt: savingsSnapshot.fetchedAt };
    }
    throw err;
  }
}

// GET /api/savings/rates
app.get("/api/savings/rates", cacheFor(600), async (req, res) => {
  try {
    res.json(await withCache("savings:rates", SAVINGS_TTL_MS, computeSavings));
  } catch (err) {
    console.error("[/api/savings/rates]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// ============================================================
// CRYPTO — CoinGecko primary, then Binance, then OKX (USD x interbank rate).
//
// CoinGecko quotes VND directly, which is the whole reason it is the primary:
// deriving VND by multiplying a USD price with an exchange rate would stack a
// second source's error onto every number and leave it unlabelled.
//
// Binance only knows USDT pairs. So when the fallback answers, VND comes back
// as null and the UI prints "—" — it does NOT get invented from a rate picked
// off another endpoint (golden rule, CLAUDE.md §3).
//
// LIMIT: /market_chart on the free tier serves at most 365 days ("Your request
// exceeds the allowed time range", HTTP 401 code 10012), so the coin chart has
// the same 1M/3M/6M/1Y buttons as the FX page and no 5Y.
// ============================================================
const CG_BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3";
const BINANCE_BASE = process.env.BINANCE_BASE || "https://api.binance.com/api/v3";
const OKX_BASE = process.env.OKX_BASE || "https://www.okx.com/api/v5";
const CRYPTO_TTL_MS = 120_000;
// A coin price a few minutes old beats an error page while every upstream is
// cooling down; the payload's updatedAt tells the page how old it is.
const CRYPTO_STALE_MS = 30 * 60_000;
const CRYPTO_MAX_DAYS = 365;

// ------------------------------------------------------------
// Upstream cooldown (02/10/2026). Render's outbound IPs are SHARED with other
// tenants: Binance banned the IP with HTTP 418 "Way too much request weight
// used" (Retry-After 360) although this server sends a handful of requests per
// hour, and data-api.binance.vision carries the SAME ban. Binance escalates the
// ban (2 min -> 3 days) for clients that keep calling while banned, and
// CoinGecko answers 429 to every call. So on 429/418 a source is skipped
// entirely until Retry-After passes instead of being hit on every request.
// ------------------------------------------------------------
const upstreamCooldown = new Map(); // source name -> epoch ms it may be called again

function assertNotCooling(name) {
  const until = upstreamCooldown.get(name) || 0;
  if (until > Date.now()) {
    const secs = Math.ceil((until - Date.now()) / 1000);
    throw new Error(`${name} đang tạm nghỉ ${secs}s sau khi bị giới hạn tần suất`);
  }
}

function noteRateLimit(name, res) {
  if (res.status !== 429 && res.status !== 418) return;
  const retryAfter = Number(res.headers.get("retry-after"));
  // No header: 418 is a ban (minutes at least), 429 a warning.
  const fallbackMs = res.status === 418 ? 10 * 60_000 : 60_000;
  const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallbackMs;
  upstreamCooldown.set(name, Date.now() + ms);
  console.warn(`[crypto] ${name} HTTP ${res.status} — nghỉ ${Math.round(ms / 1000)}s`);
}

async function binanceJson(path, timeoutMs = 10000) {
  assertNotCooling("Binance");
  const res = await fetchWithTimeout(`${BINANCE_BASE}${path}`, { headers: { Accept: "application/json" } }, timeoutMs);
  if (!res.ok) {
    noteRateLimit("Binance", res);
    throw new Error(`Binance HTTP ${res.status}`);
  }
  return res.json();
}

async function okxJson(path) {
  assertNotCooling("OKX");
  const res = await fetchWithTimeout(`${OKX_BASE}${path}`, { headers: { Accept: "application/json" } }, 12000);
  if (!res.ok) {
    noteRateLimit("OKX", res);
    throw new Error(`OKX HTTP ${res.status}`);
  }
  // OKX reports API-level errors with HTTP 200 and a non-"0" code.
  const body = await res.json();
  if (body?.code !== "0" || !Array.isArray(body.data)) {
    throw new Error(`OKX lỗi ${body?.code}: ${body?.msg || "không có data"}`);
  }
  return body.data;
}

async function cgJson(path) {
  assertNotCooling("CoinGecko");
  const res = await fetchWithTimeout(`${CG_BASE}${path}`, { headers: { Accept: "application/json" } }, 12000);
  if (!res.ok) {
    noteRateLimit("CoinGecko", res);
    // CoinGecko puts the useful part in a nested error_message (e.g. the
    // 365-day limit); the HTTP status alone says nothing.
    let detail = "";
    try {
      detail = String((await res.json())?.error?.status?.error_message || "").trim();
    } catch {}
    throw new Error(`CoinGecko HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

// /coins/markets carries name, symbol, logo, VND price, 24h change and market
// cap in one call; /simple/price adds the USD leg. Two calls, both cached
// together, rather than one call per currency per coin.
async function computeCryptoFromCoinGecko(ids) {
  const q = encodeURIComponent(ids.join(","));
  const [markets, usd] = await Promise.all([
    cgJson(`/coins/markets?vs_currency=vnd&ids=${q}&price_change_percentage=24h`),
    cgJson(`/simple/price?ids=${q}&vs_currencies=usd`),
  ]);
  if (!Array.isArray(markets) || !markets.length) throw new Error("CoinGecko returned no rows");

  const items = markets.map((c) => ({
    id: c.id,
    symbol: String(c.symbol || "").toUpperCase(),
    name: c.name,
    image: c.image || null,
    vnd: Number.isFinite(c.current_price) ? c.current_price : null,
    usd: Number.isFinite(usd?.[c.id]?.usd) ? usd[c.id].usd : null,
    change24h: Number.isFinite(c.price_change_percentage_24h) ? c.price_change_percentage_24h : null,
    marketCap: Number.isFinite(c.market_cap) ? c.market_cap : null,
  }));
  // Keep the caller's order: CoinGecko sorts by market cap, the user sorted by
  // their own watchlist.
  items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { updatedAt: new Date().toISOString(), source: "CoinGecko", items };
}

// USD/VND used to price coins in đồng. The interbank mid rate, NOT Vietcombank's
// retail board: a coin price is a market price, so pairing it with a retail rate
// that carries a buy/sell spread would mix two different kinds of number.
// Reuses the FX timeseries this server already caches — no extra upstream.
async function usdVndSeries() {
  const byDate = await fxTimeseries(365);
  const out = new Map();
  for (const [date, vals] of byDate) {
    if (Number.isFinite(vals.VND)) out.set(date, vals.VND);
  }
  if (!out.size) throw new Error("không lấy được tỷ giá USD/VND");
  return out;
}

// Latest available rate. The series ends yesterday (the FX source closes daily),
// so today's coin prices are converted at yesterday's rate — the payload says so
// and the page prints it.
async function latestUsdVnd() {
  const series = await usdVndSeries();
  const lastDate = [...series.keys()].sort().pop();
  return { rate: series.get(lastDate), rateDate: lastDate };
}

// Binance speaks USDT pairs keyed by ticker, not by CoinGecko id, so the mapping
// is symbol-based and anything it cannot resolve is simply absent.
async function computeCryptoFromBinance(ids, symbolById) {
  const symbols = ids.map((id) => symbolById[id]).filter(Boolean);
  if (!symbols.length) throw new Error("Binance: no known symbol for these ids");

  // USDT là chính vế báo giá nên KHÔNG có cặp "USDTUSDT". Để nó lọt vào danh
  // sách thì Binance trả HTTP 400 cho CẢ LÔ, mất luôn giá của mọi coin khác.
  // Giá USD của nó lấy bằng 1 theo định nghĩa của cặp.
  const quotable = symbols.filter((s) => s !== "USDT");
  let rows = [];
  if (quotable.length) {
    // Binance muốn một mảng JSON và toàn bộ giá trị phải được URL-encode, kể cả
    // hai dấu ngoặc vuông — encode mỗi phần bên trong thì nó trả HTTP 400.
    const pairs = JSON.stringify(quotable.map((s) => `${s}USDT`));
    rows = await binanceJson(`/ticker/24hr?symbols=${encodeURIComponent(pairs)}`);
    if (!Array.isArray(rows)) throw new Error("Binance returned no rows");
  }

  // Binance quotes USDT only. VND comes from this server's own FX rate, and the
  // payload carries the rate + its date so the page can label it — a converted
  // number under no label reads as a directly quoted one.
  let rate = null;
  let rateDate = null;
  try {
    ({ rate, rateDate } = await latestUsdVnd());
  } catch (err) {
    console.warn("[crypto] không có tỷ giá USD/VND:", err.message);
  }

  const bySymbol = new Map(rows.map((r) => [String(r.symbol).replace(/USDT$/, ""), r]));
  const items = ids
    .map((id) => {
      const sym = symbolById[id];
      if (sym === "USDT") {
        return {
          id, symbol: sym, name: CRYPTO_NAMES.USDT, image: null,
          vnd: rate || null, usd: 1, change24h: null, marketCap: null,
        };
      }
      const r = sym && bySymbol.get(sym);
      if (!r) return null;
      const usd = num(r.lastPrice) || null;
      return {
        id,
        symbol: sym,
        name: CRYPTO_NAMES[sym] || sym,
        image: null,
        // null, không phải 0, khi thiếu tỷ giá — UI hiện "—".
        vnd: usd !== null && rate ? usd * rate : null,
        usd,
        change24h: Number(r.priceChangePercent) || null,
        marketCap: null,
      };
    })
    .filter(Boolean);
  if (!items.length) throw new Error("Binance: nothing matched");
  return {
    updatedAt: new Date().toISOString(),
    source: "Binance",
    vndFrom: rate ? { rate, rateDate, source: "FXRatesAPI (liên ngân hàng)" } : null,
    items,
  };
}

// CoinGecko ids are slugs; Binance speaks tickers. This is
// the bridge, and it only covers the coins the dashboard ships with — a
// user-added coin that CoinGecko knows and this map does not simply falls back
// to CoinGecko, which is better than guessing its ticker.
const CRYPTO_SYMBOLS = {
  bitcoin: "BTC", ethereum: "ETH", tether: "USDT", binancecoin: "BNB",
  solana: "SOL", ripple: "XRP", cardano: "ADA", dogecoin: "DOGE",
  polkadot: "DOT", "matic-network": "MATIC", "avalanche-2": "AVAX",
  chainlink: "LINK", tron: "TRX", litecoin: "LTC", "usd-coin": "USDC",
  "shiba-inu": "SHIB", uniswap: "UNI", "cosmos": "ATOM", stellar: "XLM",
  "near": "NEAR", aptos: "APT", arbitrum: "ARB", optimism: "OP",
  "internet-computer": "ICP", filecoin: "FIL", "hedera-hashgraph": "HBAR",
  vechain: "VET", "the-graph": "GRT", algorand: "ALGO", aave: "AAVE",
  "injective-protocol": "INJ", sui: "SUI", sei: "SEI", "pepe": "PEPE",
  "bitcoin-cash": "BCH", "ethereum-classic": "ETC", monero: "XMR",
  "render-token": "RNDR", "immutable-x": "IMX", "lido-dao": "LDO",
};

// Tên tiếng Anh để hiện trong ô tìm kiếm khi CoinGecko không trả lời.
const CRYPTO_NAMES = {
  BTC: "Bitcoin", ETH: "Ethereum", USDT: "Tether", BNB: "BNB", SOL: "Solana",
  XRP: "XRP", ADA: "Cardano", DOGE: "Dogecoin", DOT: "Polkadot",
  MATIC: "Polygon", AVAX: "Avalanche", LINK: "Chainlink", TRX: "TRON",
  LTC: "Litecoin", USDC: "USD Coin", SHIB: "Shiba Inu", UNI: "Uniswap",
  ATOM: "Cosmos", XLM: "Stellar", NEAR: "NEAR Protocol", APT: "Aptos",
  ARB: "Arbitrum", OP: "Optimism", ICP: "Internet Computer", FIL: "Filecoin",
  HBAR: "Hedera", VET: "VeChain", GRT: "The Graph", ALGO: "Algorand",
  AAVE: "Aave", INJ: "Injective", SUI: "Sui", SEI: "Sei", PEPE: "Pepe",
  BCH: "Bitcoin Cash", ETC: "Ethereum Classic", XMR: "Monero",
  RNDR: "Render", IMX: "Immutable", LDO: "Lido DAO",
};

// Tìm trong bảng trên, không gọi mạng. Dùng khi CoinGecko không trả lời — mà ở
// Render thì đó là mọi lúc (429 theo IP, xem đầu mục này).
function searchLocalCoins(q) {
  const needle = q.trim().toLowerCase();
  return Object.entries(CRYPTO_SYMBOLS)
    .filter(([id, sym]) => {
      const name = CRYPTO_NAMES[sym] || sym;
      return id.includes(needle) || sym.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
    })
    .slice(0, 10)
    .map(([id, sym]) => ({ id, symbol: sym, name: CRYPTO_NAMES[sym] || sym, rank: null }));
}

// Lịch sử giá theo VND, đường dự phòng khi CoinGecko không trả lời.
// Binance /klines cho giá USDT theo ngày; nhân với tỷ giá USD/VND CỦA CHÍNH
// NGÀY ĐÓ (không phải tỷ giá hôm nay) — dùng một tỷ giá duy nhất cho cả năm sẽ
// bóp méo hình dạng đường, biến biến động tỷ giá thành biến động giá coin.
async function computeCryptoHistoryFromBinance(id, days) {
  const sym = CRYPTO_SYMBOLS[id];
  if (!sym) throw new Error(`Binance: chưa có mã ticker cho ${id}`);

  const rows = await binanceJson(
    `/klines?symbol=${encodeURIComponent(sym)}USDT&interval=1d&limit=${Math.min(days + 1, 1000)}`,
    12000
  );
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Binance: không có dữ liệu cho ${sym}`);
  // [openTime, open, high, low, close, ...] — lấy giá đóng cửa.
  const usdByDay = rows.map((k) => [Number(k[0]), Number(k[4])]);
  return usdHistoryToVnd(id, sym, usdByDay, "Binance");
}

// Daily USD closes -> VND series. Nhân với tỷ giá USD/VND CỦA CHÍNH NGÀY ĐÓ
// (không phải tỷ giá hôm nay) — dùng một tỷ giá duy nhất cho cả năm sẽ bóp méo
// hình dạng đường, biến biến động tỷ giá thành biến động giá coin.
async function usdHistoryToVnd(id, sym, usdByDay, sourceName) {
  const rates = await usdVndSeries();
  const dates = [...rates.keys()].sort();
  // One point per UTC date (chart rule, CLAUDE.md §7), ascending.
  const byDate = new Map();
  for (const [ts, usd] of [...usdByDay].sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(usd)) continue;
    const date = new Date(ts).toISOString().slice(0, 10);
    // Cuối tuần thị trường ngoại hối đóng nên không có tỷ giá của đúng ngày đó;
    // lấy tỷ giá gần nhất TRƯỚC đó thay vì bỏ điểm — coin giao dịch 24/7.
    let rate = rates.get(date);
    if (!rate) {
      const prev = dates.filter((d) => d <= date).pop();
      rate = prev ? rates.get(prev) : null;
    }
    if (!rate) continue;
    byDate.set(date, usd * rate);
  }
  const items = [...byDate].map(([date, price]) => ({ date, price }));
  if (!items.length) throw new Error(`${sourceName}: không ghép được tỷ giá cho ${sym}`);
  return {
    source: `${sourceName} × tỷ giá liên ngân hàng`,
    currency: "VND",
    id,
    note: `Giá USD của ${sourceName} nhân tỷ giá USD/VND cùng ngày`,
    items,
  };
}

// ------------------------------------------------------------
// OKX — third source, added 02/10/2026 when Binance banned Render's IP.
// Measured from Render (/api/debug/crypto-probe): OKX, Kraken and Coinbase
// answered 200 while Binance and data-api.binance.vision answered 418.
// OKX won because it quotes USDT pairs by ticker like Binance (same symbol
// map) and serves every spot ticker in ONE call.
// ------------------------------------------------------------

// Tickers OKX lists under a different name. MATIC migrated 1:1 to POL and
// RNDR was renamed RENDER, so the price is the same asset's.
const OKX_TICKER_ALIASES = { MATIC: "POL", RNDR: "RENDER" };
const okxInstId = (sym) => `${OKX_TICKER_ALIASES[sym] || sym}-USDT`;

async function computeCryptoFromOkx(ids, symbolById) {
  const symbols = ids.map((id) => symbolById[id]).filter(Boolean);
  if (!symbols.length) throw new Error("OKX: no known symbol for these ids");

  // ~1,100 rows / ~360 KB, but one call covers every id list the pages ask
  // for, so it is cached once instead of once per watchlist combination.
  const all = await withCache("crypto:okx:tickers", CRYPTO_TTL_MS, () => okxJson("/market/tickers?instType=SPOT"));
  const byInst = new Map(all.map((t) => [t.instId, t]));

  let rate = null;
  let rateDate = null;
  try {
    ({ rate, rateDate } = await latestUsdVnd());
  } catch (err) {
    console.warn("[crypto] không có tỷ giá USD/VND:", err.message);
  }

  const items = ids
    .map((id) => {
      const sym = symbolById[id];
      if (sym === "USDT") {
        return {
          id, symbol: sym, name: CRYPTO_NAMES.USDT, image: null,
          vnd: rate || null, usd: 1, change24h: null, marketCap: null,
        };
      }
      const t = sym && byInst.get(okxInstId(sym));
      if (!t) return null;
      const usd = num(t.last) || null;
      const open = num(t.open24h);
      return {
        id,
        symbol: sym,
        name: CRYPTO_NAMES[sym] || sym,
        image: null,
        vnd: usd !== null && rate ? usd * rate : null,
        usd,
        // open24h is the rolling-24h open, same window as Binance's figure.
        change24h: usd !== null && open ? ((usd - open) / open) * 100 : null,
        marketCap: null,
      };
    })
    .filter(Boolean);
  if (!items.length) throw new Error("OKX: nothing matched");
  return {
    updatedAt: new Date().toISOString(),
    source: "OKX",
    vndFrom: rate ? { rate, rateDate, source: "FXRatesAPI (liên ngân hàng)" } : null,
    items,
  };
}

// history-candles returns at most 100 rows per call, newest first; page back
// with `after` (= oldest ts seen). 365 days -> 4 calls.
async function computeCryptoHistoryFromOkx(id, days) {
  const sym = CRYPTO_SYMBOLS[id];
  if (!sym) throw new Error(`OKX: chưa có mã ticker cho ${id}`);
  const inst = encodeURIComponent(okxInstId(sym));
  const want = days + 1;
  const rows = [];
  let after = "";
  while (rows.length < want) {
    const page = await okxJson(
      `/market/history-candles?instId=${inst}&bar=1Dutc&limit=100${after ? `&after=${after}` : ""}`
    );
    if (!page.length) break;
    rows.push(...page);
    after = page[page.length - 1][0];
    if (page.length < 100) break;
  }
  if (!rows.length) throw new Error(`OKX: không có dữ liệu cho ${sym}`);
  // [ts, open, high, low, close, ...] — newest first; keep the last `want` days.
  const usdByDay = rows.slice(0, want).map((k) => [Number(k[0]), Number(k[4])]);
  return usdHistoryToVnd(id, sym, usdByDay, "OKX");
}

// CoinGecko -> Binance. Nguồn nào trả lời thì tên nằm ở `source`, và đường dự
// phòng đặt thêm `note`: hai nguồn báo giá lệch nhau và chỉ một nguồn cho giá
// VND trực tiếp, nên đổi nguồn mà không ghi nhãn sẽ trông như thị trường biến động.
//
// CoinMarketCap đã bị GỠ ngày 07/08/2026: mọi endpoint đòi API key và gói có key
// là gói trả phí — không hợp với dự án. Đừng dựng lại.
//
// Thứ tự CoinGecko -> Binance -> OKX. Nguồn đang "tạm nghỉ" (xem
// upstreamCooldown) bị bỏ qua ngay, không tốn request.
async function computeCryptoPrices(ids) {
  try {
    return await computeCryptoFromCoinGecko(ids);
  } catch (cgErr) {
    console.warn("[crypto] CoinGecko lỗi, thử nguồn USD:", cgErr.message);
    const errors = [`CoinGecko: ${cgErr.message}`];
    for (const [name, fn] of [["Binance", computeCryptoFromBinance], ["OKX", computeCryptoFromOkx]]) {
      try {
        const data = await fn(ids, CRYPTO_SYMBOLS);
        return {
          ...data,
          note: data.vndFrom
            ? `Giá USD từ ${name}, quy đổi VND theo tỷ giá liên ngân hàng ngày ${data.vndFrom.rateDate}`
            : `CoinGecko lỗi (${cgErr.message}), đang dùng ${name} — chưa có tỷ giá nên cột VND để trống`,
        };
      } catch (err) {
        console.warn(`[crypto] ${name} lỗi:`, err.message);
        errors.push(`${name}: ${err.message}`);
      }
    }
    throw new Error(errors.join(" | "));
  }
}

// GET /api/crypto/prices?ids=bitcoin,ethereum
app.get("/api/crypto/prices", async (req, res) => {
  const ids = String(req.query.ids || "bitcoin,ethereum")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50); // one CoinGecko call has to stay one call
  if (!ids.length) return res.status(400).json({ error: "missing_ids" });

  try {
    res.json(await withCache(`crypto:prices:${ids.join(",")}`, CRYPTO_TTL_MS, () => computeCryptoPrices(ids), {
      staleMs: CRYPTO_STALE_MS,
    }));
  } catch (err) {
    console.error("[/api/crypto/prices]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// GET /api/crypto/history?id=bitcoin&days=90 — VND series, one point per day.
app.get("/api/crypto/history", cacheFor(600), async (req, res) => {
  const id = String(req.query.id || "").trim().toLowerCase();
  const days = Number(req.query.days) || 90;
  if (!id) return res.status(400).json({ error: "missing_id" });
  // Refuse rather than silently shorten — same rule as /api/fx/history.
  if (days > CRYPTO_MAX_DAYS) {
    return res.status(400).json({ error: "range_too_long", maxDays: CRYPTO_MAX_DAYS });
  }

  try {
    const data = await withCache(`crypto:history:${id}:${days}`, 30 * 60_000, async () => {
      try {
        const raw = await cgJson(
          `/coins/${encodeURIComponent(id)}/market_chart?vs_currency=vnd&days=${days}&interval=daily`
        );
        // `interval=daily` returns the 00:00 point of today PLUS a live "now"
        // point with the same date (measured 26/09/2026: two 2026-09-26 rows).
        // Lightweight Charts throws on duplicate times and draws nothing, so
        // keep one point per date — the last, i.e. the most recent price.
        const byDate = new Map();
        for (const [ts, price] of raw.prices || []) {
          if (Number.isFinite(price)) byDate.set(new Date(ts).toISOString().slice(0, 10), price);
        }
        const items = [...byDate].map(([date, price]) => ({ date, price }));
        if (!items.length) throw new Error(`no data for ${id}`);
        return { source: "CoinGecko", currency: "VND", id, items };
      } catch (err) {
        console.warn("[crypto] CoinGecko history lỗi, thử Binance:", err.message);
      }
      try {
        return await computeCryptoHistoryFromBinance(id, days);
      } catch (err) {
        console.warn("[crypto] Binance history lỗi, thử OKX:", err.message);
      }
      return computeCryptoHistoryFromOkx(id, days);
    }, { staleMs: 6 * 3600_000 });
    res.json(data);
  } catch (err) {
    console.error("[/api/crypto/history]", err.message);
    res.status(502).json({ error: "upstream_failed", detail: err.message });
  }
});

// GET /api/crypto/search?q=sol — resolve a ticker the user typed into a
// CoinGecko id. Needed because ids are slugs ("matic-network"), not tickers.
app.get("/api/crypto/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "query_too_short" });

  try {
    const data = await withCache(`crypto:search:${q.toLowerCase()}`, 10 * 60_000, async () => {
      try {
        const raw = await cgJson(`/search?query=${encodeURIComponent(q)}`);
        const rows = (raw.coins || [])
          .slice(0, 10)
          .map((c) => ({ id: c.id, symbol: String(c.symbol || "").toUpperCase(), name: c.name, rank: c.market_cap_rank ?? null }));
        if (rows.length) return rows;
      } catch (err) {
        console.warn("[crypto] CoinGecko search lỗi, tìm trong bảng nội bộ:", err.message);
      }
      // Bảng nội bộ chỉ có ~40 coin. Ít hơn CoinGecko rất nhiều, nhưng mọi mã
      // trong đó chắc chắn định giá được ở cả hai đường nguồn.
      return searchLocalCoins(q);
    });
    res.json(data);
  } catch (err) {
    console.error("[/api/crypto/search]", err.message);
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
  const res = await fetchWithTimeout(
    `${SSI_TRADE_BASE}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    15000
  );
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

  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    15000
  );
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

// GET /api/debug/crypto-probe — measure each candidate crypto source FROM THIS
// HOST (Render's IPs get blocked where a laptop does not, CLAUDE.md §7). Fixed
// URL list on purpose: no user input reaches fetch, so this is not an SSRF hole.
const CRYPTO_PROBES = {
  "binance": "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
  "binance-vision": "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT",
  "binance-vision-klines": "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2",
  "okx": "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
  "okx-candles": "https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=2",
  "kraken": "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
  "coinbase": "https://api.exchange.coinbase.com/products/BTC-USD/stats",
  "coingecko": "https://api.coingecko.com/api/v3/ping",
};
app.get("/api/debug/crypto-probe", async (req, res) => {
  const out = {};
  await Promise.all(Object.entries(CRYPTO_PROBES).map(async ([name, url]) => {
    const t0 = Date.now();
    try {
      const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 10000);
      const body = (await r.text()).slice(0, 160);
      out[name] = { status: r.status, ms: Date.now() - t0, retryAfter: r.headers.get("retry-after"), body };
    } catch (err) {
      out[name] = { status: null, ms: Date.now() - t0, error: err.message };
    }
  }));
  res.json(out);
});

// GET /api/debug/ssi-mcp-probe — can THIS host reach SSI MCP at all? No token
// is sent: a healthy answer is HTTP 401 "Unauthorized" from the MCP server
// itself, the same as from a laptop. A Cloudflare 403/challenge page instead
// means Render's IP is blocked before auth even matters (CLAUDE.md §7).
app.get("/api/debug/ssi-mcp-probe", async (req, res) => {
  const probe = async (url, init) => {
    const t0 = Date.now();
    try {
      const r = await fetchWithTimeout(url, init, 10000);
      return { status: r.status, ms: Date.now() - t0, body: (await r.text()).slice(0, 200) };
    } catch (err) {
      return { status: null, ms: Date.now() - t0, error: err.message };
    }
  };
  const [initialize, metadata] = await Promise.all([
    probe("https://mcp.ssi.com.vn/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } } }),
    }),
    probe("https://mcp.ssi.com.vn/.well-known/oauth-authorization-server", {}),
  ]);
  res.json({ initialize, metadata });
});

// ============================================================
// `startedAt` / `uptimeSec` tell you whether this instance just cold-started.
// Render Free spins the instance down after 15 idle minutes, and a cold start
// is the difference between an instant page load and a 30-60s wait — so when
// the dashboard feels slow, this is the first thing to check.
const BOOT_AT = new Date().toISOString();
app.get("/health", (req, res) =>
  res.json({ ok: true, startedAt: BOOT_AT, uptimeSec: Math.round(process.uptime()) })
);

// ============================================================
// SNAPSHOT GIÁ HÀNG NGÀY (GĐ 5.7 của docs/QUYHOACH.md)
//
// Vì sao cần: tỷ giá Vietcombank, giá vàng PNJ và bảng lãi suất tiết kiệm
// KHÔNG có nguồn lịch sử miễn phí nào cho VN. Không tự lưu từ hôm nay thì một
// năm nữa vẫn không vẽ được biểu đồ một năm — dữ liệu đã trôi qua không mua
// lại được. Đây là lý do việc này làm sớm, dù thứ dùng tới nó (GĐ 6) còn xa.
//
// Ghi bằng SECRET KEY, không phải publishable key: bảng `price_snapshots` mở
// cho mọi người ĐỌC nhưng không có policy ghi nào (xem supabase/schema.sql),
// nên chỉ khoá bỏ qua RLS mới ghi được. Khoá đó chỉ sống trong env của Render,
// không bao giờ nằm trong repo hay chạm tới frontend.
//
// Không set env -> job TẮT HẲN, in một dòng log rồi thôi. Giống cách
// /api/account/* tắt khi thiếu DASHBOARD_API_KEY: thiếu cấu hình thì không
// chạy, chứ không chạy nửa vời.
// ============================================================
const SUPA_URL = process.env.SUPABASE_URL || "";
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY || "";
const SNAPSHOT_ENABLED = !!(SUPA_URL && SUPA_SECRET);

// Mỗi loại một hàng mỗi ngày, chốt bằng ràng buộc unique(kind, taken_on).
// Dùng UPSERT (merge-duplicates) chứ không phải bỏ qua trùng, cố ý: chạy lại
// trong ngày sẽ ĐÈ LÊN hàng cũ, nên hàng còn lại cuối ngày là bảng giá muộn
// nhất — gần giá đóng cửa nhất. Bỏ qua trùng thì hàng giữ lại là bảng lúc
// nửa đêm, tức bảng của hôm trước.
async function writeSnapshot(kind, payload) {
  const res = await fetchWithTimeout(
    `${SUPA_URL}/rest/v1/price_snapshots?on_conflict=kind,taken_on`,
    {
      method: "POST",
      headers: {
        apikey: SUPA_SECRET,
        Authorization: `Bearer ${SUPA_SECRET}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ kind, payload }),
    },
    15000
  );
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

// Đọc qua withCache y như route của người dùng: bảng giá vừa phục vụ ai đó
// xong thì job này KHÔNG gọi lại nguồn, chỉ lấy bản đã có trong bộ nhớ.
const SNAPSHOT_KINDS = [
  ["fx", () => withCache("fx:rates", FX_RATES_TTL_MS, computeFxRates)],
  ["gold", () => withCache("gold:prices", GOLD_TTL_MS, computeGoldPrices)],
  ["savings", () => withCache("savings:rates", SAVINGS_TTL_MS, computeSavings)],
];

async function snapshotDaily() {
  if (!SNAPSHOT_ENABLED) return;
  for (const [kind, producer] of SNAPSHOT_KINDS) {
    try {
      const payload = await producer();
      // Nguồn chết mà server trả bản chụp cũ (`stale: true`) thì KHÔNG ghi:
      // lưu lại sẽ tạo ra một điểm dữ liệu mang ngày hôm nay nhưng giá của
      // hôm khác, và về sau không ai phân biệt nổi trên biểu đồ.
      if (payload && payload.stale) {
        console.warn(`[snapshot] bỏ qua ${kind}: nguồn đang trả bản chụp cũ`);
        continue;
      }
      await writeSnapshot(kind, payload);
      console.log(`[snapshot] ${kind} ok`);
    } catch (err) {
      // Hỏng một loại không được làm hỏng hai loại còn lại, và tuyệt đối
      // không được làm sập tiến trình.
      console.warn(`[snapshot] ${kind} lỗi:`, err.message);
    }
  }
}

// Mỗi giờ chứ không phải mỗi 24 giờ: Render Free khởi động lại thường xuyên,
// mà setInterval 24h thì mỗi lần restart là đồng hồ đếm lại từ đầu — có thể
// không bao giờ tới hạn. Chạy hàng giờ + upsert theo ngày cho ra đúng một
// hàng mỗi ngày, và sống sót qua mọi lần restart.
const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS) || 3600_000;
if (SNAPSHOT_ENABLED) {
  setTimeout(snapshotDaily, 60_000); // để server ấm và cache có dữ liệu đã
  setInterval(snapshotDaily, SNAPSHOT_INTERVAL_MS);
} else {
  console.log("[snapshot] TẮT — thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY");
}

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
    await revalidate(`quote:${sym}`, QUOTE_TTL_MS, () => computeQuote(sym)).catch((e) =>
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
